'use strict';

// Encrypted evaluation inputs are data. Use the same workspace validator as
// the application, retaining import metadata needed to verify its revision.
const {createHash} = require('node:crypto');
const {validatePersonalWorkspace} = require('../../src/personal-workspace');
const {MAX_INPUT_BYTES} = require('./private-live-crypto.cjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function validateEvaluationWorkspace(value) {
  if (!object(value) || Buffer.byteLength(JSON.stringify(value)) > MAX_INPUT_BYTES) throw new Error('Invalid or oversized evaluation workspace.');
  const profile = value.profile;
  if (!object(profile) || typeof profile.resumeText !== 'string' || Buffer.byteLength(profile.resumeText) > 256*1024 ||
      typeof profile.jobDescription !== 'string' || Buffer.byteLength(profile.jobDescription) > 64*1024 || Buffer.byteLength(JSON.stringify(profile)) > 512*1024)
    throw new Error('Invalid multi-turn profile.');
  if (profile.activeJobProfile && profile.activeJobProfileId && profile.activeJobProfile !== profile.activeJobProfileId) throw new Error('Conflicting active job profile fields.');
  const normalized = {...profile};
  delete normalized.activeJobProfile;
  if (profile.activeJobProfile) normalized.activeJobProfileId = profile.activeJobProfile;
  for (const job of profile.jobProfiles || []) if (typeof job.jobDescription !== 'string' || Buffer.byteLength(job.jobDescription) > 64*1024) throw new Error('Invalid job description.');
  return validatePersonalWorkspace({...value, profile:normalized});
}
function projectJudgeReference(workspace) {
  const validated = validateEvaluationWorkspace(workspace);
  const body = {facts:validated.facts, profile:validated.profile, revision:validated.revision};
  return {...body, sha256:hash(body)};
}
function validateJudgeReference(value) {
  if (!object(value) || Object.keys(value).some(key => !['facts','profile','revision','sha256'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(value.revision || '') || !/^[a-f0-9]{64}$/.test(value.sha256 || '') || Buffer.byteLength(JSON.stringify(value)) > MAX_INPUT_BYTES)
    throw new Error('Invalid judge-only reference.');
  // A full workspace revision may include a source manifest and merge log.
  // The projection has its own digest; do not compare these different hashes.
  const validated = validateEvaluationWorkspace({schemaVersion:value.facts?.schemaVersion, facts:value.facts, profile:value.profile});
  const body = {facts:validated.facts, profile:validated.profile, revision:value.revision};
  if (hash(body) !== value.sha256) throw new Error('Judge-only reference digest mismatch.');
  return {...body, sha256:value.sha256};
}
module.exports = {validateEvaluationWorkspace, projectJudgeReference, validateJudgeReference};
