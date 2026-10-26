import { app, safeStorage, net, WebContentsView, shell, session, dialog, ipcMain, nativeTheme, powerMonitor, Menu, BrowserWindow, screen, nativeImage, Tray, Notification } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync, renameSync, readFileSync, rmSync, promises, createWriteStream, mkdirSync } from "node:fs";
import { join, dirname, resolve, basename, sep, isAbsolute } from "node:path";
import { createServer, get } from "node:http";
import { randomBytes, createHash, createPublicKey, verify, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { rm as rm$1, createReadStream } from "node:original-fs";
import { get as get$1 } from "node:https";
import { readFile, mkdir, appendFile, stat, rm, rename, writeFile, link, copyFile, readdir, lstat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
async function openGoogleLoginWindow(url) {
  const target = new URL(url);
  if (target.origin !== "https://gwhavnuxiavnuqnbhcfy.supabase.co" || target.pathname !== "/auth/v1/authorize") throw Error("Invalid login URL");
  const candidates = [
    join(process.env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    join(process.env.LOCALAPPDATA || app.getPath("userData"), "Google/Chrome/Application/chrome.exe"),
    join(process.env.PROGRAMFILES || "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe")
  ];
  const executable = candidates.find((file) => existsSync(file));
  if (!executable) throw Error("请安装 Chrome 或 Edge，以使用独立安全登录窗口。");
  await new Promise((resolve2, reject) => {
    const child = spawn(executable, [
      "--app=" + target.href,
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=" + join(app.getPath("userData"), "google-login-browser")
    ], { shell: false, detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve2();
    });
  });
}
const base = "https://gwhavnuxiavnuqnbhcfy.supabase.co";
const publicKey = "sb_publishable_ZLj1Su8W6yfZ_NKAT-4YpQ_MPwO_Feb";
const callbackPort = 43821;
class AuthHttpError extends Error {
  constructor(status) {
    super("认证服务请求失败");
    this.status = status;
  }
}
class LocalWorkspaceAccess {
  constructor(changed) { this.changed = changed; }
  isAuthenticated() { return true; }
  snapshot() { return { status: "signed-in", localMode: true, user: { id: "local-workspace", name: "本机工作区", email: "" }, message: "本机模式：无需登录 Bi-Talks，启动直接进入工作区。" }; }
  async initialize() { this.changed(); }
  async refresh() { this.changed(); return this.snapshot(); }
  async logout() { return this.refresh(); }
  async login() { return this.refresh(); }
  async loginWithPassword() { return this.refresh(); }
  async register() { throw new Error("本机模式无需注册 Bi-Talks 账号。"); }
  async verifyRegistration() { return this.register(); }
  async resendRegistration() { return this.register(); }
  dispose() {}
}
class UserAccountAuth {
  constructor(changed) {
    this.changed = changed;
  }
  session;
  state = { status: "signed-out" };
  server;
  loginTimer;
  expiryTimer;
  refreshTimer;
  refreshPromise;
  generation = 0;
  initialized = false;
  get file() {
    return join(app.getPath("userData"), "user-account-session.enc");
  }
  isAuthenticated() {
    return this.state.status === "signed-in" && !!this.session && this.session.expires_at > Date.now() / 1e3;
  }
  watchExpiry() {
    clearTimeout(this.expiryTimer);
    if (!this.session) return;
    this.expiryTimer = setTimeout(() => {
      this.state = { status: "offline", message: "登录验证已到期，请连接网络刷新或重新登录。" };
      this.emit();
    }, Math.max(0, (this.session.expires_at - Date.now() / 1e3) * 1e3));
    this.expiryTimer.unref();
  }
  snapshot() {
    return { ...this.state, ...this.state.status === "signed-in" && !this.isAuthenticated() ? { status: "offline" } : {}, user: this.state.user ? { ...this.state.user } : void 0 };
  }
  emit() {
    this.changed();
  }
  save(session2) {
    if (typeof session2.access_token !== "string" || typeof session2.refresh_token !== "string" || !Number.isFinite(session2.expires_at)) throw new Error("认证响应无效，请重新登录。");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("系统无法加密保存登录状态，请重试。");
    const temp = this.file + ".tmp";
    writeFileSync(temp, safeStorage.encryptString(JSON.stringify(session2)), { mode: 384 });
    renameSync(temp, this.file);
    this.session = session2;
    this.watchExpiry();
  }
  async request(path, method = "GET", body, token) {
    const response = await net.fetch(base + path, {
      method,
      headers: { apikey: publicKey, ...token ? { Authorization: "Bearer " + token } : {}, "Content-Type": "application/json" },
      ...body === void 0 ? {} : { body: JSON.stringify(body) },
      signal: AbortSignal.timeout(15e3)
    });
    if (!response.ok) throw new AuthHttpError(response.status);
    if (response.status === 204) return void 0;
    const text = await response.text();
    return text ? JSON.parse(text) : void 0;
  }
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(this.file)));
      if (typeof saved.access_token !== "string" || typeof saved.refresh_token !== "string" || !Number.isFinite(saved.expires_at)) throw Error("Invalid session");
      this.session = saved;
      this.watchExpiry();
      this.state = { status: "checking" };
      await this.refresh();
    } catch {
      this.state = { status: "signed-out", message: "无法恢复保存的登录状态，请重新使用 Google 登录。" };
      this.emit();
    }
  }
  schedule(delay2 = 6e4) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      void this.refresh();
    }, delay2);
    this.refreshTimer.unref();
  }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    this.refreshPromise = this.loadUser(generation).finally(() => {
      this.refreshPromise = void 0;
    });
    return this.refreshPromise;
  }
  async loadUser(generation) {
    if (!this.session) return;
    try {
      if (this.session.expires_at <= Date.now() / 1e3 + 90) {
        const result = await this.request("/auth/v1/token?grant_type=refresh_token", "POST", { refresh_token: this.session.refresh_token });
        if (generation !== this.generation) return;
        this.save({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() / 1e3 + result.expires_in });
      }
      const user = await this.request("/auth/v1/user", "GET", void 0, this.session.access_token);
      if (generation !== this.generation) return;
      if (typeof user.id !== "string") throw Error("Invalid user");
      this.state = { status: "signed-in", user: { id: user.id, email: user.email || "", name: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : user.email || "Google 用户" } };
      try {
        const profiles = await this.request("/rest/v1/profiles?select=plan_id&user_id=eq." + encodeURIComponent(user.id), "GET", void 0, this.session.access_token);
        if (generation !== this.generation) return;
        this.state.user.plan = typeof profiles[0]?.plan_id === "string" ? profiles[0].plan_id : void 0;
        if (!profiles[0]) this.state.message = "已登录，云端用户资料暂未建立。";
      } catch {
        if (generation === this.generation) this.state.message = "已登录，用户资料暂时无法读取，可稍后刷新。";
      }
      if (generation !== this.generation) return;
      this.schedule(Math.max(1e4, Math.min(3e5, (this.session.expires_at - Date.now() / 1e3 - 90) * 1e3)));
    } catch (error) {
      if (generation !== this.generation) return;
      if (error instanceof AuthHttpError && [400, 401, 403].includes(error.status)) {
        this.session = void 0;
        clearTimeout(this.expiryTimer);
        rmSync(this.file, { force: true });
        this.state = { status: "signed-out", message: "登录已失效，请重新登录。" };
      } else {
        this.state = { ...this.state, status: this.isAuthenticated() ? "signed-in" : "offline", message: "暂时无法连接用户服务，已保留登录凭证，请稍后刷新。" };
        this.schedule();
      }
    }
    this.emit();
  }
  stopLogin() {
    clearTimeout(this.loginTimer);
    this.server?.close();
    this.server = void 0;
  }
  async login() {
    if (this.state.status === "signing-in") return;
    if (!safeStorage.isEncryptionAvailable()) throw Error("系统无法加密保存登录状态。");
    const generation = ++this.generation;
    clearTimeout(this.refreshTimer);
    this.stopLogin();
    const verifier = randomBytes(32).toString("base64url");
    const nonce = randomBytes(24).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const callback = "http://127.0.0.1:" + callbackPort + "/auth/callback?nonce=" + nonce;
    let exchanging = false;
    this.state = { status: "signing-in", message: "请在浏览器中完成 Google 登录。" };
    this.emit();
    const server = createServer(async (req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader("Referrer-Policy", "no-referrer");
      const url = new URL(req.url || "/", "http://127.0.0.1:" + callbackPort);
      if (req.method === "GET" && req.headers.host === "127.0.0.1:" + callbackPort && url.pathname === "/auth/result" && url.searchParams.get("nonce") === nonce && generation === this.generation) {
        const pending = this.state.status === "signing-in" || this.state.status === "checking";
        if (pending) res.setHeader("Refresh", "1");
        res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Bi-Talks 登录</title><body><h2>Bi-Talks</h2><p>' + (pending ? "正在完成登录，请稍候…" : this.isAuthenticated() ? "Google 登录成功。请返回 Bi-Talks，可以关闭此窗口。" : "登录未完成，请返回 Bi-Talks 查看提示。") + "</p></body></html>");
        return;
      }
      if (req.method !== "GET" || req.headers.host !== "127.0.0.1:" + callbackPort || url.pathname !== "/auth/callback" || url.searchParams.get("nonce") !== nonce || generation !== this.generation) {
        res.writeHead(400);
        res.end("无效的登录回调。请返回 Bi-Talks 重新登录。");
        return;
      }
      if (exchanging) {
        res.writeHead(409);
        res.end("正在完成登录，请返回 Bi-Talks。");
        return;
      }
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.has("error")) {
        res.end("登录未完成，请返回 Bi-Talks 重试。");
        this.stopLogin();
        this.state = { status: "signed-out", message: "Google 登录已取消或未获授权，请重试。" };
        this.emit();
        return;
      }
      exchanging = true;
      res.writeHead(303, { Location: "/auth/result?nonce=" + nonce });
      res.end();
      clearTimeout(this.loginTimer);
      try {
        const result = await this.request("/auth/v1/token?grant_type=pkce", "POST", { auth_code: code, code_verifier: verifier });
        if (generation !== this.generation) {
          return;
        }
        this.save({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() / 1e3 + result.expires_in });
        this.state = { status: "checking" };
        await this.loadUser(generation);
      } catch {
        if (generation === this.generation) {
          this.state = { status: "signed-out", message: "登录验证失败或超时，请重新登录。" };
          this.emit();
        }
      } finally {
        if (generation === this.generation) {
          this.loginTimer = setTimeout(() => this.stopLogin(), 6e4);
          this.loginTimer.unref();
        }
      }
    });
    this.server = server;
    try {
      await new Promise((resolve2, reject) => {
        server.once("error", reject);
        server.listen(callbackPort, "127.0.0.1", () => {
          server.removeListener("error", reject);
          resolve2();
        });
      });
      this.loginTimer = setTimeout(() => {
        ++this.generation;
        this.stopLogin();
        this.state = { status: "signed-out", message: "等待登录超时，请重试。" };
        this.emit();
      }, 3e5);
      this.loginTimer.unref();
      const url = new URL(base + "/auth/v1/authorize");
      url.search = new URLSearchParams({ provider: "google", redirect_to: callback, code_challenge: challenge, code_challenge_method: "s256" }).toString();
      await openGoogleLoginWindow(url.href);
    } catch {
      this.stopLogin();
      this.state = { status: "signed-out", message: "无法启动登录，浏览器或本地登录端口不可用，请重试。" };
      this.emit();
    }
  }
  async loginWithPassword(email, password) {
    if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof password !== "string" || !password || password.length > 4096) throw Error("请输入有效的邮箱和 Bi-Talks 密码。");
    if (this.state.status === "signing-in" || this.state.status === "checking") throw Error("登录正在进行，请稍候。");
    if (!safeStorage.isEncryptionAvailable()) throw Error("系统无法加密保存登录状态。");
    const generation = ++this.generation;
    this.stopLogin();
    clearTimeout(this.refreshTimer);
    this.state = { status: "checking", message: "正在验证邮箱和密码…" };
    this.emit();
    try {
      const result = await this.request("/auth/v1/token?grant_type=password", "POST", { email: email.trim(), password });
      if (generation !== this.generation) return;
      this.save({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() / 1e3 + result.expires_in });
      await this.loadUser(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.state = { status: "signed-out", message: error instanceof AuthHttpError && [400, 401, 403, 422].includes(error.status) ? "邮箱或密码不正确，或邮箱尚未验证。仅用 Google 注册且未设置 Bi-Talks 密码的账号，请使用 Google 登录。" : error instanceof AuthHttpError && error.status === 429 ? "尝试次数过多，请稍后再试。" : "登录服务暂时不可用，请稍后重试。" };
      this.emit();
    }
  }
  registrationBusy = false;
  resendAt = 0;
  validateEmail(email) {
    if (typeof email !== "string" || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw Error("请输入有效邮箱。");
    return email.trim();
  }
  async register(email, password) {
    const address = this.validateEmail(email);
    if (typeof password !== "string" || password.length < 8 || password.length > 4096) throw Error("密码至少需要 8 位。");
    if (this.registrationBusy || this.state.status === "signing-in" || this.state.status === "checking" || this.isAuthenticated()) throw Error("请先完成当前账号操作。");
    if (Date.now() < this.resendAt) throw Error("请等待 60 秒后重新发送。");
    this.registrationBusy = true;
    const generation = this.generation;
    try {
      const result = await this.request("/auth/v1/signup", "POST", { email: address, password });
      if (generation !== this.generation) return;
      if (result?.access_token) throw Error("云端未开启注册邮箱验证，请联系管理员启用后重试。");
      this.resendAt = Date.now() + 6e4;
    } catch (error) {
      if (error instanceof AuthHttpError) throw Error(error.status === 429 ? "邮件发送过于频繁，请稍后重试。" : "注册邮件发送失败，请检查邮箱或联系管理员检查邮件配置。");
      throw error;
    } finally {
      this.registrationBusy = false;
    }
  }
  async resendRegistration(email) {
    const address = this.validateEmail(email);
    if (this.registrationBusy || this.isAuthenticated()) throw Error("请先完成当前账号操作。");
    if (Date.now() < this.resendAt) throw Error("请等待 60 秒后重新发送。");
    this.registrationBusy = true;
    try {
      await this.request("/auth/v1/resend", "POST", { type: "signup", email: address });
      this.resendAt = Date.now() + 6e4;
    } catch {
      throw Error("暂时无法重新发送，请稍后重试或联系管理员检查邮件配置。");
    } finally {
      this.registrationBusy = false;
    }
  }
  async verifyRegistration(email, code) {
    const address = this.validateEmail(email);
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw Error("请输入 6 位数字验证码。");
    if (this.registrationBusy || this.state.status === "signing-in" || this.state.status === "checking" || this.isAuthenticated()) throw Error("请先完成当前账号操作。");
    if (!safeStorage.isEncryptionAvailable()) throw Error("系统无法加密保存登录状态。");
    this.registrationBusy = true;
    const generation = ++this.generation;
    try {
      const result = await this.request("/auth/v1/verify", "POST", { type: "signup", email: address, token: code });
      if (generation !== this.generation) return;
      this.save({ access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() / 1e3 + result.expires_in });
      this.state = { status: "checking" };
      this.emit();
      await this.loadUser(generation);
    } catch {
      throw Error("验证码无效、已使用或已过期，请检查后重试。");
    } finally {
      this.registrationBusy = false;
    }
  }
  async logout() {
    const generation = ++this.generation;
    this.stopLogin();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.expiryTimer);
    const token = this.session?.access_token;
    this.session = void 0;
    rmSync(this.file, { force: true });
    this.state = { status: "signed-out" };
    this.emit();
    if (token) {
      try {
        await this.request("/auth/v1/logout?scope=local", "POST", void 0, token);
      } catch {
        if (generation === this.generation) {
          this.state.message = "已退出本机登录；网络异常，云端会话撤销暂未确认。";
          this.emit();
        }
      }
    }
  }
  dispose() {
    ++this.generation;
    this.stopLogin();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.expiryTimer);
  }
}
function mergeUnreadSample(previous, sample) {
  const count = Math.max(0, Math.min(999, Math.round(sample.count)));
  if (!sample.partial || previous === void 0) return count;
  const delta = Number.isFinite(sample.delta) ? Math.round(sample.delta) : 0;
  return Math.max(count, Math.min(999, Math.max(0, previous + delta)));
}
function shouldNotifyUnread(hidden, previous, count, baselineUntil, lastNotice, now) {
  return !hidden && previous !== void 0 && count > previous && now >= baselineUntil && now - lastNotice >= 5e3;
}
const historyVersion = 1;
const maxHistoryEntries = 5e4;
const maxHistoryAgeMs = 365 * 24 * 60 * 60 * 1e3;
const lastUsedWriteIntervalMs = 24 * 60 * 60 * 1e3;
const compactFileSizeBytes = 32 * 1024 * 1024;
function parseRecord(line) {
  try {
    const record = JSON.parse(line);
    if (record.version !== historyVersion || typeof record.key !== "string" || !record.key || typeof record.translation !== "string" || !record.translation || typeof record.lastUsedAt !== "number" || !Number.isFinite(record.lastUsedAt)) return void 0;
    return record;
  } catch {
    return void 0;
  }
}
class TranslationHistory {
  constructor(path, codec) {
    this.path = path;
    this.codec = codec;
  }
  entries = /* @__PURE__ */ new Map();
  loadPromise;
  loaded = false;
  writeQueue = Promise.resolve();
  compactionQueued = false;
  async get(providerIdentity, source, target, text) {
    await this.ensureLoaded();
    const key = this.key(providerIdentity, source, target, text);
    const entry = this.entries.get(key);
    if (!entry) return void 0;
    const now = Date.now();
    if (now - entry.lastUsedAt > maxHistoryAgeMs) {
      this.entries.delete(key);
      this.queueCompaction();
      return void 0;
    }
    if (now - entry.lastUsedAt >= lastUsedWriteIntervalMs) {
      entry.lastUsedAt = now;
      this.append(key, entry);
    }
    return entry.translation;
  }
  remember(providerIdentity, source, target, text, translation) {
    const cleanTranslation = translation.trim();
    if (!cleanTranslation) return;
    const store2 = () => {
      const key = this.key(providerIdentity, source, target, text);
      const entry = { translation: cleanTranslation, lastUsedAt: Date.now() };
      this.entries.set(key, entry);
      this.append(key, entry);
      if (this.prune()) this.queueCompaction();
    };
    if (this.loaded) store2();
    else void this.ensureLoaded().then(store2);
  }
  async flush() {
    await this.ensureLoaded();
    await this.writeQueue;
  }
  ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.load().finally(() => {
        this.loaded = true;
      });
    }
    return this.loadPromise;
  }
  async load() {
    if (!existsSync(this.path)) return;
    try {
      const raw = await promises.readFile(this.path, "utf8");
      const cutoff = Date.now() - maxHistoryAgeMs;
      let discarded = false;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let decoded;
        try {
          decoded = this.codec ? this.codec.decode(line) : line;
        } catch {
          discarded = true;
          continue;
        }
        const record = parseRecord(decoded);
        if (!record) {
          discarded = true;
          continue;
        }
        if (record.lastUsedAt < cutoff) {
          discarded = true;
          continue;
        }
        this.entries.set(record.key, {
          translation: record.translation,
          lastUsedAt: record.lastUsedAt
        });
      }
      if (this.prune()) discarded = true;
      if (discarded || Buffer.byteLength(raw, "utf8") >= compactFileSizeBytes) this.queueCompaction();
    } catch {
      this.entries.clear();
    }
  }
  prune() {
    const cutoff = Date.now() - maxHistoryAgeMs;
    let changed = false;
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt >= cutoff) continue;
      this.entries.delete(key);
      changed = true;
    }
    if (this.entries.size <= maxHistoryEntries) return changed;
    const oldest = [...this.entries.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt).slice(0, this.entries.size - maxHistoryEntries);
    for (const [key] of oldest) this.entries.delete(key);
    return true;
  }
  append(key, entry) {
    const record = { version: historyVersion, key, ...entry };
    let line;
    try {
      line = (this.codec ? this.codec.encode(JSON.stringify(record)) : JSON.stringify(record)) + "\n";
    } catch {
      return;
    }
    const write = this.writeQueue.then(async () => {
      await promises.mkdir(dirname(this.path), { recursive: true });
      await promises.appendFile(this.path, line, "utf8");
    });
    this.writeQueue = write.catch(() => void 0);
  }
  queueCompaction() {
    if (this.compactionQueued) return;
    this.compactionQueued = true;
    const write = this.writeQueue.then(async () => {
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      try {
        await promises.mkdir(dirname(this.path), { recursive: true });
        const body = [...this.entries.entries()].map(([key, entry]) => {
          const record = JSON.stringify({ version: historyVersion, key, ...entry });
          return this.codec ? this.codec.encode(record) : record;
        }).join("\n");
        await promises.writeFile(temporaryPath, body ? `${body}
` : "", "utf8");
        await promises.rename(temporaryPath, this.path);
      } finally {
        this.compactionQueued = false;
        await promises.rm(temporaryPath, { force: true }).catch(() => void 0);
      }
    });
    this.writeQueue = write.catch(() => {
      this.compactionQueued = false;
    });
  }
  key(providerIdentity, source, target, text) {
    return createHash("sha256").update(`${historyVersion}\0${providerIdentity}\0${source}\0${target}\0${text}`).digest("hex");
  }
}
const keyPath = () => join(app.getPath("userData"), "deepl-api-key.enc");
function deepLKeyStatus() {
  const key = readDeepLKey();
  return key ? { saved: true, masked: `${key.slice(0, 6)}••••${key.slice(-4)}` } : { saved: false };
}
function readDeepLKey() {
  if (!safeStorage.isEncryptionAvailable() || !existsSync(keyPath())) return void 0;
  try {
    return safeStorage.decryptString(readFileSync(keyPath())).trim() || void 0;
  } catch {
    return void 0;
  }
}
function saveDeepLKey(value) {
  const key = value.trim();
  if (!/^[A-Za-z0-9_-]{20,}(?::fx)?$/.test(key)) throw new Error("DeepL API Key 格式无效。");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全加密 API Key。");
  writeFileSync(keyPath(), safeStorage.encryptString(key), { mode: 384 });
}
function clearDeepLKey() {
  rmSync(keyPath(), { force: true });
}
const baseUrl = (key) => key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
const errorMessage$1 = (status) => status === 403 ? "DeepL API Key 无效，请在设置中重新填写。" : status === 456 ? "DeepL 本月翻译额度已用完。" : status === 429 ? "DeepL 请求过于频繁，请稍后再试。" : `DeepL 请求失败（HTTP ${status}）。`;
class DeepLError extends Error {
  constructor(status, retryAfterMs = 0) {
    super(errorMessage$1(status));
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
async function validateDeepLKey(key) {
  const response = await fetchDeepLTrusted(`${baseUrl(key)}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${key}` }, signal: AbortSignal.timeout(2e4) });
  if (!response.ok) throw new DeepLError(response.status);
}
function translationProvider(){
 const state=globalThis.__biProviderState||={generation:0};
 if(!state.provider){try{state.provider=JSON.parse(readFileSync(join(app.getPath('userData'),'translation-provider.json'),'utf8')).provider==='deepl'?'deepl':'google';}catch{state.provider='google';}}
 return state.provider;
}
function translationCredential(){return translationProvider()==='google'?'google-free':readDeepLKey();}
async function setTranslationProvider(enabled){
 if(typeof enabled!=='boolean')throw Error('翻译开关参数无效');
 if(enabled){const key=readDeepLKey();if(!key)throw Error('请先填写并测试 DeepL API Key');await validateDeepLKey(key);}
 const provider=enabled?'deepl':'google';const file=join(app.getPath('userData'),'translation-provider.json');writeFileSync(file+'.tmp',JSON.stringify({provider}));renameSync(file+'.tmp',file);
 translationProvider();const state=globalThis.__biProviderState;if(state.provider!==provider){state.provider=provider;state.generation++;}
 pauseGoogleRecovery();if(provider==='google')scheduleGoogleRecovery();
 return translationProviderStatus();
}
function googleRecoveryState(){const state=globalThis.__biGoogleFree||={until:0};return state.recovery||=( {blocked:false,phase:'ready',attempt:0,nextCheck:0,epoch:0,lastStatus:null,recoveredAt:0});}
function googleRetryDelay(response,fallback=60000){const raw=response?.headers?.get('retry-after');if(raw===null||raw===undefined||raw==='')return fallback;const seconds=Number(raw),date=Date.parse(raw);return Number.isFinite(seconds)?Math.max(1000,Math.min(86400000,seconds*1000)):Number.isFinite(date)?Math.max(1000,Math.min(86400000,date-Date.now())):fallback;}
function pauseGoogleRecovery(){const state=googleRecoveryState();state.epoch++;clearTimeout(state.timer);state.timer=null;state.controller?.abort();state.controller=null;if(state.blocked)state.phase='paused';}
function scheduleGoogleRecovery(){
 const state=googleRecoveryState();if(!state.blocked||state.timer||state.controller)return;
 if(translationProvider()!=='google'||!workspaceUnlocked){state.phase='paused';return;}
 state.phase='cooldown';const epoch=state.epoch;
 state.timer=setTimeout(()=>{state.timer=null;if(epoch===state.epoch)void probeGoogleRecovery();},Math.max(0,state.nextCheck-Date.now()));state.timer.unref?.();
}
function blockGoogleRecovery(status,delay=60000){
 const state=googleRecoveryState();state.blocked=true;state.lastStatus=status;state.nextCheck=Math.max(state.nextCheck,Date.now()+delay);globalThis.__biGoogleFree.until=state.nextCheck;
 clearTimeout(state.timer);state.timer=null;state.epoch++;state.controller?.abort();state.controller=null;scheduleGoogleRecovery();
}
async function probeGoogleRecovery(){
 const state=googleRecoveryState();if(!state.blocked||state.controller)return;
 if(translationProvider()!=='google'||!workspaceUnlocked){pauseGoogleRecovery();return;}
 if(Date.now()<state.nextCheck){scheduleGoogleRecovery();return;}
 const epoch=state.epoch,controller=new AbortController();state.controller=controller;state.phase='checking';const at=Date.now();let status=null,delay=0;
 const current=()=>epoch===state.epoch&&translationProvider()==='google'&&workspaceUnlocked&&!controller.signal.aborted;
 const timer=setTimeout(()=>controller.abort(),8000);
 try{
  const url=new URL('https://translate.googleapis.com/translate_a/single');url.search=new URLSearchParams({client:'gtx',sl:'en',tl:'zh-CN',dt:'t',q:'Hello'}).toString();
  const response=await net.fetch(url.href,{signal:controller.signal});status=response.status;
  if(!response.ok){if(status===429)delay=googleRetryDelay(response);throw Error('unavailable');}
  const data=await response.json();if(!Array.isArray(data?.[0])||!data[0].some(row=>typeof row?.[0]==='string'&&row[0].trim()))throw Error('invalid-response');
  if(!current())return;
  state.blocked=false;state.phase='recovered';state.attempt=0;state.nextCheck=0;state.lastStatus=200;state.recoveredAt=Date.now();globalThis.__biGoogleFree.until=0;
  runtimeLog('Google recovery probe',{ok:true,status,ms:Date.now()-at});
 }catch{
  // A timeout is a failed probe; a provider change invalidates this probe entirely.
  if(epoch!==state.epoch||translationProvider()!=='google'||!workspaceUnlocked)return;
  state.lastStatus=status;const intervals=[60000,120000,300000,600000];delay=Math.max(delay,intervals[Math.min(state.attempt++,intervals.length-1)]);state.nextCheck=Date.now()+delay;globalThis.__biGoogleFree.until=state.nextCheck;
  runtimeLog('Google recovery probe',{ok:false,status,ms:Date.now()-at,nextCheckInMs:delay});
 }finally{clearTimeout(timer);if(state.controller===controller)state.controller=null;if(state.blocked&&epoch===state.epoch)scheduleGoogleRecovery();}
}
function translationProviderStatus(){
 const provider=translationProvider(),state=googleRecoveryState();if(provider==='google')scheduleGoogleRecovery();
 return {provider,google:{phase:state.phase,blocked:state.blocked,nextCheck:state.nextCheck,lastStatus:state.lastStatus,recoveredAt:state.recoveredAt}};
}

async function requestGoogleTranslation(payload,deadline,valid){
 const state=globalThis.__biGoogleFree||={until:0};state.segments||=new Map();
 const language=value=>{const code=String(value||'auto').toLowerCase();return code.startsWith('zh')?(code.includes('hant')?'zh-TW':'zh-CN'):code.split('-')[0];};
 const sl=language(payload.source_lang),tl=language(payload.target_lang),cancelled=()=>new TranslationFailure('翻译任务已取消。');
 const check=async()=>{if(!await valid())throw cancelled();if(Date.now()>=deadline)throw new TranslationFailure('Google 翻译超时，请重试。',true);};
 const wait=async(ms)=>{const end=Math.min(deadline,Date.now()+ms);while(Date.now()<end){await check();await new Promise(r=>setTimeout(r,Math.min(80,end-Date.now())));}await check();};
 const makeURL=text=>{const url=new URL('https://translate.googleapis.com/translate_a/single');url.search=new URLSearchParams({client:'gtx',sl,tl,dt:'t',q:text}).toString();return url;};
 const split=text=>{const result=[];let rest=text;while(Buffer.byteLength(makeURL(rest).href)>7000){let n=0,used='',bytes=0;for(const char of rest){const size=encodeURIComponent(char).length;if(bytes+size>6000)break;bytes+=size;used+=char;n+=char.length;}const preferred=used.search(/[\s.!?。！？][^\s.!?。！？]*$/u);if(preferred>n/2)n=preferred+1;result.push(rest.slice(0,n));rest=rest.slice(n);}if(rest)result.push(rest);return result;};
 const translate=async(text)=>{
  for(let attempt=0;attempt<2;attempt++){
   await check();const recovery=googleRecoveryState();if(recovery.blocked){scheduleGoogleRecovery();throw new TranslationFailure('Google 免费翻译暂时不可用，正在自动检测恢复；也可手动切换 DeepL。',true,Math.max(1000,recovery.nextCheck-Date.now()),recovery.lastStatus||429);}if(state.until>Date.now())throw new TranslationFailure('Google 免费翻译暂时限流，已开启自动检测恢复。',true,state.until-Date.now(),429);
   // A shared start interval reduces bursts without adding another request queue.
   const previous=state.lastStart||0;if(Date.now()-previous<150)await wait(150-(Date.now()-previous));state.lastStart=Date.now();
   const controller=new AbortController(),at=Date.now();let checking=false;
   const timer=setTimeout(()=>controller.abort(),Math.min(12000,deadline-Date.now()));
   const monitor=setInterval(async()=>{if(checking)return;checking=true;try{if(!await valid())controller.abort();}finally{checking=false;}},150);
   let status=null,retryable=false;
   try{
    const res=await net.fetch(makeURL(text).href,{signal:controller.signal});status=res.status;
    if(!res.ok){
     if(status===429){const delay=googleRetryDelay(res);blockGoogleRecovery(429,delay);throw new TranslationFailure('Google 免费翻译暂时限流，已开启自动检测恢复。',true,delay,429);}
     if(status===403){blockGoogleRecovery(403);throw new TranslationFailure('Google 免费翻译拒绝访问，已开启自动检测恢复；也可手动切换 DeepL。',true,60000,403);}
     retryable=status===408||status>=500;throw new TranslationFailure('Google 免费翻译服务异常（'+status+'），请重试。',retryable,0,status);
    }
    let data;try{data=await res.json();}catch{retryable=true;throw new TranslationFailure('Google 返回格式异常，请重试。',true);}
    if(!Array.isArray(data?.[0])){retryable=true;throw new TranslationFailure('Google 返回格式异常，请重试。',true);}
    const result=data[0].map(row=>typeof row?.[0]==='string'?row[0]:'').join('');if(!result.trim()){retryable=true;throw new TranslationFailure('Google 未返回译文，请重试。',true);}
    await check();runtimeLog('Google translation request',{status,attempt:attempt+1,characters:text.length,ms:Date.now()-at,ok:true});return result;
   }catch(error){
    if(!await valid())throw cancelled();
    const timeout=controller.signal.aborted,network=!(error instanceof TranslationFailure);retryable=retryable||timeout||network;
    runtimeLog('Google translation request',{status,attempt:attempt+1,characters:text.length,ms:Date.now()-at,ok:false,reason:timeout?'timeout':network?'network':error.message});
    if(attempt===0&&retryable&&Date.now()+1800<deadline){clearTimeout(timer);clearInterval(monitor);await wait(400);continue;}
    if(retryable)blockGoogleRecovery(status,60000);
    if(timeout)throw new TranslationFailure('Google 翻译超时，已开启自动检测恢复。',true,60000);if(network)throw new TranslationFailure('Google 翻译网络连接失败，已开启自动检测恢复。',true,60000);throw error;
   }finally{clearTimeout(timer);clearInterval(monitor);}
  }
 };
 const translations=[];
 for(const text of payload.text){const chunks=split(text),out=[];
  for(const chunk of chunks){await check();const edge=chunk.match(/^(\s*)([\s\S]*?)(\s*)$/u);if(!edge[2]){out.push(chunk);continue;}
   const cacheKey=createHash('sha256').update(sl+'\0'+tl+'\0'+edge[2]).digest('hex');const cached=state.segments.get(cacheKey);
   let result=!payload.bypassCache&&cached&&cached.until>Date.now()?cached.text:undefined;
   if(result===undefined){result=await translate(edge[2]);state.segments.set(cacheKey,{text:result,until:Date.now()+600000});while(state.segments.size>128)state.segments.delete(state.segments.keys().next().value);}
   await check();out.push(edge[1]+result+edge[3]);
  }
  translations.push({text:out.join('')});
 }
 return {translations};
}

function normalizeDeepLLanguage(value, role='target') {
 const code=String(value||'auto').trim().replace(/_/g,'-').toUpperCase();
 if(code==='AUTO'){if(role==='source')return 'auto';throw new TranslationFailure('请选择目标语言。');}
 const aliases={CN:'ZH-HANS',CHINESE:'ZH-HANS','ZH-CN':'ZH-HANS','ZH-SG':'ZH-HANS','ZH-TW':'ZH-HANT','ZH-HK':'ZH-HANT',ENGLISH:'EN'};
 const normalized=aliases[code]||code;
 if(!/^[A-Z]{2,3}(?:-[A-Z0-9]{2,8})?$/.test(normalized))throw new TranslationFailure('翻译语言参数无效。');
 if(role==='source'&&/^(?:EN-|PT-|ZH-)/.test(normalized))return normalized.split('-')[0];
 return normalized;
}
async function requestDeepLReliably(key, payload, deadline, valid = async()=>true) {
 if(translationProvider()==='google')return requestGoogleTranslation(payload,deadline,valid);
 const runtime=globalThis.__biDeepLRequests||={until:0,strikes:0,credential:''};
 const credential=createHash('sha256').update(key).digest('hex');
 if(runtime.credential!==credential){runtime.credential=credential;runtime.until=0;runtime.strikes=0;}
 // Send translation data only, without style instructions.
 const data={text:payload.text,target_lang:normalizeDeepLLanguage(payload.target_lang)};
 if(payload.source_lang&&String(payload.source_lang).toLowerCase()!=='auto')data.source_lang=normalizeDeepLLanguage(payload.source_lang,'source');
 if(payload.preserve_formatting!==undefined)data.preserve_formatting=!!payload.preserve_formatting;
 const current=async()=>{try{return !!await valid();}catch{return false;}};
 const cancelled=()=>new TranslationFailure('翻译任务已取消。');
 for(let attempt=0;attempt<2;attempt++){
  if(!await current())throw cancelled();
  if(runtime.until>Date.now())throw new TranslationFailure('DeepL 请求过于频繁，请稍后重试。',true,runtime.until-Date.now(),429);
  const remaining=deadline-Date.now();if(remaining<=0)throw new TranslationFailure('DeepL 翻译超时，请稍后重试。',true);
  const body=JSON.stringify(data);if(Buffer.byteLength(body,'utf8')>120000)throw new TranslationFailure('翻译请求过大，请缩短文本后重试。');
  const controller=new AbortController();let checking=false,wasCancelled=false;
  const timer=setTimeout(()=>controller.abort(),Math.min(12000,remaining));
  const monitor=setInterval(async()=>{if(checking)return;checking=true;try{if(!await current()){wasCancelled=true;controller.abort();}}finally{checking=false;}},150);
  try{
   const response=await fetchDeepLTrusted(`${baseUrl(key)}/v2/translate`,{method:'POST',headers:{Authorization:`DeepL-Auth-Key ${key}`,'Content-Type':'application/json'},body,signal:controller.signal});
   if(!await current())throw cancelled();
   if(!response.ok){const raw=response.headers.get('retry-after');const n=raw===null?NaN:Number(raw);const delay=Number.isFinite(n)?Math.max(0,n*1000):Math.max(0,Date.parse(raw||'')-Date.now())||0;
    if(response.status===429){runtime.strikes=Math.min(6,runtime.strikes+1);runtime.until=Date.now()+Math.max(delay,Math.min(60000,1500*2**runtime.strikes));}
    throw new DeepLError(response.status,response.status===429?runtime.until-Date.now():delay);
   }
   const value=await response.json();if(!Array.isArray(value.translations)||value.translations.length!==data.text.length||value.translations.some(t=>typeof t?.text!=='string'||!t.text.trim()))throw new TranslationFailure('DeepL 返回译文不完整，请重试。',true);
   if(!await current())throw cancelled();runtime.strikes=0;return value;
  }catch(error){
   if(wasCancelled||!await current()||error?.message==='翻译任务已取消。')throw cancelled();
   const failure=translationFailure(error);runtimeLog('DeepL request failed',{status:failure.status||null,attempt:attempt+1,reason:failure.message});const delay=Math.max(1000*(attempt+1),failure.retryAfterMs||0);
   clearTimeout(timer);clearInterval(monitor);
   if(attempt===0&&failure.retryable&&Date.now()+delay+1000<deadline){
    const until=Date.now()+delay;
    while(Date.now()<until){if(!await current())throw cancelled();await new Promise(r=>setTimeout(r,Math.min(100,until-Date.now())));}
    continue;
   }throw failure;
  }finally{clearTimeout(timer);clearInterval(monitor);}
 }
}
async function translateWithDeepL(text,target,source='auto',timeoutMs=30000,valid=async()=>true){
 if(!await valid())throw new TranslationFailure('翻译任务已取消。');
 const key=translationCredential();if(!key)return;
 const payload={text:[text],target_lang:normalizeDeepLLanguage(target)};
 if(String(source).toLowerCase()!=='auto')payload.source_lang=normalizeDeepLLanguage(source,'source');
 return (await requestDeepLReliably(key,payload,Date.now()+Math.min(timeoutMs,30000),valid)).translations[0].text;
}

const protectedSecretPrefix = "bitalks-safe:v1:";
function cloneRecord(value) {
  return structuredClone(value);
}
function transformSecret(value, transform) {
  return typeof value === "string" && value ? transform(value) : value;
}
function transformPersistedSecrets(input, transform) {
  const output = cloneRecord(input);
  if (!output || typeof output !== "object") return output;
  const root = output;
  const settings = root.settings;
  if (!settings || typeof settings !== "object") return output;
  const settingsRecord = settings;
  if ("deeplApiKey" in settingsRecord) settingsRecord.deeplApiKey = transformSecret(settingsRecord.deeplApiKey, transform);
  return output;
}
function encodeProtectedSecret(value, protect) {
  if (!value || value.startsWith(protectedSecretPrefix)) return value;
  return `${protectedSecretPrefix}${protect(value)}`;
}
function decodeProtectedSecret(value, reveal) {
  if (!value.startsWith(protectedSecretPrefix)) return value;
  return reveal(value.slice(protectedSecretPrefix.length));
}
function protectPersistedSecrets(input, protect) {
  return transformPersistedSecrets(input, (value) => encodeProtectedSecret(value, protect));
}
function revealPersistedSecrets(input, reveal) {
  return transformPersistedSecrets(input, (value) => decodeProtectedSecret(value, reveal));
}
const translationColors = /* @__PURE__ */ new Set(["#ff4d4f", "#fa8c16", "#d8ff00", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"]);
const initialState = {
  platformOrder: ["signal", "whatsapp", "telegram", "googlevoice", "zoom", "googlechat", "phound", "teams"],
  accounts: [],
  accountOrder: { signal: [], whatsapp: [], telegram: [], googlevoice: [], zoom: [], googlechat: [], phound: [], teams: [] },
  selectedPlatform: "signal",
  selectedAccountIdsByPlatform: {},
  settings: {
    incomingTarget: "zh",
    themeMode: "system",
    translationSizeDefaultVersion: 3,
    platformLayoutVersion: 14
  }
};
function normalizeThemeMode(value) {
  return value === "light" || value === "dark" || value === "system" ? value : initialState.settings.themeMode;
}
function clampNumber(value, min, max, fallback) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
function isAccountHidden$1(account) {
  return (account.platform === "telegram" || account.platform === "whatsapp") && account.hidden === true;
}
function normalizeAccount(account, migrateLegacyTranslationSize = false) {
  const translationColor = typeof account.translationColor === "string" && translationColors.has(account.translationColor) ? account.translationColor : "#d8ff00";
  const translationSize = migrateLegacyTranslationSize && account.translationSize === 12 ? 15 : account.translationSize;
  return {
    ...account,
    zoom: clampNumber(account.zoom, 40, 160, 100),
    translationEnabled: account.translationEnabled !== false,
    translationSize: clampNumber(translationSize, 10, 24, 15),
    translationColor,
    hidden: (account.platform === "telegram" || account.platform === "whatsapp") && account.hidden === true
  };
}
function normalizeState(state) {
  const knownPlatforms = new Set(initialState.platformOrder);
  const seenPlatforms = /* @__PURE__ */ new Set();
  const platformOrderInput = Array.isArray(state.platformOrder) ? state.platformOrder : initialState.platformOrder;
  const accountsInput = Array.isArray(state.accounts) ? state.accounts : initialState.accounts;
  const accountOrderInput = state.accountOrder && typeof state.accountOrder === "object" ? state.accountOrder : initialState.accountOrder;
  const selectedAccountIdsInput = state.selectedAccountIdsByPlatform && typeof state.selectedAccountIdsByPlatform === "object" ? state.selectedAccountIdsByPlatform : {};
  const migrateLegacyTranslationSize = state.settings.translationSizeDefaultVersion !== 3;
  const savedPlatformOrder = [
    ...platformOrderInput.filter((id) => {
      if (!knownPlatforms.has(id) || seenPlatforms.has(id)) return false;
      seenPlatforms.add(id);
      return true;
    }),
    ...initialState.platformOrder.filter((id) => !seenPlatforms.has(id))
  ];
  const platformOrder = savedPlatformOrder;
  const seenAccounts = /* @__PURE__ */ new Set();
  const accounts = accountsInput.filter((account) => {
    if (!knownPlatforms.has(account.platform) || seenAccounts.has(account.id)) return false;
    seenAccounts.add(account.id);
    return true;
  }).map((account) => normalizeAccount(account, migrateLegacyTranslationSize));
  const accountsByPlatform = new Map(initialState.platformOrder.map((platform) => [platform, accounts.filter((account) => account.platform === platform).map((account) => account.id)]));
  const accountOrder = Object.fromEntries(initialState.platformOrder.map((platform) => {
    const platformAccounts = new Set(accountsByPlatform.get(platform) || []);
    const existingOrder = Array.isArray(accountOrderInput[platform]) ? accountOrderInput[platform] : [];
    const ordered = existingOrder.filter((id, index, ids) => platformAccounts.has(id) && ids.indexOf(id) === index);
    return [platform, [...ordered, ...(accountsByPlatform.get(platform) || []).filter((id) => !ordered.includes(id))]];
  }));
  const selectedPlatform = initialState.platformOrder.includes(state.selectedPlatform) ? state.selectedPlatform : initialState.selectedPlatform;
  const selectedAccountIdsByPlatform = Object.fromEntries(initialState.platformOrder.flatMap((platform) => {
    const isSelectable = (account) => account.platform === platform && !isAccountHidden$1(account);
    const legacySelectedId = platform === selectedPlatform && state.selectedAccountId && accounts.some((account) => account.id === state.selectedAccountId && isSelectable(account)) ? state.selectedAccountId : void 0;
    const rememberedId = selectedAccountIdsInput[platform];
    const validRememberedId = rememberedId && accounts.some((account) => account.id === rememberedId && isSelectable(account)) ? rememberedId : void 0;
    const selectedId = legacySelectedId || validRememberedId || accountOrder[platform].find((id) => accounts.some((account) => account.id === id && isSelectable(account)));
    return selectedId ? [[platform, selectedId]] : [];
  }));
  const selectedAccountId = selectedAccountIdsByPlatform[selectedPlatform] || accountOrder[selectedPlatform].find((id) => accounts.some((account) => account.id === id && !isAccountHidden$1(account)));
  return {
    ...state,
    accounts,
    platformOrder,
    selectedPlatform,
    selectedAccountId,
    selectedAccountIdsByPlatform,
    accountOrder,
    settings: {
      incomingTarget: state.settings.incomingTarget || initialState.settings.incomingTarget,
      themeMode: normalizeThemeMode(state.settings.themeMode),
      translationSizeDefaultVersion: 3,
      platformLayoutVersion: 14
    }
  };
}
class StateStore {
  state = structuredClone(initialState);
  writeQueue = Promise.resolve();
  get path() {
    return join(app.getPath("userData"), "state.json");
  }
  protectForDisk(value) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("Windows credential encryption is currently unavailable; preserving the existing credential value.");
      return structuredClone(value);
    }
    return protectPersistedSecrets(value, (secret) => safeStorage.encryptString(secret).toString("base64"));
  }
  revealFromDisk(value) {
    return revealPersistedSecrets(value, (protectedValue) => {
      if (!safeStorage.isEncryptionAvailable()) {
        console.warn("Windows credential encryption is unavailable; protected API credentials must be entered again.");
        return "";
      }
      try {
        return safeStorage.decryptString(Buffer.from(protectedValue, "base64"));
      } catch (error) {
        console.warn("A protected API credential could not be decrypted for this Windows user.", error);
        return "";
      }
    });
  }
  async load() {
    if (!existsSync(this.path)) return this.get();
    try {
      const protectedRaw = JSON.parse(await promises.readFile(this.path, "utf8"));
      const raw = this.revealFromDisk(protectedRaw);
      this.state = normalizeState({
        ...structuredClone(initialState),
        ...raw,
        settings: {
          ...initialState.settings,
          ...raw.settings || {},
          translationSizeDefaultVersion: raw.settings?.translationSizeDefaultVersion,
          platformLayoutVersion: raw.settings?.platformLayoutVersion
        },
        accountOrder: { ...initialState.accountOrder, ...raw.accountOrder || {} },
        selectedAccountIdsByPlatform: { ...initialState.selectedAccountIdsByPlatform, ...raw.selectedAccountIdsByPlatform || {} }
      });
      await this.set(this.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Existing application state could not be read; refusing to replace it with an empty state: ${message}`);
    }
    return this.get();
  }
  get() {
    return structuredClone(this.state);
  }
  async set(next) {
    const normalized = normalizeState(structuredClone(next));
    this.state = normalized;
    const snapshot = this.protectForDisk(structuredClone(this.state));
    const write = this.writeQueue.then(async () => {
      await promises.mkdir(app.getPath("userData"), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.tmp`;
      await promises.writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), "utf8");
      await promises.rename(temporaryPath, this.path);
      try {
        await promises.copyFile(this.path, `${this.path}.backup`);
      } catch (error) {
        console.warn("Application state backup could not be refreshed.", error);
      }
    });
    this.writeQueue = write.catch(() => void 0);
    await write;
  }
}
class TranslationScheduler {
  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }
  running = 0;
  backgroundRunning = 0;
  sequence = 0;
  queue = [];
  run(work, priority = 0, queueTimeoutMs = 2e4) {
    if (this.queue.length >= 200) return Promise.reject(new Error("翻译任务较多，请稍后重试。"));
    return new Promise((resolve2, reject) => {
      const job = { priority, sequence: this.sequence++, run: async () => {
        try {
          resolve2(await work());
        } catch (error) {
          reject(error);
        }
      } };
      job.timer = setTimeout(() => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1);
        reject(new Error("翻译任务排队超时，请稍后重试。"));
        this.drain();
      }, queueTimeoutMs);
      this.queue.push(job);
      this.queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      this.drain();
    });
  }
  drain() {
    while (this.running < this.concurrency && this.queue.length) {
      const index = this.queue.findIndex((job2) => job2.priority >= 2e3 || this.backgroundRunning < Math.max(1, this.concurrency - 1));
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      clearTimeout(job.timer);
      const background = job.priority < 2e3;
      if (background) this.backgroundRunning++;
      this.running++;
      void job.run().finally(() => {
        this.running--;
        if (background) this.backgroundRunning--;
        this.drain();
      });
    }
  }
}
class TranslationFailure extends Error {
  constructor(message, retryable = false, retryAfterMs = 0, status) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
    this.name = "TranslationFailure";
  }
}
function translationFailure(error) {
  if (error instanceof TranslationFailure) return error;
  const value = error;
  const status = value?.status;
  const delay2 = Math.max(0, Math.min(3e5, Number(value?.retryAfterMs) || 0));
  if (status === 403) return new TranslationFailure("DeepL 密钥无效，请检查设置。", false, 0, status);
  if (status === 456) return new TranslationFailure("DeepL 翻译额度已用完。", false, 0, status);
  if (status === 429) return new TranslationFailure("DeepL 请求过于频繁，请稍后重试。", true, delay2, status);
  if (status && status >= 500) return new TranslationFailure("DeepL 服务暂时异常，请稍后重试。", true, delay2, status);
  if (status) return new TranslationFailure(`DeepL 请求失败（HTTP ${status}）。`, false, 0, status);
  if (value?.name === "TimeoutError" || value?.name === "AbortError") return new TranslationFailure("DeepL 翻译超时，请稍后重试。", true);
  if (value?.message === "fetch failed" || /^(?:ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR)/.test(value?.cause?.code || "")) {
    return new TranslationFailure("无法连接 DeepL，请检查网络后重试。", true);
  }
  if (/^(?:翻译任务|翻译文本|翻译语言|请选择目标语言|请先在设置中|DeepL 返回了空译文)/.test(value?.message || "")) {
    return new TranslationFailure(value.message);
  }
  return new TranslationFailure("翻译请求失败，请稍后重试。");
}
const isEnglishTarget = (language) => /^(?:en(?:[-_]|$)|english$)/i.test(language);
const languageName = (value) => {
  const clean = value.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,34}$/.test(clean)) throw new Error("翻译语言参数无效。");
  if (clean === "cn" || clean.toLowerCase() === "chinese") return "zh-CN";
  if (clean.toLowerCase() === "english") return "en";
  return clean;
};
class Translator {
  constructor(history, logFailure) {
    this.history = history;
    this.logFailure = logFailure;
  }
  scheduler = new TranslationScheduler(2);
  pending = /* @__PURE__ */ new Map();
  failedUntil = /* @__PURE__ */ new Map();
  credentialIdentity = "";
  async flushHistory() {
    await this.history?.flush();
  }
  async translate(text, target, source = "auto", _onDelta, options = {}) {
    if (typeof text !== "string" || !text.trim() || text.length > 12e3) throw new Error("翻译文本无效（最多 12000 字符）。");
    const providerGeneration=(translationProvider(),globalThis.__biProviderState.generation);const previousCurrent=options.isCurrent;options={...options,isCurrent:()=>providerGeneration===globalThis.__biProviderState.generation&&(!previousCurrent||previousCurrent())};
    text = text.trim();
    const targetLanguage = normalizeDeepLLanguage(languageName(target)).toLowerCase();
    const sourceLanguage = normalizeDeepLLanguage(languageName(source),"source").toLowerCase();
    if (targetLanguage.toLowerCase() === "auto") throw new Error("请选择目标语言。");
    if (!new RegExp("\\p{L}", "u").test(text) || /^(?:https?:\/\/|www\.)\S+$/i.test(text) || /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(text)) return text;
    const providerIdentity = translationProvider()==='google'?'google-free-native-v1':'deepl-native-v4';
    const identity = JSON.stringify([providerIdentity]);
    const legacyIdentity = JSON.stringify([providerIdentity, options.scope || "workspace"]);
    const cacheSource = sourceLanguage.toLowerCase();
    const reverseIdentity = JSON.stringify([translationProvider()+"-own-message-v2", options.scope]);
    const rememberOutgoing = (result) => {
      if (options.scope && isEnglishTarget(targetLanguage) && /^zh(?:[-_]|$)/i.test(sourceLanguage)) {
        this.history?.remember(reverseIdentity, "en", "zh", result, text);
      }
      return result;
    };
    const key = createHash("sha256").update(JSON.stringify([identity, cacheSource, targetLanguage, text, !!options.bypassCache])).digest("hex");
    const existing = this.pending.get(key);
    if (existing) {
      existing.consumers.push(options);
      return rememberOutgoing(await existing.task);
    }
    const submittedAt=Date.now();
    const deadline=submittedAt+((options.priority||0)>=2000?35000:50000);
    const consumers = [options];
    const hasCurrentConsumer = async () => {
      for (const consumer of consumers) {
        try {
          if (!consumer.isCurrent || await consumer.isCurrent()) return true;
        } catch {
        }
      }
      return false;
    };
    const task = (async () => {
      if (!await hasCurrentConsumer()) throw new Error("翻译任务已取消。");
      let cached = !options.bypassCache && await this.history?.get(identity, cacheSource, targetLanguage, text);
      if (cached) return cached;
      return this.scheduler.run(async () => {
        if (options.isCurrent && (options.priority || 0) < 2e3) await new Promise((resolve2) => setTimeout(resolve2, 200));
        if (!await hasCurrentConsumer()) throw new Error("翻译任务已取消。");
        const ready = !options.bypassCache && await this.history?.get(identity, cacheSource, targetLanguage, text);
        if (ready) return ready;
        const credential = translationCredential();
        if (!credential) throw new Error("请先在设置中填写并保存 DeepL API Key。");
        const credentialIdentity = createHash("sha256").update(credential).digest("hex");
        if (credentialIdentity !== this.credentialIdentity) {
          this.credentialIdentity = credentialIdentity;
          this.failedUntil.clear();
        }
        const previous = this.failedUntil.get(key);
        if (previous && previous.until > Date.now()) {
          throw new TranslationFailure(previous.error.message, false, previous.until - Date.now(), previous.error.status);
        }
        let rawResult;
        try { rawResult=await translateWithDeepL(text,targetLanguage,sourceLanguage,Math.min(options.timeoutMs||30000,30000,Math.max(1,deadline-Date.now())),hasCurrentConsumer); }
        catch(error){const failure=translationFailure(error);this.logFailure?.({scope:options.scope,status:failure.status,reason:failure.message,attempt:1});throw failure;}
        if(!await hasCurrentConsumer())throw new Error("翻译任务已取消。");
        if (!rawResult) throw new Error("DeepL 未返回译文，请检查 API Key。");
        const result = rawResult;
        this.history?.remember(identity, cacheSource, targetLanguage, text, result);
        return result;
      }, options.priority,Math.min((options.priority||0)>=2000?10000:20000,Math.max(1,deadline-Date.now())));
    })();
    this.pending.set(key, { task, consumers });
    try {
      return rememberOutgoing(await task);
    } catch (error) {
      throw translationFailure(error);
    } finally {
      this.pending.delete(key);
    }
  }
}
function normalizeAppearanceTheme(value) {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}
function resolveAppearanceTheme(mode, systemUsesDarkColors) {
  if (mode === "light" || mode === "dark") return mode;
  return systemUsesDarkColors ? "dark" : "light";
}
function appearanceBackgroundColor(theme) {
  return theme === "light" ? "#edf2f8" : "#090c12";
}
function workspaceBackgroundColor(theme) {
  return theme === "light" ? "#f6f8fb" : "#0b0e14";
}
const urls = {
  whatsapp: "https://web.whatsapp.com/",
  telegram: "https://web.telegram.org/k/",
  zoom: "https://app.zoom.us/wc/",
  phound: "https://web.phound.app/login",
  teams: "https://teams.microsoft.com/"
};
const webPlatforms = /* @__PURE__ */ new Set(["whatsapp", "telegram", "zoom", "phound", "teams"]);
const chromeCompatibleUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const allowedWebPermissions = /* @__PURE__ */ new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "clipboard-write",
  "fullscreen",
  "geolocation",
  "media",
  "mediaKeySystem",
  "microphone",
  "display-capture",
  "midi",
  "pointerLock"
]);
const whatsappStoragePermissions = /* @__PURE__ */ new Set([
  "background-sync",
  "persistent-storage"
]);
function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}
function invalidateContents$1(contents) {
  try {
    contents.invalidate?.();
  } catch {
  }
}
function trustedHostForPlatform(platform, url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (platform === "whatsapp") return hostMatchesDomain(host, "whatsapp.com") || hostMatchesDomain(host, "whatsapp.net");
    if (platform === "telegram") return hostMatchesDomain(host, "telegram.org");
    if (platform === "phound") return host === "web.phound.app";
    if (platform === "teams") return new URL(url).protocol === "https:" && ["teams.microsoft.com", "teams.cloud.microsoft", "teams.live.com"].includes(host);
    if (platform === "zoom") return hostMatchesDomain(host, "zoom.us") || hostMatchesDomain(host, "zoom.com");
    return false;
  } catch {
    return false;
  }
}
function allowedPermissionForPlatform(platform, requestingUrl, permission) {
  if (!trustedHostForPlatform(platform, requestingUrl)) return false;
  if (platform === "whatsapp" && whatsappStoragePermissions.has(permission)) return true;
  return allowedWebPermissions.has(permission);
}
function installZoomSessionSupport(contents) {
  const host = globalThis;
  if (!host.__biTalksZoomSessions) {
    const state = { entries: new Map(), quitting: false };
    host.__biTalksZoomSessions = state;
    state.flush = async entry => {
      try { entry.session.flushStorageData(); await entry.session.cookies.flushStore(); return true; }
      catch { return false; }
    };
    // Register ahead of the existing shutdown handler, while web contents still exist.
    app.prependListener('before-quit', event => {
      if (state.finished || !state.entries.size) return;
      event.preventDefault();
      if(state.quitting)return;
      state.quitting = true;
      const flushes = [...state.entries.values()].map(state.flush);
      let timer;
      void Promise.race([Promise.all(flushes), new Promise(resolve => { timer=setTimeout(resolve,2500); })])
        .finally(() => { clearTimeout(timer); state.finished=true; app.quit(); });
    });
  }
  const state=host.__biTalksZoomSessions;
  if(state.entries.has(contents)) return;
  const entry={session:contents.session,timer:null,recoveryTimer:null,attempted:false,until:Date.now()+45000};
  state.entries.set(contents,entry);
  const scheduleFlush=()=>{clearTimeout(entry.timer);entry.timer=setTimeout(()=>{entry.timer=null;void state.flush(entry);},700);};
  const cookieChanged=(_event,cookie)=>{if(/(^|\.)zoom\.(us|com)$/.test(cookie.domain.replace(/^\./,'')))scheduleFlush();};
  const recover=async()=>{
    if(contents.isDestroyed()||entry.attempted||Date.now()>entry.until)return;
    let url;try{url=new URL(contents.getURL());}catch{return;}
    if(url.protocol!=='https:'||url.hostname!=='app.zoom.us'||!/^\/wc\/?$/.test(url.pathname))return;
    const cookies=await entry.session.cookies.get({domain:'zoom.us'}).catch(()=>[]);
    if(!cookies.some(c=>['_zm_kms','_zm_multi_ac'].includes(c.name)))return;
    if(contents.isDestroyed()||entry.attempted)return;
    const result=await contents.executeJavaScript('('+zoomResumeEntry.toString()+')()').catch(()=>false);
    if(result)entry.attempted=true;
  };
  const loaded=()=>{scheduleFlush();void recover();};
  contents.on('did-finish-load',loaded);
  contents.session.cookies.on('changed',cookieChanged);
  entry.recoveryTimer=setInterval(()=>{if(contents.isDestroyed()||entry.attempted||Date.now()>entry.until){clearInterval(entry.recoveryTimer);entry.recoveryTimer=null;return;}void recover();},1500);
  contents.once('destroyed',()=>{clearTimeout(entry.timer);clearInterval(entry.recoveryTimer);entry.session.cookies.removeListener('changed',cookieChanged);void state.flush(entry);state.entries.delete(contents);});
  scheduleFlush();
}
function zoomResumeEntry() {
  if(location.protocol!=='https:'||location.hostname!=='app.zoom.us'||!/^\/wc\/?$/.test(location.pathname))return false;
  if(window.__biTalksZoomResumeAttempted)return true;
  const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  if([...document.querySelectorAll('input')].some(e=>visible(e)&&/password|email|tel/.test(e.type)))return false;
  const candidates=[...document.querySelectorAll('a,button,[role="button"]')].filter(e=>{
    if(!visible(e)||e.disabled||e.getAttribute('aria-disabled')==='true')return false;
    if(!/^(sign\s*in|log\s*in|登录|登入)$/i.test((e.textContent||'').trim()))return false;
    if(e.tagName==='A') {try{const u=new URL(e.href,location.href);if(u.protocol!=='https:'||!/(^|\.)zoom\.(us|com)$/.test(u.hostname))return false;}catch{return false;}}
    return true;
  });
  if(candidates.length!==1)return false;
  window.__biTalksZoomResumeAttempted=true;
  candidates[0].click();
  return true;
}

function syncNativeNotificationState(){
  if(!webViews||!mainWindow||mainWindow.isDestroyed())return;
  const shown=mainWindow.isVisible()&&!mainWindow.isMinimized();
  for(const [id,view] of webViews.views){
    if(view.webContents.isDestroyed())continue;
    const account=store.get().accounts.find(a=>a.id===id);if(!account)continue;
    const visible=shown&&webViews.activeId===id&&account.hidden!==true;
    const warm=['whatsapp','zoom','telegram'].includes(account.platform);
    const key=String(visible)+':'+String(account.hidden===true);
    if(view.__biNotificationVisibility===key)continue;
    view.__biNotificationVisibility=key;
    view.webContents.setAudioMuted(account.hidden===true);
    view.webContents.setBackgroundThrottling(true);
    view.setVisible(visible);
  }
}
function nativeNotificationAllowed(platform, url) {
  try {const u=new URL(url);return u.protocol==='https:' && trustedHostForPlatform(platform,url);}catch{return false;}
}
function configureWebSession(view, platform) {
  const userAgent = chromeCompatibleUserAgent;
  view.webContents.setUserAgent(userAgent);
  view.webContents.session.setUserAgent(userAgent);
  view.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === "notifications") return nativeNotificationAllowed(platform, requestingOrigin || webContents?.getURL() || "");
    const requestingUrl = requestingOrigin || webContents?.getURL() || "";
    return allowedPermissionForPlatform(platform, requestingUrl, permission);
  });
  view.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(permission === "notifications" ? nativeNotificationAllowed(platform, requestingUrl) : allowedPermissionForPlatform(platform, requestingUrl, permission));
  });
  view.webContents.session.setDevicePermissionHandler(() => false);
}
function accountPartition(account) {
  if (account.platform === "whatsapp") {
    const token = createHash("sha256").update(account.id).digest("hex").slice(0, 20);
    return `persist:w-${token}`;
  }
  return `persist:unified-${account.platform}-${account.id}`;
}
function accountPreferenceScript(account) {
  const color = typeof account.translationColor === "string" ? account.translationColor : "#d8ff00";
  const size = typeof account.translationSize === "number" ? account.translationSize : 15;
  const clampedSize = Math.max(10, Math.min(24, Math.round(size)));
  const enabled = account.translationEnabled !== false;
  return `
(() => {
  document.documentElement.setAttribute('data-bi-translation-engine', ${JSON.stringify('deepl')});
  window.__biTalksTranslationPrefs = { color: ${JSON.stringify(color)}, size: ${clampedSize}, enabled: ${enabled} };
  document.documentElement.style.setProperty('--bi-talks-translation-color', window.__biTalksTranslationPrefs.color);
  document.documentElement.style.setProperty('--bi-talks-translation-size', window.__biTalksTranslationPrefs.size + 'px');
  document.documentElement.style.setProperty('--bi-talks-translation-enabled', window.__biTalksTranslationPrefs.enabled ? 'true' : 'false');
  document.querySelectorAll('[data-unified-translation]').forEach((node) => {
    if (!window.__biTalksTranslationPrefs.enabled) { node.remove(); return; }
    if (!(node instanceof HTMLElement)) return;
    node.style.color = window.__biTalksTranslationPrefs.color;
    node.style.fontSize = window.__biTalksTranslationPrefs.size + 'px';
  });
})();
`;
}
class WebViewManager {
  constructor(window2, emit2) {
    this.window = window2;
    this.emit = emit2;
  }
  accountForContents(contents) {
    return [...this.views.entries()].find(([, view]) => view.webContents === contents)?.[0];
  }
  ownsContents(contents) {
    return [...this.views.values()].some((view) => view.webContents === contents);
  }
  views = /* @__PURE__ */ new Map();
  whatsappViews = /* @__PURE__ */ new WeakSet();
  viewUseOrder = /* @__PURE__ */ new Map();
  unreadSources = /* @__PURE__ */ new Map();
  publishedUnread = /* @__PURE__ */ new Map();
  preloadUnreadReady = /* @__PURE__ */ new Set();
  whatsappPreferenceSignatures = /* @__PURE__ */ new Map();
  viewUseSequence = 0;
  maxRetainedViews = 16;
  activeId;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  appearanceTheme = "dark";
  setAppearanceTheme(theme) {
    this.appearanceTheme = theme;
    const backgroundColor = workspaceBackgroundColor(theme);
    for (const view of this.views.values()) {
      if (view.webContents.isDestroyed()) continue;
      try {
        view.setBackgroundColor(backgroundColor);
        invalidateContents$1(view.webContents);
      } catch {
      }
    }
  }
  publishUnread(accountId, trustedDecrease = false) {
    const current = this.unreadSources.get(accountId) || { title: 0, dom: 0 };
    const count = Math.max(current.title, current.dom);
    if (this.publishedUnread.get(accountId) === count) {
      if (trustedDecrease) this.emit({ type: "unread", accountId, count, trustedDecrease: true });
      return;
    }
    this.publishedUnread.set(accountId, count);
    this.emit({ type: "unread", accountId, count, trustedDecrease });
  }
  updateUnread(accountId, source, value, trustedDecrease = false) {
    const current = this.unreadSources.get(accountId) || { title: 0, dom: 0 };
    current[source] = Math.max(0, Math.min(999, Math.round(value)));
    this.unreadSources.set(accountId, current);
    if (source === "title" && this.preloadUnreadReady.has(accountId)) return;
    this.publishUnread(accountId, trustedDecrease);
  }
  reportPreloadUnread(accountId, titleCount, domCount, senderId, trustedDecrease = false) {
    const view = this.views.get(accountId);
    if (!view || view.webContents.isDestroyed() || view.webContents.id !== senderId) return;
    this.preloadUnreadReady.add(accountId);
    this.unreadSources.set(accountId, {
      title: Math.max(0, Math.min(999, Math.round(titleCount))),
      dom: Math.max(0, Math.min(999, Math.round(domCount)))
    });
    this.publishUnread(accountId, trustedDecrease);
  }
  clearUnread(accountId) {
    const hadUnreadState = this.unreadSources.has(accountId) || this.publishedUnread.has(accountId);
    this.unreadSources.delete(accountId);
    this.publishedUnread.delete(accountId);
    this.preloadUnreadReady.delete(accountId);
    if (hadUnreadState) this.emit({ type: "unread", accountId, count: 0 });
  }
  isWebPlatform(platform) {
    return webPlatforms.has(platform);
  }
  ensureView(account) {
    if (!this.isWebPlatform(account.platform)) return void 0;
    const webPlatform = account.platform;
    let view = this.views.get(account.id);
    if (view?.webContents.isDestroyed()) {
      this.views.delete(account.id);
      this.whatsappPreferenceSignatures.delete(account.id);
      this.preloadUnreadReady.delete(account.id);
      view = void 0;
    }
    if (view) {
      this.touchView(account.id);
      return view;
    }
    const preload = join(app.getAppPath(), "out/preload/service.cjs");
    view = new WebContentsView({
      webPreferences: {
        preload,
        partition: accountPartition(account),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        // Telegram is a full client-side application. Let it initialize at
        // foreground speed so its cached, signed-in view is ready as soon
        // as the account is opened. Other web clients retain throttling.
        // Keep WhatsApp's compositor warm while its view is detached. If it
        // is throttled in the background, returning to it exposes one blank
        // paint before Chromium resumes the page.
        backgroundThrottling: true,
        spellcheck: false,
        additionalArguments: [
          `--service-platform=${account.platform}`,
          `--service-account=${account.id}`,
          `--translation-color=${account.translationColor || "#d8ff00"}`,
          `--translation-size=${account.translationSize || 15}`,
          `--translation-enabled=${account.translationEnabled !== false}`
        ]
      }
    });
    view.setBackgroundColor(workspaceBackgroundColor(this.appearanceTheme));
    if (webPlatform === "whatsapp") this.whatsappViews.add(view);
    if (webPlatform === "zoom") view.setBounds(this.bounds);
    view.webContents.setBackgroundThrottling(true);
    view.webContents.setAudioMuted(account.hidden === true);
    configureWebSession(view, webPlatform);
    if(webPlatform === "zoom") installZoomSessionSupport(view.webContents);
    if (webPlatform === "zoom") {
      view.webContents.session.preconnect({ url: "https://app.zoom.us", numSockets: 2 });
      view.webContents.session.preconnect({ url: "https://st1.zoom.us", numSockets: 2 });
    }
    if (webPlatform === "telegram") {
      view.webContents.session.preconnect({ url: "https://web.telegram.org", numSockets: 6 });
    }
    view.webContents.setWindowOpenHandler(({ url }) => {
      if(webPlatform === "teams") { let u;try{u=new URL(url);}catch{}if(u?.protocol==="https:" && ["login.microsoftonline.com","login.live.com","account.live.com"].includes(u.hostname))return {action:"allow",overrideBrowserWindowOptions:{width:560,height:740,autoHideMenuBar:true,webPreferences:{partition:accountPartition(account),contextIsolation:true,sandbox:true,nodeIntegration:false}}}; }
      if (trustedHostForPlatform(webPlatform, url)) void view.webContents.loadURL(url).catch(() => void 0);
      else void shell.openExternal(url).catch(() => void 0);
      return { action: "deny" };
    });
    view.webContents.on("render-process-gone", () => {
      if (this.activeId === account.id) this.activeId = void 0;
      this.views.delete(account.id);
      this.viewUseOrder.delete(account.id);
      this.whatsappPreferenceSignatures.delete(account.id);
      this.preloadUnreadReady.delete(account.id);
    });
    view.webContents.on("destroyed", () => {
      if (this.activeId === account.id) this.activeId = void 0;
      this.views.delete(account.id);
      this.viewUseOrder.delete(account.id);
      this.whatsappPreferenceSignatures.delete(account.id);
      this.preloadUnreadReady.delete(account.id);
    });
    view.webContents.on("page-title-updated", (_event, title) => {
    });
    if (webPlatform === "whatsapp") {
      view.webContents.on("preload-error", (_event, preloadPath, error) => {
        console.warn(`WhatsApp preload failed: ${preloadPath}`, error);
      });
    }
    view.webContents.on("did-finish-load", () => {
      this.applyPreferences(account, true);
      const source = readFileSync(join(__dirname, "../runtime-vendor/webview2-host/UnreadMonitor.js"), "utf8");
      void view.webContents.executeJavaScript(source + "(" + JSON.stringify(webPlatform) + ", window.__biTalksReportUnread)").catch((error) => console.warn("Unread monitor unavailable", error));
    });
    if (webPlatform === "zoom" || webPlatform === "whatsapp" || webPlatform === "telegram" || webPlatform === "phound" || webPlatform === "teams") {
      const platformName = webPlatform === "teams" ? "Microsoft Teams" : webPlatform === "phound" ? "Phound" : webPlatform === "zoom" ? "Zoom" : webPlatform === "whatsapp" ? "WhatsApp" : "Telegram";
      const contents = view.webContents;
      let slowLoadTimer;
      let mainPageLoading = false;
      const clearSlowLoadTimer = () => {
        if (slowLoadTimer) clearTimeout(slowLoadTimer);
        slowLoadTimer = void 0;
      };
      const report = (status) => this.emit({ type: "connection", accountId: account.id, status });
      const finishLoading = () => {
        if (!mainPageLoading) return;
        mainPageLoading = false;
        clearSlowLoadTimer();
        report("Ready");
      };
      contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        if (!isMainFrame || isInPlace) return;
        mainPageLoading = true;
        clearSlowLoadTimer();
        report(`正在加载 ${platformName}…`);
        slowLoadTimer = setTimeout(() => {
          if (mainPageLoading) report(`正在连接 ${platformName}，耗时较长…`);
        }, 2e4);
      });
      if (webPlatform === "zoom") {
        contents.on("dom-ready", () => {
          if (!contents.isDestroyed()) contents.invalidate();
        });
      } else contents.on("dom-ready", finishLoading);
      contents.on("did-finish-load", finishLoading);
      contents.on("did-stop-loading", finishLoading);
      contents.on("did-fail-load", (_event, code, _description, _url, isMainFrame) => {
        if (!isMainFrame || code === -3) return;
        mainPageLoading = false;
        clearSlowLoadTimer();
        report(`${platformName} 加载失败，请刷新账号`);
      });
      contents.once("destroyed", clearSlowLoadTimer);
      report(`正在启动 ${platformName}…`);
    }
    this.views.set(account.id, view);
    this.touchView(account.id);
    const userAgent = chromeCompatibleUserAgent;
    void view.webContents.loadURL(urls[webPlatform], { userAgent }).catch((error) => {
      if (webPlatform === "zoom") {
        if (error?.code !== "ERR_ABORTED") console.warn("Zoom initial navigation did not complete:", error);
        return;
      }
      if (this.views.get(account.id) === view) this.views.delete(account.id);
      try {
        view?.webContents.close();
      } catch (error2) {
        console.warn("Failed to close a web view after navigation failure.", error2);
      }
    });
    return view;
  }
  touchView(accountId) {
    this.viewUseSequence += 1;
    this.viewUseOrder.set(accountId, this.viewUseSequence);
  }
  disposeView(accountId, deferClose = false, clearUnread = true) {
    const view = this.views.get(accountId);
    if (!view) return;
    if (this.activeId === accountId) {
      try {
        this.window.contentView.removeChildView(view);
      } catch (error) {
        console.warn("Failed to detach the active web view.", error);
      }
      this.activeId = void 0;
    }
    this.views.delete(accountId);
    this.viewUseOrder.delete(accountId);
    this.whatsappPreferenceSignatures.delete(accountId);
    this.preloadUnreadReady.delete(accountId);
    if (clearUnread) this.clearUnread(accountId);
    const closeView = () => {
      try {
        view.webContents.close();
      } catch (error) {
        console.warn("Failed to close a web view.", error);
      }
    };
    if (deferClose) setTimeout(closeView, 100);
    else closeView();
  }
  trimInactiveViews(keepId) {
    while (this.views.size > this.maxRetainedViews) {
      const candidate = [...this.views.keys()].filter((id) => id !== keepId && id !== this.activeId).sort((a, b) => (this.viewUseOrder.get(a) || 0) - (this.viewUseOrder.get(b) || 0))[0];
      if (!candidate) return;
      this.disposeView(candidate, true, false);
    }
  }
  ownsAccountContents(accountId, senderId) {
    const view = this.views.get(accountId);
    return !!view && !view.webContents.isDestroyed() && view.webContents.id === senderId;
  }
  syncAccountVisibility(accounts) {
    for (const account of accounts) {
      const view = this.views.get(account.id);
      if (!view || view.webContents.isDestroyed()) continue;
      view.webContents.setAudioMuted(account.hidden === true);
      void view.webContents.executeJavaScript("window.__biTalksRescanUnread?.()").catch(() => void 0);
    }
  }
  async start(account) {
    const view = this.ensureView(account);
    if (!view) return;
    this.applyPreferences(account);
  }
  async activate(account) {
    if (account && this.isWebPlatform(account.platform) && this.activeId === account.id) {
      const active = this.views.get(account.id);
      if (active && !active.webContents.isDestroyed()) {
        active.webContents.setAudioMuted(false);
        this.touchView(account.id);
        return;
      }
      this.activeId = void 0;
    }
    const previousId = this.activeId;
    const previous = previousId ? this.views.get(previousId) : void 0;
    const switchingToWhatsapp = account?.platform === "whatsapp";
    if (this.activeId && !switchingToWhatsapp) {
      if (previous) {
        previous.webContents.setAudioMuted(store.get().accounts.find(a=>a.id===previousId)?.hidden === true);
        try {
          this.window.contentView.removeChildView(previous);
        } catch {
        }
      }
      this.activeId = void 0;
    }
    if (!account || !this.isWebPlatform(account.platform)) return;
    const view = this.ensureView(account);
    if (!view) return;
    this.applyPreferences(account);
    view.webContents.setAudioMuted(false);
    view.setBounds(this.bounds);
    try {
      this.window.contentView.addChildView(view);
    } catch {
    }
    this.activeId = account.id;
    syncNativeNotificationState();
    if (switchingToWhatsapp && previous && previous !== view) {
      previous.webContents.setAudioMuted(store.get().accounts.find(a=>a.id===previousId)?.hidden === true);
      try {
        this.window.contentView.removeChildView(previous);
      } catch {
      }
    }
    this.touchView(account.id);
    this.trimInactiveViews(account.id);
  }
  applyPreferences(account, force = false) {
    const view = this.views.get(account.id);
    if (!view || view.webContents.isDestroyed()) return;
    const zoom = typeof account.zoom === "number" ? account.zoom : 100;
    if (account.platform === "whatsapp") {
      const signature = JSON.stringify([
        zoom,
        account.translationColor || "#d8ff00",
        account.translationSize || 15,
        account.translationEnabled !== false
      ]);
      if (!force && this.whatsappPreferenceSignatures.get(account.id) === signature) return;
      this.whatsappPreferenceSignatures.set(account.id, signature);
    }
    try {
      view.webContents.setZoomFactor(Math.max(0.4, Math.min(1.6, zoom / 100)));
    } catch {
    }
    void view.webContents.executeJavaScript(accountPreferenceScript(account), true).catch(() => void 0);
  }
  async refresh(account) {
    if (!this.isWebPlatform(account.platform)) return;
    const view = this.views.get(account.id);
    if (!view || view.webContents.isDestroyed()) {
      this.views.delete(account.id);
      await this.start(account);
      return;
    }
    this.applyPreferences(account);
    if (account.platform === "zoom") {
      const contents = view.webContents;
      if (contents.isLoadingMainFrame()) return;
      const currentUrl = contents.getURL();
      try {
        await contents.loadURL(trustedHostForPlatform("zoom", currentUrl) ? currentUrl : urls.zoom, { userAgent: chromeCompatibleUserAgent });
      } catch (error) {
        console.warn("Zoom refresh navigation did not complete:", error);
      }
      return;
    }
    try {
      await view.webContents.loadURL(urls[account.platform], { userAgent: chromeCompatibleUserAgent });
    } catch (error) {
      console.warn("Web view refresh navigation failed; retrying from cache bypass.", error);
      try {
        view.webContents.reloadIgnoringCache();
      } catch (reloadError) {
        console.warn("Web view cache-bypass refresh failed.", reloadError);
      }
    }
  }
  async capturePreview(accountId) {
    if (this.activeId !== accountId) return void 0;
    const view = this.views.get(accountId);
    if (!view || view.webContents.isDestroyed()) return void 0;
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return void 0;
    const size = image.getSize();
    const preview = size.width > 960 ? image.resize({ width: 960, quality: "good" }) : image;
    const jpeg = preview.toJPEG(55);
    return jpeg.length ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : void 0;
  }
  async sendWhatsAppTranslated(accountId, text) {
    const view = this.views.get(accountId);
    const translated = text.trim();
    if (!view || view.webContents.isDestroyed() || !translated) return false;
    const selected = await view.webContents.executeJavaScript(`
(() => {
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 120 && rect.height >= 16 && rect.top >= innerHeight * .42;
  };
  const valid = (editor) => {
    const signature = (String(editor.getAttribute('aria-label') || '') + ' ' + String(editor.getAttribute('data-testid') || '') + ' ' + String(editor.className || '')).toLowerCase();
    if (/search|搜索|查找|filter|筛选|profile|个人资料|nickname|备注/u.test(signature)) return false;
    return document.querySelector('#main')?.contains(editor) || !!editor.closest('[role="dialog"],[data-animate-modal-popup="true"],[data-testid*="media" i],[class*="media" i],[class*="caption" i]');
  };
  const active = document.activeElement?.closest?.('[contenteditable="true"]');
  const editor = active instanceof HTMLElement && visible(active) && valid(active)
    ? active
    : Array.from(document.querySelectorAll('[contenteditable="true"]')).filter((item) => item instanceof HTMLElement && visible(item) && valid(item)).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
  if (!(editor instanceof HTMLElement)) return false;
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return document.activeElement === editor || editor.contains(document.activeElement);
})()
`, true).catch(() => false);
    if (!selected || view.webContents.isDestroyed()) return false;
    view.webContents.focus();
    view.webContents.insertText(translated);
    await new Promise((resolve2) => setTimeout(resolve2, 45));
    const ready = await view.webContents.executeJavaScript(`
(() => {
  const active = document.activeElement?.closest?.('[contenteditable="true"]');
  return active instanceof HTMLElement && (active.innerText || active.textContent || '').trim() === ${JSON.stringify(translated)};
})()
`, true).catch(() => false);
    if (!ready || view.webContents.isDestroyed()) return false;
    view.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
    view.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
    return true;
  }
  close(account) {
    this.disposeView(account.id);
  }
  setBounds(bounds) {
    const nextBounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    };
    if (this.bounds.x === nextBounds.x && this.bounds.y === nextBounds.y && this.bounds.width === nextBounds.width && this.bounds.height === nextBounds.height) return;
    this.bounds = nextBounds;
    if (this.activeId) this.views.get(this.activeId)?.setBounds(this.bounds);
  }
  recoverActive() {
    if (!this.activeId) return;
    const view = this.views.get(this.activeId);
    if (!view || view.webContents.isDestroyed()) {
      this.activeId = void 0;
      return;
    }
    if (this.whatsappViews.has(view) && this.window.contentView.children.includes(view)) {
      invalidateContents$1(view.webContents);
      return;
    }
    try {
      this.window.contentView.removeChildView(view);
    } catch {
    }
    view.setBounds(this.bounds);
    try {
      this.window.contentView.addChildView(view);
    } catch {
    }
    invalidateContents$1(view.webContents);
  }
  async remove(account) {
    if (!this.isWebPlatform(account.platform)) return;
    const view = this.views.get(account.id);
    const accountSession = view && !view.webContents.isDestroyed() ? view.webContents.session : session.fromPartition(accountPartition(account));
    this.close(account);
    await this.clearAccountSessionData(accountSession);
  }
  async clearAccountSessionData(accountSession) {
    await accountSession.clearStorageData({
      storages: ["cookies", "filesystem", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
    });
    await accountSession.clearCache();
    await accountSession.flushStorageData();
  }
  shutdown() {
    const views = [...this.views.values()];
    this.views.clear();
    this.viewUseOrder.clear();
    this.unreadSources.clear();
    this.publishedUnread.clear();
    this.preloadUnreadReady.clear();
    this.activeId = void 0;
    for (const view of views) {
      try {
        this.window.contentView.removeChildView(view);
      } catch (error) {
        console.warn("Failed to detach a web view during shutdown.", error);
      }
      try {
        if (!view.webContents.isDestroyed()) view.webContents.close();
      } catch (error) {
        console.warn("Failed to close a web view during shutdown.", error);
      }
    }
  }
}
function installSignalUnreadMonitor() {
  const host = window;
  if (host.__biTalksSignalUnreadInstalled) return;
  host.__biTalksSignalUnreadInstalled = true;
  const previewRows = /* @__PURE__ */ new Map();
  let pendingPreview;
  let previewAt = 0;
  function scanPreview() {
    const changed = [];
    document.querySelectorAll(".module-conversation-list__item--contact-or-conversation").forEach((row) => {
      const contact = row.querySelector(".module-conversation-list__item--contact-or-conversation__name")?.textContent?.trim() || "";
      const text = row.querySelector(".module-conversation-list__item--contact-or-conversation__message")?.textContent?.trim() || "";
      const key = row.getAttribute("data-conversation-id") || contact;
      if (!key || !contact) return;
      const previous = previewRows.get(key);
      if (previous !== void 0 && previous !== text && row.querySelector(".module-conversation-list__item--contact-or-conversation__unread-indicator--unread-messages")) changed.push({ contact: contact.slice(0, 160), text: text.slice(0, 240) });
      previewRows.set(key, text);
    });
    if (changed.length === 1) {
      pendingPreview = changed[0];
      previewAt = Date.now();
    } else if (changed.length > 1) pendingPreview = void 0;
  }
  let candidate;
  let since = 0;
  let lastReported;
  let timer;
  function number(text) {
    const match = String(text || "").trim().match(/^(\d{1,4})\+?(?:\s|$)/);
    return match ? Math.min(999, Number(match[1])) : void 0;
  }
  function readTotal() {
    if (document.readyState !== "complete") return void 0;
    const title = document.title.trim();
    const titleMatch = title.match(/^Signal\s*\((\d{1,4})\)$/i) || title.match(/^\((\d{1,4})\)\s+Signal$/i);
    const titleCount = titleMatch ? Math.min(999, Number(titleMatch[1])) : void 0;
    const chats = document.querySelector('[data-testid="NavTabsItem--Chats"],.NavTabs__Item--Chats');
    const badge = chats?.querySelector(".NavTabs__ItemUnreadBadge");
    const badgeCount = badge ? number(badge.querySelector('[aria-hidden="true"]')?.textContent) ?? number(badge.querySelector(".NavTabs__ItemIconLabel")?.textContent) ?? number(badge.getAttribute("aria-label")) ?? 1 : 0;
    if ((titleCount ?? 0) > 0 || badgeCount > 0) return Math.max(titleCount ?? 0, badgeCount);
    if (!chats || !document.querySelector(".module-conversation-list")) return void 0;
    if (!/^Signal$/i.test(title) && titleCount !== 0) return void 0;
    if (document.querySelector(".module-conversation-list__item--contact-or-conversation__unread-indicator--unread-messages")) return void 0;
    return 0;
  }
  function scan() {
    if (timer) clearTimeout(timer);
    timer = void 0;
    scanPreview();
    const count = readTotal();
    if (count === void 0) {
      candidate = void 0;
      return;
    }
    if (candidate !== count) {
      candidate = count;
      since = Date.now();
    }
    const stability = count === 0 || lastReported !== void 0 && count < lastReported ? 1200 : 300;
    const remaining = stability - (Date.now() - since);
    if (remaining > 0) {
      timer = setTimeout(scan, remaining);
      return;
    }
    if (count === lastReported || typeof host.__biTalksUnreadReport !== "function") return;
    host.__biTalksUnreadReport(JSON.stringify({ count, partial: false, trustedDecrease: true, source: "signal-total-v1", preview: Date.now() - previewAt < 3e3 ? pendingPreview : void 0 }));
    pendingPreview = void 0;
    lastReported = count;
  }
  function schedule() {
    if (!timer) timer = setTimeout(scan, 120);
  }
  host.__biTalksRescanUnread = () => {
    lastReported = void 0;
    schedule();
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "aria-label", "data-testid"]
  });
  addEventListener("visibilitychange", schedule);
  setInterval(scan, 1200);
  schedule();
}
const signalUnreadSource = `(${installSignalUnreadMonitor.toString()})()`;
function sleep(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}
function translationPreferences(account) {
  return {
    engine: "deepl",
    enabled: account.translationEnabled !== false,
    color: account.translationColor || "#d8ff00",
    size: Math.min(24, Math.max(10, account.translationSize || 15))
  };
}
function installSignalTranslation() {
  const signalWindow = window;
  const installNativeUpdateBridge = () => {
    if (signalWindow.__biTalksNativeUpdateBridge === "native-update-v1") return;
    signalWindow.__biTalksNativeUpdateBridge = "native-update-v1";
    let requestPending = false;
    document.addEventListener("click", (event) => {
      const path = event.composedPath().filter((item) => item instanceof HTMLElement);
      const control = path.find((element) => element.matches('button,a,[role="button"],[data-testid*="update" i],[class*="update" i]'));
      if (!control) return;
      const label = `${control.innerText || control.textContent || ""} ${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""}`.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!/(?:有可用更新|点击(?:重启|更新).*signal|signal.*(?:更新|update)|(?:update|restart).*signal)/iu.test(label)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (requestPending) return;
      requestPending = true;
      try {
        signalWindow.__biTalksSignalUpdateRequest?.(JSON.stringify({ source: "signal-native-update", label }));
      } finally {
        setTimeout(() => {
          requestPending = false;
        }, 2500);
      }
    }, true);
  };
  installNativeUpdateBridge();
  const installEnglishOnlySendGuard = () => {
    if (signalWindow.__biTalksEnglishOnlySendGuardController?.version === "complete-v7") return;
    signalWindow.__biTalksEnglishOnlySendGuardController?.destroy();
    signalWindow.__biTalksEnglishOnlySendGuard = "complete-v7";
    const chinese = new RegExp("\\p{Script=Han}", "u");
    const listenerController = new AbortController();
    let outgoingStatusTimer;
    const outgoingJobs = /* @__PURE__ */ new Map();
    const outgoingSendJobs = /* @__PURE__ */ new Map();
    const outgoingPending = /* @__PURE__ */ new WeakSet();
    const outgoingTokens = /* @__PURE__ */ new WeakMap();
    let nativeSendEditor;
    let nativeSendUntil = 0;
    let outgoingSequence = 0;
    const origin = (event) => event.composedPath().find((item) => item instanceof Element);
    const editorFrom = (element) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element;
      return element.closest('[contenteditable]:not([contenteditable="false"]),[role="textbox"]') || void 0;
    };
    const editorText = (editor) => editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText || editor.textContent || "";
    const visible2 = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width >= 60 && rect.height >= 12;
    };
    const isComposer = (editor) => {
      if (!visible2(editor)) return false;
      if (editor instanceof HTMLInputElement && /^(search|email|password|tel|url|number)$/i.test(editor.type)) return false;
      const signature = `${editor.getAttribute("aria-label") || ""} ${editor.getAttribute("placeholder") || ""} ${editor.getAttribute("data-testid") || ""} ${editor.className || ""}`.toLowerCase();
      if (/nickname|first.?name|last.?name|profile|contact.?name|about|note|昵称|备注|姓名|名字|姓氏/u.test(signature)) return false;
      if (/message|compose|conversation|chat|caption|comment|reply|send|发送|消息|信息|说明|回复/u.test(signature)) return true;
      const explicitComposeScope = editor.closest('[data-testid*="compose" i],[class*="compose" i],[class*="composer" i]');
      if (explicitComposeScope) return true;
      if (editor.closest('[role="dialog"],[aria-modal="true"]')) return false;
      return editor.getBoundingClientRect().top >= Math.max(140, innerHeight * 0.55);
    };
    const editors = (root) => Array.from(root.querySelectorAll('textarea,input,[role="textbox"],[contenteditable]:not([contenteditable="false"])')).filter((editor) => editor instanceof HTMLElement && isComposer(editor));
    const nearestEditor = (element) => {
      const direct = editorFrom(element);
      if (direct && isComposer(direct)) return direct;
      const scope = element.closest('form,[data-testid*="compose" i],[class*="compose" i],[class*="composer" i]');
      if (!scope) return void 0;
      const candidates = editors(scope);
      return candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    };
    const fileNames = (files) => files ? Array.from(files).map((file) => file.name || "") : [];
    const attachmentFileNameHasChinese = (editor) => {
      if (Array.from(document.querySelectorAll('input[type="file"]')).flatMap((input) => fileNames(input.files)).some((name) => chinese.test(name))) return true;
      if (!editor) return false;
      const scope = editor.closest('form,[role="dialog"],[data-testid*="compose" i],[class*="compose" i],[class*="composer" i]') || editor.parentElement;
      if (!scope) return false;
      return Array.from(scope.querySelectorAll("[data-filename]")).some((item) => chinese.test(item.getAttribute("data-filename") || ""));
    };
    const showOutgoingStatus = (message, tone = "progress", duration = 0) => {
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
      if (duration > 0) outgoingStatusTimer = setTimeout(() => {
        status?.remove();
        outgoingStatusTimer = void 0;
      }, duration);
    };
    const suppress = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    };
    const block = (event) => {
      suppress(event);
    };
    const nativeSendAllowed = (editor) => !!editor && nativeSendEditor === editor && Date.now() < nativeSendUntil;
    const shouldBlock = (editor) => {
      const candidates = /* @__PURE__ */ new Set();
      if (editor) {
        candidates.add(editor);
        const scope = editor.closest('form,[role="dialog"],[data-testid*="compose" i],[class*="compose" i],[class*="composer" i]');
        if (scope) editors(scope).forEach((candidate) => candidates.add(candidate));
      } else {
        editors(document).forEach((candidate) => candidates.add(candidate));
      }
      return Array.from(candidates).some((candidate) => chinese.test(editorText(candidate))) || attachmentFileNameHasChinese(editor);
    };
    const isSendControl = (element) => {
      const control = element.closest('button,[role="button"]');
      if (!control) return false;
      const marker = control.querySelector("[data-icon],[data-testid],[aria-label],[title]");
      const signature = `${element.getAttribute("data-icon") || ""} ${element.getAttribute("data-testid") || ""} ${element.getAttribute("aria-label") || ""} ${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""} ${control.getAttribute("data-testid") || ""} ${marker?.getAttribute("data-icon") || ""} ${marker?.getAttribute("data-testid") || ""} ${marker?.getAttribute("aria-label") || ""} ${marker?.getAttribute("title") || ""} ${control.textContent || ""}`.trim().toLowerCase();
      if (/attach|attachment|add|plus|microphone|voice|emoji|表情|附件|添加|语音/u.test(signature)) return false;
      return signature.includes("发送") || /(^|[\s_-])send([\s_-]|$)/u.test(signature) || /sendbutton|send-button|sendmessage|send-message/u.test(signature);
    };
    const editorForSendControl = (element) => {
      const related = nearestEditor(element);
      if (related) return related;
      if (document.activeElement instanceof Element) {
        const active = editorFrom(document.activeElement);
        if (active && isComposer(active)) return active;
      }
      return editors(document).sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.bottom - leftRect.bottom || rightRect.top - leftRect.top;
      })[0];
    };
    const sendControlForEditor = (editor) => {
      const editorRect = editor.getBoundingClientRect();
      const score = (candidate) => {
        const rect = candidate.getBoundingClientRect();
        return Math.abs(rect.right - editorRect.right) + Math.abs(rect.bottom - editorRect.bottom);
      };
      const signature = (candidate) => `${candidate.getAttribute("aria-label") || ""} ${candidate.getAttribute("title") || ""} ${candidate.getAttribute("data-testid") || ""} ${candidate.textContent || ""}`.toLowerCase();
      const closestToEditor = (candidates) => candidates.filter((candidate) => !(candidate instanceof HTMLButtonElement) || !candidate.disabled).sort((left, right) => {
        const leftExplicit = /(^|[\s_-])send([\s_-]|$)|发送消息|发送/u.test(signature(left)) ? 0 : 1;
        const rightExplicit = /(^|[\s_-])send([\s_-]|$)|发送消息|发送/u.test(signature(right)) ? 0 : 1;
        return leftExplicit - rightExplicit || score(left) - score(right);
      })[0];
      const compositionScope = editor.closest('[data-testid*="Composition" i],[class*="CompositionArea" i],[class*="composition-area" i]');
      if (compositionScope) {
        const controls = Array.from(compositionScope.querySelectorAll('button,[role="button"],[data-testid],[aria-label],[title]'));
        const matches = controls.filter((candidate) => isSendControl(candidate) || /(^|[\s_-])send([\s_-]|$)|发送消息|发送/u.test(signature(candidate)));
        const selected = closestToEditor(matches);
        if (selected) return selected;
      }
      let scope = editor.parentElement;
      for (let depth = 0; scope && depth < 8; depth += 1, scope = scope.parentElement) {
        const withinScope = closestToEditor(Array.from(scope.querySelectorAll('button,[role="button"],[data-testid],[aria-label],[title]')).filter((candidate) => isSendControl(candidate)));
        if (withinScope) return withinScope;
      }
      return closestToEditor(Array.from(document.querySelectorAll('button,[role="button"],[data-testid],[aria-label],[title]')).filter((candidate) => isSendControl(candidate)));
    };
    const normalizeText = (text) => text.replace(/\r\n?/g, "\n").trim();
    const clearNativeSend = (editor) => {
      if (nativeSendEditor !== editor) return;
      nativeSendEditor = void 0;
      nativeSendUntil = 0;
    };
    const cleanupOutgoingJob = (job) => {
      outgoingJobs.delete(job.id);
      outgoingSendJobs.delete(job.id);
      if (outgoingTokens.get(job.editor) === job.token) {
        outgoingTokens.delete(job.editor);
        outgoingPending.delete(job.editor);
      }
      clearNativeSend(job.editor);
    };
    const cancelEditorJobs = (editor) => {
      const jobs = /* @__PURE__ */ new Set();
      outgoingJobs.forEach((job) => {
        if (job.editor === editor) jobs.add(job);
      });
      outgoingSendJobs.forEach((job) => {
        if (job.editor === editor) jobs.add(job);
      });
      jobs.forEach(cleanupOutgoingJob);
    };
    const cancelAllOutgoingJobs = () => {
      const jobs = /* @__PURE__ */ new Set([...outgoingJobs.values(), ...outgoingSendJobs.values()]);
      jobs.forEach(cleanupOutgoingJob);
    };
    const hasCurrentIntent = (job) => job.editor.isConnected && outgoingTokens.get(job.editor) === job.token;
    const hasOriginalDraft = (job) => hasCurrentIntent(job) && normalizeText(editorText(job.editor)) === normalizeText(job.source);
    const hasTranslatedDraft = (job) => hasCurrentIntent(job) && !!job.translated && normalizeText(editorText(job.editor)) === normalizeText(job.translated);
    const editorHasFocus = (editor) => document.activeElement === editor || !!document.activeElement && editor.contains(document.activeElement);
    const translateAndSend = (event, editor, intent) => {
      const source = editorText(editor).trim();
      if (!source || !chinese.test(source) || attachmentFileNameHasChinese(editor)) return false;
      suppress(event);
      if (outgoingPending.has(editor)) return true;
      const id = `outgoing-${Date.now()}-${++outgoingSequence}`;
      const token = `${id}-${intent}`;
      const job = { id, editor, source, token, intent, phase: "translating" };
      outgoingPending.add(editor);
      outgoingTokens.set(editor, token);
      outgoingJobs.set(id, job);
      showOutgoingStatus("正在翻译中…");
      const requestTranslation = signalWindow.__biTalksTranslateOutgoingRequest;
      if (!requestTranslation) {
        cleanupOutgoingJob(job);
        return true;
      }
      try {
        requestTranslation(JSON.stringify({ id, text: source }));
      } catch {
        cleanupOutgoingJob(job);
      }
      return true;
    };
    signalWindow.__biTalksOutgoingTranslationResult = (id, translated) => {
      const job = outgoingJobs.get(id);
      if (!job || !hasOriginalDraft(job)) {
        if (job) cleanupOutgoingJob(job);
        return false;
      }
      const english = String(translated || "").trim();
      if (!english) {
        cleanupOutgoingJob(job);
        showOutgoingStatus("翻译失败，消息未发送。", "error", 2600);
        return false;
      }
      outgoingJobs.delete(id);
      job.translated = english;
      job.phase = "ready";
      outgoingSendJobs.set(id, job);
      showOutgoingStatus("翻译成功！", "success", 900);
      return true;
    };
    signalWindow.__biTalksOutgoingTranslationFailed = (id, reason) => {
      const job = outgoingJobs.get(id);
      if (!job) return;
      if (!hasOriginalDraft(job)) {
        cleanupOutgoingJob(job);
        return;
      }
      if (job) cleanupOutgoingJob(job);
      showOutgoingStatus(`${reason || "翻译失败。"} 消息未发送，原文已保留。`, "error", 6e3);
    };
    signalWindow.__biTalksOutgoingTranslationPrepareInput = (id) => {
      const job = outgoingSendJobs.get(id);
      if (!job || job.phase !== "ready" || !hasOriginalDraft(job)) {
        if (job) cleanupOutgoingJob(job);
        return false;
      }
      const { editor } = job;
      editor.focus();
      if (!editorHasFocus(editor)) {
        cleanupOutgoingJob(job);
        return false;
      }
      if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) editor.select();
      else {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      job.phase = "inserting";
      return true;
    };
    signalWindow.__biTalksOutgoingTranslationInputCommitted = (id) => {
      const job = outgoingSendJobs.get(id);
      if (!job || job.phase !== "inserting" || !hasTranslatedDraft(job) || !editorHasFocus(job.editor)) {
        if (job) cleanupOutgoingJob(job);
        return false;
      }
      const { editor } = job;
      const text = editorText(editor);
      editor.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text
      }));
      job.phase = "inserted";
      return true;
    };
    signalWindow.__biTalksOutgoingTranslationAllowNativeSend = (id) => {
      const job = outgoingSendJobs.get(id);
      if (!job || job.phase !== "inserted" || !hasTranslatedDraft(job) || !editorHasFocus(job.editor)) {
        if (job) cleanupOutgoingJob(job);
        return false;
      }
      const { editor } = job;
      nativeSendEditor = editor;
      nativeSendUntil = Date.now() + 2200;
      setTimeout(() => {
        if (nativeSendEditor === editor && Date.now() >= nativeSendUntil) nativeSendEditor = void 0;
      }, 2250);
      return true;
    };
    signalWindow.__biTalksOutgoingTranslationSendStart = (id) => {
      const job = outgoingSendJobs.get(id);
      if (!job || job.phase !== "inserted" || !hasTranslatedDraft(job) || !editorHasFocus(job.editor)) {
        if (job) cleanupOutgoingJob(job);
        return void 0;
      }
      const { editor } = job;
      const control = sendControlForEditor(editor);
      if (!control) return void 0;
      const rect = control.getBoundingClientRect();
      nativeSendEditor = editor;
      nativeSendUntil = Date.now() + 1600;
      setTimeout(() => {
        if (nativeSendEditor === editor && Date.now() >= nativeSendUntil) nativeSendEditor = void 0;
      }, 1650);
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    signalWindow.__biTalksOutgoingTranslationDidSend = (id) => {
      const job = outgoingSendJobs.get(id);
      return !!job && (!job.editor.isConnected || !editorText(job.editor).trim());
    };
    signalWindow.__biTalksOutgoingTranslationSent = (id, sent) => {
      const job = outgoingSendJobs.get(id);
      if (job) cleanupOutgoingJob(job);
      showOutgoingStatus(sent ? "发送成功！" : "请再次按下回车键！", sent ? "success" : "error", sent ? 1800 : 3e3);
    };
    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.repeat || event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      const element = origin(event);
      const editor = element ? nearestEditor(element) : void 0;
      if (!editor) return;
      if (nativeSendAllowed(editor)) return;
      if (outgoingPending.has(editor)) suppress(event);
      else if (shouldBlock(editor) && !translateAndSend(event, editor, "keyboard")) block(event);
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("keypress", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      const element = origin(event);
      const editor = element ? nearestEditor(element) : void 0;
      if (!editor) return;
      if (nativeSendAllowed(editor)) return;
      if (outgoingPending.has(editor)) suppress(event);
      else if (shouldBlock(editor)) block(event);
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("keyup", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      const element = origin(event);
      const editor = element ? nearestEditor(element) : void 0;
      if (!editor) return;
      if (nativeSendAllowed(editor)) return;
      if (outgoingPending.has(editor)) suppress(event);
      else if (shouldBlock(editor)) block(event);
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      const element = origin(event);
      const editor = element ? editorForSendControl(element) : void 0;
      if (!element || !editor || nativeSendAllowed(editor) || !isSendControl(element)) return;
      if (outgoingPending.has(editor)) suppress(event);
      else if (shouldBlock(editor) && !translateAndSend(event, editor, "button")) block(event);
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("pointerdown", (event) => {
      const element = origin(event);
      if (!element || isSendControl(element)) return;
      cancelAllOutgoingJobs();
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("focusout", (event) => {
      const element = origin(event);
      const editor = element ? editorFrom(element) : void 0;
      if (editor && outgoingPending.has(editor) && !nativeSendAllowed(editor)) cancelEditorJobs(editor);
    }, { capture: true, signal: listenerController.signal });
    window.addEventListener("blur", cancelAllOutgoingJobs, { signal: listenerController.signal });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") cancelAllOutgoingJobs();
    }, { signal: listenerController.signal });
    document.addEventListener("submit", (event) => {
      const element = origin(event);
      const editor = element ? nearestEditor(element) : void 0;
      if (editor && !nativeSendAllowed(editor) && shouldBlock(editor)) block(event);
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("change", (event) => {
      const element = origin(event);
      if (!(element instanceof HTMLInputElement) || element.type !== "file" || !fileNames(element.files).some((name) => chinese.test(name))) return;
      block(event);
      element.value = "";
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("drop", (event) => {
      if (fileNames(event.dataTransfer?.files).some((name) => chinese.test(name))) block(event);
    }, { capture: true, signal: listenerController.signal });
    document.addEventListener("paste", (event) => {
      if (fileNames(event.clipboardData?.files).some((name) => chinese.test(name))) block(event);
    }, { capture: true, signal: listenerController.signal });
    signalWindow.__biTalksEnglishOnlySendGuardController = {
      version: "complete-v7",
      destroy: () => {
        listenerController.abort();
        cancelAllOutgoingJobs();
        if (outgoingStatusTimer) clearTimeout(outgoingStatusTimer);
        document.getElementById("bi-talks-outgoing-translation-status")?.remove();
        if (signalWindow.__biTalksEnglishOnlySendGuardController?.version === "complete-v7") {
          delete signalWindow.__biTalksEnglishOnlySendGuardController;
        }
      }
    };
  };

  signalWindow.__biTalksEnglishOnlySendGuardController?.destroy();
  if (signalWindow.__biTalksTwoStepTranslation?.version !== 'two-step-retranslate-v19') {
  const installTwoStepTranslation = function installTwoStepTranslation(options) {
  const version = options.platform === 'telegram' ? 'two-step-context-v12' : 'two-step-retranslate-v19';
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
    // Anchor to the input shell; the editable child moves when its text scrolls.
    let anchor=statusEditor.closest('.module-composition-input__input,.CompositionArea__input');
    if(!anchor){for(let parent=statusEditor.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const style=getComputedStyle(parent);if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)){anchor=parent;break;}if(parent.matches('.CompositionArea,[role="dialog"]'))break;}}
    anchor=anchor||statusEditor;
    const raw=anchor.getBoundingClientRect();
    let left=Math.max(0,raw.left),right=Math.min(innerWidth,raw.right),top=Math.max(0,raw.top),bottom=Math.min(innerHeight,raw.bottom);
    for(let parent=anchor.parentElement;parent&&parent!==document.documentElement;parent=parent.parentElement){
      const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY)){const edge=rect.top+parent.clientTop;top=Math.max(top,edge);bottom=Math.min(bottom,edge+parent.clientHeight);}
      if(/^(auto|scroll|hidden|clip)$/.test(style.overflowX)){const edge=rect.left+parent.clientLeft;left=Math.max(left,edge);right=Math.min(right,edge+parent.clientWidth);}
    }
    if(bottom<=top||right<=left){node.style.visibility='hidden';return;}
    node.style.visibility='visible';
    node.style.maxWidth=Math.max(80,Math.min(right-left-16,innerWidth-16))+'px';
    const box=node.getBoundingClientRect(),half=box.width/2;
    node.style.left=Math.max(half+8,Math.min(innerWidth-half-8,(left+right)/2))+'px';
    node.style.top=Math.max(box.height+8,top-8)+'px';
  };
  const statusResizeObserver=new ResizeObserver(positionStatus);
  const sendTimers = new Set();
  const emptyAfterSend = editor => !editor.isConnected || !textOf(editor).replace(/[\s\u200b\u200c\u200d\ufeff]/gu,'');
  const clearStatus = () => { clearTimeout(statusTimer); statusResizeObserver.disconnect();statusContentObserver.disconnect();statusEditor=undefined; document.getElementById('bi-talks-two-step-status')?.remove(); };
  const clearEmptyStatus = (editor = statusEditor) => {
    if (!editor || drafts.get(editor)?.writing || !emptyAfterSend(editor)) return false;
    drafts.delete(editor);
    if (statusEditor === editor) clearStatus();
    return true;
  };
  const statusContentObserver = new MutationObserver(() => clearEmptyStatus());
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
  const translatePreservingLayout = async (source, valid, bypassCache=false) => {
    if(!valid())throw Error('输入内容或聊天已变化');
    const result=await options.translate((bypassCache?'__BITALKS_LAYOUT_RETRY_V1__':'__BITALKS_LAYOUT_CONTEXT_V2__')+JSON.stringify(source));
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
  const status = (message, editor, retryAction) => {
    if (clearEmptyStatus(editor)) return;
    clearTimeout(statusTimer);
    statusContentObserver.disconnect();
    statusResizeObserver.disconnect();statusEditor=editor;
    if(editor)statusContentObserver.observe(editor,{childList:true,subtree:true,characterData:true});
    if(editor){statusResizeObserver.observe(editor);for(let parent=editor.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const style=getComputedStyle(parent);if(/^(auto|scroll|hidden|clip)$/.test(style.overflowY))statusResizeObserver.observe(parent);}}
    let node = document.getElementById('bi-talks-two-step-status');
    if (!node) {
      node = document.createElement('div');node.id='bi-talks-two-step-status';node.setAttribute('role','status');
      Object.assign(node.style,{position:'fixed',transform:'translate(-50%, -100%)',textAlign:'center',boxSizing:'border-box',width:'max-content',zIndex:'2147483647',padding:'9px 13px',background:'#365fc9',color:'#fff',borderRadius:'9px',font:'600 13px system-ui',pointerEvents:'none'});
      document.body?.appendChild(node);
    }
    node.textContent=message;
    if(retryAction){const button=document.createElement('button');button.type='button';button.textContent='重新翻译';button.title='使用原始中文，跳过缓存重新请求 DeepL';button.style.cssText='pointer-events:auto;margin-left:10px;padding:3px 8px;border:1px solid #ffffff99;border-radius:5px;background:#fff;color:#234aa8;font:600 12px system-ui;cursor:pointer';button.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation();});button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();retryAction();});node.appendChild(button);}
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
  const showReady=job=>{const editor=job.editor;status('已翻译，请确认输入框中的译文，再按一次回车发送。',editor,()=>{if(current(job)&&job.phase==='ready'&&textOf(editor)===job.translated)begin(editor,undefined,job.translationSource,true);});};
  const begin = (editor, previous, translationSource, bypassCache=false) => {
    const job={editor,source:textOf(editor),context:context(editor),phase:'translating',id:++sequence,translated:'',writing:false};
    job.translationSource=translationSource===undefined?job.source:translationSource;
    drafts.set(editor,job);status('正在翻译，请稍候…',editor);
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('翻译超时')),45000);});
    void Promise.race([Promise.resolve().then(()=>translatePreservingLayout(job.translationSource,()=>current(job)&&textOf(editor)===job.source,bypassCache)),timeout]).then(async result=>{
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
      job.phase='ready';showReady(job);
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
    if(origin(event)?.closest?.('#bi-talks-two-step-status button'))return;
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
    const editor=editorFor(origin(event)),job=drafts.get(editor);
    if(clearEmptyStatus(editor))return;
    if(!job || job.writing)return;
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
  const preferenceTimer=setInterval(()=>{syncPreferences();clearEmptyStatus();},100);
  const controller={version,platform:options.platform,syncPreferences,restoreReady(job){if(!job||job.phase!=='ready'||!job.editor?.isConnected||context(job.editor)!==job.context||textOf(job.editor)!==job.translated||!options.enabled())return false;drafts.set(job.editor,job);showReady(job);return true;},destroy(){preferenceObserver.disconnect();clearInterval(preferenceTimer);abort.abort();cancel();document.getElementById('bi-talks-two-step-status')?.remove();},inspect(){return [...drafts.values()].map(j=>({phase:j.phase}));}};
  window.__biTalksTwoStepTranslation=controller;
  return controller;
};
  const twoStepRequests = new Map(); let twoStepSequence = 0;
  const twoStepRequest = (text, commit, editor, valid, select) => new Promise((resolve, reject) => {
    const id = 'two-step-' + Date.now() + '-' + (++twoStepSequence);
    const timer = setTimeout(() => { twoStepRequests.delete(id); reject(new Error('翻译或写入超时')); }, 40000);
    twoStepRequests.set(id,{resolve,reject,timer,editor,valid,select});
    try { signalWindow.__biTalksTranslateOutgoingRequest(JSON.stringify({id,text,commit})); }
    catch(error) {clearTimeout(timer);twoStepRequests.delete(id);reject(error);}
  });
  signalWindow.__biTalksTwoStepResult = (id,value,error) => {
    const request=twoStepRequests.get(id);if(!request)return;
    clearTimeout(request.timer);twoStepRequests.delete(id);
    if(error)request.reject(new Error(error));else request.resolve(value);
  };
  signalWindow.__biTalksTwoStepPrepareCommit = id => {
    const request=twoStepRequests.get(id);
    if(!request?.editor || request.commitClaimed || !request.valid())return false;
    request.commitClaimed=true;
    request.select(request.editor);
    return document.activeElement===request.editor || request.editor.contains(document.activeElement);
  };
  installTwoStepTranslation({platform:'signal',enabled:()=>signalWindow.__biTalksTwoStepEnabled!==false,
    translate:text=>twoStepRequest(text,false),
    write:(editor,text,valid,select)=>twoStepRequest(text,true,editor,valid,select)
  });
  }

  if (signalWindow.__biTalksSignalTranslation?.version === 13) return;
  signalWindow.__biTalksSignalTranslation?.destroy();
  const translationAttribute = "data-bi-talks-signal-translation";
  const sourceAttribute = "data-bi-talks-signal-source";
  const candidateSelectors = [
    ".module-message__text",
    '[class*="module-message__text"]',
    '[data-testid="message-text"]',
    '[data-testid*="message-text"]',
    '[class*="MessageText"]',
    '[class*="message-text"]',
    '[data-testid*="message"] [dir="auto"]',
    '[class*="module-message"] [dir="auto"]'
  ];
  const pending = /* @__PURE__ */ new Map();
  const expired = /* @__PURE__ */ new Map();
  const completed = /* @__PURE__ */ new Map();
  const processed = /* @__PURE__ */ new WeakMap();
  let failures = /* @__PURE__ */ new WeakMap();
  let requestSequence = 0;
  let scanTimer;
  let preferences = { enabled: true, color: "#d8ff00", size: 12 };
  const hash = (text) => {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return `${text.length}:${(value >>> 0).toString(36)}`;
  };
  const normal = (text) => text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const isEnglishOnly = (text) => text.length >= 2 && /[A-Za-z]/.test(text);
  const translationFor = (element) => {
    const parent = element.parentElement;
    if (!parent) return void 0;
    return Array.from(parent.children).find((child) => child.getAttribute(translationAttribute) === "true" && child.getAttribute("data-bi-talks-owner") === element.getAttribute(sourceAttribute));
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 6 && rect.bottom >= 0 && rect.top <= innerHeight;
  };
  const mediaUI = /file[-_ ]?(?:size|name)|attachment[-_ ]?(?:status|metadata|download)|download|upload|progress|thumbnail|sticker|image[-_ ]?(?:grid|gallery)|imagegrid|module-image|media[-_ ]?(?:grid|controls)|(?:video|audio)[-_ ]?controls/;
  const isExcluded = (element) => {
    if (element.closest(`[${translationAttribute}],input,textarea,[contenteditable="true"],button,svg,time,[role="button"]`)) return true;
    const signature = `${element.className || ""} ${element.getAttribute("data-testid") || ""}`.toLowerCase();
    if (/timestamp|reaction|quote|quoted|metadata|status|system-message|contact-name|sender-name/.test(signature)) return true;
    const explicitMessageText = element.matches('.module-message__text,[class*="module-message__text"],[data-testid="message-text"],[data-testid*="message-text"],[class*="MessageText"],[class*="message-text"],[data-testid="attachment-caption"],[data-testid="image-caption"]');
    const messageRoot = element.closest('.module-message,[data-testid="message"],[data-testid="message-container"],[role="listitem"]');
    for(let current=element;current&&current!==messageRoot&&current!==document.body;current=current.parentElement){
      const name=`${current.className || ""} ${current.getAttribute("data-testid") || ""}`.toLowerCase();
      if(mediaUI.test(name))return true;
      if(!explicitMessageText&&/attachment|image|media|download|upload|progress|thumbnail|sticker|\bgif\b|video|audio|file/.test(name))return true;
    }
    return false;
  };
  const cleanText = (element) => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(`[${translationAttribute}],button,svg,time,[aria-hidden="true"],[class*="timestamp" i],[class*="reaction" i]`).forEach((node) => node.remove());
    clone.querySelectorAll("*").forEach(node=>{if(mediaUI.test(`${node.className || ""} ${node.getAttribute("data-testid") || ""}`.toLowerCase()))node.remove();});
    clone.querySelectorAll("br").forEach((node) => node.replaceWith(document.createTextNode("\n")));
    return normal(clone.textContent || clone.innerText || "");
  };
  const looksLikeMessage = (element, text) => {
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return false;
    const compact = text.replace(/\s+/g, " ").trim();
    if(/^(?:(?:over|about|approximately|more than|less than)\s*)?\d+(?:[.,]\d+)?\s*(?:bytes?|[kmgt]?i?b)(?:\s+\d{1,2}:\d{2})?$/iu.test(compact))return false;
    if(/^(?:download\s+)?\d+\s*(?:items?|files?|photos?|images?|attachments?)(?:\s+\d{1,2}:\d{2})?$/iu.test(compact))return false;
    if (/^\d+(?:[.,]\d+)?\s*(?:bytes?|[kmgt]?i?b)\s*(?:\/|of)\s*\d+(?:[.,]\d+)?\s*(?:bytes?|[kmgt]?i?b)(?:\s+\d{1,2}:\d{2})?$/iu.test(compact)) return false;
    const messageRoot = element.closest('[data-testid*="message"], [class*="module-message"], [class*="Message"], [role="listitem"]');
    return !!messageRoot || /message/i.test(`${element.className || ""} ${element.getAttribute("data-testid") || ""}`);
  };
  const applyStyle = (node) => {
    Object.assign(node.style, {
      display: "block",
      width: "100%",
      maxWidth: "100%",
      boxSizing: "border-box",
      marginTop: "5px",
      padding: "0",
      border: "0",
      background: "transparent",
      color: preferences.color,
      fontSize: `${preferences.size}px`,
      lineHeight: "1.42",
      fontFamily: "inherit",
      fontStyle: "inherit",
      fontWeight: "inherit",
      letterSpacing: "inherit",
      textAlign: "inherit",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      userSelect: "text"
    });
  };
  const insertTranslation = (element, key, translated) => {
    translationFor(element)?.remove();
    const node = document.createElement("div");
    node.setAttribute(translationAttribute, "true");
    node.setAttribute("data-bi-talks-owner", element.getAttribute(sourceAttribute) || "");
    node.dataset.biTalksSignalSource = key;
    node.textContent = translated;
    node.setAttribute("aria-label", `译文：${translated}`);
    applyStyle(node);
    element.insertAdjacentElement("afterend", node);
  };
  const rememberTranslation = (key, source, translation) => {
    completed.delete(key);
    completed.set(key, { source, translation });
    while (completed.size > 2e3) {
      const oldest = completed.keys().next().value;
      if (typeof oldest !== "string") break;
      completed.delete(oldest);
    }
  };
  const discardPending = (id, retry, reason = "翻译等待超时。", retryAfterMs = 0) => {
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    clearTimeout(job.timeout);
    translationFor(job.element)?.remove();
    processed.delete(job.element);
    if (!retry || !job.element.isConnected) return;
    expired.set(id, { element: job.element, text: job.text, key: job.key });
    if (expired.size > 200) expired.delete(expired.keys().next().value);
    failures.set(job.element, 2);
    {
      const delay2 = Math.max(0, Math.min(3e5, retryAfterMs));
      const retryAt = Date.now() + delay2;
      insertTranslation(job.element, job.key, `${reason} ${delay2 ? `请 ${Math.ceil(delay2 / 1e3)} 秒后重试` : "点击重试"}`);
      const notice = translationFor(job.element);
      if (notice) {
        notice.style.cursor = delay2 ? "wait" : "pointer";
        if (delay2) setTimeout(() => {
          if (!notice.isConnected) return;
          notice.textContent = `${reason} 点击重试`;
          notice.setAttribute("aria-label", `译文：${notice.textContent}`);
          notice.style.cursor = "pointer";
        }, delay2);
        notice.onclick = () => {
          if (Date.now() < retryAt) return;
          failures.delete(job.element);
          notice.remove();
          scheduleScan();
        };
      }
    }
  };
  const removeTranslations = () => {
    document.querySelectorAll(`[${translationAttribute}]`).forEach((node) => node.remove());
    pending.forEach((job) => clearTimeout(job.timeout));
    pending.clear();
    expired.clear();
  };
  const request = (element) => {
    if (!preferences.enabled || !visible(element)) return;
    if(isExcluded(element)){translationFor(element)?.remove();processed.delete(element);for(const [id,job] of pending)if(job.element===element)discardPending(id,false);return;}
    if ((failures.get(element) || 0) >= 2) return;
    const text = cleanText(element);
    if (!looksLikeMessage(element, text) || !isEnglishOnly(text)){translationFor(element)?.remove();processed.delete(element);for(const [id,job] of pending)if(job.element===element)discardPending(id,false);return;}
    const key = hash(text);
    const current = translationFor(element);
    if (current?.dataset.biTalksSignalSource === key) return;
    const alreadyPending = Array.from(pending.values()).some((job) => job.element === element && job.key === key);
    if (alreadyPending) return;
    current?.remove();
    const owner = element.getAttribute(sourceAttribute) || `source-${Date.now()}-${++requestSequence}`;
    element.setAttribute(sourceAttribute, owner);
    const cached = completed.get(key);
    if (cached?.source === text) {
      processed.set(element, key);
      insertTranslation(element, key, cached.translation);
      return;
    }
    processed.set(element, key);
    const id = `${Date.now()}-${requestSequence}`;
    const timeout = setTimeout(() => discardPending(id, true), 12e4);
    pending.set(id, { element, text, key, timeout });
    signalWindow.__biTalksTranslationResult?.(id, "等待翻译…", true);
    const rect = element.getBoundingClientRect();
    const priority = Math.round(Math.max(0, Math.min(1e3, rect.bottom / Math.max(1, innerHeight) * 1e3)));
    try {
      signalWindow.__biTalksTranslateRequest?.(JSON.stringify({ id, text, priority, ownMessage: !!element.closest(".module-message--outgoing") }));
    } catch {
      discardPending(id, true);
    }
  };
  const scanRoot = (root) => {
    const candidates = /* @__PURE__ */ new Set();
    const rootElement = root instanceof HTMLElement ? root : void 0;
    for (const selector of candidateSelectors) {
      const closest = rootElement?.closest(selector);
      if (closest) candidates.add(closest);
      if (rootElement?.matches(selector)) candidates.add(rootElement);
      root.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }
    Array.from(candidates).sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom).forEach(request);
  };
  const scan = () => {
    scanTimer = void 0;
    if (!preferences.enabled || !document.body) return;
    scanRoot(document);
  };
  const scheduleScan = () => {
    if (scanTimer || !preferences.enabled) return;
    scanTimer = setTimeout(scan, 8);
  };
  const observer = new MutationObserver((records) => {
    if (preferences.enabled) {
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (target) scanRoot(target);
        record.addedNodes.forEach((node) => {
          if (node instanceof Element) scanRoot(node);
        });
      }
    }
    scheduleScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  const interval = setInterval(scheduleScan, 2500);
  signalWindow.__biTalksTranslationCurrent = (id) => {
    const job = pending.get(id);
    if (!job) return false;
    const valid = preferences.enabled && job.element.isConnected && visible(job.element) && !isExcluded(job.element) && looksLikeMessage(job.element,cleanText(job.element)) && hash(cleanText(job.element)) === job.key;
    if (!valid) discardPending(id, false);
    return valid;
  };
  signalWindow.__biTalksTranslationResult = (id, translated, partial = false) => {
    const activeJob = pending.get(id);
    const job = activeJob || (!partial ? expired.get(id) : void 0);
    if (!partial && job) {
      pending.delete(id);
      expired.delete(id);
      if (activeJob) clearTimeout(activeJob.timeout);
    }
    if (!job || !preferences.enabled || !job.element.isConnected) return;
    const currentText = cleanText(job.element);
    if(isExcluded(job.element)||!looksLikeMessage(job.element,currentText)){translationFor(job.element)?.remove();processed.delete(job.element);return;}
    if (hash(currentText) !== job.key) {
      translationFor(job.element)?.remove();
      processed.delete(job.element);
      scheduleScan();
      return;
    }
    const cleanTranslation = normal(String(translated || ""));
    if (partial) {
      if (cleanTranslation) insertTranslation(job.element, job.key, cleanTranslation);
      return;
    }
    if (!cleanTranslation || cleanTranslation.toLocaleLowerCase() === job.text.toLocaleLowerCase()) {
      translationFor(job.element)?.remove();
      processed.delete(job.element);
      const attempts = (failures.get(job.element) || 0) + 1;
      failures.set(job.element, attempts);
      if (attempts < 2) setTimeout(scheduleScan, 700);
      return;
    }
    failures.delete(job.element);
    for (const [otherId, other] of pending) {
      if (other.element === job.element && other.key === job.key) {
        clearTimeout(other.timeout);
        pending.delete(otherId);
      }
    }
    for (const [otherId, other] of expired) {
      if (other.element === job.element && other.key === job.key) expired.delete(otherId);
    }
    rememberTranslation(job.key, job.text, cleanTranslation);
    insertTranslation(job.element, job.key, cleanTranslation);
  };
  signalWindow.__biTalksTranslationFailed = (id, reason, retryAfterMs) => {
    const job = pending.get(id);
    if (!job) return;
    if(isExcluded(job.element)||!looksLikeMessage(job.element,cleanText(job.element))){discardPending(id,false);return;}
    discardPending(id, true, reason || "翻译失败。", retryAfterMs);
  };
  const controller = {
    version: 13,
    defer(id){discardPending(id,false);},
    setPreferences(next) {
      if(preferences.engine!==next.engine){completed.clear();failures=new WeakMap();removeTranslations();}
      signalWindow.__biTalksTwoStepEnabled = next.enabled !== false;
      signalWindow.__biTalksTwoStepTranslation?.syncPreferences?.();
      preferences = {
        engine:next.engine,
        enabled: next.enabled !== false,
        color: typeof next.color === "string" && next.color ? next.color : preferences.color,
        size: typeof next.size === "number" ? Math.min(24, Math.max(10, Math.round(next.size))) : preferences.size
      };
      document.querySelectorAll(`[${translationAttribute}]`).forEach(applyStyle);
      if (!preferences.enabled) removeTranslations();
      else scheduleScan();
    },
    scan: scheduleScan,
    destroy() {
      observer.disconnect();
      clearInterval(interval);
      if (scanTimer) clearTimeout(scanTimer);
      removeTranslations();
      delete signalWindow.__biTalksTranslationResult;
      delete signalWindow.__biTalksTranslationFailed;
      delete signalWindow.__biTalksSignalTranslation;
    }
  };
  signalWindow.__biTalksSignalTranslation = controller;
  scheduleScan();
}
const injectorSource = `(${installSignalTranslation.toString()})()`;
class CdpConnection {
  constructor(socket, onEvent) {
    this.socket = socket;
    this.onEvent = onEvent;
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof message.id === "number") {
        const command = this.pending.get(message.id);
        if (!command) return;
        clearTimeout(command.timeout);
        this.pending.delete(message.id);
        if (message.error) command.reject(new Error(message.error.message || "CDP command failed."));
        else command.resolve(message.result);
        return;
      }
      this.onEvent(message);
    });
    socket.addEventListener("close", () => this.rejectAll(new Error("Signal debugging connection closed.")));
    socket.addEventListener("error", () => this.rejectAll(new Error("Signal debugging connection failed.")));
  }
  nextId = 0;
  pending = /* @__PURE__ */ new Map();
  call(method, params, timeoutMs = 12e3) {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Signal debugging connection is not open."));
    const id = ++this.nextId;
    return new Promise((resolve2, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Signal debugging command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve2, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, ...params ? { params } : {} }));
    });
  }
  close() {
    this.socket.close();
    this.rejectAll(new Error("Signal translation bridge stopped."));
  }
  rejectAll(error) {
    for (const command of this.pending.values()) {
      clearTimeout(command.timeout);
      command.reject(error);
    }
    this.pending.clear();
  }
}
class SignalTranslationBridge {
  constructor(emit2, translateIncoming, translateOutgoingText, requestNativeUpdate) {
    this.emit = emit2;
    this.translateIncoming = translateIncoming;
    this.translateOutgoingText = translateOutgoingText;
    this.requestNativeUpdate = requestNativeUpdate;
  }
  sessions = /* @__PURE__ */ new Map();
  connections = /* @__PURE__ */ new Map();
  translationQueue = [];
  translationsInFlight = 0;
  attach(account, dataDir) {
    this.detach(account.id);
    const session2 = { account, dataDir, cancelled: false };
    this.sessions.set(account.id, session2);
    void this.connect(session2, true);
  }
  updatePreferences(account) {
    const session2 = this.sessions.get(account.id);
    if (session2) session2.account = account;
    const connection = this.connections.get(account.id);
    if (connection) void this.applyPreferences(connection, account).catch(() => void 0);
  }
  detach(accountId) {
    const session2 = this.sessions.get(accountId);
    if (session2) {
      session2.cancelled = true;
      if (session2.reconnectTimer) clearTimeout(session2.reconnectTimer);
      session2.socket?.close();
    }
    this.connections.get(accountId)?.close();
    this.connections.delete(accountId);
    this.sessions.delete(accountId);
    this.translationQueue = this.translationQueue.filter((job) => job.session.account.id !== accountId);
  }
  shutdown() {
    for (const accountId of [...this.sessions.keys()]) this.detach(accountId);
  }
  async capturePreview(accountId) {
    const connection = this.connections.get(accountId);
    if (!connection) return void 0;
    const result = await connection.call("Page.captureScreenshot", {
      format: "jpeg",
      quality: 55,
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: true
    }, 5e3);
    return typeof result.data === "string" && result.data ? `data:image/jpeg;base64,${result.data}` : void 0;
  }
  async connect(session2, initial) {
    try {
      const target = await this.waitForTarget(session2);
      if (session2.cancelled || !target.webSocketDebuggerUrl) return;
      const socket = await this.openSocket(target.webSocketDebuggerUrl);
      if (session2.cancelled) {
        socket.close();
        return;
      }
      session2.socket = socket;
      let connection;
      connection = new CdpConnection(socket, (message) => void this.handleEvent(session2, connection, message));
      this.connections.set(session2.account.id, connection);
      socket.addEventListener("close", () => {
        if (this.connections.get(session2.account.id) === connection) this.connections.delete(session2.account.id);
        if (!session2.cancelled && this.sessions.get(session2.account.id) === session2) {
          session2.reconnectTimer = setTimeout(() => void this.connect(session2, false), 1200);
        }
      }, { once: true });
      await connection.call("Runtime.enable");
      await connection.call("Page.enable");
      await connection.call("Runtime.addBinding", { name: "__biTalksTranslateRequest" });
      await connection.call("Runtime.addBinding", { name: "__biTalksTranslateOutgoingRequest" });
      await connection.call("Runtime.addBinding", { name: "__biTalksUnreadReport" });
      await connection.call("Runtime.addBinding", { name: "__biTalksSignalUpdateRequest" });
      await connection.call("Page.addScriptToEvaluateOnNewDocument", { source: signalUnreadSource });
      await connection.call("Runtime.evaluate", { expression: signalUnreadSource });
      await connection.call("Page.addScriptToEvaluateOnNewDocument", { source: injectorSource });
      await connection.call("Runtime.evaluate", { expression: injectorSource, awaitPromise: true });
      await this.applyPreferences(connection, session2.account);
      this.emit({ type: "signal-translation", accountId: session2.account.id, status: "ready", message: "Signal 气泡翻译已就绪" });
    } catch (error) {
      if (session2.cancelled) return;
      const message = error instanceof Error ? error.message : String(error);
      if (initial) this.emit({ type: "signal-translation", accountId: session2.account.id, status: "error", message: `Signal 气泡翻译连接失败：${message}` });
      session2.reconnectTimer = setTimeout(() => void this.connect(session2, false), 1800);
    }
  }
  async waitForTarget(session2) {
    const deadline = Date.now() + 45e3;
    const portFile = join(session2.dataDir, "DevToolsActivePort");
    let lastError = "Signal 调试端口尚未就绪";
    while (!session2.cancelled && Date.now() < deadline) {
      try {
        if (!existsSync(portFile)) throw new Error(lastError);
        const [portText] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
        const port = Number(portText);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Signal 调试端口无效");
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
        if (!response.ok) throw new Error(`Signal 调试目标返回 ${response.status}`);
        const targets = await response.json();
        const pages = targets.filter((target2) => target2.type === "page" && target2.webSocketDebuggerUrl);
        const target = pages.find((item) => /signal/i.test(`${item.title || ""} ${item.url || ""}`)) || pages[0];
        if (target) return target;
        lastError = "Signal 主页面尚未出现";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleep(300);
    }
    throw new Error(lastError);
  }
  openSocket(url) {
    return new Promise((resolve2, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("连接 Signal 调试页面超时"));
      }, 8e3);
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve2(socket);
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("无法连接 Signal 调试页面"));
      }, { once: true });
    });
  }
  async applyPreferences(connection, account) {
    const preferences = translationPreferences(account);
    await connection.call("Runtime.evaluate", {
      expression: `window.__biTalksSignalTranslation?.setPreferences(${JSON.stringify(preferences)})`
    });
  }
  async handleEvent(session2, connection, message) {
    if (message.method !== "Runtime.bindingCalled") return;
    const params = message.params || {};
    if (params.name === "__biTalksSignalUpdateRequest" && !session2.cancelled) {
      void this.requestNativeUpdate?.(session2.account).catch(() => void 0);
      return;
    }
    if (params.name === "__biTalksUnreadReport" && typeof params.payload === "string") {
      let count = Number(params.payload);
      let trustedDecrease = false;
      let partial = false;
      let preview;
      let delta = 0;
      try {
        const report = JSON.parse(params.payload);
        if (report.source !== "signal-total-v1") return;
        preview = report.preview;
        count = Number(report.count);
        trustedDecrease = report.trustedDecrease === true;
        partial = report.partial === true;
        delta = Number.isFinite(report.delta) ? report.delta : 0;
      } catch {
        return;
      }
      if (Number.isFinite(count) && !session2.cancelled) {
        this.emit({
          type: "unread",
          accountId: session2.account.id,
          count: Math.max(0, Math.min(999, Math.round(count))),
          trustedDecrease,
          partial,
          delta,
          preview
        });
      }
      return;
    }
    if (params.name === "__biTalksTranslateOutgoingRequest" && typeof params.payload === "string") {
      let request2;
      try {
        request2 = JSON.parse(params.payload);
      } catch {
        return;
      }
      const id2 = String(request2.id || "");
      const text2 = (request2.commit === true ? String(request2.text || "") : String(request2.text || "").trim()).slice(0, 6e4);
      if (!id2 || !text2 || session2.cancelled) return;
      const executionContextId2 = typeof params.executionContextId === "number" ? params.executionContextId : void 0;
      void this.translateOutgoing(session2, connection, id2, text2, executionContextId2, request2.commit === true);
      return;
    }
    if (params.name !== "__biTalksTranslateRequest" || typeof params.payload !== "string") return;
    let request;
    try {
      request = JSON.parse(params.payload);
    } catch {
      return;
    }
    const id = String(request.id || "");
    const text = String(request.text || "").trim();
    const priority = Math.max(0, Math.min(1e3, Number(request.priority) || 0));
    if (!id || !text || session2.cancelled || session2.account.translationEnabled === false) return;
    const executionContextId = typeof params.executionContextId === "number" ? params.executionContextId : void 0;
    this.translationQueue.push({ session: session2, connection, id, text, priority, executionContextId, ownMessage: request.ownMessage === true });
    this.translationQueue.sort((left, right) => right.priority - left.priority);
    this.drainTranslationQueue();
  }
  drainTranslationQueue() {
    while (this.translationsInFlight < 4 && this.translationQueue.length) {
      const job = this.translationQueue.shift();
      if (!job || job.session.cancelled || this.connections.get(job.session.account.id) !== job.connection) continue;
      this.translationsInFlight += 1;
      void this.runTranslation(job).finally(() => {
        this.translationsInFlight = Math.max(0, this.translationsInFlight - 1);
        this.drainTranslationQueue();
      });
    }
  }
  async translateOutgoing(session2, connection, id, text, executionContextId, commit = false) {
    const context = executionContextId ? {contextId:executionContextId} : {};
    const active = () => !session2.cancelled && this.connections.get(session2.account.id) === connection;
    if (!active()) return;
    // Claim a commit synchronously, before the first await: duplicate CDP bindings
    // must never execute a second Input.insertText for the same renderer request.
    if (commit) {
      this.outgoingCommitClaims ||= new WeakMap();
      let claims=this.outgoingCommitClaims.get(connection);
      if(!claims){claims=new Set();this.outgoingCommitClaims.set(connection,claims);}
      const claim=JSON.stringify([executionContextId||0,id]);
      if(claims.has(claim))return;
      claims.add(claim);
    }
    try {
      let value;
      if (commit) {
        const prepared = await connection.call("Runtime.evaluate", {expression:`window.__biTalksTwoStepPrepareCommit?.(${JSON.stringify(id)})`,returnByValue:true,...context});
        if (!active() || prepared?.result?.value !== true) throw new Error("输入框或聊天已变化，未写入或发送。");
        await connection.call("Input.insertText", {text});
        value = true;
      } else {
        value = await this.translateOutgoingText(text,session2.account.id);
        if (!String(value || "").trim()) throw new Error("翻译结果为空。");
      }
      if (!active()) return;
      await connection.call("Runtime.evaluate",{expression:`window.__biTalksTwoStepResult?.(${JSON.stringify(id)},${JSON.stringify(value)})`,...context});
    } catch(error) {
      if (!active()) return;
      await connection.call("Runtime.evaluate",{expression:`window.__biTalksTwoStepResult?.(${JSON.stringify(id)},null,${JSON.stringify(error instanceof Error ? error.message : String(error))})`,...context}).catch(()=>void 0);
    }
  }
  async runTranslation(job) {
    let translated = "";
    let failure = translationFailure(new Error("DeepL 返回了空译文。"));
    const context = job.executionContextId ? { contextId: job.executionContextId } : {};
    let partial = "";
    let updates = Promise.resolve();
    const current = async () => {
      if (job.session.cancelled || this.connections.get(job.session.account.id) !== job.connection) return false;
      const result = await job.connection.call("Runtime.evaluate", {
        expression: `window.__biTalksTranslationCurrent?.(${JSON.stringify(job.id)})`,
        returnByValue: true,
        ...context
      }).catch(() => void 0);
      return result?.result?.value === true;
    };
    const body = job.text;
    try {
      if (!await current()) return;
      await job.connection.call("Runtime.evaluate", {
        expression: `window.__biTalksTranslationResult?.(${JSON.stringify(job.id)}, ${JSON.stringify("正在翻译…")}, true)`,
        ...context
      }).catch(() => void 0);
      translated = await this.translateIncoming(body, job.session.account.id, (delta) => {
        partial += delta;
        const snapshot = partial;
        updates = updates.then(async () => {
          if (job.session.cancelled) return;
          await job.connection.call("Runtime.evaluate", {
            expression: `window.__biTalksTranslationResult?.(${JSON.stringify(job.id)}, ${JSON.stringify(snapshot)}, true)`,
            ...context
          }).catch(() => void 0);
        });
      }, current, job.ownMessage, job.priority);
    } catch (error) {
      failure = translationFailure(error);
      console.warn("[Bi-Talks] Signal translation failed", {
        accountId: job.session.account.id,
        reason: error instanceof Error ? error.message.slice(0, 240) : "unknown error"
      });
    }
    await updates;
    if (job.session.cancelled || this.connections.get(job.session.account.id) !== job.connection) return;
    if (!translated) {
      await job.connection.call("Runtime.evaluate", {
        expression: `window.__biTalksTranslationFailed?.(${JSON.stringify(job.id)}, ${JSON.stringify(failure.message)}, ${failure.retryAfterMs})`,
        ...context
      }).catch(() => void 0);
      return;
    }
    await job.connection.call("Runtime.evaluate", {
      expression: `window.__biTalksTranslationResult?.(${JSON.stringify(job.id)}, ${JSON.stringify(translated)})`,
      ...context
    }).catch(() => void 0);
  }
}
const temporarySignalRuntimeName = /^\.signal-desktop-(?:staging|backup)-\d+$/u;
function comparablePath(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}
function isManagedSignalTemporaryDirectory(runtimeRoot, candidate) {
  const expectedParent = comparablePath(resolve(runtimeRoot, "signal-runtime"));
  const resolvedCandidate = comparablePath(candidate);
  return comparablePath(dirname(resolvedCandidate)) === expectedParent && temporarySignalRuntimeName.test(basename(resolvedCandidate));
}
function normalizeSignalVersion(version) {
  const numeric = version.trim().match(/^\d+(?:\.\d+){1,3}/)?.[0];
  if (!numeric) return version.trim();
  const parts = numeric.split(".").map((part) => Number(part));
  while (parts.length > 3 && parts[parts.length - 1] === 0) parts.pop();
  while (parts.length < 3) parts.push(0);
  return parts.join(".");
}
function compareSignalVersions(left, right) {
  const parse = (value) => normalizeSignalVersion(value || "0.0.0").split(".").map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
function signalRestartAccountIds(runningAccountIds, requestedAccountId) {
  const result = new Set([...runningAccountIds].filter(Boolean));
  if (requestedAccountId) result.add(requestedAccountId);
  return result;
}
function parsePendingSignalRestartAccountIds(value) {
  if (!value || typeof value !== "object" || !("accountIds" in value) || !Array.isArray(value.accountIds)) return [];
  return [...new Set(value.accountIds.filter((item) => typeof item === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(item) && !item.includes("..")).slice(0, 256))];
}
const defaultMaxBytes = 2 * 1024 * 1024;
const defaultRetainedFiles = 3;
const queues = /* @__PURE__ */ new Map();
const knownSizes = /* @__PURE__ */ new Map();
async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
async function rotate(path, retainedFiles) {
  for (let index = retainedFiles; index >= 1; index -= 1) {
    const destination = `${path}.${index}`;
    if (index === retainedFiles) await rm(destination, { force: true });
    const source = index === 1 ? path : `${path}.${index - 1}`;
    try {
      await rename(source, destination);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
    }
  }
}
async function append(path, line, options) {
  const maxBytes = Math.max(1024, Math.round(options.maxBytes || defaultMaxBytes));
  const retainedFiles = Math.max(1, Math.min(10, Math.round(options.retainedFiles || defaultRetainedFiles)));
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.byteLength(line, "utf8");
  const currentSize = knownSizes.has(path) ? knownSizes.get(path) : await fileSize(path);
  if (currentSize > 0 && currentSize + bytes > maxBytes) {
    await rotate(path, retainedFiles);
    knownSizes.set(path, 0);
  }
  await appendFile(path, line, "utf8");
  knownSizes.set(path, (knownSizes.get(path) || (currentSize > 0 && currentSize + bytes <= maxBytes ? currentSize : 0)) + bytes);
}
function appendRuntimeLog(path, line, options = {}) {
  const previous = queues.get(path) || Promise.resolve();
  const next = previous.catch(() => void 0).then(() => append(path, line, options));
  queues.set(path, next);
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path);
  }).catch(() => void 0);
  return next;
}
let cachedWindowHelperPath;
let windowHelperProcess;
let windowHelperOutput = "";
let windowHelperRequests = [];
let windowHelperRunQueue = Promise.resolve();
const signalUpdateFeedUrl = "https://updates.signal.org/desktop/latest.yml";
const signalUpdateBaseUrl = "https://updates.signal.org/desktop/";
const sevenZipStandaloneUrl = "https://www.7-zip.org/a/7za920.zip";
const managedSignalProcessMarkerName = ".bi-talks-signal-process.json";
const pendingSignalRestartMarkerName = ".bi-talks-signal-restart-pending.json";
const managedSignalProfilesDirName = "signal-desktop-managed-v2";
const managedSignalLaunchRetryDelays = [0, 750, 2e3];
function signalRuntimeLog(message, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  void appendRuntimeLog(join(app.getPath("userData"), "runtime.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}${suffix}
`).catch((error) => {
    console.warn("Signal runtime log write failed.", error);
  });
}
function isInvalidSignalWindowHandleError(message) {
  return /signal window handle is no longer valid|invalid signal window|signal window.*invalid handle|signal window.*is not a valid window/i.test(message);
}
function isRecoverableSignalPlacementError(message) {
  return isInvalidSignalWindowHandleError(message) || /window helper timed out|window helper stdin is not writable|window helper stopped|window helper exited with code|windows rejected the signal|bi-talks client position could not be read/i.test(message);
}
function managedSignalRuntimeRoot(runtimeRoot) {
  return join(runtimeRoot, managedSignalProfilesDirName);
}
function managedSignalProgramDir(runtimeRoot) {
  return join(runtimeRoot, "signal-runtime", "signal-desktop");
}
function possibleSignalDesktopPaths(runtimeRoot) {
  if (process.platform !== "win32") return [];
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath || "";
  const cwd = process.cwd();
  return [
    join(managedSignalProgramDir(runtimeRoot), "Signal.exe"),
    join(appPath, "vendor", "signal-desktop", "Signal.exe"),
    join(cwd, "vendor", "signal-desktop", "Signal.exe"),
    join(resourcesPath, "vendor", "signal-desktop", "Signal.exe"),
    join(resourcesPath, "signal-desktop", "Signal.exe")
  ].filter(Boolean);
}
function isUsableSignalDesktop(path) {
  return existsSync(path) && existsSync(join(dirname(path), "resources", "app.asar"));
}
function findSignalDesktop(runtimeRoot) {
  return possibleSignalDesktopPaths(runtimeRoot).find(isUsableSignalDesktop);
}
async function moveFileAsideIfExists(path) {
  if (!existsSync(path)) return;
  const disabledPath = `${path}.bi-talks-disabled`;
  try {
    if (existsSync(disabledPath)) await rm(path, { force: true });
    else await rename(path, disabledPath);
  } catch {
  }
}
async function disableBundledSignalAutoUpdater(executable) {
  const installDir = dirname(executable);
  const resourcesDir = join(installDir, "resources");
  await moveFileAsideIfExists(join(installDir, "latest.yml"));
  await moveFileAsideIfExists(join(resourcesDir, "app-update.yml"));
  try {
    await writeFile(join(resourcesDir, "app-update.yml"), [
      "provider: generic",
      "url: http://127.0.0.1:9/bi-talks-signal-updates",
      "updaterCacheDirName: bi-talks-signal-updater-disabled",
      ""
    ].join("\n"), "utf8");
  } catch {
  }
}
function possibleWindowHelperPaths() {
  if (process.platform !== "win32") return [];
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath || "";
  const cwd = process.cwd();
  return [
    join(__dirname, "../runtime-vendor/win32-window-helper/WindowHostHelper.ps1"),
    join(appPath, "vendor", "win32-window-helper", "WindowHostHelper.ps1"),
    join(cwd, "vendor", "win32-window-helper", "WindowHostHelper.ps1"),
    join(resourcesPath, "vendor", "win32-window-helper", "WindowHostHelper.ps1"),
    join(resourcesPath, "win32-window-helper", "WindowHostHelper.ps1")
  ].filter(Boolean);
}
function findWindowHelper() {
  if (cachedWindowHelperPath !== void 0) return cachedWindowHelperPath || void 0;
  cachedWindowHelperPath = possibleWindowHelperPaths().find((path) => existsSync(path)) || null;
  return cachedWindowHelperPath || void 0;
}
function ps(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function runPowerShell(command) {
  return new Promise((resolve2, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += String(data);
    });
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      code === 0 ? resolve2(stdout.trim()) : reject(new Error((stderr || stdout || `PowerShell helper exited with code ${code ?? "unknown"}.`).trim()));
    });
  });
}
function runPowerShellSync(command) {
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    windowsHide: true,
    stdio: "ignore"
  });
}
function readManagedSignalProcessMarker(dataDir) {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, managedSignalProcessMarkerName), "utf8"));
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0 || typeof value.executable !== "string") return void 0;
    return { pid: Number(value.pid), executable: value.executable, startedAt: String(value.startedAt || "") };
  } catch {
    return void 0;
  }
}
function clearManagedSignalProcessMarker(dataDir, expectedPid) {
  const markerPath = join(dataDir, managedSignalProcessMarkerName);
  if (expectedPid !== void 0 && readManagedSignalProcessMarker(dataDir)?.pid !== expectedPid) return;
  try {
    rmSync(markerPath, { force: true });
  } catch {
  }
}
async function runPowerShellBoolean(command) {
  try {
    return (await runPowerShell(command)).trim() === "1";
  } catch {
    return false;
  }
}
async function managedSignalProfileInUse(dataDir) {
  if (process.platform !== "win32") return false;
  const command = `
$dataDir = ${ps(dataDir)}
$active = @(Get-CimInstance Win32_Process -Filter "Name = 'Signal.exe'" | Where-Object {
  $_.CommandLine -and
  $_.CommandLine.IndexOf($dataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
})
if ($active.Count -gt 0) { '1' } else { '0' }
`;
  return runPowerShellBoolean(command);
}
async function recoverMarkedManagedSignalProcess(dataDir, expectedExecutable) {
  if (process.platform !== "win32") return false;
  const marker = readManagedSignalProcessMarker(dataDir);
  if (!marker) return false;
  const command = `
$pidValue = ${marker.pid}
$expectedPath = ${ps(expectedExecutable)}
$markerPath = ${ps(marker.executable)}
$expectedDataDir = ${ps(dataDir)}
$expectedStartedAt = [DateTimeOffset]::Parse(${ps(marker.startedAt)})
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
if (-not $target) { 'gone'; exit }
if ($target.Name -ine 'Signal.exe') { 'foreign'; exit }
$actualPath = [string]$target.ExecutablePath
$commandLine = [string]$target.CommandLine
$actualStartedAt = [DateTimeOffset]$target.CreationDate
$sameExpectedExecutable = $actualPath -and [String]::Equals([IO.Path]::GetFullPath($actualPath), [IO.Path]::GetFullPath($expectedPath), [StringComparison]::OrdinalIgnoreCase)
$sameMarkerExecutable = $actualPath -and [String]::Equals([IO.Path]::GetFullPath($actualPath), [IO.Path]::GetFullPath($markerPath), [StringComparison]::OrdinalIgnoreCase)
$usesManagedProfile = $commandLine -and $commandLine.IndexOf($expectedDataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
$sameStart = [Math]::Abs(($actualStartedAt.ToUniversalTime() - $expectedStartedAt.ToUniversalTime()).TotalSeconds) -lt 15
if ($sameExpectedExecutable -and $sameMarkerExecutable -and $usesManagedProfile -and $sameStart) {
  & taskkill.exe /PID $pidValue /T /F 2>$null | Out-Null
  'stopped'
} else {
  'foreign'
}
`;
  const result = await runPowerShell(command).catch(() => "foreign");
  if (result !== "stopped" && result !== "gone") return false;
  clearManagedSignalProcessMarker(dataDir, marker.pid);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!await managedSignalProfileInUse(dataDir)) return true;
    await delay(100);
  }
  return false;
}
async function signalExecutableInUse(executable) {
  if (process.platform !== "win32") return false;
  const command = `
$expectedPath = ${ps(executable)}
$active = @(Get-CimInstance Win32_Process | Where-Object {
  if ($_.Name -ine 'Signal.exe' -or -not $_.ExecutablePath) { return $false }
  [String]::Equals([IO.Path]::GetFullPath([string]$_.ExecutablePath), [IO.Path]::GetFullPath($expectedPath), [StringComparison]::OrdinalIgnoreCase)
})
if ($active.Count -gt 0) { '1' } else { '0' }
`;
  return runPowerShellBoolean(command);
}
function stopOwnedManagedSignalProcess(owned) {
  const pid = owned.child.pid;
  if (process.platform !== "win32" || !pid) return;
  const command = `
$pidValue = ${pid}
$expectedPath = ${ps(owned.executable)}
$expectedDataDir = ${ps(owned.dataDir)}
$expectedStartedAt = [DateTimeOffset]::Parse(${ps(owned.startedAt)})
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
if ($target -and $target.Name -ieq 'Signal.exe') {
  $actualPath = [string]$target.ExecutablePath
  $commandLine = [string]$target.CommandLine
  $actualStartedAt = [DateTimeOffset]$target.CreationDate
  $sameExecutable = $actualPath -and [String]::Equals([IO.Path]::GetFullPath($actualPath), [IO.Path]::GetFullPath($expectedPath), [StringComparison]::OrdinalIgnoreCase)
  $usesOwnedProfile = $commandLine -and $commandLine.IndexOf($expectedDataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
  $sameStart = [Math]::Abs(($actualStartedAt.ToUniversalTime() - $expectedStartedAt.ToUniversalTime()).TotalSeconds) -lt 15
  if ($sameExecutable -and $usesOwnedProfile -and $sameStart) {
    & taskkill.exe /PID $pidValue /T /F 2>$null | Out-Null
  }
}
`;
  runPowerShellSync(command);
  clearManagedSignalProcessMarker(owned.dataDir, pid);
}
function startManagedSignalOwnerWatchdog(signalPid, executable, dataDir, startedAt) {
  if (process.platform !== "win32") return;
  const ownerPid = process.pid;
  const command = `
$owner = Get-Process -Id ${ownerPid} -ErrorAction SilentlyContinue
if ($owner) { $owner | Wait-Process -ErrorAction SilentlyContinue }
$signalPid = ${signalPid}
$expectedPath = ${ps(executable)}
$expectedDataDir = ${ps(dataDir)}
$expectedStartedAt = [DateTimeOffset]::Parse(${ps(startedAt)})
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $signalPid" -ErrorAction SilentlyContinue
if ($target -and $target.Name -eq 'Signal.exe') {
  $actualPath = [string]$target.ExecutablePath
  $commandLine = [string]$target.CommandLine
  $actualStartedAt = [DateTimeOffset]$target.CreationDate
  $sameExecutable = $actualPath -and [String]::Equals([IO.Path]::GetFullPath($actualPath), [IO.Path]::GetFullPath($expectedPath), [StringComparison]::OrdinalIgnoreCase)
  $usesManagedProfile = $commandLine.IndexOf($expectedDataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0
  $sameStart = [Math]::Abs(($actualStartedAt.ToUniversalTime() - $expectedStartedAt.ToUniversalTime()).TotalSeconds) -lt 15
  if ($sameExecutable -and $usesManagedProfile -and $sameStart) {
    & taskkill.exe /PID $signalPid /T /F 2>$null | Out-Null
  }
}
`;
  try {
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
    const launcherCommand = `Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedCommand}') -WindowStyle Hidden`;
    const launcher = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      launcherCommand
    ], {
      detached: true,
      windowsHide: true,
      stdio: "ignore"
    });
    launcher.unref();
  } catch {
  }
}
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function waitForManagedSignalProcessStart(child, milliseconds) {
  return new Promise((resolve2, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      error ? reject(error) : resolve2();
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`Signal exited during startup with code ${code ?? "unknown"}.`));
    const timer = setTimeout(() => {
      if (!child.pid || child.exitCode !== null || child.killed) {
        finish(new Error("Signal did not remain running after startup."));
        return;
      }
      finish();
    }, milliseconds);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}
function getUrl(url, redirects = 5) {
  return new Promise((resolve2, reject) => {
    const parsed = new URL(url);
    const get$2 = parsed.protocol === "http:" ? get : get$1;
    const request = get$2(url, {
      headers: { "User-Agent": "Bi-talks Signal Updater" }
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirects > 0) {
        response.resume();
        void getUrl(new URL(location, url).toString(), redirects - 1).then(resolve2, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download request failed with HTTP ${statusCode}.`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve2({ statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.setTimeout(45e3, () => request.destroy(new Error("Download request timed out.")));
    request.on("error", reject);
  });
}
async function fetchText(url) {
  const response = await getUrl(url);
  return response.body.toString("utf8");
}
function downloadFile(url, target, onProgress, redirects = 5) {
  return new Promise((resolve2, reject) => {
    const parsed = new URL(url);
    const get$2 = parsed.protocol === "http:" ? get : get$1;
    const request = get$2(url, {
      headers: { "User-Agent": "Bi-talks Signal Updater" }
    }, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirects > 0) {
        response.resume();
        void downloadFile(new URL(location, url).toString(), target, onProgress, redirects - 1).then(resolve2, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${statusCode}.`));
        return;
      }
      const total = Number(response.headers["content-length"] || 0);
      let received = 0;
      let lastProgress = -1;
      const file = createWriteStream(target);
      response.on("data", (chunk) => {
        received += chunk.length;
        if (!total || !onProgress) return;
        const progress = Math.max(1, Math.min(99, Math.floor(received / total * 100)));
        if (progress !== lastProgress) {
          lastProgress = progress;
          onProgress(progress);
        }
      });
      response.pipe(file);
      file.on("finish", () => file.close(() => {
        onProgress?.(100);
        resolve2();
      }));
      file.on("error", (error) => {
        void rm(target, { force: true }).catch(() => void 0);
        reject(error);
      });
      response.on("error", (error) => {
        void rm(target, { force: true }).catch(() => void 0);
        reject(error);
      });
    });
    request.setTimeout(12e4, () => request.destroy(new Error("Download timed out.")));
    request.on("error", (error) => {
      void rm(target, { force: true }).catch(() => void 0);
      reject(error);
    });
  });
}
function parseSignalRelease(manifest) {
  const version = manifest.match(/^version:\s*['"]?([^'"\s]+)['"]?/m)?.[1];
  if (!version) throw new Error("Unable to read Signal update version.");
  const files = [...manifest.matchAll(/^\s*-\s+url:\s*(\S+)[\s\S]*?^\s*sha512:\s*(\S+)[\s\S]*?^\s*size:\s*(\d+)/gm)].map((match) => ({ fileName: match[1], sha512: match[2], size: Number(match[3]) }));
  const arch = process.arch === "arm64" ? "win-arm64" : "win-x64";
  const selected = files.find((file) => file.fileName.includes(arch)) || files.find((file) => file.fileName.includes("win-x64")) || files[0];
  if (!selected) throw new Error("Unable to find a Windows Signal update package.");
  return {
    version,
    fileName: basename(selected.fileName),
    downloadUrl: new URL(selected.fileName, signalUpdateBaseUrl).toString(),
    sha512: selected.sha512,
    size: selected.size,
    manifest
  };
}
async function latestSignalRelease() {
  return parseSignalRelease(await fetchText(signalUpdateFeedUrl));
}
async function sha512Base64(path) {
  return new Promise((resolve2, reject) => {
    const hash = createHash("sha512");
    const input = createReadStream(path);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => {
      const digest = hash.digest("base64");
      if (input.closed) resolve2(digest);
      else input.once("close", () => resolve2(digest));
    });
  });
}
async function verifiedSignalInstaller(release, emit2, accountId) {
  const downloadsDir = join(app.getPath("userData"), "signal-updater", "downloads");
  await mkdir(downloadsDir, { recursive: true });
  const installerPath = join(downloadsDir, release.fileName);
  const expectedSize = release.size > 0 ? release.size : void 0;
  if (existsSync(installerPath)) {
    const info = await stat(installerPath).catch(() => void 0);
    if (info && (!expectedSize || info.size === expectedSize)) {
      emit2({ type: "signal-update", accountId, status: "checking", message: `正在验证已下载的 Signal ${release.version} 安装包`, version: release.version, progress: 80 });
      const currentHash = await sha512Base64(installerPath);
      if (currentHash === release.sha512) return installerPath;
    }
  }
  await rm(installerPath, { force: true }).catch(() => void 0);
  await downloadFile(release.downloadUrl, installerPath, (progress) => {
    emit2({ type: "signal-update", accountId, status: "downloading", message: `正在下载 Signal ${release.version}`, version: release.version, progress: progress * 0.8 });
  });
  const hash = await sha512Base64(installerPath);
  if (hash !== release.sha512) {
    await rm(installerPath, { force: true }).catch(() => void 0);
    throw new Error("Downloaded Signal package failed verification.");
  }
  return installerPath;
}
async function ensureSevenZip() {
  const toolsDir = join(app.getPath("userData"), "signal-updater", "tools");
  const sevenZip = join(toolsDir, "7za.exe");
  if (existsSync(sevenZip)) return sevenZip;
  await mkdir(toolsDir, { recursive: true });
  const zipPath = join(toolsDir, "7za920.zip");
  await downloadFile(sevenZipStandaloneUrl, zipPath);
  await runPowerShell(`$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${ps(zipPath)} -DestinationPath ${ps(toolsDir)} -Force`);
  if (!existsSync(sevenZip)) throw new Error("Unable to prepare the Signal package extractor.");
  return sevenZip;
}
function runProcess(executable, args, timeoutMs = 18e4) {
  return new Promise((resolve2, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      reject(new Error(`${basename(executable)} timed out.`));
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      stdout += String(data);
    });
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve2() : reject(new Error((stderr || stdout || `${basename(executable)} exited with code ${code ?? "unknown"}.`).trim()));
    });
  });
}
function runRobocopy(source, target, timeoutMs = 3e5) {
  return new Promise((resolve2, reject) => {
    const child = spawn("robocopy.exe", [
      source,
      target,
      "/E",
      "/COPY:DAT",
      "/DCOPY:DAT",
      "/R:3",
      "/W:1",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NP",
      "/MT:16"
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
      reject(new Error("Signal file sync timed out."));
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      stdout += String(data);
    });
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const exitCode = code ?? 16;
      exitCode <= 7 ? resolve2() : reject(new Error((stderr || stdout || `robocopy exited with code ${exitCode}.`).trim()));
    });
  });
}
function preferredSignalInstallDir(runtimeRoot) {
  if (process.platform === "win32") return managedSignalProgramDir(runtimeRoot);
  const existing = findSignalDesktop(runtimeRoot);
  if (existing) return dirname(existing);
  const appPath = app.getAppPath();
  const cwd = process.cwd();
  const resourcesPath = process.resourcesPath || "";
  return [
    join(appPath, "vendor", "signal-desktop"),
    join(cwd, "vendor", "signal-desktop"),
    join(resourcesPath, "vendor", "signal-desktop")
  ].find((candidate) => existsSync(dirname(candidate))) || join(cwd, "vendor", "signal-desktop");
}
async function readSignalVersion(installDir) {
  for (const file of [
    join(installDir, "latest.yml.bi-talks-disabled"),
    join(installDir, "latest.yml"),
    join(installDir, "resources", "app-update.yml.bi-talks-disabled"),
    join(installDir, "resources", "app-update.yml")
  ]) {
    try {
      const version = (await readFile(file, "utf8")).match(/^version:\s*['"]?([^'"\s]+)['"]?/m)?.[1];
      if (version) return version;
    } catch {
    }
  }
  return void 0;
}
async function readSignalExecutableVersion(executable) {
  if (!existsSync(executable)) return void 0;
  const value = await runPowerShell(`
$item = Get-Item -LiteralPath ${ps(executable)}
$version = [string]$item.VersionInfo.ProductVersion
if (-not $version) { $version = [string]$item.VersionInfo.FileVersion }
$version
`).catch(() => "");
  return value ? normalizeSignalVersion(value) : void 0;
}
async function verifySignalAuthenticode(executable) {
  await runPowerShell(`
$signature = Get-AuthenticodeSignature -LiteralPath ${ps(executable)}
if ($signature.Status -ne 'Valid') { throw 'Signal executable signature is not valid.' }
$subject = [string]$signature.SignerCertificate.Subject
if ($subject -notmatch 'Signal Messenger') { throw 'Signal executable signer is not Signal Messenger.' }
`);
}
async function assertSignalInstallDirNotInUse(installDir) {
  if (process.platform !== "win32") return;
  const command = `
$installDir = ${ps(installDir)}
$needle = (($installDir -replace '[\\\\/]+$','') + '\\').ToLowerInvariant()
$allSignal = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'Signal.exe' })
$active = @($allSignal | Where-Object {
  (($_.ExecutablePath) -and $_.ExecutablePath.ToLowerInvariant().StartsWith($needle)) -or
  (($_.CommandLine) -and $_.CommandLine.ToLowerInvariant().Contains($needle))
})
if ($active.Count -gt 0) { throw 'The bundled Signal directory is being used by another running process. Bi-talks will not close or modify it.' }
`;
  await runPowerShell(command);
}
async function removeDirectoryWithRetries(path) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve2) => {
      rm$1(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 180 }, () => resolve2());
    });
    if (!existsSync(path)) return true;
    await delay(250 + attempt * 250);
  }
  return !existsSync(path);
}
async function cleanupManagedSignalTemporaryDirectories(runtimeRoot) {
  const signalRuntimeDir = join(runtimeRoot, "signal-runtime");
  const entries = await readdir(signalRuntimeDir, { withFileTypes: true }).catch(() => void 0);
  if (!entries) return;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(signalRuntimeDir, entry.name);
    if (!isManagedSignalTemporaryDirectory(runtimeRoot, candidate)) continue;
    const removed = await removeDirectoryWithRetries(candidate);
    if (removed) {
      signalRuntimeLog("Removed stale private Signal update directory", { directory: candidate });
    } else {
      signalRuntimeLog("Private Signal update directory remains locked; cleanup will retry later", { directory: candidate });
    }
  }
}
async function renameWithRetries(from, to, beforeRetry) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      await beforeRetry?.().catch(() => void 0);
      await delay(Math.min(2500, 180 + attempt * 260));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function syncSignalInstallInPlace(stagingDir, installDir) {
  await mkdir(installDir, { recursive: true });
  await assertSignalInstallDirNotInUse(installDir);
  await runRobocopy(stagingDir, installDir);
  await assertSignalInstallDirNotInUse(installDir);
  if (!isUsableSignalDesktop(join(installDir, "Signal.exe"))) {
    throw new Error("Signal update copied files, but the bundled Signal Desktop is not usable.");
  }
  await removeDirectoryWithRetries(stagingDir);
}
async function replaceSignalInstall(stagingDir, installDir) {
  const parent = dirname(installDir);
  const backupDir = join(parent, `.signal-desktop-backup-${Date.now()}`);
  await mkdir(parent, { recursive: true });
  await assertSignalInstallDirNotInUse(installDir);
  try {
    if (existsSync(installDir)) {
      await renameWithRetries(installDir, backupDir, () => assertSignalInstallDirNotInUse(installDir));
    }
    await renameWithRetries(stagingDir, installDir, () => assertSignalInstallDirNotInUse(installDir));
  } catch (error) {
    signalRuntimeLog("Private Signal runtime directory replacement failed; using workspace-only in-place fallback", {
      installDir,
      stagingDir,
      backupDir,
      message: error instanceof Error ? error.message : String(error)
    });
    if (!existsSync(installDir) && existsSync(backupDir)) {
      await renameWithRetries(backupDir, installDir).catch(() => void 0);
    }
    if (!existsSync(stagingDir)) throw error;
    await syncSignalInstallInPlace(stagingDir, installDir);
    await removeDirectoryWithRetries(backupDir);
    signalRuntimeLog("Private Signal runtime installed by workspace-only in-place fallback", { installDir });
  }
  await removeDirectoryWithRetries(backupDir);
  if (!isUsableSignalDesktop(join(installDir, "Signal.exe"))) {
    throw new Error("Private Signal runtime installation completed without Signal.exe and resources/app.asar.");
  }
  signalRuntimeLog("Private Signal runtime directory replaced", { installDir });
}
async function runWindowHelperNow(args) {
  const helper = findWindowHelper();
  if (!helper) throw new Error("Window helper is not available.");
  try {
    await sendWindowHelper(helper, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isInvalidSignalWindowHandleError(message)) throw error;
    signalRuntimeLog("Signal window helper command retrying after transient failure", { message });
    stopWindowHelper();
    await sendWindowHelper(helper, args);
  }
}
function runWindowHelper(args) {
  const run = windowHelperRunQueue.catch(() => void 0).then(() => runWindowHelperNow(args));
  windowHelperRunQueue = run.catch(() => void 0);
  return run;
}
function ensureWindowHelper(helper) {
  if (windowHelperProcess && windowHelperProcess.exitCode == null && !windowHelperProcess.killed && windowHelperProcess.stdin?.writable) return windowHelperProcess;
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, "-Serve"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"]
  });
  windowHelperProcess = child;
  windowHelperOutput = "";
  child.stdout?.on("data", (data) => {
    windowHelperOutput += String(data);
    let newline = windowHelperOutput.indexOf("\n");
    while (newline >= 0) {
      const response = windowHelperOutput.slice(0, newline).trim();
      windowHelperOutput = windowHelperOutput.slice(newline + 1);
      const request = windowHelperRequests.shift();
      if (request) {
        clearTimeout(request.timeout);
        if (response === "ok") request.resolve();
        else request.reject(new Error(response.replace(/^error\s*/i, "") || "Window helper rejected the placement."));
      }
      newline = windowHelperOutput.indexOf("\n");
    }
  });
  child.stdin?.on("error", (error) => failWindowHelper(child, error));
  child.on("exit", (code) => failWindowHelper(child, new Error(`Window helper exited with code ${code ?? "unknown"}.`)));
  child.on("error", (error) => failWindowHelper(child, error));
  return child;
}
function failWindowHelper(child, error) {
  if (windowHelperProcess !== child) return;
  windowHelperProcess = void 0;
  windowHelperOutput = "";
  const pending = windowHelperRequests;
  windowHelperRequests = [];
  for (const request of pending) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
}
function sendWindowHelper(helper, args) {
  const child = ensureWindowHelper(helper);
  const line = `${args.map((item) => item.replace(/[\t\r\n]/g, " ")).join("	")}
`;
  return new Promise((resolve2, reject) => {
    const request = {
      resolve: resolve2,
      reject,
      timeout: setTimeout(() => {
        const index = windowHelperRequests.indexOf(request);
        if (index >= 0) windowHelperRequests.splice(index, 1);
        reject(new Error("Window helper timed out while applying the Signal placement."));
        if (windowHelperProcess === child) stopWindowHelper();
      }, 5e3)
    };
    windowHelperRequests.push(request);
    if (!child.stdin?.writable) {
      const index = windowHelperRequests.indexOf(request);
      if (index >= 0) windowHelperRequests.splice(index, 1);
      clearTimeout(request.timeout);
      reject(new Error("Window helper stdin is not writable."));
      return;
    }
    child.stdin.write(line, (error) => {
      if (!error) return;
      const index = windowHelperRequests.indexOf(request);
      if (index >= 0) windowHelperRequests.splice(index, 1);
      clearTimeout(request.timeout);
      reject(error);
      if (windowHelperProcess === child) stopWindowHelper();
    });
  });
}
function stopWindowHelper() {
  const child = windowHelperProcess;
  windowHelperProcess = void 0;
  windowHelperOutput = "";
  const pending = windowHelperRequests;
  windowHelperRequests = [];
  for (const request of pending) {
    clearTimeout(request.timeout);
    request.reject(new Error("Window helper stopped."));
  }
  try {
    child?.stdin?.end();
  } catch {
  }
  try {
    child?.kill();
  } catch {
  }
}
function signalWindowHelperArgs(windows, placement, showOnly = false) {
  return [
    "place",
    windows.primary,
    windows.parent,
    String(placement.x),
    String(placement.y),
    String(placement.width),
    String(placement.height),
    placement.visible ? "1" : "0",
    windows.all.join(","),
    placement.recover ? "1" : "0",
    showOnly ? "1" : "0"
  ];
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function mergeJson(base2, patch) {
  const result = { ...base2 };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? mergeJson(result[key], value) : value;
  }
  return result;
}
class SignalManager {
  constructor(emit2, translateIncoming, translateOutgoing, runtimeRoot, requestNativeUpdate) {
    this.emit = emit2;
    this.runtimeRoot = runtimeRoot;
    this.requestNativeUpdate = requestNativeUpdate;
    this.translationBridge = new SignalTranslationBridge(emit2, translateIncoming, translateOutgoing, (account) => this.handleNativeUpdateRequest(account));
  }
  managedProcesses = /* @__PURE__ */ new Map();
  launchPromises = /* @__PURE__ */ new Map();
  attachedWindows = /* @__PURE__ */ new Map();
  attached = /* @__PURE__ */ new Set();
  placements = /* @__PURE__ */ new Map();
  placementRuns = /* @__PURE__ */ new Map();
  visibilityRequestNumbers = /* @__PURE__ */ new Map();
  presentationGeneration = 0;
  presentationSuspended = false;
  backgroundProfileChecks = /* @__PURE__ */ new Map();
  signalUpdatePromise;
  temporaryDirectoryCleanupPromise;
  translationBridge;
  startupSyncIsNonBlocking = false;
  bundledUpdaterPrepared = false;
  bundledUpdaterPreparationPromise;
  nativeUpdateRequest;
  pendingRestartStateWrite = Promise.resolve();
  shuttingDown = false;
  handleNativeUpdateRequest(account) {
    if (this.nativeUpdateRequest) return this.nativeUpdateRequest;
    const request = Promise.resolve(this.requestNativeUpdate?.(account)).then(() => void 0).finally(() => {
      if (this.nativeUpdateRequest === request) this.nativeUpdateRequest = void 0;
    });
    this.nativeUpdateRequest = request;
    return request;
  }
  runningAccountIds() {
    const ids = new Set(this.launchPromises.keys());
    for (const [accountId, { child }] of this.managedProcesses) {
      if (child.exitCode == null && !child.killed) ids.add(accountId);
    }
    return [...ids];
  }
  async prepareBackgroundStarts(accounts) {
    const signalAccounts = accounts.filter((account) => account.platform === "signal");
    if (process.platform !== "win32" || !signalAccounts.length) return;
    const results = await Promise.all(signalAccounts.map(async (account) => ({
      accountId: account.id,
      inUse: await managedSignalProfileInUse(this.managedDataDir(account))
    })));
    const validUntil = Date.now() + 8e3;
    for (const result of results) {
      if (!result.inUse) this.backgroundProfileChecks.set(result.accountId, validUntil);
    }
  }
  capturePreview(accountId) {
    return this.translationBridge.capturePreview(accountId);
  }
  isWindowPresented(accountId) {
    return this.attached.has(accountId) && this.placements.get(accountId)?.visible === true;
  }
  suspendPresentation() {
    if (this.presentationSuspended) return;
    this.presentationSuspended = true;
    this.presentationGeneration += 1;
  }
  resumePresentation() {
    if (!this.presentationSuspended) return;
    this.presentationSuspended = false;
    this.presentationGeneration += 1;
  }
  nextVisibilityRequest(accountId) {
    const requestNumber = (this.visibilityRequestNumbers.get(accountId) || 0) + 1;
    this.visibilityRequestNumbers.set(accountId, requestNumber);
    return requestNumber;
  }
  cleanupTemporaryUpdateDirectories() {
    if (!this.temporaryDirectoryCleanupPromise) {
      this.temporaryDirectoryCleanupPromise = cleanupManagedSignalTemporaryDirectories(this.runtimeRoot).finally(() => {
        this.temporaryDirectoryCleanupPromise = void 0;
      });
    }
    return this.temporaryDirectoryCleanupPromise;
  }
  managedDataDir(account) {
    return join(managedSignalRuntimeRoot(this.runtimeRoot), account.id);
  }
  pendingRestartMarkerPath() {
    return join(this.runtimeRoot, "signal-runtime", pendingSignalRestartMarkerName);
  }
  async updatePendingRestartAccount(accountId, pending) {
    let wasPending = false;
    const operation = this.pendingRestartStateWrite.then(async () => {
      const markerPath = this.pendingRestartMarkerPath();
      const current = await readFile(markerPath, "utf8").then((value) => parsePendingSignalRestartAccountIds(JSON.parse(value))).catch(() => []);
      const accountIds = new Set(current);
      wasPending = accountIds.has(accountId);
      if (pending) accountIds.add(accountId);
      else accountIds.delete(accountId);
      if (!accountIds.size) {
        await rm(markerPath, { force: true });
        return;
      }
      await mkdir(dirname(markerPath), { recursive: true });
      await writeFile(markerPath, `${JSON.stringify({
        schemaVersion: 1,
        accountIds: [...accountIds],
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, null, 2)}
`, "utf8");
    });
    this.pendingRestartStateWrite = operation.catch(() => void 0);
    await operation;
    return wasPending;
  }
  async markPendingRestart(accountId) {
    await this.updatePendingRestartAccount(accountId, true).catch((error) => {
      signalRuntimeLog("Unable to persist pending Signal restart marker", {
        accountId,
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }
  async completePendingRestart(account) {
    const wasPending = await this.updatePendingRestartAccount(account.id, false).catch((error) => {
      signalRuntimeLog("Unable to clear pending Signal restart marker", {
        accountId: account.id,
        message: error instanceof Error ? error.message : String(error)
      });
      return false;
    });
    if (!wasPending) return;
    const executable = findSignalDesktop(this.runtimeRoot);
    const version = executable ? await readSignalVersion(dirname(executable)) : void 0;
    signalRuntimeLog("Pending Signal restart completed", { accountId: account.id, version });
    this.emit({
      type: "signal-update",
      accountId: account.id,
      status: "complete",
      message: version ? `Signal ${version} 安装完成并已自动启动` : "Signal 安装完成并已自动启动",
      version
    });
  }
  async reportPendingRestartFailure(account, error) {
    const markerPath = this.pendingRestartMarkerPath();
    const pending = await readFile(markerPath, "utf8").then((value) => parsePendingSignalRestartAccountIds(JSON.parse(value)).includes(account.id)).catch(() => false);
    if (!pending) return;
    const message = error instanceof Error ? error.message : String(error);
    signalRuntimeLog("Pending Signal restart failed and will resume on the next start", { accountId: account.id, message });
    this.emit({
      type: "signal-update",
      accountId: account.id,
      status: "error",
      message: `Signal 已安装，但自动启动失败；下次启动将自动重试：${message}`
    });
  }
  async writeJsonFile(path, patch) {
    let existing = {};
    if (existsSync(path)) {
      try {
        existing = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Refusing to overwrite unreadable Signal profile file ${basename(path)}: ${message}`);
      }
    }
    const merged = mergeJson(existing, patch);
    if (JSON.stringify(existing) === JSON.stringify(merged)) return;
    await writeFile(path, `${JSON.stringify(merged, null, 2)}
`, "utf8");
  }
  async prepareManagedSignalProfile(dataDir, initialBounds) {
    await mkdir(dataDir, { recursive: true });
    await this.clearManagedSignalUpdateState(dataDir);
    const startupBounds = initialBounds || { x: -32e3, y: -32e3, width: 900, height: 700 };
    await this.writeJsonFile(join(dataDir, "config.json"), {
      startInTray: false,
      minimizeToTray: false,
      minimizeToSystemTray: false,
      minimizeToAndStartInSystemTray: false,
      systemTraySetting: "never",
      hideTrayIcon: true,
      autoUpdate: false,
      autoDownloadUpdate: false,
      disableAutoUpdate: true,
      updatesEnabled: false
    });
    await this.writeJsonFile(join(dataDir, "ephemeral.json"), {
      "system-tray-setting": "DoNotUseSystemTray",
      window: {
        autoHideMenuBar: false,
        maximized: false,
        fullscreen: false,
        x: startupBounds.x,
        y: startupBounds.y,
        width: Math.max(900, startupBounds.width),
        height: Math.max(700, startupBounds.height)
      }
    });
    await this.writeJsonFile(join(dataDir, "Preferences"), {
      background_mode: { enabled: false },
      profile: {
        content_settings: {
          exceptions: {
            notifications: {
              "https://signal.org,*": { setting: 2 },
              "https://desktop.signal.org,*": { setting: 2 }
            }
          }
        },
        default_content_setting_values: {
          notifications: 2
        }
      }
    });
  }
  prepareBundledUpdater(executable) {
    if (this.bundledUpdaterPrepared) return Promise.resolve();
    if (this.bundledUpdaterPreparationPromise) return this.bundledUpdaterPreparationPromise;
    const preparation = (async () => {
      if (await signalExecutableInUse(executable)) {
        this.bundledUpdaterPrepared = true;
        return;
      }
      await disableBundledSignalAutoUpdater(executable);
      this.bundledUpdaterPrepared = true;
    })().finally(() => {
      if (this.bundledUpdaterPreparationPromise === preparation) this.bundledUpdaterPreparationPromise = void 0;
    });
    this.bundledUpdaterPreparationPromise = preparation;
    return preparation;
  }
  async launchManagedSignal(account, initialBounds) {
    const existing = this.managedProcesses.get(account.id);
    if (existing && existing.child.exitCode == null && !existing.child.killed) return;
    let executable = findSignalDesktop(this.runtimeRoot);
    if (!executable) {
      signalRuntimeLog("Private Signal runtime missing; installing from official source before launch", {
        runtimeRoot: this.runtimeRoot,
        installDir: preferredSignalInstallDir(this.runtimeRoot),
        source: signalUpdateFeedUrl
      });
      await this.updateBundledDesktop(account);
      executable = findSignalDesktop(this.runtimeRoot);
    }
    if (!executable) throw new Error("Signal Desktop could not be installed from Signal official source.");
    const dataDir = this.managedDataDir(account);
    const profileWasPrechecked = (this.backgroundProfileChecks.get(account.id) || 0) > Date.now();
    this.backgroundProfileChecks.delete(account.id);
    if (!profileWasPrechecked && await managedSignalProfileInUse(dataDir)) {
      const recovered = await recoverMarkedManagedSignalProcess(dataDir, executable);
      if (!recovered && await managedSignalProfileInUse(dataDir)) {
        throw new Error("This managed Signal profile is already in use by another process. Bi-talks left that process untouched.");
      }
      signalRuntimeLog("Recovered managed Signal profile left by a previous Bi-talks process", {
        accountId: account.id,
        dataDir
      });
    }
    const staleMarker = readManagedSignalProcessMarker(dataDir);
    if (staleMarker) clearManagedSignalProcessMarker(dataDir, staleMarker.pid);
    await this.prepareBundledUpdater(executable);
    await this.prepareManagedSignalProfile(dataDir, initialBounds);
    let lastError;
    for (let attempt = 0; attempt < managedSignalLaunchRetryDelays.length; attempt += 1) {
      if (this.shuttingDown) throw new Error("Bi-Talks is shutting down; Signal startup was cancelled.");
      const retryDelay = managedSignalLaunchRetryDelays[attempt];
      if (retryDelay > 0) await delay(retryDelay);
      const startedAt = (/* @__PURE__ */ new Date()).toISOString();
      const child = spawn(executable, [
        `--user-data-dir=${dataDir}`,
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        "--disable-updates",
        "--disable-background-mode",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-direct-composition",
        "--disable-features=CalculateNativeWinOcclusion,HardwareMediaKeyHandling"
      ], {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          BI_TALKS_MANAGED_SIGNAL: "1",
          ELECTRON_NO_UPDATER: "1",
          SIGNAL_DISABLE_UPDATES: "1",
          SIGNAL_DISABLE_AUTO_UPDATE: "1"
        }
      });
      child.unref();
      const owned = { child, executable, dataDir, startedAt };
      this.managedProcesses.set(account.id, owned);
      try {
        await waitForManagedSignalProcessStart(child, 1e3);
        if (this.shuttingDown || this.managedProcesses.get(account.id) !== owned) {
          throw new Error("Signal startup was interrupted before it became ready.");
        }
        if (child.pid) {
          await writeFile(join(dataDir, managedSignalProcessMarkerName), `${JSON.stringify({
            pid: child.pid,
            executable,
            startedAt
          }, null, 2)}
`, "utf8");
          startManagedSignalOwnerWatchdog(child.pid, executable, dataDir, startedAt);
        }
        this.translationBridge.attach(account, dataDir);
        child.on("exit", () => {
          const wasCurrentProcess = this.managedProcesses.get(account.id)?.child === child;
          if (wasCurrentProcess) this.managedProcesses.delete(account.id);
          if (child.pid) clearManagedSignalProcessMarker(dataDir, child.pid);
          if (!wasCurrentProcess) return;
          this.attachedWindows.delete(account.id);
          this.attached.delete(account.id);
          this.placements.delete(account.id);
          this.emit({ type: "connection", accountId: account.id, status: "Managed Signal closed" });
        });
        child.on("error", (error) => {
          this.emit({ type: "error", accountId: account.id, message: `Unable to start managed Signal Desktop: ${error.message}` });
        });
        signalRuntimeLog("Managed Signal process remained active after startup verification", {
          accountId: account.id,
          pid: child.pid,
          attempt: attempt + 1
        });
        return;
      } catch (error) {
        lastError = error;
        if (this.managedProcesses.get(account.id) === owned) this.managedProcesses.delete(account.id);
        stopOwnedManagedSignalProcess(owned);
        if (child.pid) clearManagedSignalProcessMarker(dataDir, child.pid);
        for (let waitAttempt = 0; waitAttempt < 15; waitAttempt += 1) {
          if (!await managedSignalProfileInUse(dataDir)) break;
          await delay(200);
        }
        signalRuntimeLog("Managed Signal startup attempt failed", {
          accountId: account.id,
          attempt: attempt + 1,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("Signal did not start after installation.");
  }
  async ensureManagedSignal(account, initialBounds) {
    const existing = this.managedProcesses.get(account.id);
    if (existing && existing.child.exitCode == null && !existing.child.killed) return;
    const pending = this.launchPromises.get(account.id);
    if (pending) return pending;
    const launch = this.launchManagedSignal(account, initialBounds).finally(() => {
      if (this.launchPromises.get(account.id) === launch) this.launchPromises.delete(account.id);
    });
    this.launchPromises.set(account.id, launch);
    return launch;
  }
  async clearManagedSignalUpdateState(dataDir) {
    const targets = [
      join(dataDir, "pending"),
      join(dataDir, "updates"),
      join(dataDir, "update"),
      join(dataDir, "installer.exe"),
      join(dataDir, "latest.yml"),
      join(dataDir, "DevToolsActivePort")
    ];
    await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true }).catch(() => void 0)));
  }
  async start(account, initialBounds) {
    if (process.platform !== "win32") return;
    try {
      await this.cleanupTemporaryUpdateDirectories();
      await this.waitForDesktopUpdate();
      await this.ensureManagedSignal(account, initialBounds || { x: -32e3, y: -32e3, width: 900, height: 700 });
      await this.completePendingRestart(account);
    } catch (error) {
      await this.reportPendingRestartFailure(account, error);
      throw error;
    }
  }
  applyTranslationPreferences(account) {
    this.translationBridge.updatePreferences(account);
  }
  normalizedBounds(bounds) {
    const width = Math.max(80, Math.round(bounds.width));
    const height = Math.max(80, Math.round(bounds.height));
    const x = Math.round(bounds.x);
    const y = Math.round(bounds.y);
    return { x, y, width, height };
  }
  samePlacement(a, b) {
    return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.visible === b.visible;
  }
  async applyPlacement(account, windows, placement) {
    const { x, y, width, height, visible, recover = false } = placement;
    const allWindows = windows.all.map((hwnd) => `[IntPtr]::new(${hwnd})`).join(",");
    if (findWindowHelper()) {
      await runWindowHelper(signalWindowHelperArgs(windows, placement));
      this.placements.set(account.id, placement);
      return;
    }
    const command = `
$primaryHwnd = [IntPtr]::new(${windows.primary})
$parentHwnd = [IntPtr]::new(${windows.parent})
$allWindows = @(${allWindows})
$x = ${x}
$y = ${y}
$width = ${width}
$height = ${height}
$visible = ${visible ? "$true" : "$false"}
$recover = ${recover ? "$true" : "$false"}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32SignalOverlay {
  public const int GWL_STYLE = -16;
  public const int GWL_EXSTYLE = -20;
  public const int GWLP_HWNDPARENT = -8;
  public const long WS_CHILD = 0x40000000L;
  public const long WS_VISIBLE = 0x10000000L;
  public const long WS_POPUP = unchecked((long)0x80000000L);
  public const long WS_CAPTION = 0x00C00000L;
  public const long WS_THICKFRAME = 0x00040000L;
  public const long WS_MINIMIZEBOX = 0x00020000L;
  public const long WS_MAXIMIZEBOX = 0x00010000L;
  public const long WS_SYSMENU = 0x00080000L;
  public const long WS_EX_TOOLWINDOW = 0x00000080L;
  public const long WS_EX_APPWINDOW = 0x00040000L;
  public const long WS_EX_LAYERED = 0x00080000L;
  public const long WS_EX_TOPMOST = 0x00000008L;
  public const uint LWA_ALPHA = 0x00000002;
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint colorKey, byte alpha, uint flags);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr lprcUpdate, IntPtr hrgnUpdate, uint flags);
  [DllImport("user32.dll")] public static extern bool UpdateWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("dwmapi.dll")] public static extern int DwmFlush();
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
  public static void SetCloaked(IntPtr hWnd, bool cloaked) {
    int value = cloaked ? 1 : 0;
    DwmSetWindowAttribute(hWnd, 13, ref value, sizeof(int));
  }
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll", EntryPoint="GetWindowLong")] public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLong")] public static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
  public static IntPtr GetStyle(IntPtr hWnd) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_STYLE) : new IntPtr(GetWindowLong32(hWnd, GWL_STYLE));
  }
  public static IntPtr GetExStyle(IntPtr hWnd) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE) : new IntPtr(GetWindowLong32(hWnd, GWL_EXSTYLE));
  }
  public static void SetLong(IntPtr hWnd, int index, long value) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, index, new IntPtr(value));
    else SetWindowLong32(hWnd, index, unchecked((int)value));
  }
  public static void SetOwner(IntPtr hWnd, IntPtr owner) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, GWLP_HWNDPARENT, owner);
    else SetWindowLong32(hWnd, GWLP_HWNDPARENT, owner.ToInt32());
  }
}
"@
$currentStyle = [Win32SignalOverlay]::GetStyle($primaryHwnd).ToInt64()
$style = ($currentStyle -bor [Win32SignalOverlay]::WS_POPUP) -band (-bnot ([Win32SignalOverlay]::WS_CHILD -bor [Win32SignalOverlay]::WS_CAPTION -bor [Win32SignalOverlay]::WS_THICKFRAME -bor [Win32SignalOverlay]::WS_MINIMIZEBOX -bor [Win32SignalOverlay]::WS_MAXIMIZEBOX -bor [Win32SignalOverlay]::WS_SYSMENU))
$currentExStyle = [Win32SignalOverlay]::GetExStyle($primaryHwnd).ToInt64()
$exStyle = ($currentExStyle -bor [Win32SignalOverlay]::WS_EX_TOOLWINDOW) -band (-bnot ([Win32SignalOverlay]::WS_EX_APPWINDOW -bor [Win32SignalOverlay]::WS_EX_TOPMOST -bor [Win32SignalOverlay]::WS_EX_LAYERED))
$frameChanged = ($style -ne $currentStyle) -or ($exStyle -ne $currentExStyle)
if ($style -ne $currentStyle) { [Win32SignalOverlay]::SetLong($primaryHwnd, [Win32SignalOverlay]::GWL_STYLE, $style) }
if ($exStyle -ne $currentExStyle) { [Win32SignalOverlay]::SetLong($primaryHwnd, [Win32SignalOverlay]::GWL_EXSTYLE, $exStyle) }
[Win32SignalOverlay]::SetOwner($primaryHwnd, $parentHwnd)
$placeFlags = if ($frameChanged) { 0x0630 } else { 0x0610 }
if ($visible) {
  [Win32SignalOverlay]::SetCloaked($primaryHwnd, $true)
  $sizeMessage = [IntPtr]::new((($height -band 0xffff) -shl 16) -bor ($width -band 0xffff))
  if ($recover) {
    [Win32SignalOverlay]::SetWindowPos($primaryHwnd, [IntPtr]::Zero, $x, $y, $width + 1, $height, $placeFlags) | Out-Null
    [Win32SignalOverlay]::ShowWindow($primaryHwnd, 8) | Out-Null
    [Win32SignalOverlay]::SetCloaked($primaryHwnd, $false)
    [Win32SignalOverlay]::SetWindowPos($primaryHwnd, [IntPtr]::Zero, $x, $y, $width, $height, $placeFlags) | Out-Null
    [Win32SignalOverlay]::SendMessage($primaryHwnd, 0x0005, [IntPtr]::Zero, $sizeMessage) | Out-Null
  } else {
    # Prepare at final geometry while hidden, then reveal exactly once. Keeping
    # the window opaque prevents Signal's client-drawn menu from recompositing.
    [Win32SignalOverlay]::SetWindowPos($primaryHwnd, [IntPtr]::Zero, $x, $y, $width, $height, $placeFlags) | Out-Null
    [Win32SignalOverlay]::RedrawWindow($primaryHwnd, [IntPtr]::Zero, [IntPtr]::Zero, 0x0180) | Out-Null
    [Win32SignalOverlay]::UpdateWindow($primaryHwnd) | Out-Null
    [Win32SignalOverlay]::DwmFlush() | Out-Null
    [Win32SignalOverlay]::ShowWindow($primaryHwnd, 8) | Out-Null
    [Win32SignalOverlay]::SetCloaked($primaryHwnd, $false)
    [Win32SignalOverlay]::DwmFlush() | Out-Null
  }
  [Win32SignalOverlay]::RedrawWindow($primaryHwnd, [IntPtr]::Zero, [IntPtr]::Zero, 0x0180) | Out-Null
  [Win32SignalOverlay]::UpdateWindow($primaryHwnd) | Out-Null
  foreach ($hwnd in $allWindows) {
    if ($hwnd -ne $primaryHwnd) { [Win32SignalOverlay]::ShowWindow($hwnd, 0) | Out-Null }
  }
} else {
  # Keep WS_VISIBLE for Signal's menu state, but cloak the inactive surface so
  # it is completely absent from desktop composition and input routing.
  [Win32SignalOverlay]::SetCloaked($primaryHwnd, $true)
  [Win32SignalOverlay]::SetWindowPos($primaryHwnd, [IntPtr]::Zero, -32000, -32000, $width, $height, 0x0610) | Out-Null
  [Win32SignalOverlay]::ShowWindow($primaryHwnd, 8) | Out-Null
}
`;
    await runPowerShell(command);
    this.placements.set(account.id, placement);
  }
  async moveAttachedWindow(account, bounds, visible, force = false, recover = false) {
    if (!this.attachedWindows.has(account.id) || process.platform !== "win32") return false;
    const normalized = this.normalizedBounds(bounds);
    const desired = { ...normalized, visible, recover };
    this.resizePending ??= new Map();
    const prior = this.resizePending.get(account.id);
    if(prior && !prior.started && !prior.force && !prior.recover && !force && !recover && prior.visible===visible && prior.run){
      prior.desired=desired;
      return prior.run;
    }
    const job = { visible, force, recover, desired, started: false, superseded: false };
    if (prior && !prior.started && !prior.force && !prior.recover && !force && !recover && prior.visible === visible) prior.superseded = true;
    this.resizePending.set(account.id, job);
    const previousRun = this.placementRuns.get(account.id);
    const run = (previousRun ? previousRun.catch(() => false) : Promise.resolve(false)).then(async () => {
      job.started = true;
      if (this.resizePending.get(account.id) === job) this.resizePending.delete(account.id);
      if (job.superseded) return false;
      const desired = job.desired;
      const windows = this.attachedWindows.get(account.id);
      if (!windows) return false;
      if (!force && this.samePlacement(this.placements.get(account.id), desired)) return false;
      if (force) this.placements.delete(account.id);
      await this.applyPlacement(account, windows, desired);
      return true;
    });
    job.run=run;
    this.placementRuns.set(account.id, run);
    try {
      return await run;
    } finally {
      if (this.placementRuns.get(account.id) === run) this.placementRuns.delete(account.id);
    }
  }
  async hideAllManagedWindows(account) {
    if (process.platform !== "win32") return;
    const dataDir = this.managedDataDir(account);
    const command = `
$dataDir = ${ps(dataDir)}
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Win32HideManagedSignal {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  private static HashSet<uint> processIds = new HashSet<uint>();
  private static int hiddenCount = 0;
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
  public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
  private static bool HideWindow(IntPtr hWnd, IntPtr lParam) {
    uint processId;
    GetWindowThreadProcessId(hWnd, out processId);
    if (processIds.Contains(processId)) {
      int cloak = 1;
      DwmSetWindowAttribute(hWnd, 13, ref cloak, sizeof(int));
      hiddenCount++;
    }
    return true;
  }
  public static int Hide(uint[] ids) {
    processIds = new HashSet<uint>(ids);
    hiddenCount = 0;
    EnumWindows(HideWindow, IntPtr.Zero);
    return hiddenCount;
  }
}
"@
$allSignal = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Signal.exe' })
$processIds = New-Object 'System.Collections.Generic.HashSet[Int64]'
foreach ($process in $allSignal) {
  if ($process.CommandLine -and $process.CommandLine.IndexOf($dataDir, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    [void]$processIds.Add([Int64]$process.ProcessId)
  }
}
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($process in $allSignal) {
    if ($processIds.Contains([Int64]$process.ParentProcessId) -and -not $processIds.Contains([Int64]$process.ProcessId)) {
      [void]$processIds.Add([Int64]$process.ProcessId)
      $changed = $true
    }
  }
}
if ($processIds.Count -gt 0) {
  [Win32HideManagedSignal]::Hide([uint32[]]@($processIds)) | Out-Null
}
`;
    await runPowerShell(command);
  }
  async attach(account, parentHwnd, bounds, visible = true) {
    if (process.platform !== "win32") throw new Error("Signal window embedding is only available on Windows.");
    await this.waitForDesktopUpdate();
    if (this.attachedWindows.has(account.id)) {
      try {
        await this.moveAttachedWindow(account, bounds, visible);
        this.emit({ type: "connection", accountId: account.id, status: "Signal window ready" });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/no longer valid|invalid window|invalid handle|is not a valid window/i.test(message)) throw error;
        this.attachedWindows.delete(account.id);
        this.attached.delete(account.id);
        this.placements.delete(account.id);
      }
    }
    const { x, y, width, height } = this.normalizedBounds(bounds);
    await this.ensureManagedSignal(account, { x: -32e3, y: -32e3, width, height });
    const dataDir = this.managedDataDir(account);
    const command = `
$dataDir = ${ps(dataDir)}
$x = ${x}
$y = ${y}
$width = ${width}
$height = ${height}
$visible = ${visible ? "$true" : "$false"}
$parent = [IntPtr]::new(${parentHwnd.toString()})
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Embed {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public const int GWL_STYLE = -16;
  public const int GWL_EXSTYLE = -20;
  public const int GWLP_HWNDPARENT = -8;
  public const long WS_CHILD = 0x40000000L;
  public const long WS_VISIBLE = 0x10000000L;
  public const long WS_POPUP = unchecked((long)0x80000000L);
  public const long WS_CAPTION = 0x00C00000L;
  public const long WS_THICKFRAME = 0x00040000L;
  public const long WS_MINIMIZEBOX = 0x00020000L;
  public const long WS_MAXIMIZEBOX = 0x00010000L;
  public const long WS_SYSMENU = 0x00080000L;
  public const long WS_EX_TOOLWINDOW = 0x00000080L;
  public const long WS_EX_APPWINDOW = 0x00040000L;
  public const long WS_EX_TOPMOST = 0x00000008L;
  private static long targetProcessId = 0;
  private static System.Collections.Generic.List<IntPtr> foundWindows = new System.Collections.Generic.List<IntPtr>();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder className, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr lprcUpdate, IntPtr hrgnUpdate, uint flags);
  [DllImport("user32.dll")] public static extern bool UpdateWindow(IntPtr hWnd);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int attribute, ref int value, int size);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  [DllImport("user32.dll", EntryPoint="GetWindowLong")] public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLong")] public static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
  public static IntPtr GetStyle(IntPtr hWnd) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_STYLE) : new IntPtr(GetWindowLong32(hWnd, GWL_STYLE));
  }
  public static IntPtr GetExStyle(IntPtr hWnd) {
    return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE) : new IntPtr(GetWindowLong32(hWnd, GWL_EXSTYLE));
  }
  public static void SetLong(IntPtr hWnd, int index, long value) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, index, new IntPtr(value));
    else SetWindowLong32(hWnd, index, unchecked((int)value));
  }
  public static void SetOwner(IntPtr hWnd, IntPtr owner) {
    if (IntPtr.Size == 8) SetWindowLongPtr64(hWnd, GWLP_HWNDPARENT, owner);
    else SetWindowLong32(hWnd, GWLP_HWNDPARENT, owner.ToInt32());
  }
  public static void SetCloaked(IntPtr hWnd, bool cloaked) {
    int value = cloaked ? 1 : 0;
    DwmSetWindowAttribute(hWnd, 13, ref value, sizeof(int));
  }
  private static bool EnumWindowCallback(IntPtr hWnd, IntPtr lParam) {
    uint processId;
    GetWindowThreadProcessId(hWnd, out processId);
    if ((long)processId == targetProcessId && IsWindow(hWnd)) {
      RECT rect;
      GetWindowRect(hWnd, out rect);
      int width = rect.Right - rect.Left;
      int height = rect.Bottom - rect.Top;
      if (width > 80 && height > 80) foundWindows.Add(hWnd);
    }
    return true;
  }
  public static long[] FindWindowsForProcess(long processId) {
    targetProcessId = processId;
    foundWindows.Clear();
    EnumWindows(EnumWindowCallback, IntPtr.Zero);
    long[] handles = new long[foundWindows.Count];
    for (int i = 0; i < foundWindows.Count; i++) handles[i] = foundWindows[i].ToInt64();
    return handles;
  }
  public static int WindowScore(IntPtr hWnd) {
    RECT rect;
    GetWindowRect(hWnd, out rect);
    int width = Math.Max(0, rect.Right - rect.Left);
    int height = Math.Max(0, rect.Bottom - rect.Top);
    var title = new System.Text.StringBuilder(256);
    GetWindowText(hWnd, title, 256);
    var className = new System.Text.StringBuilder(256);
    GetClassName(hWnd, className, 256);
    string titleText = title.ToString();
    string classText = className.ToString();
    int area = Math.Min(width * height, 2500000);
    int titleBonus = titleText.IndexOf("Signal", StringComparison.OrdinalIgnoreCase) >= 0 ? 1100000 : 0;
    int classBonus = classText.IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) >= 0 ? 120000 : 0;
    int visibleBonus = IsWindowVisible(hWnd) ? 800000 : 0;
    int emptyTitlePenalty = String.IsNullOrWhiteSpace(titleText) ? 350000 : 0;
    int blankShellPenalty = classText.IndexOf("Chrome_WidgetWin_0", StringComparison.OrdinalIgnoreCase) >= 0 && String.IsNullOrWhiteSpace(titleText) ? 1400000 : 0;
    int minimizedPenalty = IsIconic(hWnd) ? 1200000 : 0;
    return area + titleBonus + classBonus + visibleBonus - emptyTitlePenalty - blankShellPenalty - minimizedPenalty;
  }
  public static bool IsPreferredMainWindow(IntPtr hWnd) {
    RECT rect;
    GetWindowRect(hWnd, out rect);
    int width = Math.Max(0, rect.Right - rect.Left);
    int height = Math.Max(0, rect.Bottom - rect.Top);
    var title = new System.Text.StringBuilder(256);
    GetWindowText(hWnd, title, 256);
    var className = new System.Text.StringBuilder(256);
    GetClassName(hWnd, className, 256);
    string titleText = title.ToString();
    string classText = className.ToString();
    return width > 300 &&
      height > 300 &&
      !IsIconic(hWnd) &&
      titleText.IndexOf("Signal", StringComparison.OrdinalIgnoreCase) >= 0 &&
      classText.IndexOf("Chrome_WidgetWin_1", StringComparison.OrdinalIgnoreCase) >= 0;
  }
}
"@
$deadline = (Get-Date).AddSeconds(35)
$fallbackDeadline = (Get-Date).AddSeconds(9)
$windowHwndList = @()
$preferredHwndList = @()
$allSignal = @()
$nextProcessRefresh = [DateTime]::MinValue
while ((Get-Date) -lt $deadline) {
  # Poll windows frequently, but refresh only Signal's process tree every 500 ms.
  if ((Get-Date) -ge $nextProcessRefresh) {
    $allSignal = @(Get-CimInstance Win32_Process -Filter "Name = 'Signal.exe'")
    $nextProcessRefresh = (Get-Date).AddMilliseconds(500)
  }
  $processIds = New-Object 'System.Collections.Generic.HashSet[Int64]'
  foreach ($seed in ($allSignal | Where-Object { $_.CommandLine -like "*$dataDir*" })) { [void]$processIds.Add([Int64]$seed.ProcessId) }
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $allSignal) {
      if ($processIds.Contains([Int64]$process.ParentProcessId) -and -not $processIds.Contains([Int64]$process.ProcessId)) {
        [void]$processIds.Add([Int64]$process.ProcessId)
        $changed = $true
      }
    }
  }
  $candidates = $allSignal | Where-Object { $processIds.Contains([Int64]$_.ProcessId) }
  foreach ($candidate in $candidates) {
    $candidateHwnds = [Win32Embed]::FindWindowsForProcess([Int64]$candidate.ProcessId)
    foreach ($candidateHwnd in $candidateHwnds) {
      if ($candidateHwnd -ne 0) {
        # Signal may briefly show its own top-level window before the managed
        # surface is attached. Hide every discovered candidate immediately so
        # it cannot steal focus from whichever application the user switched to.
        [Win32Embed]::SetCloaked([IntPtr]::new([Int64]$candidateHwnd), $true)
        if (-not $windowHwndList.Contains([Int64]$candidateHwnd)) { $windowHwndList += [Int64]$candidateHwnd }
      }
    }
  }
  $preferredHwndList = @($windowHwndList | Where-Object { [Win32Embed]::IsPreferredMainWindow([IntPtr]::new([Int64]$_)) })
  if ($preferredHwndList.Count -gt 0) { break }
  if ($windowHwndList.Count -gt 0 -and (Get-Date) -gt $fallbackDeadline) { break }
  Start-Sleep -Milliseconds 80
}
if ($windowHwndList.Count -eq 0) { throw 'The managed Signal Desktop window did not appear. Finish installation or wait for Signal to open, then try again.' }
$primaryPool = if ($preferredHwndList.Count -gt 0) { $preferredHwndList } else { $windowHwndList }
$primaryHwndValue = ($primaryPool | Sort-Object { -[Win32Embed]::WindowScore([IntPtr]::new([Int64]$_)) } | Select-Object -First 1)
$primaryHwnd = [IntPtr]::new([Int64]$primaryHwndValue)
$allHwnds = @($windowHwndList | ForEach-Object { [IntPtr]::new([Int64]$_) })
foreach ($candidateHwnd in $allHwnds) {
  if ($candidateHwnd -ne $primaryHwnd) { [Win32Embed]::ShowWindow($candidateHwnd, 0) | Out-Null }
}
[Win32Embed]::SetCloaked($primaryHwnd, $true)
$style = [Win32Embed]::GetStyle($primaryHwnd).ToInt64()
$style = ($style -bor [Win32Embed]::WS_POPUP -bor [Win32Embed]::WS_VISIBLE) -band (-bnot ([Win32Embed]::WS_CHILD -bor [Win32Embed]::WS_CAPTION -bor [Win32Embed]::WS_THICKFRAME -bor [Win32Embed]::WS_MINIMIZEBOX -bor [Win32Embed]::WS_MAXIMIZEBOX -bor [Win32Embed]::WS_SYSMENU))
$exStyle = [Win32Embed]::GetExStyle($primaryHwnd).ToInt64()
$exStyle = ($exStyle -bor [Win32Embed]::WS_EX_TOOLWINDOW) -band (-bnot ([Win32Embed]::WS_EX_APPWINDOW -bor [Win32Embed]::WS_EX_TOPMOST))
[Win32Embed]::SetLong($primaryHwnd, [Win32Embed]::GWL_STYLE, $style)
[Win32Embed]::SetLong($primaryHwnd, [Win32Embed]::GWL_EXSTYLE, $exStyle)
[Win32Embed]::SetOwner($primaryHwnd, $parent)
$targetX = $x
$targetY = $y
[Win32Embed]::SetWindowPos($primaryHwnd, [IntPtr]::Zero, $targetX, $targetY, $width, $height, 0x0050) | Out-Null
if ($visible) {
  if (-not [Win32Embed]::IsWindowVisible($primaryHwnd)) { [Win32Embed]::ShowWindow($primaryHwnd, 8) | Out-Null }
  [Win32Embed]::SetCloaked($primaryHwnd, $false)
  [Win32Embed]::RedrawWindow($primaryHwnd, [IntPtr]::Zero, [IntPtr]::Zero, 0x0181) | Out-Null
  [Win32Embed]::UpdateWindow($primaryHwnd) | Out-Null
} else {
  [Win32Embed]::SetCloaked($primaryHwnd, $true)
}
Write-Output (([Int64]$primaryHwndValue).ToString() + '|' + (($windowHwndList | ForEach-Object { [Int64]$_ }) -join ','))
`;
    let output = "";
    try {
      output = await runPowerShell(command);
    } catch (error) {
      this.stopOwnedManagedSignal(account.id);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message.includes("managed Signal Desktop window did not appear") ? "Signal did not open a usable window. Its process exited or did not finish starting; start this account again." : message);
    }
    const [primary, allRaw] = output.split("|");
    const all = (allRaw || primary).split(",").map((item) => item.trim()).filter(Boolean);
    const windows = { primary: primary.trim(), all: all.length ? all : [primary.trim()], parent: parentHwnd.toString() };
    const placement = { x, y, width, height, visible };
    this.attachedWindows.set(account.id, windows);
    this.attached.add(account.id);
    if (findWindowHelper()) await runWindowHelper(signalWindowHelperArgs(windows, placement)).catch(() => void 0);
    this.placements.set(account.id, placement);
    this.emit({ type: "connection", accountId: account.id, status: "Signal window ready" });
  }
  async setVisible(account, visible, bounds, recover = false, force = false) {
    const startedAt = performance.now();
    const usesWindowHelper = !!findWindowHelper();
    const requestNumber = this.nextVisibilityRequest(account.id);
    const requestedVisible = visible;
    const requestGeneration = this.presentationGeneration;
    const actualVisible = requestedVisible && !this.presentationSuspended;
    const last = this.placements.get(account.id);
    const fallbackBounds = bounds || (last ? {
      x: last.x,
      y: last.y,
      width: last.width,
      height: last.height
    } : { x: -32e3, y: -32e3, width: 900, height: 700 });
    let moved = false;
    try {
      moved = await this.moveAttachedWindow(account, fallbackBounds, actualVisible, force || recover, recover);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const windows = this.attachedWindows.get(account.id);
      const recoverablePlacement = isRecoverableSignalPlacementError(message);
      if(recoverablePlacement && this.visibilityRequestNumbers.get(account.id)!==requestNumber)return;
      signalRuntimeLog("Managed Signal visibility switch failed", {
        accountId: account.id,
        visible: actualVisible,
        usesWindowHelper,
        recoverable: recoverablePlacement && !!windows,
        message
      });
      if (!recoverablePlacement || !windows) throw error;
      this.attachedWindows.delete(account.id);
      this.attached.delete(account.id);
      this.placements.delete(account.id);
      await this.attach(account, BigInt(windows.parent), fallbackBounds, actualVisible);
      if(this.visibilityRequestNumbers.get(account.id)!==requestNumber)return;
      moved = await this.moveAttachedWindow(account, fallbackBounds, actualVisible, true, true);
      signalRuntimeLog("Managed Signal window recovered during account switch", {
        accountId: account.id,
        visible: actualVisible,
        reason: message
      });
    }
    const staleShow = requestedVisible && actualVisible && (this.presentationSuspended || requestGeneration !== this.presentationGeneration);
    if (staleShow) {
      const superseded = this.visibilityRequestNumbers.get(account.id) !== requestNumber;
      if (!this.presentationSuspended && superseded) {
        signalRuntimeLog("Ignored superseded managed Signal show after owner visibility changed", {
          accountId: account.id,
          requestGeneration,
          currentGeneration: this.presentationGeneration
        });
        return;
      }
      await this.moveAttachedWindow(account, fallbackBounds, false, true, false);
      await this.hideAllManagedWindows(account);
      signalRuntimeLog("Discarded stale managed Signal show after owner visibility changed", {
        accountId: account.id,
        requestGeneration,
        currentGeneration: this.presentationGeneration,
        suspended: this.presentationSuspended
      });
      return;
    }
    if (moved) {
      signalRuntimeLog("Managed Signal visibility switch completed", {
        accountId: account.id,
        visible: actualVisible,
        usesWindowHelper,
        durationMs: Math.round(performance.now() - startedAt)
      });
    }
    // The persistent window helper already guards hidden Signal process windows.
    // Avoid spawning PowerShell/CIM on the serialized account-switch path.
    // Keep the full scan for missing helpers or unattached/recovered windows.
    const helperGuardsHiddenWindow = usesWindowHelper && this.attachedWindows.has(account.id) && this.placements.get(account.id)?.visible === false;
    if (!actualVisible && (moved || force || recover || requestedVisible) && !helperGuardsHiddenWindow) await this.hideAllManagedWindows(account);
  }
  async restoreOwnedWindow(account) {
    const windows = this.attachedWindows.get(account.id);
    const placement = this.placements.get(account.id);
    if (!windows || !placement || process.platform !== "win32") return;
    const requestNumber = this.nextVisibilityRequest(account.id);
    const requestGeneration = this.presentationGeneration;
    if (this.presentationSuspended) return;
    if (findWindowHelper()) {
      await runWindowHelper(signalWindowHelperArgs(windows, { ...placement, visible: true, recover: false }, true));
    } else {
      await this.moveAttachedWindow(account, placement, true, true, false);
    }
    if (this.presentationSuspended || requestGeneration !== this.presentationGeneration) {
      const superseded = this.visibilityRequestNumbers.get(account.id) !== requestNumber;
      if (this.presentationSuspended || !superseded) {
        await this.moveAttachedWindow(account, placement, false, true, false);
        await this.hideAllManagedWindows(account);
      }
      return;
    }
    this.placements.set(account.id, { ...placement, visible: true, recover: false });
  }
  async updateBundledDesktop(account) {
    if (this.signalUpdatePromise) return this.signalUpdatePromise;
    this.signalUpdatePromise = this.performBundledDesktopUpdate(account).finally(() => {
      this.signalUpdatePromise = void 0;
    });
    return this.signalUpdatePromise;
  }
  syncBundledDesktopFromLocal() {
    if (this.signalUpdatePromise) return this.signalUpdatePromise;
    this.startupSyncIsNonBlocking = true;
    this.signalUpdatePromise = this.performBundledDesktopUpdate(void 0, true).finally(() => {
      this.signalUpdatePromise = void 0;
      this.startupSyncIsNonBlocking = false;
    });
    return this.signalUpdatePromise;
  }
  async waitForDesktopUpdate() {
    const activeUpdate = this.signalUpdatePromise;
    if (activeUpdate && !this.startupSyncIsNonBlocking) await activeUpdate.then(() => void 0).catch(() => void 0);
  }
  isBundledDesktopUpdateRunning() {
    return Boolean(this.signalUpdatePromise);
  }
  async performBundledDesktopUpdate(account, localOnly = false) {
    if (process.platform !== "win32") throw new Error("Signal Desktop managed updates are only available on Windows.");
    const accountId = account?.id;
    const installDir = preferredSignalInstallDir(this.runtimeRoot);
    const firstInstall = !isUsableSignalDesktop(join(installDir, "Signal.exe"));
    signalRuntimeLog("Managed Signal update inspection started; local installations are excluded", {
      runtimeRoot: this.runtimeRoot,
      installDir,
      source: signalUpdateFeedUrl,
      localOnly
    });
    const previousVersion = await readSignalVersion(installDir);
    let stagingDir;
    let localStagingDir;
    let targetVersion;
    let installerPath;
    this.emit({ type: "signal-update", accountId, status: "checking", message: "正在检查 Signal 更新", progress: 0 });
    try {
      await this.cleanupTemporaryUpdateDirectories();
      const parent = dirname(installDir);
      const updateStamp = Date.now();
      const localScratchParent = join(app.getPath("temp"), "signal-updater");
      await mkdir(localScratchParent, { recursive: true });
      localStagingDir = join(localScratchParent, `.signal-desktop-staging-${updateStamp}`);
      if (localOnly) {
        const version = previousVersion || "unknown";
        const result2 = { version, previousVersion, installDir, updated: false };
        this.emit({
          type: "signal-update",
          accountId,
          status: "complete",
          message: "已跳过本机 Signal 同步；受管运行时仅使用官方下载源",
          version
        });
        return result2;
      }
      if (!targetVersion) {
        signalRuntimeLog("Checking official Signal update feed", { source: signalUpdateFeedUrl, installDir });
        const release = await latestSignalRelease();
        if (compareSignalVersions(release.version, previousVersion) <= 0 && isUsableSignalDesktop(join(installDir, "Signal.exe"))) {
          await disableBundledSignalAutoUpdater(join(installDir, "Signal.exe"));
          const result2 = { version: previousVersion || release.version, previousVersion, installDir, updated: false };
          this.emit({ type: "signal-update", accountId, status: "complete", message: `Signal 已经是最新版本 ${result2.version}`, version: result2.version });
          return result2;
        }
        installerPath = await verifiedSignalInstaller(release, this.emit, accountId);
        targetVersion = release.version;
        signalRuntimeLog("Official Signal package verified for private workspace installation", {
          version: targetVersion,
          installerPath,
          installDir
        });
        await removeDirectoryWithRetries(localStagingDir);
        await mkdir(localStagingDir, { recursive: true });
        const sevenZip = await ensureSevenZip();
        this.emit({ type: "signal-update", accountId, status: "installing", message: `正在本机快速解压 Signal ${targetVersion}`, version: targetVersion, progress: 84 });
        await runProcess(sevenZip, ["x", installerPath, "-y", `-o${localStagingDir}`, "-mmt=on"], 3e5);
        await writeFile(join(localStagingDir, "latest.yml"), release.manifest, "utf8").catch(() => void 0);
      }
      const stagedExecutable = join(localStagingDir, "Signal.exe");
      if (!isUsableSignalDesktop(stagedExecutable)) throw new Error("Signal update package did not contain a usable Signal Desktop.");
      await verifySignalAuthenticode(stagedExecutable);
      await disableBundledSignalAutoUpdater(stagedExecutable);
      stagingDir = join(parent, `.signal-desktop-staging-${updateStamp}`);
      await removeDirectoryWithRetries(stagingDir);
      this.emit({ type: "signal-update", accountId, status: "installing", message: `正在快速同步 Signal ${targetVersion} 文件`, version: targetVersion, progress: 90 });
      await runRobocopy(localStagingDir, stagingDir);
      const setupSource = installerPath || [
        join(localStagingDir, "SignalSetup.exe"),
        join(installDir, "SignalSetup.exe")
      ].find((candidate) => existsSync(candidate));
      if (setupSource && !existsSync(join(stagingDir, "SignalSetup.exe"))) {
        await link(setupSource, join(stagingDir, "SignalSetup.exe")).catch(() => copyFile(setupSource, join(stagingDir, "SignalSetup.exe")));
      }
      if (!isUsableSignalDesktop(join(stagingDir, "Signal.exe"))) {
        throw new Error("Signal update files were prepared, but the synchronized desktop package is not usable.");
      }
      const completedLocalStagingDir = localStagingDir;
      localStagingDir = void 0;
      void removeDirectoryWithRetries(completedLocalStagingDir);
      this.emit({ type: "signal-update", accountId, status: "installing", message: `正在安装 Signal ${targetVersion}`, version: targetVersion, progress: 95 });
      signalRuntimeLog("Installing verified Signal package into workspace-only runtime", { installDir, stagingDir, version: targetVersion });
      if (firstInstall && accountId) await this.markPendingRestart(accountId);
      this.stopManagedSignalRuntimeForReplacement();
      await assertSignalInstallDirNotInUse(installDir);
      await replaceSignalInstall(stagingDir, installDir);
      stagingDir = void 0;
      await this.cleanupTemporaryUpdateDirectories();
      const installedVersion = await readSignalVersion(installDir) || await readSignalExecutableVersion(join(installDir, "Signal.exe"));
      if (compareSignalVersions(installedVersion, targetVersion) < 0) {
        throw new Error(`Signal ${targetVersion} was installed, but runtime verification reported ${installedVersion || "an unknown version"}.`);
      }
      const result = { version: targetVersion, previousVersion, installDir, updated: true };
      signalRuntimeLog("Managed Signal update completed in private workspace runtime", result);
      this.emit(firstInstall && accountId ? { type: "signal-update", accountId, status: "installing", message: `Signal ${targetVersion} 安装完成，正在自动启动`, version: targetVersion, progress: 99 } : { type: "signal-update", accountId, status: "complete", message: `Signal 已更新到 ${targetVersion}`, version: targetVersion });
      return result;
    } catch (error) {
      if (localStagingDir) await removeDirectoryWithRetries(localStagingDir);
      if (stagingDir) await removeDirectoryWithRetries(stagingDir);
      const message = error instanceof Error ? error.message : String(error);
      signalRuntimeLog("Managed Signal update failed", {
        runtimeRoot: this.runtimeRoot,
        installDir,
        source: signalUpdateFeedUrl,
        message
      });
      this.emit({ type: "signal-update", accountId, status: "error", message: `Signal 更新失败：${message}` });
      throw error;
    }
  }
  stopOwnedManagedSignal(accountId) {
    const owned = this.managedProcesses.get(accountId);
    if (!owned) return;
    stopOwnedManagedSignalProcess(owned);
    this.managedProcesses.delete(accountId);
  }
  stopManagedSignalRuntimeForReplacement() {
    this.translationBridge.shutdown();
    for (const windows of this.attachedWindows.values()) {
      const hwnds = windows.all.length ? windows.all : [windows.primary];
      const command = `
$hwnds = @(${hwnds.map((hwnd) => `[IntPtr]::new(${hwnd})`).join(",")})
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32SignalRuntimeReplacement {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
foreach ($hwnd in $hwnds) { [Win32SignalRuntimeReplacement]::ShowWindow($hwnd, 0) | Out-Null }
`;
      runPowerShellSync(command);
    }
    for (const accountId of [...this.managedProcesses.keys()]) this.stopOwnedManagedSignal(accountId);
    this.managedProcesses.clear();
    this.attachedWindows.clear();
    this.attached.clear();
    this.placements.clear();
    this.placementRuns.clear();
    this.visibilityRequestNumbers.clear();
    this.bundledUpdaterPrepared = false;
    this.bundledUpdaterPreparationPromise = void 0;
    stopWindowHelper();
  }
  remove(account) {
    this.translationBridge.detach(account.id);
    this.stopOwnedManagedSignal(account.id);
    this.managedProcesses.delete(account.id);
    this.launchPromises.delete(account.id);
    this.attachedWindows.delete(account.id);
    this.attached.delete(account.id);
    this.placements.delete(account.id);
    this.visibilityRequestNumbers.delete(account.id);
  }
  async deleteAccount(account) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(account.id) || account.id.includes("..")) {
      throw new Error("Invalid Signal account identifier.");
    }
    this.remove(account);
    const portableRoot2 = app.getPath("userData");
    const profileDirs = /* @__PURE__ */ new Set([
      this.managedDataDir(account),
      join(portableRoot2, managedSignalProfilesDirName, account.id),
      join(portableRoot2, "signal-desktop-managed", account.id)
    ]);
    const backupsRoot = join(portableRoot2, "signal-desktop-managed-backups");
    const backups = await readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
    for (const backup of backups) {
      if (backup.isDirectory()) profileDirs.add(join(backupsRoot, backup.name, account.id));
    }
    for (const profileDir of profileDirs) {
      if (!await removeDirectoryWithRetries(profileDir)) {
        throw new Error(`Unable to remove Signal account data from ${profileDir}.`);
      }
    }
  }
  shutdown() {
    this.shuttingDown = true;
    this.stopManagedSignalRuntimeForReplacement();
    this.launchPromises.clear();
    this.backgroundProfileChecks.clear();
  }
}
function nativeHandle(window2) {
  const buffer = window2.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigInt64LE(0) : BigInt(buffer.readInt32LE(0));
}
function clampBounds(bounds) {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height))
  };
}
function boundsEqual(left, right) {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
class GoogleVoiceManager {
  constructor(window2, runtimeRoot, emit2, translate) {
    this.window = window2;
    this.runtimeRoot = runtimeRoot;
    this.emit = emit2;
    this.translate = translate;
  }
  hosts = /* @__PURE__ */ new Map();
  activeId;
  bounds = { x: 0, y: 0, width: 1, height: 1 };
  shuttingDown = false;
  hostDirectory() {
    const packagedDirectory = join(__dirname, "../runtime-vendor/webview2-host");
    const projectDirectory = join(app.getAppPath(), "vendor", "webview2-host");
    if (app.isPackaged && !process.env.ELECTRON_RENDERER_URL && existsSync(join(packagedDirectory, "GoogleVoiceWebView2Host.exe"))) return packagedDirectory;
    return projectDirectory;
  }
  profileRoot(platform) {
    return join(this.runtimeRoot, platform === "googlechat" ? "google-chat-webview2" : "google-voice-webview2");
  }
  profileDirectory(account) {
    return join(this.profileRoot(account.platform), account.id);
  }
  command(host, command) {
    if (host.process.killed || !host.process.stdin.writable) return;
    try {
      host.process.stdin.write(`${command}
`);
    } catch (error) {
      console.warn("Google Voice host command could not be written.", error);
    }
  }
  boundsCommand(visible) {
    const bounds = clampBounds(this.bounds);
    return `bounds ${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height} ${visible ? "true" : "false"}`;
  }
  async ensureHost(account) {
    const existing = this.hosts.get(account.id);
    if (existing && !existing.process.killed && existing.process.exitCode === null) {
      existing.account = account;
      return existing;
    }
    const hostDirectory = this.hostDirectory();
    const executable = join(hostDirectory, "GoogleVoiceWebView2Host.exe");
    const requiredFiles = [
      "GoogleVoiceWebView2Host.exe",
      "Microsoft.Web.WebView2.Core.dll",
      "Microsoft.Web.WebView2.WinForms.dll",
      "WebView2Loader.dll",
      "UnreadMonitor.js",
      account.platform === "googlechat" ? "GoogleChatTranslation.js" : "GoogleVoiceTranslation.js"
    ];
    const missingFiles = requiredFiles.filter((file) => !existsSync(join(hostDirectory, file)));
    if (missingFiles.length) {
      throw new Error(`Google Voice 组件不完整，缺少：${missingFiles.join("、")}。组件目录：${hostDirectory}`);
    }
    this.emit({ type: "connection", accountId: account.id, status: account.platform === "googlechat" ? "正在启动 Google Chat…" : "正在启动 Google Voice…" });
    const profileDirectory = this.profileDirectory(account);
    await mkdir(profileDirectory, { recursive: true });
    const bounds = clampBounds(this.bounds);
    const child = spawn(executable, [
      "--account",
      account.id,
      "--platform",
      account.platform,
      "--data-dir",
      profileDirectory,
      "--parent",
      nativeHandle(this.window).toString(),
      "--x",
      String(bounds.x),
      "--y",
      String(bounds.y),
      "--width",
      String(bounds.width),
      "--height",
      String(bounds.height),
      "--visible",
      "false"
    ], {
      cwd: hostDirectory,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const hosted = { account, process: child, ready: false, visible: false, closing: false };
    this.hosts.set(account.id, hosted);
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (line.startsWith("ready ")) {
        hosted.ready = true;
        this.command(hosted, this.boundsCommand(this.activeId === account.id && hosted.visible));
        this.applyPreferences(hosted.account);
        this.emit({ type: "connection", accountId: account.id, status: "ready", detail: "Microsoft WebView2 ready" });
      } else if (line.startsWith("translate ")) {
        const [, requestId, target, encodedText] = line.split(" ");
        if (!/^[a-zA-Z0-9]+$/.test(requestId || "") || target !== "en" && target !== "zh" || !encodedText) return;
        let text = "";
        try {
          text = Buffer.from(encodedText, "base64").toString("utf8").trim();
        } catch {
          return;
        }
        if (!text) return;
        const source = target === "en" ? "zh" : "en";
        let partial = "";
        void this.translate(text, target, source, account.id, (delta) => {
          partial += delta;
          this.command(hosted, `translation ${requestId} ${Buffer.from(partial, "utf8").toString("base64")} partial`);
        }, () => !hosted.closing && hosted.visible, account.platform === "googlevoice" && requestId.startsWith("gvs") ? 2e3 : 0, account.platform === "googlevoice" ? 3e4 : void 0).then((translated) => {
          const result = translated.trim();
          if (!result) throw new Error("empty translation");
          this.command(hosted, `translation ${requestId} ${Buffer.from(result, "utf8").toString("base64")}`);
        }).catch(() => this.command(hosted, `translation-error ${requestId}`));
      } else if (line.startsWith("input-send ") && account.platform === "googlevoice") {
        const [, id, status] = line.split(" ");
        if (/^[a-zA-Z0-9]+$/.test(id || "")) this.command(hosted, "send-result " + id + " " + (status === "dispatched" ? "true" : "false"));
      } else if (line.startsWith("unread-json ")) {
        try {
          const sample = JSON.parse(Buffer.from(line.slice(12), "base64").toString("utf8"));
          if (Number.isFinite(sample.count)) this.emit({ type: "unread", accountId: account.id, count: sample.count, partial: sample.partial === true, delta: Number.isFinite(sample.delta) ? sample.delta : 0, trustedDecrease: sample.trustedDecrease === true, preview: sample.preview });
        } catch {
        }
      } else if (line.startsWith("unread ")) {
        const [, rawCount, rawTrustedDecrease] = line.split(" ");
        const count = Number(rawCount);
        if (!Number.isFinite(count)) return;
        this.emit({
          type: "unread",
          accountId: account.id,
          count: Math.max(0, Math.min(999, Math.round(count))),
          trustedDecrease: rawTrustedDecrease === "true"
        });
      } else if (line.startsWith("error ")) {
        this.emit({ type: "error", accountId: account.id, message: line.slice(6) });
      }
    });
    child.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) this.emit({ type: "error", accountId: account.id, message });
    });
    child.once("exit", (code) => {
      stdout.close();
      if (this.hosts.get(account.id)?.process === child) this.hosts.delete(account.id);
      if (this.activeId === account.id) this.activeId = void 0;
      if (!this.shuttingDown && !hosted.closing && code !== 0) {
        this.emit({ type: "error", accountId: account.id, message: `Google Voice WebView2 已退出（${code ?? "unknown"}）。` });
      }
    });
    child.once("error", (error) => {
      if (this.hosts.get(account.id)?.process === child) this.hosts.delete(account.id);
      this.emit({ type: "error", accountId: account.id, message: `无法启动 Microsoft WebView2：${error.message}` });
    });
    return hosted;
  }
  async start(account) {
    if (account.platform !== "googlevoice" && account.platform !== "googlechat") return;
    await this.ensureHost(account);
  }
  async activate(account) {
    const activation = this.activationGeneration = (this.activationGeneration || 0) + 1;
    if ((account?.platform === "googlevoice" || account?.platform === "googlechat") && this.activeId === account.id) {
      const host2 = await this.ensureHost(account);
      if (activation !== this.activationGeneration) return;
      if (!host2.visible || account.platform === "googlevoice") {
        host2.visible = true;
        this.command(host2, this.boundsCommand(true));
      }
      this.applyPreferences(account);
      return;
    }
    if (this.activeId) {
      const previous = this.hosts.get(this.activeId);
      if (previous?.visible) {
        previous.visible = false;
        this.command(previous, "visible false");
      }
      this.activeId = void 0;
    }
    if (!account || account.platform !== "googlevoice" && account.platform !== "googlechat") return;
    const host = await this.ensureHost(account);
    if (activation !== this.activationGeneration) return;
    this.activeId = account.id;
    host.visible = true;
    this.command(host, this.boundsCommand(true));
    this.applyPreferences(account);
  }
  setBounds(bounds) {
    const nextBounds = clampBounds(bounds);
    if (boundsEqual(this.bounds, nextBounds)) return;
    this.bounds = nextBounds;
    if (!this.activeId) return;
    const host = this.hosts.get(this.activeId);
    if (host) this.command(host, this.boundsCommand(host.visible));
  }
  applyPreferences(account) {
    const host = this.hosts.get(account.id);
    if (!host) return;
    const zoom = typeof account.zoom === "number" ? account.zoom : 100;
    const zoomCommand = `zoom ${Math.max(0.4, Math.min(1.6, zoom / 100)).toFixed(2)}`;
    if (host.lastZoomCommand !== zoomCommand) {
      host.lastZoomCommand = zoomCommand;
      this.command(host, zoomCommand);
    }
    const enabled = account.translationEnabled !== false;
    const color = typeof account.translationColor === "string" && /^#[0-9a-f]{6}$/i.test(account.translationColor) ? account.translationColor : "#d8ff00";
    const size = typeof account.translationSize === "number" ? Math.max(10, Math.min(24, Math.round(account.translationSize))) : 15;
    const preferencesCommand = `prefs ${enabled ? "true" : "false"} ${color} ${size}`;
    if (host.lastPreferencesCommand !== preferencesCommand) {
      host.lastPreferencesCommand = preferencesCommand;
      this.command(host, preferencesCommand);
    }
  }
  async refresh(account) {
    if (account.platform !== "googlevoice" && account.platform !== "googlechat") return;
    const host = await this.ensureHost(account);
    this.command(host, "refresh");
  }
  close(account) {
    const host = this.hosts.get(account.id);
    if (!host) return;
    host.closing = true;
    this.hosts.delete(account.id);
    if (this.activeId === account.id) this.activeId = void 0;
    this.command(host, "close");
    setTimeout(() => {
      if (host.process.exitCode === null && !host.process.killed) host.process.kill();
    }, 1500).unref();
  }
  async remove(account) {
    if (account.platform !== "googlevoice" && account.platform !== "googlechat") return;
    const host = this.hosts.get(account.id);
    if (host) {
      host.closing = true;
      this.hosts.delete(account.id);
      if (this.activeId === account.id) this.activeId = void 0;
      this.command(host, "close");
      const waitForExit = (timeoutMs) => new Promise((resolveExit) => {
        if (host.process.exitCode !== null) {
          resolveExit(true);
          return;
        }
        const timer = setTimeout(() => {
          host.process.off("exit", onExit);
          resolveExit(false);
        }, timeoutMs);
        const onExit = () => {
          clearTimeout(timer);
          resolveExit(true);
        };
        host.process.once("exit", onExit);
      });
      if (!await waitForExit(3e3) && host.process.exitCode === null && !host.process.killed) {
        host.process.kill();
        await waitForExit(2e3);
      }
    }
    const root = resolve(this.profileRoot(account.platform));
    const target = resolve(this.profileDirectory(account));
    if (dirname(target) !== root) throw new Error("拒绝清除无效的 Google Voice 账号目录。");
    await rm(target, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
  }
  recoverActive() {
    if (!this.activeId) return;
    const host = this.hosts.get(this.activeId);
    if (host) this.command(host, this.boundsCommand(host.visible));
  }
  shutdown() {
    this.shuttingDown = true;
    const hosts = [...this.hosts.values()];
    this.hosts.clear();
    this.activeId = void 0;
    for (const host of hosts) {
      host.closing = true;
      this.command(host, "close");
      setTimeout(() => {
        if (host.process.exitCode === null && !host.process.killed) host.process.kill();
      }, 500).unref();
    }
  }
}
const appPatchSchemaVersion = 1;
const appPatchUpdaterVersion = 1;
const maxPatchManifestBytes = 1024 * 1024;
const maxPatchFileBytes = 100 * 1024 * 1024;
const maxPatchTotalBytes = 512 * 1024 * 1024;
function requiredString(value, name, maxLength = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`Patch manifest field ${name} is invalid.`);
  }
  return value;
}
function decodeBase64(value, name, maxBytes) {
  const encoded = requiredString(value, name, Math.ceil(maxBytes * 1.4) + 16);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`Patch manifest field ${name} is not valid base64.`);
  }
  const decoded = Buffer.from(encoded, "base64");
  if (!decoded.length || decoded.length > maxBytes) {
    throw new Error(`Patch manifest field ${name} exceeds its size limit.`);
  }
  return decoded;
}
function normalizePatchPath(value) {
  const path = requiredString(value, "path", 1024).replaceAll("\\", "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe patch path: ${path}`);
  }
  const allowed = path === "package.json" || path.startsWith("out/") || path.startsWith("build/icons/");
  if (!allowed) throw new Error(`Patch path is outside the allowed application files: ${path}`);
  return path;
}
function validatePatchUrl(value) {
  const url = requiredString(value, "file.url", 2048);
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(url)) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "file:") {
      throw new Error(`Patch file URL must use HTTPS: ${url}`);
    }
  }
  return url;
}
function validatePatchPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Patch payload must be an object.");
  }
  const candidate = value;
  if (candidate.schemaVersion !== appPatchSchemaVersion) throw new Error("Unsupported patch payload schema.");
  if (!Number.isInteger(candidate.minimumUpdaterVersion) || Number(candidate.minimumUpdaterVersion) < 1) {
    throw new Error("Patch minimum updater version is invalid.");
  }
  if (Number(candidate.minimumUpdaterVersion) > appPatchUpdaterVersion) {
    throw new Error("This patch requires a newer patch updater.");
  }
  const patchId = requiredString(candidate.patchId, "patchId", 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(patchId)) throw new Error("Patch ID contains unsupported characters.");
  const targetVersion = requiredString(candidate.targetVersion, "targetVersion", 64);
  const publishedAt = requiredString(candidate.publishedAt, "publishedAt", 64);
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error("Patch publication time is invalid.");
  if (!Array.isArray(candidate.baseVersions) || !candidate.baseVersions.length || candidate.baseVersions.length > 32) {
    throw new Error("Patch base versions are invalid.");
  }
  const baseVersions = candidate.baseVersions.map((item, index) => requiredString(item, `baseVersions[${index}]`, 64));
  if (!Array.isArray(candidate.files) || candidate.files.length > 1e4) throw new Error("Patch file list is invalid.");
  const seenPaths = /* @__PURE__ */ new Set();
  let totalBytes = 0;
  const files = candidate.files.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Patch file ${index} is invalid.`);
    const raw = item;
    const path = normalizePatchPath(raw.path);
    if (seenPaths.has(path)) throw new Error(`Patch path is duplicated: ${path}`);
    seenPaths.add(path);
    const sha256 = requiredString(raw.sha256, `files[${index}].sha256`, 64).toLowerCase();
    if (!/^[a-f\d]{64}$/.test(sha256)) throw new Error(`Patch file hash is invalid: ${path}`);
    const size = Number(raw.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > maxPatchFileBytes) {
      throw new Error(`Patch file size is invalid: ${path}`);
    }
    totalBytes += size;
    if (totalBytes > maxPatchTotalBytes) throw new Error("Patch exceeds the total download size limit.");
    return { path, url: validatePatchUrl(raw.url), sha256, size };
  });
  const remove = candidate.remove === void 0 ? void 0 : (() => {
    if (!Array.isArray(candidate.remove) || candidate.remove.length > 1e4) throw new Error("Patch removal list is invalid.");
    return candidate.remove.map((item) => {
      const path = normalizePatchPath(item);
      if (seenPaths.has(path)) throw new Error(`Patch path cannot be replaced and removed together: ${path}`);
      if (path === "package.json") throw new Error("A patch cannot remove package.json.");
      if (seenPaths.has(`remove:${path}`)) throw new Error(`Patch removal path is duplicated: ${path}`);
      seenPaths.add(`remove:${path}`);
      return path;
    });
  })();
  if (!files.length && !remove?.length) throw new Error("Patch does not contain any changes.");
  const description = candidate.description === void 0 ? void 0 : requiredString(candidate.description, "description", 1e3);
  return {
    schemaVersion: 1,
    minimumUpdaterVersion: Number(candidate.minimumUpdaterVersion),
    patchId,
    baseVersions,
    targetVersion,
    publishedAt,
    description,
    files,
    remove
  };
}
function verifySignedPatchManifest(rawManifest, publicKeyPem) {
  if (Buffer.byteLength(rawManifest, "utf8") > maxPatchManifestBytes) throw new Error("Patch manifest is too large.");
  let envelopeValue;
  try {
    envelopeValue = JSON.parse(rawManifest);
  } catch {
    throw new Error("Patch manifest is not valid JSON.");
  }
  if (!envelopeValue || typeof envelopeValue !== "object" || Array.isArray(envelopeValue)) {
    throw new Error("Patch manifest envelope is invalid.");
  }
  const envelope = envelopeValue;
  if (envelope.schemaVersion !== 1 || envelope.algorithm !== "ed25519") {
    throw new Error("Unsupported patch signature format.");
  }
  const payloadBytes = decodeBase64(envelope.payload, "payload", maxPatchManifestBytes);
  const signatureBytes = decodeBase64(envelope.signature, "signature", 256);
  let publicKey2;
  try {
    publicKey2 = createPublicKey(publicKeyPem);
  } catch {
    throw new Error("Patch verification key is invalid.");
  }
  if (publicKey2.asymmetricKeyType !== "ed25519") throw new Error("Patch verification key must be Ed25519.");
  if (!verify(null, payloadBytes, publicKey2, signatureBytes)) {
    throw new Error("Patch signature verification failed.");
  }
  let payloadValue;
  try {
    payloadValue = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new Error("Signed patch payload is not valid JSON.");
  }
  return validatePatchPayload(payloadValue);
}
function sha256Hex$1(data) {
  return createHash("sha256").update(data).digest("hex");
}
function normalizeApplyPath(value) {
  const path = String(value || "").replaceAll("\\", "/");
  if (!path || path.length > 1024 || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe patch path: ${path}`);
  }
  const allowed = path === "package.json" || path.startsWith("out/") || path.startsWith("build/icons/");
  if (!allowed) throw new Error(`Patch path is outside the allowed application files: ${path}`);
  return path;
}
function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}
function withinRoot$1(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}
async function pathKind(path) {
  try {
    const details = await lstat(path);
    if (details.isFile()) return "file";
    return "directory";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}
async function copyVerified(source, destination, sha256, size) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  const bytes = await readFile(destination);
  if (bytes.length !== size || sha256Hex(bytes) !== sha256) {
    throw new Error(`Patch file changed while being installed: ${destination}`);
  }
}
async function applyPatchInProcess(plan) {
  const applicationRoot = resolve(plan.applicationRoot);
  const stagingFilesRoot = resolve(plan.stagingFilesRoot);
  const backupRoot = resolve(plan.backupRoot);
  const preparedFiles = [];
  const preparedRemovals = [];
  for (const file of plan.files) {
    const path = normalizeApplyPath(file.path);
    const relativeWindows = path.split("/").join(sep);
    const source = resolve(stagingFilesRoot, relativeWindows);
    const target = resolve(applicationRoot, relativeWindows);
    const backup = resolve(backupRoot, relativeWindows);
    if (!withinRoot$1(stagingFilesRoot, source) || !withinRoot$1(applicationRoot, target) || !withinRoot$1(backupRoot, backup)) {
      throw new Error(`Patch file path is outside its allowed root: ${path}`);
    }
    if (await pathKind(source) !== "file") throw new Error(`Verified patch file is missing: ${path}`);
    const bytes = await readFile(source);
    if (bytes.length !== file.size || sha256Hex(bytes) !== file.sha256) {
      throw new Error(`Patch file failed verification immediately before installation: ${path}`);
    }
    preparedFiles.push({ path, source, target, backup, sha256: file.sha256, size: file.size });
  }
  for (const removePath of plan.remove || []) {
    const path = normalizeApplyPath(removePath);
    if (path === "package.json") throw new Error("package.json cannot be removed by a patch.");
    const relativeWindows = path.split("/").join(sep);
    const target = resolve(applicationRoot, relativeWindows);
    const backup = resolve(backupRoot, relativeWindows);
    if (!withinRoot$1(applicationRoot, target) || !withinRoot$1(backupRoot, backup)) {
      throw new Error(`Patch removal path is outside its allowed root: ${path}`);
    }
    preparedRemovals.push({ target, backup });
  }
  const processed = [];
  const temporaryFiles = /* @__PURE__ */ new Set();
  try {
    await mkdir(backupRoot, { recursive: true });
    for (let index = 0; index < preparedFiles.length; index += 1) {
      const file = preparedFiles[index];
      const currentKind = await pathKind(file.target);
      if (currentKind === "directory") throw new Error(`Patch target is unexpectedly a directory: ${file.path}`);
      const existed = currentKind === "file";
      if (existed) {
        await mkdir(dirname(file.backup), { recursive: true });
        await copyFile(file.target, file.backup);
      }
      const temporaryTarget = `${file.target}.bitalks-new-${process.pid}-${Date.now()}-${index}`;
      temporaryFiles.add(temporaryTarget);
      await copyVerified(file.source, temporaryTarget, file.sha256, file.size);
      await rename(temporaryTarget, file.target);
      temporaryFiles.delete(temporaryTarget);
      processed.push({ target: file.target, backup: file.backup, existed });
    }
    for (const removal of preparedRemovals) {
      const currentKind = await pathKind(removal.target);
      if (currentKind === "directory") throw new Error(`Patch removal target is unexpectedly a directory: ${removal.target}`);
      if (currentKind === "missing") continue;
      await mkdir(dirname(removal.backup), { recursive: true });
      await copyFile(removal.target, removal.backup);
      await rm(removal.target, { force: true });
      processed.push({ target: removal.target, backup: removal.backup, existed: true });
    }
    for (const file of preparedFiles) {
      const installed = await readFile(file.target);
      if (installed.length !== file.size || sha256Hex(installed) !== file.sha256) {
        throw new Error(`Installed patch file failed final verification: ${file.path}`);
      }
    }
    for (const removal of preparedRemovals) {
      if (await pathKind(removal.target) !== "missing") {
        throw new Error(`Patch removal failed final verification: ${removal.target}`);
      }
    }
    return { status: "success", message: "Patch files were verified and installed in-process." };
  } catch (error) {
    let rollbackFailed = false;
    for (let index = processed.length - 1; index >= 0; index -= 1) {
      const entry = processed[index];
      try {
        if (entry.existed) {
          const backupBytes = await readFile(entry.backup);
          const temporaryTarget = `${entry.target}.bitalks-rollback-${process.pid}-${Date.now()}-${index}`;
          temporaryFiles.add(temporaryTarget);
          await mkdir(dirname(temporaryTarget), { recursive: true });
          await copyFile(entry.backup, temporaryTarget);
          const restoredBytes = await readFile(temporaryTarget);
          if (!restoredBytes.equals(backupBytes)) throw new Error(`Rollback verification failed: ${entry.target}`);
          await rename(temporaryTarget, entry.target);
          temporaryFiles.delete(temporaryTarget);
        } else {
          await rm(entry.target, { force: true });
        }
      } catch {
        rollbackFailed = true;
      }
    }
    return {
      status: rollbackFailed ? "failed" : "rolled-back",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await Promise.all([...temporaryFiles].map((path) => rm(path, { force: true }).catch(() => void 0)));
  }
}
const fetchTimeoutMs = 6e4;
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function withinRoot(root, target) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`);
}
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}
`, "utf8");
  await rename(temporaryPath, path);
}
async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const code = error?.code;
    if (code === "ENOENT") return void 0;
    throw error;
  }
}
function patchInfo(payload) {
  return {
    patchId: payload.patchId,
    targetVersion: payload.targetVersion,
    publishedAt: payload.publishedAt,
    description: payload.description,
    downloadSize: payload.files.reduce((total, file) => total + file.size, 0)
  };
}
class AppPatchManager {
  constructor(options) {
    this.options = options;
    this.patchesRoot = join(options.dataRoot, "app-patches");
    this.appliedStatePath = join(this.patchesRoot, "applied.json");
    this.applyResultPath = join(this.patchesRoot, "apply-result.json");
  }
  patchesRoot;
  appliedStatePath;
  applyResultPath;
  checkedPayload;
  checkedManifestUrl;
  downloaded;
  activeDownload;
  event(status, message, patch, progress) {
    this.options.emit({ type: "app-patch", status, message, patch, progress });
  }
  channelConfigCandidates() {
    return [
      join(this.options.dataRoot, "patch-channel.json"),
      join(this.options.resourcesPath, "patch-channel.json"),
      join(this.options.applicationRoot, "build", "patch-channel.json")
    ];
  }
  resolveChannel() {
    let config = {};
    let configDirectory = this.options.applicationRoot;
    for (const candidate of this.channelConfigCandidates()) {
      if (!existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8"));
        if (parsed && typeof parsed === "object") {
          config = parsed;
          configDirectory = dirname(candidate);
          break;
        }
      } catch (error) {
        this.options.log("patch channel config ignored", { path: candidate, message: errorMessage(error) });
      }
    }
    const manifestUrl = String(process.env.BI_TALKS_PATCH_MANIFEST_URL || config.manifestUrl || "").trim();
    let publicKeyPem = String(process.env.BI_TALKS_PATCH_PUBLIC_KEY || config.publicKeyPem || "").trim();
    const publicKeyPath = String(process.env.BI_TALKS_PATCH_PUBLIC_KEY_PATH || config.publicKeyPath || "").trim();
    if (!publicKeyPem && publicKeyPath) {
      const resolvedKeyPath = isAbsolute(publicKeyPath) ? publicKeyPath : resolve(configDirectory, publicKeyPath);
      try {
        publicKeyPem = readFileSync(resolvedKeyPath, "utf8").trim();
      } catch (error) {
        this.options.log("patch public key could not be read", { path: resolvedKeyPath, message: errorMessage(error) });
      }
    }
    if (!manifestUrl || !publicKeyPem) return void 0;
    let parsedManifestUrl;
    try {
      parsedManifestUrl = new URL(manifestUrl);
    } catch {
      throw new Error("在线补丁地址无效。");
    }
    if (this.options.packaged && parsedManifestUrl.protocol !== "https:") {
      throw new Error("正式版本的在线补丁地址必须使用 HTTPS。");
    }
    if (!this.options.packaged && !["https:", "file:"].includes(parsedManifestUrl.protocol)) {
      throw new Error("补丁地址必须使用 HTTPS；开发环境也可以使用 file://。");
    }
    return { manifestUrl: parsedManifestUrl.toString(), publicKeyPem };
  }
  async fetchBytes(urlText, maximumBytes, onProgress) {
    const url = new URL(urlText);
    if (url.protocol === "file:") {
      if (this.options.packaged) throw new Error("正式版本不能从本地文件地址安装补丁。");
      const data = await readFile(fileURLToPath(url));
      if (data.length > maximumBytes) throw new Error("补丁文件超过允许的大小。");
      onProgress?.(data.length);
      return data;
    }
    if (url.protocol !== "https:") throw new Error("补丁下载仅允许 HTTPS。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
        headers: { "cache-control": "no-cache", "user-agent": `Bi-talks/${this.options.currentVersion} patch-updater` }
      });
      if (!response.ok) throw new Error(`补丁服务器返回 HTTP ${response.status}。`);
      const finalUrl = new URL(response.url || url.toString());
      if (finalUrl.protocol !== "https:") throw new Error("补丁下载被重定向到不安全地址。");
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error("补丁文件超过允许的大小。");
      if (!response.body) throw new Error("补丁服务器没有返回内容。");
      const chunks = [];
      let received = 0;
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        received += value.length;
        if (received > maximumBytes) {
          await reader.cancel();
          throw new Error("补丁文件超过允许的大小。");
        }
        chunks.push(value);
        onProgress?.(received);
      }
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), received);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("补丁服务器连接超时。");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async appliedPatchIds() {
    try {
      const value = await readJsonIfPresent(this.appliedStatePath);
      const ids = value && typeof value === "object" && Array.isArray(value.patchIds) ? value.patchIds.filter((item) => typeof item === "string") : [];
      return new Set(ids);
    } catch (error) {
      this.options.log("patch applied state ignored", errorMessage(error));
      return /* @__PURE__ */ new Set();
    }
  }
  async rememberAppliedPatch(patchId) {
    const patchIds = await this.appliedPatchIds();
    patchIds.add(patchId);
    await writeJsonAtomic(this.appliedStatePath, {
      schemaVersion: 1,
      patchIds: [...patchIds].slice(-100),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  async consumeApplyResult() {
    let result;
    try {
      result = await readJsonIfPresent(this.applyResultPath);
      if (!result) return;
      await rm(this.applyResultPath, { force: true });
    } catch (error) {
      this.options.log("patch apply result could not be read", errorMessage(error));
      return;
    }
    const patchId = typeof result.patchId === "string" ? result.patchId : void 0;
    if (result.status === "success" && patchId) {
      await this.rememberAppliedPatch(patchId);
      const message2 = "更新已完成。";
      this.options.log("patch apply completed", result);
      this.event("complete", message2);
      return;
    }
    const message = result.status === "rolled-back" ? "在线补丁安装失败，原文件已自动恢复。" : "在线补丁安装失败，现有版本未被替换。";
    this.options.log("patch apply failed", result);
    this.event("error", result.message ? `${message} ${result.message}` : message);
  }
  async checkForUpdate() {
    this.event("checking", "正在检查在线补丁…");
    try {
      const channel = this.resolveChannel();
      if (!channel) {
        this.checkedPayload = void 0;
        this.checkedManifestUrl = void 0;
        const message2 = "在线补丁源尚未配置。";
        this.event("error", message2);
        return {
          configured: false,
          currentVersion: this.options.currentVersion,
          available: false,
          ready: false,
          message: message2
        };
      }
      const manifestBytes = await this.fetchBytes(channel.manifestUrl, maxPatchManifestBytes);
      const payload = verifySignedPatchManifest(manifestBytes.toString("utf8"), channel.publicKeyPem);
      const info = patchInfo(payload);
      const applied = await this.appliedPatchIds();
      if (applied.has(payload.patchId)) {
        this.checkedPayload = void 0;
        this.checkedManifestUrl = void 0;
        const message2 = "暂无可用更新，当前已是最新版本！";
        this.event("up-to-date", message2, info);
        return { configured: true, currentVersion: this.options.currentVersion, available: false, ready: false, message: message2, patch: info };
      }
      if (!payload.baseVersions.includes(this.options.currentVersion)) {
        this.checkedPayload = void 0;
        this.checkedManifestUrl = void 0;
        const message2 = "暂无可用更新，当前已是最新版本！";
        this.event("up-to-date", message2, info);
        return { configured: true, currentVersion: this.options.currentVersion, available: false, ready: false, message: message2, patch: info };
      }
      this.checkedPayload = payload;
      this.checkedManifestUrl = channel.manifestUrl;
      const ready = this.downloaded?.payload.patchId === payload.patchId;
      const message = ready ? "补丁已下载，可以安装并重启。" : `发现在线补丁 ${payload.patchId}。`;
      this.event(ready ? "ready" : "available", message, info, ready ? 100 : void 0);
      return { configured: true, currentVersion: this.options.currentVersion, available: true, ready, message, patch: info };
    } catch (error) {
      this.checkedPayload = void 0;
      this.checkedManifestUrl = void 0;
      const message = `检查在线补丁失败：${errorMessage(error)}`;
      this.options.log("patch check failed", errorMessage(error));
      this.event("error", message);
      return { configured: true, currentVersion: this.options.currentVersion, available: false, ready: false, message };
    }
  }
  async download() {
    if (this.activeDownload) return this.activeDownload;
    const run = this.downloadInternal();
    this.activeDownload = run;
    try {
      return await run;
    } finally {
      if (this.activeDownload === run) this.activeDownload = void 0;
    }
  }
  async downloadInternal() {
    let payload = this.checkedPayload;
    let manifestUrl = this.checkedManifestUrl;
    if (!payload || !manifestUrl) {
      const checked = await this.checkForUpdate();
      if (!checked.available || !this.checkedPayload || !this.checkedManifestUrl) return { ...checked, ready: false };
      payload = this.checkedPayload;
      manifestUrl = this.checkedManifestUrl;
    }
    const info = patchInfo(payload);
    const stagingRoot = join(this.patchesRoot, "staging", payload.patchId);
    const stagingFilesRoot = join(stagingRoot, "files");
    if (!withinRoot(this.patchesRoot, stagingRoot)) throw new Error("补丁暂存目录无效。");
    try {
      await rm(stagingRoot, { recursive: true, force: true });
      await mkdir(stagingFilesRoot, { recursive: true });
      const totalBytes = Math.max(1, info.downloadSize);
      let completedBytes = 0;
      for (const file of payload.files) {
        const resolvedUrl = new URL(file.url, manifestUrl).toString();
        let currentReceived = 0;
        const bytes = await this.fetchBytes(resolvedUrl, Math.min(maxPatchFileBytes, file.size + 1), (received) => {
          currentReceived = received;
          const progress = Math.min(99, (completedBytes + Math.min(received, file.size)) / totalBytes * 100);
          this.event("downloading", `正在下载在线补丁 ${Math.round(progress)}%…`, info, progress);
        });
        if (bytes.length !== file.size) throw new Error(`补丁文件大小不匹配：${file.path}`);
        if (sha256Hex$1(bytes) !== file.sha256) throw new Error(`补丁文件校验失败：${file.path}`);
        const normalizedPath = normalizePatchPath(file.path);
        const destination = join(stagingFilesRoot, ...normalizedPath.split("/"));
        if (!withinRoot(stagingFilesRoot, destination)) throw new Error(`补丁文件路径无效：${file.path}`);
        await mkdir(dirname(destination), { recursive: true });
        const temporaryPath = `${destination}.tmp`;
        await writeFile(temporaryPath, bytes);
        await rename(temporaryPath, destination);
        completedBytes += currentReceived;
      }
      await writeJsonAtomic(join(stagingRoot, "verified-payload.json"), payload);
      this.downloaded = { payload, info, stagingFilesRoot };
      const message = "补丁已下载并通过签名与 SHA-256 校验，可以安装并重启。";
      this.event("ready", message, info, 100);
      return { configured: true, currentVersion: this.options.currentVersion, available: true, ready: true, message, patch: info };
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => void 0);
      const message = `下载在线补丁失败：${errorMessage(error)}`;
      this.options.log("patch download failed", errorMessage(error));
      this.event("error", message, info);
      return { configured: true, currentVersion: this.options.currentVersion, available: true, ready: false, message, patch: info };
    }
  }
  async applyDownloaded() {
    if (!this.options.packaged) return { scheduled: false, message: "开发模式不会替换源码；请在安装版中测试在线补丁。" };
    const downloaded = this.downloaded;
    if (!downloaded) return { scheduled: false, message: "请先下载并校验补丁。" };
    try {
      for (const file of downloaded.payload.files) {
        const source = join(downloaded.stagingFilesRoot, ...normalizePatchPath(file.path).split("/"));
        if (!withinRoot(downloaded.stagingFilesRoot, source)) throw new Error(`补丁文件路径无效：${file.path}`);
        const bytes = await readFile(source);
        if (bytes.length !== file.size || sha256Hex$1(bytes) !== file.sha256) throw new Error(`补丁文件二次校验失败：${file.path}`);
      }
      const attemptId = `${downloaded.payload.patchId}-${Date.now()}`;
      const backupRoot = join(this.patchesRoot, "backups", attemptId);
      const planPath = join(this.patchesRoot, `apply-${attemptId}.json`);
      if (!withinRoot(this.patchesRoot, backupRoot) || !withinRoot(this.patchesRoot, planPath)) throw new Error("补丁安装目录无效。");
      await rm(this.applyResultPath, { force: true });
      await writeJsonAtomic(planPath, {
        schemaVersion: 1,
        patchId: downloaded.payload.patchId,
        applicationRoot: this.options.applicationRoot,
        stagingFilesRoot: downloaded.stagingFilesRoot,
        backupRoot,
        executablePath: this.options.executablePath,
        workingDirectory: dirname(this.options.executablePath),
        resultPath: this.applyResultPath,
        files: downloaded.payload.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
        remove: downloaded.payload.remove || []
      });
      const outcome = await applyPatchInProcess({
        applicationRoot: this.options.applicationRoot,
        stagingFilesRoot: downloaded.stagingFilesRoot,
        backupRoot,
        files: downloaded.payload.files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })),
        remove: downloaded.payload.remove || []
      });
      await writeJsonAtomic(this.applyResultPath, {
        schemaVersion: 1,
        patchId: downloaded.payload.patchId,
        status: outcome.status,
        message: outcome.message,
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (outcome.status !== "success") {
        const message2 = outcome.status === "rolled-back" ? `在线补丁安装失败，原文件已自动恢复。${outcome.message ? ` ${outcome.message}` : ""}` : `在线补丁安装失败，部分文件可能无法恢复。${outcome.message ? ` ${outcome.message}` : ""}`;
        this.options.log("patch in-process apply failed", { patchId: downloaded.payload.patchId, outcome, planPath });
        this.event("error", message2, downloaded.info);
        return { scheduled: false, message: message2 };
      }
      const message = "补丁已完成备份、替换和校验，软件正在自动重启。";
      this.options.log("patch apply completed in-process", { patchId: downloaded.payload.patchId, planPath, backupRoot });
      this.event("applying", message, downloaded.info, 100);
      setTimeout(this.options.quitForApply, 250);
      return { scheduled: true, message };
    } catch (error) {
      const message = `无法安装在线补丁：${errorMessage(error)}`;
      this.options.log("patch apply failed before restart", errorMessage(error));
      this.event("error", message, downloaded.info);
      return { scheduled: false, message };
    }
  }
}
const minimumVisiblePixels = 80;
function finiteInteger(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : void 0;
}
function parseWindowState(value) {
  if (!value || typeof value !== "object") return void 0;
  const candidate = value;
  if (candidate.schemaVersion !== 1 || !candidate.bounds || typeof candidate.bounds !== "object") return void 0;
  const rawBounds = candidate.bounds;
  const x = finiteInteger(rawBounds.x);
  const y = finiteInteger(rawBounds.y);
  const width = finiteInteger(rawBounds.width);
  const height = finiteInteger(rawBounds.height);
  if (x === void 0 || y === void 0 || width === void 0 || height === void 0 || width <= 0 || height <= 0) return void 0;
  return {
    schemaVersion: 1,
    bounds: { x, y, width, height },
    maximized: candidate.maximized === true
  };
}
function intersection(left, right) {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return { width, height, area: width * height };
}
function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
function restoreVisibleBounds(saved, workAreas, primaryWorkArea, minimumWidth = 980, minimumHeight = 640) {
  const areas = workAreas.length ? workAreas : [primaryWorkArea];
  const ranked = areas.map((area2) => ({ area: area2, intersection: intersection(saved, area2) })).sort((left, right) => right.intersection.area - left.intersection.area);
  const best = ranked[0];
  const hasVisibleCorner = best && best.intersection.width >= minimumVisiblePixels && best.intersection.height >= minimumVisiblePixels;
  const area = hasVisibleCorner ? best.area : primaryWorkArea;
  const width = area.width >= minimumWidth ? Math.min(Math.max(saved.width, minimumWidth), area.width) : minimumWidth;
  const height = area.height >= minimumHeight ? Math.min(Math.max(saved.height, minimumHeight), area.height) : minimumHeight;
  if (!hasVisibleCorner) {
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height
    };
  }
  return {
    x: area.width >= width ? clamp(saved.x, area.x, area.x + area.width - width) : area.x,
    y: area.height >= height ? clamp(saved.y, area.y, area.y + area.height - height) : area.y,
    width,
    height
  };
}
const appDisplayName = "Bi-Talks";
app.setName(appDisplayName);
function isAccountHidden(account) {
  return (account.platform === "telegram" || account.platform === "whatsapp") && account.hidden === true;
}
const portableRoot = app.isPackaged ? dirname(process.execPath) : app.getAppPath();
const portableDataRoot = join(portableRoot, "portable-data");
const defaultRuntimeRoot = join(portableDataRoot, "browser-runtime-v2");
const runtimeMigrationPath = join(portableDataRoot, "pending-runtime-migration.json");
function ensureRuntimeDirectories(root) {
  for (const directory of ["session-data", "cache", "temp", "logs", "crash-dumps"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
}
const localRuntimeRoot = defaultRuntimeRoot;
try {
  mkdirSync(portableDataRoot, { recursive: true });
  ensureRuntimeDirectories(localRuntimeRoot);
  const probe = join(localRuntimeRoot, `startup-write-check-${randomUUID()}.tmp`);
  writeFileSync(probe, "", { flag: "wx" });
  rmSync(probe);
} catch (error) {
  dialog.showErrorBox(
    "Bi-Talks 无法启动",
    `无法创建或写入应用数据目录：
${portableDataRoot}

请将整个程序文件夹（包括 portable-data）移动到当前用户有写入权限的位置后重试。

${error instanceof Error ? error.message : String(error)}`
  );
  app.exit(1);
  throw error;
}
try {
  rmSync(runtimeMigrationPath, { force: true });
} catch {
}
const localLogsRoot = join(localRuntimeRoot, "logs");
app.setPath("userData", portableDataRoot);
app.setPath("logs", localLogsRoot);
const appUserModelId = app.isPackaged ? "com.local.bitalks.windowsdesktop" : "com.local.bitalks.dev";
if (process.platform === "win32") app.setAppUserModelId(appUserModelId);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
let mainWindow;
let tray;
let workspaceNoticeOverlay;
let workspaceNoticeMessage;
let workspaceNoticeProgress;
let workspaceNoticeBounds;
let workspaceNoticeRenderedMessage;
let workspaceNoticeRenderedProgress;
let workspaceNoticeRequestId = 0;
let workspaceNoticeDismissTimer;
const store = new StateStore();
let userAccount;
let workspaceUnlocked = false;
let workspaceWasStopped = false;
let workspaceGeneration = 0;
let translator;
let webViews;
let signal;
let googleVoice;
let appPatches;
let activeSignalWindow;
let selectedSignalAccountId;
function authenticatedHandle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    const fromMain = !!mainWindow && event.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame;
    const fromService = ["translate:text", "translate:stream", "translate:cancel", "whatsapp:send-translated", "whatsapp:translation-cache", "whatsapp:translation-batch"].includes(channel) && webViews?.ownsContents(event.sender) && event.senderFrame === event.sender.mainFrame;
    if (!fromMain && !fromService) throw new Error("Unauthorized IPC sender");
    if (!channel.startsWith("user-account:") && channel !== "window:confirm-close" && (!workspaceUnlocked || !userAccount?.isAuthenticated())) throw new Error("请先登录 Bi-Talks 账号。");
    return listener(event, ...args);
  });
}
let signalSelectionGeneration = 0;
let signalVisibilityIpcQueue = Promise.resolve();
let shuttingDown = false;
let translationHistoryFlushStarted = false;
let closeApproved = false;
let foregroundRecoveryTimer;
let signalLifecycleTimer;
let signalWindowSyncTimer;
let deferredSignalHideSweepTimer;
const signalSuspendReassertTimers = /* @__PURE__ */ new Set();
let workspaceTaskbarPreviewTimer;
let taskbarBadgeKeepAliveTimer;
let mainWindowPresentationTimer;
let mainWindowStateSaveTimer;
let accountAutostartPromise;
let signalDesktopUpdateFlow;
let signalSuspendedWithMainWindow = false;
let signalMinimizedWithOwner = false;
let pendingSignalRecovery = false;
let pendingOwnedSignalRestore = false;
let mainWindowPresented = false;
let mainWindowPlacementRestored = false;
let workspaceTaskbarPreviewInFlight = false;
let workspaceTaskbarPreviewReadyAccountId;
let workspaceTaskbarPreviewSuspendedUntil = 0;
const unreadCounts = /* @__PURE__ */ new Map();
const accountNotices = /* @__PURE__ */ new Map();
const lastUnreadNotice = /* @__PURE__ */ new Map();
const unreadBaselineUntil = /* @__PURE__ */ new Map();
const recentUnreadDrops = /* @__PURE__ */ new Map();
const pendingUnreadDecreases = /* @__PURE__ */ new Map();
const taskbarBadgeImages = /* @__PURE__ */ new Map();
let taskbarBadgeRefreshTimer;
let unreadPersistenceTimer;
let lastTaskbarUnreadTotal = -1;
const trustedUnreadDecreaseStabilityMs = 100;
const backgroundUnreadDecreaseStabilityMs = 1500;
const unreadStatePath = join(localRuntimeRoot, "unread-state.json");
const mainWindowStatePath = join(portableDataRoot, "window-state.json");
function loadMainWindowState() {
  if (!existsSync(mainWindowStatePath)) return void 0;
  try {
    const saved = parseWindowState(JSON.parse(readFileSync(mainWindowStatePath, "utf8")));
    if (!saved) throw new Error("Window state is malformed.");
    const displays = screen.getAllDisplays();
    const primaryWorkArea = screen.getPrimaryDisplay().workArea;
    return {
      ...saved,
      bounds: restoreVisibleBounds(saved.bounds, displays.map((display) => display.workArea), primaryWorkArea)
    };
  } catch (error) {
    runtimeLog("main window state restore skipped", error instanceof Error ? error.message : String(error));
    return void 0;
  }
}
function persistMainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const state = {
      schemaVersion: 1,
      bounds: mainWindow.getNormalBounds(),
      maximized: mainWindow.isMaximized()
    };
    const temporaryPath = `${mainWindowStatePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}
`, "utf8");
    try {
      renameSync(temporaryPath, mainWindowStatePath);
    } catch {
      rmSync(mainWindowStatePath, { force: true });
      renameSync(temporaryPath, mainWindowStatePath);
    }
  } catch (error) {
    runtimeLog("main window state save failed", error instanceof Error ? error.message : String(error));
  }
}
function scheduleMainWindowStateSave() {
  if (mainWindowStateSaveTimer) clearTimeout(mainWindowStateSaveTimer);
  mainWindowStateSaveTimer = setTimeout(() => {
    mainWindowStateSaveTimer = void 0;
    persistMainWindowState();
  }, 400);
}
const taskbarDigitGlyphs = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"]
};
function pngCrc32(data) {
  let crc = 4294967295;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  return (crc ^ 4294967295) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(pngCrc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, footer]);
}
function taskbarBadgePng(label) {
  if (!taskbarBadgePng.atlas) taskbarBadgePng.atlas = JSON.parse(readFileSync(join(app.getAppPath(), "build/icons/taskbar-badges.json"), "utf8"));
  return Buffer.from(taskbarBadgePng.atlas[String(Math.max(1, Math.min(999, Number(label) || 1)))], "base64");
}
function loadPersistedUnreadCounts() {
  if (!existsSync(unreadStatePath)) return;
  try {
    const raw = JSON.parse(readFileSync(unreadStatePath, "utf8"));
    const accountIds = new Set(store.get().accounts.map((account) => account.id));
    for (const [accountId, value] of Object.entries(raw)) {
      const count = Number(value);
      if (accountIds.has(accountId) && Number.isFinite(count) && count > 0) {
        unreadCounts.set(accountId, Math.min(999, Math.round(count)));
        unreadBaselineUntil.set(accountId, Date.now() + 15e3);
      }
    }
  } catch (error) {
    runtimeLog("persisted unread state could not be loaded", error instanceof Error ? error.message : String(error));
  }
}
function persistUnreadCounts() {
  if (unreadPersistenceTimer) {
    clearTimeout(unreadPersistenceTimer);
    unreadPersistenceTimer = void 0;
  }
  try {
    const accountIds = new Set(store.get().accounts.map((account) => account.id));
    const snapshot = Object.fromEntries([...unreadCounts.entries()].filter(([accountId, count]) => accountIds.has(accountId) && count > 0));
    const temporaryPath = `${unreadStatePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}
`, "utf8");
    try {
      rmSync(unreadStatePath, { force: true });
    } catch {
    }
    renameSync(temporaryPath, unreadStatePath);
  } catch (error) {
    runtimeLog("persisted unread state could not be saved", error instanceof Error ? error.message : String(error));
  }
}
function scheduleUnreadPersistence() {
  if (unreadPersistenceTimer) clearTimeout(unreadPersistenceTimer);
  unreadPersistenceTimer = setTimeout(persistUnreadCounts, 120);
}
function updateAppUnreadBadge(force = false) {
  const accountIds = new Set(store.get().accounts.filter((account) => !isAccountHidden(account)).map((account) => account.id));
  const total = Math.min(999, [...unreadCounts.entries()].reduce(
    (sum, [accountId, count]) => sum + (accountIds.has(accountId) ? count : 0),
    0
  ));
  const changed = total !== lastTaskbarUnreadTotal;
  if (!force && !changed) return;
  if (process.platform === "win32") {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (total <= 0) {
      mainWindow.setOverlayIcon(null, "");
      lastTaskbarUnreadTotal = total;
      if (changed) runtimeLog("taskbar unread badge updated", { total: 0 });
      return;
    }
    const label = String(total);
    let image = taskbarBadgeImages.get(label);
    if (!image) {
      image = nativeImage.createFromBuffer(taskbarBadgePng(label));
      if (!image.isEmpty()) taskbarBadgeImages.set(label, image);
    }
    if (!image || image.isEmpty()) {
      runtimeLog("taskbar unread badge image creation failed", { total });
      return;
    }
    mainWindow.setOverlayIcon(image, `${total} 条未读消息`);
    lastTaskbarUnreadTotal = total;
    if (changed) runtimeLog("taskbar unread badge updated", { total });
    return;
  }
  try {
    app.setBadgeCount(total);
    lastTaskbarUnreadTotal = total;
  } catch (error) {
    runtimeLog("taskbar badge update failed", error instanceof Error ? error.message : String(error));
  }
}
function refreshTaskbarUnreadBadge() {
  updateAppUnreadBadge(true);
  if (taskbarBadgeRefreshTimer) clearTimeout(taskbarBadgeRefreshTimer);
  taskbarBadgeRefreshTimer = setTimeout(() => {
    taskbarBadgeRefreshTimer = void 0;
    updateAppUnreadBadge(true);
  }, 250);
}
function keepMinimizedTaskbarUnreadBadgeAlive() {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed() || !mainWindow.isMinimized()) return;
  if (lastTaskbarUnreadTotal <= 0) return;
  updateAppUnreadBadge(true);
}
const notificationPreviews = /* @__PURE__ */ new Map();
function showUnifiedMessageNotices(event, previous) {
  // Message popups are supplied by each application's native notification channel.
}

function applyUnreadEvent(event) {
  const count = event.count;
  const previous = unreadCounts.get(event.accountId);
  showUnifiedMessageNotices(event, previous);
  unreadCounts.set(event.accountId, count);
  scheduleUnreadPersistence();
  if (previous !== count) runtimeLog("unread count changed", { accountId: event.accountId, previous: previous ?? null, count });
  updateAppUnreadBadge();
  if (previous === void 0) {
    unreadBaselineUntil.set(event.accountId, Date.now() + 8e3);
    return;
  }
  if (count === 0) {
    accountNotices.get(event.accountId)?.close();
    accountNotices.delete(event.accountId);
  }
  if (count < previous) {
    recentUnreadDrops.set(event.accountId, { at: Date.now(), from: previous });
    return;
  }
  if (count === previous || Date.now() < (unreadBaselineUntil.get(event.accountId) || 0)) return;
  const recentDrop = recentUnreadDrops.get(event.accountId);
  if (recentDrop && Date.now() - recentDrop.at < 5e3 && count <= recentDrop.from) return;
  recentUnreadDrops.delete(event.accountId);

}
function cancelPendingUnreadDecrease(accountId) {
  const pending = pendingUnreadDecreases.get(accountId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingUnreadDecreases.delete(accountId);
}
function clearAccountUnreadState(accountId) {
  cancelPendingUnreadDecrease(accountId);
  unreadBaselineUntil.delete(accountId);
  recentUnreadDrops.delete(accountId);
  unreadCounts.delete(accountId);
  accountNotices.get(accountId)?.close();
  accountNotices.delete(accountId);
  lastUnreadNotice.delete(accountId);
  scheduleUnreadPersistence();
  updateAppUnreadBadge();
  mainWindow?.webContents.send("app:event", { type: "unread", accountId, count: 0 });
}
function handleUnreadEvent(event, forceDecrease = false) {
  if (!Number.isFinite(event.count) || !store.get().accounts.some((account) => account.id === event.accountId)) return false;
  const normalized = {
    ...event,
    count: mergeUnreadSample(pendingUnreadDecreases.get(event.accountId)?.count ?? unreadCounts.get(event.accountId), event)
  };
  const previous = unreadCounts.get(normalized.accountId);
  if (!forceDecrease && previous !== void 0 && normalized.count < previous) {
    const stabilityMs = normalized.trustedDecrease ? trustedUnreadDecreaseStabilityMs : backgroundUnreadDecreaseStabilityMs;
    const pending = pendingUnreadDecreases.get(normalized.accountId);
    if (pending?.count === normalized.count && pending.stabilityMs <= stabilityMs) return false;
    cancelPendingUnreadDecrease(normalized.accountId);
    const timer = setTimeout(() => {
      const latestPending = pendingUnreadDecreases.get(normalized.accountId);
      if (!latestPending || latestPending.count !== normalized.count) return;
      pendingUnreadDecreases.delete(normalized.accountId);
      const latestCount = unreadCounts.get(normalized.accountId);
      if (latestCount === void 0 || normalized.count >= latestCount) return;
      runtimeLog("stable unread decrease committed", {
        accountId: normalized.accountId,
        previous: latestCount,
        count: normalized.count
      });
      applyUnreadEvent(normalized);
      mainWindow?.webContents.send("app:event", normalized);
    }, stabilityMs);
    pendingUnreadDecreases.set(normalized.accountId, { count: normalized.count, stabilityMs, timer });
    runtimeLog("unread decrease awaiting stability", {
      accountId: normalized.accountId,
      previous,
      count: normalized.count,
      stabilityMs,
      trustedDecrease: normalized.trustedDecrease === true
    });
    return false;
  }
  cancelPendingUnreadDecrease(normalized.accountId);
  applyUnreadEvent(normalized);
  return true;
}
function emit(event, forceUnreadDecrease = false) {
  if (!workspaceUnlocked) return;
  if (event.type === "unread" && event.preview?.notificationOnly) { showUnifiedMessageNotices(event, unreadCounts.get(event.accountId)); return; }
  if (event.type === "unread" && event.preview) notificationPreviews.set(event.accountId, { at: Date.now(), preview: event.preview });
  if (event.type === "unread" && !handleUnreadEvent(event, forceUnreadDecrease)) return;
  mainWindow?.webContents.send("app:event", event.type === "unread" ? { ...event, count: unreadCounts.get(event.accountId) || 0 } : event);
}
function appIconPath() {
  const iconFile = "icon.ico";
  const candidates = [
    join(app.getAppPath(), "build", "icons", iconFile),
    join(process.cwd(), "build", "icons", iconFile),
    join(__dirname, "../../build/icons", iconFile)
  ];
  return candidates.find((candidate) => existsSync(candidate));
}
function appIconImage() {
  const iconDirectories = [
    join(app.getAppPath(), "build", "icons"),
    join(process.cwd(), "build", "icons"),
    join(__dirname, "../../build/icons")
  ];
  const theme = resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors);
  const iconFiles = [theme === "dark" ? "app-dark.png" : "app-light.png", "app.png", "icon.png", "icon.ico"];
  for (const directory of iconDirectories) {
    for (const iconFile of iconFiles) {
      const candidate = join(directory, iconFile);
      if (!existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image;
    }
  }
  return void 0;
}
function showMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow().catch((error) => runtimeLog("create window from tray failed", error instanceof Error ? error.message : String(error)));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  presentMainWindow("tray");
}
function ensureSystemTray() {
  if (tray && !tray.isDestroyed()) return;
  const icon = appIconImage();
  if (!icon || icon.isEmpty()) {
    runtimeLog("system tray icon unavailable");
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip(appDisplayName);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `打开 ${appDisplayName}`, click: showMainWindowFromTray },
    { type: "separator" },
    { label: `退出 ${appDisplayName}`, click: () => app.quit() }
  ]));
  tray.on("click", showMainWindowFromTray);
  runtimeLog("system tray ready", icon.getSize());
}
function runtimeLog(message, details) {
  const suffix = details === void 0 ? "" : ` ${typeof details === "string" ? details : JSON.stringify(details)}`;
  void appendRuntimeLog(join(localLogsRoot, "runtime.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}${suffix}
`).catch((error) => {
    console.warn("Runtime log write failed.", error);
  });
}
function waitForBackgroundStartup(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function orderedAccountsForAutostart() {
  const state = store.get();
  const byId = new Map(state.accounts.map((account) => [account.id, account]));
  const ordered = state.platformOrder.flatMap(
    (platform) => (state.accountOrder[platform] || []).map((id) => byId.get(id)).filter(Boolean)
  );
  const missing = state.accounts.filter((account) => !ordered.some((item) => item.id === account.id));
  return [...ordered, ...missing];
}
async function autostartAllAccounts(){
 if(!workspaceUnlocked||shuttingDown)return;if(accountAutostartPromise)return accountAutostartPromise;
 const generation=workspaceGeneration,current=()=>workspaceUnlocked&&!shuttingDown&&generation===workspaceGeneration;
 const pending=globalThis.__biAccountStartupJobs||=new Map();
 accountAutostartPromise=(async()=>{
  await waitForBackgroundStartup(250);if(!current())return;
  const state=store.get(),accounts=orderedAccountsForAutostart(),selected=accounts.find(a=>a.id===state.selectedAccountId);
  const report=(account,status)=>{if(current()&&store.get().accounts.some(a=>a.id===account.id))emit({type:'connection',accountId:account.id,status});};
  const start=async account=>{
   if(!current())return;
   if(account.platform==='signal'&&signal.runningAccountIds().includes(account.id))return;
   if(webViews.isWebPlatform(account.platform)){const view=webViews.views.get(account.id);if(view&&!view.webContents.isDestroyed())return;}
   for(let attempt=0;attempt<2&&current();attempt++){
    report(account,attempt?'正在重试启动…':'正在启动…');let job=pending.get(account.id);
    if(!job){job=(async()=>{if(webViews.isWebPlatform(account.platform))await webViews.start(account);else if(account.platform==='signal')await signal.start(account);else if(account.platform==='googlevoice'||account.platform==='googlechat')await googleVoice.start(account);})().finally(()=>{if(pending.get(account.id)===job)pending.delete(account.id);});pending.set(account.id,job);job.catch(()=>{});}
    let timer;try{
     await Promise.race([job,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BACKGROUND_START_TIMEOUT')),35000);})]);
     // Loading a workspace does not prove the remote account is logged in.
     if(current())runtimeLog('background account prepared',{accountId:account.id,platform:account.platform,attempt:attempt+1});return;
    }catch(e){const message=String(e.message||e);runtimeLog('background account start failed',{accountId:account.id,platform:account.platform,attempt:attempt+1,message});if(message==='BACKGROUND_START_TIMEOUT'){report(account,'后台启动较慢，可点击账号查看');return;}if(/captcha|verification|challenge|验证|登录|sign.?in/i.test(message)){report(account,'需要登录或验证，请点击账号');return;}if(attempt===1){report(account,'启动失败，请点击账号重试');return;}await waitForBackgroundStartup(1500);
    }finally{clearTimeout(timer);}
   }
  };
  const selectedTask=selected?start(selected):Promise.resolve();
  await waitForBackgroundStartup(200);
  const others=accounts.filter(a=>a.id!==selected?.id),signalAccounts=others.filter(a=>a.platform==='signal'),otherAccounts=others.filter(a=>a.platform!=='signal');
  try{await signal.prepareBackgroundStarts(signalAccounts);}catch(e){runtimeLog('background Signal preparation failed',String(e));}
  const run=async(queue,count)=>{let index=0;await Promise.all(Array.from({length:Math.min(count,queue.length)},async()=>{while(index<queue.length&&current()){const account=queue[index++];await start(account);await waitForBackgroundStartup(250);}}));};
  await Promise.all([selectedTask,run(signalAccounts,2),run(otherAccounts,2)]);
  runtimeLog('background account autostart complete',{total:accounts.length});
 })().finally(()=>{accountAutostartPromise=undefined;if(workspaceUnlocked&&generation!==workspaceGeneration)void autostartAllAccounts();});
 return accountAutostartPromise;
}

function nativeWindowHandle(window2) {
  const handle = window2.getNativeWindowHandle();
  return process.arch === "ia32" ? BigInt(handle.readUInt32LE(0)) : handle.readBigUInt64LE(0);
}
function toScreenBounds(bounds) {
  if (!mainWindow) return bounds;
  const content = mainWindow.getContentBounds();
  return {
    x: content.x + Math.round(bounds.x),
    y: content.y + Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  };
}
function escapeNoticeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character] || character);
}
function workspaceNoticeDocument(message, progress) {
  const safeMessage = escapeNoticeHtml(message);
  const hasProgress = typeof progress === "number";
  const safeProgress = hasProgress ? Math.min(100, Math.max(0, progress)) : 0;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:"Segoe UI",system-ui,sans-serif}
    body{padding:0}.notice{height:100%;display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid #ff596480;border-radius:14px;background:linear-gradient(135deg,#4a1218dd,#210e15d9);color:#fff1f2;font-size:13px;line-height:1.35;box-shadow:0 18px 50px #000b,0 0 0 1px #ffffff12 inset;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
    .notice:before{content:"";width:9px;height:9px;border-radius:50%;background:#ff5b68;box-shadow:0 0 0 4px #ff59642b,0 0 15px #ff5964aa;flex:none}.content{min-width:0;flex:1}.summary{display:flex;align-items:center;gap:8px}.message{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 1px #0008}.percent{flex:none;color:#ffd4d8;font-variant-numeric:tabular-nums;font-weight:650}.track{display:${hasProgress ? "block" : "none"};height:7px;margin-top:8px;overflow:hidden;border-radius:999px;background:#0e06097a;border:1px solid #ffffff12;box-shadow:inset 0 1px 4px #0008}.fill{height:100%;width:${safeProgress}%;border-radius:inherit;background:linear-gradient(90deg,#ff4453,#ff8b93);box-shadow:0 0 12px #ff5964cc;transition:width .2s ease}.close{display:grid;place-items:center;flex:none;width:27px;height:27px;border:1px solid #ffffff22;border-radius:9px;background:#ffffff12;color:#ffdbe0;font-size:18px;line-height:1;text-decoration:none;cursor:pointer}.close:hover{background:#ff596440;border-color:#ff8992;color:#fff}
  </style></head><body><div class="notice"><div class="content"><div class="summary"><span class="message">${safeMessage}</span><span class="percent">${hasProgress ? `${Math.round(safeProgress)}%` : ""}</span></div><div class="track"><div class="fill"></div></div></div><a class="close" href="#dismiss" aria-label="关闭提示">×</a></div><script>window.updateNotice=function(message,progress){document.querySelector('.message').textContent=message;document.querySelector('.percent').textContent=Math.round(progress)+'%';document.querySelector('.fill').style.width=progress+'%'};document.querySelector('.close').addEventListener('mousedown',function(e){e.preventDefault();location.hash='dismiss'})<\/script></body></html>`;
}
function hideWorkspaceNoticeOverlay() {
  if (!workspaceNoticeOverlay || workspaceNoticeOverlay.isDestroyed()) return;
  workspaceNoticeOverlay.hide();
}
function dismissWorkspaceNotice() {
  if (workspaceNoticeDismissTimer) clearTimeout(workspaceNoticeDismissTimer);
  workspaceNoticeDismissTimer = void 0;
  workspaceNoticeMessage = void 0;
  workspaceNoticeProgress = void 0;
  workspaceNoticeBounds = void 0;
  workspaceNoticeRenderedMessage = void 0;
  workspaceNoticeRenderedProgress = void 0;
  hideWorkspaceNoticeOverlay();
  mainWindow?.webContents.send("workspace-notice:dismissed");
}
function ensureWorkspaceNoticeOverlay() {
  if (!mainWindow || mainWindow.isDestroyed()) return void 0;
  if (workspaceNoticeOverlay && !workspaceNoticeOverlay.isDestroyed()) return workspaceNoticeOverlay;
  const overlay = new BrowserWindow({
    parent: mainWindow,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true }
  });
  overlay.setMenuBarVisibility(false);
  overlay.setAlwaysOnTop(true, "pop-up-menu");
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.on("focus", () => {
    dismissWorkspaceNotice();
  });
  overlay.webContents.on("did-navigate-in-page", (_event, url) => {
    if (url.endsWith("#dismiss")) dismissWorkspaceNotice();
  });
  overlay.webContents.on("before-input-event", (event, input) => {
    const pointerX = input.x;
    if (input.type !== "mouseDown" || typeof pointerX !== "number" || pointerX < overlay.getBounds().width - 48) return;
    event.preventDefault();
    dismissWorkspaceNotice();
  });
  overlay.on("closed", () => {
    if (workspaceNoticeOverlay !== overlay) return;
    workspaceNoticeOverlay = void 0;
    workspaceNoticeRenderedMessage = void 0;
    workspaceNoticeRenderedProgress = void 0;
  });
  workspaceNoticeOverlay = overlay;
  return overlay;
}
function updateWorkspaceNoticeOverlay() {
  const message = workspaceNoticeMessage;
  const progress = workspaceNoticeProgress;
  const bounds = workspaceNoticeBounds;
  const overlay = ensureWorkspaceNoticeOverlay();
  if (!message || !bounds || !overlay || mainWindowUnavailable()) {
    hideWorkspaceNoticeOverlay();
    return;
  }
  const workspace = toScreenBounds(bounds);
  const height = typeof progress === "number" ? 76 : 60;
  const width = Math.min(390, Math.max(240, workspace.width - 32));
  overlay.setBounds({
    x: workspace.x + Math.round((workspace.width - width) / 2),
    y: workspace.y + Math.round((workspace.height - height) / 2),
    width,
    height
  });
  const requestId = ++workspaceNoticeRequestId;
  const renderedAsProgress = typeof workspaceNoticeRenderedProgress === "number";
  const shouldLoadDocument = workspaceNoticeRenderedMessage !== message || renderedAsProgress !== (typeof progress === "number");
  if (shouldLoadDocument) {
    workspaceNoticeRenderedMessage = message;
    workspaceNoticeRenderedProgress = progress;
    if (workspaceNoticeDismissTimer) clearTimeout(workspaceNoticeDismissTimer);
    workspaceNoticeDismissTimer = void 0;
    if (typeof progress !== "number") {
      workspaceNoticeDismissTimer = setTimeout(() => {
        workspaceNoticeDismissTimer = void 0;
        if (workspaceNoticeMessage === message) dismissWorkspaceNotice();
      }, 3e3);
    }
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(workspaceNoticeDocument(message, progress))}`).then(() => {
      if (requestId === workspaceNoticeRequestId && !overlay.isDestroyed()) overlay.showInactive();
    }).catch(() => void 0);
    return;
  }
  if (typeof progress === "number" && workspaceNoticeRenderedProgress !== progress) {
    workspaceNoticeRenderedProgress = progress;
    void overlay.webContents.executeJavaScript(`window.updateNotice?.(${JSON.stringify(message)}, ${progress})`, true).catch(() => void 0);
  }
  overlay.showInactive();
}
function mainWindowUnavailable() {
  return !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible();
}
function markSignalPresentationSuspended() {
  if (!signalSuspendedWithMainWindow) signal.suspendPresentation();
  signalSuspendedWithMainWindow = true;
}
function canPresentSignalInWorkspace(accountId = selectedSignalAccountId) {
  if (!workspaceUnlocked) return false;
  if (mainWindowUnavailable()) return false;
  return !!accountId && selectedSignalAccountId === accountId && activeSignalWindow?.account.id === accountId && activeSignalWindow.visible;
}
function updateSignalDesktopAndRestart(account) {
  if (signalDesktopUpdateFlow) return signalDesktopUpdateFlow;
  const request = performSignalDesktopUpdateAndRestart(account).finally(() => {
    if (signalDesktopUpdateFlow === request) signalDesktopUpdateFlow = void 0;
  });
  signalDesktopUpdateFlow = request;
  return request;
}
async function performSignalDesktopUpdateAndRestart(account) {
  runtimeLog("Signal desktop update requested", { accountId: account?.id, source: account ? "account" : "application" });
  const requestedSignalAccount = account?.platform === "signal" ? account : void 0;
  const runningAccountIds = signalRestartAccountIds(signal.runningAccountIds(), requestedSignalAccount?.id);
  const accountsToRestart = store.get().accounts.filter((item) => item.platform === "signal" && runningAccountIds.has(item.id));
  if (requestedSignalAccount && !accountsToRestart.some((item) => item.id === requestedSignalAccount.id)) {
    accountsToRestart.push(requestedSignalAccount);
  }
  const activeBeforeUpdate = activeSignalWindow;
  let activeWindowStopped = false;
  let updateCompleted = false;
  let requestedRestartError;
  try {
    const result = await signal.updateBundledDesktop(account);
    updateCompleted = true;
    runtimeLog("Signal desktop update completed", result);
    return result;
  } catch (error) {
    runtimeLog("Signal desktop update failed", {
      accountId: account?.id,
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  } finally {
    const runningAfterUpdate = new Set(signal.runningAccountIds());
    activeWindowStopped = !!activeBeforeUpdate && accountsToRestart.some((item) => item.id === activeBeforeUpdate.account.id) && !runningAfterUpdate.has(activeBeforeUpdate.account.id);
    if (activeWindowStopped) activeSignalWindow = void 0;
    for (const signalAccount of accountsToRestart) {
      try {
        await signal.start(signalAccount);
        runtimeLog("Signal account restarted on managed desktop runtime", { accountId: signalAccount.id });
      } catch (error) {
        if (signalAccount.id === requestedSignalAccount?.id) requestedRestartError = error;
        runtimeLog("Signal account restart after desktop update failed", {
          accountId: signalAccount.id,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (activeWindowStopped && activeBeforeUpdate && selectedSignalAccountId === activeBeforeUpdate.account.id && store.get().accounts.some((item) => item.id === activeBeforeUpdate.account.id && item.platform === "signal") && mainWindow && !mainWindow.isDestroyed()) {
      try {
        await signal.attach(
          activeBeforeUpdate.account,
          nativeWindowHandle(mainWindow),
          toScreenBounds(activeBeforeUpdate.bounds),
          false
        );
        activeSignalWindow = { ...activeBeforeUpdate, visible: false };
        const shouldShow = activeBeforeUpdate.visible && selectedSignalAccountId === activeBeforeUpdate.account.id && !signalSuspendedWithMainWindow && canPresentSignalInWorkspace(activeBeforeUpdate.account.id);
        await signal.setVisible(
          activeBeforeUpdate.account,
          shouldShow,
          toScreenBounds(activeBeforeUpdate.bounds),
          false,
          true
        );
        activeSignalWindow.visible = shouldShow;
        runtimeLog("Latest Signal desktop restored after managed update", {
          accountId: activeBeforeUpdate.account.id,
          visible: shouldShow
        });
      } catch (error) {
        activeSignalWindow = void 0;
        runtimeLog("Signal workspace restore after desktop update failed", {
          accountId: activeBeforeUpdate.account.id,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (updateCompleted && requestedRestartError) throw requestedRestartError;
  }
}
function syncActiveSignalWindow(visible) {
  if (!activeSignalWindow) return;
  const desiredVisible = activeSignalWindow.visible;
  if (desiredVisible && activeSignalWindow.account.id !== selectedSignalAccountId) return;
  if (desiredVisible && mainWindow?.isMinimized()) {
    markSignalPresentationSuspended();
    signalMinimizedWithOwner = true;
    return;
  }
  if (desiredVisible && signalMinimizedWithOwner) return;
  const actualVisible = desiredVisible && !signalSuspendedWithMainWindow && canPresentSignalInWorkspace();
  void signal.setVisible(activeSignalWindow.account, actualVisible, toScreenBounds(activeSignalWindow.bounds)).catch(() => void 0);
}
function scheduleActiveSignalWindowSync() {
  if (signalWindowSyncTimer) return;
  signalWindowSyncTimer = setTimeout(() => {
    signalWindowSyncTimer = void 0;
    syncActiveSignalWindow();
  }, 50);
}
function hideUnselectedSignalWindows(preserveAccountId) {
  const selectedAccountId = selectedSignalAccountId;
  if (deferredSignalHideSweepTimer) clearTimeout(deferredSignalHideSweepTimer);
  deferredSignalHideSweepTimer = void 0;
  if (activeSignalWindow && activeSignalWindow.account.id !== selectedAccountId && activeSignalWindow.account.id !== preserveAccountId) {
    activeSignalWindow.visible = false;
  }
  const inactiveAccounts = store.get().accounts.filter(
    (account) => account.platform === "signal" && account.id !== selectedAccountId && account.id !== preserveAccountId
  );
  for (const account of inactiveAccounts) {
    const isPresented = signal.isWindowPresented(account.id) || activeSignalWindow?.account.id === account.id;
    if (isPresented) void signal.setVisible(account, false).catch(() => void 0);
  }
  if (!preserveAccountId && inactiveAccounts.length) {
    deferredSignalHideSweepTimer = setTimeout(() => {
      deferredSignalHideSweepTimer = void 0;
      const currentSelectedId = selectedSignalAccountId;
      for (const account of store.get().accounts) {
        if (account.platform !== "signal" || account.id === currentSelectedId) continue;
        const guardedHidden=!!findWindowHelper() && signal.attachedWindows.has(account.id) && signal.placements.get(account.id)?.visible===false && !signal.placementRuns.has(account.id);
        if(guardedHidden)continue;
        void signal.setVisible(account, false, void 0, false, true).catch(() => void 0);
      }
    }, 1400);
  }
}
async function refreshWorkspaceTaskbarPreview() {
  if (workspaceTaskbarPreviewInFlight || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  if (Date.now() < workspaceTaskbarPreviewSuspendedUntil) return;
  const state = store.get();
  const account = state.accounts.find((item) => item.id === state.selectedAccountId);
  if (!account || account.platform !== "signal" && !webViews.isWebPlatform(account.platform)) return;
  workspaceTaskbarPreviewInFlight = true;
  try {
    const dataUrl = account.platform === "signal" ? await signal.capturePreview(account.id) : await webViews.capturePreview(account.id);
    if (!dataUrl || store.get().selectedAccountId !== account.id) return;
    emit({ type: "workspace-preview", accountId: account.id, dataUrl });
    if (workspaceTaskbarPreviewReadyAccountId !== account.id) {
      workspaceTaskbarPreviewReadyAccountId = account.id;
      runtimeLog("Workspace taskbar preview ready", { accountId: account.id, platform: account.platform, bytes: dataUrl.length });
    }
  } catch {
  } finally {
    workspaceTaskbarPreviewInFlight = false;
  }
}
function recoverSelectedSignalWindow() {
  if (!canPresentSignalInWorkspace()) return;
  if (!selectedSignalAccountId) return;
  const account = store.get().accounts.find((item) => item.id === selectedSignalAccountId && item.platform === "signal");
  if (!account) return;
  if (activeSignalWindow?.account.id === account.id) {
    activeSignalWindow.visible = true;
    void signal.setVisible(account, true, toScreenBounds(activeSignalWindow.bounds), true).catch((error) => {
      runtimeLog("recover selected Signal window failed", error instanceof Error ? error.message : String(error));
    });
    return;
  }
  void signal.setVisible(account, true, void 0, true).catch((error) => {
    runtimeLog("recover selected Signal window from cached placement failed", error instanceof Error ? error.message : String(error));
  });
}
function restoreOwnedSelectedSignalWindow() {
  if (!canPresentSignalInWorkspace()) return;
  if (!selectedSignalAccountId) return;
  const account = store.get().accounts.find((item) => item.id === selectedSignalAccountId && item.platform === "signal");
  if (!account) return;
  void signal.restoreOwnedWindow(account).catch((error) => {
    runtimeLog("restore owner-hidden Signal window failed", error instanceof Error ? error.message : String(error));
  });
}
async function loadMainRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (process.env.ELECTRON_RENDERER_URL) await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}
function invalidateContents(contents) {
  try {
    contents.invalidate?.();
  } catch {
  }
}
function reloadMainRenderer(reason) {
  if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return;
  runtimeLog("reload main renderer", reason);
  void loadMainRenderer().catch((error) => {
    runtimeLog("reload main renderer failed", error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
  });
}
function recoverAfterForeground() {
  if (!workspaceUnlocked) return;
  if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return;
  if (mainWindowUnavailable()) return;
  for (const timer of signalSuspendReassertTimers) clearTimeout(timer);
  signalSuspendReassertTimers.clear();
  const wasSuspended = signalSuspendedWithMainWindow;
  pendingSignalRecovery ||= wasSuspended && !signalMinimizedWithOwner;
  signalSuspendedWithMainWindow = false;
  signalMinimizedWithOwner = false;
  if (wasSuspended) signal.resumePresentation();
  if (foregroundRecoveryTimer) clearTimeout(foregroundRecoveryTimer);
  foregroundRecoveryTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || shuttingDown || mainWindowUnavailable()) return;
    const shouldRecoverSignal = pendingSignalRecovery;
    const shouldRestoreOwnedSignal = pendingOwnedSignalRestore;
    pendingSignalRecovery = false;
    pendingOwnedSignalRestore = false;
    try {
      mainWindow.setBackgroundColor(appearanceBackgroundColor(resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors)));
      if (mainWindow.webContents.isCrashed()) {
        reloadMainRenderer("foreground recovery found crashed renderer");
        return;
      }
      invalidateContents(mainWindow.webContents);
    } catch {
    }
    try {
      webViews.recoverActive();
    } catch (error) {
      runtimeLog("active web view recovery failed", error instanceof Error ? error.message : String(error));
    }
    if (shouldRestoreOwnedSignal) restoreOwnedSelectedSignalWindow();
    if (shouldRecoverSignal && activeSignalWindow?.visible) recoverSelectedSignalWindow();
    setTimeout(() => {
      if (mainWindowUnavailable()) return;
      try {
        webViews.recoverActive();
      } catch (error) {
        runtimeLog("delayed active web view recovery failed", error instanceof Error ? error.message : String(error));
      }
      // Signal was already restored once; avoid repeated recovery resizes.
    }, 120);
    setTimeout(() => {
      if (mainWindowUnavailable()) return;
      try {
        webViews.recoverActive();
      } catch (error) {
        runtimeLog("final active web view recovery failed", error instanceof Error ? error.message : String(error));
      }
      // Signal was already restored once; avoid repeated recovery resizes.
    }, 360);
  }, 50);
}
function suspendSignalWithMainWindow() {
  markSignalPresentationSuspended();
  signalMinimizedWithOwner = false;
  for (const timer of signalSuspendReassertTimers) clearTimeout(timer);
  signalSuspendReassertTimers.clear();
  const hideManagedSignalWindows = (requireUnavailable = false) => {
    if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return;
    if (requireUnavailable && !mainWindowUnavailable()) return;
    const accounts=store.get().accounts.filter(a=>a.platform==="signal").sort((a,b)=>Number(b.id===activeSignalWindow?.account.id)-Number(a.id===activeSignalWindow?.account.id));
    for (const account of accounts) {
      const parked=signal.attachedWindows.has(account.id)&&signal.placements.get(account.id)?.visible===false&&!signal.placementRuns.has(account.id);
      if(parked)continue;
      const bounds = activeSignalWindow?.account.id === account.id ? toScreenBounds(activeSignalWindow.bounds) : void 0;
      void signal.setVisible(account, false, bounds, false, true).catch((error) => {
        runtimeLog("Failed to suspend managed Signal window", {
          accountId: account.id,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }
  };
  hideManagedSignalWindows();
  for (const delay2 of [150, 500, 1200, 2500]) {
    const timer = setTimeout(() => {
      signalSuspendReassertTimers.delete(timer);
      hideManagedSignalWindows(true);
    }, delay2);
    signalSuspendReassertTimers.add(timer);
  }
}
function pollSignalWindowLifecycle() {
  if (!workspaceUnlocked) return;
  if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return;
  const unavailable = mainWindow.isMinimized() || !mainWindow.isVisible();
  if (unavailable) {
    if (!signalSuspendedWithMainWindow) suspendSignalWithMainWindow();
    return;
  }
  if (signalSuspendedWithMainWindow) recoverAfterForeground();
  // Validate the active managed HWND periodically, even when its cached geometry did not change.
  const guard=globalThis.__biSignalEmbedGuard||={busy:false,next:0};
  if(guard.busy||Date.now()<guard.next||!canPresentSignalInWorkspace()||!activeSignalWindow?.visible)return;
  const active=activeSignalWindow,account=active.account;
  if(account.id!==selectedSignalAccountId||!signal.attachedWindows.has(account.id)||signal.placementRuns.has(account.id)||signal.workspaceAttaching?.has(account.id)||signal.launchPromises.has(account.id)||signal.isBundledDesktopUpdateRunning())return;
  guard.busy=true;guard.next=Date.now()+2000;
  void signal.setVisible(account,true,toScreenBounds(active.bounds),false,true).catch(error=>{
    guard.next=Date.now()+10000;
    runtimeLog('Signal embedding guard recovery failed',{accountId:account.id,reason:String(error?.message||error)});
    if(selectedSignalAccountId===account.id)emit({type:'connection',accountId:account.id,status:'Signal 窗口恢复失败，请切换账号重试'});
  }).finally(()=>{guard.busy=false;});
}
function applyAppearanceSurfaceColors() {
  const theme = resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors);
  const backgroundColor = appearanceBackgroundColor(theme);
  try {
    mainWindow?.setBackgroundColor(backgroundColor);
  } catch {
  }
  webViews?.setAppearanceTheme(theme);
  const brandIcon = appIconImage();
  if(brandIcon && !brandIcon.isEmpty()){mainWindow?.setIcon(brandIcon);tray?.setImage(brandIcon);}
}
function applyAppearanceTheme(mode) {
  const normalizedMode = normalizeAppearanceTheme(mode);
  if (nativeTheme.themeSource !== normalizedMode) nativeTheme.themeSource = normalizedMode;
  applyAppearanceSurfaceColors();
}
function setNativeWindowEffects(enabled) {
  if (!mainWindow) return;
  if(process.platform==='win32'){const handle=mainWindow.getNativeWindowHandle().readBigUInt64LE().toString();const script=join(__dirname,'../runtime-vendor/win32-window-helper/DisableMainTransitions.ps1');void runPowerShell('& '+ps(script)+' -WindowHandle '+handle).catch(e=>runtimeLog('main transitions setting failed',String(e)));}
  try {
    mainWindow.setBackgroundColor(appearanceBackgroundColor(resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors)));
    mainWindow.setBackgroundMaterial("none");
  } catch {
  }
}
function installMainWindowActivationRecovery(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed() || win.__biActivationRecovery) return;
  let pending, generation = 0, appActive = false;
  const cancel = () => { generation++; if (pending) clearTimeout(pending); pending = undefined; };
  const schedule = () => {
    if (pending || shuttingDown) return;
    const ticket = generation;
    const restoreRequested = win.isMinimized() || !win.isVisible();
    pending = setTimeout(() => {
      pending = undefined;
      if (ticket !== generation || shuttingDown || win.isDestroyed()) return;
      // Restore only if this native request originally targeted an unavailable window.
      if (restoreRequested) {
        if (win.isMinimized()) win.restore();
        if (!win.isVisible()) win.show();
        win.focus();
      }
      if (!win.isMinimized() && win.isVisible()) recoverAfterForeground();
    }, 0);
  };
  const activate = (wParam) => {
    if (wParam.length < 2) return;
    if (wParam.readUInt16LE(0) === 0) { if (!appActive) cancel(); return; }
    schedule();
  };
  const command = (wParam) => {
    if (wParam.length < 2) return;
    const action = wParam.readUInt16LE(0) & 0xfff0;
    if (action === 0xf020 || action === 0xf060) cancel();
    else if (action === 0xf120) schedule();
  };
  const activateApp=(wParam)=>{if(wParam.length<4)return;appActive=wParam.readUInt32LE(0)!==0;if(appActive)schedule();else cancel();};
  win.hookWindowMessage(0x001c, activateApp);
  win.hookWindowMessage(0x0006, activate);
  win.hookWindowMessage(0x0112, command);
  win.on('minimize', cancel);
  win.on('hide', cancel);
  win.once('closed', cancel);
  win.__biActivationRecovery = { version: 3, dispose:()=>{cancel();win.removeListener('minimize',cancel);win.removeListener('hide',cancel);win.removeListener('closed',cancel);for(const message of [0x0006,0x001c,0x0112])win.unhookWindowMessage(message);} };
}

function presentMainWindow(reason) {
  if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return;
  try {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindowPresented && !mainWindowPlacementRestored) mainWindow.center();
    mainWindowPresented = true;
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    mainWindow.moveTop();
    runtimeLog("main window presented", {
      reason,
      visible: mainWindow.isVisible(),
      focused: mainWindow.isFocused(),
      bounds: mainWindow.getBounds()
    });
  } catch (error) {
    runtimeLog("main window presentation failed", {
      reason,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
function fetchDeepLTrusted(url, options) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !['api.deepl.com','api-free.deepl.com'].includes(target.hostname)) throw Error('Invalid DeepL endpoint');
  // Chromium validates certificates against platform trust, including locally
  // trusted HTTPS inspection certificates. Never override verification errors.
  return net.fetch(url, options);
}

async function fetchLayoutTranslation(url,params,key,deadline,valid=async()=>true,options={}){
  const payload={text:params.getAll('text'),target_lang:normalizeDeepLLanguage(params.get('target_lang'))};if(params.has('preserve_formatting'))payload.preserve_formatting=true;
  layoutEconomyMetric(options,'submittedCharacters',payload.text.reduce((n,t)=>n+[...t].length,0));layoutEconomyMetric(options,'networkAttempts');
  payload.bypassCache=!!options.bypassCache;
  return requestDeepLReliably(key,payload,deadline,valid);
}

async function translateLayoutContext(source, valid = async()=>true, options = {}) {
  const deadline=options.deadline||Date.now()+28000;
  if(typeof source!=='string'||!source.trim()||source.length>12000)throw Error('翻译文本无效');
  const parts=source.split(translationProvider()==='google'?/(\r\n|[\r\n\t])/u:/(\r\n|[\r\n\t]|[^\S\r\n\t]{2,})/u),positions=[];
  for(let i=0;i<parts.length;i++)if(parts[i]&&!/^\s+$/u.test(parts[i])&&/\p{Letter}/u.test(parts[i]))positions.push(i);
  if(!positions.length)return source;
  const key=translationCredential();if(!key)throw Error('请先设置 DeepL API Key');
  const output=parts.slice();
  for(let offset=0;offset<positions.length;offset+=50){
    const group=positions.slice(offset,offset+50);
    const params=new URLSearchParams({target_lang:'EN',preserve_formatting:'1'});
    for(const index of group)params.append('text',parts[index].trim());
    const value=await fetchLayoutTranslation(`${baseUrl(key)}/v2/translate`,params,key,deadline,valid,options);
    if(!Array.isArray(value.translations)||value.translations.length!==group.length)throw Error('译文数量校验失败');
    group.forEach((index,i)=>{const text=value.translations[i]?.text;if(typeof text!=='string'||!text.trim())throw Error('DeepL 返回空译文');const edge=parts[index].match(/^(\s*)([\s\S]*?)(\s*)$/);output[index]=edge[1]+text.trim().replace(/\s*\r?\n\s*/g,' ')+edge[3];});
  }
  return output.join('');
}

async function whatsappBatchTranslation(event, items, cacheOnly = false) {
  const scope = translationScope(event);
  const account = store.get().accounts.find(a => a.id === scope);
  if (!account || account.platform !== 'whatsapp' || account.translationEnabled === false) throw Error('WhatsApp translation unavailable');
  if (!Array.isArray(items) || items.length > (cacheOnly ? 100 : 5) || items.some(i => !i || typeof i.text !== 'string' || !i.text.trim() || i.text.length > 12000)) throw Error('Invalid translation batch');
  const identity = JSON.stringify([translationProvider()==='google'?'google-free-native-v1':'deepl-native-v4']);
  const lookup = async item => {
    const text = item.text.trim();
    return await translator.history?.get(identity, 'auto', 'zh', text) || null;
  };
  const results = await Promise.all(items.map(lookup));
  if (cacheOnly || results.every(Boolean)) return results;
  const generation = workspaceGeneration,providerGeneration=(translationProvider(),globalThis.__biProviderState.generation);
  return translator.scheduler.run(async () => {
    if (generation !== workspaceGeneration || !workspaceUnlocked || event.sender.isDestroyed() || store.get().accounts.find(a=>a.id===scope)?.translationEnabled === false) throw Error('Translation cancelled');
    for (let i=0;i<items.length;i++) if (!results[i]) results[i]=await lookup(items[i]);
    const missing = items.map((item,i)=>({item,i})).filter(x=>!results[x.i]);
    if (!missing.length) return results;
    const key=translationCredential(); if(!key) throw Error('请先设置 DeepL API Key');
    const valid=async()=>providerGeneration===globalThis.__biProviderState.generation&&generation===workspaceGeneration&&workspaceUnlocked&&!event.sender.isDestroyed()&&store.get().accounts.find(a=>a.id===scope)?.translationEnabled!==false;
    const deadline=Date.now()+30000;
    for(let offset=0;offset<missing.length;){const batch=[];
      while(offset<missing.length){const next=missing[offset];const payload={target_lang:'ZH',text:[...batch.map(x=>x.item.text.trim()),next.item.text.trim()]};if(batch.length&&Buffer.byteLength(JSON.stringify(payload),'utf8')>120000)break;batch.push(next);offset++;}
      const value=await requestDeepLReliably(key,{target_lang:'ZH',text:batch.map(x=>x.item.text.trim())},deadline,valid);
      batch.forEach(({item,i},n)=>{results[i]=value.translations[n].text;translator.history?.remember(identity,'auto','zh',item.text.trim(),results[i]);});
    }
    return results;
  }, 1000);
}

function layoutEconomyMetric(options, name, amount = 1) {
  const platform = store.get().accounts.find(a => a.id === options.scope)?.platform || 'unknown';
  const state = globalThis.__biLayoutEconomy ||= {pending:new Map(),stats:{}};
  const stats = state.stats[platform] ||= {};
  stats[name] = (stats[name] || 0) + amount;
  if (!state.timer) { state.timer=setTimeout(()=>{state.timer=null;runtimeLog('Layout translation economy totals',state.stats);},10000);state.timer.unref?.(); }
}
async function translateLayoutCached(source, options = {}) {
  const providerGeneration=(translationProvider(),globalThis.__biProviderState.generation);const previousCurrent=options.isCurrent;options={...options,isCurrent:()=>providerGeneration===globalThis.__biProviderState.generation&&(!previousCurrent||previousCurrent())};
  if(typeof source!=='string'||!source.trim()||source.length>12000)throw Error('翻译文本无效');
  const identity=JSON.stringify([translationProvider()+'-layout-default-v9','EN','preserve_formatting=1']);
  const state=globalThis.__biLayoutEconomy ||= {pending:new Map(),stats:{}};
  const current=async()=>{try{return !options.isCurrent || !!await options.isCurrent();}catch{return false;}};
  if(!await current())throw Error('翻译任务已取消。');
  layoutEconomyMetric(options,'calls');
  const lookup=async()=>{if(options.bypassCache)return;const value=await translator.history?.get(identity,'auto','en',source);if(!value)return;try{const result=JSON.parse(value);if(typeof result==='string'&&result.trim())return result;}catch{}};
  let result=await lookup();
  if(result!==undefined)layoutEconomyMetric(options,'cacheHits');
  else {
    const key=createHash('sha256').update(identity+'\0'+source+'\0'+(options.scope||'')+'\0'+(options.bypassCache?'fresh':'cached')).digest('hex');
    let job=state.pending.get(key);
    if(job){job.consumers.push(current);layoutEconomyMetric(options,'mergedRequests');}
    else {
      job={consumers:[current]};
      const deadline=Date.now()+35000;
      const valid=async()=>{for(const check of job.consumers)if(await check())return true;return false;};
      job.task=translator.scheduler.run(async()=>{
        if(!await valid())throw Error('翻译任务已取消。');
        const cached=await lookup();if(cached!==undefined){layoutEconomyMetric(options,'cacheHits');return cached;}
        const translated=await translateLayoutContext(source,valid,{...options,deadline});
        // JSON encoding preserves leading/trailing whitespace in the existing history store.
        translator.history?.remember(identity,'auto','en',source,JSON.stringify(translated));
        return translated;
      },2000,Math.min(10000,Math.max(1,deadline-Date.now()))).finally(()=>{if(state.pending.get(key)===job)state.pending.delete(key);});
      state.pending.set(key,job);
    }
    result=await job.task;
  }
  if(!await current())throw Error('翻译任务已取消。');
  if(options.scope && !/\p{Script=Han}/u.test(result))translator.history?.remember(JSON.stringify([translationProvider()+'-own-message-v2',options.scope]),'en','zh',result.trim(),source);
  return result;
}

function translateForUser(...args) {
  if (!workspaceUnlocked || !userAccount?.isAuthenticated()) return Promise.reject(new Error("请先登录 Bi-Talks 账号。"));
  const generation = workspaceGeneration;
  const options = {...args[4],onDelta:args[3]};
  args[4] = { ...options, isCurrent: () => workspaceUnlocked && generation === workspaceGeneration && (!options?.isCurrent || options.isCurrent()) };
  if(typeof args[0]==='string'&&args[0].startsWith('__BITALKS_LAYOUT_RETRY_V1__')) {
    const source=JSON.parse(args[0].slice('__BITALKS_LAYOUT_RETRY_V1__'.length));
    return translateLayoutCached(source,{...args[4],bypassCache:true}).catch(error=>{throw translationFailure(error);});
  }
  if(typeof args[0]==='string'&&args[0].startsWith('__BITALKS_LAYOUT_CONTEXT_V2__')) {
    const source=JSON.parse(args[0].slice('__BITALKS_LAYOUT_CONTEXT_V2__'.length));
    return translateLayoutCached(source,args[4]).catch(error=>{throw translationFailure(error);});
  }
  return translator.translate(...args);
}
function initializeUserWorkspace() {
  if (!mainWindow) return;
  const startupAppearanceTheme = resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors);
  webViews = new WebViewManager(mainWindow, emit);
  webViews.setAppearanceTheme(startupAppearanceTheme);
  googleVoice = new GoogleVoiceManager(
    mainWindow,
    localRuntimeRoot,
    emit,
    (text, target, source, accountId, onDelta, isCurrent, priority, timeoutMs) => translateForUser(text, target, source, onDelta, { scope: accountId, isCurrent, priority, timeoutMs })
  );
  signal = new SignalManager(
    emit,
    (text, accountId, onDelta, isCurrent, ownMessage, priority) => translateForUser(text, "zh", "auto", onDelta, { scope: accountId, isCurrent, ownMessage, priority, timeoutMs: 3e4 }),
    (text, accountId) => translateForUser(text, "en", "auto", void 0, { scope: accountId, priority: 2e3 }),
    localRuntimeRoot,
    async (account) => {
      await updateSignalDesktopAndRestart(account);
    }
  );
}
function syncUserWorkspace() {
  if (!mainWindow || !webViews) return;
  const allowed = userAccount?.isAuthenticated() === true;
  if (workspaceUnlocked && !allowed) {
    workspaceUnlocked = false;pauseGoogleRecovery();
    workspaceGeneration++;
    workspaceWasStopped = true;
    activeSignalWindow = void 0;
    selectedSignalAccountId = void 0;
    hideWorkspaceNoticeOverlay();
    for (const notice of accountNotices.values()) notice.close();
    accountNotices.clear();
    webViews.shutdown();
    googleVoice.shutdown();
    signal.shutdown();
  } else if (!workspaceUnlocked && allowed) {
    if (workspaceWasStopped) {
      initializeUserWorkspace();
      workspaceWasStopped = false;
    }
    workspaceUnlocked = true;
    workspaceGeneration++;
    void autostartAllAccounts();
  }
}
async function createWindow() {
  runtimeLog("create window started", {
    pid: process.pid,
    executable: process.execPath,
    appUserModelId,
    packaged: app.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL || null
  });
  await store.load();
  const startupThemeMode = normalizeAppearanceTheme(store.get().settings.themeMode);
  nativeTheme.themeSource = startupThemeMode;
  const startupAppearanceTheme = resolveAppearanceTheme(startupThemeMode, nativeTheme.shouldUseDarkColors);
  loadPersistedUnreadCounts();
  translator = new Translator(new TranslationHistory(join(app.getPath("userData"), "translation-history-v2.enc.jsonl"), {
    encode: (text) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Encryption unavailable");
      return safeStorage.encryptString(text).toString("base64");
    },
    decode: (text) => safeStorage.decryptString(Buffer.from(text, "base64"))
  }), (details) => runtimeLog("DeepL translation request failed", details));
  mainWindowPresented = false;
  const restoredWindowState = loadMainWindowState();
  mainWindowPlacementRestored = Boolean(restoredWindowState);
  const windowIcon = appIconImage();
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    ...restoredWindowState?.bounds || { width: 1440, height: 900 },
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: appearanceBackgroundColor(startupAppearanceTheme),
    transparent: false,
    backgroundMaterial: "none",
    title: appDisplayName,
    icon: windowIcon || appIconPath(),
    vibrancy: void 0,
    visualEffectState: "inactive",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: true
    }
  });
  if (windowIcon) {
    mainWindow.setIcon(windowIcon);
    runtimeLog("main window icon applied", windowIcon.getSize());
  } else {
    runtimeLog("main window icon unavailable");
  }
  if (restoredWindowState?.maximized) mainWindow.maximize();
  ensureSystemTray();
  setNativeWindowEffects();
  initializeUserWorkspace();
  appPatches = new AppPatchManager({
    applicationRoot: app.getAppPath(),
    dataRoot: portableDataRoot,
    executablePath: process.execPath,
    helperPath: app.isPackaged ? join(process.resourcesPath, "vendor", "patch-updater", "ApplyPatch.ps1") : join(app.getAppPath(), "vendor", "patch-updater", "ApplyPatch.ps1"),
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    emit,
    log: runtimeLog,
    quitForApply: () => {
      if (shuttingDown) return;
      persistMainWindowState();
      closeApproved = true;
      shuttingDown = true;
      app.relaunch();
      persistUnreadCounts();
      webViews?.shutdown();
      googleVoice?.shutdown();
      signal?.shutdown();
      tray?.destroy();
      tray = void 0;
      const exitForPatch = () => app.exit(0);
      if (!translator || translationHistoryFlushStarted) {
        exitForPatch();
        return;
      }
      translationHistoryFlushStarted = true;
      const forceExitTimer = setTimeout(exitForPatch, 1500);
      void translator.flushHistory().catch((error) => runtimeLog("patch quit history flush failed", error instanceof Error ? error.message : String(error))).finally(() => {
        clearTimeout(forceExitTimer);
        exitForPatch();
      });
    }
  });
  if (workspaceTaskbarPreviewTimer) clearInterval(workspaceTaskbarPreviewTimer);
  workspaceTaskbarPreviewTimer = setInterval(() => void refreshWorkspaceTaskbarPreview(), 1e3);
  if (taskbarBadgeKeepAliveTimer) clearInterval(taskbarBadgeKeepAliveTimer);
  taskbarBadgeKeepAliveTimer = setInterval(keepMinimizedTaskbarUnreadBadgeAlive, 1200);
  mainWindow.once("ready-to-show", () => presentMainWindow("ready-to-show"));
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    runtimeLog("main renderer gone", details);
    if (!shuttingDown && details.reason !== "killed") reloadMainRenderer(`render process gone: ${details.reason}`);
  });
  mainWindow.webContents.on("unresponsive", () => runtimeLog("main renderer unresponsive"));
  mainWindow.webContents.on("responsive", () => runtimeLog("main renderer responsive"));
  mainWindow.on("moved", () => {
    scheduleMainWindowStateSave();
    scheduleActiveSignalWindowSync();
    googleVoice.recoverActive();
    updateWorkspaceNoticeOverlay();
  });
  mainWindow.on("resize", () => {
    scheduleMainWindowStateSave();
    scheduleActiveSignalWindowSync();
    googleVoice.recoverActive();
    updateWorkspaceNoticeOverlay();
  });
  installMainWindowActivationRecovery(mainWindow);
  mainWindow.on("focus", () => {
    mainWindow?.flashFrame(false);
    refreshTaskbarUnreadBadge();
    recoverAfterForeground();
    scheduleActiveSignalWindowSync();
    googleVoice.recoverActive();
    updateWorkspaceNoticeOverlay();
  });
  mainWindow.on("restore", () => {
    scheduleMainWindowStateSave();
    refreshTaskbarUnreadBadge();
    recoverAfterForeground();
  });
  mainWindow.on("resized", scheduleActiveSignalWindowSync);
  mainWindow.on("maximize", scheduleActiveSignalWindowSync);
  mainWindow.on("unmaximize", scheduleActiveSignalWindowSync);
  mainWindow.on("maximize", scheduleMainWindowStateSave);
  mainWindow.on("unmaximize", scheduleMainWindowStateSave);
  mainWindow.on("show", () => {
    refreshTaskbarUnreadBadge();
    recoverAfterForeground();
  });
  mainWindow.on("enter-full-screen", () => recoverAfterForeground());
  mainWindow.on("leave-full-screen", () => recoverAfterForeground());
  mainWindow.on("minimize", () => {
    runtimeLog("main window minimized", { taskbarUnreadTotal: lastTaskbarUnreadTotal });
    suspendSignalWithMainWindow();
    refreshTaskbarUnreadBadge();
  });
  mainWindow.on("hide", () => suspendSignalWithMainWindow());
  mainWindow.on("close", (event) => {
    runtimeLog("main window closing", { shuttingDown });
    persistMainWindowState();
    if (!shuttingDown && !closeApproved) {
      event.preventDefault();
      mainWindow?.webContents.send("window:close-requested");
      return;
    }
    hideWorkspaceNoticeOverlay();
    if (shuttingDown) return;
    shuttingDown = true;
    webViews.shutdown();
    googleVoice.shutdown();
    signal.shutdown();
  });
  mainWindow.on("closed", () => {
    runtimeLog("main window closed");
    if (mainWindowPresentationTimer) clearTimeout(mainWindowPresentationTimer);
    mainWindowPresentationTimer = void 0;
    if (mainWindowStateSaveTimer) clearTimeout(mainWindowStateSaveTimer);
    mainWindowStateSaveTimer = void 0;
    if (taskbarBadgeRefreshTimer) clearTimeout(taskbarBadgeRefreshTimer);
    taskbarBadgeRefreshTimer = void 0;
    mainWindowPresented = false;
    mainWindowPlacementRestored = false;
    if (signalLifecycleTimer) clearInterval(signalLifecycleTimer);
    signalLifecycleTimer = void 0;
    if (signalWindowSyncTimer) clearTimeout(signalWindowSyncTimer);
    signalWindowSyncTimer = void 0;
    if (deferredSignalHideSweepTimer) clearTimeout(deferredSignalHideSweepTimer);
    deferredSignalHideSweepTimer = void 0;
    for (const timer of signalSuspendReassertTimers) clearTimeout(timer);
    signalSuspendReassertTimers.clear();
    if (workspaceTaskbarPreviewTimer) clearInterval(workspaceTaskbarPreviewTimer);
    workspaceTaskbarPreviewTimer = void 0;
    if (taskbarBadgeKeepAliveTimer) clearInterval(taskbarBadgeKeepAliveTimer);
    taskbarBadgeKeepAliveTimer = void 0;
    workspaceTaskbarPreviewInFlight = false;
    workspaceTaskbarPreviewReadyAccountId = void 0;
    workspaceNoticeOverlay?.destroy();
    workspaceNoticeOverlay = void 0;
    workspaceNoticeMessage = void 0;
    workspaceNoticeProgress = void 0;
    workspaceNoticeBounds = void 0;
    workspaceNoticeRenderedMessage = void 0;
    workspaceNoticeRenderedProgress = void 0;
    mainWindow = void 0;
  });
  mainWindowPresentationTimer = setTimeout(() => presentMainWindow("startup-timeout"), 5e3);
  try {
    syncUserWorkspace();
    await loadMainRenderer();
    runtimeLog("main renderer loaded");
    presentMainWindow("renderer-loaded");
    void autostartAllAccounts();
    setTimeout(() => void appPatches.consumeApplyResult().catch((error) => {
      runtimeLog("patch apply result processing failed", error instanceof Error ? error.message : String(error));
    }), 1200);
  } catch (error) {
    runtimeLog("main renderer load failed", error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
    presentMainWindow("renderer-load-failed");
    throw error;
  } finally {
    if (mainWindowPresentationTimer) clearTimeout(mainWindowPresentationTimer);
    mainWindowPresentationTimer = void 0;
  }
  if (signalLifecycleTimer) clearInterval(signalLifecycleTimer);
  signalLifecycleTimer = setInterval(pollSignalWindowLifecycle, 1e3);
}
authenticatedHandle("translation-provider:status",()=>translationProviderStatus());
authenticatedHandle("translation-provider:set",(_event,enabled)=>setTranslationProvider(enabled));
authenticatedHandle("deepl-key:status", () => deepLKeyStatus());
authenticatedHandle("deepl-key:save", async (_event, value) => {
  if (typeof value !== "string") throw new Error("DeepL API Key 无效。");
  await validateDeepLKey(value.trim());
  saveDeepLKey(value);
  return deepLKeyStatus();
});
authenticatedHandle("deepl-key:clear", () => {
  clearDeepLKey();
  return deepLKeyStatus();
});
authenticatedHandle("state:get", () => store.get());
authenticatedHandle("window:confirm-close", () => {
  closeApproved = true;
  app.quit();
});
authenticatedHandle("unread:get", () => Object.fromEntries(
  [...unreadCounts.entries()].filter(([accountId, count]) => count > 0 && store.get().accounts.some((account) => account.id === accountId))
));
authenticatedHandle("state:set", async (_event, state) => {
  const previousAccounts = store.get().accounts;
  await store.set(state);
  for (const account of state.accounts) {
    if (previousAccounts.find((item) => item.id === account.id)?.hidden !== account.hidden) unreadBaselineUntil.set(account.id, Date.now() + 8e3);
  }
  for (const account of state.accounts) {
    if (isAccountHidden(account)) {
      accountNotices.get(account.id)?.close();
      accountNotices.delete(account.id);
    }
  }
  webViews.syncAccountVisibility(state.accounts);
  applyAppearanceTheme(state.settings.themeMode);
  updateAppUnreadBadge();
  scheduleUnreadPersistence();
});
ipcMain.on("service:unread", (event, payload) => {
  if (!workspaceUnlocked || !userAccount?.isAuthenticated()) return;
  const accountId = String(payload?.accountId || "");
  const count = Number(payload?.count);
  Number(payload?.titleCount);
  Number(payload?.domCount);
  if (!accountId || !Number.isFinite(count)) return;
  if (!store.get().accounts.some((account) => account.id === accountId && webViews.isWebPlatform(account.platform))) return;
  runtimeLog("web unread sources reported", {
    accountId,
    title: Number.isFinite(Number(payload.titleCount)) ? Number(payload.titleCount) : null,
    dom: Number.isFinite(Number(payload.domCount)) ? Number(payload.domCount) : null,
    count
  });
  if (!webViews.ownsAccountContents(accountId, event.sender.id)) return;
  emit({ type: "unread", accountId, count, trustedDecrease: payload.trustedDecrease === true, partial: payload.partial === true, delta: payload.delta, preview: payload.preview });
});
authenticatedHandle("view:activate", async (_event, account) => {
  workspaceTaskbarPreviewSuspendedUntil = Date.now() + 1600;
  await webViews.activate(account);
  await googleVoice.activate(account);
});
authenticatedHandle("view:bounds", (_event, bounds) => {
  webViews.setBounds(bounds);
  googleVoice.setBounds(bounds);
});
authenticatedHandle("view:capture-preview", async (_event, account) => {
  if (!webViews.isWebPlatform(account.platform)) return void 0;
  return webViews.capturePreview(account.id);
});
ipcMain.on("workspace-notice:set", (_event, message, bounds, progress) => {
  if (!workspaceUnlocked || !userAccount?.isAuthenticated()) return;
  workspaceNoticeMessage = typeof message === "string" && message.trim() ? message.trim() : void 0;
  workspaceNoticeProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : void 0;
  workspaceNoticeBounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } : void 0;
  updateWorkspaceNoticeOverlay();
});
const translationRequests = /* @__PURE__ */ new Map();
const translationScope = (event) => webViews?.accountForContents(event.sender) || store.get().selectedAccountId || "workspace";
authenticatedHandle("translate:text", (event, text, target, source) => translateForUser(text, target, source, void 0, { scope: translationScope(event), priority: 2e3 }));
authenticatedHandle("translate:cancel", (event, requestId) => {
  const task = translationRequests.get(event.sender.id + ":" + requestId);
  if (task) task.cancelled = true;
});
authenticatedHandle("translate:stream", (event, requestId, text, target, source, ownMessage) => {
  if (typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId)) throw new Error("翻译请求无效。");
  const key = event.sender.id + ":" + requestId;
  if (translationRequests.has(key)) throw new Error("重复翻译请求。");
  const task = { cancelled: false };
  translationRequests.set(key, task);
  return translateForUser(text, target, source, (delta) => {
    if (!task.cancelled && !event.sender.isDestroyed()) event.sender.send("translate:stream:delta", { requestId, text: delta });
  }, { scope: translationScope(event), ownMessage: ownMessage === true, isCurrent: () => !task.cancelled && !event.sender.isDestroyed() }).finally(() => translationRequests.delete(key));
});
authenticatedHandle('whatsapp:translation-cache', (event, items) => whatsappBatchTranslation(event, items, true));
authenticatedHandle('whatsapp:translation-batch', (event, items) => whatsappBatchTranslation(event, items, false));
authenticatedHandle("whatsapp:send-translated", (_event, accountId, text) => webViews.sendWhatsAppTranslated(accountId, text));
authenticatedHandle("appearance:native-effects", (_event, enabled) => setNativeWindowEffects());
authenticatedHandle("appearance:set-theme", (_event, mode) => applyAppearanceTheme(mode));
authenticatedHandle("account:start", async (_event, account) => {
  runtimeLog("account start requested", { accountId: account.id, platform: account.platform });
  if (webViews.isWebPlatform(account.platform)) await webViews.activate(account);
  else if (account.platform === "signal") await signal.start(account);
  else if (account.platform === "googlevoice" || account.platform === "googlechat") await googleVoice.activate(account);
});
authenticatedHandle("account:refresh", async (_event, account) => {
  if (webViews.isWebPlatform(account.platform)) {
    await webViews.refresh(account);
    if (store.get().selectedAccountId === account.id) await webViews.activate(account);
  } else if (account.platform === "signal") {
    if (activeSignalWindow?.account.id === account.id) activeSignalWindow = void 0;
    signal.remove(account);
    await signal.start(account);
  } else if (account.platform === "googlevoice" || account.platform === "googlechat") {
    await googleVoice.refresh(account);
    if (store.get().selectedAccountId === account.id) await googleVoice.activate(account);
  }
});
authenticatedHandle("account:close", async (_event, account) => {
  if (webViews.isWebPlatform(account.platform)) {
    webViews.close(account);
  } else if (account.platform === "signal") {
    if (activeSignalWindow?.account.id === account.id) activeSignalWindow = void 0;
    signal.remove(account);
  } else if (account.platform === "googlevoice" || account.platform === "googlechat") googleVoice.close(account);
  clearAccountUnreadState(account.id);
});
authenticatedHandle("account:preferences", async (_event, account) => {
  if (webViews.isWebPlatform(account.platform)) webViews.applyPreferences(account);
  else if (account.platform === "signal") signal.applyTranslationPreferences(account);
  else if (account.platform === "googlevoice" || account.platform === "googlechat") googleVoice.applyPreferences(account);
});
ipcMain.on("signal:set-active-account", (_event, accountId, preservePrevious = false) => {
  if (!workspaceUnlocked || !userAccount?.isAuthenticated()) return;
  if (_event.sender !== mainWindow?.webContents) return;
  if (selectedSignalAccountId === accountId && !preservePrevious) return;
  signalSelectionGeneration += 1;
  workspaceTaskbarPreviewSuspendedUntil = Date.now() + 1600;
  const previousSignalWindow = activeSignalWindow;
  selectedSignalAccountId = accountId;
  const transitionSourceId = preservePrevious && accountId ? previousSignalWindow?.account.id : void 0;
  hideUnselectedSignalWindows(transitionSourceId);
});
authenticatedHandle("signal:attach-window", async (_event, account, bounds) => {
  runtimeLog("Signal attach requested", { accountId: account.id, bounds });
  if (!mainWindow) throw new Error("Main window is not available.");
  if (account.platform !== "signal") throw new Error("Signal window embedding is only available for Signal accounts.");
  signal.workspaceBounds ??= new Map();
  signal.workspaceAttaching ??= new Set();
  signal.workspaceAttaching.add(account.id);
  signal.workspaceBounds.set(account.id, bounds);
  try {
  await signal.attach(account, nativeWindowHandle(mainWindow), toScreenBounds(bounds), false);
  bounds = signal.workspaceBounds.get(account.id) || bounds;
  await signal.moveAttachedWindow(account, toScreenBounds(bounds), false);
  await signal.setVisible(account, false, void 0, false, true);
  } finally { signal.workspaceAttaching.delete(account.id); }
  if (selectedSignalAccountId !== account.id) return;
  setTimeout(() => void refreshWorkspaceTaskbarPreview(), 250);
  bounds = signal.workspaceBounds.get(account.id) || bounds;
  activeSignalWindow = { account, bounds, visible: false };
});
authenticatedHandle("signal:set-window-visible", async (_event, account, visible, bounds) => {
  if (account.platform !== "signal") return;
  const requestGeneration = signalSelectionGeneration;
  const run = signalVisibilityIpcQueue.catch(() => void 0).then(async () => {
    if (visible && (requestGeneration !== signalSelectionGeneration || selectedSignalAccountId !== account.id)) return;
    if (visible && bounds) activeSignalWindow = { account, bounds, visible };
    else if (activeSignalWindow?.account.id === account.id) activeSignalWindow.visible = visible;
    if (visible && (mainWindow?.isMinimized() || signalMinimizedWithOwner)) {
      markSignalPresentationSuspended();
      signalMinimizedWithOwner = true;
      return;
    }
    const actualVisible = visible && !signalSuspendedWithMainWindow && canPresentSignalInWorkspace(account.id);
    const screenBounds = bounds ? toScreenBounds(bounds) : bounds;
    try {
      await signal.setVisible(account, actualVisible, screenBounds);
    } catch (error) {
      if (visible && selectedSignalAccountId !== account.id) {
        runtimeLog("Ignored stale Signal visibility failure", {
          accountId: account.id,
          message: error instanceof Error ? error.message : String(error)
        });
        await signal.setVisible(account, false, screenBounds, false, true).catch(() => void 0);
        return;
      }
      throw error;
    }
    if (actualVisible && selectedSignalAccountId !== account.id) {
      if (activeSignalWindow?.account.id === account.id) activeSignalWindow.visible = false;
      await signal.setVisible(account, false, screenBounds, false, true).catch((error) => {
        runtimeLog("Failed to hide stale Signal window after account switch", {
          accountId: account.id,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }
  });
  signalVisibilityIpcQueue = run.catch(() => void 0);
  await run;
});
authenticatedHandle("signal:update-desktop", async (_event, account) => {
  return updateSignalDesktopAndRestart(account);
});
authenticatedHandle("signal:update-desktop-status", () => signal.isBundledDesktopUpdateRunning());
authenticatedHandle("app-patch:check", () => appPatches.checkForUpdate());
authenticatedHandle("app-patch:download", () => appPatches.download());
authenticatedHandle("app-patch:apply", () => appPatches.applyDownloaded());
ipcMain.on("signal:move-window", (_event, account, visible, bounds) => {
  if (!workspaceUnlocked || !userAccount?.isAuthenticated()) return;
  if (_event.sender !== mainWindow?.webContents) return;
  if (account.platform !== "signal") return;
  if (visible && selectedSignalAccountId !== account.id) return;
  signal.workspaceBounds ??= new Map();
  signal.workspaceBounds.set(account.id, bounds);
  if (!signal.attachedWindows.has(account.id) || signal.workspaceAttaching?.has(account.id)) return;
  activeSignalWindow = { account, bounds, visible };
  if (visible && (mainWindow?.isMinimized() || signalMinimizedWithOwner)) {
    markSignalPresentationSuspended();
    signalMinimizedWithOwner = true;
    return;
  }
  const actualVisible = visible && !signalSuspendedWithMainWindow && canPresentSignalInWorkspace(account.id);
  void signal.setVisible(account, actualVisible, toScreenBounds(bounds)).catch(() => void 0);
});
authenticatedHandle("account:remove", async (_event, account) => {
  clearAccountUnreadState(account.id);
  try {
    if (account.platform === "signal") {
      if (activeSignalWindow?.account.id === account.id) activeSignalWindow = void 0;
      await signal.deleteAccount(account);
    } else if (account.platform === "googlevoice" || account.platform === "googlechat") await googleVoice.remove(account);
    else await webViews.remove(account);
  } finally {
    clearAccountUnreadState(account.id);
  }
});
authenticatedHandle("external:open", (_event, url) => shell.openExternal(url));
process.on("uncaughtException", (error) => {
  runtimeLog("uncaught exception", { message: error.message, stack: error.stack });
});
process.on("unhandledRejection", (reason) => {
  runtimeLog("unhandled rejection", reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason));
});
if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    presentMainWindow("second-instance");
  });
  app.whenReady().then(async () => {
    userAccount = new LocalWorkspaceAccess(() => {
      syncUserWorkspace();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("user-account:changed");
    });
    authenticatedHandle("user-account:status", () => userAccount.snapshot());
    authenticatedHandle("user-account:register", (_event, email, password) => userAccount.register(email, password));
    authenticatedHandle("user-account:verify-registration", (_event, email, code) => userAccount.verifyRegistration(email, code));
    authenticatedHandle("user-account:resend-registration", (_event, email) => userAccount.resendRegistration(email));
    authenticatedHandle("user-account:password-login", (_event, email, password) => userAccount.loginWithPassword(email, password));
    authenticatedHandle("user-account:login", () => userAccount.login());
    authenticatedHandle("user-account:refresh", () => userAccount.refresh());
    authenticatedHandle("user-account:logout", () => userAccount.logout());
    app.once("will-quit", () => userAccount.dispose());
    void userAccount.initialize();
    await createWindow();
  }).catch((error) => {
    runtimeLog("create window failed", error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
    dialog.showErrorBox(
      "Bi-Talks 启动失败",
      `程序未能完成初始化。现有账号数据未被重置。

${error instanceof Error ? error.message : String(error)}

数据目录：${portableDataRoot}`
    );
    shuttingDown = true;
    try {
      webViews?.shutdown();
      googleVoice?.shutdown();
      signal?.shutdown();
    } finally {
      app.exit(1);
    }
  });
}
app.on("browser-window-focus", (_event, window2) => {
  if (window2 === mainWindow) recoverAfterForeground();
});
nativeTheme.on("updated", () => applyAppearanceSurfaceColors());
powerMonitor.on("resume", () => recoverAfterForeground());
powerMonitor.on("unlock-screen", () => recoverAfterForeground());
app.on("render-process-gone", (_event, webContents, details) => {
  runtimeLog("render process gone", { id: webContents.id, ...details });
});
app.on("child-process-gone", (_event, details) => {
  runtimeLog("child process gone", details);
});
app.on("before-quit", (event) => {
  if(globalThis.__biTalksZoomSessions?.quitting && !globalThis.__biTalksZoomSessions.finished)return;
  runtimeLog("before quit", { shuttingDown });
  persistMainWindowState();
  persistUnreadCounts();
  if (!shuttingDown) {
    shuttingDown = true;
    webViews?.shutdown();
    googleVoice?.shutdown();
    signal?.shutdown();
  }
  if (!translationHistoryFlushStarted && translator) {
    event.preventDefault();
    translationHistoryFlushStarted = true;
    void translator.flushHistory().finally(() => app.quit());
  }
});
app.on("will-quit", () => {
  pauseGoogleRecovery();
  runtimeLog("will quit");
  persistMainWindowState();
  webViews?.shutdown();
  googleVoice?.shutdown();
  signal?.shutdown();
  tray?.destroy();
  tray = void 0;
});
app.on("window-all-closed", () => {
  runtimeLog("window all closed");
  app.quit();
});

function installSignalCaptchaCallback() {
  if (globalThis.__biSignalCaptchaCallback) return;
  globalThis.__biSignalCaptchaCallback = true;
  const pendingPath=join(localRuntimeRoot,'signal-verification-account.json');
  let pending, busy=false;
  const observedRequests=new Map();
  try{pending=JSON.parse(readFileSync(pendingPath,'utf8'));}catch{}
  const repairProtocol=()=>{
    if(process.platform!=='win32'||!app.isPackaged)return;
    const key='HKCU\\Software\\Classes\\signalcaptcha\\shell\\open\\command';
    const expected=`"${process.execPath}" "%1"`;
    const current=spawnSync('reg.exe',['query',key,'/ve'],{encoding:'utf8',windowsHide:true});
    if(current.status===0&&current.stdout.includes(expected))return;
    const result=spawnSync('reg.exe',['add',key,'/ve','/t','REG_SZ','/d',expected,'/f'],{encoding:'utf8',windowsHide:true});
    if(result.status!==0)runtimeLog('Signal verification protocol registration failed',{status:result.status});
  };
  const remember=async()=>{
    if(busy||!workspaceUnlocked||!signal)return;busy=true;
    try {
      const checks=await Promise.allSettled([...signal.translationBridge.connections].map(async([id,connection])=>{
        const result=await connection.call('Runtime.evaluate',{expression:`(()=>{if(!window.__biSignalVerificationClickWatchV3){window.__biSignalVerificationClickWatchV3=true;window.addEventListener('click',event=>{const button=event.target.closest?.('button');if(!button)return;const label=(button.textContent||'').trim();const modal=button.closest('[role="dialog"],[aria-modal="true"],.module-Modal,.module-modal');if(/^(通过验证|开始验证|Verify(?: now)?|Start verification)$/i.test(label)||(modal&&/验证|captcha|verification/i.test(modal.textContent||'')&&/^continue$/i.test(label)))window.__biSignalVerificationRequestedAt=Date.now();},true);}return window.__biSignalVerificationRequestedAt||0})()`,returnByValue:true},3000);
        return {id,at:Number(result.result?.value)||0};
      }));
      for(const check of checks){
        if(check.status!=='fulfilled')continue;
        const {id,at}=check.value;
        if(at>0&&at>(observedRequests.get(id)||0)){
          observedRequests.set(id,at);
          if(!pending||at>pending.at){pending={accountId:id,at};writeFileSync(pendingPath,JSON.stringify(pending));}
        }
      }
    }catch{}finally{busy=false;}
  };
  const route=async args=>{
    const uri=args.find(x=>typeof x==='string'&&/^signalcaptcha:\/\/[^\s\x00-\x1f]{1,16000}$/i.test(x));
    if(!uri)return;
    if(!workspaceUnlocked){dialog.showErrorBox('Signal 验证','请先打开 Bi-Talks，再返回浏览器完成验证。');return;}
    const account=pending&&Date.now()-pending.at<30*60*1000?store.get().accounts.find(a=>a.id===pending.accountId&&a.platform==='signal'):null;
    if(!account){dialog.showErrorBox('Signal 验证','未找到发起验证的账号。请回到该 Signal 账号，重新点击验证。');return;}
    const executable=findSignalDesktop(signal.runtimeRoot);
    if(!executable||!signal.managedProcesses.has(account.id)){dialog.showErrorBox('Signal 验证','请先打开需要验证的 Signal 账号，然后重试。');return;}
    const child=spawn(executable,[`--user-data-dir=${signal.managedDataDir(account)}`,uri],{detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,BI_TALKS_MANAGED_SIGNAL:'1'}});
    child.on('error',()=>dialog.showErrorBox('Signal 验证','验证结果未能交回 Signal，请重试。'));child.unref();
    const state=store.get();await store.set({...state,selectedPlatform:'signal',selectedAccountId:account.id,selectedAccountIdsByPlatform:{...state.selectedAccountIdsByPlatform,signal:account.id}});
    mainWindow?.webContents.send('app:event',{type:'state-updated',state:store.get()});presentMainWindow('signal-verification');
    pending=void 0;
    try{rmSync(pendingPath,{force:true});}catch{}
  };
  app.on('second-instance',(_event,args)=>{void route(args).catch(()=>runtimeLog('Signal verification callback failed'));});
  app.on('open-url',(event,url)=>{if(url.startsWith('signalcaptcha:')){event.preventDefault();void route([url]);}});
  app.setAsDefaultProtocolClient('signalcaptcha');
  repairProtocol();
  const timer=setInterval(()=>{void remember();},500);timer.unref();
  void remember();
  if(process.argv.some(x=>x.startsWith('signalcaptcha:')))setTimeout(()=>void route(process.argv),3000);
}
app.whenReady().then(()=>installSignalCaptchaCallback());

function installSignalNotes() {
 if(window.__biNotes)return;
 const preferenceKey='bi-talks.signal.notes.expanded.v1';
 let expanded=false;
 try{expanded=localStorage.getItem(preferenceKey)==='true';}catch{}
 const drafts=new Map(),requests=new Map();let seq=0,box,editor,label,toggle,panel,current='',timer;
 const send=(op,id,text)=>{const request=String(++seq);requests.set(request,{op,id,text});window.__biSignalNotesRequest(JSON.stringify({request,op,id,text}));return request;};
 const save=id=>{const d=drafts.get(id);if(!d?.dirty)return;d.dirty=false;send('save',id,d.text);if(id===current)label.textContent='保存中…';};
 const show=()=>{
  if(!box)return;
  box.dataset.expanded=String(expanded);panel.hidden=!expanded;
  toggle.textContent=expanded?'收起':'备注';
  toggle.title=expanded?'隐藏备注':'显示备注';
  toggle.setAttribute('aria-label',expanded?'隐藏联系人备注':'显示联系人备注');
  toggle.setAttribute('aria-expanded',String(expanded));
 };
 window.__biSignalNotesReply=r=>{const q=requests.get(r.request);if(!q)return;requests.delete(r.request);let d=drafts.get(q.id);
  if(!r.ok){if(d&&q.op==='save')d.dirty=true;if(q.id===current){label.textContent='保存失败，点击重试';editor.disabled=false;}return;}
  if(q.op==='load'){if(!d){d={text:r.text||'',dirty:false};drafts.set(q.id,d);}if(q.id===current){editor.value=d.text;editor.disabled=false;label.textContent='';}}
  else if(q.id===current&&d?.text===q.text)label.textContent='';
 };
 const mount=header=>{
  box=document.createElement('div');box.dataset.biNotes='true';
  box.style.cssText='margin:0 8px;position:relative;align-self:center;-webkit-app-region:no-drag;';
  const shadow=box.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
   :host{display:flex!important;align-items:center;gap:6px;flex:0 0 44px!important;width:44px!important;min-width:0!important;max-width:45%!important;height:44px!important;color:var(--note-fg)}
   :host([data-expanded="true"]){flex:0 1 var(--notes-width,460px)!important;width:var(--notes-width,460px)!important}
   button{color:var(--note-fg);cursor:pointer;font:13px/1.2 sans-serif;box-sizing:border-box}
   .toggle{flex:0 0 44px;width:44px;height:30px;border:1px solid #8886;border-radius:6px;background:var(--note-bg);padding:0 4px;white-space:nowrap}
   .toggle:hover{border-color:#687cff}.toggle:focus-visible{outline:2px solid #687cff;outline-offset:2px}
   .panel{position:relative;flex:1 1 auto;min-width:0;height:44px}.panel[hidden]{display:none!important}
   textarea{display:block;width:100%;height:44px;box-sizing:border-box;resize:none;border:1px solid #8886;border-radius:6px;padding:5px 8px 14px;font:15px/18px sans-serif;background:var(--note-bg);color:var(--note-fg);outline:none}
   textarea:focus{height:min(360px,55vh);border-color:#687cff;position:absolute;top:0;left:0;z-index:100;box-shadow:0 4px 12px #0004}
   textarea::placeholder{color:var(--note-fg);opacity:.55}
   .status{display:block;position:absolute;right:4px;bottom:1px;max-width:100%;height:12px;padding:0 4px;border:0;background:var(--note-bg);font-size:10px;opacity:.75}
  </style><button class="toggle" type="button" aria-controls="note-panel"></button><div class="panel" id="note-panel" hidden><textarea aria-label="联系人备注 note" placeholder="添加备注…" maxlength="10000" spellcheck="false"></textarea><button class="status" type="button" aria-live="polite"></button></div>`;
  editor=shadow.querySelector('textarea');label=shadow.querySelector('.status');toggle=shadow.querySelector('.toggle');panel=shadow.querySelector('.panel');
  for(const type of ['keydown','keyup','keypress','click','mousedown','input'])box.addEventListener(type,e=>e.stopPropagation());
  editor.addEventListener('input',()=>{const id=current;drafts.set(id,{text:editor.value,dirty:true});label.textContent='保存中…';clearTimeout(timer);timer=setTimeout(()=>save(id),450);});
  editor.addEventListener('blur',()=>save(current));label.onclick=()=>save(current);
  toggle.onclick=()=>{
   if(expanded){save(current);if(shadow.activeElement===editor)editor.blur();}
   expanded=!expanded;try{localStorage.setItem(preferenceKey,String(expanded));}catch{}
   show();
  };
  header.insertBefore(box,header.lastElementChild);current='';show();
 };
 const scan=()=>{const header=[...document.querySelectorAll('.module-ConversationHeader')].find(e=>e.getBoundingClientRect().width>0);const id=header?.closest('[id^="conversation-"]')?.id.slice(13);
  if(!id){if(current)save(current);box?.remove();box=null;current='';return;}
  if(!box?.isConnected||box.parentElement!==header){if(current)save(current);box?.remove();mount(header);}
  const dark=document.body.classList.contains('dark-theme');box.style.setProperty('--note-fg',dark?'#fff':'#000');box.style.setProperty('--note-bg',dark?'#262626':'#fff');
  box.style.setProperty('--notes-width',Math.min(460,Math.floor(header.getBoundingClientRect().width*.45))+'px');
  if(current!==id){if(current)save(current);current=id;const d=drafts.get(id);editor.value=d?.text||'';editor.disabled=!d;label.textContent=d?'':'加载中…';if(!d)send('load',id);}
 };
 let scheduled=false;const schedule=()=>{if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;scan();},60);};
 const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','id']});
 window.addEventListener('resize',schedule);window.addEventListener('beforeunload',()=>{for(const id of drafts.keys())save(id)});
 window.__biNotes={scan};scan();
}

function installSignalNotesBridge() {
 if(globalThis.__biNotesBridge)return;globalThis.__biNotesBridge=true;
 const installed=new WeakSet();
 const handle=async(session2,connection,message)=>{
  if(session2.cancelled)return;
  let q;try{q=JSON.parse(message.params.payload);if(!['load','save'].includes(q.op)||typeof q.request!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(q.id)||q.op==='save'&&(typeof q.text!=='string'||q.text.length>10000))return;}catch{return;}
  let reply={request:q.request,ok:false};
  try{
   const dir=join(portableDataRoot,'contact-notes');mkdirSync(dir,{recursive:true});
   const file=join(dir,createHash('sha256').update(JSON.stringify([session2.account.id,q.id])).digest('hex')+'.enc');
   if(q.op==='save'){if(!safeStorage.isEncryptionAvailable())throw Error('Encryption unavailable');const tmp=file+'.tmp';writeFileSync(tmp,safeStorage.encryptString(q.text));renameSync(tmp,file);reply.ok=true;}
   else {reply.text=existsSync(file)?safeStorage.decryptString(readFileSync(file)):'';reply.ok=true;}
  }catch{runtimeLog('Signal contact note storage failed',{operation:q.op});}
  await connection.call('Runtime.evaluate',{expression:`window.__biSignalNotesReply?.(${JSON.stringify(reply)})`,contextId:message.params.executionContextId}).catch(()=>{});
 };
 const original=signal.translationBridge.handleEvent;
 signal.translationBridge.handleEvent=function(session2,connection,message){if(message.method==='Runtime.bindingCalled'&&message.params?.name==='__biSignalNotesRequest')return handle(session2,connection,message);return original.call(this,session2,connection,message);};
 const source=`(${installSignalNotes.toString()})();`;
 let busy=false;const tick=async()=>{if(busy)return;busy=true;try{for(const c of signal.translationBridge.connections.values()){if(installed.has(c))continue;await c.call('Runtime.addBinding',{name:'__biSignalNotesRequest'});await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{${source}} ,{once:true});else {${source}}`});const r=await c.call('Runtime.evaluate',{expression:source});if(r.exceptionDetails)throw Error('Notes injection failed');installed.add(c);}}catch{runtimeLog('Signal contact notes waiting for page');}finally{busy=false;}};
 const interval=setInterval(tick,1500);interval.unref();void tick();
}

app.whenReady().then(()=>{const wait=setInterval(()=>{if(signal?.translationBridge){clearInterval(wait);installSignalNotesBridge();}},1000);wait.unref();});

setInterval(syncNativeNotificationState,500).unref();




