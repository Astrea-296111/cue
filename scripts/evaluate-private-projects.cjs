#!/usr/bin/env node
'use strict';

// Private uploads are data only. Prompts, retrieval and provider calls stay in
// the package/main production chain shared with the public live runner.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateIndex } = require('../src/project-fact-packs');
const {validateEvaluationWorkspace,validateJudgeReference} = require('./lib/evaluation-workspace.cjs');
const { validateBundle, MAX_BUNDLE_BYTES } = require('../src/bundled-materials');
const { evaluateCase } = require('../src/live-evaluation-quality');
const { writeReports, sanitizeText } = require('./lib/live-evaluation-report.cjs');
const { parseArgs, providerConfig, createBudget, createProviderRuntime, runCase, codePositions, buildIdentity } = require('./e2e-live-llm.cjs');
const ROOT = path.resolve(__dirname, '..');
const MAX_PAYLOAD_BYTES = require('./lib/private-live-crypto.cjs').MAX_INPUT_BYTES;
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const boundedString = (value, bytes) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= bytes;

function validatePrivatePayload(payload) {
  if(payload?.schemaVersion===3)return require('./lib/judge-recovery.cjs').validateRecoveryPayload(payload);
  if (payload?.schemaVersion === 2) {
    if (Object.keys(payload).some(key=>!['schemaVersion','facts','profile','scenarios','evaluation','revision','sourceManifest','mergeLog','judgeReference','imports'].includes(key)) || Buffer.byteLength(JSON.stringify(payload),'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Invalid multi-turn private payload.');
    const {validateScenarios,validateEvaluation}=require('./evaluate-multiturn-projects.cjs');
    const workspace={schemaVersion:payload.facts?.schemaVersion,facts:payload.facts,profile:payload.profile};
    for(const name of ['revision','sourceManifest','mergeLog'])if(payload[name]!==undefined)workspace[name]=payload[name];
    const validated=validateEvaluationWorkspace(workspace);
    const judgeReference=payload.judgeReference===undefined?undefined:validateJudgeReference(payload.judgeReference);
    require('./lib/evaluation-imports.cjs').validateImports(payload.imports);
    validateScenarios(payload.scenarios);validateEvaluation(payload.evaluation||{});
    return {...payload,facts:validated.facts,profile:validated.profile,revision:validated.revision,...(judgeReference?{judgeReference}:{})};
  }
  if (!payload || payload.schemaVersion !== 1 || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['schemaVersion', 'facts', 'profile', 'caseIds'].includes(key)) ||
      Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Invalid private evaluation payload.');
  const facts = validateIndex(payload.facts);
  if (!facts.projects.length || facts.projects.some(project => !['cae', 'arclight'].includes(project.id))) throw new Error('Private evaluation only accepts CAE/Arclight facts.');
  const profile = payload.profile;
  if (!profile || Array.isArray(profile) || Object.keys(profile).some(key => !['resumeText', 'jobDescription'].includes(key)) ||
      !boundedString(profile.resumeText, 256 * 1024) || !boundedString(profile.jobDescription, 64 * 1024)) throw new Error('Private profile must contain bounded resumeText and jobDescription only.');
  if (payload.caseIds != null && (!Array.isArray(payload.caseIds) || payload.caseIds.length < 1 || payload.caseIds.length > 12 ||
      new Set(payload.caseIds).size !== payload.caseIds.length || payload.caseIds.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,100}$/.test(id)))) throw new Error('Invalid private case selection.');
  return { schemaVersion: 1, facts, profile: { ...profile }, ...(payload.caseIds ? { caseIds: [...payload.caseIds] } : {}) };
}

function loadCases(mode, selectedIds) {
  const suite = JSON.parse(fs.readFileSync(path.join(ROOT, 'evaluation/deep-projects/cases.json'), 'utf8'));
  if (suite.schemaVersion !== 1 || !Array.isArray(suite.cases) || suite.cases.length !== 12 || !Array.isArray(suite.smokeCaseIds) || suite.smokeCaseIds.length !== 6) throw new Error('Trusted deep-project suite is invalid.');
  const ids = selectedIds || (mode === 'smoke' ? suite.smokeCaseIds : suite.cases.map(item => item.id));
  const selected = new Set(ids);
  const cases = suite.cases.filter(item => selected.has(item.id));
  if (cases.length !== selected.size) throw new Error('Private evaluation selected an unknown trusted case.');
  return cases;
}

function loadTrustedSources(trustedRoot = ROOT) {
  const bundlePath = path.join(trustedRoot, 'materials/bundle.json'), stat = fs.lstatSync(bundlePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BUNDLE_BYTES) throw new Error('Trusted source bundle is invalid.');
  const bundle = validateBundle(JSON.parse(fs.readFileSync(bundlePath, 'utf8')));
  if (!['cae', 'arclight'].every(id => bundle.sources.projects.some(project => project.id === id && bundle.sources.chunks.some(chunk => chunk.projectId === id)))) throw new Error('Compile both real project source snapshots before private evaluation.');
  return bundle;
}

async function importPrivateMaterials(runtime, payload, sources) {
  const state = await runtime.importMaterialSnapshot({ facts: payload.facts, sources });
  if (state.counts.facts !== payload.facts.cards.length || state.projects.some(project => !['cae', 'arclight'].includes(project.id))) throw new Error('Private material publication did not preserve the requested facts and project scope.');
  await runtime.invoke('settings:set', { ...payload.profile, currentProjectId: '', projectFactsEnabled: true,
    manualProjectKnowledgeEnabled: false, projectKnowledge: '' });
  await runtime.exports('src/project-knowledge.js').warmProjectIndex();
  const settings = runtime.exports('src/store.js').getSettings();
  if (settings.resumeText !== payload.profile.resumeText || settings.jobDescription !== payload.profile.jobDescription) throw new Error('Private profile did not enter production settings.');
  return { generation: state.generation, counts: state.counts, resumeImported: true, jobDescriptionImported: true,
    projects: state.projects.map(project => ({ id: project.id, sourceChunks: project.sourceChunks, factCount: project.factCount })) };
}

async function evaluatePrivate({ payload, outputDir, env = process.env, mode = 'smoke', providers = 'all', provider, mock = false }) {
  if(payload?.schemaVersion===3)return require('./lib/judge-recovery.cjs').evaluateRecovery({payload:validatePrivatePayload(payload),outputDir,env,mock});
  if (payload?.schemaVersion === 2) {
    const input=validatePrivatePayload(payload);
    if(input.evaluation?.audioFixture) return require('./evaluate-audio-projects.cjs').evaluateAudioProjects({payload:input,outputDir,env,provider:provider||providers,mock});
    if(input.evaluation?.dynamic) return require('./evaluate-dynamic-projects.cjs').evaluateDynamic({payload:input,outputDir,env,provider:provider||providers,mock});
    return require('./evaluate-multiturn-projects.cjs').evaluateMultiturn({payload:input,outputDir,env,provider:provider||providers,mock});
  }
  const selectedProvider = provider || providers;
  if (!['smoke', 'deep'].includes(mode) || !['all', 'qwen', 'deepseek'].includes(selectedProvider) || !outputDir) throw new Error('Private evaluation requires mode, provider and an explicit private output directory.');
  const providerIds = selectedProvider === 'all' ? ['qwen', 'deepseek'] : [selectedProvider];
  const options = { ...parseArgs([]), mode, mock: Boolean(mock), outputDir: path.resolve(outputDir), provider: selectedProvider,
    maxCalls: 24, maxCallsPerProvider: 12, maxOutputTokens: 1800, firstContentTimeoutMs: 10000, totalTimeoutMs: 30000 };
  const budget = createBudget(options, providerIds), secrets = [env.QWEN_API_KEY, env.DEEPSEEK_API_KEY].filter(Boolean), temporaryPaths = [];
  const report = { schemaVersion: 1, kind: mock ? 'mock' : 'live', status: 'running', mode,
    startedAt: new Date().toISOString(), finishedAt: null, build: buildIdentity(env), providers: [], failures: [],
    budget: budget.snapshot(), codePositions: codePositions(),
    privacy: { containsPrivateAnswers: true, publicAnswerArtifactsAllowed: false, encryptBeforeUpload: true },
    approval: { id: 'user-upload-private-evaluation', ciApproved: false, allowAnswerArtifacts: false } };
  let finalDocument;
  fs.mkdirSync(options.outputDir, { recursive: true, mode: 0o700 });
  const save = () => {
    report.budget = budget.snapshot();
    // Never pass GITHUB_STEP_SUMMARY: complete answers stay in the private
    // directory and the Actions bridge uploads only encrypted reports.
    return writeReports(report, { outputDir: options.outputDir, sanitize: { secrets, workspaceRoot: ROOT, tempRoots: temporaryPaths } });
  };
  save();
  try {
    const input = validatePrivatePayload(payload), cases = loadCases(mode, input.caseIds);
    if (cases.length > 12 || cases.length * providerIds.length > 24) throw new Error('Private suite exceeds the request budget.');
    report.inputs = { factsSha256: sha(input.facts), profileSha256: sha(input.profile), casesSha256: sha(cases), factCount: input.facts.cards.length, caseIds: cases.map(item => item.id) };
    let bundle;
    for (const id of providerIds) {
      const config = providerConfig(id, env, mock);
      const result = { id, model: config.model || null, endpointHostname: config.hostname || null, status: 'pending', attemptedCalls: 0,
        cases: cases.map(item => ({ id: item.id, sessionId: item.sessionId, mode: item.mode, question: item.question, status: 'pending', attempted: false,
          transportStatus: 'not-attempted', answer: '', projectIds: [], sentFactIds: [], sentSourceIds: [] })) };
      report.providers.push(result);
      if (config.error) {
        result.status = 'failed'; result.error = config.error;
        report.failures.push({ provider: id, caseId: null, ...config.error }); save(); continue;
      }
      const cleanups = [];
      try {
        bundle ||= loadTrustedSources();
        report.inputs.sourceRevision = bundle.revision;
        const runtime = createProviderRuntime({ id, config, options, budget, provider: result, cleanups });
        temporaryPaths.push(runtime.temp);
        result.materialImport = await importPrivateMaterials(runtime, input, bundle.sources);
        let session = null;
        for (let index = 0; index < cases.length; index++) {
          const item = cases[index];
          if (item.resetSession || session !== item.sessionId) runtime.clear();
          session = item.sessionId;
          const answer = await runCase(runtime, item, result, options, budget, evaluateCase);
          if (mock && answer.attempted) result.attemptedCalls++;
          result.cases[index] = answer;
          if (answer.error) report.failures.push({ provider: id, caseId: answer.id, ...answer.error });
          save();
          if (answer.error && (/^provider-http-/.test(answer.error.code) || ['provider-error', 'first-content-timeout', 'total-timeout', 'output-token-budget', 'request-budget'].includes(answer.error.code))) break;
        }
        result.status = result.cases.every(item => item.status === 'passed') ? 'passed' : 'failed';
      } catch (error) {
        result.status = 'failed'; result.error = { code: 'private-material-or-runner', message: sanitizeText(error.message, { secrets, workspaceRoot: ROOT, tempRoots: temporaryPaths }) };
        report.failures.push({ provider: id, caseId: null, ...result.error });
      } finally { for (const cleanup of cleanups.reverse()) await cleanup(); }
      save();
    }
    report.status = report.providers.length === providerIds.length && report.providers.every(item => item.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    report.status = 'failed'; report.failures.push({ provider: null, caseId: null, code: 'private-configuration', message: sanitizeText(error.message, { secrets, workspaceRoot: ROOT, tempRoots: temporaryPaths }) });
  } finally { report.finishedAt = new Date().toISOString(); finalDocument = save(); }
  return finalDocument;
}

async function main(args = process.argv.slice(2)) {
  const options = {}, flags = { '--payload': 'payloadFile', '--output-dir': 'outputDir', '--mode': 'mode', '--provider': 'provider' };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--mock') options.mock = true;
    else if (flags[args[index]] && args[index + 1]) options[flags[args[index]]] = args[++index];
    else throw new Error('Usage: evaluate-private-projects.cjs --payload FILE --output-dir PRIVATE_DIR [--mode smoke|deep] [--provider all|qwen|deepseek] [--mock]');
  }
  if (!options.payloadFile) throw new Error('A private payload file is required.');
  const stat = fs.lstatSync(options.payloadFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PAYLOAD_BYTES) throw new Error('Private payload file is invalid or too large.');
  const report = await evaluatePrivate({ ...options, payload: JSON.parse(fs.readFileSync(options.payloadFile, 'utf8')) });
  process.stdout.write(`Private CUE ${report.kind}: ${report.status}; attempted calls ${report.budget.attemptedCalls}. Complete reports remain private.\n`);
  return report.status === 'passed' ? 0 : 1;
}
module.exports = { evaluatePrivate, validatePrivatePayload, importPrivateMaterials, loadCases, loadTrustedSources, MAX_PAYLOAD_BYTES };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => { process.stderr.write('Private evaluation setup failed; inspect the private report/configuration.\n'); process.exitCode = 1; });
