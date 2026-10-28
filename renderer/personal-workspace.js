'use strict';

// The existing protected renderer owns all of these controls. Imported text is
// inserted as text, never markup, and edits target a frozen session/revision.
(() => {
  const $ = id => document.getElementById(id);
  const bridge = window.cue;
  let preview = null, busy = false, returnFocus = null, refreshSequence = 0;
  let speechChoosers = [];
  const jobChooser = window.CueCaptureSafeSelect.install($('personal-job'));
  document.getElementById('settings-scrim').append(document.getElementById('personal-job-options'));
  document.body.append($('personal-job-options'));
  const status = message => { $('personal-status').textContent = message; };
  const labels = { ai_supply_chain: 'AI 算法 · 供应链', java_security: 'Java 后端 · 基础安全' };
  function renderState(value = {}) {
    const profiles = Array.isArray(value.jobProfiles) ? value.jobProfiles : Object.values(value.jobProfiles || {});
    const select = $('personal-job');
    select.replaceChildren();
    if (!profiles.length) select.add(new Option('尚未导入岗位', ''));
    for (const job of profiles) select.add(new Option(job.label || job.name || job.title || labels[job.id] || job.id, job.id));
    select.value = value.activeJobProfileId || value.currentJobProfileId || '';
    select.disabled = busy || !profiles.length;
    jobChooser.sync();
    const projects = (value.projects || []).filter(p => p.kind !== 'knowledge').map(p => p.id).join(' / ');
    status(`${projects || '未导入个人资料'} · ${value.cardCount ?? value.counts?.facts ?? 0} 张卡 · ${value.sourceCount ?? 0} 个来源 · 版本 ${value.revision ? value.revision.slice(0, 12) : '未设置'}${select.value ? ' · 当前岗位：' + (labels[select.value] || select.value) : ''}`);
  }
  async function refreshState() {
    try { renderState(await bridge.personalState()); }
    catch (error) { status('个人资料状态读取失败：' + error.message); }
  }
  function lock(value) {
    busy = value;
    for (const id of ['personal-import', 'personal-confirm', 'personal-cancel', 'personal-job']) $(id).disabled = value;
  }
  let previewInert=[];
  function closePreview() {
    preview = null; $('personal-preview').hidden = true;
    for(const [node,old] of previewInert)node.inert=old;previewInert=[];
    returnFocus?.focus(); returnFocus = null;
  }
  $('personal-import').addEventListener('click', async () => {
    if (busy) return;
    returnFocus = document.activeElement; lock(true);
    try {
      const result = await bridge.personalPrepare();
      if (result?.canceled) { status('已取消选择。'); return; }
      preview = result;
      window.CueCaptureSafeSelect.close();
      const data = result.summary || result.state || result;
      const jobs = Array.isArray(data.jobProfiles) ? data.jobProfiles.length : Object.keys(data.jobProfiles || {}).length;
      $('personal-preview-summary').textContent = `${data.cardCount ?? data.facts ?? data.counts?.facts ?? result.cardCount ?? '已校验'} 张卡；${jobs} 个岗位；${data.sourceCount ?? result.sourceCount ?? '已校验'} 个来源。${result.alreadyApplied ? '此版本已导入，本机编辑将保留。' : ''}`;
      previewInert=[...document.body.children].filter(node=>node.id!=='personal-preview'&&node.tagName!=='SCRIPT').map(node=>[node,node.inert]);
      for(const [node] of previewInert)node.inert=true;
      $('personal-preview').hidden = false;
      document.querySelector('#personal-preview .personal-dialog').focus();
      status('资料校验完成，等待确认。');
    } catch (error) { status('无法预览个人资料：' + error.message); }
    finally { lock(false); }
  });
  $('personal-cancel').addEventListener('click', () => { if (!busy) closePreview(); });
  $('personal-confirm').addEventListener('click', async () => {
    if (!preview || busy) return;
    lock(true);
    try {
      await bridge.personalCommit({ token: preview.token, baseGeneration: preview.baseGeneration });
      closePreview();
      window.dispatchEvent(new Event('cue:personal-applied'));
      await refreshState();
    } catch (error) { $('personal-preview-summary').textContent = '导入失败：' + error.message; }
    finally { lock(false); }
  });
  $('personal-job').addEventListener('change', async event => {
    if (busy) return;
    lock(true);
    try {
      renderState(await bridge.personalJob(event.target.value));
      window.dispatchEvent(new Event('cue:personal-applied'));
    } catch (error) { status('岗位切换失败：' + error.message); }
    finally { lock(false); }
  });
  $('personal-diagnostics').addEventListener('click', async () => {
    try {
      const result = await bridge.exportDiagnostics();
      status(result?.canceled ? '已取消导出。' : '脱敏诊断已保存到你选择的位置。请检查后再对外分享。');
    } catch (error) { status('诊断导出失败：' + error.message); }
  });
  async function refreshSpeech() {
    if (!$('spoken-review').open) return;
    const sequence = ++refreshSequence;
    try {
      const snapshot = await bridge.dialogueSnapshot();
      if (sequence !== refreshSequence) return;
      const list = $('spoken-events');
      // Do not replace an edit the user is actively typing.
      if (list.contains(document.activeElement)) return;
      for (const chooser of speechChoosers) chooser.destroy();
      speechChoosers = [];
      list.replaceChildren();
      const events = (snapshot.events || []).filter(e => e.isFinal !== false).slice(-12);
      if (!events.length) { list.textContent = '本会话尚无已识别发言。'; return; }
      for (const event of events) {
        const row = document.createElement('div'); row.className = 'spoken-event'; row.dataset.eventId = event.eventId;
        const role = document.createElement('select'); role.id = 'spoken-role-' + sequence + '-' + speechChoosers.length; role.setAttribute('aria-label', '发言角色');
        for (const [value, label] of [['candidate', '我'], ['interviewer', '面试官'], ['unknown', '待确认']]) role.add(new Option(label, value));
        role.value = event.speaker || 'unknown';
        const text = document.createElement('textarea'); text.rows = 2; text.value = event.text || event.normalizedText || event.rawText || ''; text.setAttribute('aria-label', '实际发言文字');
        const save = document.createElement('button'); save.type = 'button'; save.className = 'spoken-save'; save.textContent = '保存纠正';
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            const result = await bridge.dialogueCorrect({ sessionId: snapshot.sessionId, eventId: event.eventId, revision: event.revision + 1, speaker: role.value, text: text.value });
            if(result?.accepted===false)throw new Error('这条发言已变化或不属于当前会话，请刷新后再修改。');
            save.blur(); await refreshSpeech(); status('已纠正真人发言；后续回答按新版本承接。');
          } catch (error) { status('更正失败：' + error.message); }
          finally { save.disabled = false; }
        });
        row.append(role, text, save); list.append(row);
        if(event.rawText&&event.rawText!==event.text) {
          const original=document.createElement('small');original.className='spoken-original';original.textContent='原始识别：'+event.rawText;row.append(original);
        }
        speechChoosers.push(window.CueCaptureSafeSelect.install(role));
        const menu = $(role.id + '-options'); menu.classList.add('spoken-role-options'); document.body.append(menu);
      }
    } catch (error) { $('spoken-events').textContent = '发言记录读取失败：' + error.message; }
  }
  $('spoken-review').addEventListener('toggle', () => void refreshSpeech());
  $('answer-cancel').addEventListener('click', async () => {
    try {
      await bridge.cancelAnswer();
      window.dispatchEvent(new Event('cue:generation-canceled'));
      $('answer-cancel').disabled = true;
    } catch (error) { status('停止生成失败：' + error.message); }
  });
  bridge.on('llm:start', () => { $('answer-cancel').disabled = false; });
  for (const event of ['llm:done', 'llm:error']) bridge.on(event, () => { $('answer-cancel').disabled = true; });
  bridge.on('dialogue:changed', () => void refreshSpeech());
  bridge.on('materials:personal:changed', () => void refreshState());
  bridge.on('materials:changed', () => { if (!busy) void refreshState(); });
  $('personal-preview').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) closePreview(); return; }
    if (event.key !== 'Tab') return;
    const nodes = [...$('personal-preview').querySelectorAll('button:not(:disabled)')];
    if (!nodes.length) return;
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
  });
  void refreshState();
})();
