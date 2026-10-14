'use strict';

// Run with npm run test:ui on a desktop (or under Xvfb). Electron and the actual
// renderer run normally; model transport and screenshot capture are fixtures.
const electron = require('electron');
const { app, ipcMain, screen, globalShortcut, dialog } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-renderer-layout-'));
app.setPath('userData', data);
// Synthetic sources exercise the actual retrieval-to-renderer reference fold.
fs.writeFileSync(path.join(data, 'cue-project-index-v2.json'), JSON.stringify({ version: 2,
  chunkerVersion: 4, metadataSchemaVersion: 3, updatedAt: '2026-10-14T00:00:00Z',
  projects: [{ id: 'ui-synthetic', name: 'UI合成项目', aliases: ['演示源'], hasManifest: true,
    sourceType: 'folder', sourceName: 'UI合成项目', stats: { fileCount: 2, chunkCount: 2 } }],
  chunks: [
    { id: 'ui-decision', projectId: 'ui-synthetic', projectName: 'UI合成项目', path: 'interview/decision.md',
      startLine: 1, endLine: 1, docType: 'decision', truthScope: 'implemented', status: 'confirmed',
      text: 'UI_SOURCE_DECISION 我在演示源选择 MySQL，因为必须同一事务校验额度；未选择 Redis，代价是需要处理事务锁竞争。' },
    { id: 'ui-code', projectId: 'ui-synthetic', projectName: 'UI合成项目', path: 'src/reserve.js',
      startLine: 1, endLine: 1, docType: 'implementation', truthScope: 'implemented', status: 'confirmed',
      text: 'UI_SOURCE_CODE function reserve(id) { return mysql.transaction(id); }' }
  ], stats: { fileCount: 2, chunkCount: 2 } }));

let allowedToQuit = false, releaseFirst;
const calls = [], signals = [], payloads = [], audioLogs = [];
const registeredShortcuts = new Map();
const originalRegister = globalShortcut.register.bind(globalShortcut);
globalShortcut.register = (accelerator, callback) => {
  registeredShortcuts.set(accelerator, callback);
  return originalRegister(accelerator, callback);
};
let captures = 0;
const firstReply = new Promise(resolve => { releaseFirst = resolve; });
class OpenAI {
  constructor() {
    this.chat = { completions: { create: async (body, options) => {
      const index = calls.length;
      calls.push(body); signals.push(options.signal);
      return (async function* () {
        if (index === 0) await firstReply;
        yield { choices: [{ delta: { content: index === 0 ? '旧请求迟到内容' :
          Array.from({ length: 50 }, (_, i) => `${i + 1}. 测试回答，验证内容滚动及按钮位置。`).join('\n') }, finish_reason: 'stop' }] };
      })();
    } } };
  }
}
const originalLoad = Module._load;
const localizationPreload = path.join(__dirname, 'helpers/renderer-localization-preload.cjs');
const testWindows = new Set();
class TestWindow extends electron.BrowserWindow {
  constructor(options) {
    super({ ...options, webPreferences: { ...options.webPreferences,
      sandbox: false, preload: localizationPreload } });
    testWindows.add(this);
    this.once('closed', () => testWindows.delete(this));
  }
  // Electron's native lookup omits subclass wrappers used for the test preload.
  static getAllWindows() { return [...testWindows]; }
}
Module._load = function (id, parent, isMain) {
  if (id === 'electron') return { ...electron, BrowserWindow: TestWindow };
  if (id === 'openai') return OpenAI;
  if (id.startsWith('.') && parent) {
    const resolved = Module._resolveFilename(id, parent, isMain);
    if (resolved === path.join(root, 'src/screen.js')) return {
      captureScreenshot: async () => {
        captures++;
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=';
      }
    };
  }
  return originalLoad.apply(this, arguments);
};
require('../src/store').setSettings({ onboarded: true, provider: 'custom',
  baseUrl: 'https://example.invalid/v1', models: { custom: { fast: 'test-model' } },
  resumeText: 'PROFILE_RETAINED', jobDescription: 'JD_RETAINED',
  starStories: 'STORIES_RETAINED', salaryTarget: 'SALARY_RETAINED' });
ipcMain.on('ask', (_event, payload) => payloads.push(payload));
ipcMain.on('log', (_event, message) => audioLogs.push(message));
dialog.showErrorBox = (title, message) => {
  console.error('UI_ERROR_DIALOG', title, message); process.exit(1);
};
const timeout = setTimeout(() => { console.error('UI_TIMEOUT'); process.exit(1); }, 30000);
app.on('quit', (_event, code) => {
  clearTimeout(timeout);
  if (!allowedToQuit) { console.error('UI_EARLY_QUIT'); process.exit(1); }
  console.log('UI_QUIT_OK', JSON.stringify({ code, route: process.env.CUE_UI_QUIT_SHORTCUT ? 'shortcut' : 'double-click' }));
});
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check, name) {
  const deadline = Date.now() + 6000;
  while (!(await check())) { if (Date.now() > deadline) throw Error('Timeout: ' + name); await tick(); }
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    if (!win.webContents.getURL().endsWith('/renderer/index.html')) return;
    const js = code => win.webContents.executeJavaScript(code);
    const settled = () => until(() => js("document.getElementById('panel').getAnimations().every(a=>a.playState!=='running')"), 'panel animation');
    const controls = () => js(`Object.fromEntries([...document.querySelectorAll('.act, #smart-toggle, #history-btn, #more-btn, #send-btn')].map(el=>{
      const r=el.getBoundingClientRect();return [el.id||el.dataset.mode,{x:r.x,y:r.y,width:r.width,height:r.height}];
    }))`);
    function stable(before, after) {
      for (const id of Object.keys(before)) {
        for (const coordinate of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(before[id][coordinate] - after[id][coordinate]) < 0.1, id + ' moved: ' + coordinate);
        }
      }
    }
    try {
      await until(() => js("document.getElementById('code-shortcut-hint').textContent.includes('H')"), 'renderer boot');
      await settled();
      const display = screen.getPrimaryDisplay(), zoom = win.webContents.getZoomFactor();
      assert.ok(Math.abs(win.getSize()[0] - Math.round(display.bounds.width * .3 * 1.25)) <= 2);
      assert.ok(Math.abs(win.getSize()[1] - Math.round(Math.min(display.workArea.height, 1200) / 2 * 1.25)) <= 2);
      assert.ok(Math.abs(zoom - Math.min(1.4, Math.max(.85, display.bounds.width / 1920)) * 1.25) < .001);
      const layout = await js(`(() => {
        const buttons=[...document.querySelectorAll('.act')];
        return {labels:buttons.map(b=>b.firstElementChild.textContent),icons:buttons.some(b=>b.querySelector('.ic')),prep:!!document.getElementById('prep-status'),
          rows:buttons.map(b=>b.getBoundingClientRect().y),clipped:buttons.filter(b=>{const r=b.getBoundingClientRect();return r.left<0||r.right>innerWidth+1||r.bottom>innerHeight+1}).map(b=>b.dataset.mode),
          font:getComputedStyle(document.querySelector('.ai-text')).fontSize};
      })()`);
      assert.deepEqual(layout.labels, ['如何回答', '屏幕与问题', '截屏', '反问']);
      assert.equal(layout.icons, false); assert.equal(layout.prep, false);
      assert.ok(Math.max(...layout.rows) - Math.min(...layout.rows) <= 1);
      assert.deepEqual(layout.clipped, []);
      assert.equal(await js("document.documentElement.lang"), 'zh-CN');
      assert.equal(await js("document.querySelector('#current-project option').textContent"), '自动');
      assert.ok(await js("document.getElementById('current-project').getBoundingClientRect().height >= 20"));
      assert.deepEqual(await js("['.drag-label','.tb-hide span:last-child','#smart-toggle span:last-child','.ts-title','#clear-transcript-btn'].map(s=>document.querySelector(s).textContent)"),
        ['拖动', '收起', '深度思考', '对话记录', '清空记录']);
      for (const [status, text, className] of [['loading','正在加载本地模型','loading'], ['ready','本地识别已就绪','local'], ['error','识别异常','error'], ['off','未监听','off']]) {
        win.webContents.send('stt:status', { provider: 'local', status });
        await until(() => js(`document.getElementById('stt-status').textContent===${JSON.stringify(text)}`), 'Chinese STT status');
        assert.equal(await js(`document.getElementById('stt-status').classList.contains('stt-${className}')`), true);
        assert.equal(await js("document.getElementById('stt-status').getBoundingClientRect().bottom <= document.querySelector('.ai-text').getBoundingClientRect().top"), true,
          'Chinese status must stay above the answer, including on short screens');
      }

      const before = await controls();
      const texts = ['短字幕', '中英文字幕 Mixed English words '.repeat(20), '连续超长单词'.repeat(150)];
      for (let i = 0; i < 30; i++) {
        const text = texts[i % texts.length] + 'END_' + i;
        win.webContents.send('stt:interim', { channel: 'them', text });
        await until(() => js(`document.querySelector('.interim-transcript')?.textContent.endsWith('END_${i}')`), 'caption update');
        stable(before, await controls());
      }
      const caption = await js(`(() => {const el=document.querySelector('.interim-transcript');return {
        height:el.getBoundingClientRect().height,client:el.clientHeight,scroll:el.scrollHeight,top:el.scrollTop,manual:document.getElementById('input').value};})()`);
      assert.equal(caption.height, 50); assert.ok(caption.scroll > caption.client);
      assert.ok(caption.top + caption.client >= caption.scroll - 1);
      assert.equal(caption.manual, '', 'Captions must not overwrite the manual composer');
      if (process.env.CUE_UI_SCREENSHOT) {
        fs.writeFileSync(process.env.CUE_UI_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      }
      win.webContents.send('stt:final', { channel: 'them', text: '字幕结束' });
      await until(() => js("!document.querySelector('.interim-transcript').classList.contains('show')"), 'caption cleared');
      stable(before, await controls());

      await js("document.querySelector('.act[data-mode=say]').click()");
      await until(() => calls.length === 1, 'Say button');
      await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}))");
      await until(() => calls.length === 2, 'Say interruption');
      assert.ok(signals[0].aborted); releaseFirst();
      await until(() => js("!document.getElementById('send-btn').classList.contains('busy')"), 'reply complete');
      assert.equal(await js("document.body.innerText.includes('旧请求迟到内容')"), false);
      for (const mode of ['assist', 'followup', 'leetcode']) {
        const count = calls.length;
        await js(`document.querySelector('.act[data-mode=${mode}]').click()`);
        await until(() => calls.length === count + 1, mode + ' button');
        assert.equal(payloads.at(-1).mode, mode);
        if (mode === 'assist' || mode === 'leetcode') {
          assert.ok(calls.at(-1).messages.at(-1).content.some(item => item.type === 'image_url'));
        }
        await until(() => js("!document.getElementById('send-btn').classList.contains('busy')"), mode + ' complete');
      }
      assert.equal(captures, 2);
      stable(before, await controls());
      assert.ok(globalShortcut.isRegistered('CommandOrControl+H'));
      const sourceCount = calls.length;
      await js("cue.ask({mode:'say',text:'演示源项目为什么选择 MySQL？'});");
      await until(() => calls.length === sourceCount + 1, 'scoped source request');
      await until(() => js("!!document.querySelector('.answer-evidence')"), 'reference fold');
      assert.ok(JSON.stringify(calls.at(-1).messages).includes('UI_SOURCE_DECISION'));
      assert.equal(await js("document.querySelector('.answer-evidence').open"), false);
      await js("document.querySelector('.answer-evidence summary').click()");
      assert.ok(await js("document.querySelector('.answer-evidence').textContent.includes('UI_SOURCE_DECISION')"));
      await until(() => js("!document.getElementById('send-btn').classList.contains('busy')"), 'reference reply complete');
      stable(before, await controls());
      const messages = await js("({client:document.getElementById('messages').clientHeight,scroll:document.getElementById('messages').scrollHeight})");
      assert.ok(messages.client > 0 && messages.scroll > messages.client);

      await js("document.getElementById('more-btn').click()");
      await until(() => js("!document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings');
      const settings = await js(`(() => {const r=document.getElementById('settings').getBoundingClientRect();return {bottom:r.bottom,viewport:innerHeight,font:getComputedStyle(document.querySelector('.s-title')).fontSize,
        values:['resume-text','job-description','star-stories','salary-target'].map(id=>document.getElementById(id).value)};})()`);
      assert.ok(settings.bottom <= settings.viewport + 1);
      assert.deepEqual(settings.values, ['PROFILE_RETAINED', 'JD_RETAINED', 'STORIES_RETAINED', 'SALARY_RETAINED']);
      assert.equal(await js("document.querySelector('.s-title').textContent"), '设置');
      assert.equal(await js("document.getElementById('s-close').textContent"), '完成');
      assert.equal(await js("document.getElementById('project-semantic-prepare').textContent"), '准备本地语义检索');
      assert.equal(await js("document.getElementById('project-semantic-import').textContent"), '选择本地模型目录…');
      assert.equal(await js("document.getElementById('context-window-tokens').value"), '16384');
      for (const tab of ['keys', 'transcription', 'profile', 'prep', 'style', 'qa']) {
        await js(`document.querySelector('.s-tab[data-tab=${tab}]').click()`);
        await until(() => js(`!document.querySelector('.s-tab-pane[data-pane=${tab}]').classList.contains('hidden')`), 'settings tab ' + tab);
        assert.equal(await js(`document.querySelector('.s-tab-pane[data-pane=${tab}]').classList.contains('hidden')`), false, 'Settings tab: ' + tab);
        const copy = await js(`document.querySelector('.s-tab-pane[data-pane=${tab}]').innerText`);
        assert.match(copy, /[\u4e00-\u9fff]/);
        assert.doesNotMatch(copy, /Your resume|Project knowledge|Speech-to-text provider|AI rules|Salary target/);
      }
      assert.equal(await js("document.querySelector('#provider-seg [data-provider=custom]').textContent"), '自定义');
      assert.equal(await js("document.querySelector('#cloud-stt-language [value=auto]').textContent"), '自动 / 多语言');
      if (process.env.CUE_UI_SETTINGS_SCREENSHOT) {
        const shot = await win.webContents.capturePage(); fs.writeFileSync(process.env.CUE_UI_SETTINGS_SCREENSHOT, shot.toPNG());
      }
      await js("document.getElementById('s-close').click()");
      await until(() => js("document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings close');
      await js("document.getElementById('logo-btn').click()");
      const titles = ['欢迎使用 Cue', '授权屏幕与语音访问', '配置模型服务', 'Zoom 屏幕共享设置', '设置完成'];
      for (let i = 0; i < titles.length; i++) {
        assert.equal(await js("document.getElementById('ob-title').textContent"), titles[i]);
        assert.equal(await js("document.getElementById('ob-next').textContent"), i === titles.length - 1 ? '完成' : '下一步');
        if (i === 1 && process.env.CUE_UI_WINDOWS_BUILD) {
          const oldWindows = Number(process.env.CUE_UI_WINDOWS_BUILD) < 22000;
          assert.deepEqual(await js("[...document.querySelectorAll('#ob-buttons button')].map(b=>b.textContent)"),
            oldWindows ? ['打开麦克风设置'] : ['打开麦克风设置','打开屏幕录制设置']);
          await js("document.querySelector('#ob-buttons button').click()");
          assert.deepEqual(await js("cueTest.openedPanes()"), ['ms-settings:privacy-microphone']);
        }
        await js("document.getElementById('ob-next').click()");
      }
      assert.equal(await js("document.getElementById('onboard-scrim').classList.contains('hidden')"), true);
      // The real permission page consumes unchanged 'granted'/'denied' values.
      const permissionWindow = new TestWindow({ show: false, width: 620, height: 700,
        webPreferences: { contextIsolation: true, zoomFactor: 1.25 } });
      await permissionWindow.loadFile(path.join(root, 'renderer/permissions.html'));
      const permissionJS = source => permissionWindow.webContents.executeJavaScript(source);
      await until(() => permissionJS("document.getElementById('status-mic').textContent.includes('未授权')"), 'permission page');
      assert.equal(await permissionJS("document.getElementById('status-screen').textContent"), '尚未申请');
      assert.equal(await permissionJS("document.getElementById('continue-btn').disabled"), true);
      await permissionJS("document.getElementById('btn-mic').click()");
      assert.deepEqual(await permissionJS("cueTest.openedPanes()"), ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone']);
      await permissionJS("cueTest.setPermissions({mic:'granted',screen:'granted'}); document.getElementById('check-btn').click()");
      await until(() => permissionJS("!document.getElementById('continue-btn').disabled"), 'permission grant');
      assert.equal(await permissionJS("document.getElementById('status-mic').textContent"), '已授权');
      assert.equal(await permissionJS("document.getElementById('check-btn').textContent"), '重新检查');
      permissionWindow.destroy();

      // Exercise the registered global shortcuts through the real entry and renderer.
      // Media devices are synthetic; capture IPC, AudioWorklet wiring and cleanup are real.
      await js(`(() => {
        const source = new AudioContext();
        const stream = source.createMediaStreamDestination().stream;
        window.cueAudioTest = { source, stream, system: [], mic: [], gestures: [],
          displayMedia: navigator.mediaDevices.getDisplayMedia,
          userMedia: navigator.mediaDevices.getUserMedia };
        navigator.mediaDevices.getDisplayMedia = async () => {
          const active = navigator.userActivation.isActive;
          cueAudioTest.gestures.push(active);
          if (!active) throw new DOMException('User gesture required', 'InvalidStateError');
          const captured = stream.clone(); cueAudioTest.system.push(captured); return captured;
        };
        navigator.mediaDevices.getUserMedia = async () => {
          const captured = stream.clone(); cueAudioTest.mic.push(captured); return captured;
        };
      })()`);
      assert.ok(globalShortcut.isRegistered('CommandOrControl+R'));
      for (const [route, active] of [['shortcut', true], ['button', false], ['button', true], ['shortcut', false]]) {
        if (route === 'shortcut') registeredShortcuts.get('CommandOrControl+R')();
        else await win.webContents.executeJavaScript("document.getElementById('stop-btn').click()", true);
        await until(() => js(`document.getElementById('stop-btn').classList.contains('active')===${active}`), 'recording ' + route);
        assert.equal((await js('cue.captureState()')).active, active);
        assert.equal(await js("document.getElementById('composer').classList.contains('listening')"), active);
        if (active) await until(async () => audioLogs.filter(message => message === 'mic AudioWorklet processor attached').length === await js('cueAudioTest.system.length'), 'microphone capture');
        else await until(() => js('[...cueAudioTest.system,...cueAudioTest.mic].every(s=>s.getTracks().every(t=>t.readyState===\"ended\"))'), 'audio cleanup');
      }
      assert.deepEqual(await js('({system:cueAudioTest.system.length,mic:cueAudioTest.mic.length,gestures:cueAudioTest.gestures})'),
        { system: 2, mic: 2, gestures: [true, true] });
      await js(`navigator.mediaDevices.getDisplayMedia=cueAudioTest.displayMedia;
        navigator.mediaDevices.getUserMedia=cueAudioTest.userMedia;
        cueAudioTest.stream.getTracks().forEach(t=>t.stop()); cueAudioTest.source.close(); delete window.cueAudioTest;`);
      assert.ok(await js("document.getElementById('stop-btn').getAttribute('aria-label').includes('R')"));

      const size = win.getSize();
      for (const [direction, dx, dy, opposite] of [['Up',0,-25,'Down'], ['Down',0,25,'Up'], ['Left',-25,0,'Right'], ['Right',25,0,'Left']]) {
        const origin = win.getPosition();
        const accelerator = 'CommandOrControl+Shift+' + direction;
        assert.ok(globalShortcut.isRegistered(accelerator));
        registeredShortcuts.get(accelerator)();
        // Native coordinates can round by one logical pixel at fractional DPI.
        await until(() => Math.abs(win.getPosition()[0] - origin[0] - dx) <= 1 && Math.abs(win.getPosition()[1] - origin[1] - dy) <= 1, direction + ' movement');
        assert.ok(win.getSize().every((value, i) => Math.abs(value - size[i]) <= 2),
          'Movement must preserve window dimensions within native DPI rounding');
        registeredShortcuts.get('CommandOrControl+Shift+' + opposite)();
        await until(() => Math.abs(win.getPosition()[0] - origin[0]) <= 2 && Math.abs(win.getPosition()[1] - origin[1]) <= 2, 'movement restored');
      }
      const collapseControls = await controls();
      assert.ok(globalShortcut.isRegistered('CommandOrControl+P'));
      registeredShortcuts.get('CommandOrControl+P')();
      await until(() => js("document.getElementById('panel').classList.contains('collapsed')"), 'collapse shortcut');
      assert.equal(await js("document.querySelector('.tb-hide span:last-child').textContent"), '展开');
      registeredShortcuts.get('CommandOrControl+P')(); await settled();
      await until(() => js("!document.getElementById('panel').classList.contains('collapsed')"), 'expand shortcut');
      assert.ok(globalShortcut.isRegistered('CommandOrControl+Shift+H'), 'Keep the original collapse shortcut');
      registeredShortcuts.get('CommandOrControl+Shift+H')();
      await until(() => js("document.getElementById('panel').classList.contains('collapsed')"), 'legacy collapse shortcut');
      await js("document.getElementById('hide-btn').click()"); await settled();
      stable(collapseControls, await controls());
      await js("document.getElementById('hide-btn').click()");
      assert.equal(await js("document.getElementById('panel').classList.contains('collapsed')"), true);
      assert.equal(await js("document.querySelector('.tb-hide span:last-child').textContent"), '展开');
      assert.ok(await js("document.getElementById('panel-wrap').getBoundingClientRect().height < 2"));
      await js("document.getElementById('hide-btn').click()"); await settled();
      stable(collapseControls, await controls());

      // A single click, including a real browser input event, must keep running.
      await js("document.getElementById('quit-btn').click()"); await tick();
      const quit = await js("(() => {const r=document.getElementById('quit-btn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      const point = { x: Math.round(quit.x * zoom), y: Math.round(quit.y * zoom), button: 'left' };
      win.webContents.sendInputEvent({ type: 'mouseDown', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', clickCount: 1, ...point });
      await tick(); assert.equal(win.isDestroyed(), false);
      console.log('UI_LAYOUT_OK', JSON.stringify({ size:win.getSize(),zoom,scale:display.scaleFactor,layout,caption,messages,settings,
        captionUpdates:30,stableControls:true,sayInterruption:true,solveButton:true,singleClickKeepsRunning:true,
        collapseShortcut:true,recordingShortcut:true,movementStep:25,
        chineseSettings:true,chineseOnboarding:true,chinesePermissions:true,windowsBuildFixture:process.env.CUE_UI_WINDOWS_BUILD || null }));
      allowedToQuit = true;
      if (process.env.CUE_UI_QUIT_SHORTCUT) {
        assert.ok(globalShortcut.isRegistered('CommandOrControl+Shift+X'));
        registeredShortcuts.get('CommandOrControl+Shift+X')();
      } else {
        win.webContents.sendInputEvent({ type: 'mouseDown', clickCount: 2, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', clickCount: 2, ...point });
      }
    } catch (error) {
      console.error('UI_FAILED', error, JSON.stringify({ audioLogs, capture: await js(`({
        active:document.getElementById('stop-btn').classList.contains('active'),
        system:window.cueAudioTest?.system.length,mic:window.cueAudioTest?.mic.length,
        gestures:window.cueAudioTest?.gestures,stt:document.getElementById('stt-status').textContent
      })`).catch(() => null) }));
      process.exit(1);
    }
  });
});
require(path.join(root, require('../package.json').main));
