'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const verify = require('../scripts/verify-semantic-packaging.cjs');

test('cross-platform package rejects host-only Sharp even if target ONNX exists', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-semantic-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ort = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v3/win32/x64');
  fs.mkdirSync(ort, { recursive: true });
  for (const file of ['onnxruntime_binding.node', 'onnxruntime.dll', 'DirectML.dll']) fs.writeFileSync(path.join(ort, file), 'fixture');
  assert.throws(() => verify({ appDir: root, electronPlatformName: 'win32', arch: 1 }), /sharp-win32-x64/);
  const sharp = path.join(root, 'node_modules/@img/sharp-win32-x64/lib');
  fs.mkdirSync(sharp, { recursive: true });
  fs.writeFileSync(path.join(sharp, 'sharp-win32-x64.node'), 'fixture');
  assert.throws(() => verify({ appDir: root, electronPlatformName: 'win32', arch: 1 }), /libvips-42.dll/);
  fs.writeFileSync(path.join(sharp, 'libvips-42.dll'), 'fixture');
  assert.throws(() => verify({ appDir: root, electronPlatformName: 'win32', arch: 1 }), /koffi-win32-x64/);
  const koffi = path.join(root, 'node_modules/@koromix/koffi-win32-x64/win32_x64');
  fs.mkdirSync(koffi, { recursive: true });
  fs.writeFileSync(path.join(koffi, 'koffi.node'), 'fixture');
  assert.doesNotThrow(() => verify({ packager: { info: { appDir: root } }, electronPlatformName: 'win32', arch: 'x64' }));
});

test('actual Electron Builder hook verifies dependencies, compiles approved materials, then writes build identity', async () => {
  const hookPath = require('../electron-builder.cjs').beforePack;
  assert.equal(hookPath, 'scripts/prepare-app-build.cjs');
  const calls = [], context = { electronPlatformName: 'win32', arch: 'x64', appDir: '/approved-app' };
  const hookModule = { exports: {} };
  const load = id => {
    if (id === 'node:path') return path;
    if (id === './bundle-project-materials.cjs') return { buildBundleFile: async options => {
      assert.equal(options.manifestPath, path.join(context.appDir, 'materials/manifest.json'));
      assert.equal(options.outputPath, path.join(context.appDir, 'materials/bundle.json'));
      calls.push(id);
    } };
    assert.ok(['./verify-semantic-packaging.cjs', './write-build-info.cjs'].includes(id));
    return async supplied => { assert.equal(supplied, context); calls.push(id); };
  };
  const code = fs.readFileSync(path.join(__dirname, '..', hookPath), 'utf8');
  require('node:vm').runInNewContext(code, { require: load, module: hookModule });
  await hookModule.exports(context);
  assert.deepEqual(calls, ['./verify-semantic-packaging.cjs', './bundle-project-materials.cjs', './write-build-info.cjs']);
});
