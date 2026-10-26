#!/usr/bin/env node
'use strict';

// Only trusted main executes this file. The input branch carries authenticated
// encrypted data; it is never checked out, required, or interpreted as code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {performance} = require('node:perf_hooks');
const {setTimeout: delay} = require('node:timers/promises');
const cipher = require('./lib/private-live-crypto.cjs');
const {sanitizeReport, sanitizeText} = require('./lib/live-evaluation-report.cjs');
const {hydrateJudgeSnapshot,DIRECTORY:JUDGE_JOURNAL_DIRECTORY}=require('./lib/judge-journal.cjs');

const CANDIDATES = Object.freeze({qwen:['qwen3.6-flash','qwen3.5-flash','qwen-flash','qwen-turbo'], deepseek:['deepseek-flash','deepseek-chat']});
const PUBLIC_ERRORS = Object.freeze({
  'invalid-private-envelope':'Private input did not pass authentication or size validation.',
  'invalid-session-context':'The session does not match this trusted workflow run.',
  'configuration':'A selected provider is missing valid configuration.',
  'model-discovery':'Explicit model discovery could not find an approved text-model candidate.',
  'private-input-timeout':'No authenticated private input arrived within the bounded wait.',
  'private-evaluation-failed':'Private evaluation failed; inspect the encrypted report if available.'
});
function failure(code) { const error = new Error(PUBLIC_ERRORS[code] || PUBLIC_ERRORS['private-evaluation-failed']); error.publicCode = code; return error; }
function writeFile(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temporary = file + '.tmp-' + crypto.randomBytes(8).toString('hex');
  try { fs.writeFileSync(temporary, value, {mode:0o600}); fs.renameSync(temporary, file); }
  finally { fs.rmSync(temporary, {force:true}); }
}
function writeJson(file, value) { writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
function readJson(file, maximum = cipher.MAX_ENVELOPE_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw failure('invalid-private-envelope');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw failure('invalid-private-envelope'); }
}
async function readResponse(response, maximum) {
  const declared = response.headers?.get('content-length');
  if (declared && Number(declared) > maximum) throw failure('invalid-private-envelope');
  let size = 0; const parts = [];
  for await (const part of response.body || []) {
    const bytes = Buffer.from(part); size += bytes.length;
    if (size > maximum) throw failure('invalid-private-envelope');
    parts.push(bytes);
  }
  return Buffer.concat(parts).toString('utf8');
}
function providerIds(provider) {
  if (!['all','qwen','deepseek'].includes(provider)) throw failure('configuration');
  return provider === 'all' ? ['qwen','deepseek'] : [provider];
}

async function resolveModelConfiguration({env, provider = 'all', discoverModels = false, fetchImpl = fetch}) {
  const {providerConfig} = require('./e2e-live-llm.cjs');
  const selected = {...env}, selections = [], errors = [];
  let metadataRequests = 0;
  for (const id of providerIds(provider)) {
    const prefix = id.toUpperCase();
    let method = 'configured', requests = 0;
    if (!String(selected[prefix + '_MODEL'] || '').trim() && discoverModels) {
      method = 'catalog-fast-candidate';
      // A metadata-only placeholder validates key and endpoint before the GET;
      // it is never used in an inference request or recorded as a selected ID.
      const validated = providerConfig(id, {...selected, [prefix + '_MODEL']:'metadata-only-validation'}, false);
      if (validated.error) { errors.push({provider:id, code:'configuration', reason:validated.error.message}); continue; }
      metadataRequests++; requests++;
      let httpStatus = null;
      try {
        const response = await fetchImpl(validated.baseURL.replace(/\/$/, '') + '/models', {
          headers:{Authorization:'Bearer ' + validated.apiKey, Accept:'application/json'},
          redirect:'error', signal:AbortSignal.timeout(10_000)
        });
        httpStatus = response.status;
        if (!response.ok) throw failure('model-discovery');
        const catalog = JSON.parse(await readResponse(response, 1024 * 1024));
        if (!Array.isArray(catalog.data) || catalog.data.length > 10_000) throw failure('model-discovery');
        const available = new Set(catalog.data.map(item => item?.id).filter(value => typeof value === 'string' && value.length <= 256));
        const model = CANDIDATES[id].find(candidate => available.has(candidate));
        if (!model) throw failure('model-discovery');
        selected[prefix + '_MODEL'] = model;
      } catch { errors.push({provider:id, code:'model-discovery', metadataRequests:requests, httpStatus}); continue; }
    }
    const configured = providerConfig(id, selected, false);
    if (configured.error) { errors.push({provider:id, code:'configuration', reason:configured.error.message}); continue; }
    selections.push({provider:id, model:configured.model, method, metadataRequests:requests});
  }
  return {env:selected, discovery:{explicitlyRequested:discoverModels, metadataRequests, selections, errors}};
}

function initialize(directory, env = process.env) {
  const {session, privateKey} = cipher.createSession({runId:env.GITHUB_RUN_ID, runAttempt:env.GITHUB_RUN_ATTEMPT || '1',
    repository:env.GITHUB_REPOSITORY, commitSha:env.GITHUB_SHA});
  fs.mkdirSync(directory, {recursive:true, mode:0o700}); fs.chmodSync(directory, 0o700);
  writeFile(path.join(directory, 'private-key.pem'), privateKey);
  writeJson(path.join(directory, 'session.json'), session);
  return session;
}
function checkRun(session, env) {
  if (session.runId !== env.GITHUB_RUN_ID || session.runAttempt !== (env.GITHUB_RUN_ATTEMPT || '1') ||
    session.repository !== env.GITHUB_REPOSITORY || session.commitSha !== env.GITHUB_SHA || env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw failure('invalid-session-context');
}
async function waitForInput(session, {fetchImpl = fetch, waitMs = 180_000, intervalMs = 5000, now = Date.now, pause = delay} = {}) {
  if (!Number.isFinite(waitMs) || waitMs < 1 || waitMs > 180_000 || !Number.isFinite(intervalMs) || intervalMs < 1) throw failure('configuration');
  const url = `https://raw.githubusercontent.com/${session.repository}/cue-evaluation-inputs/${session.runId}.json`;
  const end = now() + waitMs, maximumAttempts = Math.ceil(waitMs / intervalMs);
  for (let attempt = 0; attempt < maximumAttempts && now() < end; attempt++) {
    try {
      const response = await fetchImpl(url + '?cue_run=' + session.runId + '&poll=' + attempt, {headers:{Accept:'application/json', 'Cache-Control':'no-cache'}, redirect:'error',
        signal:AbortSignal.timeout(Math.max(1, Math.min(10_000, end - now())))});
      if (response.ok) {
        try {
          const envelope = JSON.parse(await readResponse(response, cipher.MAX_ENVELOPE_BYTES));
          // Re-running the same run ID creates a new ephemeral key. Ignore a
          // prior attempt's cached ciphertext while waiting for its replacement.
          if (envelope?.runId === session.runId && (envelope.runAttempt !== session.runAttempt || envelope.fingerprint !== session.fingerprint)) {
            if (now() < end) await pause(Math.min(intervalMs, end - now()));
            continue;
          }
          return envelope;
        }
        catch { throw failure('invalid-private-envelope'); }
      }
      if (![404,429,500,502,503,504].includes(response.status)) throw failure('invalid-private-envelope');
    } catch (error) { if (error.publicCode) throw error; }
    if (now() < end) await pause(Math.min(intervalMs, end - now()));
  }
  throw failure('private-input-timeout');
}
function publicSummary(report, session, discovery, error, reportEncrypted = false) {
  const summary = report?.summary || {};
  const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {schemaVersion:1, kind:'live-private-encrypted', runId:session?.runId || null, commitSha:session?.commitSha || null,
    status:error ? 'failed' : report?.status || 'failed', reportEncrypted, modelSelection:discovery || null,
    attemptedCalls:count(report?.budget?.attemptedCalls), caseCount:count(summary.caseCount),
    allInferenceCalls:count(summary.calls?.total), judgeCalls:count(summary.calls?.judges), dynamicActorCalls:count(summary.calls?.dynamicActors),
    passedCases:count(summary.passedCases), failedCases:count(summary.failedCases),
    latency:{firstContentP50:count(summary.firstContentMs?.p50), firstContentP95:count(summary.firstContentMs?.p95),
      doneP50:count(summary.doneMs?.p50), doneP95:count(summary.doneMs?.p95)},
    ...(error ? {error:{code:error.publicCode || 'private-evaluation-failed',
      message:PUBLIC_ERRORS[error.publicCode] || PUBLIC_ERRORS['private-evaluation-failed']}} : {})};
}
function publishSummary(outputDir, summary, env) {
  summary = sanitizeReport(summary, {secrets:[env.QWEN_API_KEY, env.DEEPSEEK_API_KEY, env.QWEN_ASR_API_KEY]});
  writeJson(path.join(outputDir, 'summary.json'), summary);
  if (env.GITHUB_STEP_SUMMARY) {
    const lines = ['# CUE private real-model evaluation', '',
      `Status: **${summary.status}**. Full inputs and answers remain encrypted.`, '',
      `Inference attempts: ${summary.attemptedCalls ?? 'unknown'}. Model metadata requests: ${summary.modelSelection?.metadataRequests ?? 0}.`, '',
      ...(summary.error ? [`Failure: ${summary.error.code}. ${summary.error.message}`, ''] : []),
      'This run does not verify a physical Windows device. An encrypted artifact is not a claim that either real model passed quality checks.', ''];
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }
}

async function evaluateSession({directory, outputDir, env = process.env, mode = 'smoke', provider = 'all', discoverModels = false,
  fetchImpl = fetch, evaluatePrivate, waitOptions = {}}) {
  const evaluationDeadline=Date.now()+100*60*1000;
  const plainDir = path.join(directory, 'plain-reports'), privateKeyPath = path.join(directory, 'private-key.pem');
  let session, key, report, discovery, error, snapshotTimer, lastSnapshot, inferenceStarted = false;
  let lastSnapshotSignature=null;
  const reportPersistence={snapshotIntervalMs:30000,attempts:0,completed:0,failures:0,unchangedSkipped:0,totalMs:0,maxMs:0,lastEnvelopeBytes:0};
  const sanitize = {secrets:[env.QWEN_API_KEY, env.DEEPSEEK_API_KEY, env.QWEN_ASR_API_KEY], workspaceRoot:path.resolve(__dirname, '..'), tempRoots:[directory]};
  const saveEncrypted = (value, markdown, {partial=false}={}) => {
    const started=performance.now();reportPersistence.attempts++;
    try {
    const hydrated=hydrateJudgeSnapshot(plainDir,value);
    value=hydrated.report;
    if(hydrated.checkpoint) {
      value={...value,judging:{...value.judging,...require('./judge-private-projects.cjs').summarizeJudging(value),
        status:value.judging?.status||'running'}};
      value={...value,summary:require('./lib/live-evaluation-report.cjs').summarize(value)};
    }
    const artifacts={};
    if(fs.existsSync(plainDir))for(const name of fs.readdirSync(plainDir)) {
      if(!/^(?:judge-checkpoint|manual-review-queue|dynamic-[a-f0-9]{24})\.json$/.test(name))continue;
      if(partial&&name==='manual-review-queue.json')continue;
      if(name==='judge-checkpoint.json'&&hydrated.checkpoint){artifacts[name]=sanitizeReport(hydrated.checkpoint,sanitize);continue;}
      try {artifacts[name]=sanitizeReport(readJson(path.join(plainDir,name),cipher.MAX_REPORT_BYTES),sanitize);}catch{/* A concurrent checkpoint is collected by the next snapshot. */}
    }
    const reports={report:sanitizeReport({...value, modelSelection:discovery,
        reportPersistence:{...reportPersistence,measurement:'Completed prior snapshots; the public final summary includes the final encryption cost.'}}, sanitize),
        markdown:sanitizeText(markdown, sanitize),artifacts};
    writeJson(path.join(outputDir, 'report.encrypted.json'), cipher.encryptReports({session, key,reports}));
    if(env.CUE_PUBLISH_READABLE_REPORTS==='true') {
      const readable=path.join(outputDir,'readable');
      writeJson(path.join(readable,'report.json'),reports.report);
      if(!partial)writeFile(path.join(readable,'report.md'),reports.markdown);
      for(const [name,data]of Object.entries(artifacts))writeJson(path.join(readable,name),data);
    }
    reportPersistence.completed++;
    reportPersistence.lastEnvelopeBytes=fs.statSync(path.join(outputDir,'report.encrypted.json')).size;
    return value;
    } catch(error) {
      reportPersistence.failures++;throw error;
    } finally {
      const elapsed=performance.now()-started;
      reportPersistence.totalMs=+(reportPersistence.totalMs+elapsed).toFixed(2);
      reportPersistence.maxMs=+Math.max(reportPersistence.maxMs,elapsed).toFixed(2);
    }
  };
  const snapshot = ({force=false}={}) => {
    if (!key || !session) return;
    try {
      const stat=fs.statSync(path.join(plainDir,'report.json'));
      const journalDir=path.join(plainDir,JUDGE_JOURNAL_DIRECTORY);
      const journalStamp=fs.existsSync(journalDir)?fs.statSync(journalDir).mtimeMs:0;
      const signature=stat.mtimeMs+':'+stat.size+':'+journalStamp;
      if(!force&&signature===lastSnapshotSignature){reportPersistence.unchangedSkipped++;return;}
      const partial = readJson(path.join(plainDir, 'report.json'), cipher.MAX_REPORT_BYTES);
      const saved=saveEncrypted(partial, '运行中的完整回答与全部尝试保存在加密 report.json；结束后生成完整 Markdown。',{partial:true});
      lastSnapshotSignature=signature;
      lastSnapshot = saved;
    } catch { /* A not-yet-written or concurrently replaced snapshot is retried. */ }
  };
  const interrupted = () => {
    snapshot({force:true}); clearInterval(snapshotTimer);
    const summary = publicSummary(report || lastSnapshot, session, discovery, failure('private-evaluation-failed'), fs.existsSync(path.join(outputDir, 'report.encrypted.json')));
    summary.reportPersistence={...reportPersistence};
    try { publishSummary(outputDir, summary, env); } catch { /* No private diagnostics on cancellation. */ }
    key?.fill(0); fs.rmSync(plainDir, {recursive:true, force:true}); fs.rmSync(privateKeyPath, {force:true});
    process.exit(143);
  };
  try {
    if (!['smoke','regression','deep','stress'].includes(mode)) throw failure('configuration'); providerIds(provider);
    session = cipher.validateSession(readJson(path.join(directory, 'session.json'), 16 * 1024)); checkRun(session, env);
    const resolved = await resolveModelConfiguration({env, provider, discoverModels, fetchImpl}); discovery = resolved.discovery;
    if (discovery.errors.length) throw failure(discovery.errors[0].code);
    const envelope = await waitForInput(session, {fetchImpl, ...waitOptions});
    const decoded = cipher.decryptPayload({session, privateKey:fs.readFileSync(privateKeyPath, 'utf8'), envelope});
    key = decoded.key;
    // Keep encrypted partial answers available if the step later times out.
    snapshotTimer = setInterval(snapshot, reportPersistence.snapshotIntervalMs); snapshotTimer.unref();
    process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted);
    const run = evaluatePrivate || require('./evaluate-private-projects.cjs').evaluatePrivate;
    // The actual evaluator returns all reports to an ephemeral plaintext folder.
    // Its environment cannot append private contents to the Actions Summary.
    const evaluationEnv = {...resolved.env}; delete evaluationEnv.GITHUB_STEP_SUMMARY;
    // Stop scoring with enough time to finalize authenticated artifacts before
    // the workflow's 110-minute evaluation-step ceiling.
    evaluationEnv.CUE_EVALUATION_DEADLINE_MS=String(evaluationDeadline);
    inferenceStarted = true;
    report = await run({payload:decoded.payload, outputDir:plainDir, env:evaluationEnv, mode, provider});
    report.modelSelection = discovery;
    const markdownPath = path.join(plainDir, 'report.md');
    const markdown = fs.existsSync(markdownPath) && fs.statSync(markdownPath).size <= cipher.MAX_REPORT_BYTES
      ? fs.readFileSync(markdownPath, 'utf8') : '';
    report=saveEncrypted(report, markdown);
  } catch (caught) {
    error = caught;
    if (key && session) {
      snapshot({force:true}); report ||= lastSnapshot;
      if (!fs.existsSync(path.join(outputDir, 'report.encrypted.json'))) {
        report = {schemaVersion:1, kind:'live-private', status:'failed', modelSelection:discovery,
          error:{code:caught.publicCode || 'private-evaluation-failed', message:PUBLIC_ERRORS[caught.publicCode] || PUBLIC_ERRORS['private-evaluation-failed']}};
        try { saveEncrypted(report, ''); }
        catch { /* Only a safe public failure remains if encryption itself fails. */ }
      }
    }
  } finally {
    clearInterval(snapshotTimer); process.removeListener('SIGTERM', interrupted); process.removeListener('SIGINT', interrupted);
    key?.fill(0);
    fs.rmSync(plainDir, {recursive:true, force:true}); fs.rmSync(privateKeyPath, {force:true});
  }
  const summary = publicSummary(report, session, discovery, error, fs.existsSync(path.join(outputDir, 'report.encrypted.json')));
  summary.reportPersistence={...reportPersistence};
  if (!inferenceStarted && summary.attemptedCalls == null) summary.attemptedCalls = 0;
  publishSummary(outputDir, summary, env);
  return summary;
}

function argumentsFor(args) {
  const command = args[0], options = {};
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--directory','--output-dir','--mode','--provider','--discover-models','--session','--payload','--key-file','--envelope','--output'].includes(key) || !value) throw failure('configuration');
    options[key.slice(2)] = value;
  }
  return {command, options};
}
async function main(args = process.argv.slice(2), env = process.env) {
  const {command, options} = argumentsFor(args);
  if (command === 'init') { initialize(options.directory, env); process.stdout.write('Private evaluation public session is ready.\n'); return 0; }
  if (command === 'evaluate') {
    if (!['true','false',undefined].includes(options['discover-models'])) throw failure('configuration');
    const summary = await evaluateSession({directory:options.directory, outputDir:options['output-dir'], env,
      mode:options.mode || 'smoke', provider:options.provider || 'all', discoverModels:options['discover-models'] === 'true'});
    process.stdout.write(`Private live evaluation: ${summary.status}; inference attempts ${summary.attemptedCalls ?? 'unknown'}.\n`);
    return summary.status === 'passed' ? 0 : 1;
  }
  if (command === 'encrypt') {
    const session = readJson(options.session, 16 * 1024), payload = readJson(options.payload, cipher.MAX_INPUT_BYTES);
    const {envelope, key} = cipher.encryptPayload({session, payload});
    writeJson(options['key-file'], {schemaVersion:1, fingerprint:session.fingerprint, key:key.toString('base64')});
    writeJson(options.output, envelope); key.fill(0);
    process.stdout.write('Authenticated private input encrypted. Keep the local key file private.\n'); return 0;
  }
  if (command === 'decrypt') {
    const session = readJson(options.session, 16 * 1024), local = readJson(options['key-file'], 16 * 1024);
    if (local.schemaVersion !== 1 || local.fingerprint !== session.fingerprint) throw failure('invalid-private-envelope');
    const key = cipher.bytes64(local.key, 32);
    try {
      const reports = cipher.decryptReports({session, key, envelope:readJson(options.envelope)});
      writeJson(path.join(options['output-dir'], 'report.json'), reports.report);
      writeFile(path.join(options['output-dir'], 'report.md'), String(reports.markdown || ''));
      for(const [name,value] of Object.entries(reports.artifacts||{})) {
        if(!/^(?:judge-checkpoint|manual-review-queue|dynamic-[a-f0-9]{24})\.json$/.test(name))throw failure('invalid-private-envelope');
        writeJson(path.join(options['output-dir'],name),value);
      }
    } finally { key.fill(0); }
    process.stdout.write('Private reports decrypted locally.\n'); return 0;
  }
  throw failure('configuration');
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('Private live session failed. No private contents or credentials are printed.\n'); process.exitCode = 1;
});
module.exports = {CANDIDATES, initialize, resolveModelConfiguration, waitForInput, evaluateSession, publicSummary, main};
