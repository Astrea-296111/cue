'use strict';

// One actual Electron flow: boot safely, import materials, render a streamed
// answer, show an error, and retain the local profile. No audio device fixtures.
const electron = require('electron');
const { app, ipcMain, dialog } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-core-ui-'));
app.setPath('userData', data);

let failProvider = false, finished = false, screenEnabled=false;
const uiEvents=[];
const requests = [], windows = new Set(), selections = [];
class OpenAI {
  constructor() {
    this.chat = { completions: { create: async body => {
      requests.push(body);
      if (failProvider) throw new Error('UI_MODEL_FAILURE_FIXTURE');
      if(body.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')))return (async function*(){yield {choices:[{delta:{content:'CUE_SCREEN {"type":"vibe-coding","title":"合成应用任务","observed":["synthetic screen"],"inferred":[],"missing":[],"stage":"plan"}\n### 当前步骤\n先确认契约。\n### 现在复制这一段\n```text\nUI_COPY_PROMPT 先读取题面与工程，列出契约和未知项，本步不改代码。\n```\n### 分步推进\n后续阶段保留完整提示。'+('验收边界。'.repeat(70))},finish_reason:'stop'}]};})();
      return (async function* () {
        yield { choices: [{ delta: { content: '1. 先确认项目事实。\n2.' } }] };
        yield { choices: [{ delta: { content: ' 根据源码解释实现。\n3. 说明限制和验证方法。' }, finish_reason: 'stop' }] };
      })();
    } } };
  }
}
class TestWindow extends electron.BrowserWindow {
  constructor(options) {
    super({ ...options, webPreferences: { ...options.webPreferences, sandbox: false,
      preload: path.join(__dirname, 'helpers/renderer-localization-preload.cjs') } });
    const originalSend=this.webContents.send.bind(this.webContents);
    this.webContents.send=(channel,payload)=>{if(channel==='llm:start')uiEvents.push({channel,...payload});return originalSend(channel,payload);};
    this.createdHidden = !this.isVisible();
    this.protectionRequested = false;
    const protect = this.setContentProtection.bind(this);
    this.setContentProtection = value => { const result = protect(value); this.protectionRequested = value === true; return result; };
    for (const method of ['show', 'showInactive']) {
      const show = this[method].bind(this);
      this[method] = (...args) => {
        assert.equal(this.protectionRequested, true, 'Protection must be requested before showing the overlay');
        return show(...args);
      };
    }
    windows.add(this); this.once('closed', () => windows.delete(this));
  }
  static getAllWindows() { return [...windows]; }
}
const originalLoad = Module._load;
Module._load = function(id, parent, isMain) {
  if (id === 'electron') return { ...electron, BrowserWindow: TestWindow };
  if (id === 'openai') return OpenAI;
  if (id.startsWith('.') && parent && Module._resolveFilename(id, parent, isMain) === path.join(root, 'src/screen.js')) {
    return { captureScreenshot: async () => { if(!screenEnabled)throw new Error('Text smoke must not capture a screen');return 'data:image/png;base64,'+fs.readFileSync(path.join(root,'test/fixtures/live-interaction/vibe.png')).toString('base64'); } };
  }
  return originalLoad.apply(this, arguments);
};
require('../src/store').setSettings({ onboarded: true, provider: 'custom',
  baseUrl: 'https://example.invalid/v1', apiKeys: { custom: 'synthetic-ui-key' },
  models: { custom: { fast: 'test-model' } }, resumeText: 'PROFILE_RETAINED', jobDescription: 'JD_RETAINED' });
dialog.showErrorBox = (title, message) => { console.error('UI_ERROR_DIALOG', title, message); finish(1); };
const nativeDialog = dialog.showOpenDialog;
const nativeSaveDialog=dialog.showSaveDialog;
dialog.showSaveDialog=async(...args)=>{
  if(args.at(-1)?.title==='导出项目问答库')return {canceled:true};
  if(args.at(-1)?.title==='导出本地脱敏会话诊断'&&process.env.CUE_UI_DIAGNOSTIC_FILE){
    const target=path.resolve(process.env.CUE_UI_DIAGNOSTIC_FILE);fs.mkdirSync(path.dirname(target),{recursive:true});return {canceled:false,filePath:target};
  }
  return nativeSaveDialog.apply(dialog,args);
};
dialog.showOpenDialog = async (...args) => {
  if (!['选择项目材料','导入个人资料工作区'].includes(args.at(-1)?.title)) return nativeDialog.apply(dialog, args);
  const selection = selections.shift();
  assert.ok(selection, 'Material selection must use an explicit synthetic fixture');
  return { canceled: false, filePaths: [selection] };
};
const timeout = setTimeout(() => { console.error('UI_TIMEOUT'); finish(1); }, 180000);
async function until(check, name) {
  const deadline = Date.now() + 6000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timeout: ' + name);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
function finish(code) {
  if (finished) return;
  finished = true; clearTimeout(timeout);
  for (const win of [...windows]) if (!win.isDestroyed()) win.destroy();
  try { fs.rmSync(data, { recursive: true, force: true }); }
  catch (error) { console.error('UI_CLEANUP_WARNING', error.message); }
  finally { app.exit(code); }
}
app.on('quit', () => { if (!finished) { console.error('UI_EARLY_QUIT'); process.exitCode = 1; } });
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)console.log('RENDERER_DIAGNOSTIC',message);});
  win.webContents.once('did-finish-load', async () => {
    if (!win.webContents.getURL().endsWith('/renderer/index.html')) return;
    const js = code => win.webContents.executeJavaScript(code);
    try {
      await until(() => js("document.getElementById('code-shortcut-hint')?.textContent.includes('H')"), 'renderer ready');
      assert.deepEqual(await js("[...document.querySelectorAll('#answer-domains button')].map(b=>b.textContent)"),['Arclight','cae','八股']);
      for (const domain of ['arclight','cae','general']) {
        await js(`document.querySelector('[data-domain="${domain}"]').click()`);
        await until(()=>js(`document.querySelector('[data-domain="${domain}"]').getAttribute('aria-pressed')==='true'`),'domain '+domain);
        assert.equal(require('../src/store').getSettings().answerDomain,domain);
        assert.equal(JSON.parse(fs.readFileSync(path.join(data,'cue-data.json'),'utf8')).answerDomain,domain);
      }
      assert.equal(win.createdHidden, true);
      assert.equal(win.protectionRequested, true);
      const verifyProtected=async selector=>{
        assert.equal(await js(`document.querySelector(${JSON.stringify(selector)})?.ownerDocument===document`),true,'surface belongs to main renderer');
        if(process.platform==='win32')assert.equal(require('../src/windows-capture-protection').createWindowsCaptureProtection().inspect(win),0x11,'main renderer native affinity');
      };
      await js("document.getElementById('more-btn').click()");
      await until(() => js("!document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings open');
      await verifyProtected('#settings-scrim');
      const materialImport = await require('./helpers/material-import-ui-checks.cjs')({
        js, until, data, verifyProtected, selectMaterial: file => selections.push(file)
      });
      console.log('UI_MATERIAL_IMPORT_OK');
      const personalImport = await require('./helpers/personal-workspace-ui-checks.cjs')({
        js, until, data, verifyProtected, selectMaterial: file => selections.push(file)
      });
      console.log('UI_PERSONAL_IMPORT_OK');
      const liveTools = await require('./helpers/live-tools-ui-checks.cjs')({js,until,requests,win,verifyProtected});
      const settings = await js('cue.settingsGet()');
      assert.equal(settings.resumeText, 'PROFILE_LOCAL_EDIT');
      assert.equal(settings.jobDescription, 'JD_RETAINED');
      if (process.env.CUE_UI_SETTINGS_SCREENSHOT) {
        fs.mkdirSync(path.dirname(process.env.CUE_UI_SETTINGS_SCREENSHOT), { recursive: true });
        fs.writeFileSync(process.env.CUE_UI_SETTINGS_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      await js("document.getElementById('s-close').click()");
      await until(() => js("document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings close');
      const submit = question => js(`document.getElementById('input').value=${JSON.stringify(question)};document.getElementById('input').dispatchEvent(new Event('input'));document.getElementById('send-btn').click()`);
      await submit('解释事务隔离与并发更新。');
      await until(() => requests.length === 1 && js("!document.getElementById('send-btn').classList.contains('busy')"), 'streamed reply');
      await until(() => js("document.querySelectorAll('.response-group:first-child .ai-text ol li').length===3"), 'answer rendered');
      const qaPerformance=await require('./helpers/qa-ui-benchmark.cjs')({js,requests,output:process.env.CUE_UI_QA_BENCHMARK_FILE});
      if(process.env.CUE_UI_DIAGNOSTIC_FILE){
        await js('cue.exportDiagnostics()');
        const diagnostic=JSON.parse(fs.readFileSync(process.env.CUE_UI_DIAGNOSTIC_FILE,'utf8'));
        assert.equal(diagnostic.lastActualRequest.delivery,'qa-verbatim');assert.equal(diagnostic.lastActualRequest.modelCalls,0);
      }
      screenEnabled=true;
      const screenUi=await require('./helpers/screen-output-ui-checks.cjs')({js,until,clipboard:electron.clipboard,screenshot:process.env.CUE_UI_SCREEN_SCREENSHOT,win});
      screenEnabled=false;
      const windowsShortcuts=await require('./helpers/windows-live-shortcuts.cjs')({win,js,events:uiEvents,output:process.env.CUE_UI_WINDOWS_SHORTCUT_FILE});
      failProvider = true;
      await submit('解释另一个事务隔离问题。');
      await until(() => js("document.querySelector('.response-group:first-child .ai-text')?.textContent.includes('UI_MODEL_FAILURE_FIXTURE')"), 'provider error visible');
      assert.equal(await js("document.getElementById('send-btn').classList.contains('busy')"), false);
      console.log('UI_CORE_OK', JSON.stringify({ boot: true, textReply: true, providerError: true,
        createdHidden: true, protectionRequested: true, profileAndJdRetained: true, materialImport, personalImport, liveTools, qaPerformance, screenUi, windowsShortcuts }));
      finish(0);
    } catch (error) { console.error('UI_FAILED', error.stack || error); finish(1); }
  });
});
require(path.join(root, require('../package.json').main));
