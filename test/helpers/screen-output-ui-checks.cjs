'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({js,until,clipboard,win,screenshot})=>{
  await js("cue.settingsSet({providerOptions:{custom:{vision:true}}})");
  await js("cue.ask({mode:'assist',text:'与 AI 协作实现应用'})");
  await until(()=>js("!document.getElementById('screen-copy-prompt').hidden"),'copyable Vibe prompt visible');
  assert.equal(await js("document.getElementById('screen-copy-prompt').closest('details')===null"),true,'copy is available without opening mode settings');
  await js("document.getElementById('screen-copy-prompt').click()");
  await until(()=>clipboard.readText().includes('先读取当前题面'),'actual clipboard receives the prompt');
  assert.equal(clipboard.readText().replace(/\r\n/g,'\n'),await js("document.querySelector('.response-group:first-child .ai-text pre code').textContent"));
  await until(()=>js("!document.getElementById('send-btn').classList.contains('busy')"),'screen output complete');
  assert.equal(await js("document.querySelector('.response-group:first-child .ai-text').textContent.length>260"),true);
  assert.ok((await js("document.querySelector('.response-group:first-child .answer-bound-question').textContent")).includes('合成应用任务'));
  assert.equal(await js("document.querySelector('.response-group:first-child .ai-text details')!==null"),true,'later stages collapse after completion');
  if(screenshot){
    await js("new Promise(resolve=>{document.getElementById('messages').scrollTo({top:0,behavior:'instant'});requestAnimationFrame(()=>requestAnimationFrame(resolve));})");
    fs.mkdirSync(path.dirname(screenshot),{recursive:true});fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
  }
  return {routeTitle:true,copyVisible:true,clipboardExact:true,fullGuidanceBeyond260:true,laterStagesCollapse:true,network:'mock SDK'};
};
