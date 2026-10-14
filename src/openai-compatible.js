const SUPPORTED_BASE_URL_PROTOCOLS = new Set(['http:', 'https:']);
const OPTIONAL_API_KEY_PLACEHOLDER = 'not-required';

/**
 * Normalize and validate an OpenAI-compatible API base URL.
 *
 * Credentials and query fragments are rejected because the configured API key
 * is already sent through the Authorization header. Keeping secrets out of the
 * URL also avoids accidental disclosure through logs and error messages.
 *
 * @param {unknown} value Raw setting value.
 * @returns {string} A normalized URL without trailing slashes, or an empty string.
 */
function normalizeBaseUrl(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return '';

  let parsedUrl;
  try {
    parsedUrl = new URL(input);
  } catch {
    throw new Error('API 基础地址必须是有效的 HTTP 或 HTTPS URL。');
  }

  if (!SUPPORTED_BASE_URL_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error('API 基础地址必须使用 HTTP 或 HTTPS。');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('API 基础地址不能包含用户名或密码。');
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error('API 基础地址不能包含查询参数或片段标识。');
  }

  return parsedUrl.toString().replace(/\/+$/, '');
}

/**
 * Build constructor options for the OpenAI SDK when targeting a compatible API.
 * Local servers commonly require no API key, but the SDK requires a non-empty
 * value, so a non-secret placeholder is supplied only when the setting is blank.
 *
 * @param {unknown} apiKey Raw API key setting.
 * @param {unknown} baseUrl Raw base URL setting.
 * @returns {{apiKey: string, baseURL: string}} OpenAI SDK client options.
 */
function createCompatibleClientOptions(apiKey, baseUrl) {
  const baseURL = normalizeBaseUrl(baseUrl);
  if (!baseURL) {
    throw new Error('请为自定义模型服务设置 API 基础地址。');
  }

  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  return {
    apiKey: normalizedApiKey || OPTIONAL_API_KEY_PLACEHOLDER,
    baseURL
  };
}

function isDashScopeChatEndpoint(value) {
  try {
    const parsed = new URL(String(value || ''));
    return /^dashscope(?:-intl|-us)?\.aliyuncs\.com$/i.test(parsed.hostname) &&
      /^\/compatible-mode\/v1\/?$/i.test(parsed.pathname);
  } catch (_) { return false; }
}

// Only the original Qwen3 hybrid checkpoints are included. Instruct-2507,
// Thinking-2507, QwQ and future/unknown aliases have different capabilities.
// Official checkpoint documentation: github.com/QwenLM/Qwen3 (hybrid mode).
const HYBRID_QWEN3_MODEL = /^qwen3-(?:0\.6b|1\.7b|4b|8b|14b|32b|30b-a3b|235b-a22b)$/i;

function resolveChatRequestOptions({ baseURL, model, smart, explicit = {} } = {}) {
  const result = {};
  if (isDashScopeChatEndpoint(baseURL) && HYBRID_QWEN3_MODEL.test(String(model || ''))) {
    result.enable_thinking = !!smart;
  }
  // Only explicit user settings travel to arbitrary compatible servers. Never
  // infer an unsupported reasoning_effort from a model's name prefix.
  if (typeof explicit.enable_thinking === 'boolean') result.enable_thinking = explicit.enable_thinking;
  if (typeof explicit.reasoning_effort === 'string' && /^(?:none|minimal|low|medium|high|xhigh)$/i.test(explicit.reasoning_effort)) {
    result.reasoning_effort = explicit.reasoning_effort;
  }
  return result;
}

function supportsStreamingUsage(baseURL) {
  if (!baseURL) return true; // Official OpenAI client default.
  if (isDashScopeChatEndpoint(baseURL)) return true;
  try { return new URL(baseURL).hostname === 'api.openai.com'; } catch (_) { return false; }
}

module.exports = {
  OPTIONAL_API_KEY_PLACEHOLDER,
  createCompatibleClientOptions,
  normalizeBaseUrl,
  isDashScopeChatEndpoint,
  resolveChatRequestOptions,
  supportsStreamingUsage
};
