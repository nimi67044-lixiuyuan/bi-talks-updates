(function installGoogleChatTranslation() {
  if (!document.documentElement) { addEventListener('DOMContentLoaded', installGoogleChatTranslation, { once: true }); return; }
  // Never inspect Google account/password pages or other Google products.
  const isChat = () => location.hostname === 'chat.google.com' ||
    (location.hostname === 'mail.google.com' && location.pathname.startsWith('/chat/'));
  if (!isChat() || window.__biTalksGoogleChatInstalled) return;
  window.__biTalksGoogleChatInstalled = true;
  const mark = '[data-bitalks-chat-translation]';
  const bodySelector = '[data-message-id] .DTp27d,[data-message-id] [data-message-text],.DTp27d';
  const composerSelector = '[contenteditable="true"][role="textbox"],[contenteditable="true"][g_editable="true"],textarea[aria-label*="message" i],textarea[aria-label*="消息"]';
  const han = /[\u3400-\u9fff]/;
  const pending = new Map();
  const cache = new Map();
  const nodes = new WeakMap();
  let preferences = { enabled: true, color: '#d8ff00', size: 15 };
  let sequence = 0, timer, composing = false, outgoing;
  const encode = text => btoa(unescape(encodeURIComponent(text)));
  const decode = text => decodeURIComponent(escape(atob(text)));
  const textOf = element => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(mark + ',[role="button"],button,time,img,video,audio').forEach(n => n.remove());
    return (clone.innerText || clone.textContent || '').replace(/\u00a0/g, ' ').trim();
  };
  const visible = element => {
    const rect = element.getBoundingClientRect();
    return element.isConnected && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && getComputedStyle(element).visibility !== 'hidden';
  };
  function status(text) {
    let node = document.getElementById('bitalks-chat-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'bitalks-chat-status';
      node.setAttribute('role', 'status');
      node.style.cssText = 'position:fixed;bottom:85px;right:24px;z-index:2147483647;background:#263447;color:white;padding:9px 14px;border-radius:9px;font:13px system-ui;pointer-events:none';
      document.body.append(node);
    }
    node.textContent = text;
    clearTimeout(node.dismissTimer);
    node.dismissTimer = setTimeout(() => node.remove(), 4500);
  }
  function render(element, text, source) {
    if (!element.isConnected || !preferences.enabled || textOf(element) !== source) return;
    let node = element.querySelector(mark);
    if (!node) {
      node = document.createElement('div');
      node.setAttribute('data-bitalks-chat-translation', 'true');
      node.style.cssText = 'display:block;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.4';
      element.append(node);
    }
    if (node.textContent !== text) node.textContent = text;
    node.style.color = preferences.color;
    node.style.fontSize = preferences.size + 'px';
    nodes.set(element, source);
  }
  function request(item, target) {
    const id = 'gc' + Date.now().toString(36) + (++sequence).toString(36);
    item.url = location.href;
    item.timer = setTimeout(() => fail(id), 45000);
    pending.set(id, item);
    try { window.chrome.webview.postMessage('translate\t' + id + '\t' + target + '\t' + encode(item.text)); }
    catch { fail(id); }
  }
  const candidates = new Set(), dirty = new WeakSet(), sources = new WeakMap();
  let scanQueue = [], scanIndex = 0, scanning = false, rescan = false;
  function collect(root) {
    if (!(root instanceof Element) || root.closest(mark)) return;
    const parent = root.closest(bodySelector);
    if (parent) { candidates.add(parent); dirty.add(parent); }
    if (root.matches(bodySelector)) { candidates.add(root); dirty.add(root); }
    for (const node of root.querySelectorAll(bodySelector)) { candidates.add(node); dirty.add(node); }
  }
  function scan() {
    timer = undefined;
    if (!isChat() || !preferences.enabled || document.visibilityState !== 'visible') { scanning=false;scanQueue=[];return; }
    if (!scanning) { scanQueue=[...candidates].reverse();scanIndex=0;scanning=true; }
    const until=performance.now()+4;
    let count=[...pending.values()].filter(x=>x.kind==='incoming').length, processed=0;
    while(scanIndex<scanQueue.length && processed++<20 && performance.now()<until) {
      const element=scanQueue[scanIndex++];
      if(!element.isConnected){candidates.delete(element);continue;}
      if(!dirty.has(element) && nodes.has(element) && element.querySelector(mark)) continue;
      if(!visible(element) || element.closest('[contenteditable="true"],nav,[role="navigation"],[role="menu"],[role="toolbar"]'))continue;
      let text=sources.get(element);
      if(dirty.has(element)||text===undefined){text=textOf(element);sources.set(element,text);dirty.delete(element);}
      if(!text || !/[a-z\u3400-\u9fff]/i.test(text))continue;
      if(nodes.get(element)!==text)element.querySelector(mark)?.remove();
      if(cache.has(text)){render(element,cache.get(text),text);continue;}
      if(Number(element.dataset.bitalksRetry||0)>Date.now())continue;
      if(count>=2 || [...pending.values()].some(x=>x.text===text))continue;
      count++;request({kind:'incoming',element,text},han.test(text)?'en':'zh');
    }
    if(scanIndex<scanQueue.length){timer=setTimeout(scan,16);return;}
    scanning=false;scanQueue=[];
    if(rescan){rescan=false;schedule();}
  }
  function schedule() { if(scanning){rescan=true;return;}if(!timer)timer=setTimeout(scan,120); }
  function composerFrom(target) {
    const element = target instanceof Element ? target.closest(composerSelector) : null;
    if (!element || !visible(element) || element.closest('[role="search"],nav')) return null;
    return element;
  }
  const composerText = element => (element instanceof HTMLTextAreaElement ? element.value : element.innerText || element.textContent || '').trim();
  function beginOutgoing(composer) {
    if (!preferences.enabled || !isChat()) return false;
    const text = composerText(composer);
    if (!text || !han.test(text)) return false;
    if (outgoing) return true;
    outgoing = { kind: 'outgoing', composer, text };
    status('正在翻译输入内容…');
    request(outgoing, 'en');
    return true;
  }
  function fail(id) {
    const item = pending.get(id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(id);
    if (item.kind === 'outgoing') {
      if (outgoing === item) outgoing = undefined;
      status('翻译失败，原文已保留，未发送。');
    } else if (item.element.isConnected) {
      item.element.dataset.bitalksRetry = String(Date.now() + 30000);
    }
    schedule();
  }
  // These callback names are the existing native host translation protocol.
  window.__biTalksGoogleVoiceTranslationResult = (id, encoded, partial = false) => {
    if (partial) return;
    const item = pending.get(id);
    if (!item) return;
    let translated;
    try { translated = decode(encoded).trim(); } catch { fail(id); return; }
    if (!translated) { fail(id); return; }
    clearTimeout(item.timer);
    pending.delete(id);
    if (item.kind === 'incoming') {
      cache.set(item.text, translated);
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      render(item.element, translated, item.text);
      schedule();
      return;
    }
    outgoing = undefined;
    const composer = item.composer;
    if (!preferences.enabled || !composer.isConnected || location.href !== item.url || composerText(composer) !== item.text) {
      status('输入内容已改变，未替换或发送。'); return;
    }
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(composer, translated);
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: translated }));
    } else {
      const range = document.createRange();
      range.selectNodeContents(composer);
      const selection = getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, translated)) {
        composer.textContent = translated;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: translated }));
      }
    }
    // Leave the translated draft for review; never send on a delayed network callback.
    status('已翻译为英文，确认后按 Enter 发送。');
  };
  window.__biTalksGoogleVoiceTranslationError = fail;
  window.__biTalksGoogleVoiceTranslationPreferences = (enabled, color, size) => {
    preferences = { enabled: Boolean(enabled), color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#d8ff00', size: Math.max(10, Math.min(24, Number(size) || 15)) };
    window.__biTalksTwoStepTranslation?.syncPreferences?.();
    if(!preferences.enabled){cache.clear();pending.forEach(item=>clearTimeout(item.timer));pending.clear();outgoing=undefined;document.getElementById('bitalks-chat-status')?.remove();}
    document.querySelectorAll(mark).forEach(node => {
      if (!preferences.enabled) node.remove();
      else { node.style.color = preferences.color; node.style.fontSize = preferences.size + 'px'; }
    });
    schedule();
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
      // Plain-text editing keeps native input events and avoids TrustedHTML sinks.
      if (!document.execCommand('insertText', false, translated)) return false;
      // Chromium may create mixed text/DIV paragraphs. Canonicalize only when
      // the existing layout reader cannot round-trip the native edit exactly.
      if (textOf(editor).replace(/\u00a0/g, ' ') !== translated.replace(/\u00a0/g, ' ')) {
        const fragment = document.createDocumentFragment();
        translated.split('\n').forEach((line, index) => {
          if (index) fragment.appendChild(document.createElement('br'));
          fragment.appendChild(document.createTextNode(line));
        });
        editor.replaceChildren(fragment);
        const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
        editor.dispatchEvent(new InputEvent('input', {bubbles:true,composed:true,inputType:'insertText',data:translated}));
      }
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
  const syncPreferences=()=>{const enabled=!!options.enabled();if(enabled!==lastEnabled){cancel();enterHeld=false;blockEnterCycle=false;pointerBlocked=false;}lastEnabled=enabled;return enabled;};
  const preferenceObserver=new MutationObserver(syncPreferences);
  preferenceObserver.observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  const preferenceTimer=setInterval(syncPreferences,1500);
  const controller={version,platform:options.platform,syncPreferences,destroy(){preferenceObserver.disconnect();clearInterval(preferenceTimer);abort.abort();cancel();document.getElementById('bi-talks-two-step-status')?.remove();},inspect(){return [...drafts.values()].map(j=>({phase:j.phase}));}};
  window.__biTalksTwoStepTranslation=controller;
  return controller;
};
  const twoStepRequests = new Map(); let twoStepSequence = 0;
  const oldResult = window.__biTalksGoogleVoiceTranslationResult;
  const oldError = window.__biTalksGoogleVoiceTranslationError;
  window.__biTalksGoogleVoiceTranslationResult = (id,encoded,partial=false) => {
    if (!String(id).startsWith('gctwostep')) return oldResult?.(id,encoded,partial);
    if (partial) return;
    const request=twoStepRequests.get(id);if(!request)return;
    clearTimeout(request.timer);twoStepRequests.delete(id);
    try { request.resolve(decodeURIComponent(escape(atob(encoded)))); } catch(error) {request.reject(error);}
  };
  window.__biTalksGoogleVoiceTranslationError = id => {
    if (!String(id).startsWith('gctwostep')) return oldError?.(id);
    const request=twoStepRequests.get(id);if(!request)return;
    clearTimeout(request.timer);twoStepRequests.delete(id);request.reject(new Error('翻译失败'));
  };
  installTwoStepTranslation({platform:'googlechat',enabled:()=>preferences.enabled,translate:text=>new Promise((resolve,reject)=>{
    const id='gctwostep'+Date.now()+'x'+(++twoStepSequence);
    const timer=setTimeout(()=>{twoStepRequests.delete(id);reject(new Error('翻译超时'));},40000);
    twoStepRequests.set(id,{resolve,reject,timer});
    try {window.chrome.webview.postMessage('translate\t'+id+'\ten\t'+btoa(unescape(encodeURIComponent(text))));}
    catch(error){clearTimeout(timer);twoStepRequests.delete(id);reject(error);}
  })});
  function start() {
    collect(document.body);
    new MutationObserver(changes => {
      let changed=false;
      for(const change of changes){
        const target=change.target instanceof Element?change.target:change.target.parentElement;
        if(!target || target.closest(mark+',#bi-talks-two-step-status,#bitalks-chat-status,[contenteditable="true"]'))continue;
        if(change.type==='characterData'){
          const message=target.closest(bodySelector);if(message){dirty.add(message);candidates.add(message);changed=true;}continue;
        }
        const affected=[...change.addedNodes,...change.removedNodes];
        if(affected.length && affected.every(n=>n instanceof Element && n.matches(mark)))continue;
        const message=target.closest(bodySelector);
        if(message){dirty.add(message);candidates.add(message);changed=true;}
        for(const node of change.addedNodes){if(node instanceof Element){const size=candidates.size;collect(node);if(candidates.size!==size)changed=true;}}
      }
      if(changed)schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule();
  }
  if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  addEventListener('visibilitychange', schedule);
  // Retry failures with a bounded cooldown even if the page stops mutating.
  setInterval(schedule, 5000);
})();
