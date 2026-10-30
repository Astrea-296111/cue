'use strict';
const assert=require('node:assert/strict');
module.exports=async({js,until,requests,win,verifyProtected})=>{
  const click=async (selector,twice=false)=>{
    win.show();win.focus();await new Promise(resolve=>setTimeout(resolve,100));
    const box=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    assert.equal(await js(`!!document.elementFromPoint(${box.x},${box.y})?.closest(${JSON.stringify(selector)})`),true,'actual hit target: '+selector);
    const scale=win.webContents.getZoomFactor(),point={x:Math.round(box.x*scale),y:Math.round(box.y*scale)};
    if(process.platform==='win32'){
      const koffi=require('koffi'),user32=koffi.load('user32.dll'),screen=require('electron').screen;
      const setCursor=user32.func('bool SetCursorPos(int32_t,int32_t)'),mouse=user32.func('void mouse_event(uint32_t,uint32_t,uint32_t,uint32_t,uintptr_t)');
      const bounds=win.getContentBounds(),absolute=screen.dipToScreenPoint({x:bounds.x+point.x,y:bounds.y+point.y});
      assert.equal(setCursor(absolute.x,absolute.y),true);await new Promise(resolve=>setTimeout(resolve,200));
      mouse(0x0002,0,0,0,0);mouse(0x0004,0,0,0,0);if(twice){mouse(0x0002,0,0,0,0);mouse(0x0004,0,0,0,0);}
    }else{
      win.webContents.sendInputEvent({type:'mouseMove',...point});await new Promise(resolve=>setTimeout(resolve,100));
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      if(twice){win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});}
    }
  };
  await js("document.querySelector('[data-tab=transcription]').click()");
  await until(()=>js("!document.querySelector('[data-pane=transcription]').classList.contains('hidden')"),'transcription settings opened');
  await js("document.querySelector('[data-speech-mode=single-microphone]').click()");
  await until(()=>js("document.querySelector('[data-speech-mode=single-microphone]').getAttribute('aria-pressed')==='true'"),'speech mode saved');
  await js("document.querySelector('[data-tab=style]').click()");
  await until(()=>js("!document.querySelector('[data-pane=style]').classList.contains('hidden')"),'style settings opened');
  await js("document.querySelector('[data-history-window=\"0\"]').click()");
  try{await until(()=>js("document.querySelector('[data-history-window=\"0\"]').getAttribute('aria-pressed')==='true'"),'short context selection');}catch(e){console.error('QA_SETTINGS_DIAGNOSTIC',JSON.stringify(await js("({status:document.getElementById('qa-status').textContent,inert:document.getElementById('app').inert,pressed:document.querySelector('[data-history-window=\"0\"]').getAttribute('aria-pressed')})")));throw e;}
  assert.equal((await js('cue.settingsGet()')).liveContextPolicy.includeCandidateSpeech,false);
  await js("document.querySelector('[data-history-window=\"1\"]').click()");await until(()=>js("document.querySelector('[data-history-window=\"1\"]').getAttribute('aria-pressed')==='true'"),'history saved');
  await js("document.getElementById('live-candidate-speech').click()");await until(async()=>(await js('cue.settingsGet()')).liveContextPolicy.includeCandidateSpeech,'candidate preference saved');
  await js("document.querySelector('[data-tab=profile]').click()");
  await until(()=>js("!document.querySelector('[data-pane=profile]').classList.contains('hidden')"),'profile settings opened');
  const retained=await js('cue.settingsGet()');assert.equal(retained.liveContextPolicy.historyWindowTurns,1);assert.equal(retained.liveContextPolicy.includeCandidateSpeech,true);assert.equal(retained.speechInputMode,'single-microphone');
  await js("cue.settingsSet({speechInputMode:'dual-channel',liveContextPolicy:{historyWindowTurns:2,includeCandidateSpeech:false}})");
  const library={format:'cue-qa/v1',projects:[{id:'ui-maple',name:'UI 枫叶平台',aliases:[]}],items:[{id:'qa.ui.example',projectId:'ui-maple',question:'如何验证重复提交？',aliases:['重复提交如何验证？'],answerShort:'QA_UI_VERBATIM\n保留第二行。',answerDetailed:'详答第一段。\n\n第二段。',sourceType:'proposed_design',enabled:true}]};
  for(let i=0;i<101;i++)library.items.push({id:`qa.ui.extra${i}`,projectId:'ui-maple',question:`合成问题 ${i} 如何处理？`,answerShort:`合成答案 ${i}。`,sourceType:'proposed_design'});
  await js(`document.getElementById('qa-editor').value=${JSON.stringify(JSON.stringify(library))};document.getElementById('qa-preview-text').click()`);
  await until(()=>js("!document.getElementById('qa-preview').hidden"),'QA preview visible');
  await verifyProtected('#qa-preview');
  if(process.env.CUE_UI_QA_SCREENSHOT){await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await new Promise(resolve=>setTimeout(resolve,300));const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.dirname(process.env.CUE_UI_QA_SCREENSHOT),{recursive:true});fs.writeFileSync(process.env.CUE_UI_QA_SCREENSHOT,(await win.webContents.capturePage()).toPNG());}
  assert.ok((await js("document.getElementById('qa-preview-details').textContent")).includes('qa.ui.example'));
  const color=await js("getComputedStyle(document.getElementById('qa-preview-title')).color");assert.notEqual(color,'rgb(0, 0, 0)');
  const contrast=await js(`(()=>{const read=id=>getComputedStyle(document.getElementById(id));const rgb=s=>s.match(/[0-9]+(?:[.][0-9]+)?/g).slice(0,3).map(Number);const lum=a=>a.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const fg=lum(rgb(read('qa-preview-title').color)),bg=lum(rgb(getComputedStyle(document.querySelector('.qa-dialog')).backgroundColor));return (fg+.05)/(bg+.05)})()`);
  assert.ok(contrast>=4.5,'modal text contrast');
  const originalZoom=win.webContents.getZoomFactor();
  for(const zoom of [1,1.25,1.5,2]){
    win.webContents.setZoomFactor(zoom);await new Promise(resolve=>setTimeout(resolve,100));
    const visible=await js("['qa-cancel','qa-confirm'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>0&&r.height>0})");
    assert.equal(visible,true,`modal actions fit at Electron zoom ${zoom}`);
  }
  win.webContents.setZoomFactor(originalZoom);await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await js("document.querySelectorAll('#settings-scrim select:not([hidden])').length"),0,'settings selects use protected DOM menus');
  if(process.platform==='win32')assert.equal(require('../../src/windows-capture-protection').createWindowsCaptureProtection().inspect(win),0x11,'actual dialog window capture affinity');
  await js("window.__qaClicks=[];for(const type of ['mousedown','mouseup','click'])document.addEventListener(type,e=>window.__qaClicks.push({type,target:e.target.id,tag:e.target.tagName,x:e.clientX,y:e.clientY}),true)");
  const overlay=process.platform==='win32'?require('../../src/overlay-interaction'):null;
  if(overlay)overlay.toggleForcedPassthrough();
  try{await click('#qa-cancel');await until(()=>js("document.getElementById('qa-preview').hidden"),'QA cancel by pointer');}catch(e){console.error('QA_POINTER_DIAGNOSTIC',JSON.stringify({events:await js('window.__qaClicks'),focused:win.isFocused(),visible:win.isVisible()}));throw e;}finally{if(overlay)overlay.toggleForcedPassthrough();}
  assert.equal(await js("!document.getElementById('settings-scrim').classList.contains('hidden')"),true);
  for(let i=0;i<20;i++){
    await js("document.getElementById('qa-preview-text').click()");await until(()=>js("!document.getElementById('qa-preview').hidden"),'repeated preview open');
    await js("document.getElementById('qa-cancel').click()");await until(()=>js("document.getElementById('qa-preview').hidden"),'repeated preview cancel');
  }
  await js("document.getElementById('qa-preview-text').click()");await until(()=>js("!document.getElementById('qa-preview').hidden"),'QA reopened');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await until(()=>js("document.getElementById('qa-preview').hidden"),'Escape closes only preview');
  assert.equal(await js("!document.getElementById('settings-scrim').classList.contains('hidden')"),true);
  await js("document.getElementById('qa-preview-text').click()");await until(()=>js("!document.getElementById('qa-preview').hidden"),'QA reopened for commit');
  await js('cueTest.setQaFailure(true)');await click('#qa-confirm');await until(()=>js("document.getElementById('qa-preview-error').textContent.includes('合成提交故障')"),'visible commit error');
  assert.equal(await js("!document.getElementById('qa-preview').hidden"),true);
  await js('cueTest.setQaFailure(false)');const beforeCommit=await js('cueTest.qaCalls()');
  await click('#qa-confirm',true);
  await until(()=>js("document.getElementById('qa-status').textContent.includes('新版本已生效')"),'QA import publication');
  assert.equal(await js('cueTest.qaCalls()'),beforeCommit+1);
  assert.equal(await js("!document.getElementById('qa-more').hidden"),true,'large list exposes remaining items');
  await js("document.getElementById('qa-more').click()");assert.ok(await js("document.querySelectorAll('#qa-items .qa-row').length>=102"));
  await js("document.getElementById('qa-export').click()");await until(()=>js("document.getElementById('qa-status').textContent.includes('已取消导出')"),'canceled export');
  await click('#qa-project-trigger');await until(()=>js("!document.getElementById('qa-project-options').hidden"),'protected project choices');
  const projectIndex=await js("[...document.getElementById('qa-project').options].findIndex(o=>o.value==='ui-maple')");assert.ok(projectIndex>0);
  await click(`#qa-project-options [data-index="${projectIndex}"]`);await until(()=>js("document.getElementById('qa-project').value==='ui-maple'"),'protected project selection');
  await js("document.getElementById('qa-question').value='重复提交如何验证？';document.getElementById('qa-try').click()");
  assert.ok(await js("document.getElementById('qa-question').getBoundingClientRect().height>=28"),'question input does not collapse');
  await until(()=>js("document.getElementById('qa-status').textContent.includes('仅作为生成资料')"),'QA try evidence only');
  const before=requests.length;
  await js("cue.ask({mode:'say',text:'UI 枫叶平台如何验证重复提交？'})");
  await until(()=>js("document.querySelector('.response-group:first-child .ai-text')?.textContent.includes('先确认项目事实')"),'model answer visible');
  assert.equal(requests.length,before+1);
  assert.equal(await js("document.querySelector('.response-group:first-child .answer-bound-row')"),null,'no duplicate question in answer');
  await js("document.querySelector('[data-screen-mode=vibe-coding]').click()");
  await until(()=>js("document.getElementById('screen-mode-label').textContent==='Vibe Coding'"),'screen mode override');
  await js("document.getElementById('screen-end').click()");
  await until(()=>js("document.getElementById('screen-mode-label').textContent==='自动识别'"),'screen mode reset');
  await js("cue.dialogueEvent({eventId:'ui-buffer-1',utteranceKey:'ui-buffer-1',utteranceOrder:1,sourceId:'ui-buffer',channel:'them',speaker:'interviewer',text:'如何处理重复提交？',isFinal:true})");
  await js("cue.dialogueEvent({eventId:'ui-buffer-2',utteranceKey:'ui-buffer-2',utteranceOrder:2,sourceId:'ui-buffer',channel:'them',speaker:'interviewer',text:'另外如何处理失败重试？',isFinal:true})");
  await until(()=>js("document.querySelectorAll('#answer-coverage-list button').length===2"),'question coverage controls');
  await js("document.getElementById('answer-coverage').open=true;document.querySelector('#answer-coverage-list button').click()");
  await until(()=>js("document.querySelector('#answer-coverage-list button').textContent==='恢复待答'"),'answered fragment marked');
  assert.doesNotMatch((await js('cue.questionTarget()')).snapshot.text,/重复提交/);
  await js("document.querySelector('#answer-coverage-list button').click()");
  await until(async()=>/重复提交/.test((await js('cue.questionTarget()')).snapshot.text),'answered fragment restored');
  await js('cue.clearTranscript()');
  for(let i=0;i<7;i++) {
    const text=`${i ? '另外' : ''}如何处理任务${i}？${i===6?'还要考虑失败恢复与资源限制。'.repeat(30):''}`;
    await js(`cue.dialogueEvent({eventId:'ui-recent-${i}',utteranceKey:'ui-recent-${i}',utteranceOrder:${i+1},sourceId:'ui-recent',channel:'them',speaker:'interviewer',text:${JSON.stringify(text)},isFinal:true})`);
  }
  await until(()=>js("document.querySelectorAll('#answer-coverage-list button').length===5"),'only five recent controls');
  assert.match((await js('cue.questionTarget()')).snapshot.text,/任务0/,'hidden old fragments are not deleted');
  assert.doesNotMatch(await js("document.getElementById('answer-coverage-list').textContent"),/任务0/);
  await js("document.getElementById('answer-target-toggle').click()");
  assert.equal(await js("document.getElementById('answer-target-toggle').getAttribute('aria-expanded')"),'true');
  assert.equal(await js("getComputedStyle(document.getElementById('answer-target-text')).whiteSpace"),'pre-wrap');
  assert.equal(await js("getComputedStyle(document.getElementById('answer-target-text')).overflowX"),'visible');
  assert.equal(await js("getComputedStyle(document.getElementById('answer-target-text')).maxHeight"),'none');
  assert.equal(await js("document.getElementById('answer-target-text').scrollHeight<=document.getElementById('answer-target-text').clientHeight"),true,'expanded question is not internally clipped');
  const answerBefore=await js("document.querySelector('.response-group:first-child .ai-text').textContent");
  await js("document.getElementById('input').value='保留手动草稿';document.getElementById('answer-target-clear').click()");
  await until(async()=>!(await js('cue.questionTarget()')).snapshot.text,'clear current question');
  assert.equal(await js("document.getElementById('input').value"),'保留手动草稿');
  assert.equal(await js("document.querySelector('.response-group:first-child .ai-text').textContent"),answerBefore);
  assert.equal(await js("document.getElementById('answer-target-text').textContent"),'等待新问题');
  assert.equal(await js("document.getElementById('answer-target-clear').getAttribute('aria-label')"),'清空当前待回答问题');
  await js('cue.clearTranscript()');
  return {qaPreview:true,qaTry:true,qaDirectUI:true,modelCallsForDirect:0,shortContext:true,screenModeControls:true,answeredFragment:true,pointerInput:process.platform==='win32'?'native-windows':'electron-coordinate'};
};
