'use strict';
(() => {
  const toggle=document.getElementById('save-interview-transcript'),status=document.getElementById('recording-status'),button=document.getElementById('recording-folder');
  function render(value){
    toggle.checked=value.enabled;
    status.textContent=value.error?.message||(value.enabled?(value.fileName?`当前文件：${value.fileName}${value.pendingBytes?' · 正在保存…':' · 已保存'}`:'已开启，首条对话后创建 TXT。'):'已暂停自动记录，已有 TXT 保留在本机。');
  }
  toggle.addEventListener('change',async()=>{
    try{await window.cue.settingsSet({saveInterviewTranscript:toggle.checked});render(await window.cue.recordingState());}
    catch(error){status.textContent='记录设置保存失败：'+error.message;}
  });
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{await window.cue.openRecordingFolder();}
    catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  });
  window.cue.on('dialogue:recording',render);
  window.cue.recordingState().then(render).catch(error=>{status.textContent='记录状态读取失败：'+error.message;});
})();
