'use strict';

// Run with npm run test:ui on a desktop (or under Xvfb). Electron and the actual
// renderer run normally; model transport and screenshot capture are fixtures.
const { app, ipcMain, screen, globalShortcut, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-renderer-layout-'));
app.setPath('userData', data);

let allowedToQuit = false, releaseFirst;
const calls = [], signals = [], payloads = [];
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
Module._load = function (id, parent, isMain) {
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
      const messages = await js("({client:document.getElementById('messages').clientHeight,scroll:document.getElementById('messages').scrollHeight})");
      assert.ok(messages.client > 0 && messages.scroll > messages.client);

      await js("document.getElementById('more-btn').click()");
      await until(() => js("!document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings');
      const settings = await js(`(() => {const r=document.getElementById('settings').getBoundingClientRect();return {bottom:r.bottom,viewport:innerHeight,font:getComputedStyle(document.querySelector('.s-title')).fontSize,
        values:['resume-text','job-description','star-stories','salary-target'].map(id=>document.getElementById(id).value)};})()`);
      assert.ok(settings.bottom <= settings.viewport + 1);
      assert.deepEqual(settings.values, ['PROFILE_RETAINED', 'JD_RETAINED', 'STORIES_RETAINED', 'SALARY_RETAINED']);
      await js("document.getElementById('s-close').click()");
      await until(() => js("document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings close');
      await js("document.getElementById('hide-btn').click()");
      assert.equal(await js("document.getElementById('panel').classList.contains('collapsed')"), true);
      assert.ok(await js("document.getElementById('panel-wrap').getBoundingClientRect().height < 2"));
      await js("document.getElementById('hide-btn').click()"); await settled();
      stable(before, await controls());

      // A single click, including a real browser input event, must keep running.
      await js("document.getElementById('quit-btn').click()"); await tick();
      const quit = await js("(() => {const r=document.getElementById('quit-btn').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
      const point = { x: Math.round(quit.x * zoom), y: Math.round(quit.y * zoom), button: 'left' };
      win.webContents.sendInputEvent({ type: 'mouseDown', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', clickCount: 1, ...point });
      await tick(); assert.equal(win.isDestroyed(), false);
      console.log('UI_LAYOUT_OK', JSON.stringify({ size:win.getSize(),zoom,scale:display.scaleFactor,layout,caption,messages,settings,
        captionUpdates:30,stableControls:true,sayInterruption:true,solveButton:true,singleClickKeepsRunning:true }));
      allowedToQuit = true;
      if (process.env.CUE_UI_QUIT_SHORTCUT) {
        assert.ok(globalShortcut.isRegistered('CommandOrControl+Shift+X'));
        registeredShortcuts.get('CommandOrControl+Shift+X')();
      } else {
        win.webContents.sendInputEvent({ type: 'mouseDown', clickCount: 2, ...point });
        win.webContents.sendInputEvent({ type: 'mouseUp', clickCount: 2, ...point });
      }
    } catch (error) { console.error('UI_FAILED', error); process.exit(1); }
  });
});
require(path.join(root, require('../package.json').main));
