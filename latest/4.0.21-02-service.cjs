"use strict";
const electron = require("electron");
const platform = process.argv.find((value) => value.startsWith("--service-platform="))?.split("=")[1] || "";
const accountId = process.argv.find((value) => value.startsWith("--service-account="))?.split("=")[1] || "";
electron.contextBridge.exposeInMainWorld("__biTalksReportUnread", (sample) => {
  if (sample && Number.isFinite(sample.count)) electron.ipcRenderer.send("service:unread", { ...sample, accountId });
});
const initialColor = process.argv.find((value) => value.startsWith("--translation-color="))?.slice("--translation-color=".length) || "#d8ff00";
const initialSize = Number(process.argv.find((value) => value.startsWith("--translation-size="))?.slice("--translation-size=".length) || "15");
const initialEnabled = process.argv.find((value) => value.startsWith("--translation-enabled="))?.slice("--translation-enabled=".length) !== "false";
if (platform === "whatsapp") {
  electron.contextBridge.executeInMainWorld({
    func: () => {
      const state = globalThis;
      if (state.__biTalksCachePutSerialized || typeof Cache === "undefined") return;
      state.__biTalksCachePutSerialized = true;
      const originalPut = Cache.prototype.put;
      const queues = /* @__PURE__ */ new WeakMap();
      Cache.prototype.put = function put(request, response) {
        let queue = queues.get(this);
        if (!queue) {
          queue = /* @__PURE__ */ new Map();
          queues.set(this, queue);
        }
        const key = typeof request === "string" ? new URL(request, location.href).href : request instanceof URL ? request.href : request.url;
        const previous = queue.get(key) || Promise.resolve();
        const operation = previous.catch(() => void 0).then(async () => {
          try {
            await originalPut.call(this, request, response);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!/Entry already exists/i.test(message)) throw error;
          }
        });
        const settled = operation.then(() => void 0, () => void 0);
        queue.set(key, settled);
        void settled.finally(() => {
          if (queue?.get(key) === settled) queue.delete(key);
        });
        return operation;
      };
    }
  });
}
let translationEngineGeneration=0;
const engineResetters=[];
let lastTranslationEngine=document.documentElement?.getAttribute('data-bi-translation-engine')||'';
function syncTranslationEngine(){const next=document.documentElement?.getAttribute('data-bi-translation-engine')||'';if(next===lastTranslationEngine)return;lastTranslationEngine=next;translationEngineGeneration++;for(const reset of engineResetters)reset();document.querySelectorAll('[data-unified-translation]').forEach(n=>n.remove());}
function watchTranslationEngine(){if(!document.documentElement){setTimeout(watchTranslationEngine,50);return;}new MutationObserver(syncTranslationEngine).observe(document.documentElement,{attributes:true,attributeFilter:['data-bi-translation-engine']});syncTranslationEngine();}
watchTranslationEngine();
const processed = /* @__PURE__ */ new WeakMap();
const retryAfter = /* @__PURE__ */ new WeakMap();
const translating = /* @__PURE__ */ new WeakMap();
const expanding = /* @__PURE__ */ new WeakSet();
const activeHosts = /* @__PURE__ */ new WeakSet();
const visibleHosts = /* @__PURE__ */ new WeakSet();
const pendingHosts = /* @__PURE__ */ new Set();
let scanTimer;
let scanRunning = false;
let translationsInFlight = 0;
const maxConcurrentTranslations = 2;
let messageVisibilityObserver;
const serviceWindow = window;
function translationEnabled() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--bi-talks-translation-enabled").trim();
  return value ? value !== "false" : initialEnabled;
}
function normalizeText(raw, maxLength = 0) {
  const normalized = raw.replace(/\u00a0/g, " ").split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter((line) => line && !/^(?:AM|PM)?\s*\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(line)).filter((line) => !/^(?:上午|下午|早上|晚上|凌晨)?\s*\d{1,2}:\d{2}$/.test(line)).join("\n").trim();
  return maxLength > 0 ? normalized.slice(0, maxLength) : normalized;
}
function messageText(host) {
  const cleanNodeText = (source) => {
    const clone = source.cloneNode(true);
    clone.querySelectorAll('[data-unified-translation],[data-testid*="quoted" i],[data-testid*="reply-context" i]').forEach((node) => node.remove());
    clone.querySelectorAll('button,[role="button"],[data-testid*="read-more" i],[data-testid*="show-more" i],svg,img,input,textarea,time,[datetime],[data-testid*="timestamp" i],[data-testid*="msg-meta" i],[contenteditable="true"]').forEach((node) => node.remove());
    return normalizeText(clone instanceof HTMLElement && clone.innerText ? clone.innerText : clone.textContent || "");
  };
  const pieces = [];
  host.querySelectorAll('[data-testid="msg-text"],span.selectable-text,[data-testid*="caption" i]').forEach((node) => {
    if (node.closest('[data-unified-translation],[data-testid*="quoted" i],[data-testid*="reply-context" i]')) return;
    const value = cleanNodeText(node);
    if (!value || pieces.some((piece) => piece.includes(value))) return;
    for (let index = pieces.length - 1; index >= 0; index -= 1) {
      if (value.includes(pieces[index])) pieces.splice(index, 1);
    }
    pieces.push(value);
  });
  if (pieces.length) return normalizeText(pieces.join("\n"));
  return cleanNodeText(host);
}
function isEnglishOnly(text) {
  return text.length >= 2 && /[A-Za-z]/.test(text);
}
function collapsedMessageControl(host) {
  const candidates = host.querySelectorAll('button,[role="button"],[tabindex],[data-testid],span');
  for (const candidate of candidates) {
    if (candidate.closest("[data-unified-translation]")) continue;
    const visibleLabel = normalizeText(candidate.innerText || candidate.textContent || "", 80);
    const ariaLabel = normalizeText(candidate.getAttribute("aria-label") || "", 80);
    const label = (visibleLabel || ariaLabel).trim().toLowerCase();
    if (!/^(?:read more|show more|see more|more|查看更多|显示更多|展开更多)$/iu.test(label)) continue;
    const testId = (candidate.getAttribute("data-testid") || "").toLowerCase();
    const role = (candidate.getAttribute("role") || "").toLowerCase();
    const interactive = candidate instanceof HTMLButtonElement || role === "button" || candidate.tabIndex >= 0 || /read.?more|show.?more|see.?more/u.test(testId) || getComputedStyle(candidate).cursor === "pointer";
    if (interactive) return candidate;
  }
  return void 0;
}
async function expandCollapsedMessage(host) {
  const control = collapsedMessageControl(host);
  if (!control || expanding.has(host)) return;
  expanding.add(host);
  const before = messageText(host);
  try {
    control.click();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 35));
      if (messageText(host) !== before || !collapsedMessageControl(host)) break;
    }
  } finally {
    expanding.delete(host);
  }
}
function chatIsReady() {
  if (platform !== "whatsapp" || !translationEnabled() || document.visibilityState !== "visible") return false;
  const host = location.hostname.toLowerCase();
  return (host === "whatsapp.com" || host.endsWith(".whatsapp.com")) && !!document.querySelector('#main,[data-testid="conversation-panel-messages"]');
}
function currentPreferences() {
  const styles = getComputedStyle(document.documentElement);
  const color = styles.getPropertyValue("--bi-talks-translation-color").trim() || initialColor;
  const size = Number.parseFloat(styles.getPropertyValue("--bi-talks-translation-size").trim() || "") || initialSize;
  return { color, size: Math.max(10, Math.min(24, Math.round(size))) };
}
function sourceKey(text) {
  let hash = 2166136261;
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `whatsapp:provider-v7:zh:${(hash >>> 0).toString(36)}:${normalized.length}`;
}
function existingTranslation(host) {
  return host.querySelector('[data-unified-translation="true"]') || void 0;
}
function translationPlacement(host) {
  const textCandidates = Array.from(host.querySelectorAll('[data-testid*="caption" i],[data-testid="msg-text"],span.selectable-text')).filter((node) => !node.closest('[data-unified-translation],[data-testid*="quoted" i],[data-testid*="reply-context" i]')).filter((node) => normalizeText(node.innerText || node.textContent || "").length > 0);
  const source = textCandidates.map((node) => ({ node, length: normalizeText(node.innerText || node.textContent || "").length })).sort((left, right) => right.length - left.length)[0]?.node;
  if (!source?.parentElement) return { container: host, insideBubble: false };
  const sourceBlock = source.closest('[data-testid*="caption" i],[data-testid="msg-text"]') || source;
  const sourceRect = sourceBlock.getBoundingClientRect();
  let bubble;
  let current = sourceBlock;
  while (current && host.contains(current)) {
    const style = getComputedStyle(current);
    const background = style.backgroundColor.replace(/\s+/g, "").toLowerCase();
    const opaqueBackground = !!background && background !== "transparent" && background !== "rgba(0,0,0,0)" && !background.endsWith(",0)");
    if (opaqueBackground && current.getBoundingClientRect().width >= Math.max(40, sourceRect.width - 4)) {
      bubble = current;
      break;
    }
    if (current === host) break;
    current = current.parentElement;
  }
  if (!bubble) return { container: sourceBlock.parentElement || host, width: sourceRect.width >= 80 ? Math.ceil(sourceRect.width) : void 0, insideBubble: true };
  const bubbleStyle = getComputedStyle(bubble);
  const horizontalPadding = (Number.parseFloat(bubbleStyle.paddingLeft) || 0) + (Number.parseFloat(bubbleStyle.paddingRight) || 0);
  const contentWidth = Math.max(0, bubble.clientWidth - horizontalPadding);
  return {
    container: bubble,
    width: contentWidth >= 40 ? Math.ceil(contentWidth) : void 0,
    insideBubble: true
  };
}
function appendTranslation(host, text, translated, key) {
  const existing = existingTranslation(host);
  if (existing?.dataset.sourceKey === key) {
    existing.textContent = translated;
    return;
  }
  existing?.remove();
  const prefs = currentPreferences();
  const node = document.createElement("div");
  node.dataset.unifiedTranslation = "true";
  node.dataset.sourceKey = key;
  node.dataset.sourceText = text;
  node.textContent = translated;
  const placement = translationPlacement(host);
  Object.assign(node.style, {
    marginTop: "4px",
    padding: "0 7px",
    borderTop: "none",
    borderRadius: "0",
    background: "transparent",
    color: `var(--bi-talks-translation-color, ${prefs.color})`,
    fontSize: `var(--bi-talks-translation-size, ${prefs.size}px)`,
    lineHeight: "1.45",
    whiteSpace: "pre-wrap",
    display: "block",
    width: placement.width ? `${placement.width}px` : placement.insideBubble ? "100%" : "auto",
    minWidth: placement.width ? `${placement.width}px` : "0",
    maxWidth: "100%",
    alignSelf: placement.insideBubble ? "stretch" : "auto",
    boxSizing: "border-box",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    contain: "content"
  });
  if (placement.insideBubble) {
    const containerDisplay = getComputedStyle(placement.container).display;
    if (containerDisplay.includes("flex")) {
      placement.container.style.flexWrap = "wrap";
      node.style.flexBasis = placement.width ? `${placement.width}px` : "100%";
      node.style.flexGrow = "0";
      node.style.flexShrink = "0";
    } else if (containerDisplay.includes("grid")) {
      node.style.gridColumn = "1 / -1";
    }
    placement.container.appendChild(node);
  } else {
    const display = getComputedStyle(host).display;
    if (display.includes("flex")) {
      host.style.flexDirection = "column";
      host.style.alignItems = host.style.alignItems || "flex-start";
    }
    host.style.overflow = "visible";
    host.appendChild(node);
  }
}
let whatsappNetworkBusy = false;
const whatsappMemory = new Map();
engineResetters.push(()=>{whatsappMemory.clear();setTimeout(()=>registerMessages(document),0);});
function rememberWhatsApp(text, own, value) {
  const key=JSON.stringify([text,own]);whatsappMemory.set(key,value);
  if(whatsappMemory.size>1000)whatsappMemory.delete(whatsappMemory.keys().next().value);
}
async function scan() {
  scanTimer=void 0;
  if(scanRunning||!chatIsReady())return;
  scanRunning=true;
  const engineGeneration=translationEngineGeneration;
  try {
    const jobs=[];
    for(const host of [...pendingHosts].sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)) {
      if(jobs.length>=100)break;
      pendingHosts.delete(host);
      if(!host.isConnected){messageVisibilityObserver?.unobserve(host);continue;}
      if(!visibleHosts.has(host)||activeHosts.has(host)||(retryAfter.get(host)||0)>Date.now())continue;
      await expandCollapsedMessage(host);
      if(!host.isConnected||!chatIsReady())continue;
      const text=messageText(host),key=sourceKey(text),own=!!host.closest('.message-out');
      if(!text||!isEnglishOnly(text)){existingTranslation(host)?.remove();continue;}
      if(processed.get(host)===key&&existingTranslation(host)?.dataset.sourceKey===key)continue;
      const cached=whatsappMemory.get(JSON.stringify([text,own]));
      if(cached){appendTranslation(host,text,cached,key);processed.set(host,key);continue;}
      jobs.push({host,text,key,own});
    }
    if(!jobs.length)return;
    const current=j=>engineGeneration===translationEngineGeneration&&j.host.isConnected&&visibleHosts.has(j.host)&&chatIsReady()&&messageText(j.host)===j.text;
    const render=(j,value)=>{if(engineGeneration!==translationEngineGeneration)return;rememberWhatsApp(j.text,j.own,value);if(current(j)){appendTranslation(j.host,j.text,value,j.key);processed.set(j.host,j.key);}};
    const cached=await electron.ipcRenderer.invoke('whatsapp:translation-cache',jobs.map(j=>({text:j.text,ownMessage:j.own})));
    const missing=[];
    jobs.forEach((j,i)=>{if(cached[i])render(j,cached[i]);else if(current(j))missing.push(j);});
    const batch=whatsappNetworkBusy?[]:missing.splice(0,5);
    missing.forEach(j=>pendingHosts.add(j.host));
    if(batch.length){
      whatsappNetworkBusy=true;
      batch.forEach(j=>{activeHosts.add(j.host);appendTranslation(j.host,j.text,'正在翻译…',j.key);});
      void electron.ipcRenderer.invoke('whatsapp:translation-batch',batch.map(j=>({text:j.text,ownMessage:j.own}))).then(values=>batch.forEach((j,i)=>render(j,values[i]))).catch(()=>batch.forEach(j=>{if(current(j))existingTranslation(j.host)?.remove();processed.delete(j.host);retryAfter.set(j.host,Date.now()+30000);setTimeout(()=>{if(current(j))queueMessage(j.host);},30050);})).finally(()=>{batch.forEach(j=>activeHosts.delete(j.host));whatsappNetworkBusy=false;if(pendingHosts.size)scheduleScan(16);});
    }
  } catch { setTimeout(()=>{if(chatIsReady())registerMessages(document);},30000); }
  finally {scanRunning=false;if(pendingHosts.size&&!whatsappNetworkBusy)scheduleScan(24);}
}

function scheduleScan(delay = 30) {
  if (scanTimer || !chatIsReady()) return;
  scanTimer = setTimeout(scan, delay);
}
function queueMessage(host) {
  if (!host.isConnected || host.closest("[data-unified-translation]")) return;
  pendingHosts.add(host);
  scheduleScan(24);
}
function observeMessage(host) {
  messageVisibilityObserver?.observe(host);
}
function registerMessages(root) {
  if (root instanceof HTMLElement && root.matches('[data-testid="msg-container"]')) observeMessage(root);
  root.querySelectorAll('[data-testid="msg-container"]').forEach(observeMessage);
}
function mutationTouchesOnlyTranslations(record) {
  if (record.type !== "childList") return false;
  const changed = [...record.addedNodes, ...record.removedNodes];
  return changed.length > 0 && changed.every((node) => node instanceof Element && (node.matches("[data-unified-translation]") || !!node.closest("[data-unified-translation]")));
}
function handleMutations(records) {
  for (const record of records) {
    const targetElement = record.target instanceof Element ? record.target : record.target.parentElement;
    if (targetElement?.closest("[data-unified-translation]") || mutationTouchesOnlyTranslations(record)) continue;
    const targetHost = targetElement?.closest('[data-testid="msg-container"]');
    if (targetHost) {
      observeMessage(targetHost);
      if (visibleHosts.has(targetHost)) queueMessage(targetHost);
    }
    if (record.type === "childList") {
      record.addedNodes.forEach((node) => {
        if (!(node instanceof Element) || node.matches("[data-unified-translation]")) return;
        registerMessages(node);
      });
    }
  }
}
function whatsappComposer(element) {
  const editor = element.closest('[contenteditable="true"]');
  if (!editor) return void 0;
  const rect = editor.getBoundingClientRect();
  const signature = `${editor.getAttribute("aria-label") || ""} ${editor.getAttribute("data-testid") || ""} ${editor.className || ""}`.toLowerCase();
  if (/search|搜索|查找|filter|筛选|profile|个人资料|nickname|备注/u.test(signature)) return void 0;
  const inChat = !!document.querySelector("#main")?.contains(editor);
  const inAttachmentPreview = !!editor.closest('[role="dialog"],[data-animate-modal-popup="true"],[data-testid*="media" i],[class*="media" i],[class*="caption" i]');
  return rect.width >= 120 && rect.height >= 16 && rect.top >= (window.innerHeight || 800) * 0.42 && (inChat || inAttachmentPreview) ? editor : void 0;
}
function composerText(editor) {
  return normalizeText(editor.innerText || editor.textContent || "", 6e4);
}
let outgoingStatusTimer;
function showOutgoingStatus(message, tone = "progress", duration = 0) {
  const id = "bi-talks-outgoing-translation-status";
  let status = document.getElementById(id);
  if (!status) {
    status = document.createElement("div");
    status.id = id;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    Object.assign(status.style, {
      position: "fixed",
      zIndex: "2147483647",
      right: "22px",
      bottom: "76px",
      maxWidth: "min(320px, calc(100vw - 44px))",
      padding: "9px 13px",
      borderRadius: "9px",
      boxShadow: "0 8px 26px rgba(0,0,0,.32)",
      font: "600 13px/1.35 system-ui, sans-serif",
      color: "#fff",
      pointerEvents: "none",
      transition: "opacity .16s ease"
    });
    document.body?.appendChild(status);
  }
  status.textContent = message;
  status.style.background = tone === "success" ? "#137333" : tone === "error" ? "#b3261e" : "#365fc9";
  status.style.opacity = "1";
  if (outgoingStatusTimer) clearTimeout(outgoingStatusTimer);
  if (duration > 0) {
    outgoingStatusTimer = setTimeout(() => {
      status?.remove();
      outgoingStatusTimer = void 0;
    }, duration);
  }
}
function installTwoStepTranslation(options) {
  if(options.platform === "teams") return; // Teams uses its own verified composer adapter.
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
    if (options.platform === 'phound' && !editor.matches('[contenteditable="true"][aria-label="Type a message here"],textarea[placeholder*="message" i],[contenteditable="true"][data-placeholder*="message" i]')) return null;
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
    } else if (options.platform === 'whatsapp' && editor.matches('[data-lexical-editor="true"]')) {
      // Let Lexical update its own state through its native plain-text paste handler.
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', translated);
      editor.dispatchEvent(new ClipboardEvent('paste', {clipboardData,bubbles:true,cancelable:true,composed:true}));
    } else {
      const escaped = translated.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/ /g,'&nbsp;').replace(/\n/g,'<br>');
      const structured = editor.matches('[data-lexical-editor="true"],.ProseMirror,.ql-editor') || [...editor.children].some(n => n.tagName === 'P');
      const html = structured ? escaped.split('<br>').map(line => '<p>'+(line || '<br>')+'</p>').join('') : escaped;
      if (!document.execCommand('insertHTML',false,html)) return false;
    }
    await new Promise(resolve=>setTimeout(resolve,options.platform === 'whatsapp' ? 150 : 40));
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
}

function installPhoundIncomingTranslation() {
  if (location.hostname !== 'web.phound.app') return;
  const selector='[class*="MessageTextWithMention_root__"],[class*="MessageTextWithLink_root__"]';
  const cache=new Map(),pending=new WeakMap(),failures=new WeakMap();
  engineResetters.push(()=>cache.clear());
  let running=0,timer;
  const sourceOf=node=>{const clone=node.cloneNode(true);clone.querySelectorAll('[data-unified-translation]').forEach(e=>e.remove());return (clone.textContent||'').trim();};
  const render=(node,source,text)=>{
    if(!node.isConnected || sourceOf(node)!==source || !translationEnabled())return;
    let result=node.querySelector(':scope > [data-unified-translation]');
    if(!result){result=document.createElement('div');result.setAttribute('data-unified-translation','phound');result.setAttribute('aria-label','中文翻译');node.appendChild(result);}
    result.textContent=text;
    Object.assign(result.style,{whiteSpace:'pre-wrap',fontSize:'var(--bi-talks-translation-size,15px)',color:'var(--bi-talks-translation-color,#d8ff00)',marginTop:'4px',lineHeight:'1.4',userSelect:'text'});
  };
  const scan=()=>{
    timer=undefined;
    if(!translationEnabled()){document.querySelectorAll('[data-unified-translation="phound"]').forEach(e=>e.remove());return;}
    if(document.visibilityState!=='visible')return;
    for(const node of document.querySelectorAll(selector)){
      if(node.parentElement?.closest(selector) || node.closest('[contenteditable="true"],input,textarea,[data-unified-translation]'))continue;
      const rect=node.getBoundingClientRect();if(rect.width<=0||rect.bottom<0||rect.top>innerHeight+160)continue;
      const source=sourceOf(node);if(!source||!/\p{Script=Latin}/u.test(source)||source.length>12000)continue;
      if(cache.has(source)){render(node,source,cache.get(source));continue;}
      if(running>=2 || pending.has(node) || (failures.get(node)||0)>Date.now())continue;
      running++;pending.set(node,source);const engineGeneration=translationEngineGeneration;
      void electron.ipcRenderer.invoke('translate:text',source,'zh','auto').then(value=>{
        if(engineGeneration!==translationEngineGeneration)return;const text=String(value||'').trim();if(!text)throw Error('empty');
        cache.set(source,text);if(cache.size>500)cache.delete(cache.keys().next().value);render(node,source,text);
      }).catch(()=>failures.set(node,Date.now()+15000)).finally(()=>{running--;pending.delete(node);schedule();});
    }
  };
  const schedule=()=>{if(!timer)timer=setTimeout(scan,150);};
  new MutationObserver(records=>{
    if(records.every(r=>r.target instanceof Element && (r.target.closest('[data-unified-translation]') || (r.type==='childList' && [...r.addedNodes,...r.removedNodes].every(n=>n instanceof Element&&n.matches('[data-unified-translation]'))))))return;
    schedule();
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('visibilitychange',schedule);window.addEventListener('scroll',schedule,true);
  setInterval(schedule,5000);schedule();
  window.__biTalksPhoundIncoming={version:1};
}

function installZoomMessageTranslation() {
  if (platform !== 'zoom' || window.__biTalksZoomMessages) return;
  window.__biTalksZoomMessages = {version:3};
  const cache=new Map(),pending=new Map(),retry=new Map();
  engineResetters.push(()=>{cache.clear();retry.clear();});
  let running=false,disposed=false;
  function documents(){const docs=[document];for(let i=0;i<docs.length;i++)for(const f of docs[i].querySelectorAll('iframe'))try{const d=f.contentDocument;if(d&&!docs.includes(d)&&f.contentWindow.location.origin===location.origin)docs.push(d);}catch{}return docs;}
  function sourceOf(host){
    const copy=host.cloneNode(true);copy.querySelectorAll('[data-unified-translation],[data-zds-ignore],button').forEach(n=>n.remove());
    const paragraphs=[...copy.querySelectorAll('.zds-block-content')];
    return (paragraphs.length?paragraphs.map(n=>n.textContent).join('\n'):copy.textContent||'').trim();
  }
  const messageId=host=>host.closest('[data-message-id]')?.getAttribute('data-message-id')||'';
  const chatId=doc=>doc.querySelector('[data-testid="message_loaded"]')?.getAttribute('data-scroll-id')||doc.querySelector('[data-sessionid].ui-List-item-active,[data-sessionid][aria-selected="true"]')?.getAttribute('data-sessionid')||'';
  const chatEnabled=doc=>translationEnabled()&&!!chatId(doc)&&doc.documentElement.getAttribute('data-bi-zoom-chat-id')===chatId(doc)&&doc.documentElement.getAttribute('data-bi-zoom-chat-enabled')==='true';
  const current=(host,text,id)=>!disposed&&chatEnabled(host.ownerDocument)&&host.isConnected&&messageId(host)===id&&sourceOf(host)===text;
  function render(host,text,id,value,state){
    if(!current(host,text,id))return;
    const bubble=host.querySelector('[data-text-detail] .zds-root.zds-html');if(!bubble)return;
    const prefs=currentPreferences();let node=host.querySelector('[data-bi-zoom-translation]');
    if(!node){node=host.ownerDocument.createElement('div');node.dataset.unifiedTranslation='true';node.dataset.biZoomTranslation='true';bubble.appendChild(node);}
    Object.assign(node.style,{display:'block',color:prefs.color,fontSize:prefs.size+'px',whiteSpace:'pre-wrap',overflowWrap:'anywhere',marginTop:'4px',lineHeight:'1.45'});
    if(node.dataset.sourceText===text&&node.dataset.state===state&&node.textContent===value)return;
    node.dataset.sourceText=text;node.dataset.state=state;node.textContent=value;
    node.onclick=state==='failed'?event=>{event.preventDefault();event.stopPropagation();if(current(host,text,id)){retry.delete(text);node.dataset.state='retry';scan();}}:null;
    node.style.cursor=state==='failed'?'pointer':'default';
    if(state==='failed'){node.setAttribute('role','button');node.tabIndex=0;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();node.click();}};}
    else{node.removeAttribute('role');node.removeAttribute('tabindex');node.onkeydown=null;}
  }
  function scan(){
    if(running||disposed)return;running=true;
    try{for(const doc of documents()){
      if(!chatEnabled(doc)){doc.querySelectorAll('[data-bi-zoom-translation]').forEach(n=>n.remove());continue;}
      for(const host of doc.querySelectorAll('[data-testid="message_main"][data-message-id] [data-message-content="true"]')){
        if(!host.isConnected||!host.getClientRects().length)continue;
        const text=sourceOf(host),id=messageId(host);
        const old=host.querySelector('[data-bi-zoom-translation]');
        if(old&&old.dataset.sourceText!==text)old.remove();
        if(!text||!/[A-Za-z]/.test(text))continue;
        if(cache.has(text)){render(host,text,id,cache.get(text),'done');continue;}
        const failure=retry.get(text);
        if(failure&&Date.now()<failure.until){render(host,text,id,failure.message+' 点击重试。','failed');continue;}
        if(pending.has(text)){render(host,text,id,Date.now()-pending.get(text).started>35000?'翻译仍在处理中，请稍候…':'正在翻译…','pending');continue;}
        if(pending.size>=2){render(host,text,id,'等待翻译…','waiting');continue;}
        render(host,text,id,'正在翻译…','pending');
        const engineGeneration=translationEngineGeneration;const chat=chatId(doc);const job={started:Date.now()};pending.set(text,job);
        // Keep ownership until the IPC request settles; a slow request must not spawn duplicates.
        Promise.resolve().then(()=>{if(!current(host,text,id)||chatId(doc)!==chat)return null;return electron.ipcRenderer.invoke('translate:text',text,'zh','auto');}).then(result=>{
          if(result===null||engineGeneration!==translationEngineGeneration)return;if(chatId(doc)!==chat)return;
          if(typeof result!=='string'||!result.trim())throw Error('翻译服务返回了空译文。');
          cache.set(text,result);retry.delete(text);while(cache.size>500)cache.delete(cache.keys().next().value);
          render(host,text,id,result,'done');
        }).catch(error=>{
          if(engineGeneration!==translationEngineGeneration||chatId(doc)!==chat||!chatEnabled(doc))return;
          const raw=String(error?.message||'翻译请求失败。').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');
          const message=raw.slice(0,180);retry.set(text,{until:Date.now()+30000,message});while(retry.size>500)retry.delete(retry.keys().next().value);
          render(host,text,id,message+' 点击重试。','failed');
        }).finally(()=>{if(pending.get(text)===job)pending.delete(text);if(!disposed)scan();});
      }
    }}finally{running=false;}
  }
  const timer=setInterval(scan,1000);window.addEventListener('unload',()=>{disposed=true;clearInterval(timer);},{once:true});scan();
}

function installZoomImeGuard(){if(window.__biZoomImeGuard)return;const seen=new WeakSet();const scan=()=>{const ds=[document];for(let i=0;i<ds.length;i++){const d=ds[i];if(!seen.has(d)){seen.add(d);d.addEventListener('compositionstart',()=>{d.defaultView.__biZoomImeActive=true;},true);d.addEventListener('compositionend',()=>{d.defaultView.__biZoomImeActive=false;},true);d.defaultView.addEventListener('blur',()=>{d.defaultView.__biZoomImeActive=false;});}for(const f of d.querySelectorAll('iframe'))try{if(f.contentDocument&&!ds.includes(f.contentDocument))ds.push(f.contentDocument);}catch{}}};scan();const timer=setInterval(scan,1000);window.addEventListener('unload',()=>clearInterval(timer),{once:true});window.__biZoomImeGuard={version:1};}

function installZoomNotes(accountId){
 if(window.__biZoomNotes)return;
 const states=new Map(),memory=new Map();
 const key=id=>'bitalks.zoom.notes.v1.'+accountId+'.'+id;
 const docs=()=>{const ds=[document];for(let i=0;i<ds.length;i++)for(const f of ds[i].querySelectorAll('iframe'))try{if(f.contentDocument&&!ds.includes(f.contentDocument))ds.push(f.contentDocument);}catch{}return ds;};
 const chat=d=>d.querySelector('[data-testid="message_loaded"]')?.getAttribute('data-scroll-id')||d.querySelector('[data-sessionid].ui-List-item-active')?.getAttribute('data-sessionid')||'';
 function load(id){if(memory.has(id))return memory.get(id);try{return localStorage.getItem(key(id))||'';}catch{return '';}}
 function save(s){if(!s.id)return;memory.set(s.id,s.box.value);try{localStorage.setItem(key(s.id),s.box.value);s.box.title='联系人备注，仅保存在本机';}catch{s.box.title='备注保存失败，请勿关闭程序';}}
 function sync(){for(const d of docs()){
  if(d.defaultView.__biZoomImeActive)continue;
  const h=d.querySelector('[data-testid="chat_header_container"]'),g=d.querySelector('[data-testid="chat_header_btn_group"]'),id=chat(d);
  if(h&&h.ownerDocument!==d)continue;
  let s=states.get(d);
  if(!h||!g||!id||!h.getClientRects().length){if(s)s.box.style.display='none';continue;}
  if(!s){const box=d.createElement('textarea');box.id='bi-zoom-contact-note';box.placeholder='添加备注…';box.setAttribute('aria-label','此联系人的私人备注');box.spellcheck=false;s={box,id:'',expanded:false};states.set(d,s);d.body.append(box);
   for(const e of ['keydown','keypress','keyup','click','pointerdown'])box.addEventListener(e,event=>event.stopPropagation());
   box.addEventListener('input',()=>save(s));box.addEventListener('focus',()=>{s.expanded=true;sync();});box.addEventListener('blur',()=>{save(s);s.expanded=false;sync();});
   box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();box.blur();}});
  }
  if(s.id!==id){if(s.id)save(s);s.expanded=false;s.id=id;s.box.value=load(id);}
  const hr=h.getBoundingClientRect(),gr=g.getBoundingClientRect(),title=h.querySelector('[data-testid="chat_header_title"] [data-header-toolbar-item]');
  const nameRight=title?.getBoundingClientRect().right||hr.left+200;
  const width=Math.min(340,Math.max(0,gr.left-nameRight-32));
  if(width<80){s.box.style.display='none';continue;}
  const top=hr.top+(hr.height-38)/2,dark=h.classList.contains('themeDARK');
  const style={display:'block',position:'fixed',left:(gr.left-width-12)+'px',top:top+'px',width:width+'px',height:(s.expanded?Math.min(500,d.defaultView.innerHeight-top-12):38)+'px','box-sizing':'border-box',resize:'none',padding:'8px 10px',margin:'0',font:'14px/1.5 system-ui',color:dark?'#fff':'#111',background:dark?'#252525':'#f5f7fa',border:'1px solid '+(s.expanded?'#0b5cff':dark?'#666':'#c7cdd6'),'border-radius':'6px','z-index':'1000','box-shadow':s.expanded?'0 6px 18px #0003':'none',outline:'none',transition:'none','overflow-y':'auto'};
  const signature=JSON.stringify(style);if(s.box.__biStyleSignature!==signature||s.box.__biStyleApplied!==s.box.style.cssText){for(const [k,v] of Object.entries(style))s.box.style.setProperty(k,v,'important');s.box.__biStyleSignature=signature;s.box.__biStyleApplied=s.box.style.cssText;}
 }}
 const timer=setInterval(sync,300);window.addEventListener('unload',()=>{for(const s of states.values())save(s);clearInterval(timer);},{once:true});
 window.__biZoomNotes={version:1,sync};sync();
}

function installZoomChatControl(accountId) {
  if(window.__biZoomChatControl)return;
  const key='bitalks.zoom.chatTranslation.v1.'+accountId;
  let prefs={};try{prefs=JSON.parse(localStorage.getItem(key)||'{}');if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))prefs={};}catch{}
  function documents(){const out=[document];for(let i=0;i<out.length;i++)for(const f of out[i].querySelectorAll('iframe'))try{if(f.contentDocument&&!out.includes(f.contentDocument))out.push(f.contentDocument);}catch{}return out;}
  const id=d=>d.querySelector('[data-testid="message_loaded"]')?.getAttribute('data-scroll-id')||d.querySelector('[data-sessionid].ui-List-item-active,[data-sessionid][aria-selected="true"]')?.getAttribute('data-sessionid')||'';
  const master=()=>getComputedStyle(document.documentElement).getPropertyValue('--bi-talks-translation-enabled').trim()!=='false';
  function sync(){for(const d of documents()){
    if(!d.getElementById('bi-zoom-chat-button-style')){const style=d.createElement('style');style.id='bi-zoom-chat-button-style';style.textContent="#bi-zoom-chat-translation-switch{appearance:none!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;min-height:32px!important;padding:6px 12px!important;border:1px solid #94a3b8!important;border-radius:8px!important;background:#e8edf4!important;color:#334155!important;font:600 13px/18px system-ui!important;box-shadow:0 1px 2px #00000018!important;cursor:pointer!important;white-space:nowrap!important;transition:background .15s,box-shadow .15s!important}#bi-zoom-chat-translation-switch::before{content:'';width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.75}#bi-zoom-chat-translation-switch[aria-checked=\"true\"]{background:#0b5cff!important;border-color:#0b5cff!important;color:#fff!important}#bi-zoom-chat-translation-switch:hover:not(:disabled){box-shadow:0 2px 6px #00000030!important;filter:brightness(.96)}#bi-zoom-chat-translation-switch:focus-visible{outline:2px solid #60a5fa!important;outline-offset:3px!important}#bi-zoom-chat-translation-switch:active:not(:disabled){box-shadow:inset 0 1px 3px #0003!important}#bi-zoom-chat-translation-switch:disabled{opacity:.55!important;cursor:default!important}.themeDARK #bi-zoom-chat-translation-switch[aria-checked=\"false\"]{background:#334155!important;color:#f1f5f9!important;border-color:#64748b!important}";(d.head||d.documentElement).append(style);}
    const chat=id(d),on=!!chat&&prefs[chat]!==false,root=d.documentElement;
    const set=(k,v)=>{if(root.getAttribute(k)!==v)root.setAttribute(k,v);};
    set('data-bi-zoom-chat-id',chat);set('data-bi-zoom-chat-enabled',on?'true':'false');
    if(!on||!master()){d.querySelectorAll('[data-bi-zoom-translation]').forEach(n=>n.remove());d.getElementById('bi-zoom-outgoing-status')?.remove();}
    const header=d.querySelector('[data-testid="chat_header_btn_group"]')||d.querySelector('[data-testid="chat_header_container"]');
    let b=d.getElementById('bi-zoom-chat-translation-switch');
    if(!header||!chat){b?.remove();continue;}
    if(!b){b=d.createElement('button');b.id='bi-zoom-chat-translation-switch';b.type='button';b.setAttribute('role','switch');Object.assign(b.style,{font:'12px system-ui',color:'inherit',background:'transparent',border:'1px solid #8888',borderRadius:'6px',padding:'5px 8px',margin:'0 8px',whiteSpace:'nowrap',cursor:'pointer',flexShrink:'0'});header.prepend(b);
      b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();const current=id(d);if(!current||!master())return;const next={...prefs,[current]:prefs[current]===false};try{localStorage.setItem(key,JSON.stringify(next));prefs=next;sync();}catch{b.textContent='设置保存失败，请重试';}});
    }
    const label=master()?'此聊天翻译：'+(on?'开':'关'):'此聊天翻译：账号已关闭';
    if(b.textContent!==label)b.textContent=label;if(b.disabled!==!master())b.disabled=!master();if(b.getAttribute('aria-checked')!==String(on&&master()))b.setAttribute('aria-checked',String(on&&master()));if(b.title!=='仅控制此账号、此聊天的消息译文和输入翻译')b.title='仅控制此账号、此聊天的消息译文和输入翻译';if(b){const active=b.getAttribute('aria-checked')==='true',dark=!!b.closest('.themeDARK');for(const [k,v] of Object.entries({transition:'none',animation:'none','background-color':active?'#0b5cff':dark?'#334155':'#e8edf4',color:active||dark?'#ffffff':'#334155','border-color':active?'#0b5cff':'#94a3b8','border-style':'solid','border-width':'1px'})){const normal=d.createElement('span').style;normal.setProperty(k,v,'important');if(b.style.getPropertyValue(k)!==normal.getPropertyValue(k)||b.style.getPropertyPriority(k)!=='important')b.style.setProperty(k,v,'important');}}
  }}
  window.__biZoomChatControl={version:1,id,enabled:d=>master()&&!!id(d)&&prefs[id(d)]!==false,sync};
  const timer=setInterval(sync,300);window.addEventListener('unload',()=>clearInterval(timer),{once:true});sync();
}

function installZoomOutgoing() {
  if(window.__biZoomOutgoing)return;
  const abort=new AbortController();const installed=new WeakSet();let job=null,held=false;const composingDocs=new WeakSet(),imeDocs=new WeakSet();
  const enabled=(doc=job?.box?.ownerDocument||document)=>window.__biZoomChatControl?.enabled(doc)===true;
  const text=box=>[...box.querySelectorAll('.editor-block-children-container .zm-block-content')].map(n=>n.textContent.replace(/\u200b/g,'')).join('\n');
  const boxFor=target=>target?.closest?.('[data-testid="chat_box"]')||document.querySelector('[data-testid="chat_box"]');
  const context=box=>window.__biZoomChatControl?.id(box.ownerDocument)||box.closest('[class*="messageEditor"]')?.querySelector('[aria-label^="Message to"]')?.getAttribute('aria-label')||'';
  let statusBox=null;
  const positionStatus=()=>{if(!statusBox?.isConnected)return;const n=statusBox.ownerDocument.getElementById('bi-zoom-outgoing-status');if(!n)return;const r=statusBox.getBoundingClientRect();for(const [k,v] of Object.entries({left:(r.left+r.width/2)+'px',top:(r.top-10)+'px',maxWidth:Math.max(80,r.width-16)+'px'}))if(n.style[k]!==v)n.style[k]=v;};
  const statusResize=new ResizeObserver(positionStatus);
  const focused=box=>{const d=box.ownerDocument,e=d.activeElement;return d.hasFocus()&&!!e&&(box.contains(e)||(e.classList?.contains('docs-cursor-placeholder')&&!!d.getSelection()?.anchorNode&&box.contains(d.getSelection().anchorNode)));};
  const clearStatus=()=>{statusObserver.disconnect();statusResize.disconnect();statusBox?.ownerDocument.getElementById('bi-zoom-outgoing-status')?.remove();statusBox=null;};
  const empty=box=>!box?.isConnected||!text(box).replace(/[\s\u200b\u200c\u200d\ufeff]/gu,'');
  const reconcile=()=>{
    if(job?.phase==='writing')return;
    if(job&&(!job.box.isConnected||context(job.box)!==job.context||text(job.box)!==(job.phase==='ready'?job.result:job.source))){job=null;clearStatus();return;}
    if(statusBox&&empty(statusBox)){job=null;clearStatus();}
  };
  const statusObserver=new MutationObserver(reconcile);
  const status=(box,message)=>{
    if(empty(box)){if(job?.box===box)job=null;clearStatus();return;}
    if(statusBox!==box){clearStatus();statusBox=box;statusResize.observe(box);statusObserver.observe(box,{childList:true,subtree:true,characterData:true});}
let n=box.ownerDocument.getElementById('bi-zoom-outgoing-status');if(!n){n=box.ownerDocument.createElement('div');n.id='bi-zoom-outgoing-status';box.ownerDocument.body.append(n)}const r=box.getBoundingClientRect();Object.assign(n.style,{position:'fixed',left:(r.left+r.width/2)+'px',top:(r.top-10)+'px',transform:'translate(-50%,-100%)',background:'#365fc9',color:'#fff',borderRadius:'8px',padding:'8px 12px',font:'600 13px system-ui',zIndex:'2147483647',pointerEvents:'none'});n.textContent=message;positionStatus();};
  const block=e=>{e.preventDefault();e.stopImmediatePropagation();e.stopPropagation()};
  function intent(e,box){
    if(!box||!enabled(box.ownerDocument))return false;
    reconcile();const source=text(box);if(!source.trim()){clearStatus();return false;}
    if(job?.box===box&&job.context===context(box)&&job.phase==='ready'&&job.result===source&&!/\p{Script=Han}/u.test(source)){job=null;clearStatus();return false;}
    if(!job&&/^[\x00-\x7f\u00a0\u2000-\u206f]*$/.test(source)&&/[a-z]/i.test(source))return false;
    block(e);
    if(job&&['translating','writing'].includes(job.phase))return true;
    const api=box.querySelector('[data-editor-container]')?.editor;
    if(!api?.replaceContent){status(box,'输入框尚未就绪，未发送，请稍后再试。');return true;}
    const current={box,source,context:context(box),phase:'translating'};job=current;status(box,'正在翻译，请稍候…');
    const valid=()=>job===current&&box.isConnected&&context(box)===current.context&&enabled(box.ownerDocument);
    const restoreFocus=()=>{const d=box.ownerDocument;if(!valid()||current.interrupted||composingDocs.has(d)||!d.hasFocus())return false;const active=d.activeElement;if(active&&active!==d.body&&!box.contains(active)&&!active.classList?.contains('docs-cursor-placeholder'))return false;api.focus('end');const input=box.querySelector('textarea.docs-cursor-placeholder');if(input&&d.activeElement!==input)input.focus({preventScroll:true});return !!input&&d.activeElement===input;};
    const work=()=>window.__biZoomTranslate('__BITALKS_LAYOUT_CONTEXT_V2__'+JSON.stringify(source));
    let timeout=setTimeout(()=>{if(valid()&&text(box)===source)status(box,'翻译仍在处理中，请稍候，未发送。');},35000);Promise.resolve().then(work).then(async result=>{if(!valid()||text(box)!==source)return;if(composingDocs.has(box.ownerDocument)||!focused(box)||current.interrupted){job=null;clearStatus();return;}if(!result.trim())throw Error('译文为空');if(/\p{Script=Han}/u.test(result))throw Error('译文仍含中文，请修改后重试');current.phase='writing';await api.replaceContent({type:'PlainText',version:'1.0.0',data:result});if(valid()&&text(box)===result)restoreFocus();await new Promise(r=>setTimeout(r,100));if(!valid())return;if(text(box)!==result)throw Error('译文未完整写入');current.phase='ready';current.result=result;restoreFocus();status(box,'已翻译，请确认译文，再按一次回车发送。');}).catch(error=>{if(valid()){job=null;status(box,String(error.message||'翻译失败')+'，未发送，请重试。')}}).finally(()=>{clearTimeout(timeout);if(job===current&&current.phase!=='ready'){job=null;}});
    return true;
  }
  function attach(doc){if(installed.has(doc))return;installed.add(doc);const w=doc.defaultView;
    const on=(type,fn)=>w.addEventListener(type,fn,{capture:true,signal:abort.signal});
    on('resize',positionStatus);on('scroll',positionStatus);
    on('pointerdown',()=>{if(job&&['translating','writing'].includes(job.phase))job.interrupted=true;});
    on('keydown',e=>{if(job&&['translating','writing'].includes(job.phase)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Tab'].includes(e.key))job.interrupted=true;});
    on('input',reconcile);
    on('blur',()=>{held=false;if(job&&['translating','writing'].includes(job.phase)&&!doc.hasFocus())job.interrupted=true;reconcile();});
    on('compositionstart',()=>{composingDocs.add(doc);if(job&&['translating','writing'].includes(job.phase))job.interrupted=true;},true);w.addEventListener('compositionend',()=>composingDocs.delete(doc));
    on('keydown',e=>{if(e.__biZoomOutgoingEnterHandled)return;e.__biZoomOutgoingEnterHandled=true;if(e.key!=='Enter'||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey)return;const box=boxFor(e.target);if(!box||!box.contains(e.target)&&!e.target?.classList?.contains('docs-cursor-placeholder'))return;if(box&&enabled(doc)&&(e.isComposing||e.keyCode===229||composingDocs.has(doc))){imeDocs.add(doc);e.stopImmediatePropagation();e.stopPropagation();return;}if(held){if(enabled(doc))block(e);return;}held=true;intent(e,box);});
    on('keypress',e=>{if(e.key==='Enter'&&imeDocs.has(doc)){e.stopImmediatePropagation();e.stopPropagation();}});
    on('keyup',e=>{if(e.key==='Enter'){held=false;if(imeDocs.has(doc)){imeDocs.delete(doc);e.stopImmediatePropagation();e.stopPropagation();}}});
    on('click',e=>{const b=e.target.closest?.('button,[role="button"]');if(!b||!/^(send|发送)/i.test(b.getAttribute('aria-label')||b.getAttribute('title')||''))return;intent(e,boxFor(b));});
  }
  const scan=()=>{const docs=[document];for(let i=0;i<docs.length;i++){attach(docs[i]);for(const f of docs[i].querySelectorAll('iframe'))try{if(f.contentDocument&&!docs.includes(f.contentDocument))docs.push(f.contentDocument)}catch{}}reconcile();if(!enabled()){job=null;clearStatus();for(const doc of docs)doc.getElementById('bi-zoom-outgoing-status')?.remove();}};
  const timer=setInterval(()=>{scan();positionStatus();},500);scan();window.__biZoomOutgoing={version:6,destroy(){job=null;clearStatus();abort.abort();clearInterval(timer);}};
}

function installTeamsTranslation(accountId) {
  if(!['teams.live.com','teams.microsoft.com','teams.cloud.microsoft'].includes(location.hostname)||window.__biTeamsTranslation)return;
  const abort=new AbortController(),prefKey='bitalks.teams.chatTranslation.v1.'+accountId;
  let prefs={};try{prefs=JSON.parse(localStorage.getItem(prefKey)||'{}');if(!prefs||typeof prefs!=='object'||Array.isArray(prefs))prefs={};}catch{}
  const editorSelector='[data-tid="ckeditor"][contenteditable="true"]',sendSelector='[data-tid="sendMessageCommands-send"],[data-tid="newMessageCommands-send"]';
  const chat=()=>document.querySelector(sendSelector)?.getAttribute('data-track-thread-id')||'';
  const master=()=>getComputedStyle(document.documentElement).getPropertyValue('--bi-talks-translation-enabled').trim()!=='false';
  const enabled=()=>master()&&!!chat()&&prefs[chat()]!==false;
  const editorFor=n=>n?.closest?.(editorSelector)||null;
  // Translate text ranges only: media objects and their upload metadata stay in place.
  const slotsFor=editor=>{const root=editor?.ckeditorInstance?.model?.document?.getRoot();if(!root)return null;const slots=[];for(const p of root.getChildren()){if(p.name!=='paragraph')continue;let run=null;const flush=()=>{if(run){slots.push(run);run=null;}};for(const n of p.getChildren()){if(n.is?.('$text')||n.is?.('$textProxy')||n.name==='softBreak'){if(!run)run={parent:p,start:n.startOffset,end:n.startOffset,text:''};run.text+=n.name==='softBreak'?'\n':n.data;run.end=n.startOffset+n.offsetSize;}else flush();}flush();if(!p.childCount)slots.push({parent:p,start:0,end:0,text:''});}return slots;};
  const modelText=editor=>{const slots=slotsFor(editor);return slots?slots.map(s=>s.text).join('\n'):null;};
  const plainModel=editor=>{const api=editor?.ckeditorInstance,root=api?.model?.document?.getRoot(),object=n=>api.model.schema?.isObject(n)||['inlineImage','imageBlock'].includes(n.name);return !!root&&[...root.getChildren()].every(p=>object(p)||(p.name==='paragraph'&&[...p.getChildren()].every(n=>n.is?.('$text')||n.name==='softBreak'||object(n))));};
  function write(editor,value){const api=editor.ckeditorInstance,slots=slotsFor(editor);if(!slots)return false;const lines=value.replace(/\r\n/g,'\n').split('\n');if(lines.length!==slots.reduce((n,s)=>n+s.text.split('\n').length,0))return false;let offset=0;const edits=slots.map(s=>({...s,lines:lines.slice(offset,offset+=s.text.split('\n').length)}));api.model.change(w=>{for(const s of edits.reverse()){w.remove(w.createRange(w.createPositionAt(s.parent,s.start),w.createPositionAt(s.parent,s.end)));let at=s.start;for(let i=0;i<s.lines.length;i++){if(i){w.insertElement('softBreak',s.parent,at);at++;}const text=s.lines[i];if(text){w.insertText(text,s.parent,at);at+=text.length;}}}if(edits.length){const first=edits[0];w.setSelection(first.parent,Math.min(first.parent.maxOffset,first.start+first.lines.join('\n').length));}});return modelText(editor)===value.replace(/\r\n/g,'\n');}
  let job=null,composing=false,held=false,imeEnter=false,statusEditor=null;
  const position=()=>{const n=document.getElementById('bi-teams-outgoing-status');if(!n||!statusEditor?.isConnected)return;const r=statusEditor.getBoundingClientRect();for(const [k,v]of Object.entries({left:(r.left+r.width/2)+'px',top:(r.top-8)+'px',maxWidth:Math.max(80,r.width-16)+'px'}))if(n.style[k]!==v)n.style[k]=v;};
  const resize=new ResizeObserver(position);
  const clear=()=>{document.getElementById('bi-teams-outgoing-status')?.remove();resize.disconnect();statusEditor=null;};
  const status=(editor,message)=>{if(!modelText(editor)?.trim()){clear();return;}if(statusEditor!==editor){resize.disconnect();statusEditor=editor;resize.observe(editor);}let n=document.getElementById('bi-teams-outgoing-status');if(!n){n=document.createElement('div');n.id='bi-teams-outgoing-status';Object.assign(n.style,{position:'fixed',transform:'translate(-50%,-100%)',zIndex:'2147483647',background:'#365fc9',color:'#fff',borderRadius:'8px',padding:'8px 12px',font:'600 13px system-ui',pointerEvents:'none'});document.body.append(n);}n.textContent=message;position();};
  const valid=j=>job===j&&j.editor.isConnected&&chat()===j.chat&&enabled();
  const reconcile=()=>{if(job?.writing)return;if(job&&(!valid(job)||modelText(job.editor)!==(job.phase==='ready'?job.result:job.source))){job=null;clear();}if(statusEditor&&!modelText(statusEditor)?.trim())clear();};
  const block=e=>{e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();};
  function intent(e,editor){if(!editor||!enabled())return;reconcile();const source=modelText(editor);if(source===null){block(e);status(editor,'输入框尚未就绪，未发送。');return;}if(!source.trim())return;
    if(job?.phase==='ready'&&job.editor===editor&&job.result===source&&!/\p{Script=Han}/u.test(source)){if(e.type==='keydown'){block(e);const button=document.querySelector(sendSelector);if(!button||button.disabled||button.getAttribute('aria-disabled')==='true'){status(editor,'发送按钮尚未就绪，请稍后再次确认。');return;}job=null;clear();button.click();return;}job=null;clear();return;}
    if(job&&['translating','writing'].includes(job.phase)){block(e);return;}
    if(!/\p{Script=Han}/u.test(source))return;
    block(e);if(!plainModel(editor)){status(editor,'此草稿含特殊内容，请使用纯文字翻译，未发送。');return;}
    const j={editor,source,chat:chat(),phase:'translating',interrupted:false,button:e.type==='click'?e.target.closest?.(sendSelector):null};job=j;status(editor,'正在翻译，请稍候…');
    const timer=setTimeout(()=>{if(valid(j)){job=null;status(editor,'翻译超时，未发送。请再次按回车重试。');}},45000);
    Promise.resolve().then(()=>window.__biTeamsTranslate('__BITALKS_LAYOUT_CONTEXT_V2__'+JSON.stringify(source),'en')).then(result=>{if(!valid(j)||modelText(editor)!==source)return;if(composing||j.interrupted||!document.hasFocus()||(!editor.contains(document.activeElement)&&document.activeElement!==j.button)){job=null;clear();return;}result=String(result||'');if(!result.trim()||/\p{Script=Han}/u.test(result))throw Error('未获得完整英文译文');j.phase='writing';j.writing=true;try{if(!write(editor,result))throw Error('译文未完整写入');}finally{j.writing=false;}j.result=modelText(editor);j.phase='ready';status(editor,'已翻译，请确认译文，再按一次回车发送。');}).catch(err=>{if(valid(j)){job=null;status(editor,(err?.message||'翻译失败')+'，未发送。请重试。');}}).finally(()=>clearTimeout(timer));
  }
  const on=(event,fn)=>window.addEventListener(event,fn,{capture:true,signal:abort.signal});
  on('compositionstart',e=>{if(editorFor(e.target)){composing=true;if(job)job.interrupted=true;}});on('compositionend',()=>{composing=false;});
  on('keydown',e=>{const editor=editorFor(e.target);if(!editor)return;if(job?.phase==='translating'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Tab'].includes(e.key))job.interrupted=true;if(e.key!=='Enter'||e.shiftKey||e.altKey||e.metaKey)return;if(!enabled())return;if(e.isComposing||e.keyCode===229||composing){imeEnter=true;e.stopImmediatePropagation();return;}if(held||e.repeat){block(e);return;}held=true;intent(e,editor);});
  on('keypress',e=>{if(e.key==='Enter'&&imeEnter)e.stopImmediatePropagation();});on('keyup',e=>{if(e.key==='Enter'){held=false;if(imeEnter){imeEnter=false;e.stopImmediatePropagation();}}});
  on('pointerdown',()=>{if(job?.phase==='translating')job.interrupted=true;});
  on('click',e=>{const b=e.target.closest?.(sendSelector);if(!b)return;const editors=[...document.querySelectorAll(editorSelector)].filter(n=>n.getClientRects().length);if(editors.length===1)intent(e,editors[0]);});
  on('input',reconcile);on('blur',()=>{held=false;reconcile();});on('resize',position);on('scroll',position);
  const cache=new Map(),pending=new Map(),failures=new WeakMap();let active=0,engineGeneration=0,lastEngine='';
  const syncEngine=()=>{const next=document.documentElement.getAttribute('data-bi-translation-engine')||'';if(next!==lastEngine){lastEngine=next;engineGeneration++;cache.clear();document.querySelectorAll('[data-bi-teams-translation]').forEach(n=>n.remove());}};
  const messageSelector='[data-tid="chat-pane-message"] [data-message-content]';
  function sourceOf(node){const clone=node.cloneNode(true);clone.querySelectorAll('[data-bi-teams-translation]').forEach(n=>n.remove());const read=n=>n.nodeType===3?n.data:n.nodeType!==1?'':n.tagName==='BR'?'\n':[...n.childNodes].map(read).join('')+(/^(P|DIV|LI)$/.test(n.tagName)?'\n':'');return [...clone.childNodes].map(read).join('').replace(/\n$/,'');}
  function render(node,source,result,id,error=false){if(!node.isConnected||chat()!==id||!enabled()||sourceOf(node)!==source)return;let n=node.querySelector('[data-bi-teams-translation]');if(!n){n=document.createElement('div');n.setAttribute('data-bi-teams-translation','');Object.assign(n.style,{display:'block',whiteSpace:'pre-wrap',marginTop:'5px',lineHeight:'1.5',fontSize:'var(--bi-talks-translation-size,15px)',color:'var(--bi-talks-translation-color,#6264a7)'});node.append(n);}if(n.textContent!==result)n.textContent=result;n.onclick=error?e=>{e.stopPropagation();failures.delete(node);n.remove();scan();}:null;n.style.cursor=error?'pointer':'text';}
  function controls(){const id=chat(),header=document.querySelector('[data-tid="entity-header-toolbar"]');let b=document.getElementById('bi-teams-chat-translation');if(!id||!header){b?.remove();return;}if(!b){b=document.createElement('button');b.id='bi-teams-chat-translation';b.type='button';b.setAttribute('role','switch');Object.assign(b.style,{padding:'6px 10px',margin:'0 8px',border:'1px solid #8b8cc7',borderRadius:'8px',font:'600 12px system-ui',whiteSpace:'nowrap',flexShrink:'0',cursor:'pointer'});b.onclick=e=>{e.preventDefault();e.stopPropagation();const id=chat();if(!id||!master())return;const next={...prefs,[id]:prefs[id]===false};try{localStorage.setItem(prefKey,JSON.stringify(next));prefs=next;job=null;clear();scan();}catch{b.title='保存失败，请重试';}};header.prepend(b);}const on=enabled(),label=master()?'此聊天翻译：'+(on?'开':'关'):'此聊天翻译：账号已关闭';if(b.textContent!==label)b.textContent=label;if(b.disabled===master())b.disabled=!master();if(b.getAttribute('aria-checked')!==String(on)){b.setAttribute('aria-checked',String(on));b.style.background=on?'#6264a7':'#e8e8ef';b.style.color=on?'#fff':'#323348';}}
  function scan(){syncEngine();controls();reconcile();position();if(!enabled()){document.querySelectorAll('[data-bi-teams-translation]').forEach(n=>n.remove());clear();return;}if(document.visibilityState==='hidden')return;const generation=engineGeneration;const id=chat();for(const node of document.querySelectorAll(messageSelector)){if(node.closest('[contenteditable=true]'))continue;const r=node.getBoundingClientRect();if(!r.width||r.bottom<0||r.top>innerHeight+100)continue;const source=sourceOf(node);if(!/\p{Script=Latin}/u.test(source))continue;if(cache.has(source)){render(node,source,cache.get(source),id);continue;}if((failures.get(node)||0)>Date.now())continue;if(active>=2&&!pending.has(source))continue;let task=pending.get(source);if(!task){active++;task=Promise.resolve().then(()=>window.__biTeamsTranslate(source,'zh')).then(result=>{if(generation!==engineGeneration)throw Error('Engine changed');result=String(result||'');if(!result.trim())throw Error('empty');cache.set(source,result);if(cache.size>500)cache.delete(cache.keys().next().value);return result;}).finally(()=>{active--;pending.delete(source);});pending.set(source,task);}if(node.__biTeamsPending===source)continue;node.__biTeamsPending=source;render(node,source,'正在翻译…',id);task.then(result=>{if(generation===engineGeneration)render(node,source,result,id)}).catch(()=>{if(generation!==engineGeneration)return;failures.set(node,Date.now()+30000);render(node,source,'翻译失败，点击重试',id,true);}).finally(()=>{delete node.__biTeamsPending;});}}
  let scheduled;const observer=new MutationObserver(records=>{reconcile();if(records.every(r=>(r.target.nodeType===1?r.target:r.target.parentElement)?.closest?.('[data-bi-teams-translation],#bi-teams-chat-translation,#bi-teams-outgoing-status')))return;if(!scheduled)scheduled=setTimeout(()=>{scheduled=null;scan();},200);});observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  const timer=setInterval(scan,1000);scan();window.__biTeamsTranslation={version:3,scan,modelText,write,destroy(){job=null;abort.abort();resize.disconnect();observer.disconnect();clearInterval(timer);clearTimeout(scheduled);clear();document.getElementById('bi-teams-chat-translation')?.remove();document.querySelectorAll('[data-bi-teams-translation]').forEach(n=>n.remove());delete window.__biTeamsTranslation;}};
}


function start() {
  if(platform === 'zoom') {
    electron.contextBridge.exposeInMainWorld('__biZoomTranslate', text=>electron.ipcRenderer.invoke('translate:text',String(text),'en','auto'));
    electron.contextBridge.executeInMainWorld({func:installZoomChatControl,args:[accountId]});
    electron.contextBridge.executeInMainWorld({func:installZoomImeGuard,args:[]});
    electron.contextBridge.executeInMainWorld({func:installZoomNotes,args:[accountId]});
    electron.contextBridge.executeInMainWorld({func:installZoomOutgoing});
  }
  if(platform === "zoom") installZoomMessageTranslation();
  if(platform === "phound") installPhoundIncomingTranslation();
  installTwoStepTranslation({platform,enabled:()=>translationEnabled()&&(platform!=='zoom'||document.documentElement.getAttribute('data-bi-zoom-chat-enabled')==='true'),translate:text=>electron.ipcRenderer.invoke("translate:text",text,"en","auto")});
  document.documentElement.style.setProperty("--bi-talks-translation-enabled", initialEnabled ? "true" : "false");
  if(platform === 'teams' && ['teams.live.com','teams.microsoft.com','teams.cloud.microsoft'].includes(location.hostname)){
    electron.contextBridge.exposeInMainWorld('__biTeamsTranslate',(text,target)=>electron.ipcRenderer.invoke('translate:text',String(text),target==='zh'?'zh':'en','auto'));
    electron.contextBridge.executeInMainWorld({func:installTeamsTranslation,args:[accountId]});
  }
  new MutationObserver(()=>{window.__biTalksTwoStepTranslation?.syncPreferences?.();if(translationEnabled() && platform==='whatsapp')registerMessages(document);}).observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  if (platform === "whatsapp") {
    messageVisibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const host = entry.target;
        if (!(host instanceof HTMLElement)) continue;
        if (entry.isIntersecting) {
          visibleHosts.add(host);
          queueMessage(host);
        } else {
          visibleHosts.delete(host);
          pendingHosts.delete(host);
        }
      }
    }, { root: null, rootMargin: "220px 0px 260px", threshold: 0 });
    registerMessages(document);
    new MutationObserver((records) => {
      handleMutations(records);
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const chat = document.querySelector('#main,[data-testid="conversation-panel-messages"]');
      if (chat) registerMessages(chat);
    });

  }
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
