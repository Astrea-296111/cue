#!/usr/bin/env node
'use strict';

// The default suite is intentionally explicit. Adding a small feature must not
// silently expand every PR back into a test of every application detail.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = require('../test/essential-suite.json');
if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length ||
    files.some(file => typeof file !== 'string' || !/^[a-z0-9-]+\.test\.js$/.test(file) ||
      !fs.statSync(path.join(root, 'test', file)).isFile())) {
  throw new Error('The essential test manifest must list distinct existing test files.');
}
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4',
  ...process.argv.slice(2), ...files.map(file => path.join('test', file))], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status == null ? 1 : result.status;
