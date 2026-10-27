'use strict';
const { randomUUID } = require('crypto');
const TYPES = ['algorithm', 'sql', 'debug', 'system-design', 'vibe-coding', 'unknown'];
function classify(requirement = '', override = 'auto') {
  if (override === 'vibe-coding') return 'vibe-coding';
  if (/解释.{0,20}(?:循环|函数|代码)|只写.{0,8}SQL|写一条\s*SQL/i.test(requirement)) return /SQL/i.test(requirement) ? 'sql' : 'algorithm';
  if (override !== 'solve' && /vibe\s*coding|与\s*AI\s*(?:协作|对话|一起)|给\s*AI\s*(?:的)?提示词|(?:构建|搭建|实现).{0,20}(?:应用|Agent|系统)/i.test(requirement)) return 'vibe-coding';
  if (/报错|修复|debug|traceback/i.test(requirement)) return 'debug';
  if (/SQL|查询语句/i.test(requirement)) return 'sql';
  if (/算法|复杂度|解释.{0,15}循环/i.test(requirement)) return 'algorithm';
  return 'unknown';
}
function supportsVision(settings, model) {
  const configured = settings.providerOptions?.[settings.provider]?.vision;
  if (typeof configured === 'boolean') return configured;
  if (settings.provider === 'deepseek') return false;
  return /gpt-4o|gpt-4\.1|gpt-5|claude-3|claude-4|gemini|qwen.*vl|qwen3[.\d-]*-(?:flash|plus|max)/i.test(model || '');
}
function system({ requirement, override = 'auto' }) {
  return `你是中文屏幕任务助手。一次调用完成截图识别、路由和回答，不调用额外 OCR 或分类模型。
第一行必须严格为 CUE_SCREEN 后接单行 JSON：{"type":"algorithm|sql|debug|system-design|vibe-coding|unknown","title":"具体题目","observed":["看到的要求"],"inferred":["推断"],"missing":["缺失内容"],"stage":"plan|debug"}，然后换行输出正文。不要在路由头前输出任何内容。
只依据本张截图与当前要求。AI 聊天侧栏、IDE 或 SQL 关键词本身不证明 Vibe Coding；明确要求与 AI 协作搭建应用才走该模式。当前“解释循环”等具体要求优先。模糊截图输出 unknown 并列出补全题目/选择视觉模型/重新截图的操作，不猜题。
用户模式覆盖：${override}；基于明确当前要求的初步类型：${classify(requirement, override)}。手动 solve 禁止 vibe-coding；vibe-coding 强制指导模式。
算法/单条 SQL：保留思路、复杂度、完整可运行解答；debug：最小复现、原因与定点修复；unknown：说明缺口。禁止借用旧候选人发言、旧 AI 建议。
以下专用协议仅在 type=vibe-coding 时使用；普通算法仍输出解答代码：\n${require('./vibe-coding-policy').instruction}`;
}
class RouteStream {
  constructor({ onRoute, onText, override = 'auto', requirement = '' }) { Object.assign(this, { onRoute, onText, override, requirement }); this.buffer = ''; this.route = null; }
  push(text) {
    if (this.route) return this.onText(text);
    this.buffer += text;
    if (this.buffer.length > 6000 && !this.buffer.includes('\n')) throw new Error('屏幕识别没有返回有效路由头，请重试或输入题目。');
    const at = this.buffer.indexOf('\n'); if (at < 0) return;
    const line = this.buffer.slice(0, at).trim();
    if(line.length>6000)throw new Error('屏幕识别头超过上限，请缩小当前题面。');
    let route; try { route = JSON.parse(line.replace(/^CUE_SCREEN\s*/, '')); } catch { throw new Error('屏幕路由格式无效，未展示未确认代码。'); }
    if (!line.startsWith('CUE_SCREEN ') || !TYPES.includes(route.type) || typeof route.title !== 'string' || !route.title.trim() || route.title.length > 2000 || ['observed','inferred','missing'].some(k => !Array.isArray(route[k]) || route[k].some(t => typeof t !== 'string' || t.length > 2000))) throw new Error('屏幕路由数据无效。');
    const explicit = classify(this.requirement, this.override);
    if ((this.override === 'vibe-coding' || explicit !== 'unknown') && this.override !== 'solve' && route.type !== explicit || this.override === 'solve' && route.type === 'vibe-coding') throw new Error('模型模式与当前明确要求不一致，请重试或手动选择模式。');
    this.route = route; this.onRoute(route); this.onText(this.buffer.slice(at + 1)); this.buffer = '';
  }
  finish() { if (!this.route) throw new Error('屏幕任务识别未完成，请重新截图。'); }
}
class ScreenTaskState {
  constructor() { this.end(); }
  end() { this.task = null; this.override = 'auto'; this.overrideNext = null; this.continueNext = false; this.pendingAttachments=[]; }
  begin(questionId) {
    const continuing=!!(this.task&&this.continueNext&&!(this.task.questionId&&questionId&&this.task.questionId!==questionId));
    this.override=this.overrideNext || (continuing ? this.task.override : 'auto');this.overrideNext=null;
    if (!continuing) this.task = { taskId: randomUUID(), questionId, confirmed: [], accepted: [], attachments:this.pendingAttachments };
    this.pendingAttachments=[];
    this.task.override=this.override;this.continueNext = false; return this.task;
  }
  observe(route) {
    if(!this.task.goal)this.task.goal={text:route.title,source:'current-screenshot'};
    Object.assign(this.task, { title: route.title, type: route.type, stage: route.stage === 'debug' ? 'debug' : 'plan',
      observed: route.observed.slice(0, 12), inferred:route.inferred.slice(0,12), missing: route.missing.slice(0, 12), source: 'current-screenshot',
      latestVisibleError:route.stage==='debug'?{text:route.observed.join('\n').slice(0,3000),source:'current-screenshot'}:null });
  }
  attach(name,text) {
    if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>65536||typeof name!=='string'||name.length>120)throw new Error('当前题附件需要 1–64KiB 文本和有效名称');
    const rows=this.task?(this.continueNext=true,this.task.attachments):this.pendingAttachments;
    const item={name,text,source:'user-task-attachment',sha256:require('crypto').createHash('sha256').update(text).digest('hex')};
    const old=rows.findIndex(a=>a.name===name);if(old>=0)rows[old]=item;else if(rows.length<3)rows.push(item);else throw new Error('当前题最多保留 3 个附件');
    return {name,sha256:item.sha256,characters:text.length};
  }
  accept(label) {
    if(!this.task||typeof label!=='string'||!label.trim()||label.length>300)throw new Error('先开始当前题，再填写已验收项');
    this.task.accepted.push({label,source:'explicit-user-confirmation',at:new Date().toISOString()});
    this.task.accepted=this.task.accepted.slice(-12);return this.task.accepted;
  }
}
module.exports = { TYPES, classify, supportsVision, system, RouteStream, ScreenTaskState };
