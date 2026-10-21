'use strict';

const assert = require('node:assert/strict');

// Runs against the real renderer/IPC, with browser input rather than synthetic
// change events. Windows desktop-capture validation still requires Windows.
module.exports = async function checkProtectedDropdowns({ win, js, until, windowCount, mouseIgnoreEvents }) {
  const zoom = win.webContents.getZoomFactor();
  const key = name => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: name });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: name });
  };
  async function click(selector) {
    const point = await js(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x:Math.round((r.x+r.width/2)*${zoom}),y:Math.round((r.y+r.height/2)*${zoom})};})()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  }
  const isOpen = id => js(`!document.getElementById('${id}-options').hidden`);
  const closed = () => until(() => js("[...document.querySelectorAll('.capture-safe-options')].every(el=>el.hidden)"), 'dropdown closed');
  await until(() => js("document.querySelectorAll('#current-project option').length===2"), 'project catalog');
  const originalCatalog = (await js('cue.projectIndexState()')).projects;
  const initialWindows = windowCount();
  assert.deepEqual(await js(`['current-project','realtime-answer-mode'].map(id=>{
    const native=document.getElementById(id),trigger=document.getElementById(id+'-trigger'),menu=document.getElementById(id+'-options');
    return [native.hidden,native.tabIndex,native.getBoundingClientRect().height,trigger.getAttribute('role'),
      trigger.getBoundingClientRect().height>=20,menu.parentElement.id];})`),
  [[true, -1, 0, 'combobox', true, 'app'], [true, -1, 0, 'combobox', true, 'app']]);
  assert.equal(await js("document.querySelectorAll('select[data-capture-safe]').length"), 2);
  assert.equal(await js("document.getElementById('instant-rag-policy').hidden"), false, 'Settings selectors stay unchanged');

  // Real pointer selection persists through the existing project IPC.
  await click('#current-project-trigger');
  await until(() => isOpen('current-project'), 'project list opens');
  assert.deepEqual(await js("[...document.querySelectorAll('#current-project-options [role=option]')].map(el=>el.textContent)"), ['自动', 'UI合成项目']);
  await click('#current-project-options [data-index="1"]');
  await until(async () => (await js('cue.settingsGet()')).currentProjectId === 'ui-synthetic', 'project selection saved');
  await closed();
  assert.equal(await js("document.getElementById('current-project-trigger').textContent"), 'UI合成项目');
  await click('#current-project-trigger'); key('Home'); key('Enter');
  await until(async () => !(await js('cue.settingsGet()')).currentProjectId, 'automatic project saved');

  // Keyboard selection persists modes; Escape cancels, Tab dismisses.
  await click('#realtime-answer-mode-trigger'); key('End'); key('Enter');
  await until(async () => (await js('cue.settingsGet()')).realtimeAnswerMode === 'standard', 'keyboard mode saved');
  assert.equal(await js("document.getElementById('realtime-answer-mode-trigger').textContent"), '标准问答');
  await click('#realtime-answer-mode-trigger'); key('Home'); key('Escape'); await closed();
  assert.equal((await js('cue.settingsGet()')).realtimeAnswerMode, 'standard');
  assert.equal(await js("document.activeElement.id"), 'realtime-answer-mode-trigger');
  await click('#realtime-answer-mode-trigger'); key('Home'); key('Enter');
  await until(async () => (await js('cue.settingsGet()')).realtimeAnswerMode === 'instant', 'instant mode restored');
  await click('#realtime-answer-mode-trigger'); key('Tab'); await closed();
  await click('#current-project-trigger'); await click('#input'); await closed();
  assert.equal(await js('document.activeElement.id'), 'input', 'Outside click keeps destination focus');
  await click('#current-project-trigger'); await click('#realtime-answer-mode-trigger');
  await until(() => isOpen('realtime-answer-mode'), 'second dropdown opens');
  assert.equal(await isOpen('current-project'), false);
  key('Escape'); await closed();

  // Programmatic collapse/settings openings must dismiss a portal as well.
  await click('#current-project-trigger');
  await js("document.getElementById('hide-btn').click()"); await closed();
  await js("document.getElementById('hide-btn').click()");
  await until(() => js("document.getElementById('panel').getAnimations().every(a=>a.playState!=='running')"), 'expanded panel');
  await click('#current-project-trigger');
  await js("document.getElementById('more-btn').click()"); await closed();
  await until(() => js("!document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings opens');
  await js("document.getElementById('s-close').click()");
  await until(() => js("document.getElementById('settings-scrim').classList.contains('hidden')"), 'settings closes');

  // Runtime catalog changes invalidate old options. Many/long/literal labels
  // remain scrollable and bounded on a small protected window.
  await click('#current-project-trigger');
  const projects = Array.from({ length: 40 }, (_, i) => ({ id: 'dropdown-' + i,
    name: i === 0 ? '<img src=x onerror=alert(1)>' : '长项目名称'.repeat(15) + i }));
  win.webContents.send('project:catalog', { projects }); await closed();
  await until(() => js("document.querySelectorAll('#current-project option').length===41"), 'updated catalog');
  const widths = [];
  for (let i = 0; i < 3; i++) {
    await click('#current-project-trigger');
    await until(() => isOpen('current-project'), 'updated list opens');
    widths.push(await js("document.getElementById('current-project-options').getBoundingClientRect().width"));
    key('Escape'); await closed();
  }
  assert.equal(Math.max(...widths) - Math.min(...widths), 0, 'Reopening must not grow the popup');
  await click('#current-project-trigger'); key('End');
  await until(() => js("document.getElementById('current-project-options').scrollTop>0"), 'last option scrolls into view');
  assert.equal(await js(`(() => {
    const menu=document.getElementById('current-project-options'),r=menu.getBoundingClientRect();
    return r.left>=8 && r.right<=innerWidth-7 && r.top>=8 && r.bottom<=innerHeight-7 &&
      getComputedStyle(menu).pointerEvents==='auto' && !!document.elementFromPoint(r.x+10,r.y+10)?.closest('.capture-safe-options');
  })()`), true, 'Portal stays visible and accepts pointer input');
  // A portal is outside #panel-wrap: forwarded mouse movement must explicitly
  // recognize it as UI, or Windows/macOS can pass its clicks to the desktop.
  const forwardedMouse = await js("['win32','darwin'].includes(cue.platform)");
  if (forwardedMouse) {
    await js("document.dispatchEvent(new MouseEvent('mousemove',{clientX:-1,clientY:-1,bubbles:true}))");
    await until(() => mouseIgnoreEvents.at(-1) === true, 'empty space becomes click-through');
    await js(`(() => {const r=document.getElementById('current-project-options').getBoundingClientRect();
      document.dispatchEvent(new MouseEvent('mousemove',{clientX:r.x+10,clientY:r.y+10,bubbles:true}));})()`);
    await until(() => mouseIgnoreEvents.at(-1) === false, 'menu disables click-through');
  }
  assert.equal(await js("document.querySelector('#current-project-options [data-index=\"1\"]').textContent"), projects[0].name);
  assert.equal(await js("document.querySelectorAll('.capture-safe-options img, .capture-safe-options [title], .capture-safe-trigger[title]').length"), 0,
    'Project labels are literal text and must not create native tooltip popups');
  await js("window.dispatchEvent(new Event('blur'))"); await closed();
  win.webContents.send('project:catalog', { projects: originalCatalog });
  await until(() => js("document.querySelectorAll('#current-project option').length===2"), 'original catalog restored');
  assert.equal(windowCount(), initialWindows, 'Dropdowns remain in the existing BrowserWindow');
  return { pointerAndKeyboard: true, savedSelections: true, catalogRefresh: true, viewportBounds: true, domOnly: true, forwardedMouse };
};
