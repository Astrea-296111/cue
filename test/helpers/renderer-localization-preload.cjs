'use strict';

// Use the real bridge and IPC. Only platform/permission fixtures and external
// settings navigation are overridden for the renderer localization checks.
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const load = Module._load;
const opened = [];
let permissions = { mic: 'denied', screen: 'not-determined' };
Module._load = function (id) {
  if (id !== 'electron') return load.apply(this, arguments);
  return { ...electron, contextBridge: {
    exposeInMainWorld(name, api) {
      const windowsBuild = Number(process.env.CUE_UI_WINDOWS_BUILD || 0);
      electron.contextBridge.exposeInMainWorld(name, { ...api,
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
  setPermissions: next => { permissions = next; }
});
