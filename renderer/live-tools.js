'use strict';
(() => {
  const $ = id => document.getElementById(id), cue = window.cue;
  let state, preview, editingId, prompt = '', settings, returning, screenType = null, qaBusy=false, qaLimit=100, modalInert=[], qaSelect, settingsEpoch=0;
  new MutationObserver(()=>{if($('settings-scrim').classList.contains('hidden'))settingsEpoch++;}).observe($('settings-scrim'),{attributes:true,attributeFilter:['class']});
  const reasons={'no-match':'没有找到对应问法或条件不同','disabled-or-evidence-only':'条目已停用或仅作为生成资料','ambiguous-project':'请先明确本题所属项目','excluded-intent':'当前问法属于排除范围','incomplete-coverage':'当前条件未完整匹配','insufficient-coverage-or-margin':'匹配不够明确，可补充等价问法','conflicting-answers':'相同问题存在不同答案或版本'};
  const status = text => { $('qa-status').textContent = text; };
  const safe = fn => async () => { try { await fn(); } catch(e) { status(e.message); } };
  const previewCounts = result => { const ids=new Set((result.qaSummary||[]).map(item=>item.id)), changes=(result.changes||[]).filter(c=>ids.has(c.id));
    const added=changes.filter(c=>c.kind==='add').length,updated=changes.filter(c=>c.kind==='update').length;
    return {added,updated,kept:Math.max(0,ids.size-added-updated)}; };
  async function refresh() {
    state = await cue.qaState(); settings = await cue.settingsGet(); render();
    $('live-candidate-speech').checked = !!settings.liveContextPolicy?.includeCandidateSpeech;
    $('qa-detailed').checked = !!settings.qaAnswerDetailed;
    $('screen-vision').checked = !!settings.providerOptions?.[settings.provider]?.vision;
    for (const b of document.querySelectorAll('[data-history-window]')) b.setAttribute('aria-pressed', String(+b.dataset.historyWindow === (settings.liveContextPolicy?.historyWindowTurns ?? 2)));
    for (const b of document.querySelectorAll('[data-speech-mode]')) b.setAttribute('aria-pressed',String(b.dataset.speechMode === settings.speechInputMode));
    const select=$('qa-project'), selected=select.value;
    select.replaceChildren(new Option('自动选择',''),...(state.library.projects||[]).map(p=>new Option(p.name,p.id)));
    select.value=[...select.options].some(o=>o.value===selected)?selected:'';
    if(!qaSelect){qaSelect=window.CueCaptureSafeSelect.install(select);$('settings-scrim').append($('qa-project-options'));}qaSelect.sync();
  }
  function render() {
    const query = $('qa-search').value.toLowerCase(); $('qa-items').replaceChildren();
    const all=(state?.library.items || []).filter(i => [i.question,i.projectId,i.topic,...i.aliases].join(' ').toLowerCase().includes(query));
    $('qa-count').textContent=`显示 ${Math.min(qaLimit,all.length)} / ${all.length} 条`;
    $('qa-more').hidden=qaLimit>=all.length;
    for (const item of all.slice(0, qaLimit)) {
      const row = document.createElement('div'); row.className = 'qa-row';
      const label = document.createElement('div'); label.textContent = `${item.projectId} · ${item.question} · ${[...item.answerShort].length} 字 · ${item.enabled?'启用':'停用'}`; row.append(label);
      const details=document.createElement('details'),summary=document.createElement('summary'),answer=document.createElement('pre');summary.textContent='查看短答和详答';answer.textContent='短答：\n'+item.answerShort+(item.answerDetailed?'\n\n详答：\n'+item.answerDetailed:'');details.append(summary,answer);row.append(details);
      const action = (text, fn) => { const b = document.createElement('button'); b.type='button'; b.textContent=text; b.onclick=safe(fn); row.append(b); };
      action('编辑', () => { editingId=item.id; $('qa-editor').value=JSON.stringify(item,null,2); $('qa-editor').closest('details').open=true; });
      action(item.enabled?'停用':'启用', async()=>{await cue.qaEdit({cardId:item.id,enabled:!item.enabled,baseGeneration:state.generation});await refresh();});
      action('删除',async()=>{if(!row.querySelector('.qa-delete-confirm')){const confirm=document.createElement('button');confirm.className='qa-delete-confirm';confirm.textContent='确认删除';confirm.onclick=safe(async()=>{await cue.qaEdit({cardId:item.id,remove:true,baseGeneration:state.generation});await refresh();status('已删除该条目。');});row.append(confirm);return;}});
      $('qa-items').append(row);
    }
  }
  function showPreview(result) {
    if(result.canceled)return;
    preview=result; returning=document.activeElement;
    const body=$('qa-preview-details');body.replaceChildren();
    const counts=previewCounts(result);
    const summary=document.createElement('p');summary.textContent=`${result.fileName||'问答文件'} · ${(result.qaProjects||[]).map(p=>p.name).join('、')||'项目资料'} · ${result.qaSummary?.length||0} 条问答。新增 ${counts.added}，更新 ${counts.updated}，保留 ${counts.kept}；合并导入不删除其他项目。`;body.append(summary);
    const problems=[...(result.conflicts||[]),...(result.packConflicts||[]),...(result.warnings||[])];
    if(problems.length){const p=document.createElement('p');p.className='qa-warning';p.textContent='冲突或提示：'+problems.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('；');body.append(p);}
    const search=document.createElement('input');search.type='search';search.placeholder='搜索预览问题';search.setAttribute('aria-label','搜索预览问题');body.append(search);
    const list=document.createElement('div');list.className='qa-preview-list';
    for(const item of result.qaSummary||[]){const row=document.createElement('details'),label=document.createElement('summary'),answer=document.createElement('pre'),change=(result.changes||[]).find(c=>c.id===item.id);
      label.textContent=`${item.question} · ${item.shortChars} 字${item.warning?' · '+item.warning:''}`;
      answer.textContent='条目 ID：'+item.id+'\n项目：'+item.projectId+'\n\n'+(change?.old?'原短答：\n'+(change.old.answerShort||change.old.text||'')+'\n\n':'')+'新短答：\n'+(item.answerShort||'')+(item.answerDetailed?'\n\n新详答：\n'+item.answerDetailed:'');row.append(label,answer);list.append(row);}body.append(list);
    search.oninput=()=>{const q=search.value.trim().toLowerCase();for(const row of list.children)row.hidden=!row.textContent.toLowerCase().includes(q);};
    $('qa-confirm').disabled=!!(result.conflicts?.length||result.packConflicts?.length);
    $('qa-preview-error').hidden=true; $('qa-preview-error').textContent='';
    modalInert=[...document.body.children].filter(n=>n.id!=='qa-preview'&&n.tagName!=='SCRIPT').map(n=>[n,n.inert]);for(const [n] of modalInert)n.inert=true;
    $('qa-preview').hidden=false; $('qa-preview').querySelector('section').focus();
  }
  function close() { if(qaBusy)return; const token=preview?.token; $('qa-preview').hidden=true;preview=null;for(const [n,v] of modalInert)n.inert=v;modalInert=[];returning?.focus();if(token)cue.qaDiscard(token).catch(()=>{}); }
  async function prepare(input){if(qaBusy)return;qaBusy=true;const epoch=settingsEpoch;for(const id of ['qa-import','qa-preview-text'])$(id).disabled=true;status('正在读取并校验…');try{const result=await cue.qaPrepare(input);if(epoch!==settingsEpoch||$('settings-scrim').classList.contains('hidden')){if(result?.token)cue.qaDiscard(result.token).catch(()=>{});return;}if(result.canceled){status('已取消选择。');return;}showPreview(result);status('预览完成，等待确认。');}catch(e){if(epoch===settingsEpoch)status('无法预览：'+e.message);}finally{qaBusy=false;for(const id of ['qa-import','qa-preview-text'])$(id).disabled=false;}}
  $('qa-import').onclick=()=>prepare();
  $('qa-preview-text').onclick=()=>prepare({text:$('qa-editor').value});
  $('qa-confirm').onclick=async()=>{if(!preview||qaBusy)return;qaBusy=true;$('qa-confirm').disabled=true;$('qa-cancel').disabled=true;$('qa-close').disabled=true;$('qa-confirm').textContent='正在应用…';$('qa-preview-error').hidden=true;
    let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),15000);});
    try{const outcome=await Promise.race([cue.qaCommit({token:preview.token,baseGeneration:preview.baseGeneration}).then(result=>({result}),error=>({error})),timeout]);
      if(outcome.timeout){$('qa-preview-error').textContent='提交结果尚未确认。请关闭预览并刷新材料状态，再重新预览；不要重复提交。';$('qa-preview-error').hidden=false;preview=null;return;}
      if(outcome.error){$('qa-preview-error').textContent='应用失败：'+outcome.error.message;$('qa-preview-error').hidden=false;return;}
      const counts=previewCounts(preview);qaBusy=false;close();try{await refresh();status(`问答已发布，新版本已生效。新增 ${counts.added}，更新 ${counts.updated}，保留 ${counts.kept}。`);}catch(e){status('已导入，但列表刷新失败；请点击刷新：'+e.message);}
    }finally{clearTimeout(timer);qaBusy=false;$('qa-cancel').disabled=false;$('qa-close').disabled=false;$('qa-confirm').disabled=!preview||!!(preview.conflicts?.length||preview.packConflicts?.length);$('qa-confirm').textContent='确认导入';}};
  $('qa-cancel').onclick=close;$('qa-close').onclick=close;
  $('qa-preview').onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}if(e.key==='Tab'){const focusable=[...$('qa-preview').querySelectorAll('button:not(:disabled)')];if(!focusable.length)return;if(e.shiftKey&&(document.activeElement===focusable[0]||document.activeElement===$('qa-preview').querySelector('section'))){e.preventDefault();focusable.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===focusable.at(-1)){e.preventDefault();focusable[0].focus();}}};
  $('qa-export').onclick=safe(async()=>{const r=await cue.qaExport();status(r?.canceled?'已取消导出。':'导出操作已完成。');});
  $('qa-refresh').onclick=safe(refresh); $('qa-search').oninput=()=>{qaLimit=100;render();};$('qa-more').onclick=()=>{qaLimit+=100;render();};
  $('qa-try').onclick=safe(async()=>{const r=await cue.qaTry({question:$('qa-question').value,projectId:$('qa-project').value,detailed:$('qa-detailed').checked});status((r.direct?'问答库命中':'没有明确直达匹配：'+(reasons[r.reason]||'需要结合完整问题生成'))+'\n'+(r.answer||'')+'\n匹配分值（非概率）：'+r.score);});
  $('qa-save-item').onclick=safe(async()=>{if(!editingId)throw new Error('先选择条目编辑');await cue.qaEdit({cardId:editingId,item:JSON.parse($('qa-editor').value),baseGeneration:state.generation});await refresh();status('条目已保存。');});
  $('live-candidate-speech').onchange=async()=>{try{await cue.settingsSet({liveContextPolicy:{includeCandidateSpeech:$('live-candidate-speech').checked}});await refresh();$('live-context-status').textContent='已保存。';}catch(e){$('live-context-status').textContent='保存失败：'+e.message;await refresh().catch(()=>{});}};
  $('qa-detailed').onchange=async()=>{try{await cue.settingsSet({qaAnswerDetailed:$('qa-detailed').checked});status('短答/详答设置已保存。');}catch(e){status('保存失败：'+e.message);await refresh().catch(()=>{});}};
  $('screen-vision').onchange=async()=>{try{settings=await cue.settingsGet();await cue.settingsSet({providerOptions:{[settings.provider]:{vision:$('screen-vision').checked}}});$('screen-vision-status').textContent='已保存。';}catch(e){$('screen-vision-status').textContent='保存失败：'+e.message;await refresh().catch(()=>{});}};
  for(const b of document.querySelectorAll('[data-history-window]'))b.onclick=async()=>{try{await cue.settingsSet({liveContextPolicy:{historyWindowTurns:+b.dataset.historyWindow}});await refresh();$('live-context-status').textContent='已保存。';}catch(e){$('live-context-status').textContent='保存失败：'+e.message;}};
  for(const b of document.querySelectorAll('[data-speech-mode]'))b.onclick=async()=>{try{await cue.settingsSet({speechInputMode:b.dataset.speechMode});await refresh();$('speech-mode-status').textContent='已保存。';}catch(e){$('speech-mode-status').textContent='保存失败：'+e.message;}};
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
