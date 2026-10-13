const assert = require('node:assert/strict');
const test = require('node:test');
const {
  OPTIONAL_API_KEY_PLACEHOLDER,
  createCompatibleClientOptions,
  normalizeBaseUrl
} = require('../src/openai-compatible');

test('normalizes whitespace and trailing slashes in a compatible base URL', () => {
  assert.equal(
    normalizeBaseUrl('  http://127.0.0.1:18789/v1///  '),
    'http://127.0.0.1:18789/v1'
  );
  assert.equal(normalizeBaseUrl(''), '');
});

test('rejects unsafe or unsupported base URLs', () => {
  assert.throws(() => normalizeBaseUrl('not a URL'), /有效的 HTTP 或 HTTPS URL/);
  assert.throws(() => normalizeBaseUrl('ftp://localhost/v1'), /必须使用 HTTP 或 HTTPS/);
  assert.throws(() => normalizeBaseUrl('https://user:secret@example.com/v1'), /用户名或密码/);
  assert.throws(() => normalizeBaseUrl('https://example.com/v1?token=secret'), /查询参数或片段标识/);
  assert.throws(() => normalizeBaseUrl('https://example.com/v1#section'), /查询参数或片段标识/);
});

test('builds SDK options with an explicit API key', () => {
  assert.deepEqual(
    createCompatibleClientOptions(' gateway-token ', 'https://gateway.example/v1/'),
    { apiKey: 'gateway-token', baseURL: 'https://gateway.example/v1' }
  );
});

test('uses a non-secret placeholder when a local endpoint needs no API key', () => {
  assert.deepEqual(
    createCompatibleClientOptions('', 'http://127.0.0.1:11434/v1'),
    { apiKey: OPTIONAL_API_KEY_PLACEHOLDER, baseURL: 'http://127.0.0.1:11434/v1' }
  );
});

test('requires a base URL for an OpenAI-compatible client', () => {
  assert.throws(() => createCompatibleClientOptions('', ''), /设置 API 基础地址/);
});
