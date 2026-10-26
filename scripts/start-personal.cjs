#!/usr/bin/env node
'use strict';
const path = require('node:path');
const {spawn} = require('node:child_process');
const directory=path.resolve(process.env.CUE_PERSONAL_WORKSPACE || path.join(__dirname,'../materials/personal'));
const child=spawn(require('electron'),[path.join(__dirname,'..'),...process.argv.slice(2)], {
  stdio:'inherit', env:{...process.env,CUE_PERSONAL_WORKSPACE:directory}
});
child.once('error',()=>{process.stderr.write('无法启动 Electron，请先 npm ci。\n');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code==null?1:code;});
