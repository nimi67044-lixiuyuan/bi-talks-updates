import { app, safeStorage, WebContentsView, shell, session, ipcMain, nativeTheme, powerMonitor, Menu, BrowserWindow, screen, nativeImage, Tray } from "electron";
import { existsSync, promises, readFileSync, rmSync, createWriteStream, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname, resolve, basename, sep, isAbsolute } from "node:path";
import { deflateSync } from "node:zlib";
import { createHash, createPublicKey, verify } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { rm as rm$1, createReadStream } from "node:original-fs";
import { get } from "node:http";
import { get as get$1 } from "node:https";
import { readFile, mkdir, appendFile, stat, rm, rename, writeFile, link, copyFile, readdir, lstat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const groqChatCompletionsEndpoint = "https://api.groq.com/openai/v1/chat/completions";
const defaultGroqApiKeyConfig = {
  id: "primary",
  name: "主 Key",
  projectId: "default",
  apiKey: "",
  enabled: true
};
const defaultGroqApiConfig = {
  apiKeys: [structuredClone(defaultGroqApiKeyConfig)],
  model: "qwen/qwen3.6-27b",
  timeoutSeconds: 30,
  maxConcurrencyPerProject: 2
};
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
  if ("kitoolApiKey" in settingsRecord) settingsRecord.kitoolApiKey = transformSecret(settingsRecord.kitoolApiKey, transform);
  const groqApi = settingsRecord.groqApi;
  if (groqApi && typeof groqApi === "object") {
    const groqApiRecord = groqApi;
    if ("apiKey" in groqApiRecord) groqApiRecord.apiKey = transformSecret(groqApiRecord.apiKey, transform);
    if (Array.isArray(groqApiRecord.apiKeys)) {
      for (const entry of groqApiRecord.apiKeys) {
        if (!entry || typeof entry !== "object") continue;
        const keyRecord = entry;
        if ("apiKey" in keyRecord) keyRecord.apiKey = transformSecret(keyRecord.apiKey, transform);
      }
    }
  }
  const customApi = settingsRecord.customApi;
  if (customApi && typeof customApi === "object") {
    const customApiRecord = customApi;
    if ("apiKey" in customApiRecord) customApiRecord.apiKey = transformSecret(customApiRecord.apiKey, transform);
    if ("customHeaders" in customApiRecord) customApiRecord.customHeaders = transformSecret(customApiRecord.customHeaders, transform);
  }
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
const maximumUsage = Number.MAX_SAFE_INTEGER;
function localDayKey(date = /* @__PURE__ */ new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function apiKeyFingerprint(apiKey) {
  const normalized = apiKey.trim();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}
function unicodeCharacterCount(text) {
  return Array.from(text).length;
}
function usageNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(maximumUsage, Math.floor(value));
}
function emptyApiUsage(day = localDayKey()) {
  return {
    totalCharacters: 0,
    dailyCharacters: 0,
    totalInputTokens: 0,
    dailyInputTokens: 0,
    totalOutputTokens: 0,
    dailyOutputTokens: 0,
    totalTokens: 0,
    dailyTokens: 0,
    day
  };
}
function normalizeApiUsage(value, today = localDayKey()) {
  const source = value && typeof value === "object" ? value : {};
  const isToday = source.day === today;
  return {
    totalCharacters: usageNumber(source.totalCharacters),
    dailyCharacters: isToday ? usageNumber(source.dailyCharacters) : 0,
    totalInputTokens: usageNumber(source.totalInputTokens),
    dailyInputTokens: isToday ? usageNumber(source.dailyInputTokens) : 0,
    totalOutputTokens: usageNumber(source.totalOutputTokens),
    dailyOutputTokens: isToday ? usageNumber(source.dailyOutputTokens) : 0,
    totalTokens: usageNumber(source.totalTokens),
    dailyTokens: isToday ? usageNumber(source.dailyTokens) : 0,
    day: today
  };
}
function addUsage(current, increment) {
  return Math.min(maximumUsage, current + increment);
}
function addApiUsage(value, increment, today = localDayKey()) {
  const usage = normalizeApiUsage(value, today);
  const characters = usageNumber(increment.characters);
  const inputTokens = usageNumber(increment.inputTokens);
  const outputTokens = usageNumber(increment.outputTokens);
  const reportedTotalTokens = usageNumber(increment.totalTokens);
  const totalTokens = reportedTotalTokens || Math.min(maximumUsage, inputTokens + outputTokens);
  return {
    totalCharacters: addUsage(usage.totalCharacters, characters),
    dailyCharacters: addUsage(usage.dailyCharacters, characters),
    totalInputTokens: addUsage(usage.totalInputTokens, inputTokens),
    dailyInputTokens: addUsage(usage.dailyInputTokens, inputTokens),
    totalOutputTokens: addUsage(usage.totalOutputTokens, outputTokens),
    dailyOutputTokens: addUsage(usage.dailyOutputTokens, outputTokens),
    totalTokens: addUsage(usage.totalTokens, totalTokens),
    dailyTokens: addUsage(usage.dailyTokens, totalTokens),
    day: today
  };
}
const translationColors = /* @__PURE__ */ new Set(["#ff4d4f", "#fa8c16", "#d8ff00", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"]);
function addUsageValues(values) {
  return Math.min(Number.MAX_SAFE_INTEGER, values.reduce((total, value) => total + value, 0));
}
function combineApiUsage(values, today = localDayKey()) {
  const usages = values.map((value) => normalizeApiUsage(value, today));
  return {
    totalCharacters: addUsageValues(usages.map((usage) => usage.totalCharacters)),
    dailyCharacters: addUsageValues(usages.map((usage) => usage.dailyCharacters)),
    totalInputTokens: addUsageValues(usages.map((usage) => usage.totalInputTokens)),
    dailyInputTokens: addUsageValues(usages.map((usage) => usage.dailyInputTokens)),
    totalOutputTokens: addUsageValues(usages.map((usage) => usage.totalOutputTokens)),
    dailyOutputTokens: addUsageValues(usages.map((usage) => usage.dailyOutputTokens)),
    totalTokens: addUsageValues(usages.map((usage) => usage.totalTokens)),
    dailyTokens: addUsageValues(usages.map((usage) => usage.dailyTokens)),
    day: today
  };
}
function normalizeApiUsageByProvider(value, groqKeys) {
  const source = value && typeof value === "object" ? value : {};
  const rawByKey = source.groqByKey && typeof source.groqByKey === "object" ? source.groqByKey : {};
  const hasPerKeyUsage = Object.keys(rawByKey).length > 0;
  const legacyGroqUsage = normalizeApiUsage(source.groq ?? source.customAi ?? source.kitool);
  const groqByKey = Object.fromEntries(groqKeys.map((key, index) => {
    const fingerprint = apiKeyFingerprint(key.apiKey);
    const rawEntry = rawByKey[key.id] && typeof rawByKey[key.id] === "object" ? rawByKey[key.id] : void 0;
    const usage = rawEntry?.keyFingerprint === fingerprint ? normalizeApiUsage(rawEntry.usage) : !hasPerKeyUsage && index === 0 ? legacyGroqUsage : emptyApiUsage();
    return [key.id, { keyFingerprint: fingerprint, usage }];
  }));
  return {
    groq: combineApiUsage(Object.values(groqByKey).map((entry) => entry.usage)),
    deepl: normalizeApiUsage(source.deepl),
    groqByKey
  };
}
const initialState = {
  platformOrder: ["signal", "whatsapp", "telegram", "googlevoice"],
  accounts: [],
  accountOrder: { signal: [], whatsapp: [], telegram: [], googlevoice: [] },
  selectedPlatform: "signal",
  selectedAccountIdsByPlatform: {},
  settings: {
    incomingTarget: "zh",
    themeMode: "system",
    translationProvider: "deepl",
    groqApi: structuredClone(defaultGroqApiConfig),
    deeplApiKey: "",
    apiUsage: {
      groq: emptyApiUsage(),
      deepl: emptyApiUsage(),
      groqByKey: {
        [defaultGroqApiKeyConfig.id]: {
          keyFingerprint: "",
          usage: emptyApiUsage()
        }
      }
    },
    translationSizeDefaultVersion: 3,
    platformLayoutVersion: 14
  }
};
function normalizeThemeMode(value) {
  return value === "light" || value === "dark" || value === "system" ? value : initialState.settings.themeMode;
}
function normalizeTranslationProvider(value) {
  if (value === "kitool" || value === "custom-ai") return "groq";
  return value === "groq" || value === "deepl" ? value : initialState.settings.translationProvider;
}
function normalizeGroqApiConfig(value, legacyCustomApi) {
  const source = value && typeof value === "object" ? value : {};
  const legacy = legacyCustomApi && typeof legacyCustomApi === "object" ? legacyCustomApi : {};
  const legacyBaseUrl = typeof legacy.baseUrl === "string" ? legacy.baseUrl.trim().toLowerCase() : "";
  const legacyWasGroq = legacy.preset === "groq" || legacyBaseUrl.includes("api.groq.com");
  const migratedApiKey = typeof source.apiKey === "string" && source.apiKey.trim() ? source.apiKey.trim() : legacyWasGroq && typeof legacy.apiKey === "string" ? legacy.apiKey.trim() : "";
  const migratedModel = legacyWasGroq && typeof legacy.model === "string" ? legacy.model.trim() : "";
  const rawKeys = Array.isArray(source.apiKeys) ? source.apiKeys.slice(0, 20) : [];
  const seenIds = /* @__PURE__ */ new Set();
  const apiKeys = rawKeys.flatMap((value2, index) => {
    if (!value2 || typeof value2 !== "object") return [];
    const record = value2;
    const requestedId = typeof record.id === "string" ? record.id.trim().slice(0, 80) : "";
    const safeRequestedId = /^[A-Za-z0-9._-]+$/.test(requestedId) ? requestedId : `key-${index + 1}`;
    let id = safeRequestedId || `key-${index + 1}`;
    let suffix = 2;
    while (seenIds.has(id)) id = `${safeRequestedId || `key-${index + 1}`}-${suffix++}`;
    seenIds.add(id);
    return [{
      id,
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 50) : `Key ${index + 1}`,
      projectId: typeof record.projectId === "string" && record.projectId.trim() ? record.projectId.trim().slice(0, 100) : "default",
      apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : "",
      enabled: record.enabled !== false
    }];
  });
  if (!apiKeys.length) apiKeys.push({ ...defaultGroqApiKeyConfig, apiKey: migratedApiKey });
  else if (migratedApiKey && apiKeys.every((key) => !key.apiKey)) apiKeys[0].apiKey = migratedApiKey;
  return {
    apiKeys,
    model: typeof source.model === "string" && source.model.trim() ? source.model.trim() : migratedModel || defaultGroqApiConfig.model,
    timeoutSeconds: clampNumber(source.timeoutSeconds ?? legacy.timeoutSeconds, 5, 120, defaultGroqApiConfig.timeoutSeconds),
    maxConcurrencyPerProject: clampNumber(source.maxConcurrencyPerProject, 1, 6, defaultGroqApiConfig.maxConcurrencyPerProject)
  };
}
function clampNumber(value, min, max, fallback) {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
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
    hidden: account.platform === "telegram" && account.hidden === true
  };
}
function normalizeState(state) {
  const legacySettings = state.settings;
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
    const isSelectable = (account) => account.platform === platform && !(platform === "telegram" && account.hidden);
    const legacySelectedId = platform === selectedPlatform && state.selectedAccountId && accounts.some((account) => account.id === state.selectedAccountId && isSelectable(account)) ? state.selectedAccountId : void 0;
    const rememberedId = selectedAccountIdsInput[platform];
    const validRememberedId = rememberedId && accounts.some((account) => account.id === rememberedId && isSelectable(account)) ? rememberedId : void 0;
    const selectedId = legacySelectedId || validRememberedId || accountOrder[platform].find((id) => accounts.some((account) => account.id === id && isSelectable(account)));
    return selectedId ? [[platform, selectedId]] : [];
  }));
  const selectedAccountId = selectedAccountIdsByPlatform[selectedPlatform] || accountOrder[selectedPlatform].find((id) => accounts.some((account) => account.id === id && !(account.platform === "telegram" && account.hidden)));
  const groqApi = normalizeGroqApiConfig(state.settings.groqApi, legacySettings.customApi);
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
      translationProvider: normalizeTranslationProvider(legacySettings.translationProvider),
      groqApi,
      deeplApiKey: typeof state.settings.deeplApiKey === "string" ? state.settings.deeplApiKey.trim() : "",
      apiUsage: normalizeApiUsageByProvider(state.settings.apiUsage, groqApi.apiKeys),
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
  async recordTranslationUsage(provider, increment) {
    if (provider !== "groq" && provider !== "deepl") return this.get();
    const today = localDayKey();
    if (provider === "groq") {
      const key = this.state.settings.groqApi.apiKeys.find((candidate) => candidate.id === increment.keyId && apiKeyFingerprint(candidate.apiKey) === increment.keyFingerprint) || this.state.settings.groqApi.apiKeys.find((candidate) => apiKeyFingerprint(candidate.apiKey) === increment.keyFingerprint);
      if (!key || !increment.keyFingerprint) return this.get();
      const previousByKey = this.state.settings.apiUsage.groqByKey || {};
      const updatedKeyUsage = addApiUsage(previousByKey[key.id]?.usage, increment, today);
      const groqByKey = {
        ...previousByKey,
        [key.id]: { keyFingerprint: increment.keyFingerprint, usage: updatedKeyUsage }
      };
      await this.set({
        ...this.state,
        settings: {
          ...this.state.settings,
          apiUsage: {
            ...this.state.settings.apiUsage,
            groq: combineApiUsage(Object.values(groqByKey).map((entry) => entry.usage), today),
            groqByKey
          }
        }
      });
      return this.get();
    }
    const currentApiKey = this.state.settings.deeplApiKey || "";
    if (!increment.keyFingerprint || increment.keyFingerprint !== apiKeyFingerprint(currentApiKey)) return this.get();
    const updatedUsage = addApiUsage(this.state.settings.apiUsage.deepl, increment, today);
    await this.set({
      ...this.state,
      settings: {
        ...this.state.settings,
        apiUsage: {
          ...this.state.settings.apiUsage,
          deepl: updatedUsage
        }
      }
    });
    return this.get();
  }
  async set(next) {
    const previousSettings = this.state.settings;
    const normalized = normalizeState(structuredClone(next));
    const today = localDayKey();
    if (apiKeyFingerprint(previousSettings.deeplApiKey || "") !== apiKeyFingerprint(normalized.settings.deeplApiKey || "")) {
      normalized.settings.apiUsage.deepl = emptyApiUsage(today);
    }
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
function groqProjectIdentity(value) {
  return value.trim().toLowerCase() || "default";
}
function groupEnabledGroqApiKeys(keys) {
  const groups = /* @__PURE__ */ new Map();
  for (const key of keys) {
    if (!key.enabled || !key.apiKey.trim()) continue;
    const projectId = groqProjectIdentity(key.projectId);
    const projectKeys = groups.get(projectId) || [];
    projectKeys.push(key);
    groups.set(projectId, projectKeys);
  }
  return [...groups].map(([projectId, projectKeys]) => ({ projectId, keys: projectKeys }));
}
function rotateGroqProjectGroups(groups, cursor) {
  if (groups.length < 2) return groups;
  const start = (cursor % groups.length + groups.length) % groups.length;
  return [...groups.slice(start), ...groups.slice(0, start)];
}
class ProjectGate {
  active = 0;
  queue = [];
  acquire(limit) {
    const normalizedLimit = Math.max(1, Math.floor(limit));
    return new Promise((resolve2) => {
      this.queue.push({ limit: normalizedLimit, resolve: resolve2 });
      this.drain();
    });
  }
  drain() {
    while (this.queue.length && this.active < this.queue[0].limit) {
      const waiter = this.queue.shift();
      if (!waiter) return;
      this.active += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active = Math.max(0, this.active - 1);
        this.drain();
      });
    }
  }
}
class GroqProjectLimiter {
  gates = /* @__PURE__ */ new Map();
  async run(projectId, limit, task) {
    const identity = groqProjectIdentity(projectId);
    let gate = this.gates.get(identity);
    if (!gate) {
      gate = new ProjectGate();
      this.gates.set(identity, gate);
    }
    const release = await gate.acquire(limit);
    try {
      return await task();
    } finally {
      release();
    }
  }
}
const qwen36Model = "qwen/qwen3.6-27b";
const groqTranslationMaxCompletionTokens = 4096;
function groqTranslationReasoningOptions(model) {
  if (model.trim().toLowerCase() !== qwen36Model) return {};
  return {
    reasoning_effort: "none",
    reasoning_format: "hidden"
  };
}
function extractGroqTranslation(content) {
  const value = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "").join("") : "";
  const withoutCompleteReasoning = value.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/giu, "");
  const unclosedReasoningStart = withoutCompleteReasoning.search(/<think\b[^>]*>/iu);
  return (unclosedReasoningStart >= 0 ? withoutCompleteReasoning.slice(0, unclosedReasoningStart) : withoutCompleteReasoning).trim();
}
const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const deeplFreeTranslateEndpoint = "https://api-free.deepl.com/v2/translate";
const deeplProTranslateEndpoint = "https://api.deepl.com/v2/translate";
const maxTranslationChunkLength = 1300;
const paragraphConcurrency = 10;
const apiTestMinimumIntervalMs = 1500;
const apiTestFallbackRetryDelayMs = 1500;
const apiTestMaximumAutomaticRetryDelayMs = 5e3;
const emojiSequence = new RegExp("(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|\\p{Extended_Pictographic}(?:\\uFE0F|\\p{Emoji_Modifier}|\\u200D\\p{Extended_Pictographic})*)", "gu");
class ApiRequestError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = "ApiRequestError";
  }
}
function parseRetryAfterMs(value) {
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1e3);
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return void 0;
  return Math.max(0, retryAt - Date.now());
}
function wait(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}
function preserveOriginalEmoji(source, translated) {
  const original = source.match(emojiSequence) || [];
  if (!original.length || !translated) return translated;
  let remaining = translated;
  const missing = [];
  for (const emoji of original) {
    const index = remaining.indexOf(emoji);
    if (index < 0) missing.push(emoji);
    else remaining = `${remaining.slice(0, index)}${remaining.slice(index + emoji.length)}`;
  }
  return missing.length ? `${translated.trim()} ${missing.join("")}` : translated;
}
class Translator {
  constructor(settings, onApiUsage, onApiFailure, history) {
    this.settings = settings;
    this.onApiUsage = onApiUsage;
    this.onApiFailure = onApiFailure;
    this.history = history;
    void this.settings;
  }
  cache = /* @__PURE__ */ new Map();
  inFlight = /* @__PURE__ */ new Map();
  apiFailureCounts = /* @__PURE__ */ new Map();
  apiTestsInFlight = /* @__PURE__ */ new Map();
  apiTestLastRequestAt = /* @__PURE__ */ new Map();
  groqInvalidKeys = /* @__PURE__ */ new Map();
  groqProjectCooldownUntil = /* @__PURE__ */ new Map();
  groqProjectCursor = 0;
  groqProjectLimiter = new GroqProjectLimiter();
  async testApi(provider, apiKey, groqConfig) {
    const identity = this.apiTestIdentity(provider, apiKey, groqConfig);
    const pending = this.apiTestsInFlight.get(identity);
    if (pending) return pending;
    const request = this.runApiTest(identity, provider, apiKey, groqConfig).finally(() => this.apiTestsInFlight.delete(identity));
    this.apiTestsInFlight.set(identity, request);
    return request;
  }
  async runApiTest(identity, provider, apiKey, groqConfig) {
    const sample = "Bi-Talks API test";
    try {
      if (provider === "groq") this.groqInvalidKeys.delete(apiKeyFingerprint(apiKey));
      await this.waitForApiTestWindow(identity);
      const usage = await this.requestApiTestWithRateLimitRetry(provider, apiKey, sample, groqConfig);
      await this.recordApiUsage(provider, usage).catch(() => void 0);
      return { ok: true, provider, message: `${this.providerName(provider)} API 验证成功。` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        provider,
        message: `${this.providerName(provider)} API 验证失败：${detail}`
      };
    }
  }
  apiTestIdentity(provider, apiKey, groqConfig) {
    const config = provider === "groq" ? this.groqApiTestConfig(apiKey, groqConfig) : { apiKey: apiKey.trim() };
    return createHash("sha256").update(JSON.stringify({ provider, config })).digest("hex");
  }
  async waitForApiTestWindow(identity) {
    const previous = this.apiTestLastRequestAt.get(identity) || 0;
    const remaining = apiTestMinimumIntervalMs - (Date.now() - previous);
    if (remaining > 0) await wait(remaining);
    this.apiTestLastRequestAt.set(identity, Date.now());
    if (this.apiTestLastRequestAt.size > 50) {
      const oldest = this.apiTestLastRequestAt.keys().next().value;
      if (oldest) this.apiTestLastRequestAt.delete(oldest);
    }
  }
  async requestApiTestWithRateLimitRetry(provider, apiKey, sample, groqConfig) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (provider === "deepl") {
          await this.translateWithDeepL(sample, "zh-CN", apiKey.trim());
          return {
            characters: unicodeCharacterCount(sample),
            keyFingerprint: apiKeyFingerprint(apiKey)
          };
        }
        if (provider === "groq") {
          const config = this.groqApiTestConfig(apiKey, groqConfig);
          const result = await this.translateWithGroq(sample, "zh-CN", config);
          return {
            ...result.usage,
            keyId: result.keyId,
            keyFingerprint: result.keyFingerprint
          };
        }
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status !== 429 || attempt > 0) throw error;
        const retryDelay = error.retryAfterMs ?? apiTestFallbackRetryDelayMs;
        if (retryDelay > apiTestMaximumAutomaticRetryDelayMs) {
          const seconds = Math.max(1, Math.ceil(retryDelay / 1e3));
          throw new Error(`${error.message}，请约 ${seconds} 秒后再测试。`);
        }
        await wait(Math.max(250, retryDelay));
      }
    }
    throw new Error("API 测试未返回用量信息。");
  }
  async translate(text, target, source = "auto") {
    return this.translateWithSettings(text, target, source, this.settings());
  }
  async translateWithSettings(text, target, source, settings) {
    const clean = text.trim();
    if (!clean) return "";
    const normalizedTarget = this.normalizeTarget(target);
    const normalizedSource = this.normalizeSource(source);
    if (normalizedTarget === "zh-CN" && cjk.test(clean) && !/[A-Za-z]/.test(clean)) return clean;
    const providerIdentity = this.providerCacheIdentity(settings);
    const key = `${providerIdentity}:${normalizedSource}:${normalizedTarget}:${clean}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const request = this.translateWithHistory(
      providerIdentity,
      clean,
      normalizedTarget,
      normalizedSource,
      settings
    ).then((translated) => {
      const result = preserveOriginalEmoji(clean, translated.trim());
      if (result) this.cache.set(key, result);
      if (this.cache.size > 1200) this.cache.delete(this.cache.keys().next().value);
      return result;
    }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }
  async flushHistory() {
    await this.history?.flush();
  }
  async translateWithHistory(providerIdentity, text, target, source, settings) {
    const historical = await this.history?.get(providerIdentity, source, target, text);
    if (historical) return historical;
    const translated = await this.translateWithParagraphs(text, target, source, settings);
    if (translated.trim()) this.history?.remember(providerIdentity, source, target, text, translated);
    return translated;
  }
  async translateWithParagraphs(text, target, source, settings) {
    const parts = text.split(/(\r?\n+)/);
    if (parts.length === 1) return this.translateLongPart(text, target, source, settings);
    const translatedParts = [...parts];
    const jobs = parts.map((part, index) => ({ part, index })).filter(({ part }) => part.trim());
    let cursor = 0;
    const workerCount = Math.min(paragraphConcurrency, jobs.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        try {
          translatedParts[job.index] = await this.translateLongPart(job.part.trim(), target, source, settings);
        } catch {
          translatedParts[job.index] = job.part;
        }
      }
    }));
    return translatedParts.join("").trim();
  }
  async translateLongPart(text, target, source, settings) {
    const chunks = this.chunkText(text, maxTranslationChunkLength);
    if (chunks.length === 1) return this.translateChunk(chunks[0], target, source, settings);
    const translated = [];
    for (const chunk of chunks) {
      try {
        translated.push(await this.translateChunk(chunk, target, source, settings));
      } catch {
        translated.push(chunk);
      }
    }
    return translated.join(target === "zh-CN" ? "" : " ").trim();
  }
  chunkText(text, maxLength) {
    if (text.length <= maxLength) return [text];
    const chunks = [];
    let current = "";
    for (const token of text.split(/(\s+)/)) {
      if (!token) continue;
      if ((current + token).length <= maxLength) {
        current += token;
        continue;
      }
      if (current.trim()) chunks.push(current.trim());
      if (token.length > maxLength) {
        for (let index = 0; index < token.length; index += maxLength) chunks.push(token.slice(index, index + maxLength));
        current = "";
      } else {
        current = token;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }
  async translateChunk(text, target, source, settings) {
    const provider = settings.translationProvider;
    try {
      if (provider === "deepl") {
        const apiKey = settings.deeplApiKey || "";
        const translated = await this.translateWithDeepL(text, target, apiKey, source);
        this.apiFailureCounts.delete("deepl");
        void this.recordApiUsage("deepl", {
          characters: unicodeCharacterCount(text),
          keyFingerprint: apiKeyFingerprint(apiKey)
        }).catch(() => void 0);
        return translated;
      }
      const result = await this.translateWithGroq(text, target, settings.groqApi, source);
      this.apiFailureCounts.delete("groq");
      void this.recordApiUsage("groq", {
        ...result.usage,
        keyId: result.keyId,
        keyFingerprint: result.keyFingerprint
      }).catch(() => void 0);
      return result.translated;
    } catch (error) {
      this.recordApiFailure(provider);
      throw error;
    }
  }
  recordApiFailure(provider) {
    const failures = (this.apiFailureCounts.get(provider) || 0) + 1;
    this.apiFailureCounts.set(provider, failures);
    if (failures === 4) this.onApiFailure?.(provider);
  }
  async recordApiUsage(provider, increment) {
    const amount = provider === "deepl" ? increment.characters || 0 : increment.totalTokens || (increment.inputTokens || 0) + (increment.outputTokens || 0);
    if (amount > 0) await this.onApiUsage?.(provider, increment);
  }
  providerName(provider) {
    if (provider === "deepl") return "DeepL";
    if (provider === "groq") return "Groq";
    return provider;
  }
  async translateWithDeepL(text, target, apiKey, source = "auto") {
    if (!apiKey) throw new Error("DeepL API Key 未配置。");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15e3);
    try {
      const endpoint = apiKey.endsWith(":fx") ? deeplFreeTranslateEndpoint : deeplProTranslateEndpoint;
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `DeepL-Auth-Key ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          text: [text],
          target_lang: this.deepLTarget(target),
          ...source === "auto" ? {} : { source_lang: this.deepLTarget(source) }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiRequestError(
          payload.message || `DeepL API 请求失败：${response.status}`,
          response.status,
          parseRetryAfterMs(response.headers.get("retry-after"))
        );
      }
      const translated = payload.translations?.[0]?.text?.trim() || "";
      if (!translated) throw new Error("DeepL API 返回了空结果。");
      return translated;
    } finally {
      clearTimeout(timeout);
    }
  }
  groqApiTestConfig(apiKey, groqConfig) {
    const current = this.settings().groqApi;
    const suppliedKeys = Array.isArray(groqConfig?.apiKeys) ? groqConfig.apiKeys : [];
    const supplied = suppliedKeys.find((key2) => key2.apiKey.trim() === apiKey.trim()) || suppliedKeys[0];
    const key = {
      id: supplied?.id || "api-test",
      name: supplied?.name || "API 测试",
      projectId: supplied?.projectId || "api-test",
      apiKey: apiKey.trim(),
      enabled: true
    };
    return {
      ...current,
      ...groqConfig,
      apiKeys: [key],
      model: String(groqConfig?.model || current.model).trim(),
      timeoutSeconds: Math.min(120, Math.max(5, Math.round(groqConfig?.timeoutSeconds || current.timeoutSeconds || 30))),
      maxConcurrencyPerProject: 1
    };
  }
  async translateWithGroq(text, target, config, source = "auto") {
    const model = config.model.trim();
    if (!model) throw new Error("Groq 模型名称未配置。");
    const groups = groupEnabledGroqApiKeys(config.apiKeys);
    if (!groups.length) throw new Error("Groq API Key 未配置或没有已启用的 Key。");
    const prompt = this.translationPrompt(target, source);
    const timeoutMs = Math.min(120, Math.max(5, Math.round(config.timeoutSeconds || 30))) * 1e3;
    const deadline = Date.now() + timeoutMs;
    const concurrency = Math.min(6, Math.max(1, Math.round(config.maxConcurrencyPerProject || 2)));
    const orderedGroups = rotateGroqProjectGroups(groups, this.groqProjectCursor++);
    let lastError;
    for (let pass = 0; pass < 2; pass += 1) {
      const now = Date.now();
      const availableGroups = orderedGroups.filter((group) => (this.groqProjectCooldownUntil.get(group.projectId) || 0) <= now);
      if (!availableGroups.length) {
        const retryAt = Math.min(...orderedGroups.map((group) => this.groqProjectCooldownUntil.get(group.projectId) || now));
        const retryDelay2 = Math.max(250, retryAt - now);
        if (pass === 0 && retryDelay2 <= apiTestMaximumAutomaticRetryDelayMs && now + retryDelay2 < deadline) {
          await wait(retryDelay2);
          continue;
        }
        throw lastError instanceof Error ? lastError : new ApiRequestError(`Groq 项目请求频率已达上限，请约 ${Math.max(1, Math.ceil(retryDelay2 / 1e3))} 秒后重试。`, 429, retryDelay2);
      }
      for (const group of availableGroups) {
        const projectKeys = group.keys.filter((key) => (this.groqInvalidKeys.get(apiKeyFingerprint(key.apiKey)) || 0) <= now);
        for (const key of projectKeys) {
          try {
            return await this.groqProjectLimiter.run(group.projectId, concurrency, () => {
              const remainingMs = Math.max(1e3, deadline - Date.now());
              return this.requestGroqTranslation(text, target, source, model, prompt, key, Math.min(timeoutMs, remainingMs));
            });
          } catch (error) {
            lastError = error;
            if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
              this.groqInvalidKeys.set(apiKeyFingerprint(key.apiKey), Date.now() + 5 * 6e4);
              continue;
            }
            if (error instanceof ApiRequestError && error.status === 429) {
              this.groqProjectCooldownUntil.set(group.projectId, Date.now() + (error.retryAfterMs ?? apiTestFallbackRetryDelayMs));
              break;
            }
            if (error instanceof ApiRequestError && error.status < 500) throw error;
            break;
          }
        }
      }
      const retryDelay = lastError instanceof ApiRequestError && lastError.status === 429 ? lastError.retryAfterMs ?? apiTestFallbackRetryDelayMs : 0;
      if (pass === 0 && retryDelay > 0 && retryDelay <= apiTestMaximumAutomaticRetryDelayMs && Date.now() + retryDelay < deadline) {
        await wait(Math.max(250, retryDelay));
        continue;
      }
      break;
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("Groq API Key 池没有可用的 Key。");
  }
  async requestGroqTranslation(text, target, source, model, prompt, key, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(groqChatCompletionsEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${key.apiKey.trim()}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: text }
          ],
          temperature: 0,
          max_completion_tokens: groqTranslationMaxCompletionTokens,
          ...groqTranslationReasoningOptions(model)
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiRequestError(
          this.apiErrorMessage(payload) || `Groq API 请求失败：${response.status}`,
          response.status,
          parseRetryAfterMs(response.headers.get("retry-after"))
        );
      }
      const content = payload.choices?.[0]?.message?.content;
      const translated = extractGroqTranslation(content);
      if (!translated) throw new Error("Groq API 返回了空结果。请检查模型设置。");
      const tokenCount = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      const inputTokens = tokenCount(payload.usage?.prompt_tokens ?? payload.usage?.input_tokens);
      const outputTokens = tokenCount(payload.usage?.completion_tokens ?? payload.usage?.output_tokens);
      const totalTokens = tokenCount(payload.usage?.total_tokens) || inputTokens + outputTokens;
      return {
        translated,
        usage: { inputTokens, outputTokens, totalTokens },
        keyId: key.id,
        keyFingerprint: apiKeyFingerprint(key.apiKey)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  translationPrompt(target, source) {
    return source === "auto" ? `You are a translation engine. Translate the user's text into ${target}. Return only the translation. Preserve formatting, URLs, names, Emoji, and line breaks.` : `You are a translation engine. The source language is ${source}. Translate the user's text into ${target}. Return only the translation. Preserve formatting, URLs, names, Emoji, and line breaks. Do not change the translation direction.`;
  }
  apiErrorMessage(payload) {
    if (!payload || typeof payload !== "object") return "";
    const value = payload;
    if (typeof value.error === "string") return value.error;
    if (value.error && typeof value.error === "object" && typeof value.error.message === "string") return value.error.message;
    return typeof value.message === "string" ? value.message : "";
  }
  providerCacheIdentity(settings) {
    if (settings.translationProvider !== "groq") return settings.translationProvider;
    return `groq:${settings.groqApi.model.trim()}`;
  }
  deepLTarget(target) {
    if (target === "zh-CN") return "ZH";
    return target.replace("-", "_").toUpperCase();
  }
  normalizeTarget(target) {
    const value = target.trim().toLowerCase();
    if (value === "zh" || value === "zh-cn" || value === "cn" || value === "chinese") return "zh-CN";
    if (value === "en" || value === "english") return "en";
    return value || "zh-CN";
  }
  normalizeSource(source) {
    const value = source.trim().toLowerCase();
    if (value === "zh" || value === "zh-cn" || value === "cn" || value === "chinese") return "zh-CN";
    if (value === "en" || value === "english") return "en";
    return "auto";
  }
}
const historyVersion = 1;
const maxHistoryEntries = 5e4;
const maxHistoryAgeMs = 90 * 24 * 60 * 60 * 1e3;
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
  constructor(path) {
    this.path = path;
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
        const record = parseRecord(line);
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
    const line = `${JSON.stringify(record)}
`;
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
        const body = [...this.entries.entries()].map(([key, entry]) => JSON.stringify({ version: historyVersion, key, ...entry })).join("\n");
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
  telegram: "https://web.telegram.org/k/"
};
const webPlatforms = /* @__PURE__ */ new Set(["whatsapp", "telegram"]);
const chromeCompatibleUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
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
function hostMatchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}
function unreadCountFromTitle(title) {
  const clean = title.replace(/\s+/g, " ").trim();
  const patterns = [
    /^\((\d{1,4})\)\s+/,
    /^\[(\d{1,4})\]\s+/,
    /^(\d{1,4})\s+(?:unread|new)\b/i,
    /(?:unread|new)\s+(\d{1,4})\b/i
  ];
  const match = patterns.map((pattern) => clean.match(pattern)).find(Boolean);
  const value = Number(match?.[1] || 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(999, Math.round(value));
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
    return false;
  } catch {
    return false;
  }
}
function allowedPermissionForPlatform(platform, requestingUrl, permission) {
  if (!trustedHostForPlatform(platform, requestingUrl)) return false;
  return allowedWebPermissions.has(permission);
}
function configureWebSession(view, platform) {
  const userAgent = chromeCompatibleUserAgent;
  view.webContents.setUserAgent(userAgent);
  view.webContents.session.setUserAgent(userAgent);
  view.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === "notifications") return false;
    const requestingUrl = requestingOrigin || webContents?.getURL() || "";
    return allowedPermissionForPlatform(platform, requestingUrl, permission);
  });
  view.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents.getURL();
    callback(allowedPermissionForPlatform(platform, requestingUrl, permission));
  });
  view.webContents.session.setDevicePermissionHandler(() => false);
}
function accountPartition(account) {
  if (account.platform === "whatsapp") return `persist:unified-whatsapp-v6-${account.id}`;
  return `persist:unified-${account.platform}-${account.id}`;
}
function accountPreferenceScript(account) {
  const color = typeof account.translationColor === "string" ? account.translationColor : "#d8ff00";
  const size = typeof account.translationSize === "number" ? account.translationSize : 15;
  const clampedSize = Math.max(10, Math.min(24, Math.round(size)));
  const enabled = account.translationEnabled !== false;
  return `
(() => {
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
  views = /* @__PURE__ */ new Map();
  viewUseOrder = /* @__PURE__ */ new Map();
  unreadSources = /* @__PURE__ */ new Map();
  publishedUnread = /* @__PURE__ */ new Map();
  preloadUnreadReady = /* @__PURE__ */ new Set();
  whatsappPreferenceSignatures = /* @__PURE__ */ new Map();
  whatsappDatabaseRecovery = /* @__PURE__ */ new Map();
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
  reportWhatsAppDatabaseHealthy(accountId, senderId) {
    const view = this.views.get(accountId);
    if (!view || view.webContents.isDestroyed() || view.webContents.id !== senderId) return;
    this.whatsappDatabaseRecovery.delete(accountId);
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
        ...webPlatform === "whatsapp" ? { preload } : {},
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
        backgroundThrottling: webPlatform === "whatsapp" ? false : webPlatform !== "telegram",
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
    view.webContents.setBackgroundThrottling(webPlatform === "whatsapp" ? false : webPlatform !== "telegram");
    view.webContents.setAudioMuted(true);
    configureWebSession(view, webPlatform);
    if (webPlatform === "telegram") {
      view.webContents.session.preconnect({ url: "https://web.telegram.org", numSockets: 6 });
    }
    view.webContents.setWindowOpenHandler(({ url }) => {
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
      if (webPlatform === "whatsapp") this.updateUnread(account.id, "title", unreadCountFromTitle(title));
    });
    if (webPlatform === "whatsapp") {
      view.webContents.on("preload-error", (_event, preloadPath, error) => {
        console.warn(`WhatsApp preload failed: ${preloadPath}`, error);
      });
    }
    view.webContents.on("did-finish-load", () => {
      this.applyPreferences(account, true);
      if (webPlatform === "whatsapp") this.updateUnread(account.id, "title", unreadCountFromTitle(view.webContents.getTitle() || ""));
    });
    this.views.set(account.id, view);
    this.touchView(account.id);
    const userAgent = chromeCompatibleUserAgent;
    void view.webContents.loadURL(urls[webPlatform], { userAgent }).catch(() => {
      if (this.views.get(account.id) === view) this.views.delete(account.id);
      try {
        view?.webContents.close();
      } catch (error) {
        console.warn("Failed to close a web view after navigation failure.", error);
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
  async start(account) {
    const view = this.ensureView(account);
    if (!view) return;
    this.applyPreferences(account);
    this.trimInactiveViews(account.id);
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
        previous.webContents.setAudioMuted(true);
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
    if (switchingToWhatsapp && previous && previous !== view) {
      previous.webContents.setAudioMuted(true);
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
  async whatsappRecoveryPageState(accountId) {
    const view = this.views.get(accountId);
    if (!view || view.webContents.isDestroyed()) return "loading";
    const result = await view.webContents.executeJavaScript(`
(() => {
  const host = location.hostname.toLowerCase();
  if (host !== 'whatsapp.com' && !host.endsWith('.whatsapp.com')) return { databaseError: false, ready: false };
  const text = String(document.body?.innerText || document.body?.textContent || '').replace(/\\s+/gu, ' ').trim().slice(0, 16000);
  const databaseError = /(?:数据库|資料庫).{0,40}(?:错误|錯誤).{0,100}重新(?:连接|連接|連結).{0,40}(?:设备|裝置)|(?:database.{0,30}(?:error|issue)|(?:error|issue).{0,30}database).{0,140}(?:reconnect|relink).{0,60}(?:device|phone)/isu.test(text);
  const chatReady = Boolean(document.querySelector('#main,[data-testid="conversation-panel-messages"]'));
  const visible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 72 && rect.height >= 72;
  };
  const qrReady = Array.from(document.querySelectorAll('canvas,[data-ref],[data-testid*="qr" i],[aria-label*="QR" i],[aria-label*="二维码" i]')).some(visible);
  return { databaseError, ready: chatReady || qrReady };
})()
`, true).catch(() => void 0);
    if (result?.databaseError === true) return "database-error";
    if (result?.ready === true) return "ready";
    return "loading";
  }
  async waitForWhatsAppRecoveryPage(accountId, recovery, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastState = "loading";
    let consecutiveDatabaseErrors = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve2) => setTimeout(resolve2, 900));
      if (this.whatsappDatabaseRecovery.get(accountId) !== recovery) return "ready";
      lastState = await this.whatsappRecoveryPageState(accountId);
      if (lastState === "ready") return lastState;
      if (lastState === "database-error") {
        consecutiveDatabaseErrors += 1;
        if (consecutiveDatabaseErrors >= 2) return lastState;
      } else {
        consecutiveDatabaseErrors = 0;
      }
    }
    return lastState;
  }
  async recoverWhatsAppDatabase(account, senderId) {
    if (account.platform !== "whatsapp") return void 0;
    const view = this.views.get(account.id);
    if (!view || view.webContents.isDestroyed() || view.webContents.id !== senderId) return void 0;
    const existing = this.whatsappDatabaseRecovery.get(account.id);
    if (existing?.inProgress) return void 0;
    const recovery = { stage: 0, lastReportAt: Date.now(), inProgress: true };
    this.whatsappDatabaseRecovery.set(account.id, recovery);
    const wasActive = this.activeId === account.id;
    const accountSession = view.webContents.session;
    const reopenView = async () => {
      await new Promise((resolve2) => setTimeout(resolve2, 180));
      await this.start(account);
      if (wasActive) await this.activate(account);
    };
    const reloadCurrentView = () => {
      const current = this.views.get(account.id);
      if (current && !current.webContents.isDestroyed()) current.webContents.reloadIgnoringCache();
    };
    try {
      recovery.stage = 1;
      try {
        await accountSession.flushStorageData();
      } catch (error) {
        console.warn("WhatsApp storage flush failed during automatic recovery.", error);
      }
      reloadCurrentView();
      let pageState = await this.waitForWhatsAppRecoveryPage(account.id, recovery, 18e3);
      if (pageState === "ready") return "storage-flushed-and-recovered";
      if (pageState !== "database-error") return "storage-flushed-page-awaiting-network";
      recovery.stage = 2;
      try {
        await accountSession.clearStorageData({ storages: ["serviceworkers", "cachestorage"] });
        await accountSession.clearCache();
        await accountSession.flushStorageData();
      } catch (error) {
        console.warn("WhatsApp cache reset failed during automatic recovery.", error);
      }
      reloadCurrentView();
      pageState = await this.waitForWhatsAppRecoveryPage(account.id, recovery, 18e3);
      if (pageState === "ready") return "cache-and-service-worker-rebuilt";
      if (pageState !== "database-error") return "cache-rebuilt-page-awaiting-network";
      recovery.stage = 3;
      this.disposeView(account.id, false, false);
      await reopenView();
      pageState = await this.waitForWhatsAppRecoveryPage(account.id, recovery, 18e3);
      if (pageState === "ready") return "account-view-recreated";
      if (pageState !== "database-error") return "account-view-recreated-page-awaiting-network";
      recovery.stage = 4;
      this.disposeView(account.id, false, false);
      await new Promise((resolve2) => setTimeout(resolve2, 350));
      let clearError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        clearError = void 0;
        try {
          await accountSession.clearStorageData({
            storages: ["cookies", "filesystem", "indexdb", "localstorage", "serviceworkers", "cachestorage"]
          });
          await accountSession.clearCache();
          await accountSession.flushStorageData();
          break;
        } catch (error) {
          clearError = error;
          if (attempt === 0) await new Promise((resolve2) => setTimeout(resolve2, 700));
        }
      }
      if (clearError) throw clearError;
      await reopenView();
      pageState = await this.waitForWhatsAppRecoveryPage(account.id, recovery, 3e4);
      if (pageState === "loading") {
        reloadCurrentView();
        pageState = await this.waitForWhatsAppRecoveryPage(account.id, recovery, 2e4);
      }
      if (pageState !== "database-error") return pageState === "ready" ? "damaged-account-storage-rebuilt" : "damaged-account-storage-rebuilt-page-awaiting-network";
      this.emit({
        type: "error",
        accountId: account.id,
        message: "WhatsApp 本地数据库自动恢复未完成，请重新连接当前账号。"
      });
      return "automatic-recovery-exhausted";
    } finally {
      recovery.inProgress = false;
      if (this.whatsappDatabaseRecovery.get(account.id) === recovery) this.whatsappDatabaseRecovery.delete(account.id);
    }
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
    this.whatsappDatabaseRecovery.delete(account.id);
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
    this.whatsappDatabaseRecovery.clear();
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
function sleep(milliseconds) {
  return new Promise((resolve2) => setTimeout(resolve2, milliseconds));
}
function translationPreferences(account) {
  return {
    enabled: account.translationEnabled !== false,
    color: account.translationColor || "#d8ff00",
    size: Math.min(24, Math.max(10, account.translationSize || 15))
  };
}
function splitTrailingSignature(text) {
  const match = text.match(/^([\s\S]*\S)\n{2,}([^\n]{2,80})$/u);
  if (!match) return { body: text };
  const body = match[1].trim();
  const signature = match[2].trim();
  const words = signature.split(/\s+/).filter(Boolean);
  const nameLike = /^[\p{L}\p{M}][\p{L}\p{M}\s.'’‘-]{1,79}$/u.test(signature) && words.length <= 6;
  if (!body || !nameLike || /[!?。！？,:;，：；]/u.test(signature)) return { body: text };
  return { body, signature };
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
    if (signalWindow.__biTalksEnglishOnlySendGuardController?.version === "complete-v6") return;
    signalWindow.__biTalksEnglishOnlySendGuardController?.destroy();
    signalWindow.__biTalksEnglishOnlySendGuard = "complete-v6";
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
    signalWindow.__biTalksOutgoingTranslationFailed = (id) => {
      const job = outgoingJobs.get(id);
      if (job) cleanupOutgoingJob(job);
      showOutgoingStatus("翻译失败，消息未发送。", "error", 2600);
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
      version: "complete-v6",
      destroy: () => {
        listenerController.abort();
        cancelAllOutgoingJobs();
        if (outgoingStatusTimer) clearTimeout(outgoingStatusTimer);
        document.getElementById("bi-talks-outgoing-translation-status")?.remove();
        if (signalWindow.__biTalksEnglishOnlySendGuardController?.version === "complete-v6") {
          delete signalWindow.__biTalksEnglishOnlySendGuardController;
        }
      }
    };
  };
  installEnglishOnlySendGuard();
  const installUnreadMonitor = () => {
    if (signalWindow.__biTalksUnreadMonitor === "unread-v5") return;
    signalWindow.__biTalksUnreadMonitor = "unread-v5";
    let lastCount = -1;
    let lastTrustedUnreadInteraction = 0;
    let trustedUnreadCeiling;
    let candidateCount = -1;
    let candidateSince = 0;
    let timer;
    const markerSelector = '[aria-label*="unread" i],[aria-label*="new message" i],[data-testid*="unread" i],[data-unread="true"],[class~="unread"],[class*="unread-badge" i]';
    const rowSelector = '[role="row"],[role="listitem"],li,[data-testid*="conversation" i],[data-conversation-id]';
    const titleCount = () => {
      const title = (document.title || "").replace(/\s+/g, " ").trim();
      const match = title.match(/^\((\d{1,4})\)\s*/) || title.match(/^\[(\d{1,4})\]\s*/) || title.match(/^Signal\s+\((\d{1,4})\)$/i) || title.match(/^Signal\s+\[(\d{1,4})\]$/i) || title.match(/^(\d{1,4})\s+(?:unread|new)\b/i) || title.match(/(?:unread|new)\s+(\d{1,4})\b/i);
      return Math.min(999, Number(match?.[1] || 0));
    };
    const labelUnreadCount = () => {
      const rowCounts = /* @__PURE__ */ new Map();
      document.querySelectorAll(markerSelector).forEach((element) => {
        if (!element.getClientRects().length) return;
        const rect = element.getBoundingClientRect();
        if (rect.left > innerWidth * 0.58 || rect.bottom < 0 || rect.top > innerHeight) return;
        const signature = [element.getAttribute("aria-label"), element.getAttribute("title"), element.textContent].filter(Boolean).join(" ");
        const match = signature.match(/(\d{1,4})\s*(?:unread|new)\s*(?:messages?|chats?)?/i) || signature.match(/(?:unread|new)\s*(\d{1,4})/i) || signature.match(/(\d{1,4})\s*条(?:未读|新)消息/u) || signature.match(/^[([]?(\d{1,4})[)\]]?$/);
        const value = Math.max(1, Number(match?.[1] || 0));
        const row = element.closest(rowSelector);
        if (!row) return;
        rowCounts.set(row, Math.max(rowCounts.get(row) || 0, value));
      });
      const rowTotal = [...rowCounts.values()].reduce((sum, value) => sum + value, 0);
      return Math.min(999, rowTotal);
    };
    const scan2 = () => {
      timer = void 0;
      const now = Date.now();
      const trustedWindow = now - lastTrustedUnreadInteraction < 3500;
      if (!trustedWindow) trustedUnreadCeiling = void 0;
      const rawCount = Math.max(titleCount(), labelUnreadCount());
      const count = trustedWindow && trustedUnreadCeiling !== void 0 ? Math.min(rawCount, trustedUnreadCeiling) : rawCount;
      if (count !== candidateCount) {
        candidateCount = count;
        candidateSince = now;
      }
      const stableFor = lastCount < 0 ? 700 : count < lastCount ? trustedWindow ? 80 : 650 : count > lastCount ? 220 : 0;
      const remaining = stableFor - (now - candidateSince);
      if (remaining > 0) {
        timer = setTimeout(scan2, remaining + 20);
        return;
      }
      if (count === lastCount) return;
      const trustedDecrease = lastCount >= 0 && count < lastCount && trustedWindow;
      lastCount = count;
      try {
        signalWindow.__biTalksUnreadReport?.(JSON.stringify({ count, trustedDecrease }));
      } catch {
      }
    };
    const schedule = (delay2 = 180) => {
      if (!timer) timer = setTimeout(scan2, delay2);
    };
    document.addEventListener("pointerdown", (event) => {
      const origin = event.composedPath().find((item) => item instanceof Element);
      const row = origin?.closest(`${rowSelector},button,[role="button"]`);
      if (!row) return;
      const signature = `${row.getAttribute("aria-label") || ""} ${row.getAttribute("class") || ""} ${row.textContent || ""}`;
      const unreadChild = row.querySelector(markerSelector);
      if (!unreadChild && !/unread|new message|未读|新消息/iu.test(signature)) return;
      lastTrustedUnreadInteraction = Date.now();
      const markerSignature = unreadChild ? [unreadChild.getAttribute("aria-label"), unreadChild.getAttribute("title"), unreadChild.textContent].filter(Boolean).join(" ") : signature;
      const markerMatch = markerSignature.match(/(\d{1,4})\s*(?:unread|new)/i) || markerSignature.match(/(?:unread|new)\s*(\d{1,4})/i) || markerSignature.match(/(\d{1,4})\s*条(?:未读|新)消息/u);
      const clickedUnread = Math.max(1, Number(markerMatch?.[1] || 0));
      const current = lastCount >= 0 ? lastCount : Math.max(titleCount(), labelUnreadCount());
      trustedUnreadCeiling = Math.max(0, current - clickedUnread);
      candidateCount = -1;
      schedule(80);
      setTimeout(() => schedule(0), 420);
    }, true);
    new MutationObserver(() => schedule()).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "class", "data-testid"]
    });
    setInterval(schedule, 1200);
    schedule();
  };
  installUnreadMonitor();
  if (signalWindow.__biTalksSignalTranslation) return;
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
  const processed = /* @__PURE__ */ new WeakMap();
  const failures = /* @__PURE__ */ new WeakMap();
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
  const isEnglishOnly = (text) => text.length >= 2 && /[A-Za-z]/.test(text) && !/[\u3400-\u9fff]/u.test(text);
  const translationFor = (element) => {
    const parent = element.parentElement;
    if (!parent) return void 0;
    return Array.from(parent.children).find((child) => child.getAttribute(translationAttribute) === "true" && child.getAttribute("data-bi-talks-owner") === element.getAttribute(sourceAttribute));
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 6 && rect.bottom >= -300 && rect.top <= innerHeight + 300;
  };
  const isExcluded = (element) => {
    if (element.closest(`[${translationAttribute}],input,textarea,[contenteditable="true"],button,svg,time,[role="button"]`)) return true;
    const signature = `${element.className || ""} ${element.getAttribute("data-testid") || ""}`.toLowerCase();
    return /timestamp|reaction|quote|quoted|metadata|status|system-message|contact-name|sender-name/.test(signature);
  };
  const cleanText = (element) => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(`[${translationAttribute}],button,svg,time,[aria-hidden="true"],[class*="timestamp" i],[class*="reaction" i]`).forEach((node) => node.remove());
    clone.querySelectorAll("br").forEach((node) => node.replaceWith(document.createTextNode("\n")));
    return normal(clone.textContent || clone.innerText || "").slice(0, 9e3);
  };
  const looksLikeMessage = (element, text) => {
    if (!text || text.length > 9e3 || !/[\p{L}\p{N}]/u.test(text)) return false;
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
  const removeTranslations = () => {
    document.querySelectorAll(`[${translationAttribute}]`).forEach((node) => node.remove());
    pending.clear();
  };
  const request = (element) => {
    if (!preferences.enabled || isExcluded(element) || !visible(element)) return;
    if ((failures.get(element) || 0) >= 3) return;
    const text = cleanText(element);
    if (!looksLikeMessage(element, text) || !isEnglishOnly(text)) return;
    const key = hash(text);
    const current = translationFor(element);
    if (current?.dataset.biTalksSignalSource === key || processed.get(element) === key) return;
    current?.remove();
    processed.set(element, key);
    const owner = element.getAttribute(sourceAttribute) || `source-${Date.now()}-${++requestSequence}`;
    element.setAttribute(sourceAttribute, owner);
    const id = `${Date.now()}-${requestSequence}`;
    pending.set(id, { element, text, key });
    const rect = element.getBoundingClientRect();
    const priority = Math.round(Math.max(0, Math.min(1e3, rect.bottom / Math.max(1, innerHeight) * 1e3)));
    try {
      signalWindow.__biTalksTranslateRequest?.(JSON.stringify({ id, text, priority }));
    } catch {
      pending.delete(id);
      processed.delete(element);
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
  signalWindow.__biTalksTranslationResult = (id, translated) => {
    const job = pending.get(id);
    pending.delete(id);
    if (!job || !preferences.enabled || !job.element.isConnected) return;
    const currentText = cleanText(job.element);
    if (hash(currentText) !== job.key) {
      processed.delete(job.element);
      scheduleScan();
      return;
    }
    const cleanTranslation = normal(String(translated || ""));
    if (!cleanTranslation || cleanTranslation.toLocaleLowerCase() === job.text.toLocaleLowerCase()) return;
    failures.delete(job.element);
    translationFor(job.element)?.remove();
    const node = document.createElement("div");
    node.setAttribute(translationAttribute, "true");
    node.setAttribute("data-bi-talks-owner", job.element.getAttribute(sourceAttribute) || "");
    node.dataset.biTalksSignalSource = job.key;
    node.textContent = cleanTranslation;
    node.setAttribute("aria-label", `译文：${cleanTranslation}`);
    applyStyle(node);
    job.element.insertAdjacentElement("afterend", node);
  };
  signalWindow.__biTalksTranslationFailed = (id) => {
    const job = pending.get(id);
    pending.delete(id);
    if (!job || !job.element.isConnected) return;
    failures.set(job.element, (failures.get(job.element) || 0) + 1);
    processed.delete(job.element);
    setTimeout(scheduleScan, 900);
  };
  const controller = {
    setPreferences(next) {
      preferences = {
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
      try {
        const report = JSON.parse(params.payload);
        count = Number(report.count);
        trustedDecrease = report.trustedDecrease === true;
      } catch {
      }
      if (Number.isFinite(count) && !session2.cancelled) {
        this.emit({
          type: "unread",
          accountId: session2.account.id,
          count: Math.max(0, Math.min(999, Math.round(count))),
          trustedDecrease
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
      const text2 = String(request2.text || "").trim().slice(0, 6e4);
      if (!id2 || !text2 || session2.cancelled) return;
      const executionContextId2 = typeof params.executionContextId === "number" ? params.executionContextId : void 0;
      void this.translateOutgoing(session2, connection, id2, text2, executionContextId2);
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
    const text = String(request.text || "").trim().slice(0, 9e3);
    const priority = Math.max(0, Math.min(1e3, Number(request.priority) || 0));
    if (!id || !text || session2.cancelled || session2.account.translationEnabled === false) return;
    const executionContextId = typeof params.executionContextId === "number" ? params.executionContextId : void 0;
    this.translationQueue.push({ session: session2, connection, id, text, priority, executionContextId });
    this.translationQueue.sort((left, right) => right.priority - left.priority);
    this.drainTranslationQueue();
  }
  drainTranslationQueue() {
    while (this.translationsInFlight < 10 && this.translationQueue.length) {
      const job = this.translationQueue.shift();
      if (!job || job.session.cancelled || this.connections.get(job.session.account.id) !== job.connection) continue;
      this.translationsInFlight += 1;
      void this.runTranslation(job).finally(() => {
        this.translationsInFlight = Math.max(0, this.translationsInFlight - 1);
        this.drainTranslationQueue();
      });
    }
  }
  async translateOutgoing(session2, connection, id, text, executionContextId) {
    let translated = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        translated = await this.translateOutgoingText(text);
        if (translated) break;
      } catch {
        if (attempt === 0) await sleep(250);
      }
    }
    if (session2.cancelled || this.connections.get(session2.account.id) !== connection) return;
    const context = executionContextId ? { contextId: executionContextId } : {};
    if (!translated) {
      await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationFailed?.(${JSON.stringify(id)})`,
        ...context
      }).catch(() => void 0);
      return;
    }
    const prepared = await connection.call("Runtime.evaluate", {
      expression: `window.__biTalksOutgoingTranslationResult?.(${JSON.stringify(id)}, ${JSON.stringify(translated)})`,
      returnByValue: true,
      ...context
    }).catch(() => void 0);
    if (prepared?.result?.value !== true || session2.cancelled || this.connections.get(session2.account.id) !== connection) {
      await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationSent?.(${JSON.stringify(id)}, false)`,
        ...context
      }).catch(() => void 0);
      return;
    }
    try {
      await sleep(90);
      const preparedInput = await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationPrepareInput?.(${JSON.stringify(id)})`,
        returnByValue: true,
        ...context
      });
      if (preparedInput?.result?.value !== true) throw new Error("Signal outgoing input preparation was not accepted.");
      await connection.call("Input.insertText", { text: translated });
      await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationInputCommitted?.(${JSON.stringify(id)})`,
        ...context
      });
      const nativeEnterAllowed = await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationAllowNativeSend?.(${JSON.stringify(id)})`,
        returnByValue: true,
        ...context
      });
      if (nativeEnterAllowed?.result?.value !== true) throw new Error("Signal outgoing native send was not accepted.");
      await connection.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
      await connection.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13
      });
      await sleep(300);
      const sentByEnter = await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationDidSend?.(${JSON.stringify(id)})`,
        returnByValue: true,
        ...context
      });
      if (sentByEnter?.result?.value === true) {
        await connection.call("Runtime.evaluate", {
          expression: `window.__biTalksOutgoingTranslationSent?.(${JSON.stringify(id)}, true)`,
          ...context
        }).catch(() => void 0);
        return;
      }
      let x = Number.NaN;
      let y = Number.NaN;
      for (let attempt = 0; attempt < 4 && (!Number.isFinite(x) || !Number.isFinite(y)); attempt += 1) {
        await sleep(180);
        const sendTarget = await connection.call("Runtime.evaluate", {
          expression: `window.__biTalksOutgoingTranslationSendStart?.(${JSON.stringify(id)})`,
          returnByValue: true,
          ...context
        });
        x = Number(sendTarget?.result?.value?.x);
        y = Number(sendTarget?.result?.value?.y);
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Signal outgoing send button was not found.");
      await connection.call("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1
      });
      await connection.call("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1
      });
      await sleep(350);
      const didSend = await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationDidSend?.(${JSON.stringify(id)})`,
        returnByValue: true,
        ...context
      });
      await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationSent?.(${JSON.stringify(id)}, ${didSend?.result?.value === true})`,
        ...context
      }).catch(() => void 0);
    } catch {
      await connection.call("Runtime.evaluate", {
        expression: `window.__biTalksOutgoingTranslationSent?.(${JSON.stringify(id)}, false)`,
        ...context
      }).catch(() => void 0);
    }
  }
  async runTranslation(job) {
    let translated = "";
    const { body, signature } = splitTrailingSignature(job.text);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        translated = await this.translateIncoming(body);
        if (translated && signature) translated = `${translated.trim()}

${signature}`;
        if (translated) break;
      } catch {
        if (attempt < 2) await sleep(450 * (attempt + 1));
      }
    }
    if (job.session.cancelled || this.connections.get(job.session.account.id) !== job.connection) return;
    const context = job.executionContextId ? { contextId: job.executionContextId } : {};
    if (!translated) {
      await job.connection.call("Runtime.evaluate", {
        expression: `window.__biTalksTranslationFailed?.(${JSON.stringify(job.id)})`,
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
$active = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -ieq 'Signal.exe' -and
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
      emit2({ type: "signal-update", accountId, status: "checking", message: `正在验证已下载的 Signal ${release.version} 安装包`, version: release.version });
      const currentHash = await sha512Base64(installerPath);
      if (currentHash === release.sha512) return installerPath;
    }
  }
  await rm(installerPath, { force: true }).catch(() => void 0);
  await downloadFile(release.downloadUrl, installerPath, (progress) => {
    emit2({ type: "signal-update", accountId, status: "downloading", message: `正在下载 Signal ${release.version}`, version: release.version, progress });
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
      "/R:12",
      "/W:1",
      "/NFL",
      "/NDL",
      "/NJH",
      "/NJS",
      "/NP",
      "/MT:8"
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
function mergeJson(base, patch) {
  const result = { ...base };
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
    const previousRun = this.placementRuns.get(account.id);
    const run = (previousRun ? previousRun.catch(() => false) : Promise.resolve(false)).then(async () => {
      const windows = this.attachedWindows.get(account.id);
      if (!windows) return false;
      if (!force && this.samePlacement(this.placements.get(account.id), desired)) return false;
      if (force) this.placements.delete(account.id);
      await this.applyPlacement(account, windows, desired);
      return true;
    });
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
while ((Get-Date) -lt $deadline) {
  $allSignal = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Signal.exe' })
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
    if (!actualVisible && (moved || force || recover || requestedVisible)) await this.hideAllManagedWindows(account);
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
    this.emit({ type: "signal-update", accountId, status: "checking", message: "正在检查 Signal 更新" });
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
        this.emit({ type: "signal-update", accountId, status: "installing", message: `正在本机快速解压 Signal ${targetVersion}`, version: targetVersion });
        await runProcess(sevenZip, ["x", installerPath, "-y", `-o${localStagingDir}`, "-mmt=on"], 3e5);
        await writeFile(join(localStagingDir, "latest.yml"), release.manifest, "utf8").catch(() => void 0);
      }
      const stagedExecutable = join(localStagingDir, "Signal.exe");
      if (!isUsableSignalDesktop(stagedExecutable)) throw new Error("Signal update package did not contain a usable Signal Desktop.");
      await verifySignalAuthenticode(stagedExecutable);
      await disableBundledSignalAutoUpdater(stagedExecutable);
      stagingDir = join(parent, `.signal-desktop-staging-${updateStamp}`);
      await removeDirectoryWithRetries(stagingDir);
      this.emit({ type: "signal-update", accountId, status: "installing", message: `正在快速同步 Signal ${targetVersion} 文件`, version: targetVersion });
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
      this.emit({ type: "signal-update", accountId, status: "installing", message: `正在安装 Signal ${targetVersion}`, version: targetVersion });
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
      this.emit(firstInstall && accountId ? { type: "signal-update", accountId, status: "installing", message: `Signal ${targetVersion} 安装完成，正在自动启动`, version: targetVersion } : { type: "signal-update", accountId, status: "complete", message: `Signal 已更新到 ${targetVersion}`, version: targetVersion });
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
    return app.isPackaged ? join(process.resourcesPath, "vendor", "webview2-host") : join(app.getAppPath(), "vendor", "webview2-host");
  }
  profileRoot() {
    return join(this.runtimeRoot, "google-voice-webview2");
  }
  profileDirectory(accountId) {
    return join(this.profileRoot(), accountId);
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
    if (!existsSync(executable)) throw new Error("Microsoft WebView2 宿主组件缺失，请重新安装 Bi-Talks。");
    const profileDirectory = this.profileDirectory(account.id);
    await mkdir(profileDirectory, { recursive: true });
    const bounds = clampBounds(this.bounds);
    const child = spawn(executable, [
      "--account",
      account.id,
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
        void this.translate(text, target, source).then((translated) => {
          const result = translated.trim();
          if (!result) throw new Error("empty translation");
          this.command(hosted, `translation ${requestId} ${Buffer.from(result, "utf8").toString("base64")}`);
        }).catch(() => this.command(hosted, `translation-error ${requestId}`));
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
    if (account.platform !== "googlevoice") return;
    await this.ensureHost(account);
  }
  async activate(account) {
    if (account?.platform === "googlevoice" && this.activeId === account.id) {
      const host2 = await this.ensureHost(account);
      if (!host2.visible) {
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
    if (!account || account.platform !== "googlevoice") return;
    const host = await this.ensureHost(account);
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
    if (account.platform !== "googlevoice") return;
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
    if (account.platform !== "googlevoice") return;
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
    const root = resolve(this.profileRoot());
    const target = resolve(this.profileDirectory(account.id));
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
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error("Patch verification key is invalid.");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Patch verification key must be Ed25519.");
  if (!verify(null, payloadBytes, publicKey, signatureBytes)) {
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
mkdirSync(portableDataRoot, { recursive: true });
try {
  rmSync(runtimeMigrationPath, { force: true });
} catch {
}
ensureRuntimeDirectories(localRuntimeRoot);
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
let translator;
let webViews;
let signal;
let googleVoice;
let appPatches;
let activeSignalWindow;
let selectedSignalAccountId;
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
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4);
  const setPixel = (x, y, red, green, blue, alpha = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = alpha;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distanceSquared = (x - 7.5) ** 2 + (y - 7.5) ** 2;
      if (distanceSquared <= 7.25 ** 2) setPixel(x, y, 255, 255, 255);
      if (distanceSquared <= 6 ** 2) setPixel(x, y, 232, 17, 35);
    }
  }
  const scale = label.length === 1 ? 2 : 1;
  const textWidth = label.length * 3 * scale + Math.max(0, label.length - 1) * scale;
  const startX = Math.floor((size - textWidth) / 2);
  const startY = Math.floor((size - 5 * scale) / 2);
  for (let index = 0; index < label.length; index += 1) {
    const glyph = taskbarDigitGlyphs[label[index]];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPixel(startX + index * 4 * scale + column * scale + dx, startY + row * scale + dy, 255, 255, 255);
          }
        }
      }
    }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
function loadPersistedUnreadCounts() {
  if (!existsSync(unreadStatePath)) return;
  try {
    const raw = JSON.parse(readFileSync(unreadStatePath, "utf8"));
    const accountIds = new Set(store.get().accounts.filter((account) => account.platform !== "telegram").map((account) => account.id));
    for (const [accountId, value] of Object.entries(raw)) {
      const count = Number(value);
      if (accountIds.has(accountId) && Number.isFinite(count) && count > 0) {
        unreadCounts.set(accountId, Math.min(999, Math.round(count)));
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
    const accountIds = new Set(store.get().accounts.filter((account) => account.platform !== "telegram").map((account) => account.id));
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
  const accountIds = new Set(store.get().accounts.filter((account) => account.platform !== "telegram").map((account) => account.id));
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
function applyUnreadEvent(event) {
  const count = event.count;
  const previous = unreadCounts.get(event.accountId);
  unreadCounts.set(event.accountId, count);
  scheduleUnreadPersistence();
  if (previous !== count) runtimeLog("unread count changed", { accountId: event.accountId, previous: previous ?? null, count });
  updateAppUnreadBadge();
  if (previous === void 0) {
    unreadBaselineUntil.set(event.accountId, Date.now() + 8e3);
    return;
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
  scheduleUnreadPersistence();
  updateAppUnreadBadge();
  mainWindow?.webContents.send("app:event", { type: "unread", accountId, count: 0 });
}
function handleUnreadEvent(event, forceDecrease = false) {
  const normalized = {
    ...event,
    count: Math.max(0, Math.min(999, Math.round(event.count)))
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
  if (event.type === "unread" && !handleUnreadEvent(event, forceUnreadDecrease)) return;
  mainWindow?.webContents.send("app:event", event);
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
  const iconFiles = ["app.png", "icon.png", "icon.ico"];
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
async function autostartAllAccounts() {
  if (accountAutostartPromise) return accountAutostartPromise;
  accountAutostartPromise = (async () => {
    await waitForBackgroundStartup(450);
    if (shuttingDown) return;
    const state = store.get();
    const accounts = orderedAccountsForAutostart().filter((account) => !(account.platform === "telegram" && account.hidden));
    const selected = accounts.find((account) => account.id === state.selectedAccountId);
    const webAccounts = accounts.filter((account) => webViews.isWebPlatform(account.platform) && account.id !== selected?.id);
    const signalAccounts = accounts.filter((account) => account.platform === "signal" && account.id !== selected?.id);
    const fallbackAccounts = accounts.filter((account) => !webViews.isWebPlatform(account.platform) && account.platform !== "signal" && account.id !== selected?.id);
    const nonSignalAccounts = [...webAccounts, ...fallbackAccounts];
    runtimeLog("background account autostart started", {
      total: accounts.length,
      queued: nonSignalAccounts.length + signalAccounts.length,
      selectedAccountId: selected?.id,
      signalConcurrency: Math.min(2, signalAccounts.length)
    });
    const startAccount = async (account) => {
      if (shuttingDown) return;
      try {
        if (webViews.isWebPlatform(account.platform)) await webViews.start(account);
        else if (account.platform === "signal") await signal.start(account);
        else if (account.platform === "googlevoice") await googleVoice.start(account);
        runtimeLog("background account started", { accountId: account.id, platform: account.platform });
      } catch (error) {
        runtimeLog("background account start failed", {
          accountId: account.id,
          platform: account.platform,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    };
    if (selected?.platform === "signal") {
      try {
        await signal.start(selected);
        runtimeLog("selected Signal prewarm started", { accountId: selected.id });
      } catch (error) {
        runtimeLog("selected Signal prewarm failed", {
          accountId: selected.id,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    } else if (selected?.platform === "googlevoice") {
      await googleVoice.start(selected).catch((error) => {
        runtimeLog("selected Google Voice prewarm failed", {
          accountId: selected.id,
          message: error instanceof Error ? error.message : String(error)
        });
      });
    }
    const startNonSignalAccounts = async () => {
      for (let index = 0; index < nonSignalAccounts.length; index += 1) {
        await startAccount(nonSignalAccounts[index]);
        if (index < nonSignalAccounts.length - 1) await waitForBackgroundStartup(350);
      }
    };
    const startSignalAccounts = async () => {
      await signal.prepareBackgroundStarts(signalAccounts);
      const batchSize = 2;
      for (let offset = 0; offset < signalAccounts.length; offset += batchSize) {
        if (shuttingDown) return;
        const batch = signalAccounts.slice(offset, offset + batchSize);
        await Promise.all(batch.map(async (account, index) => {
          if (index > 0) await waitForBackgroundStartup(300);
          await startAccount(account);
        }));
        if (offset + batchSize < signalAccounts.length) await waitForBackgroundStartup(450);
      }
    };
    await Promise.all([startNonSignalAccounts(), startSignalAccounts()]);
    runtimeLog("background account autostart complete", { total: accounts.length });
  })().finally(() => {
    accountAutostartPromise = void 0;
  });
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
  if (mainWindowUnavailable()) return false;
  if (mainWindow?.isFocused()) return true;
  return !!accountId && selectedSignalAccountId === accountId && activeSignalWindow?.account.id === accountId && activeSignalWindow.visible && signal.isWindowPresented(accountId);
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
  const runningAccountIds = signalRestartAccountIds(signal.runningAccountIds(), account?.platform === "signal" ? account.id : void 0);
  const accountsToRestart = store.get().accounts.filter((item) => item.platform === "signal" && runningAccountIds.has(item.id));
  const activeBeforeUpdate = activeSignalWindow;
  let activeWindowStopped = false;
  try {
    const result = await signal.updateBundledDesktop(account);
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
      if (shouldRecoverSignal && activeSignalWindow?.visible) recoverSelectedSignalWindow();
    }, 120);
    setTimeout(() => {
      if (mainWindowUnavailable()) return;
      try {
        webViews.recoverActive();
      } catch (error) {
        runtimeLog("final active web view recovery failed", error instanceof Error ? error.message : String(error));
      }
      if (shouldRecoverSignal && activeSignalWindow?.visible) recoverSelectedSignalWindow();
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
    for (const account of store.get().accounts) {
      if (account.platform !== "signal") continue;
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
  if (!mainWindow || mainWindow.isDestroyed() || shuttingDown) return;
  const unavailable = mainWindow.isMinimized() || !mainWindow.isVisible();
  if (unavailable) {
    if (!signalSuspendedWithMainWindow) suspendSignalWithMainWindow();
    return;
  }
  if (signalSuspendedWithMainWindow) recoverAfterForeground();
}
function applyAppearanceSurfaceColors() {
  const theme = resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors);
  const backgroundColor = appearanceBackgroundColor(theme);
  try {
    mainWindow?.setBackgroundColor(backgroundColor);
  } catch {
  }
  webViews?.setAppearanceTheme(theme);
}
function applyAppearanceTheme(mode) {
  const normalizedMode = normalizeAppearanceTheme(mode);
  if (nativeTheme.themeSource !== normalizedMode) nativeTheme.themeSource = normalizedMode;
  applyAppearanceSurfaceColors();
}
function setNativeWindowEffects(enabled) {
  if (!mainWindow) return;
  try {
    mainWindow.setBackgroundColor(appearanceBackgroundColor(resolveAppearanceTheme(normalizeAppearanceTheme(store.get().settings.themeMode), nativeTheme.shouldUseDarkColors)));
    mainWindow.setBackgroundMaterial("none");
  } catch {
  }
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
  translator = new Translator(
    () => store.get().settings,
    async (provider, increment) => {
      const state = await store.recordTranslationUsage(provider, increment);
      emit({ type: "state-updated", state });
    },
    (provider) => {
      const providerName = provider === "deepl" ? "DeepL" : "Groq";
      emit({ type: "error", message: `${providerName} API 连续翻译失败 4 次，秘钥额度不足，请检查或更换秘钥。` });
    },
    new TranslationHistory(join(app.getPath("userData"), "translation-history.jsonl"))
  );
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
  webViews = new WebViewManager(mainWindow, emit);
  webViews.setAppearanceTheme(startupAppearanceTheme);
  googleVoice = new GoogleVoiceManager(
    mainWindow,
    localRuntimeRoot,
    emit,
    (text, target, source) => translator.translate(text, target, source)
  );
  signal = new SignalManager(
    emit,
    (text) => translator.translate(text, "zh", "en"),
    (text) => translator.translate(text, "en", "zh"),
    localRuntimeRoot,
    async (account) => {
      await updateSignalDesktopAndRestart(account);
    }
  );
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
ipcMain.handle("state:get", () => store.get());
ipcMain.handle("window:confirm-close", () => {
  closeApproved = true;
  app.quit();
});
ipcMain.handle("unread:get", () => Object.fromEntries(
  [...unreadCounts.entries()].filter(([accountId, count]) => count > 0 && store.get().accounts.some((account) => account.id === accountId && account.platform !== "telegram"))
));
ipcMain.handle("state:set", async (_event, state) => {
  await store.set(state);
  applyAppearanceTheme(state.settings.themeMode);
  updateAppUnreadBadge();
  scheduleUnreadPersistence();
});
ipcMain.on("service:unread", (event, payload) => {
  const accountId = String(payload?.accountId || "");
  const count = Number(payload?.count);
  const titleCount = Number(payload?.titleCount);
  const domCount = Number(payload?.domCount);
  if (!accountId || !Number.isFinite(count)) return;
  if (!store.get().accounts.some((account) => account.id === accountId && account.platform === "whatsapp")) return;
  runtimeLog("web unread sources reported", {
    accountId,
    title: Number.isFinite(Number(payload.titleCount)) ? Number(payload.titleCount) : null,
    dom: Number.isFinite(Number(payload.domCount)) ? Number(payload.domCount) : null,
    count
  });
  webViews.reportPreloadUnread(
    accountId,
    Number.isFinite(titleCount) ? titleCount : count,
    Number.isFinite(domCount) ? domCount : count,
    event.sender.id,
    payload.trustedDecrease === true
  );
});
ipcMain.handle("view:activate", async (_event, account) => {
  workspaceTaskbarPreviewSuspendedUntil = Date.now() + 1600;
  await webViews.activate(account);
  await googleVoice.activate(account);
});
ipcMain.handle("view:bounds", (_event, bounds) => {
  webViews.setBounds(bounds);
  googleVoice.setBounds(bounds);
});
ipcMain.handle("view:capture-preview", async (_event, account) => {
  if (!webViews.isWebPlatform(account.platform)) return void 0;
  return webViews.capturePreview(account.id);
});
ipcMain.on("workspace-notice:set", (_event, message, bounds, progress) => {
  workspaceNoticeMessage = typeof message === "string" && message.trim() ? message.trim() : void 0;
  workspaceNoticeProgress = typeof progress === "number" && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : void 0;
  workspaceNoticeBounds = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) } : void 0;
  updateWorkspaceNoticeOverlay();
});
ipcMain.handle("translate:text", (_event, text, target, source) => translator.translate(text, target, source));
ipcMain.handle("translation:test-api", (_event, provider, apiKey, groqConfig) => translator.testApi(provider, String(apiKey || ""), groqConfig));
ipcMain.handle("whatsapp:send-translated", (_event, accountId, text) => webViews.sendWhatsAppTranslated(accountId, text));
ipcMain.on("whatsapp:database-error", (event, payload) => {
  const accountId = String(payload?.accountId || "");
  const account = store.get().accounts.find((candidate) => candidate.id === accountId && candidate.platform === "whatsapp");
  if (!account) return;
  runtimeLog("WhatsApp database error detected", {
    accountId,
    url: String(payload?.url || "").slice(0, 300),
    evidence: String(payload?.evidence || "").slice(0, 500)
  });
  void webViews.recoverWhatsAppDatabase(account, event.sender.id).then((action) => {
    if (action) runtimeLog("WhatsApp database recovery action", { accountId, action });
  }).catch((error) => {
    runtimeLog("WhatsApp database recovery failed", {
      accountId,
      message: error instanceof Error ? error.message : String(error)
    });
  });
});
ipcMain.on("whatsapp:database-healthy", (event, payload) => {
  const accountId = String(payload?.accountId || "");
  if (!store.get().accounts.some((account) => account.id === accountId && account.platform === "whatsapp")) return;
  webViews.reportWhatsAppDatabaseHealthy(accountId, event.sender.id);
});
ipcMain.handle("appearance:native-effects", (_event, enabled) => setNativeWindowEffects());
ipcMain.handle("appearance:set-theme", (_event, mode) => applyAppearanceTheme(mode));
ipcMain.handle("account:start", async (_event, account) => {
  runtimeLog("account start requested", { accountId: account.id, platform: account.platform });
  if (webViews.isWebPlatform(account.platform)) await webViews.activate(account);
  else if (account.platform === "signal") await signal.start(account);
  else if (account.platform === "googlevoice") await googleVoice.activate(account);
});
ipcMain.handle("account:refresh", async (_event, account) => {
  if (webViews.isWebPlatform(account.platform)) {
    await webViews.refresh(account);
    if (store.get().selectedAccountId === account.id) await webViews.activate(account);
  } else if (account.platform === "signal") {
    if (activeSignalWindow?.account.id === account.id) activeSignalWindow = void 0;
    signal.remove(account);
    await signal.start(account);
  } else if (account.platform === "googlevoice") {
    await googleVoice.refresh(account);
    if (store.get().selectedAccountId === account.id) await googleVoice.activate(account);
  }
});
ipcMain.handle("account:close", async (_event, account) => {
  if (webViews.isWebPlatform(account.platform)) {
    webViews.close(account);
  } else if (account.platform === "signal") {
    if (activeSignalWindow?.account.id === account.id) activeSignalWindow = void 0;
    signal.remove(account);
  } else if (account.platform === "googlevoice") googleVoice.close(account);
  clearAccountUnreadState(account.id);
});
ipcMain.handle("account:preferences", async (_event, account) => {
  if (webViews.isWebPlatform(account.platform)) webViews.applyPreferences(account);
  else if (account.platform === "signal") signal.applyTranslationPreferences(account);
  else if (account.platform === "googlevoice") googleVoice.applyPreferences(account);
});
ipcMain.on("signal:set-active-account", (_event, accountId, preservePrevious = false) => {
  if (selectedSignalAccountId === accountId && !preservePrevious) return;
  signalSelectionGeneration += 1;
  workspaceTaskbarPreviewSuspendedUntil = Date.now() + 1600;
  const previousSignalWindow = activeSignalWindow;
  selectedSignalAccountId = accountId;
  const transitionSourceId = preservePrevious && accountId ? previousSignalWindow?.account.id : void 0;
  hideUnselectedSignalWindows(transitionSourceId);
});
ipcMain.handle("signal:attach-window", async (_event, account, bounds) => {
  runtimeLog("Signal attach requested", { accountId: account.id, bounds });
  if (!mainWindow) throw new Error("Main window is not available.");
  if (account.platform !== "signal") throw new Error("Signal window embedding is only available for Signal accounts.");
  await signal.attach(account, nativeWindowHandle(mainWindow), toScreenBounds(bounds), false);
  await signal.setVisible(account, false, void 0, false, true);
  if (selectedSignalAccountId !== account.id) return;
  setTimeout(() => void refreshWorkspaceTaskbarPreview(), 250);
  activeSignalWindow = { account, bounds, visible: false };
});
ipcMain.handle("signal:set-window-visible", async (_event, account, visible, bounds) => {
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
ipcMain.handle("signal:update-desktop", async (_event, account) => {
  return updateSignalDesktopAndRestart(account);
});
ipcMain.handle("signal:update-desktop-status", () => signal.isBundledDesktopUpdateRunning());
ipcMain.handle("app-patch:check", () => appPatches.checkForUpdate());
ipcMain.handle("app-patch:download", () => appPatches.download());
ipcMain.handle("app-patch:apply", () => appPatches.applyDownloaded());
ipcMain.on("signal:move-window", (_event, account, visible, bounds) => {
  if (account.platform !== "signal") return;
  if (visible && selectedSignalAccountId !== account.id) return;
  activeSignalWindow = { account, bounds, visible };
  if (visible && (mainWindow?.isMinimized() || signalMinimizedWithOwner)) {
    markSignalPresentationSuspended();
    signalMinimizedWithOwner = true;
    return;
  }
  const actualVisible = visible && !signalSuspendedWithMainWindow && canPresentSignalInWorkspace(account.id);
  void signal.setVisible(account, actualVisible, toScreenBounds(bounds)).catch(() => void 0);
});
ipcMain.handle("account:remove", async (_event, account) => {
  clearAccountUnreadState(account.id);
  try {
    if (account.platform === "signal") {
      if (activeSignalWindow?.account.id === account.id) activeSignalWindow = void 0;
      await signal.deleteAccount(account);
    } else if (account.platform === "googlevoice") await googleVoice.remove(account);
    else await webViews.remove(account);
  } finally {
    clearAccountUnreadState(account.id);
  }
});
ipcMain.handle("external:open", (_event, url) => shell.openExternal(url));
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
    await createWindow();
  }).catch((error) => {
    runtimeLog("create window failed", error instanceof Error ? { message: error.message, stack: error.stack } : String(error));
    throw error;
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
