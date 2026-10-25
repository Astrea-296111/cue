'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { BEHAVIORS, validateDynamic, dynamicMaterialPayload, runDynamicSession } = require('../scripts/lib/dynamic-interview.cjs');
const { observedProductionAttempts } = require('../scripts/evaluate-dynamic-projects.cjs');
const {fixture}=require('./helpers/material-fixture');
const {validatePersonalWorkspace}=require('../src/personal-workspace');
const env = { QWEN_API_KEY: 'actor-key-a', DEEPSEEK_API_KEY: 'actor-key-b', QWEN_MODEL: 'actor-a', DEEPSEEK_MODEL: 'actor-b',
  QWEN_BASE_URL: 'https://a.example/v1', DEEPSEEK_BASE_URL: 'https://b.example/v1' };

test('family holdout rejects mechanism overlap and requires an explicit manifest', () => {
  assert.throws(() => validateDynamic({ split: 'heldout' }), /manifest/u);
  assert.throws(() => validateDynamic({ familyManifest: { development: { first: ['shared'] }, heldout: { second: ['shared'] } } }), /overlap/u);
  assert.equal(validateDynamic({ split: 'heldout', familyManifest: { development: { first: ['fault-a'] }, heldout: { second: ['fault-b'] } } }).split, 'heldout');
});

test('resumed production accounting retains the failed original request as well as its successful retry', () => {
  const sessions = [{ provider: 'model-a', turns: [{ cueAttempts: [{ status: 'interrupted' }, { status: 'completed', result: {
    attempts: [{ attempted: true, status: 'failed', usage: { actualTotalTokens: null } },
      { attempted: true, status: 'passed', usage: { actualTotalTokens: 42 } }] } }] }] }];
  const attempts = observedProductionAttempts(sessions);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].status, 'failed'); assert.equal(attempts[1].usage.actualTotalTokens, 42);
});

test('dynamic production materials exclude reference answers and embedded oracle and preserve valid relations', () => {
  const filtered = dynamicMaterialPayload({judgeReference:{facts:'HIDDEN_CANONICAL_REFERENCE'},revision:'OLD_WORKSPACE_REVISION',sourceManifest:[{path:'HIDDEN_MANIFEST'}],mergeLog:['HIDDEN_MERGE_LOG'], facts: { sourceDocuments: { 'private.json': 'HIDDEN_ORACLE' }, cards: [
    { cardId: 'authority', related: ['oracle'], text: 'CODE_EVIDENCE' },
    { cardId: 'oracle', seedOrigin: { collection: 'question_answers', id: 'q1' }, text: 'HIDDEN_ANSWER' }] } });
  assert.equal(filtered.facts.cards.length, 1); assert.deepEqual(filtered.facts.cards[0].related, []);
  assert.ok(!JSON.stringify(filtered.facts).includes('HIDDEN'));
  for(const key of ['judgeReference','revision','sourceManifest','mergeLog'])assert.equal(filtered[key],undefined);
  const base={schemaVersion:2,facts:fixture(2),profile:{resumeText:'Synthetic speech',jobDescription:'Synthetic JD'}};
  const first=dynamicMaterialPayload({...base,judgeReference:{sha256:'first'},revision:'stale'});
  const second=dynamicMaterialPayload({...base,judgeReference:{sha256:'changed'},revision:'stale'});
  assert.deepEqual(first,second); // Changed judge authority cannot alter actor/generation identity.
  assert.equal(validatePersonalWorkspace({schemaVersion:1,facts:first.facts,profile:first.profile,revision:first.revision}).revision,first.revision);
});

test('all six candidate behaviors use actual-speech followups, isolated actor requests and production answer callback', async t => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-dynamic-contract-')); t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const session = { id: 'anonymous', events: [{ event_id: 'q0', text: '说明这套服务的受理边界。', invoke_cue: true,
    evaluation: { must_convey: ['HIDDEN_ASSERTION'], must_not_assert: ['HIDDEN_GOLD'], supporting_card_ids: ['support'] } }], tags: [] };
  const requests = [], production = [], delivered = [];
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body), data = JSON.parse(request.messages[1].content); requests.push({ request, data });
    let value;
    if (data.task === 'candidate-actual-speech') value = { speech: data.behavior === 'read_aloud' ? data.suggestion : '实际发言-' + data.behavior };
    else value = { question: '你刚才说的“' + data.latestCandidateSpeech + '”具体如何验证？', anchoringQuote: data.latestCandidateSpeech };
    return new Response(JSON.stringify({ model: request.model, usage: { total_tokens: 10 }, choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const askCue = async value => { production.push(value); return { id: 'answer-' + value.index, sessionId: session.id, status: 'passed', transportStatus: 'passed',
    question: value.event.text, answer: '建议正文-' + value.index, attempted: true, usage: null }; };
  const options = { session, provider: 'qwen', runtime: {}, askCue, deliverEvent: async (_runtime, event) => delivered.push(event), env, outputDir, fetchImpl, pauseImpl: async () => {} };
  const state = await runDynamicSession(options);
  assert.equal(state.status, 'completed'); assert.equal(production.length, 7); assert.equal(requests.length, 12);
  assert.deepEqual(state.turns.slice(0, 6).map(turn => turn.candidate.behavior), BEHAVIORS);
  const followups = requests.filter(r => r.data.task === 'ask-from-actual-speech');
  for (const row of followups) {
    assert.equal(row.data.actualDialogue.at(-1).speaker, 'candidate');
    assert.equal(row.data.latestCandidateSpeech, row.data.actualDialogue.at(-1).text);
    assert.equal(row.data.suggestion, undefined); assert.equal(row.data.behavior, undefined);
    assert.ok(!JSON.stringify(row.data).includes('HIDDEN'));
  }
  assert.ok(production[2].event.text.includes('实际发言-summarize'));
  assert.ok(!production[2].event.text.includes('建议正文-1'));
  assert.equal(delivered.filter(e => e.speaker === 'candidate').length, 6);
  const before = requests.length;
  await runDynamicSession(options);
  assert.equal(requests.length, before); assert.equal(production.length, 7);
  await assert.rejects(runDynamicSession({ ...options, generationIdentity: { applicationCommit: 'changed' } }), /identity mismatch/u);
});
