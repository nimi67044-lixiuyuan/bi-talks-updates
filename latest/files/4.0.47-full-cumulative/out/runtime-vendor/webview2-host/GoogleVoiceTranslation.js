(function installGoogleVoiceTranslation() {
  if(!document.documentElement){document.addEventListener('DOMContentLoaded',installGoogleVoiceTranslation,{once:true});return;}
  if (location.hostname !== 'voice.google.com' || location.protocol !== 'https:') return;
  if (window.__biTalksGoogleVoiceTranslationInstalled) return;
  window.__biTalksGoogleVoiceTranslationInstalled = true;

  const state = {
    sequence: 0,
    scheduled: false,
    pending: new Map(),
    outgoingPending: null,
    outgoingAttempt: null,
    composing: false,
    allowProgrammaticSend: false,
    unreadScheduled: false,
    lastUnread: -1,
    lastUnreadReport: '',
    lastTrustedUnreadInteraction: 0,
    trustedUnreadCeiling: undefined,
    unreadCandidate: -1,
    unreadCandidateSince: 0,
    unreadStabilityTimer: undefined,
    preferences: { enabled: true, color: '#d8ff00', size: 15 }
  };
  const translationSelector = '[data-bi-talks-google-voice-translation="true"]';
  const hanPattern = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  const observedRoots = new WeakSet();
  const translationCache = new Map();
  const composerSelector = 'textarea[aria-label*="message" i],textarea[placeholder*="message" i],textarea[aria-label*="消息"],textarea[placeholder*="消息"],[contenteditable="true"][role="textbox"][aria-label*="message" i],[contenteditable="true"][role="textbox"][aria-label*="消息"]';

  function roots() {
    const result = [document];
    for (let index = 0; index < result.length; index += 1) {
      const root = result[index];
      root.querySelectorAll('*').forEach((element) => {
        if (element.shadowRoot && !result.includes(element.shadowRoot)) result.push(element.shadowRoot);
      });
    }
    return result;
  }

  function queryAll(selector) {
    const result = [];
    roots().forEach((root) => result.push(...root.querySelectorAll(selector)));
    return result;
  }

  function visibleRect(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
    if (rect.width < 18 || rect.height < 16 || rect.bottom <= 0 || rect.top >= innerHeight) return null;
    return rect;
  }

  function composerRect() {
    const candidates = queryAll('textarea,input[type="text"],input[type="search"],input:not([type]),[contenteditable="true"],[role="textbox"]')
      .map((element) => ({ element, rect: visibleRect(element) }))
      .filter((entry) => entry.rect && entry.rect.top > innerHeight * 0.55);
    candidates.sort((left, right) => right.rect.bottom - left.rect.bottom);
    return candidates[0]?.rect || {
      left: innerWidth * 0.42,
      top: innerHeight - 72,
      right: innerWidth - 12,
      bottom: innerHeight - 12,
      width: innerWidth * 0.56,
      height: 60
    };
  }

  function composerFromTarget(target) {
    if (!(target instanceof Element)) return null;
    const element = target.closest(composerSelector);
    if (!(element instanceof HTMLElement) || element.closest('[role="search"],nav,[role="dialog"]')) return null;
    return visibleRect(element) ? element : null;
  }

  function findComposer() {
    return queryAll(composerSelector).find(element => composerFromTarget(element)) || null;
  }
  function composerText(composer) {
    if (composer instanceof HTMLInputElement || composer instanceof HTMLTextAreaElement) return composer.value.trim();
    return (composer.innerText || composer.textContent || '').replace(/\u00a0/g, ' ').trim();
  }

  let outgoingStatusTimer;

  function showOutgoingStatus(message, tone = 'progress', duration = 0) {
    const id = 'bi-talks-google-voice-outgoing-status';
    let status = document.getElementById(id);
    if (!status) {
      status = document.createElement('div');
      status.id = id;
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.dataset.biTalksGoogleVoiceUi = 'true';
      Object.assign(status.style, {
        position: 'fixed', zIndex: '2147483647', right: '22px', bottom: '76px',
        maxWidth: 'min(320px, calc(100vw - 44px))', padding: '9px 13px', borderRadius: '9px',
        boxShadow: '0 8px 26px rgba(0,0,0,.32)', font: '600 13px/1.35 system-ui, sans-serif',
        color: '#fff', pointerEvents: 'none', transition: 'opacity .16s ease'
      });
      document.body?.appendChild(status);
    }
    status.textContent = message;
    status.style.background = tone === 'success' ? '#137333' : tone === 'error' ? '#b3261e' : '#365fc9';
    status.style.opacity = '1';
    if (outgoingStatusTimer) clearTimeout(outgoingStatusTimer);
    if (duration > 0) {
      outgoingStatusTimer = setTimeout(() => {
        status?.remove();
        outgoingStatusTimer = undefined;
      }, duration);
    }
  }

  function setComposerText(composer, text) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const prototype = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(composer, text);
      else composer.value = text;
    } else {
      composer.textContent = text;
    }
    try {
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text
      }));
    } catch {
      composer.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    composer.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function buttonLabel(button) {
    return [
      button.getAttribute('aria-label'),
      button.getAttribute('title'),
      button.getAttribute('data-tooltip'),
      button.textContent
    ].filter(Boolean).join(' ').trim();
  }

  function isSendButton(button, composer) {
    if (!(button instanceof HTMLElement) || !composer) return false;
    const buttonRect = visibleRect(button);
    const inputRect = visibleRect(composer);
    if (!buttonRect || !inputRect) return false;
    const label = buttonLabel(button);
    if (/^(?:send\b|发送)/i.test(label)) return buttonRect.top >= inputRect.top - 90 && buttonRect.bottom <= inputRect.bottom + 90;
    return false;
  }

  function findSendButton(composer) {
    const candidates = queryAll('button,[role="button"]')
      .filter((element) => isSendButton(element, composer));
    candidates.sort((left, right) => {
      const leftLabel = /\b(?:send|submit)\b|发送/i.test(buttonLabel(left)) ? 1 : 0;
      const rightLabel = /\b(?:send|submit)\b|发送/i.test(buttonLabel(right)) ? 1 : 0;
      return rightLabel - leftLabel;
    });
    return candidates[0] instanceof HTMLElement ? candidates[0] : null;
  }

  function sendTranslatedComposer() { return false; }

  window.__biTalksGoogleVoiceCanSend = id => {
    const attempt = state.outgoingAttempt;
    const active = document.activeElement;
    return Boolean(attempt && attempt.id === id && preferencesEnabled() && location.href === attempt.url && composerFromTarget(attempt.composer) && composerText(attempt.composer) === attempt.translated && (active === attempt.composer || attempt.composer.contains(active)));
  };
  function preferencesEnabled() { return state.preferences.enabled && location.hostname === 'voice.google.com'; }
  window.__biTalksGoogleVoiceSendResult = (id, dispatched) => {
    const attempt = state.outgoingAttempt;
    if (!attempt || attempt.id !== id) return;
    clearTimeout(attempt.timer);
    state.outgoingAttempt = null;
    state.allowProgrammaticSend = false;
    showOutgoingStatus(dispatched ? '已触发发送，请查看 Google Voice 的消息发送状态。' : '未能确认发送，请检查输入框和消息状态后重试。', dispatched ? 'progress' : 'error', 3500);
  };

  function requestOutgoingTranslation(composer) {
    if (!preferencesEnabled() || !composerFromTarget(composer)) return false;
    const text = composerText(composer);
    if (!text || !hanPattern.test(text)) return false;
    if (state.outgoingPending) return true;
    const id = 'gvs' + Date.now().toString(36) + (++state.sequence).toString(36);
    const request = { kind: 'outgoing', composer, text, url: location.href };
    state.outgoingPending = request;
    state.pending.set(id, request);
    request.timer = setTimeout(() => window.__biTalksGoogleVoiceTranslationError(id), 45000);
    showOutgoingStatus('正在翻译中…');
    try { window.chrome.webview.postMessage('translate\t' + id + '\ten\t' + btoa(unescape(encodeURIComponent(text)))); }
    catch { window.__biTalksGoogleVoiceTranslationError(id); }
    return true;
  }
  function backgroundIsVisible(style) {
    const value = style.backgroundColor || '';
    if (!value || value === 'transparent') return false;
    const alpha = value.match(/rgba?\([^)]*(?:,|\/)\s*([\d.]+)\s*\)$/i);
    return !alpha || Number(alpha[1]) > 0.08;
  }

  function radius(style) {
    return Math.max(
      Number.parseFloat(style.borderTopLeftRadius) || 0,
      Number.parseFloat(style.borderTopRightRadius) || 0,
      Number.parseFloat(style.borderBottomLeftRadius) || 0,
      Number.parseFloat(style.borderBottomRightRadius) || 0
    );
  }

  function originalText(bubble) {
    const clone = bubble.cloneNode(true);
    clone.querySelectorAll(translationSelector).forEach((node) => node.remove());
    return (clone.innerText || clone.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function likelyMessageBubble(element, rect, composer) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.matches('button,input,textarea,[role="button"],[role="menuitem"],[role="tab"],[role="textbox"]')) return false;
    if (element.closest('header,nav,[role="navigation"],[role="dialog"],[role="menu"]')) return false;
    if (rect.top < 95 || rect.bottom >= composer.top + 3) return false;
    if (rect.left < Math.max(composer.left - 90, innerWidth * 0.39)) return false;
    if (rect.width > innerWidth * 0.76 || rect.height > Math.max(520, innerHeight * 0.7)) return false;
    const style = getComputedStyle(element);
    if (!backgroundIsVisible(style) || radius(style) < 8) return false;
    const text = originalText(element);
    if (!text || text.length > 6000) return false;
    if (/^(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun).*)$/i.test(text)) return false;
    return true;
  }

  function findBubbles() {
    const explicit = queryAll('.message-row .subject-content-container.bubble')
      .filter((element) => element instanceof HTMLElement && visibleRect(element) && originalText(element));
    if (explicit.length) return explicit;

    const composer = composerRect();
    const fallback = [];
    queryAll('.message-row .bubble').forEach((element) => {
      const rect = visibleRect(element);
      if (!rect || !likelyMessageBubble(element, rect, composer)) return;
      fallback.push(element);
    });
    return fallback;
  }

  function applyTranslation(bubble, translated, sourceKey) {
    if (!bubble.isConnected || !state.preferences.enabled) return false;
    const currentText = originalText(bubble);
    if (currentText !== sourceKey) return false;
    let node = bubble.querySelector(translationSelector);
    if (!(node instanceof HTMLElement)) {
      node = document.createElement('div');
      node.dataset.biTalksGoogleVoiceTranslation = 'true';
      node.style.boxSizing = 'border-box';
      node.style.display = 'block';
      node.style.flex = '0 0 100%';
      node.style.width = '100%';
      node.style.maxWidth = '100%';
      node.style.marginTop = '6px';
      node.style.padding = '6px 8px';
      node.style.borderTop = '1px solid rgba(255,255,255,.18)';
      node.style.borderRadius = '7px';
      node.style.background = 'rgba(0,0,0,.84)';
      node.style.lineHeight = '1.35';
      node.style.whiteSpace = 'pre-wrap';
      node.style.overflowWrap = 'anywhere';
      node.style.userSelect = 'text';
      const bubbleStyle = getComputedStyle(bubble);
      if (bubbleStyle.display === 'flex' || bubbleStyle.display === 'inline-flex') bubble.style.flexWrap = 'wrap';
      bubble.appendChild(node);
    }
    node.style.color = state.preferences.color;
    node.style.fontSize = `${state.preferences.size}px`;
    if (node.textContent !== translated) node.textContent = translated;
    bubble.dataset.biTalksGoogleVoiceSource = sourceKey;
    bubble.dataset.biTalksGoogleVoiceState = 'done';
    return true;
  }

  function requestTranslation(bubble) {
    if (!state.preferences.enabled) return;
    const cachedText = originalText(bubble);
    if (translationCache.has(cachedText)) { applyTranslation(bubble, translationCache.get(cachedText), cachedText); return; }
    if (Number(bubble.dataset.biTalksRetryAfter || 0) > Date.now()) return;
    if (Number(bubble.dataset.biTalksFailures || 0) >= 3) return;
    if (Array.from(state.pending.values()).filter(request => request.kind === 'incoming').length >= 2) return;
    const text = originalText(bubble);
    if (!text) return;
    if (bubble.dataset.biTalksGoogleVoiceState === 'pending' && bubble.dataset.biTalksGoogleVoiceSource === text) return;
    if (bubble.dataset.biTalksGoogleVoiceState === 'done' && bubble.dataset.biTalksGoogleVoiceSource === text && bubble.querySelector(translationSelector)) return;
    const id = `gv${Date.now().toString(36)}${(++state.sequence).toString(36)}`;
    bubble.dataset.biTalksGoogleVoiceState = 'pending';
    bubble.dataset.biTalksGoogleVoiceSource = text;
    state.pending.set(id, { kind: 'incoming', bubble, text, timer: setTimeout(() => window.__biTalksGoogleVoiceTranslationError(id), 45000) });
    applyTranslation(bubble, '正在翻译…', text);
    bubble.dataset.biTalksGoogleVoiceState = 'pending';
    const target = hanPattern.test(text) ? 'en' : 'zh';
    const encoded = btoa(unescape(encodeURIComponent(text)));
    window.chrome.webview.postMessage(`translate\t${id}\t${target}\t${encoded}`);
  }

  function unreadValue(text) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const match = normalized.match(/(\d{1,4})\s*(?:unread|new)\s*(?:messages?|conversations?)?/i)
      || normalized.match(/(?:unread|new)\s*(\d{1,4})/i)
      || normalized.match(/(\d{1,4})\s*条(?:未读|新)消息/u)
      || normalized.match(/^[([]?(\d{1,4})[)\]]?$/);
    const value = Number(match?.[1] || 0);
    return Number.isFinite(value) ? Math.min(999, Math.max(0, Math.round(value))) : 0;
  }

  function titleUnreadCount() {
    const title = String(document.title || '').replace(/\s+/g, ' ').trim();
    const match = title.match(/^\((\d{1,4})\)\s*/)
      || title.match(/^\[(\d{1,4})\]\s*/)
      || title.match(/^(\d{1,4})\s+(?:unread|new)\b/i)
      || title.match(/(?:unread|new)\s+(\d{1,4})\b/i);
    return Math.min(999, Math.max(0, Number(match?.[1] || 0)));
  }

  function domUnreadCount() {
    const rowCounts = new Map();
    queryAll('[aria-label*="unread" i],[aria-label*="new message" i],[data-unread="true"],[data-is-unread="true"],[class~="unread"],[class*="unread-badge" i]')
      .forEach((marker) => {
        if (!(marker instanceof HTMLElement) || marker.closest('[data-bi-talks-google-voice-ui],[data-bi-talks-google-voice-translation]')) return;
        const rect = visibleRect(marker);
        if (!rect || rect.left > innerWidth * 0.52) return;
        const row = marker.closest('[role="listitem"],[role="row"],li,[data-thread-id],[class*="conversation" i]');
        // Google Voice also exposes page-level "Unread" controls. They are
        // filters/actions rather than unread conversations and must never
        // create an account badge on their own.
        if (!row) return;
        const signature = [marker.getAttribute('aria-label'), marker.getAttribute('title'), marker.textContent].filter(Boolean).join(' ');
        const value = unreadValue(signature) || 1;
        rowCounts.set(row, Math.max(rowCounts.get(row) || 0, value));
      });
    const rowTotal = [...rowCounts.values()].reduce((sum, value) => sum + value, 0);
    return Math.min(999, rowTotal);
  }

  function reportUnread() {
    if (window.__biTalksUnifiedUnreadInstalled) return;
    if (!location.hostname.endsWith('voice.google.com')) return;
    const now = Date.now();
    const titleCount = titleUnreadCount();
    const domCount = domUnreadCount();
    const trustedWindow = now - state.lastTrustedUnreadInteraction < 3500;
    if (!trustedWindow) state.trustedUnreadCeiling = undefined;
    const rawCount = Math.max(titleCount, domCount);
    const count = trustedWindow && state.trustedUnreadCeiling !== undefined
      ? Math.min(rawCount, state.trustedUnreadCeiling)
      : rawCount;
    if (count !== state.unreadCandidate) {
      state.unreadCandidate = count;
      state.unreadCandidateSince = now;
      if (state.unreadStabilityTimer) clearTimeout(state.unreadStabilityTimer);
      state.unreadStabilityTimer = undefined;
    }
    const stableFor = state.lastUnread < 0 ? 700
      : count < state.lastUnread ? (trustedWindow ? 80 : 650)
        : count > state.lastUnread ? 220 : 0;
    const remaining = stableFor - (now - state.unreadCandidateSince);
    if (remaining > 0) {
      if (!state.unreadStabilityTimer) {
        state.unreadStabilityTimer = setTimeout(() => {
          state.unreadStabilityTimer = undefined;
          reportUnread();
        }, remaining + 20);
      }
      return;
    }
    if (state.unreadStabilityTimer) clearTimeout(state.unreadStabilityTimer);
    state.unreadStabilityTimer = undefined;
    const trustedDecrease = state.lastUnread >= 0 && count < state.lastUnread && trustedWindow;
    const key = `${titleCount}:${domCount}:${count}:${trustedDecrease}`;
    if (key === state.lastUnreadReport) return;
    state.lastUnreadReport = key;
    state.lastUnread = count;
    window.chrome.webview.postMessage(`unread\t${count}\t${trustedDecrease ? 'true' : 'false'}`);
  }

  function scheduleUnread() {
    if (state.unreadScheduled) return;
    state.unreadScheduled = true;
    setTimeout(() => {
      state.unreadScheduled = false;
      reportUnread();
    }, 120);
  }

  function scan() {
    state.scheduled = false;
    if (!state.preferences.enabled || document.visibilityState !== 'visible' || !location.hostname.endsWith('voice.google.com')) return;
    const bubbles = findBubbles();
    for (const [id, request] of state.pending) {
      if (request.kind === 'incoming' && (!request.bubble.isConnected || originalText(request.bubble) !== request.text)) { clearTimeout(request.timer); state.pending.delete(id); }
    }
    bubbles.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom).forEach(requestTranslation);
  }

  function scheduleScan() {
    if (state.scheduled) return;
    state.scheduled = true;
    setTimeout(scan, 220);
  }

  function observeRoots() {
    roots().forEach((root) => {
      if (observedRoots.has(root)) return;
      observedRoots.add(root);
      new MutationObserver(() => {
        observeRoots();
        scheduleScan();
        scheduleUnread();
      }).observe(root, { childList: true, subtree: true });
    });
  }

  window.__biTalksGoogleVoiceTranslationResult = (id, encoded, partial = false) => {
    const request = state.pending.get(id);
    if (partial || !request) return;
    let translated;
    try { translated = decodeURIComponent(escape(atob(encoded))).trim(); } catch { window.__biTalksGoogleVoiceTranslationError(id); return; }
    if (!translated) { window.__biTalksGoogleVoiceTranslationError(id); return; }
    clearTimeout(request.timer); state.pending.delete(id); scheduleScan();
    if (request.kind === 'outgoing') {
      if (state.outgoingPending === request) state.outgoingPending = null;
      if (!sendTranslatedComposer(request.composer, translated, request.text, request.url))
        showOutgoingStatus('输入内容或聊天已变化，未自动发送。', 'progress', 2600);
      return;
    }
    translationCache.set(request.text, translated);
    if (translationCache.size > 2000) translationCache.delete(translationCache.keys().next().value);
    if (originalText(request.bubble) === request.text) {
      request.bubble.dataset.biTalksFailures = '0';
      applyTranslation(request.bubble, translated, request.text);
    }
  };
  window.__biTalksGoogleVoiceTranslationError = (id) => {
    const request = state.pending.get(id);
    clearTimeout(request?.timer);
    state.pending.delete(id);
    if (request?.kind === 'outgoing') {
      if (state.outgoingPending === request) state.outgoingPending = null;
      showOutgoingStatus('翻译失败，消息未发送。', 'error', 2600);
    } else if (request?.bubble && originalText(request.bubble) === request.text) {
      request.bubble.dataset.biTalksGoogleVoiceState = '';
      request.bubble.querySelector(translationSelector)?.remove();
      const failures = Number(request.bubble.dataset.biTalksFailures || 0) + 1;
      request.bubble.dataset.biTalksFailures = String(failures);
      request.bubble.dataset.biTalksRetryAfter = String(Date.now() + 10000 * failures);
      if (failures >= 3) {
        applyTranslation(request.bubble, '翻译失败，点击重试', request.text);
        const node = request.bubble.querySelector(translationSelector);
        if (node) { node.style.cursor = 'pointer'; node.onclick = () => { node.remove(); request.bubble.dataset.biTalksFailures = '0'; request.bubble.dataset.biTalksRetryAfter = '0'; request.bubble.dataset.biTalksGoogleVoiceState = ''; scheduleScan(); }; }
      }
    }
  };


  const installTwoStepTranslation = function installTwoStepTranslation(options) {
  const version = options.platform === 'telegram' ? 'two-step-context-v12' : 'two-step-han-v13';
  const old = window.__biTalksTwoStepTranslation;
  if (old?.version === version) return old;
  old?.destroy();
  const abort = new AbortController();
  const drafts = new Map();
  let composing = false, enterHeld = false, blockEnterCycle = false, pointerBlocked = false;
  let sequence = 0, statusTimer, statusEditor;
  const positionStatus = () => {
    const node=document.getElementById('bi-talks-two-step-status');
    if(!node || !statusEditor?.isConnected)return;
    const rect=statusEditor.getBoundingClientRect();
    node.style.left=(rect.left+rect.width/2)+'px';
    node.style.top=(rect.top-10)+'px';
    node.style.maxWidth=Math.max(80,rect.width-16)+'px';
  };
  const statusResizeObserver=new ResizeObserver(positionStatus);
  const sendTimers = new Set();
  const emptyAfterSend = editor => !editor.isConnected || !textOf(editor).replace(/[\s\u200b\u200c\u200d\ufeff]/gu,'');
  const clearStatus = () => { clearTimeout(statusTimer); statusResizeObserver.disconnect();statusEditor=undefined; document.getElementById('bi-talks-two-step-status')?.remove(); };
  const normalize = text => String(text || '').replace(/\r\n?/g, '\n');
  const textOf = editor => {
    if ('value' in editor) return normalize(editor.value);
    const inline = node => {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1) return '';
      if (node.tagName === 'BR') return '\n';
      if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
      return [...node.childNodes].map(inline).join('');
    };
    const blocks = [...editor.childNodes];
    if (blocks.length && blocks.every(n => n.nodeType === 1 && /^(P|DIV|LI)$/.test(n.tagName))) {
      return normalize(blocks.map(block => {
        if (block.childNodes.length === 1 && block.firstChild.nodeName === 'BR') return '';
        return inline(block);
      }).join('\n'));
    }
    return normalize(inline(editor));
  };
  // English letters plus numbers, punctuation, whitespace and emoji need no translation.
  const isEnglish = text => /[A-Za-z]/u.test(text) && !/[^\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\p{Separator}\p{Mark}\s\u200d\ufe0f]/u.test(text);
  const translatePreservingLayout = async (source, valid) => {
    if(!valid())throw Error('输入内容或聊天已变化');
    const result=await options.translate('__BITALKS_LAYOUT_CONTEXT_V2__'+JSON.stringify(source));
    if(!valid())throw Error('输入内容或聊天已变化');
    return String(result);
  };
  const suppress = event => { event.preventDefault(); event.stopImmediatePropagation(); event.stopPropagation(); };
  const origin = event => event.composedPath?.().find(item => item instanceof Element) || event.target;
  const visible = editor => editor.isConnected && editor.getBoundingClientRect().width > 0 && editor.getBoundingClientRect().height > 0;
  const editorFor = element => {
    if (!(element instanceof Element)) return null;
    const editor = element.closest('textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]');
    if (!editor || !visible(editor)) return null;
    const label = [editor.getAttribute('aria-label'),editor.getAttribute('placeholder'),editor.getAttribute('data-testid'),editor.className,editor.id].join(' ');
    if (/search|password|email|username|搜索|查找|密码|账号|用户名|备注/i.test(label)) return null;
    if (editor.matches('input') && !/message|caption|消息|说明/i.test(label)) return null;
    if (options.platform === 'whatsapp' && !editor.closest('#main,[role="dialog"],[data-animate-modal-popup="true"],[data-testid*="media" i],[class*="caption" i]')) return null;
    if (options.platform === 'signal' && !editor.closest('[class*="Composition" i],[class*="composer" i],[class*="caption" i],[role="dialog"],[class*="attachment" i]') && !/message|消息|caption|说明|compose/i.test(label)) return null;
    if (options.platform === 'telegram' && !editor.closest('.chat-input,.input-message-container,[class*="composer" i],[class*="caption" i],[class*="popup" i]') && !/message|caption|消息|说明/i.test(label)) return null;
    if (options.platform === 'zoom' && !editor.closest('[class*="chat" i],[role="dialog"]') && !/message|chat|消息|聊天/i.test(label)) return null;
    if (/^google/.test(options.platform) && !/message|消息|caption|说明/i.test(label) && !editor.matches('[contenteditable="true"][role="textbox"],[g_editable="true"]')) return null;
    return editor;
  };
  const sendControl = element => {
    const button = element?.closest?.('button,[role="button"],input[type="submit"]');
    if (!button) return null;
    const icon = button.querySelector('[data-icon],[data-testid]');
    const label = [button.getAttribute('aria-label'),button.getAttribute('title'),button.getAttribute('data-testid'),button.getAttribute('data-tooltip'),button.className,icon?.getAttribute('data-icon'),icon?.getAttribute('data-testid'),button.textContent].join(' ');
    return /(?:^|[\s_-])send(?:$|[\s_-])|sendbutton|sendmessage|发送/i.test(label) && !/schedule|定时/i.test(label) ? button : null;
  };
  const activeEditor = button => {
    const focused = editorFor(document.activeElement);
    if (focused) return focused;
    const editors = [...document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]')].map(editorFor).filter(Boolean);
    if (!button) return editors.length === 1 ? editors[0] : null;
    const rect = button.getBoundingClientRect();
    return editors.sort((a,b) => Math.abs(a.getBoundingClientRect().bottom-rect.bottom)-Math.abs(b.getBoundingClientRect().bottom-rect.bottom))[0] || null;
  };
  const context = editor => {
    const scope = editor.closest('[data-conversation-id],[data-peer-id],[data-thread-id],[data-space-id]');
    const header = document.querySelector('#main header,.module-conversation-header,.ChatHeader,.chat-info-wrapper,[data-conversation-id][aria-selected="true"]');
    return location.href + '|' + (scope?.getAttribute('data-conversation-id') || scope?.getAttribute('data-peer-id') || scope?.getAttribute('data-thread-id') || scope?.getAttribute('data-space-id') || '') + '|' + (header?.textContent || '');
  };
  const status = (message, editor) => {
    clearTimeout(statusTimer);
    statusResizeObserver.disconnect();statusEditor=editor;
    if(editor)statusResizeObserver.observe(editor);
    let node = document.getElementById('bi-talks-two-step-status');
    if (!node) {
      node = document.createElement('div');node.id='bi-talks-two-step-status';node.setAttribute('role','status');
      Object.assign(node.style,{position:'fixed',transform:'translate(-50%, -100%)',textAlign:'center',boxSizing:'border-box',width:'max-content',zIndex:'2147483647',padding:'9px 13px',background:'#365fc9',color:'#fff',borderRadius:'9px',font:'600 13px system-ui',pointerEvents:'none'});
      document.body?.appendChild(node);
    }
    node.textContent=message;
    positionStatus();
  };
  const current = job => drafts.get(job.editor) === job && job.editor.isConnected && context(job.editor) === job.context && options.enabled();
  const select = editor => {
    editor.focus();
    if ('value' in editor) editor.select();
    else { const range=document.createRange();range.selectNodeContents(editor);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range); }
  };
  const defaultWrite = async (editor, translated, valid) => {
    if (!valid()) return false;
    select(editor);
    if ('value' in editor) {
      const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(editor,translated);
      editor.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:translated}));
    } else {
      const escaped = translated.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/ /g,'&nbsp;').replace(/\n/g,'<br>');
      const structured = editor.matches('[data-lexical-editor="true"],.ProseMirror,.ql-editor') || [...editor.children].some(n => n.tagName === 'P');
      const html = structured ? escaped.split('<br>').map(line => '<p>'+(line || '<br>')+'</p>').join('') : escaped;
      if (!document.execCommand('insertHTML',false,html)) return false;
    }
    await new Promise(resolve=>setTimeout(resolve,40));
    return textOf(editor).replace(/\u00a0/g,' ') === normalize(translated).replace(/\u00a0/g,' ');
  };
  const begin = (editor, previous) => {
    const job={editor,source:textOf(editor),context:context(editor),phase:'translating',id:++sequence,translated:'',writing:false};
    drafts.set(editor,job);status('正在翻译，请稍候…',editor);
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('翻译超时')),45000);});
    void Promise.race([Promise.resolve().then(()=>translatePreservingLayout(job.source,()=>current(job)&&textOf(editor)===job.source)),timeout]).then(async result=>{
      const translated=normalize(result);
      if (!current(job) || textOf(editor)!==job.source) return;
      if (!translated) throw Error('译文为空');
      if (strictChinese && containsChinese(translated)) throw Error('译文仍含中文，请修改后重试');
      job.translated=translated;job.phase='inserting';job.writing=true;
      const valid=()=>current(job) && textOf(editor)===job.source;
      const ok=await (options.write || defaultWrite)(editor,translated,valid,select);
      job.writing=false;
      if (!current(job)) return;
      if (!ok || textOf(editor).replace(/\u00a0/g,' ')!==translated.replace(/\u00a0/g,' ')) throw Error('译文未完整写入输入框');
      job.translated=textOf(editor);
      job.phase='ready';status('已翻译，请确认输入框中的译文，再按一次回车发送。',editor);
    }).catch(error=>{
      if (!current(job)) return;
      job.phase='failed';job.writing=false;status((error?.message || '翻译失败')+'，未发送。请再次按回车重试。',editor);
    }).finally(()=>clearTimeout(timer));
  };
  const strictChinese = options.platform !== 'telegram';
  const containsChinese = text => /\p{Script=Han}/u.test(text);
  let imeEnter = false;
  const attempt = editor => {
    if (!syncPreferences()) return false;
    const text=textOf(editor);if(!text.trim())return false;
    const job=drafts.get(editor);
    if(job && !current(job)) drafts.delete(editor);
    const active=drafts.get(editor);
    if(active && ['translating','inserting','sending'].includes(active.phase)) return true;
    if(active?.phase==='ready' && text===active.translated && (!strictChinese || !containsChinese(text))) {
      active.phase='sending';status('已提交发送，请以聊天窗口的发送状态为准。',editor);
      const started=Date.now();
      const timer=setInterval(()=>{
        if(drafts.get(editor)!==active) {clearInterval(timer);sendTimers.delete(timer);return;}
        if(emptyAfterSend(editor) || context(editor)!==active.context) {
          drafts.delete(editor);clearStatus();clearInterval(timer);sendTimers.delete(timer);return;
        }
        if(Date.now()-started>=8000) {
          active.phase='ready';clearStatus();clearInterval(timer);sendTimers.delete(timer);
        }
      },100);
      sendTimers.add(timer);
      return false;
    }
    // A previously translated but edited draft must be reviewed again, including English edits.
    if (isEnglish(text)) { drafts.delete(editor); return false; }
    begin(editor,active);return true;
  };
  const on = (type,handler) => window.addEventListener(type,handler,{capture:true,signal:abort.signal});
  on('resize',positionStatus);on('scroll',positionStatus);
  on('compositionstart',()=>{composing=true;});on('compositionend',()=>{composing=false;});
  on('keydown',event=>{
    if (!syncPreferences()) return;
    if(event.key!=='Enter')return;
    const editor=editorFor(origin(event));
    if(event.isComposing || composing || event.keyCode===229){if(strictChinese && editor){imeEnter=true;event.stopImmediatePropagation();event.stopPropagation();}return;}
    if(imeEnter){imeEnter=false;}
    if(event.shiftKey)return;
    if(!editor)return;
    if(enterHeld || event.repeat){if(blockEnterCycle || drafts.has(editor) || (options.enabled() && textOf(editor)))suppress(event);return;}
    enterHeld=true;
    blockEnterCycle=attempt(editor);
    if(blockEnterCycle)suppress(event);
  });
  on('keypress',event=>{if(strictChinese && imeEnter && event.key==='Enter'){event.stopImmediatePropagation();event.stopPropagation();return;}if(syncPreferences() && event.key==='Enter' && blockEnterCycle)suppress(event);});
  on('keyup',event=>{if(strictChinese && imeEnter && event.key==='Enter'){imeEnter=false;enterHeld=false;blockEnterCycle=false;event.stopImmediatePropagation();event.stopPropagation();return;}if(!syncPreferences())return;if(event.key==='Enter'){if(blockEnterCycle)suppress(event);enterHeld=false;blockEnterCycle=false;}});
  on('pointerdown',event=>{
    const button=sendControl(origin(event));pointerBlocked=false;
    if(button){const editor=activeEditor(button);if(editor){const j=drafts.get(editor);pointerBlocked=options.enabled() && (!!j || !!textOf(editor));if(pointerBlocked)suppress(event);}return;}
    const target=origin(event);
    for(const [editor,job] of drafts){if(!editor.contains(target) && target!==editor){drafts.delete(editor);}}
  });
  on('click',event=>{
    const button=sendControl(origin(event));if(!button)return;
    const editor=activeEditor(button);if(!editor){if(pointerBlocked)suppress(event);pointerBlocked=false;return;}
    // The actual click is the single intent; pointerdown never starts or confirms a request.
    if(attempt(editor))suppress(event);pointerBlocked=false;
  });
  on('input',event=>{
    const editor=editorFor(origin(event)),job=drafts.get(editor);if(!job || job.writing)return;
    if(job.phase==='sending') {
      if(emptyAfterSend(editor)){drafts.delete(editor);clearStatus();return;}
      if(textOf(editor)===job.translated)return;
      clearStatus();
    }
    drafts.set(editor,{editor,context:context(editor),phase:'edited'});
  });
  const cancel=()=>{drafts.clear();pointerBlocked=false;for(const timer of sendTimers)clearInterval(timer);sendTimers.clear();clearStatus();};
  on('blur',event=>{if(event.target===window)cancel();});on('hashchange',cancel);on('pagehide',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')cancel();},{signal:abort.signal});
  let lastEnabled=!!options.enabled();
  const syncPreferences=()=>{const enabled=!!options.enabled();if(!enabled || enabled!==lastEnabled){cancel();enterHeld=false;blockEnterCycle=false;pointerBlocked=false;}lastEnabled=enabled;return enabled;};
  const preferenceObserver=new MutationObserver(syncPreferences);
  preferenceObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  const preferenceTimer=setInterval(syncPreferences,100);
  const controller={version,platform:options.platform,syncPreferences,destroy(){preferenceObserver.disconnect();clearInterval(preferenceTimer);abort.abort();cancel();document.getElementById('bi-talks-two-step-status')?.remove();},inspect(){return [...drafts.values()].map(j=>({phase:j.phase}));}};
  window.__biTalksTwoStepTranslation=controller;
  return controller;
};
  const twoStepRequests = new Map(); let twoStepSequence = 0;
  const oldResult = window.__biTalksGoogleVoiceTranslationResult;
  const oldError = window.__biTalksGoogleVoiceTranslationError;
  window.__biTalksGoogleVoiceTranslationResult = (id,encoded,partial=false) => {
    if (!String(id).startsWith('gvtwostep')) return oldResult?.(id,encoded,partial);
    if (partial) return;
    const request=twoStepRequests.get(id);if(!request)return;
    clearTimeout(request.timer);twoStepRequests.delete(id);
    try { request.resolve(decodeURIComponent(escape(atob(encoded)))); } catch(error) {request.reject(error);}
  };
  window.__biTalksGoogleVoiceTranslationError = id => {
    if (!String(id).startsWith('gvtwostep')) return oldError?.(id);
    const request=twoStepRequests.get(id);if(!request)return;
    clearTimeout(request.timer);twoStepRequests.delete(id);request.reject(new Error('翻译失败'));
  };
  installTwoStepTranslation({platform:'googlevoice',enabled:()=>preferencesEnabled(),translate:text=>new Promise((resolve,reject)=>{
    const id='gvtwostep'+Date.now()+'x'+(++twoStepSequence);
    const timer=setTimeout(()=>{twoStepRequests.delete(id);reject(new Error('翻译超时'));},40000);
    twoStepRequests.set(id,{resolve,reject,timer});
    try {window.chrome.webview.postMessage('translate\t'+id+'\ten\t'+btoa(unescape(encodeURIComponent(text))));}
    catch(error){clearTimeout(timer);twoStepRequests.delete(id);reject(error);}
  })});
  addEventListener('pointerdown', (event) => {
    const origin = event.composedPath().find((item) => item instanceof Element);
    const row = origin?.closest?.('[role="listitem"],[role="row"],li,[data-thread-id],[class*="conversation" i]');
    const markers = row?.querySelectorAll?.('[aria-label*="unread" i],[aria-label*="new message" i],[data-unread="true"],[data-is-unread="true"],[class~="unread"],[class*="unread-badge" i]');
    if (!markers?.length) return;
    const clickedUnread = Math.max(1, ...[...markers].map((marker) => unreadValue([
      marker.getAttribute?.('aria-label'), marker.getAttribute?.('title'), marker.textContent
    ].filter(Boolean).join(' ')) || 1));
    state.lastTrustedUnreadInteraction = Date.now();
    const current = state.lastUnread >= 0 ? state.lastUnread : Math.max(titleUnreadCount(), domUnreadCount());
    state.trustedUnreadCeiling = Math.max(0, current - clickedUnread);
    state.unreadCandidate = -1;
    scheduleUnread();
    setTimeout(scheduleUnread, 420);
  }, true);

  window.__biTalksGoogleVoiceTranslationPreferences = (enabled, color, size) => {
    state.preferences.enabled = Boolean(enabled);
    window.__biTalksTwoStepTranslation?.syncPreferences?.();
    if(!state.preferences.enabled){translationCache.clear();state.pending.forEach(item=>clearTimeout(item.timer));state.pending.clear();state.outgoingPending=null;}
    state.preferences.color = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#d8ff00';
    state.preferences.size = Math.max(10, Math.min(24, Number(size) || 15));
    queryAll(translationSelector).forEach((node) => {
      if (!state.preferences.enabled) {
        node.remove();
        return;
      }
      node.style.color = state.preferences.color;
      node.style.fontSize = `${state.preferences.size}px`;
    });
    if (state.preferences.enabled) scheduleScan();
  };

  observeRoots();
  addEventListener('scroll', scheduleScan, true);
  addEventListener('resize', scheduleScan, { passive: true });
  scheduleScan();
  scheduleUnread();
  setInterval(reportUnread, 1400);
  setInterval(scheduleScan, 2000);
  setTimeout(scheduleScan, 6500);
})();
