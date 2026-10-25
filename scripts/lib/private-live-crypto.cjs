'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_REPORT_BYTES = 256 * 1024 * 1024;
// Covers base64 plus gzip overhead for an incompressible maximum-size report.
const MAX_ENVELOPE_BYTES = 384 * 1024 * 1024;
const SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000;
const fail = () => { const error = new Error('Private session authentication or size validation failed.'); error.publicCode = 'invalid-private-envelope'; throw error; };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validateSession(session, {allowExpired = false, now = Date.now()} = {}) {
  if (!session || session.schemaVersion !== 1 || session.kind !== 'cue-private-live-session' ||
    !/^\d{1,24}$/.test(session.runId || '') || !/^\d{1,6}$/.test(session.runAttempt || '') ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(session.repository || '') ||
    !/^[a-f0-9]{40}$/.test(session.commitSha || '') || typeof session.publicKey !== 'string' || session.publicKey.length > 4096) fail();
  const created = Date.parse(session.createdAt), expires = Date.parse(session.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires <= created ||
    expires - created > SESSION_LIFETIME_MS || created > now + 60_000 || !allowExpired && now > expires) fail();
  let key;
  try { key = crypto.createPublicKey(session.publicKey); } catch { fail(); }
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 3072 ||
    digest(key.export({type:'spki', format:'der'})) !== session.fingerprint) fail();
  return session;
}

function createSession({runId, runAttempt = '1', repository, commitSha, now = Date.now()}) {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('rsa', {
    modulusLength:3072, publicKeyEncoding:{type:'spki', format:'pem'}, privateKeyEncoding:{type:'pkcs8', format:'pem'}
  });
  const fingerprint = digest(crypto.createPublicKey(publicKey).export({type:'spki', format:'der'}));
  const session = {schemaVersion:1, kind:'cue-private-live-session', runId:String(runId), runAttempt:String(runAttempt),
    repository, commitSha, createdAt:new Date(now).toISOString(), expiresAt:new Date(now + SESSION_LIFETIME_MS).toISOString(), publicKey, fingerprint};
  validateSession(session, {now});
  return {session, privateKey};
}

function bytes64(value, expectedLength, maxLength = MAX_ENVELOPE_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxLength / 3) * 4 || value.length % 4 !== 0 ||
      expectedLength != null && value.length !== Math.ceil(expectedLength / 3) * 4) fail();
  // A repeated capture/group over multi-megabyte ciphertext exhausts V8's
  // regexp stack. Scan the alphabet once; only terminal padding is allowed.
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (/[^A-Za-z0-9+/]/.test(value.slice(0, value.length - padding))) fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxLength || expectedLength != null && bytes.length !== expectedLength || bytes.toString('base64') !== value) fail();
  return bytes;
}
function context(session, purpose) {
  return Buffer.from(JSON.stringify({version:1, purpose, fingerprint:session.fingerprint, repository:session.repository,
    runId:session.runId, runAttempt:session.runAttempt, commitSha:session.commitSha}));
}
function validateEnvelope(session, envelope, kind) {
  if (!envelope || envelope.schemaVersion !== 1 || envelope.kind !== kind || envelope.fingerprint !== session.fingerprint ||
    envelope.runId !== session.runId || envelope.runAttempt !== session.runAttempt || envelope.commitSha !== session.commitSha ||
    envelope.compression !== 'gzip' || Buffer.byteLength(JSON.stringify(envelope)) > MAX_ENVELOPE_BYTES) fail();
}
function seal(session, key, value, kind, maxBytes) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > maxBytes) fail();
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(context(session, kind));
  const ciphertext = Buffer.concat([cipher.update(zlib.gzipSync(plaintext)), cipher.final()]);
  const envelope = {schemaVersion:1, kind, fingerprint:session.fingerprint, runId:session.runId,
    runAttempt:session.runAttempt, commitSha:session.commitSha, compression:'gzip',
    iv:iv.toString('base64'), tag:cipher.getAuthTag().toString('base64'), ciphertext:ciphertext.toString('base64')};
  if (Buffer.byteLength(JSON.stringify(envelope)) > MAX_ENVELOPE_BYTES) fail();
  return envelope;
}
function open(session, key, envelope, kind, maxBytes) {
  validateEnvelope(session, envelope, kind);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes64(envelope.iv, 12));
    decipher.setAAD(context(session, kind)); decipher.setAuthTag(bytes64(envelope.tag, 16));
    const compressed = Buffer.concat([decipher.update(bytes64(envelope.ciphertext)), decipher.final()]);
    const plaintext = zlib.gunzipSync(compressed, {maxOutputLength:maxBytes});
    return JSON.parse(plaintext.toString('utf8'));
  } catch { fail(); }
}
function encryptPayload({session, payload, key = crypto.randomBytes(32), now = Date.now()}) {
  validateSession(session, {now});
  const envelope = seal(session, key, payload, 'cue-private-input', MAX_INPUT_BYTES);
  envelope.wrappedKey = crypto.publicEncrypt({key:session.publicKey, padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256', oaepLabel:context(session, 'key')}, key).toString('base64');
  return {envelope, key};
}
function decryptPayload({session, privateKey, envelope, now = Date.now()}) {
  validateSession(session, {now}); validateEnvelope(session, envelope, 'cue-private-input');
  let key;
  try { key = crypto.privateDecrypt({key:privateKey, padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256', oaepLabel:context(session, 'key')}, bytes64(envelope.wrappedKey, 384)); } catch { fail(); }
  return {payload:open(session, key, envelope, 'cue-private-input', MAX_INPUT_BYTES), key};
}
function responseKey(session, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail();
  return Buffer.from(crypto.hkdfSync('sha256', key, Buffer.from(session.fingerprint, 'hex'), context(session, 'response-key'), 32));
}
function encryptReports({session, key, reports}) {
  validateSession(session, {allowExpired:true});
  return seal(session, responseKey(session, key), reports, 'cue-private-report', MAX_REPORT_BYTES);
}
function decryptReports({session, key, envelope}) {
  validateSession(session, {allowExpired:true});
  return open(session, responseKey(session, key), envelope, 'cue-private-report', MAX_REPORT_BYTES);
}

module.exports = {MAX_INPUT_BYTES, MAX_REPORT_BYTES, MAX_ENVELOPE_BYTES, SESSION_LIFETIME_MS,
  validateSession, createSession, encryptPayload, decryptPayload, encryptReports, decryptReports, bytes64};
