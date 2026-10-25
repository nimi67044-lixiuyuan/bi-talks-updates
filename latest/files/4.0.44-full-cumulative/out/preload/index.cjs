"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  userAccountStatus: () => electron.ipcRenderer.invoke("user-account:status"),
  userAccountRegister: (email, password) => electron.ipcRenderer.invoke("user-account:register", email, password),
  userAccountVerifyRegistration: (email, code) => electron.ipcRenderer.invoke("user-account:verify-registration", email, code),
  userAccountResendRegistration: (email) => electron.ipcRenderer.invoke("user-account:resend-registration", email),
  userAccountPasswordLogin: (email, password) => electron.ipcRenderer.invoke("user-account:password-login", email, password),
  userAccountLogin: () => electron.ipcRenderer.invoke("user-account:login"),
  userAccountRefresh: () => electron.ipcRenderer.invoke("user-account:refresh"),
  userAccountLogout: () => electron.ipcRenderer.invoke("user-account:logout"),
  onUserAccountChanged: (listener) => {
    const wrapped = () => listener();
    electron.ipcRenderer.on("user-account:changed", wrapped);
    return () => electron.ipcRenderer.removeListener("user-account:changed", wrapped);
  },
  translationProviderStatus:()=>electron.ipcRenderer.invoke('translation-provider:status'),
  setTranslationProvider:(enabled)=>electron.ipcRenderer.invoke('translation-provider:set',enabled),
  deepLKeyStatus: () => electron.ipcRenderer.invoke("deepl-key:status"),
  saveDeepLKey: (key) => electron.ipcRenderer.invoke("deepl-key:save", key),
  clearDeepLKey: () => electron.ipcRenderer.invoke("deepl-key:clear"),
  getState: () => electron.ipcRenderer.invoke("state:get"),
  confirmClose: () => electron.ipcRenderer.invoke("window:confirm-close"),
  getUnreadCounts: () => electron.ipcRenderer.invoke("unread:get"),
  setState: (state) => electron.ipcRenderer.invoke("state:set", state),
  activateView: (account) => electron.ipcRenderer.invoke("view:activate", account),
  setViewBounds: (bounds) => electron.ipcRenderer.invoke("view:bounds", bounds),
  captureViewPreview: (account) => electron.ipcRenderer.invoke("view:capture-preview", account),
  setWorkspaceNotice: (message, bounds, progress) => electron.ipcRenderer.send("workspace-notice:set", message, bounds, progress),
  startAccount: (account) => electron.ipcRenderer.invoke("account:start", account),
  refreshAccount: (account) => electron.ipcRenderer.invoke("account:refresh", account),
  closeAccount: (account) => electron.ipcRenderer.invoke("account:close", account),
  applyAccountPreferences: (account) => electron.ipcRenderer.invoke("account:preferences", account),
  setActiveSignalAccount: (accountId, preservePrevious = false) => electron.ipcRenderer.send("signal:set-active-account", accountId, preservePrevious),
  attachSignalWindow: (account, bounds) => electron.ipcRenderer.invoke("signal:attach-window", account, bounds),
  setSignalWindowVisible: (account, visible, bounds) => electron.ipcRenderer.invoke("signal:set-window-visible", account, visible, bounds),
  moveSignalWindow: (account, visible, bounds) => electron.ipcRenderer.send("signal:move-window", account, visible, bounds),
  updateSignalDesktop: (account) => electron.ipcRenderer.invoke("signal:update-desktop", account),
  isSignalDesktopUpdating: () => electron.ipcRenderer.invoke("signal:update-desktop-status"),
  checkAppPatch: () => electron.ipcRenderer.invoke("app-patch:check"),
  downloadAppPatch: () => electron.ipcRenderer.invoke("app-patch:download"),
  applyAppPatch: () => electron.ipcRenderer.invoke("app-patch:apply"),
  removeAccount: (account) => electron.ipcRenderer.invoke("account:remove", account),
  translate: (text, target, source) => electron.ipcRenderer.invoke("translate:text", text, target, source),
  translateStreaming: async (text, target, source, onDelta) => {
    const requestId = crypto.randomUUID();
    const listener = (_event, payload) => {
      if (payload?.requestId === requestId && typeof payload.text === "string") onDelta(payload.text);
    };
    electron.ipcRenderer.on("translate:stream:delta", listener);
    try {
      return await electron.ipcRenderer.invoke("translate:stream", requestId, text, target, source);
    } finally {
      electron.ipcRenderer.removeListener("translate:stream:delta", listener);
    }
  },
  setAppearanceTheme: (mode) => electron.ipcRenderer.invoke("appearance:set-theme", mode),
  setNativeAppearanceEffects: (enabled) => electron.ipcRenderer.invoke("appearance:native-effects", enabled),
  openExternal: (url) => electron.ipcRenderer.invoke("external:open", url),
  onEvent: (listener) => {
    const wrapped = (_, event) => listener(event);
    electron.ipcRenderer.on("app:event", wrapped);
    return () => electron.ipcRenderer.removeListener("app:event", wrapped);
  },
  onWorkspaceNoticeDismissed: (listener) => {
    const wrapped = () => listener();
    electron.ipcRenderer.on("workspace-notice:dismissed", wrapped);
    return () => electron.ipcRenderer.removeListener("workspace-notice:dismissed", wrapped);
  },
  onCloseRequested: (listener) => {
    const wrapped = () => listener();
    electron.ipcRenderer.on("window:close-requested", wrapped);
    return () => electron.ipcRenderer.removeListener("window:close-requested", wrapped);
  }
});
