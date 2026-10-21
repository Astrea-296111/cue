'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

async function writeBuildInfo(context = {}) {
  const directory = context.packager?.projectDir || context.projectDir || path.resolve(__dirname, '..');
  let buildCommit = process.env.CUE_BUILD_COMMIT || '', sourceDirty = null;
  if (!/^[a-f0-9]{40}$/i.test(buildCommit)) {
    try {
      buildCommit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: directory, timeout: 2000, windowsHide: true })).stdout.trim();
      sourceDirty = !!(await execute('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: directory, timeout: 2000, windowsHide: true })).stdout.trim();
    } catch (_) { buildCommit = ''; }
  }
  const data = { buildCommit: /^[a-f0-9]{40}$/i.test(buildCommit) ? buildCommit : null,
    sourceDirty, builtAt: new Date().toISOString() };
  await fs.writeFile(path.join(directory, 'build-info.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
  return data;
}
module.exports = writeBuildInfo;
if (require.main === module) writeBuildInfo().then(data => console.log(JSON.stringify(data))).catch(error => {
  console.error('[build-info]', error.code || error.name); process.exitCode = 1;
});
