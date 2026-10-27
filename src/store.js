// Simple JSON-file settings store (avoids native modules so `npm install` stays clean).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalizeBaseUrl } = require('./openai-compatible');

const FILE = path.join(app.getPath('userData'), 'cue-data.json');
const MAX_AI_RULES_CHARS = 2000;

const DEFAULTS = {
  provider: 'openai',
  sttProvider: 'auto',
  // Cloud STT language hint: auto | zh | en. 'auto' omits provider-specific hard hints where possible.
  sttLanguage: 'auto',
  localWhisper: { modelId: 'small', language: 'zh', threads: 0 },
  smart: false,
  realtimeEvidencePrefetch: true,
  realtimeAnswerMode: 'instant',
  saveInterviewTranscript: true,
  liveContextPolicy: { ...require('./live-context-policy').DEFAULTS },
  speechInputMode: 'dual-channel',
  qaAnswerDetailed: false,
  vibeMaxTokens: 4000,
  responseBudgets: { oral: 600, code: 6000 },
  instantRagPolicy: 'ready-only',
  projectFactsEnabled: true,
  sourceRagPolicies: { instant: 'ready-only', standard: 'standard' },
  projectMaterialSettingsVersion: 1,
  projectMaterialMigrationNotice: true,
  manualProjectKnowledgeEnabled: true,
  baseUrl: '',
  deepseekBaseUrl: 'https://api.deepseek.com',
  firstContentDeadlineMs: 6000,
  providerOptions: {},
  providerProtocolPresets: {},
  instantProviderOptions: { deepseek: { thinking: { type: 'disabled' } } },
  minimaxRegion: 'global_en',
  apiKeys: { deepseek: '', openai: '', anthropic: '', gemini: '', deepgram: '', custom: '', ollama: '', groq: '', minimax: '' , azure: '' },
  azureEndpoint: '',

  // 候选人资料
  resumeText: '',
  projectKnowledge: '', // 简历项目知识文档：架构、链路、难点、指标、故障、取舍、复盘等
  answerDomain: 'general',
  currentProjectId: '', // 空值表示自动；只作为无显式项目时的默认选择。
  contextWindowTokens: 16384,
  jobDescription: '',
  // Separate candidate facts from role requirements; changing a role never rewrites evidence.
  candidateProfile: null,
  jobProfiles: [],
  activeJobProfileId: '',
  personalWorkspace: {},
  personalWorkspaceRevision: '',

  // 面试准备
  starStories: '',
  whyCompany: '',
  whyLeaving: '',
  workStyle: '',

  // Q&A
  salaryTarget: '',
  questionsToAsk: '',

  // 自定义回答风格；屏幕技术题模式保持严格格式，因此不应用这里的规则。
  aiRules: '',

  windowX: null,
  windowY: null,
  models: {
    deepseek: { fast: 'deepseek-flash', smart: 'deepseek-flash' },
    openai: { fast: 'gpt-4o-mini', smart: 'gpt-4o' },
    anthropic: { fast: 'claude-3-5-haiku-latest', smart: 'claude-3-5-sonnet-latest' },
    gemini: { fast: 'gemini-2.5-flash', smart: 'gemini-2.5-flash' },
    custom: { fast: '', smart: '' },
    ollama: { fast: 'llama3.2', smart: 'llama3.3' },
    groq: { fast: 'llama-3.1-8b-instant', smart: 'llama-3.3-70b-versatile' },
    minimax: { fast: 'MiniMax-M2.7', smart: 'MiniMax-M3' },
    azure: { fast: 'gpt-4o-mini', smart: 'gpt-4o' }
  }
};

let data = null;

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      if (k === 'aiRules' && typeof over[k] === 'string') out[k] = over[k].slice(0, MAX_AI_RULES_CHARS);
      else out[k] = over[k];
    }
  }
  return out;
}

function migrateMaterialSettings(raw = {}) {
  const next = { ...raw, ...require('./answer-domain').migrate(raw) };
  if (!Object.hasOwn(raw, 'projectFactsEnabled')) next.projectFactsEnabled = true;
  next.sourceRagPolicies = { ...(raw.sourceRagPolicies || {}) };
  if (!Object.hasOwn(next.sourceRagPolicies, 'instant')) next.sourceRagPolicies.instant = raw.instantRagPolicy === 'off' ? 'off' : 'ready-only';
  if (!Object.hasOwn(next.sourceRagPolicies, 'standard')) next.sourceRagPolicies.standard = 'standard';
  if (!raw.projectMaterialSettingsVersion) next.projectMaterialMigrationNotice = true;
  next.projectMaterialSettingsVersion = 1;
  return next;
}
function load() {
  if (data) return data;
  try { data = deepMerge(DEFAULTS, migrateMaterialSettings(JSON.parse(fs.readFileSync(FILE, 'utf8')))); }
  catch { data = deepMerge(DEFAULTS, {}); }
  return data;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temporary = FILE + '.tmp-' + process.pid;
  try {
    const fd = fs.openSync(temporary, 'w', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temporary, FILE);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

module.exports = {
  MAX_AI_RULES_CHARS, migrateMaterialSettings,
  getSettings() { return load(); },
  verifyPersisted() {
    if (JSON.stringify(JSON.parse(fs.readFileSync(FILE, 'utf8'))) !== JSON.stringify(load())) throw new Error('设置持久化校验失败');
    return true;
  },
  setSettings(patch, { replaceFields = [], deleteFields = [] } = {}) {
    load();
    const update = { ...(patch || {}) };
    if (Object.hasOwn(update, 'instantRagPolicy') && !update.sourceRagPolicies) update.sourceRagPolicies = { instant: update.instantRagPolicy === 'off' ? 'off' : 'ready-only' };
    const nextSettings = deepMerge(data, update);
    // Transaction compensation replaces only explicitly owned top-level fields;
    // recursive merging would retain keys introduced by a failed profile import.
    for (const key of replaceFields) if (Object.hasOwn(update, key)) nextSettings[key] = update[key];
    for (const key of deleteFields) delete nextSettings[key];
    nextSettings.baseUrl = normalizeBaseUrl(nextSettings.baseUrl);
    nextSettings.liveContextPolicy = require('./live-context-policy').normalize(nextSettings.liveContextPolicy);
    nextSettings.deepseekBaseUrl = normalizeBaseUrl(nextSettings.deepseekBaseUrl || 'https://api.deepseek.com');
    const previous = data;
    data = nextSettings;
    try { save(); } catch (error) { data = previous; throw error; }
    return data;
  }
};
