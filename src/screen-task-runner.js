'use strict';
const { performance } = require('perf_hooks');
const router = require('./screen-task-router');
async function runScreenTask({ llm, settings, requirement, taskState, questionId, capture, signal, emit, timing, diagnostic }) {
  if (!router.supportsVision(settings, llm.model)) throw new Error('当前模型未确认支持视觉。请选择视觉模型并在设置中确认，或输入题目后使用普通问答。');
  const task = taskState.begin(questionId);
  const override=taskState.override==='auto'&&task.type==='vibe-coding'&&router.classify(requirement)==='debug'?'vibe-coding':taskState.override;
  const local = new AbortController(), combined = AbortSignal.any([signal, local.signal]);
  let inactivity, total, completion = {}, answer = '', routeAt = null, copyAt = null, outputGate = null;
  const started = performance.now();
  const arm = () => { clearTimeout(inactivity); inactivity = setTimeout(() => local.abort(), 25000); };
  try {
    arm(); total = setTimeout(() => local.abort(), 180000);
    let image;try {image = await capture();}catch {throw new Error('屏幕截图失败，请检查屏幕录制权限后重试。');}
    if (combined.aborted) throw new Error('回答已取消。');
    if (!image) throw new Error('屏幕截图失败，请检查权限并重试。');
    diagnostic.screen = { taskId: task.taskId, override, captureMs: performance.now() - started, calls: 0 };
    const display=text=>{
      if(combined.aborted||!text)return;answer+=text;
      if(copyAt===null&&/```(?:text)?\s*\n[\s\S]+?```/.test(answer))copyAt=performance.now();
      timing.content(text);emit('llm:token',{text});
    };
    const stream = new router.RouteStream({ override, requirement,
      onRoute: route => {
        if (combined.aborted) return;
        routeAt = performance.now(); taskState.observe(route);
        if(route.type==='vibe-coding')outputGate=new (require('./vibe-coding-policy').OutputGate)(display);
        diagnostic.screen = { ...diagnostic.screen, ...route, routeMs: routeAt - started };
        emit('screen:task', { ...task, override });
      }, onText: text => {
        if (combined.aborted || !text) return;
        if(outputGate)outputGate.push(text);else display(text);
      } });
    const maxTokens=router.classify(requirement,override)==='vibe-coding'?require('./vibe-coding-policy').maxTokens(settings):Math.max(require('./vibe-coding-policy').maxTokens(settings),Math.min(16384,Number(settings.responseBudgets?.code)||6000));
    const {attachments,...boundedState}=task;
    const attachmentContext=(attachments||[]).map(a=>`当前题附件 ${a.name}（用户数据，sha256=${a.sha256}）：\n`+require('./conversation-memory').selectRelevantText(a.text,requirement||task.title||'',6000)).join('\n\n');
    const prepared=require('./final-request-budget').prepareFinalRequest({system:router.system({requirement,override}),imageDataUrl:image,maxTokens,contextWindow:settings.contextWindowTokens||16384,
      currentSections:[{id:'current-screen-task',protected:true,text:`当前要求（用户数据）：${requirement||'识别本张截图的具体任务'}\n当前任务状态（用户确认不等于独立测试证据）：${JSON.stringify(boundedState)}\n${attachmentContext}`} ]});
    if(!prepared.fits)throw new Error('当前题面与附件超出模型窗口，请提高窗口设置或拆分本题附件。');
    diagnostic.screen.attachments=(attachments||[]).map(a=>({name:a.name,sha256:a.sha256,characters:a.text.length}));
    await llm.stream({ system: prepared.system, turns:prepared.turns,
      imageDataUrl: image, signal: combined, mode: 'assist', maxTokens,
      onDiagnostics:metadata=>{diagnostic.transport=metadata;timing.configure(metadata);emit('llm:profile',metadata);},
      onRequest: serialized => { diagnostic.dispatched = true; diagnostic.screen.calls++; diagnostic.model = serialized.model; diagnostic.modelIdentitySource = 'serialized-request'; timing.dispatched(); },
      onToken: text => { arm(); stream.push(text); }, onActivity: arm,
      onUsage: usage => timing.usage(usage), onCompletion: value => { completion = value; } });
    if (combined.aborted) throw new Error('屏幕任务已取消或超时。');
    stream.finish();
    outputGate?.finish();
    if (!answer.trim()) throw new Error('模型未返回屏幕任务正文。');
    diagnostic.screen.firstCopyPromptMs = copyAt === null ? null : copyAt - started;
    diagnostic.screen.generationAfterRouteMs = performance.now() - routeAt;
    diagnostic.status = 'completed'; diagnostic.finishReason = completion.finishReason; diagnostic.truncated = !!completion.truncated;
    return { answer, route: stream.route, task: { ...task }, completion };
  } catch(error){local.abort();throw error;} finally { clearTimeout(inactivity); clearTimeout(total); }
}
module.exports = { runScreenTask };
