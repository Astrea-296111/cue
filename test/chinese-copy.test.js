'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createInterviewRuntime } = require('./helpers/interview-agent-runtime');
const { pcmToWav } = require('../src/wav');

for (const indexVersion of [1, 2]) {
test(`v${indexVersion}: Chinese project and style instructions reach final SDK messages without translating user materials`, async t => {
  const material = 'RepoPilot uses LangGraph. Candidate owned the tool validation flow.';
  const rules = 'Use short paragraphs.';
  const app = createInterviewRuntime(t, { indexVersion, settings: { projectKnowledge: material, aiRules: rules } });
  await app.ask('say', '介绍 RepoPilot 项目的架构？');
  const request = app.calls.at(-1);
  const system = request.messages[0].content;
  assert.match(system, /项目与情景回答/);
  assert.match(system, /项目面试卡片/);
  assert.match(system, /--- 用户回答规则开始 ---/);
  assert.doesNotMatch(system, /Interview Mode|Project Interview Cards|--- USER RULES ---/);
  assert.ok(system.includes(material), 'Imported user material keeps its original wording');
  assert.ok(system.includes(rules), 'Existing custom rules keep their original wording');
  assert.ok(request.max_tokens > 0 && request.max_tokens <= 1800);
  assert.ok(app.searches.length > 0);
  for (const search of app.searches) {
    assert.equal(search.scopes?.length, 1);
    assert.match(search.scopes[0], indexVersion === 1 ? /^@project:projects-RepoPilot-/ : /^@project:fixture-repopilot$/);
    for (const row of search.rows) {
      assert.match(row.path, /^RepoPilot\//);
      assert.equal(row.projectId, search.scopes[0].slice('@project:'.length));
    }
  }
});
}

for (const message of ['Quota exceeded', '请求额度或频率已达上限']) {
  test(`main recognizes legacy and Chinese quota wording: ${message}`, t => {
    const app = createInterviewRuntime(t);
    app.value(`handleSttError({provider:'gemini', message:${JSON.stringify(message)}}, {});`);
    assert.equal(app.value('sttDisabled'), true);
    const status = app.events.find(event => event.channel === 'status');
    assert.match(status.message, /语音识别已停止/);
    assert.match(status.message, /密钥无效或请求额度已达上限/);
  });
}

for (const relative of ['src/stt.js', 'src/stt-streaming.js']) {
  test(`${relative}: Chinese ASR instructions preserve the audio payload and original speech language`, async () => {
    const file = path.resolve(__dirname, '..', relative);
    const nativeRequire = createRequire(file);
    const requests = [];
    class GoogleGenAI {
      constructor() {
        this.models = { generateContent: async request => {
          requests.push(request);
          return { text: 'Redis runs in memory.' };
        } };
      }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, exports: module.exports, Buffer, Date, console,
      require: id => id === '@google/genai' ? { GoogleGenAI } : nativeRequire(id)
    }, { filename: file });
    if (relative === 'src/stt.js') {
      const stt = module.exports.createSTT({ sttProvider: 'gemini', apiKeys: { gemini: 'fixture-only' } });
      const result = await stt.transcribe(Buffer.alloc(6400));
      assert.equal(result.text, 'Redis runs in memory.');
      assert.equal(result.provider, 'gemini');
    } else {
      assert.equal(await module.exports.transcribeBatchGemini('fixture-only', pcmToWav(Buffer.alloc(6400), 16000, 1)), 'Redis runs in memory.');
    }
    assert.equal(requests.length, 1);
    const content = requests[0].contents[0];
    assert.equal(content.role, 'user');
    assert.match(content.parts[0].text, /逐字转写音频/);
    assert.match(content.parts[0].text, /保留原始语言和技术词，不要翻译/);
    assert.equal(content.parts[1].inlineData.mimeType, 'audio/wav');
    assert.equal(Buffer.from(content.parts[1].inlineData.data, 'base64').subarray(0, 4).toString(), 'RIFF');
  });
}
