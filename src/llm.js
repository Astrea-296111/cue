// LLM factory — OpenAI, Anthropic, Gemini and OpenAI-compatible providers.
// Explicit mode budgets win; the larger legacy defaults serve standalone callers.

const { createCompatibleClientOptions, resolveChatRequestOptions, supportsStreamingUsage, qwenFastInstruction } = require('./openai-compatible');
const { createUsageReporter } = require('./provider-metrics');
const { realtimeTransportOptions, geminiThinkingConfig, endpointClass, thinkingDiagnostics } = require('./model-latency-policy');

const CUSTOM_PROVIDER = 'custom';
const CURRENT_GEMINI_DEFAULT = 'gemini-2.5-flash';
const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: CURRENT_GEMINI_DEFAULT,
  ollama: 'llama3.2',
  groq: 'llama-3.1-8b-instant',
  minimax: 'MiniMax-M2.7',
  azure: 'gpt-4o-mini'
};

const DEAD_GEMINI_MODEL_RE = /^gemini-(1\.0|1\.5|2\.0)(?:-|$)/i;
const PROVIDER_LABELS = {
  custom: '自定义服务',
  azure: 'Azure AI Foundry',
  openai: 'OpenAI',
  minimax: 'MiniMax'
};
const MINIMAX_BASE_URLS = {
  global_en: 'https://api.minimax.io/v1',
  cn_zh: 'https://api.minimaxi.com/v1'
};

const FAST_MAX_TOKENS = 2048;
const SMART_MAX_TOKENS = 4096;
const SCREEN_MAX_TOKENS = 4096;
const TECH_SCREEN_MAX_TOKENS = 6144;
const ABSOLUTE_MAX_TOKENS = 16384;

function normalizeProviderName(provider) {
  if (!provider) return '模型服务';
  if (PROVIDER_LABELS[provider]) return PROVIDER_LABELS[provider];
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function isQuotaError(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  const code = error && (error.code || error.error?.code);
  const rawMessage = (error && (error.message || String(error))) || '';
  const text = `${rawMessage} ${status || ''} ${code || ''}`.toLowerCase();
  return status === 429 || code === 429 || code === 'insufficient_quota' ||
    code === 'rate_limit_exceeded' || code === 'RESOURCE_EXHAUSTED' ||
    /quota|billing|rate limit|exceeded your current quota|resource_exhausted|too many requests/i.test(text);
}

function isNotFoundError(error) {
  const status = error && (error.status || error.statusCode || error.response?.status);
  const code = error && (error.code || error.error?.code);
  const rawMessage = (error && (error.message || String(error))) || '';
  const text = `${rawMessage} ${status || ''} ${code || ''}`.toLowerCase();
  return status === 404 || code === 404 ||
    /\b404\b|is not found for api version|model not found/i.test(text);
}

function extractRetryDelaySeconds(rawMessage) {
  const match = /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)\s*s/i.exec(String(rawMessage || ''));
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function formatRetryWait(seconds) {
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟`;
}

function formatProviderErrorMessage(error, provider, model) {
  const label = normalizeProviderName(provider);
  const rawMessage = (error && (error.message || String(error))) || '';

  if (isQuotaError(error)) {
    const retrySeconds = extractRetryDelaySeconds(rawMessage);
    const waitHint = retrySeconds
      ? `请等待约 ${formatRetryWait(retrySeconds)}`
      : '请稍后';
    return `${label} 请求额度或频率已达上限（HTTP 429）。${waitHint}重试，或在设置中更换服务或模型。`;
  }

  if (isNotFoundError(error)) {
    const modelHint = model ? ` "${model}"` : '';
    return `${label} 模型${modelHint}不可用（HTTP 404）。请在设置中选择可用模型，或清空模型名称以使用 Cue 默认值。`;
  }

  return rawMessage || '未知的 LLM 错误。';
}

function sanitizeTurns(turns) {
  const valid = new Set(['user', 'assistant']);
  return (turns || [])
    .filter((turn) => valid.has(turn.role))
    .map((turn) => ({ role: turn.role, text: String(turn.text || '') }));
}

function stripDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.*)$/s.exec(dataUrl || '');
  return match ? { mime: match[1], b64: match[2] } : null;
}

function clampTokenBudget(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(256, Math.min(ABSOLUTE_MAX_TOKENS, Math.floor(n)));
}

function isDedicatedTechnicalScreenPrompt(system) {
  const text = String(system || '');
  return /资深中文技术面试现场题助手|屏幕技术题模式|可直接提交的 ACM 完整代码|禁止 LeetCode|标准输入输出与 main/i.test(text);
}

function resolveMaxTokens(settings, params = {}) {
  const explicit = clampTokenBudget(params.maxTokens);
  if (explicit) return explicit;

  if (isDedicatedTechnicalScreenPrompt(params.system)) {
    return TECH_SCREEN_MAX_TOKENS;
  }

  if (params.imageDataUrl) {
    return SCREEN_MAX_TOKENS;
  }

  const system = String(params.system || '');
  if (/项目深挖|项目知识文档|系统设计/i.test(system)) {
    return Math.max(3072, settings && settings.smart ? SMART_MAX_TOKENS : FAST_MAX_TOKENS);
  }

  return settings && settings.smart ? SMART_MAX_TOKENS : FAST_MAX_TOKENS;
}

function appendTruncationNotice(onToken) {
  if (typeof onToken !== 'function') return;
  onToken('\n\n⚠️ 输出达到模型长度上限。可以再次点击“截屏”，或要求“从刚才中断处继续”。');
}

// Completion describes the provider's terminal event, not semantic question
// coverage. Missing metadata remains unknown; callers still receive a string.
function finishStream(onCompletion, signal, full, finishReason, options = {}) {
  if (signal?.aborted) throw new Error('回答已取消。');
  const reason = typeof finishReason === 'string' && finishReason.trim() ? finishReason : null;
  const normalized = String(reason || '').toLowerCase();
  const truncated = !!options.truncated || ['length', 'max_tokens'].includes(normalized);
  const refused = !!options.refused || ['content_filter', 'refusal', 'safety', 'blocked'].includes(normalized);
  const complete = (options.normalReasons || ['stop']).includes(normalized) &&
    !!full.trim() && !truncated && !refused && !options.toolUse;
  if (typeof onCompletion === 'function') onCompletion({ finishReason: reason, complete, truncated, refused });
}

async function streamOpenAI({ apiKey, baseURL, model, system, turns, imageDataUrl, maxTokens, onToken, signal, onActivity, onCompletion, onRequest, onUsage, requestOptions = {}, transportOptions = {} }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...transportOptions });
  const messages = [{ role: 'system', content: system }];

  turns.forEach((turn, index) => {
    const last = index === turns.length - 1;
    if (last && imageDataUrl && turn.role === 'user') {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: turn.text },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      });
    } else {
      messages.push({ role: turn.role, content: turn.text });
    }
  });

  const request = {
    model,
    messages,
    stream: true,
    max_tokens: maxTokens,
    ...requestOptions,
    ...(typeof onUsage === 'function' && supportsStreamingUsage(baseURL)
      ? { stream_options: { include_usage: true } } : {})
  };
  if (typeof onRequest === 'function') onRequest(request);
  const reportUsage = createUsageReporter('openai-compatible', onUsage);
  const stream = await client.chat.completions.create(request, { signal });
  onActivity?.({ phase: 'provider-response' });

  let full = '';
  let finishReason = null;
  let truncated = false, refused = false, toolUse = false;
  for await (const part of stream) {
    if (signal?.aborted) throw new Error('回答已取消。');
    onActivity?.({ phase: part.choices?.[0]?.delta?.reasoning_content || part.choices?.[0]?.delta?.reasoning ? 'reasoning' : 'provider-event' });
    reportUsage(part.usage);
    const choice = part.choices && part.choices[0];
    const delta = choice && choice.delta && choice.delta.content;
    if (delta) {
      full += delta;
      onToken(delta);
    }
    if (choice?.delta?.refusal || choice?.message?.refusal) refused = true;
    if (choice?.delta?.tool_calls?.length || choice?.delta?.function_call) toolUse = true;
    if (choice && choice.finish_reason) {
      finishReason = choice.finish_reason;
      if (finishReason === 'length') truncated = true;
      if (finishReason === 'content_filter' || finishReason === 'refusal') refused = true;
      if (finishReason === 'tool_calls' || finishReason === 'function_call') toolUse = true;
    }
  }
  if (finishReason === 'length') appendTruncationNotice(onToken);
  finishStream(onCompletion, signal, full, finishReason, { truncated, refused, toolUse });
  return full;
}

function normalizeAzureBaseURL(raw) {
  let url = String(raw || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');
  if (!url) return '';
  if (/cognitiveservices\.azure\.com/i.test(url) && !/\/openai\/v1$/i.test(url)) {
    url += '/openai/v1';
  }
  return url;
}

async function streamAzure({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, endpoint, signal, onActivity, onCompletion, onRequest, onUsage, requestOptions = {}, transportOptions = {} }) {
  const url = normalizeAzureBaseURL(endpoint);
  if (!url) {
    throw new Error('未配置 Azure 服务地址，请在设置中填写 Azure AI Foundry 或 Azure OpenAI 地址。');
  }

  const messages = [{ role: 'system', content: system }];
  turns.forEach((turn, index) => {
    const last = index === turns.length - 1;
    if (last && imageDataUrl && turn.role === 'user') {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: turn.text },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      });
    } else {
      messages.push({ role: turn.role, content: turn.text });
    }
  });

  const OpenAI = require('openai');
  let client;
  if (/openai\.azure\.com/i.test(url)) {
    client = new OpenAI.AzureOpenAI({
      endpoint: url.replace(/\/openai$/i, ''),
      apiKey,
      apiVersion: '2024-10-21',
      ...transportOptions
    });
  } else {
    const azureFetch = async (input, init) => {
      const headers = new Headers(init && init.headers);
      headers.set('api-key', apiKey);
      headers.delete('authorization');
      return fetch(input, { ...init, headers });
    };
    client = new OpenAI({ baseURL: url, apiKey, fetch: azureFetch, ...transportOptions });
  }

  const request = {
    model,
    messages,
    stream: true,
    max_completion_tokens: maxTokens,
    ...requestOptions,
    ...(typeof onUsage === 'function' ? { stream_options: { include_usage: true } } : {})
  };
  if (typeof onRequest === 'function') onRequest(request);
  const reportUsage = createUsageReporter('openai-compatible', onUsage);
  const stream = await client.chat.completions.create(request, { signal });
  onActivity?.({ phase: 'provider-response' });

  let full = '';
  let finishReason = null;
  let truncated = false, refused = false, toolUse = false;
  for await (const part of stream) {
    if (signal?.aborted) throw new Error('回答已取消。');
    onActivity?.({ phase: part.choices?.[0]?.delta?.reasoning_content || part.choices?.[0]?.delta?.reasoning ? 'reasoning' : 'provider-event' });
    reportUsage(part.usage);
    const choice = part.choices && part.choices[0];
    const delta = choice && choice.delta && choice.delta.content;
    if (delta) {
      full += delta;
      onToken(delta);
    }
    if (choice?.delta?.refusal || choice?.message?.refusal) refused = true;
    if (choice?.delta?.tool_calls?.length || choice?.delta?.function_call) toolUse = true;
    if (choice && choice.finish_reason) {
      finishReason = choice.finish_reason;
      if (finishReason === 'length') truncated = true;
      if (finishReason === 'content_filter' || finishReason === 'refusal') refused = true;
      if (finishReason === 'tool_calls' || finishReason === 'function_call') toolUse = true;
    }
  }
  if (finishReason === 'length') appendTruncationNotice(onToken);
  finishStream(onCompletion, signal, full, finishReason, { truncated, refused, toolUse });
  return full;
}

async function streamAnthropic({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, signal, onActivity, onCompletion, onRequest, onUsage, transportOptions = {} }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, ...transportOptions });

  const messages = turns.map((turn, index) => {
    const last = index === turns.length - 1;
    if (last && imageDataUrl && turn.role === 'user') {
      const image = stripDataUrl(imageDataUrl);
      const content = [];
      if (image) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mime,
            data: image.b64
          }
        });
      }
      content.push({ type: 'text', text: turn.text });
      return { role: 'user', content };
    }
    return { role: turn.role, content: turn.text };
  });

  const request = {
    model,
    max_tokens: maxTokens,
    system,
    messages,
    stream: true
  };
  if (typeof onRequest === 'function') onRequest(request);
  const reportUsage = createUsageReporter('anthropic', onUsage);
  const stream = await client.messages.create(request, { signal });
  onActivity?.({ phase: 'provider-response' });

  let full = '';
  let stopReason = null;
  let truncated = false, refused = false, toolUse = false;
  for await (const event of stream) {
    if (signal?.aborted) throw new Error('回答已取消。');
    onActivity?.({ phase: event.delta?.type === 'thinking_delta' ? 'reasoning' : 'provider-event' });
    reportUsage(event.type === 'message_start' ? event.message?.usage : event.usage);
    if (
      event.type === 'content_block_delta' &&
      event.delta &&
      event.delta.type === 'text_delta'
    ) {
      full += event.delta.text;
      onToken(event.delta.text);
    }
    if (event.type === 'message_delta' && event.delta && event.delta.stop_reason) {
      stopReason = event.delta.stop_reason;
      if (stopReason === 'max_tokens') truncated = true;
      if (stopReason === 'refusal') refused = true;
      if (stopReason === 'tool_use') toolUse = true;
    }
    if (event.content_block?.type === 'tool_use' || event.delta?.type === 'input_json_delta') toolUse = true;
  }
  if (stopReason === 'max_tokens') appendTruncationNotice(onToken);
  finishStream(onCompletion, signal, full, stopReason, {
    normalReasons: ['end_turn', 'stop_sequence'], truncated, refused, toolUse
  });
  return full;
}

async function streamGemini({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, signal, onActivity, onCompletion, onRequest, onUsage, thinkingConfig, transportOptions = {} }) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const contents = turns.map((turn, index) => {
    const last = index === turns.length - 1;
    const parts = [{ text: turn.text }];
    if (last && imageDataUrl && turn.role === 'user') {
      const image = stripDataUrl(imageDataUrl);
      if (image) {
        parts.push({ inlineData: { mimeType: image.mime, data: image.b64 } });
      }
    }
    return {
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts
    };
  });

  const request = {
    model,
    contents,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      ...(thinkingConfig ? { thinkingConfig } : {}),
      ...(transportOptions.maxRetries === 0 ? { httpOptions: { retryOptions: { attempts: 1 } } } : {}),
      abortSignal: signal
    }
  };
  if (typeof onRequest === 'function') onRequest(request);
  const reportUsage = createUsageReporter('gemini', onUsage);
  const stream = await ai.models.generateContentStream(request);
  onActivity?.({ phase: 'provider-response' });

  let full = '';
  let finishReason = null;
  let truncated = false, refused = false, toolUse = false;
  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error('回答已取消。');
    onActivity?.({ phase: chunk.candidates?.[0]?.content?.parts?.some(part => part.thought) ? 'reasoning' : 'provider-event' });
    reportUsage(chunk.usageMetadata);
    // SDK .text can concatenate thought parts. Only visible content is an
    // answer; never turn a thought-only frame into a body token.
    const parts = chunk.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.filter(part => !part.thought && typeof part.text === 'string')
      .map(part => part.text).join('') : chunk && chunk.text;
    if (text) {
      full += text;
      onToken(text);
    }
    const candidate = chunk && chunk.candidates && chunk.candidates[0];
    if (candidate && candidate.finishReason) {
      finishReason = candidate.finishReason;
      const reason = String(finishReason).toUpperCase();
      if (reason === 'MAX_TOKENS') truncated = true;
      if (['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII',
        'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'MODEL_ARMOR'].includes(reason)) refused = true;
      if (reason === 'MALFORMED_FUNCTION_CALL' || reason === 'UNEXPECTED_TOOL_CALL') toolUse = true;
    }
    if (candidate?.content?.parts?.some(part => part.functionCall)) toolUse = true;
    if (candidate?.safetyRatings?.some(rating => rating.blocked)) refused = true;
    if (chunk.promptFeedback?.blockReason && chunk.promptFeedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') refused = true;
  }
  if (String(finishReason || '').toUpperCase() === 'MAX_TOKENS') {
    appendTruncationNotice(onToken);
  }
  finishStream(onCompletion, signal, full, finishReason, { truncated, refused, toolUse });
  return full;
}

async function streamOllama({ apiKey, model, system, turns, imageDataUrl, maxTokens, onToken, signal, onActivity, onCompletion, onRequest, onUsage }) {
  const baseUrl = apiKey || 'http://localhost:11434';
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const messages = [{ role: 'system', content: system }];

  turns.forEach((turn, index) => {
    const last = index === turns.length - 1;
    if (last && imageDataUrl && turn.role === 'user') {
      const image = stripDataUrl(imageDataUrl);
      messages.push(
        image
          ? { role: 'user', content: turn.text, images: [image.b64] }
          : { role: 'user', content: turn.text }
      );
    } else {
      messages.push({ role: turn.role, content: turn.text });
    }
  });

  let response;
  const request = { model, messages, stream: true, options: { num_predict: maxTokens } };
  if (typeof onRequest === 'function') onRequest(request);
  const reportUsage = createUsageReporter('ollama', onUsage);
  try {
    response = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  } catch (error) {
    throw new Error(`Ollama 请求失败：${error.message}。请确认 Ollama 已启动且地址 ${baseUrl} 可访问。`);
  }

  if (!response.ok) {
    throw new Error(`Ollama API 错误： ${response.status} ${response.statusText}`);
  }
  onActivity?.({ phase: 'provider-response' });

  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  let finishReason = null;
  let done = false, toolUse = false;
  function acceptLine(line) {
    if (!line.trim()) return;
    let data;
    try { data = JSON.parse(line); } catch (_) { return; }
    if (data.error) throw new Error(`Ollama API 错误： ${data.error}`);
    onActivity?.({ phase: data.message?.thinking ? 'reasoning' : 'provider-event' });
    if (data.message?.content) {
      full += data.message.content;
      onToken(data.message.content);
    }
    if (data.message?.tool_calls?.length) toolUse = true;
    if (data.done === true) {
      reportUsage(data);
      done = true;
      finishReason = data.done_reason || null;
    }
  }
  for await (const chunk of response.body) {
    if (signal?.aborted) throw new Error('回答已取消。');
    if (typeof onActivity === 'function') onActivity();
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) acceptLine(line);
  }

  buffer += decoder.decode();
  if (buffer.trim()) acceptLine(buffer);
  if (finishReason === 'length') appendTruncationNotice(onToken);
  finishStream(onCompletion, signal, full, finishReason, { normalReasons: done ? ['stop'] : [], toolUse });
  return full;
}

function createLLM(settings, { executionProfile = 'standard' } = {}) {
  executionProfile = executionProfile === 'instant' ? 'instant' : 'standard';
  // Request-local choice: the persistent deep-mode switch remains untouched.
  if (executionProfile === 'instant') settings = { ...settings, smart: false };
  const provider = settings.provider;
  const keys = settings.apiKeys || {};
  let apiKey = keys[provider];
  let baseURL = '';
  let configurationError = '';
  const tier = settings.smart ? 'smart' : 'fast';
  const models = settings.models || {};
  let model = (models[provider] || {})[tier];

  if (provider === 'gemini' && DEAD_GEMINI_MODEL_RE.test(model || '')) {
    model = CURRENT_GEMINI_DEFAULT;
  }
  if (!model) model = DEFAULT_MODELS[provider] || '';

  const minimaxRegion = settings.minimaxRegion || 'global_en';
  const endpoint = settings.azureEndpoint || '';

  if (provider === CUSTOM_PROVIDER) {
    try {
      const clientOptions = createCompatibleClientOptions(apiKey, settings.baseUrl);
      apiKey = clientOptions.apiKey;
      baseURL = clientOptions.baseURL;
    } catch (error) {
      configurationError = error.message;
    }
    if (!model && !configurationError) {
      configurationError = '请为自定义服务设置快速模型或深度模型。';
    }
  } else if (provider !== 'ollama' && !apiKey) {
    configurationError = `请在设置中填写 ${provider} API 密钥。`;
  }

  if (!configurationError && provider === 'azure' && !endpoint) {
    configurationError = '请在设置中填写 Azure AI Foundry 服务地址。';
  }

  const ready = !configurationError && !!model;
  const inheritedOptions = settings.providerOptions?.[provider] || {};
  const instantOptions = executionProfile === 'instant' ? settings.instantProviderOptions?.[provider] || {} : {};
  const providerOptions = { ...inheritedOptions, ...instantOptions };
  const thinkingSource = Object.keys(instantOptions).some(key => ['enable_thinking', 'reasoning_effort', 'thinkingConfig'].includes(key))
    ? 'instant-explicit' : Object.keys(inheritedOptions).some(key => ['enable_thinking', 'reasoning_effort', 'thinkingConfig'].includes(key))
      ? 'user-explicit' : 'unknown';
  const prepareSystem = (system, options = providerOptions) => {
    const suffix = qwenFastInstruction({ model, smart: !!settings.smart, explicit: options });
    const text = String(system || '');
    return suffix && !text.trimEnd().endsWith(suffix) ? text + '\n' + suffix : text;
  };
  const effectiveBaseURL = provider === 'groq' ? 'https://api.groq.com/openai/v1'
    : provider === 'minimax' ? MINIMAX_BASE_URLS[minimaxRegion] || MINIMAX_BASE_URLS.global_en
      : baseURL;
  function diagnostics(params = {}) {
    const explicit = { ...providerOptions, ...(params.requestOptions || {}),
      ...(typeof params.enable_thinking === 'boolean' ? { enable_thinking: params.enable_thinking } : {}),
      ...(typeof params.reasoning_effort === 'string' ? { reasoning_effort: params.reasoning_effort } : {}) };
    const requestOptions = resolveChatRequestOptions({ baseURL: effectiveBaseURL, model, smart: !!settings.smart, explicit });
    const thinkingConfig = geminiThinkingConfig(model, !!settings.smart, explicit.thinkingConfig);
    const transportOptions = realtimeTransportOptions(settings, params.mode, executionProfile);
    const automaticRetriesDisabled = provider === 'ollama' || transportOptions.maxRetries === 0;
    return { provider, model, executionProfile, tier,
      endpointClass: endpointClass(provider, effectiveBaseURL),
      ...thinkingDiagnostics({ provider, model, baseURL: effectiveBaseURL, requestOptions, thinkingConfig,
        source: Object.keys(params.requestOptions || {}).length || typeof params.enable_thinking === 'boolean' || params.reasoning_effort
          ? 'user-explicit' : thinkingSource }),
      automaticRetriesDisabled,
      transportRetryPolicy: provider === 'ollama' ? 'single-fetch' : automaticRetriesDisabled ? 'one-attempt' : 'sdk-default',
      responseBoundary: provider === 'ollama' ? 'http-headers' : 'sdk-stream-resolved' };
  }

  return {
    provider,
    model,
    apiKey,
    baseURL,
    ready,
    configurationError,
    prepareSystem,
    executionProfile,
    tier,
    diagnostics: diagnostics(),

    async stream(params = {}) {
      if (!ready) {
        throw new Error(configurationError || `请先完成 ${provider} 服务设置。`);
      }

      const maxTokens = resolveMaxTokens(settings, params);
      const explicit = { ...providerOptions, ...(params.requestOptions || {}),
        ...(typeof params.enable_thinking === 'boolean' ? { enable_thinking: params.enable_thinking } : {}),
        ...(typeof params.reasoning_effort === 'string' ? { reasoning_effort: params.reasoning_effort } : {}) };
      const args = {
        apiKey,
        baseURL,
        endpoint,
        model,
        ...params,
        system: prepareSystem(params.system, explicit),
        requestOptions: resolveChatRequestOptions({ baseURL, model, smart: !!settings.smart, explicit }),
        transportOptions: realtimeTransportOptions(settings, params.mode, executionProfile),
        thinkingConfig: geminiThinkingConfig(model, !!settings.smart, explicit.thinkingConfig),
        maxTokens,
        turns: sanitizeTurns(params.turns),
        onActivity: typeof params.onActivity === 'function' ? params.onActivity : () => {},
        onToken: typeof params.onToken === 'function' ? params.onToken : () => {}
      };
      if (typeof params.onDiagnostics === 'function') params.onDiagnostics(diagnostics(params));

      try {
        if (provider === 'openai') return await streamOpenAI(args);
        if (provider === CUSTOM_PROVIDER) return await streamOpenAI(args);
        if (provider === 'ollama') return await streamOllama(args);
        if (provider === 'groq') {
          return await streamOpenAI({ ...args, baseURL: 'https://api.groq.com/openai/v1' });
        }
        if (provider === 'minimax') {
          return await streamOpenAI({
            ...args,
            baseURL: MINIMAX_BASE_URLS[minimaxRegion] || MINIMAX_BASE_URLS.global_en
          });
        }
        if (provider === 'anthropic') return await streamAnthropic(args);
        if (provider === 'gemini') return await streamGemini(args);
        if (provider === 'azure') return await streamAzure(args);
        throw new Error('未知模型服务：' + provider);
      } catch (error) {
        throw new Error(formatProviderErrorMessage(error, provider, model));
      }
    }
  };
}

module.exports = {
  createLLM,
  formatProviderErrorMessage,
  isQuotaError,
  CURRENT_GEMINI_DEFAULT,
  resolveMaxTokens,
  FAST_MAX_TOKENS,
  SMART_MAX_TOKENS,
  SCREEN_MAX_TOKENS,
  TECH_SCREEN_MAX_TOKENS
};
