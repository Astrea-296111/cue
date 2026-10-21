'use strict';

// Loaded eagerly at application startup. Request handling only reads this
// frozen object; it never invokes Git or reads package/index files.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const validCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value.trim());
const root = path.resolve(__dirname, '..');
function readIdentity() {
  if (validCommit(process.env.CUE_BUILD_COMMIT)) return {
    buildCommit: process.env.CUE_BUILD_COMMIT.trim(), sourceDirty: null, identitySource: 'environment'
  };
  if (fs.existsSync(path.join(root, '.git'))) {
    try {
      const buildCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
      if (validCommit(buildCommit)) {
        const sourceDirty = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
          cwd: root, encoding: 'utf8', timeout: 2000, windowsHide: true
        }).trim();
        return { buildCommit, sourceDirty, identitySource: 'checkout-startup' };
      }
    } catch (_) {}
  }
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));
    if (validCommit(data.buildCommit)) return {
      buildCommit: data.buildCommit, sourceDirty: typeof data.sourceDirty === 'boolean' ? data.sourceDirty : null,
      identitySource: 'packaged-metadata'
    };
  } catch (_) {}
  return { buildCommit: null, sourceDirty: null, identitySource: 'unavailable' };
}
const identity = Object.freeze(readIdentity());
module.exports = { ...identity, getBuildIdentity: () => identity };
