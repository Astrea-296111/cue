'use strict';

const VERSION = 'oral-2026-10-26-v2';
const RULES = '只回答当前问题。默认2–3点，每点独立一行，格式为“1. 提示词：正文”。直接说答案，不描述“我会如何回答”。每点开头用做法、原因、例子、结果等2–6字短提示词，紧跟1–2句能直接说出口的话。先给答案，不复述问题，不加开场。普通回答总长不超过260字符。一个概念一直用同一个名称；抽象名词直接跟简单例子。不重复项目背景，不自动补总结和下一问。项目事实按来源使用；未知结果不能编造，也不能把未知说成从未做过。FUTURE/proposed_design是新增方案，必须用“我会/建议”描述，不能说组别已经跑过；USER简历声明也不能证明新增消融组已经执行。账号采购、组织人数等无来源时不猜历史，可一句保留待确认后说明已知做法。USER中的未独立复核是资料核验状态，不能改口为候选人从未跑过。比较框架只能看整体配置差异；单开关对照是边际贡献证据，还需固定条件并重复，不能证明所有组件或唯一原因。第三方产品未公开的机制不作确定断言。报指标保留测量对象、单位和对照，不能从降幅反推某个具体机制的因果贡献。';
const isCode = q => /(?:编写|写出|写(?:一段|个)?代码|手写|手撕|代码实现|完整程序|SQL查询|写.{0,8}SQL|实现.{0,20}(?:函数|方法|遍历|算法))|\b(?:implement|write\s+(?:code|a function|SQL))\b/i.test(q);
function plan(question = '', interviewPlan) {
  const q = String(question);
  const code = isCode(q);
  const personalDetail=/自己买|己买|谁买|采购|报销|账号来源|付费方式/.test(q);
  const detailed = /(?:请|要求|需要|逐项|详细|完整).{0,6}(?:展开|详解|解释|比较|列出)|详细(?:说明|讲|回答)|展开(?:讲|说|一下)|逐项比较|in detail|elaborate/i.test(q);
  const confirmation=/了解|熟悉/.test(q)&&/吧|先问|方面/.test(q)&&!/怎么|如何|为什么|区别|是什么|原理|范式|有哪些|检索|采样|工具调用|上下文|温度|向量|后训练|\b(?:RAG|MCP|Schema|SQL|Transformer|ReAct|PNE|Skill|Memory|Token)\b|temperature|top[- _]?p/i.test(q);
  const brief = /^(?:什么是|是否|是不是|简单|一句话|what is|define)/i.test(q);
  return { version: VERSION, level: code ? 'code' : detailed ? 'detailed' : brief ? 'brief' : 'standard',
    confirmation,personalDetail,questionCount: Math.max(1, interviewPlan?.subQuestions?.length || 1), code, detailed,
    targetCharacters: code ? null : detailed ? [240, 360] : brief ? [80, 160] : [140, 220],
    maxVisibleCharacters: code ? null : detailed ? 360 : 260,
    points: detailed ? [3, 4] : [1, 3], sentenceLimit: detailed ? 8 : 6,
    maxTokens: code ? 6000 : personalDetail ? 180 : confirmation ? 200 : detailed ? 1000 : 600 };
}
function instruction(p = plan()) {
  if(p.confirmation)return '这只是确认是否可以继续提问，用一句自然确认即可，不主动讲后训练、指标或答题策略，不强制编号。';
  if(p.personalDetail)return '这是个人费用归属追问，直接短答，不展开技术评测或合规。只据已确认的采购信息回答；来源没有时用一句“这个细节待确认”保留未知。不能由使用API推断个人购买、团队采购或报销。';
  return RULES + '面试官背景和岗位要求不是本人经历，无源码的实现只作建议。' + (p.code ? '代码独立预算，给完整代码；解释保持简短，不截断代码。SQL以当前题目口径为准，不添加无依据状态过滤；聚合先定粒度。资格表可重复时用EXISTS或先DISTINCT，禁止直接JOIN放大金额；除法用浮点并处理零分母。客单价按题目定义计算，禁止买家数除以自身。'
    : p.detailed ? '用户明确要求展开，本次可用3–4点、240–360字符。' : '本次优先140–220字符，最多260字符；多问压缩措辞但保留关键条件。');
}
function visibleText(text) { return String(text || '').replace(/```[^\n]*\n?|```/g, '').replace(/(?:^|\n)\s*(?:\d+[.)、]|[-+])\s*/g, '').replace(/[*_`#>~\s]/gu, ''); }
function visibleCharacters(text) { return Array.from(visibleText(text)).length; }
// The raw answer is always retained. Never use this local presentation cap as a quality pass.
function presentation(raw, p = plan()) {
  if (p.code || visibleCharacters(raw) <= p.maxVisibleCharacters) return { text: raw, displayTruncated: false };
  let text = '';
  for (const sentence of String(raw).match(/[^。！？!?]+[。！？!?]|[^。！？!?]+$/gu) || []) {
    if (visibleCharacters(text + sentence) > p.maxVisibleCharacters) break;
    text += sentence;
  }
  return { text, displayTruncated: true };
}
module.exports = { VERSION, RULES, plan, instruction, isCode, visibleCharacters, presentation };
