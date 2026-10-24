'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const envelope = require('../scripts/lib/private-live-crypto.cjs');
const {initialize, evaluateSession, resolveModelConfiguration, waitForInput} = require('../scripts/private-live-session.cjs');

const env = {GITHUB_RUN_ID:'12345', GITHUB_RUN_ATTEMPT:'1', GITHUB_REPOSITORY:'Astrea-296111/cue',
  GITHUB_SHA:'a'.repeat(40), GITHUB_REF:'refs/heads/main', GITHUB_EVENT_NAME:'workflow_dispatch',
  QWEN_API_KEY:'secret-qwen-test-only', DEEPSEEK_API_KEY:'secret-deepseek-test-only',
  QWEN_MODEL:'configured-qwen', DEEPSEEK_MODEL:'configured-deepseek',
  QWEN_BASE_URL:'https://qwen.example/v1', DEEPSEEK_BASE_URL:'https://deepseek.example/v1'};
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-private-session-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  return directory;
}

test('private envelopes bind run, trusted code, key and size, and reports decrypt only with the local response key', () => {
  const {session, privateKey} = envelope.createSession({runId:'123', repository:env.GITHUB_REPOSITORY, commitSha:env.GITHUB_SHA});
  const payload = {facts:{text:'PRIVATE_PERSONAL_FACT'}, profile:{resumeText:'PRIVATE_RESUME'}};
  const encrypted = envelope.encryptPayload({session, payload});
  assert.ok(!JSON.stringify(encrypted.envelope).includes('PRIVATE_PERSONAL_FACT'));
  assert.deepEqual(envelope.decryptPayload({session, privateKey, envelope:encrypted.envelope}).payload, payload);
  for (const altered of [{...session, runId:'124'}, {...session, commitSha:'b'.repeat(40)}]) {
    assert.throws(() => envelope.decryptPayload({session:altered, privateKey, envelope:encrypted.envelope}), /authentication/);
  }
  assert.throws(() => envelope.encryptPayload({session, payload:{data:'x'.repeat(envelope.MAX_INPUT_BYTES)}}), /size/);
  const corrupted = {...encrypted.envelope, tag:crypto.randomBytes(16).toString('base64')};
  assert.throws(() => envelope.decryptPayload({session, privateKey, envelope:corrupted}), /authentication/);
  const reports = {report:{answer:'PRIVATE_FULL_ANSWER'}, markdown:'PRIVATE_MARKDOWN'};
  const result = envelope.encryptReports({session, key:encrypted.key, reports});
  assert.ok(!JSON.stringify(result).includes('PRIVATE_FULL_ANSWER'));
  assert.deepEqual(envelope.decryptReports({session, key:encrypted.key, envelope:result}), reports);
  assert.throws(() => envelope.decryptReports({session, key:crypto.randomBytes(32), envelope:result}), /authentication/);
});

test('trusted private evaluation publishes only encrypted answers and aggregate status and removes local plaintext/key', async t => {
  const directory = fixture(t), outputDir = path.join(directory, 'artifacts'), summaryPath = path.join(directory, 'summary.md');
  const session = initialize(directory, env);
  const payload = {schemaVersion:1, facts:{private:'PRIVATE_FACT'}, profile:{resumeText:'PRIVATE_RESUME', jobDescription:'PRIVATE_JD'}};
  const encrypted = envelope.encryptPayload({session, payload});
  let calls = 0;
  const summary = await evaluateSession({directory, outputDir, env:{...env, GITHUB_STEP_SUMMARY:summaryPath},
    fetchImpl:async url => {
      assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/Astrea-296111\/cue\/cue-evaluation-inputs\/12345\.json\?cue_run=12345&poll=0$/);
      return new Response(JSON.stringify(encrypted.envelope), {status:200});
    }, evaluatePrivate:async options => {
      calls++; assert.deepEqual(options.payload, payload); assert.equal(options.env.GITHUB_STEP_SUMMARY, undefined);
      fs.mkdirSync(options.outputDir, {recursive:true});
      fs.writeFileSync(path.join(options.outputDir, 'report.md'), 'PRIVATE_MARKDOWN ' + env.QWEN_API_KEY);
      fs.writeFileSync(path.join(options.outputDir,'manual-review-queue.json'),JSON.stringify({private:'PRIVATE_REVIEW_PACKET',key:env.QWEN_API_KEY}));
      return {kind:'live-private', status:'passed', budget:{attemptedCalls:2}, summary:{caseCount:2, passedCases:2, failedCases:0},
        providers:[{answer:'PRIVATE_FULL_ANSWER', accidentalKey:env.DEEPSEEK_API_KEY}]};
    }});
  assert.equal(calls, 1); assert.equal(summary.status, 'passed'); assert.equal(summary.reportEncrypted, true);
  assert.equal(fs.existsSync(path.join(directory, 'private-key.pem')), false);
  assert.equal(fs.existsSync(path.join(directory, 'plain-reports')), false);
  assert.deepEqual(fs.readdirSync(outputDir).sort(), ['report.encrypted.json','summary.json']);
  const published = fs.readdirSync(outputDir).map(name => fs.readFileSync(path.join(outputDir, name), 'utf8')).join('') + fs.readFileSync(summaryPath, 'utf8');
  for (const secret of ['PRIVATE_FACT','PRIVATE_RESUME','PRIVATE_JD','PRIVATE_FULL_ANSWER','PRIVATE_MARKDOWN',env.QWEN_API_KEY,env.DEEPSEEK_API_KEY]) assert.ok(!published.includes(secret), secret);
  const reports = envelope.decryptReports({session, key:encrypted.key,
    envelope:JSON.parse(fs.readFileSync(path.join(outputDir, 'report.encrypted.json')))});
  assert.equal(reports.report.providers[0].answer, 'PRIVATE_FULL_ANSWER');
  assert.equal(reports.report.providers[0].accidentalKey, '[REDACTED]');
  assert.ok(!reports.markdown.includes(env.QWEN_API_KEY));
  assert.equal(reports.artifacts['manual-review-queue.json'].private,'PRIVATE_REVIEW_PACKET');
  assert.equal(reports.artifacts['manual-review-queue.json'].key,'[REDACTED]');

  const rejected = fixture(t), rejectedSession = initialize(rejected, env);
  assert.ok(rejectedSession.publicKey);
  const result = await evaluateSession({directory:rejected, outputDir:path.join(rejected, 'out'), env:{...env, GITHUB_REF:'refs/heads/untrusted'},
    fetchImpl:async () => { throw new Error('must not fetch'); }, evaluatePrivate:async () => { throw new Error('must not evaluate'); }});
  assert.equal(result.error.code, 'invalid-session-context'); assert.equal(result.reportEncrypted, false);
  assert.equal(fs.existsSync(path.join(rejected, 'private-key.pem')), false);
});

test('model discovery is explicit, one bounded metadata request per missing provider, and encrypted-input polling is bounded', async t => {
  const missing = {...env, QWEN_MODEL:'', DEEPSEEK_MODEL:''}; let gets = 0;
  const fakeFetch = async (url, options) => {
    gets++; assert.ok(options.signal); assert.equal(options.redirect, 'error');
    const id = url.startsWith('https://qwen.example/') ? 'qwen3.6-flash' : 'deepseek-flash';
    return new Response(JSON.stringify({data:[{id}, {id:'unknown-audio-model'}]}), {status:200});
  };
  const strict = await resolveModelConfiguration({env:missing, fetchImpl:fakeFetch});
  assert.equal(gets, 0); assert.equal(strict.discovery.errors.length, 2);
  const resolved = await resolveModelConfiguration({env:missing, discoverModels:true, fetchImpl:fakeFetch});
  assert.equal(gets, 2); assert.equal(resolved.discovery.metadataRequests, 2);
  assert.deepEqual(resolved.discovery.selections.map(item => item.model), ['qwen3.6-flash','deepseek-flash']);
  assert.ok(!JSON.stringify(resolved.discovery).includes(env.QWEN_API_KEY));
  const unavailable = await resolveModelConfiguration({env:missing, provider:'qwen', discoverModels:true,
    fetchImpl:async () => new Response(JSON.stringify({data:[{id:'unknown-audio-model'}]}), {status:200})});
  assert.equal(unavailable.discovery.errors[0].code, 'model-discovery');
  const huge = await resolveModelConfiguration({env:missing, provider:'qwen', discoverModels:true,
    fetchImpl:async () => new Response('x'.repeat(1024 * 1024 + 1), {status:200})});
  assert.equal(huge.discovery.errors[0].code, 'model-discovery');
  const session = initialize(fixture(t), env); let now = 0, polls = 0;
  await assert.rejects(waitForInput(session, {waitMs:15, intervalMs:5, now:() => now, pause:async ms => { now += ms; },
    fetchImpl:async () => { polls++; return new Response('', {status:404}); }}), {publicCode:'private-input-timeout'});
  assert.equal(polls, 3);
});
