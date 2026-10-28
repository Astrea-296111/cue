'use strict';

// Use the real bridge and IPC. Only platform/permission fixtures and external
// settings navigation are overridden for the renderer localization checks.
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const load = Module._load;
const opened = [];
let permissions = { mic: 'denied', screen: 'not-determined' };
let qaFailure=false,qaCalls=0;
Module._load = function (id) {
  if (id !== 'electron') return load.apply(this, arguments);
  return { ...electron, contextBridge: {
    exposeInMainWorld(name, api) {
      const windowsBuild = Number(process.env.CUE_UI_WINDOWS_BUILD || 0);
      electron.contextBridge.exposeInMainWorld(name, { ...api,
        qaCommit: async input => { qaCalls++; if(qaFailure)throw new Error('合成提交故障'); await new Promise(resolve=>setTimeout(resolve,100)); return api.qaCommit(input); },
        ...(windowsBuild ? { platform: 'win32', platformInfo: async () => ({ winBuild: windowsBuild }) } : {}),
        openPane: url => { opened.push(url); },
        permissionsCheck: async () => permissions
      });
    }
  } };
};
try { require(path.resolve(__dirname, '../../preload.js')); }
finally { Module._load = load; }
electron.contextBridge.exposeInMainWorld('cueTest', {
  openedPanes: () => opened,
  setPermissions: next => { permissions = next; },
  setQaFailure: value => { qaFailure=!!value; },
  qaCalls: () => qaCalls
});
