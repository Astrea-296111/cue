'use strict';

const assert = require('node:assert/strict');

module.exports = async function checkCompactPanel({ win, js, until, screenshot }) {
  const bounds = win.getBounds(), zoom = win.webContents.getZoomFactor(), resizable = win.isResizable();
  const ids = ['answer-target-text', 'answer-next-target', 'answer-execution-profile', 'answer-timing', 'active-project-label'];
  const saved = await js(`({text:${JSON.stringify(ids)}.map(id=>document.getElementById(id).textContent),
    input:document.getElementById('input').value,project:document.querySelector('#current-project option:checked').textContent})`);
  const measure = () => js(`(() => {
    const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
    const ids=['answer-target-panel','messages','action-row','composer','input','send-btn'];
    const areas=Object.fromEntries(ids.map(id=>[id,rect(id)]));
    const clipped=[...document.querySelectorAll('.act, .capture-safe-trigger, #answer-target-edit, #answer-target-retry, #composer-bottom button')]
      .filter(el=>{const r=el.getBoundingClientRect();return r.left<0 || r.right>innerWidth+1 || r.top<0 || r.bottom>innerHeight+1;}).map(el=>el.id||el.dataset.mode);
    return {viewport:[innerWidth,innerHeight],areas,clipped,documentOverflow:document.documentElement.scrollWidth>innerWidth,
      scroll:document.getElementById('messages').scrollHeight,client:document.getElementById('messages').clientHeight};
  })()`);
  const initial = await measure();
  assert.ok(initial.client >= 250, 'The default answer viewport must have room for substantial body text');
  const sizes = [[576, 648], [420, 420], [320, 480], [760, 500]];
  const results = [];
  try {
    // Pointer-neutral mode locks native edges. Temporarily unlock only this
    // smoke fixture so X11 also accepts programmatic viewport-size changes.
    win.setResizable(true);
    await js(`document.querySelector('#current-project option:checked').textContent='分布式交易与风控平台';
      document.getElementById('answer-target-text').textContent='请解释这个项目的缓存一致性设计和失败重试机制，说明技术选型与实际取舍。'.repeat(5);
      document.getElementById('answer-next-target').textContent='下次：数据库发生故障时如何恢复？'.repeat(4);
      document.getElementById('answer-execution-profile').textContent='标准 / 深度模型 · qwen-flash-2026 · 思考已开启';
      document.getElementById('answer-timing').textContent='准备 18ms · 模型首字 2.80s';
      document.getElementById('input').value=${JSON.stringify('保留多行输入的阅读空间\n发送和快捷操作必须始终可见')};
      document.getElementById('input').dispatchEvent(new Event('input'));`);
    for (const [width, height] of sizes) {
      win.setSize(Math.round(width * zoom), Math.round(height * zoom));
      await until(async () => Math.abs((await js('innerWidth')) - width) <= 1, 'resized renderer ' + width);
      // Measure after resize/textarea reflow, including the narrow action wrap.
      await js("document.getElementById('input').dispatchEvent(new Event('input'));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const layout = await measure(), a = layout.areas;
      assert.deepEqual(layout.clipped, [], 'All controls fit at ' + width + 'x' + height);
      assert.equal(layout.documentOverflow, false, 'No document scrollbar at ' + width);
      assert.ok(a['answer-target-panel'].bottom <= a.messages.top + 1, 'Header cannot overlap the answer');
      assert.ok(a.messages.bottom <= a['action-row'].top + 1, 'Answer cannot overlap actions');
      assert.ok(a['action-row'].bottom <= a.composer.top + 1, 'Actions cannot overlap the composer');
      assert.ok(a.composer.bottom <= height + 1 && a['send-btn'].bottom <= a.composer.bottom, 'Composer remains inside the viewport');
      assert.ok(layout.client >= 24 && layout.scroll > layout.client, 'Long answers scroll inside their own viewport');
      await js("document.getElementById('messages').scrollTop=document.getElementById('messages').scrollHeight");
      assert.ok(await js("document.getElementById('messages').scrollTop>0"), 'The answer can scroll to older content');
      const afterScroll = await measure();
      assert.deepEqual(afterScroll.areas.composer, a.composer, 'Scrolling must not move the input area');
      assert.ok(await js("document.getElementById('answer-target-text').scrollHeight>document.getElementById('answer-target-text').clientHeight"),
        'Very long questions remain readable by scrolling rather than covering the answer');
      results.push({ viewport: layout.viewport, header: a['answer-target-panel'].height, answer: layout.client });
      if (screenshot && width === 320) await screenshot('narrow');
    }
  } finally {
    win.setBounds(bounds);
    win.setResizable(resizable);
    await js(`(() => {
      const saved=${JSON.stringify(saved)};
      ${JSON.stringify(ids)}.forEach((id,i)=>{document.getElementById(id).textContent=saved.text[i];});
      document.querySelector('#current-project option:checked').textContent=saved.project;
      document.getElementById('input').value=saved.input;
      document.getElementById('input').dispatchEvent(new Event('input'));
      document.getElementById('messages').scrollTop=0;
    })()`);
    await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  if (screenshot) await screenshot('answer');
  return { initialAnswer: initial.client, responsive: results, stableComposer: true, internalAnswerScroll: true };
};
