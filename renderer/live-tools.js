'use strict';
(() => {
  const $ = id => document.getElementById(id), cue = window.cue;
  let state, preview, editingId, prompt = '', settings, returning, screenType = null;
  const reasons={'no-match':'没有找到对应问法或条件不同','disabled-or-evidence-only':'条目已停用或仅作为生成资料','ambiguous-project':'请先明确本题所属项目','excluded-intent':'当前问法属于排除范围','incomplete-coverage':'当前条件未完整匹配','insufficient-coverage-or-margin':'匹配不够明确，可补充等价问法','conflicting-answers':'相同问题存在不同答案或版本'};
  const status = text => { $('qa-status').textContent = text; };
  const safe = fn => async () => { try { await fn(); } catch(e) { status(e.message); } };
  async function refresh() {
    state = await cue.qaState(); settings = await cue.settingsGet(); render();
    $('live-candidate-speech').checked = !!settings.liveContextPolicy?.includeCandidateSpeech;
    $('qa-detailed').checked = !!settings.qaAnswerDetailed;
    $('screen-vision').checked = !!settings.providerOptions?.[settings.provider]?.vision;
    for (const b of document.querySelectorAll('[data-history-window]')) b.setAttribute('aria-pressed', String(+b.dataset.historyWindow === (settings.liveContextPolicy?.historyWindowTurns ?? 2)));
  }
  function render() {
    const query = $('qa-search').value.toLowerCase(); $('qa-items').replaceChildren();
    for (const item of (state?.library.items || []).filter(i => [i.question,i.projectId,i.topic,...i.aliases].join(' ').toLowerCase().includes(query)).slice(0, 100)) {
      const row = document.createElement('div'); row.className = 'qa-row';
      const label = document.createElement('div'); label.textContent = `${item.projectId} · ${item.question} · ${[...item.answerShort].length} 字 · ${item.enabled?'启用':'停用'}`; row.append(label);
      const action = (text, fn) => { const b = document.createElement('button'); b.type='button'; b.textContent=text; b.onclick=safe(fn); row.append(b); };
      action('编辑', () => { editingId=item.id; $('qa-editor').value=JSON.stringify(item,null,2); $('qa-editor').closest('details').open=true; });
      action(item.enabled?'停用':'启用', async()=>{await cue.qaEdit({cardId:item.id,enabled:!item.enabled,baseGeneration:state.generation});await refresh();});
      action('删除',async()=>{await cue.qaEdit({cardId:item.id,remove:true,baseGeneration:state.generation});await refresh();});
      $('qa-items').append(row);
    }
  }
  function showPreview(result) {
    if(result.canceled)return;
    preview=result; returning=document.activeElement;
    $('qa-preview-details').textContent=JSON.stringify({条目:result.qaSummary,变更:result.changes?.map(c=>({id:c.id,kind:c.kind})),冲突:result.conflicts,警告:result.warnings},null,2);
    $('qa-confirm').disabled=!!(result.conflicts?.length||result.packConflicts?.length);
    $('qa-preview').hidden=false; $('qa-preview').querySelector('section').focus();
  }
  function close() { $('qa-preview').hidden=true;preview=null;returning?.focus(); }
  $('qa-import').onclick=safe(async()=>showPreview(await cue.qaPrepare()));
  $('qa-preview-text').onclick=safe(async()=>showPreview(await cue.qaPrepare({text:$('qa-editor').value})));
  $('qa-confirm').onclick=safe(async()=>{if(!preview)return;await cue.qaCommit({token:preview.token,baseGeneration:preview.baseGeneration});close();await refresh();status('问答已发布，新版本已生效。');});
  $('qa-cancel').onclick=close;
  $('qa-preview').onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const focusable=[...$('qa-preview').querySelectorAll('button:not(:disabled)')];if(e.shiftKey&&document.activeElement===focusable[0]){e.preventDefault();focusable.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===focusable.at(-1)){e.preventDefault();focusable[0].focus();}}};
  $('qa-export').onclick=safe(async()=>{await cue.qaExport();status('导出操作已完成。');});
  $('qa-refresh').onclick=safe(refresh); $('qa-search').oninput=render;
  $('qa-try').onclick=safe(async()=>{const r=await cue.qaTry({question:$('qa-search').value,projectId:$('qa-project').value,detailed:$('qa-detailed').checked});status((r.direct?'问答库命中':'将回退模型：'+(reasons[r.reason]||'需要结合完整问题生成'))+'\n'+(r.answer||'')+'\n匹配分值（非概率）：'+r.score);});
  $('qa-save-item').onclick=safe(async()=>{if(!editingId)throw new Error('先选择条目编辑');await cue.qaEdit({cardId:editingId,item:JSON.parse($('qa-editor').value),baseGeneration:state.generation});await refresh();status('条目已保存。');});
  $('live-candidate-speech').onchange=safe(async()=>{await cue.settingsSet({liveContextPolicy:{includeCandidateSpeech:$('live-candidate-speech').checked}});await refresh();});
  $('qa-detailed').onchange=safe(async()=>{await cue.settingsSet({qaAnswerDetailed:$('qa-detailed').checked});});
  $('screen-vision').onchange=safe(async()=>{settings=await cue.settingsGet();await cue.settingsSet({providerOptions:{[settings.provider]:{vision:$('screen-vision').checked}}});});
  for(const b of document.querySelectorAll('[data-history-window]'))b.onclick=safe(async()=>{await cue.settingsSet({liveContextPolicy:{historyWindowTurns:+b.dataset.historyWindow}});await refresh();});
  for(const b of document.querySelectorAll('[data-speech-mode]'))b.onclick=safe(async()=>{await cue.settingsSet({speechInputMode:b.dataset.speechMode});status('音频角色模式已设置。单麦克风下请在对话记录中手动指定面试官片段。');});
  for(const b of document.querySelectorAll('[data-screen-mode]'))b.onclick=safe(async()=>{await cue.screenMode({mode:b.dataset.screenMode});$('screen-mode-label').textContent=b.textContent;});
  $('screen-attach').onclick=safe(async()=>{const r=await cue.screenAttachment({text:$('screen-task-attachment').value});$('screen-task-summary').textContent=`已保存本题附件，${r.characters} 字；来源为用户输入。`;});
  $('screen-accept').onclick=safe(async()=>{await cue.screenAccept({label:$('screen-accepted-label').value});$('screen-task-summary').textContent='已记录你的验收确认；CUE 未自动运行测试。';});
  $('screen-continue').onclick=safe(async()=>{await cue.screenMode({continue:true});$('screen-task-summary').textContent='下次截图继续当前任务；只保留已确认状态。';});
  $('screen-end').onclick=safe(async()=>{await cue.screenMode({end:true});$('screen-task-attachment').value='';$('screen-accepted-label').value='';prompt='';$('screen-copy-prompt').hidden=true;$('screen-task-summary').textContent='本题已结束';$('screen-mode-label').textContent='自动识别';});
  cue.on('qa:generated',r=>{$('qa-hit-summary').hidden=false;$('qa-hit-summary').textContent='基于问答资料生成 · '+r.cardIds.join(' / ');});
  cue.on('qa:hit',r=>{$('qa-hit-summary').hidden=false;$('qa-hit-summary').textContent=`问答库命中 · ${r.projectId} · ${r.version||'未指定版本'} · ${r.standardQuestion}`;});
  cue.on('llm:start',()=>{$('qa-hit-summary').hidden=true;prompt='';screenType=null;$('screen-copy-prompt').hidden=true;});
  cue.on('screen:task',r=>{screenType=r.type;$('screen-mode-label').textContent=r.type;$('screen-task-summary').textContent=[r.title,r.observed?.length?'已看到：'+r.observed.join('；'):'',r.inferred?.length?'推断：'+r.inferred.join('；'):'',r.missing?.length?'尚缺：'+r.missing.join('；'):''].filter(Boolean).join('\n');});
  let answer=''; cue.on('llm:start',()=>{answer='';});
  cue.on('llm:token',r=>{answer+=r.text||'';const match=screenType==='vibe-coding'&&/```text\s*\n([\s\S]+?)```/.exec(answer);if(match){prompt=match[1];$('screen-copy-prompt').hidden=false;}});
  cue.on('llm:done',()=>{
    if(screenType!=='vibe-coding')return;
    const content=document.querySelector('.response-group:first-child .ai-text');
    for(const heading of [...(content?.querySelectorAll('h2,h3')||[])]) {
      if(!/分步推进|演示|第[二三四五六]|步骤[2-6]|阶段[2-6]/.test(heading.textContent))continue;
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=heading.textContent;details.append(summary);heading.replaceWith(details);
      while(details.nextSibling&&!/H[23]/.test(details.nextSibling.nodeName))details.append(details.nextSibling);
    }
  });
  $('screen-copy-prompt').onclick=safe(async()=>{await cue.copyText(prompt);$('screen-task-summary').textContent='当前提示词已复制';});
  cue.on('materials:changed',()=>refresh().catch(e=>status(e.message)));
  refresh().catch(e=>status(e.message));
})();
