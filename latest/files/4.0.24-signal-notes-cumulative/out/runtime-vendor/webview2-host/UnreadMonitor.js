(function installUnreadMonitor(platform, report) {
  if(platform==='zoom'&&typeof report==='function'&&location.hostname==='app.zoom.us'){(function installZoomUnread(report) {
  if(window.__biZoomUnreadV3)return;window.__biZoomUnreadV3=true;
  const rows=new Map();let previousTotal,started=Date.now(),sequence=0;
  const documents=()=>{const ds=[document];for(let i=0;i<ds.length;i++)for(const f of ds[i].querySelectorAll('iframe'))try{if(f.contentDocument&&!ds.includes(f.contentDocument))ds.push(f.contentDocument);}catch{}return ds;};
  function scan(){
    const found=new Map();let total;
    for(const d of documents()){
      for(const n of d.querySelectorAll('[aria-label]')){const a=n.getAttribute('aria-label')||'';if(!/^(All|全部|所有)(?:,|，|\s)/i.test(a))continue;const m=a.match(/(\d+)\s*unread notifications/i)||a.match(/(\d+)\s*条?未读/);if(m)total=Math.max(total||0,Number(m[1]));}
      for(const r of d.querySelectorAll('[data-sessionid]')){
        const id=r.getAttribute('data-sessionid');if(!id)continue;
        let count=0;
        for(const n of r.querySelectorAll('[data-testid*="unread" i],[class*="unread" i],[aria-label*="unread" i],[data-unread-count],.MuiBadge-badge')){
          if(n.closest('[class*="Avatar"],[class*="avatar"]'))continue;
          const label=n.getAttribute('aria-label')||'',v=n.getAttribute('data-unread-count')||n.textContent.trim();
          const m=v.match(/^(\d+)\+?$/)||label.match(/(\d+)\s*unread/i);if(m)count=Math.max(count,Number(m[1]));else if(/unread/i.test(label)&&!/no unread|0 unread|mark.*unread/i.test(label))count=Math.max(count,1);
        }
        const contact=r.querySelector('[data-testid="session_item_name"]')?.textContent.trim()||'';
        const snippet=r.querySelector('[data-testid*="last_message"],[class*="lastMessage"],[class*="messagePreview"],[class*="snippet"]');
        const text=snippet?.textContent.trim()||'';
        const time=r.querySelector('time,[data-timestamp]')?.textContent||'';
        const last=r.getAttribute('data-last-message-id')||snippet?.getAttribute('data-message-id')||'';
        const row={count,contact,text,time,last};if(!found.has(id)||found.get(id).count<count)found.set(id,row);
      }
    }
    if(!found.size&&total===undefined)return;
    let delta=0;const messages=[];
    for(const [id,r] of found){const old=rows.get(id);if(old)delta+=r.count-old.count;
      const changed=old&&(r.text!==old.text||r.time!==old.time||r.last!==old.last);
      if(Date.now()-started>=8000&&r.count>0&&((old&&(r.count>old.count||changed))||(!old&&total>previousTotal))&&!/^(You|你|您)[:：]/i.test(r.text)){
        messages.push({conversationId:id,contact:r.contact,text:r.text||'收到一条新消息',time:r.time,messageId:id+':'+(r.last||JSON.stringify([r.text,r.time,r.count,++sequence,started]))});
      }rows.set(id,r);
    }
    const count=Math.min(999,total===undefined?[...found.values()].reduce((s,r)=>s+r.count,0):total);
    if(total!==undefined&&previousTotal!==undefined&&total>previousTotal&&Date.now()-started>=8000&&!messages.length)messages.push({contact:'',text:'收到新消息，请打开 Zoom 查看',messageId:'zoom-unread:'+started+':'+(++sequence)});
    report({count,domCount:count,partial:total===undefined,delta,trustedDecrease:total!==undefined,preview:{messages}});previousTotal=total;
  }
  const timer=setInterval(scan,1200);window.addEventListener('unload',()=>clearInterval(timer),{once:true});scan();
}
)(report);return;}
  if (window.__biTalksUnifiedUnreadInstalled === 2 || typeof report !== 'function') return;
  const hosts = { whatsapp: ['web.whatsapp.com'], telegram: ['web.telegram.org'], zoom: ['app.zoom.us'], phound: ['app.phound.app','web.phound.app','app.phound.com'], googlevoice: ['voice.google.com'], googlechat: ['chat.google.com', 'mail.google.com'] };
  if (platform !== 'signal' && !hosts[platform]?.includes(location.hostname)) return;
  if (platform === 'googlechat' && location.hostname === 'mail.google.com' && !location.pathname.startsWith('/chat/')) return;
  window.__biTalksUnifiedUnreadInstalled = 2;
  const rowSelectors = {
    whatsapp: '#pane-side [role="row"],#pane-side [role="listitem"],#pane-side [data-testid="cell-frame-container"]',
    telegram: '.chatlist-chat[data-peer-id],.chatlist [data-peer-id],.chat-list [data-peer-id]',
    zoom: '[data-testid="chat-list-item"],[data-testid="conversation-item"],.chat-list-item,.session-list-item',
    googlevoice: '[data-thread-id],gv-thread-item,gv-conversation-list-item,[role="listitem"],[role="row"]',
    googlechat: '[data-space-id],[data-dm-id],[role="navigation"] [role="listitem"],[role="navigation"] [role="link"]',
    phound: '[data-conversation-id],[data-chat-id],[data-testid="conversation-item"],[data-testid="chat-list-item"]',
    signal: '[data-conversation-id],[data-testid*="conversation-list-item" i],.module-conversation-list__item,[role="listitem"]'
  };
  const markerSelector = '[aria-label*="unread" i],[aria-label*="new message" i],[aria-label*="未读"],[aria-label*="新消息"],[data-testid*="unread" i],[data-icon*="unread" i],[data-unread="true"],[data-is-unread="true"],.unread,[class*="unread-badge" i],.chatlist-chat-badge';
  const rows = new Map();
  let notificationPreview, previewAt = 0;
  const messageSnapshots = new Map(), pendingMessages = new Map();
  const startedAt = Date.now();
  function capturePreview(row, increased, unread, count) {
    const name = row.querySelector('[data-testid="cell-frame-title"],.gvThreadLabel,.contact,.peer-title,.chat-title,.name,.title,[class*="sender-name"],[class*="contact-name"],[class*="thread-name"],[class*="conversation-name"],[title]');
    const message = row.querySelector('[data-testid="last-msg"],.gvThreadSnippet,.message-preview,.message-text,[data-testid="cell-frame-secondary"],.last-message,.chatlist-chat-subtitle,.subtitle,[class*="snippet"],[class*="preview"],[class*="last-message"]');
    const contact = (name?.textContent || name?.getAttribute('title') || '').trim();
    const copy = message?.cloneNode(true);
    copy?.querySelectorAll('[data-unified-translation],[data-bi-talks-google-voice-translation],[data-bitalks-chat-translation]').forEach(node=>node.remove());
    let text = (copy?.textContent || '').replace(/\s+/g,' ').trim();
    if (!text) {
      const media = row.querySelector('[data-icon*="image"],[data-icon*="photo"],[data-icon*="document"],[data-icon*="audio"],[data-icon*="video"]');
      const kind = media?.getAttribute('data-icon') || '';
      text = /image|photo/.test(kind) ? '[图片]' : /document/.test(kind) ? '[文件]' : /audio/.test(kind) ? '[语音]' : /video/.test(kind) ? '[视频]' : '';
    }
    const conversationId = typeof identity(row) === 'string' ? identity(row) : contact;
    const timeNode = row.querySelector('time,[datetime],[data-timestamp]');
    const time = timeNode?.getAttribute('datetime') || timeNode?.getAttribute('data-timestamp') || timeNode?.textContent || '';
    const snapshot = JSON.stringify([text, time]);
    const previous = messageSnapshots.get(conversationId);
    messageSnapshots.set(conversationId, snapshot);
    if (!contact || !text || previous === undefined || Date.now()-startedAt < 8000 || (!increased && previous === snapshot) || !unread) return;
    if (/^(?:You:|你[:：]|您[:：])/i.test(text)) return;
    const nativeId = row.getAttribute('data-last-message-id') || message?.getAttribute('data-message-id');
    const messageId = nativeId ? conversationId + ':' + nativeId : JSON.stringify([conversationId,text,time,count]);
    pendingMessages.set(messageId,{contact:contact.slice(0,160),text:text.slice(0,240),conversationId,time,messageId});
    previewAt=Date.now();
  }
  let lastCount, candidate, since = 0, timer, lastSnapshot = '', retryTimer;
  let lastTitle, titleAdjustment = 0, pendingDelta = 0, readObserved = false;
  function number(text) {
    const s = String(text || '').trim();
    const m = s.match(/^(\d{1,4})\+?$/) || s.match(/(\d{1,4})\s*(?:unread|new|条未读|条新消息)/i) || s.match(/(?:unread|new messages?|未读)\D{0,5}(\d{1,4})/i);
    return m ? Math.min(999, Number(m[1])) : undefined;
  }
  function displayed(element) {
    return getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0;
  }
  function identity(row) {
    for (const key of ['data-peer-id','data-conversation-id','data-thread-id','data-space-id','data-dm-id','data-id']) {
      const value = row.getAttribute(key) || row.querySelector('[' + key + ']')?.getAttribute(key);
      if (value) return key + ':' + value;
    }
    const link = row.matches('a[href]') ? row : row.querySelector('a[href]');
    if (link) return 'href:' + link.getAttribute('href');
    const title = row.querySelector('[title]')?.getAttribute('title');
    return title ? 'title:' + title : row;
  }
function whatsappAllRead() {
  if (platform !== 'whatsapp' || document.readyState !== 'complete') return false;
  if (!/^WhatsApp(?: Business)?$/i.test(document.title.trim())) return false;
  const side = document.querySelector('#side'), pane = document.querySelector('#pane-side');
  if (!side || !pane || !displayed(pane)) return false;
  const all = side.querySelector('[role="tab"][aria-selected="true"]');
  if (!all || !/^(All|全部|所有)$/i.test(all.textContent.trim())) return false;
  if ([...side.querySelectorAll('input,[contenteditable="true"]')].some(n => String(n.value ?? n.textContent ?? '').trim())) return false;
  if (side.querySelector('[aria-busy="true"],[role="progressbar"]')) return false;
  const grid = pane.querySelector('[role="grid"][aria-rowcount]');
  if (!grid) return false;
  const total = Number(grid.getAttribute('aria-rowcount'));
  const current = [...grid.querySelectorAll('[role="row"]')].filter(displayed);
  if (!Number.isInteger(total) || total < 0 || current.length !== total) return false;
  // A complete list and an unnumbered app title must agree before overriding history.
  if ([...side.querySelectorAll(markerSelector)].some(n => displayed(n) && !n.closest('[role="tab"],button') && !/mark as unread|标为未读|标记为未读/i.test(n.getAttribute('aria-label') || ''))) return false;
  return true;
}

  let whatsappZeroSince;
  function scan() {
    timer = undefined;
    const title = document.title.trim();
    const titleMatch = title.match(/^\((\d{1,4})\)\s/) || title.match(/^\[(\d{1,4})\]\s/) || title.match(/^(?:Signal|Telegram|WhatsApp|Google Voice|Google Chat|Zoom)\s*\((\d{1,4})\)$/i);
    const titleTotal = titleMatch ? Math.min(999, Number(titleMatch[1])) : undefined;
    const visibleRows = [...document.querySelectorAll(rowSelectors[platform] || '[data-no-unread-adapter]')].filter(displayed);
    const titleChanged = titleTotal !== lastTitle;
    if (titleChanged) { lastTitle = titleTotal; titleAdjustment = 0; }
    let confirmedRead = false;
    for (const row of visibleRows) {
      // Never count message-body unread separators or global filter buttons.
      if (row.closest('[data-unified-translation],[data-bi-talks-google-voice-translation],[data-bitalks-chat-translation],[contenteditable="true"],[role="log"]')) continue;
      const key = identity(row);
      const markers = [...row.querySelectorAll(markerSelector)];
      if (row.matches(markerSelector)) markers.push(row);
      let count = 0;
      for (const marker of markers.filter(displayed)) {
        const label = [marker.getAttribute('aria-label'), marker.getAttribute('title'), marker.textContent].filter(Boolean).join(' ').trim();
        if (/\b(?:no unread|mark as unread|mark unread)\b|没有未读|标为未读|标记为未读/i.test(label)) continue;
        const badgeValue = number(marker.textContent) ?? number(marker.getAttribute('aria-label')) ?? number(marker.getAttribute('title'));
        if (badgeValue !== undefined) count = Math.max(count, badgeValue);
        else if (/unread|new message|未读|新消息/i.test(label) || marker.matches('[data-unread="true"],[data-is-unread="true"],.unread,[class*="unread-badge" i]')) count = Math.max(count, 1);
      }
      if (rows.has(key)) {
        const delta = count - rows.get(key);

        pendingDelta += delta;
        if (!titleChanged && titleTotal !== undefined) titleAdjustment += delta;
        if (delta < 0) { confirmedRead = true; readObserved = true; }
      }
      capturePreview(row, rows.has(key) && count > rows.get(key), count > 0, count);
      rows.set(key, count);
    }
    const whatsappZeroCandidate = whatsappAllRead();
    if (!whatsappZeroCandidate) whatsappZeroSince = undefined;
    else if (whatsappZeroSince === undefined) whatsappZeroSince = Date.now();
    const whatsappZero = whatsappZeroCandidate && Date.now() - whatsappZeroSince >= 1500;
    if (whatsappZero) { rows.clear(); pendingDelta = 0; titleAdjustment = 0; }
    // A virtualized/filtered list is a partial observation, not an account total.
    const domTotal = [...rows.values()].reduce((sum, count) => sum + count, 0);
    const count = titleTotal !== undefined ? Math.max(0, Math.min(999, titleTotal + titleAdjustment)) : Math.min(999, domTotal);
    if (titleTotal === undefined && visibleRows.length === 0 && !whatsappZero) return;
    const snapshot = JSON.stringify([count, whatsappZero ? 'whatsapp-all-read' : titleTotal !== undefined ? 'title' : 'rows']);
    if (snapshot !== candidate) { candidate = snapshot; since = Date.now(); }
    const delay = lastCount !== undefined && count < lastCount ? 900 : 300;
    if (Date.now() - since < delay) { clearTimeout(retryTimer); retryTimer = setTimeout(schedule, Math.max(1, delay - (Date.now() - since))); return; }
    if (snapshot === lastSnapshot && pendingDelta === 0 && !pendingMessages.size) return;
    lastSnapshot = snapshot;
    const sample = { count, titleCount: count, domCount: count, trustedDecrease: readObserved || whatsappZero, delta: pendingDelta, partial: titleTotal === undefined && !whatsappZero, source: titleTotal !== undefined ? 'title' : 'rows' };
    lastCount = count;
    pendingDelta = 0; readObserved = false;
    if (pendingMessages.size) sample.preview = {messages:[...pendingMessages.values()]};
    pendingMessages.clear();
    notificationPreview = undefined;
    try { report(sample); } catch { lastSnapshot = ''; }
  }
  function schedule() { if (!timer) timer = setTimeout(scan, platform === 'googlechat' ? 350 : 120); }
  window.__biTalksRescanUnread = () => { lastSnapshot = ''; schedule(); };
  function start() {
    new MutationObserver(changes => {
      if(platform!=='googlechat'){schedule();return;}
      const ignored='[data-bitalks-chat-translation],#bi-talks-two-step-status,#bitalks-chat-status,[contenteditable="true"]';
      if(changes.some(change=>{
        const target=change.target instanceof Element?change.target:change.target.parentElement;
        if(!target || target.closest(ignored))return false;
        if(target.closest('title') || target.closest(rowSelectors.googlechat))return true;
        return [...change.addedNodes,...change.removedNodes].some(node=>node instanceof Element && (node.matches(rowSelectors.googlechat)||node.querySelector(rowSelectors.googlechat)));
      }))schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label','title','class','data-unread','data-is-unread'] });
    schedule();
  }
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  addEventListener('scroll', schedule, true);
  addEventListener('visibilitychange', schedule);
  setInterval(schedule, 1200);
})
