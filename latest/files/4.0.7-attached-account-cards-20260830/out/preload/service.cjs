"use strict";
const electron = require("electron");
const platform = process.argv.find((value) => value.startsWith("--service-platform="))?.split("=")[1] || "";
const accountId = process.argv.find((value) => value.startsWith("--service-account="))?.split("=")[1] || "";
const initialColor = process.argv.find((value) => value.startsWith("--translation-color="))?.slice("--translation-color=".length) || "#d8ff00";
const initialSize = Number(process.argv.find((value) => value.startsWith("--translation-size="))?.slice("--translation-size=".length) || "15");
const initialEnabled = process.argv.find((value) => value.startsWith("--translation-enabled="))?.slice("--translation-enabled=".length) !== "false";
const processed = /* @__PURE__ */ new WeakMap();
const translating = /* @__PURE__ */ new WeakMap();
const expanding = /* @__PURE__ */ new WeakSet();
const activeHosts = /* @__PURE__ */ new WeakSet();
const visibleHosts = /* @__PURE__ */ new WeakSet();
const pendingHosts = /* @__PURE__ */ new Set();
let scanTimer;
let scanRunning = false;
let translationsInFlight = 0;
let lastUnread = -1;
let lastUnreadReport = "";
let lastTrustedUnreadInteraction = 0;
let trustedUnreadCeiling;
let unreadCandidate = -1;
let unreadCandidateSince = 0;
let unreadStabilityTimer;
const maxConcurrentTranslations = 4;
let messageVisibilityObserver;
const serviceWindow = window;
let databaseErrorCheckTimer;
let databaseErrorReported = false;
let databaseHealthyReported = false;
function whatsappDatabaseErrorEvidence() {
  if (platform !== "whatsapp" || databaseErrorReported || !accountId) return void 0;
  const host = location.hostname.toLowerCase();
  if (host !== "whatsapp.com" && !host.endsWith(".whatsapp.com")) return void 0;
  if (document.querySelector('#main,[data-testid="conversation-panel-messages"]')) return void 0;
  const text = normalizeText(document.body?.innerText || document.body?.textContent || "", 16e3);
  if (!text) return void 0;
  const databaseError = /(?:数据库|資料庫).{0,40}(?:错误|錯誤).{0,100}重新(?:连接|連接|連結).{0,40}(?:设备|裝置)|(?:database.{0,30}(?:error|issue)|(?:error|issue).{0,30}database).{0,140}(?:reconnect|relink).{0,60}(?:device|phone)/isu;
  if (!databaseError.test(text)) return void 0;
  return text.slice(0, 500);
}
function scheduleWhatsappDatabaseErrorCheck(delay = 700) {
  if (platform !== "whatsapp" || databaseErrorReported || databaseErrorCheckTimer) return;
  databaseErrorCheckTimer = setTimeout(() => {
    databaseErrorCheckTimer = void 0;
    const evidence = whatsappDatabaseErrorEvidence();
    if (evidence) {
      databaseErrorReported = true;
      electron.ipcRenderer.send("whatsapp:database-error", { accountId, url: location.href, evidence });
      return;
    }
    if (!databaseHealthyReported && document.querySelector('#main,[data-testid="conversation-panel-messages"]')) {
      databaseHealthyReported = true;
      electron.ipcRenderer.send("whatsapp:database-healthy", { accountId });
    }
  }, delay);
}
function translationEnabled() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--bi-talks-translation-enabled").trim();
  return value ? value !== "false" : initialEnabled;
}
function normalizeText(raw, maxLength = 9e3) {
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
  return text.length >= 2 && /[A-Za-z]/.test(text) && !/[\u3400-\u9fff]/u.test(text);
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
  if (existing?.dataset.sourceKey === key) return;
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
    padding: "5px 7px",
    borderTop: "1px solid rgba(128,128,128,.25)",
    borderRadius: "6px",
    background: "#000",
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
async function translateHost(host) {
  if (!chatIsReady() || translationsInFlight >= maxConcurrentTranslations || activeHosts.has(host)) return;
  activeHosts.add(host);
  translationsInFlight += 1;
  try {
    await expandCollapsedMessage(host);
    if (!host.isConnected || !chatIsReady()) return;
    const text = messageText(host);
    if (!text) return;
    const key = sourceKey(text);
    const existing = existingTranslation(host);
    if (!isEnglishOnly(text)) {
      processed.set(host, key);
      if (existing) existing.remove();
      return;
    }
    if (processed.get(host) === key && existing?.dataset.sourceKey === key) return;
    if (translating.get(host) === key) return;
    processed.set(host, key);
    translating.set(host, key);
    if (existing && existing.dataset.sourceKey !== key) existing.remove();
    const translated = await electron.ipcRenderer.invoke("translate:text", text, "zh", "en");
    if (translated && translated !== text && host.isConnected) appendTranslation(host, text, translated, key);
  } catch {
    processed.delete(host);
  } finally {
    translating.delete(host);
    activeHosts.delete(host);
    translationsInFlight = Math.max(0, translationsInFlight - 1);
    if (pendingHosts.size) scheduleScan(16);
  }
}
function scan() {
  scanTimer = void 0;
  if (scanRunning || !chatIsReady()) return;
  scanRunning = true;
  try {
    for (const host of pendingHosts) {
      pendingHosts.delete(host);
      if (!host.isConnected) {
        messageVisibilityObserver?.unobserve(host);
        continue;
      }
      if (!visibleHosts.has(host)) continue;
      if (translationsInFlight >= maxConcurrentTranslations) {
        pendingHosts.add(host);
        break;
      }
      void translateHost(host);
    }
  } finally {
    scanRunning = false;
  }
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
function unreadValue(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(\d{1,4})\s*(?:unread|new)\s*(?:messages?|chats?)?/i) || normalized.match(/(?:unread|new)\s*(\d{1,4})/i) || normalized.match(/(\d{1,4})\s*条(?:未读|新)消息/u) || normalized.match(/^[([]?(\d{1,4})[)\]]?$/);
  const value = Number(match?.[1] || 0);
  return Number.isFinite(value) ? Math.min(999, Math.max(0, Math.round(value))) : 0;
}
function titleUnreadCount() {
  const title = (document.title || "").replace(/\s+/g, " ").trim();
  const match = title.match(/^\((\d{1,4})\)\s*/) || title.match(/^\[(\d{1,4})\]\s*/) || title.match(/^(\d{1,4})\s+(?:unread|new)\b/i) || title.match(/(?:unread|new)\s+(\d{1,4})\b/i);
  return Math.min(999, Math.max(0, Number(match?.[1] || 0)));
}
function unreadMarkerCount(marker) {
  const signature = [
    marker.getAttribute("aria-label"),
    marker.getAttribute("title"),
    marker.getAttribute("data-testid"),
    marker.getAttribute("data-icon"),
    marker.textContent
  ].filter(Boolean).join(" ");
  return unreadValue(signature) || 1;
}
function unreadDomCount() {
  if (platform !== "whatsapp" && platform !== "telegram") return 0;
  const selector = platform === "whatsapp" ? '[aria-label*="unread" i],[aria-label*="new message" i],[data-testid*="unread" i],[data-icon*="unread" i]' : '[aria-label*="unread" i],[aria-label*="new message" i],[data-testid*="unread" i],[data-unread="true"],[class~="unread"],[class*="is-unread" i],[class*="unread-badge" i]';
  const rowSelector = platform === "whatsapp" ? '[role="listitem"],[role="row"],[data-testid*="cell-frame" i],li' : '[role="listitem"],[role="row"],[data-peer-id],[class*="chatlist-chat" i],[class*="chat-list-item" i],li';
  const rowCounts = /* @__PURE__ */ new Map();
  document.querySelectorAll(selector).forEach((marker) => {
    if (marker.closest("[data-unified-translation]")) return;
    const rect = marker.getBoundingClientRect();
    const style = getComputedStyle(marker);
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return;
    if (rect.right < 0 || rect.left > innerWidth * 0.62 || rect.bottom < 0 || rect.top > innerHeight) return;
    const value = unreadMarkerCount(marker);
    const row = marker.closest(rowSelector);
    if (!row) return;
    rowCounts.set(row, Math.max(rowCounts.get(row) || 0, value));
  });
  const rowTotal = [...rowCounts.values()].reduce((sum, value) => sum + value, 0);
  return Math.min(999, rowTotal);
}
function reportUnread() {
  if (!accountId) return;
  const now = Date.now();
  const titleCount = titleUnreadCount();
  const domCount = unreadDomCount();
  const trustedWindow = now - lastTrustedUnreadInteraction < 3500;
  if (!trustedWindow) trustedUnreadCeiling = void 0;
  const rawCount = Math.max(titleCount, domCount);
  const count = trustedWindow && trustedUnreadCeiling !== void 0 ? Math.min(rawCount, trustedUnreadCeiling) : rawCount;
  if (count !== unreadCandidate) {
    unreadCandidate = count;
    unreadCandidateSince = now;
    if (unreadStabilityTimer) clearTimeout(unreadStabilityTimer);
    unreadStabilityTimer = void 0;
  }
  const stableFor = lastUnread < 0 ? 700 : count < lastUnread ? trustedWindow ? 80 : 650 : count > lastUnread ? 220 : 0;
  const remaining = stableFor - (now - unreadCandidateSince);
  if (remaining > 0) {
    if (!unreadStabilityTimer) {
      unreadStabilityTimer = setTimeout(() => {
        unreadStabilityTimer = void 0;
        reportUnread();
      }, remaining + 20);
    }
    return;
  }
  if (unreadStabilityTimer) clearTimeout(unreadStabilityTimer);
  unreadStabilityTimer = void 0;
  const trustedDecrease = lastUnread >= 0 && count < lastUnread && trustedWindow;
  const reportKey = `${titleCount}:${domCount}:${count}:${trustedDecrease}`;
  if (reportKey === lastUnreadReport) return;
  lastUnreadReport = reportKey;
  lastUnread = count;
  electron.ipcRenderer.send("service:unread", { accountId, count, titleCount, domCount, trustedDecrease });
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
function installOutgoingTranslation() {
  if (serviceWindow.__biTalksWhatsappOutgoingTranslationInstalled) return;
  serviceWindow.__biTalksWhatsappOutgoingTranslationInstalled = true;
  let pendingEditor;
  let sendSequence = 0;
  const suppressSend = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
  };
  const activeComposer = () => {
    if (document.activeElement instanceof Element) {
      const active = whatsappComposer(document.activeElement);
      if (active) return active;
    }
    return Array.from(document.querySelectorAll('[contenteditable="true"]')).map((candidate) => whatsappComposer(candidate)).filter((candidate) => !!candidate).sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0];
  };
  const isSendControl = (element) => {
    const control = element.closest('button,[role="button"]');
    if (!control) return false;
    const icon = control.querySelector("[data-icon],[data-testid],[aria-label],[title]");
    const signature = `${element.getAttribute("data-icon") || ""} ${element.getAttribute("data-testid") || ""} ${control.getAttribute("data-testid") || ""} ${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""} ${icon?.getAttribute("data-icon") || ""} ${icon?.getAttribute("data-testid") || ""} ${icon?.getAttribute("aria-label") || ""}`.toLowerCase();
    return /(^|[-_\s])send($|[-_\s])|sendbutton|send-button|sendmessage|send-message|发送/u.test(signature);
  };
  const translateThenSend = (event, editor) => {
    if (pendingEditor) {
      suppressSend(event);
      return true;
    }
    const text = composerText(editor);
    if (!/[\u3400-\u9fff]/u.test(text)) return false;
    suppressSend(event);
    pendingEditor = editor;
    const sequence = ++sendSequence;
    showOutgoingStatus("正在翻译中…");
    void electron.ipcRenderer.invoke("translate:text", text, "en", "zh").then(async (translated) => {
      const english = String(translated || "").trim();
      if (!english) {
        showOutgoingStatus("翻译失败，消息未发送。", "error", 2600);
        return;
      }
      if (!editor.isConnected || pendingEditor !== editor || sequence !== sendSequence) return;
      showOutgoingStatus("翻译成功！", "success", 900);
      await new Promise((resolve) => setTimeout(resolve, 90));
      if (!editor.isConnected || pendingEditor !== editor || sequence !== sendSequence) return;
      pendingEditor = void 0;
      const sent = await electron.ipcRenderer.invoke("whatsapp:send-translated", accountId, english);
      showOutgoingStatus(sent ? "发送成功！" : "发送失败，消息仍保留在输入框中。", sent ? "success" : "error", sent ? 1800 : 3e3);
    }).catch(() => {
      showOutgoingStatus("翻译失败，消息未发送。", "error", 2600);
    }).finally(() => {
      setTimeout(() => {
        if (sequence === sendSequence && pendingEditor === editor) pendingEditor = void 0;
      }, 1e3);
    });
    return true;
  };
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    const origin = event.composedPath().find((item) => item instanceof Element);
    const editor = origin ? whatsappComposer(origin) : void 0;
    if (editor) translateThenSend(event, editor);
  }, true);
  const interceptSendControl = (event) => {
    const origin = event.composedPath().find((item) => item instanceof Element);
    if (!origin || !isSendControl(origin)) return;
    const editor = activeComposer();
    if (editor) translateThenSend(event, editor);
  };
  document.addEventListener("pointerdown", interceptSendControl, true);
  document.addEventListener("click", interceptSendControl, true);
  for (const type of ["keypress", "keyup"]) {
    document.addEventListener(type, (event) => {
      if (event.key === "Enter" && pendingEditor) suppressSend(event);
    }, true);
  }
}
function start() {
  document.documentElement.style.setProperty("--bi-talks-translation-enabled", initialEnabled ? "true" : "false");
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
      scheduleWhatsappDatabaseErrorCheck();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const chat = document.querySelector('#main,[data-testid="conversation-panel-messages"]');
      if (chat) registerMessages(chat);
    });
    installOutgoingTranslation();
    scheduleWhatsappDatabaseErrorCheck(1200);
  }
  let unreadTimer;
  const scheduleUnread = (delay = 100) => {
    if (unreadTimer) return;
    unreadTimer = setTimeout(() => {
      unreadTimer = void 0;
      reportUnread();
    }, delay);
  };
  new MutationObserver(() => scheduleUnread()).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "class", "data-testid", "data-unread"]
  });
  document.addEventListener("pointerdown", (event) => {
    const origin = event.composedPath().find((item) => item instanceof Element);
    const row = origin?.closest('[role="listitem"],[role="row"],[data-peer-id],[data-testid*="cell-frame" i],[class*="chatlist-chat" i],li');
    const markers = row?.querySelectorAll('[aria-label*="unread" i],[aria-label*="new message" i],[data-testid*="unread" i],[data-icon*="unread" i],[data-unread="true"],[class~="unread"],[class*="is-unread" i]');
    if (!markers?.length) return;
    const clickedUnread = Math.max(1, ...[...markers].map(unreadMarkerCount));
    lastTrustedUnreadInteraction = Date.now();
    const current = lastUnread >= 0 ? lastUnread : Math.max(titleUnreadCount(), unreadDomCount());
    trustedUnreadCeiling = Math.max(0, current - clickedUnread);
    unreadCandidate = -1;
    scheduleUnread(80);
    setTimeout(() => scheduleUnread(0), 420);
  }, true);
  setInterval(reportUnread, 1200);
  reportUnread();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
