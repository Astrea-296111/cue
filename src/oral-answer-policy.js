'use strict';

const VERSION = 'oral-2026-11-02-v2';
const RULES = '只回答面试官最近真正要问的问题；保留当前场景的条件和本轮明确子问；之前的独立问句即使属于同一话题也只作背景，不要重新回答。用中文像面对面聊天一样直接回答，短句、自然、具体，不要书面报告腔、套话或强行编号。先讲结论，再用一两句解释或一个贴题例子；一般追问只说最相关的一种做法和必要边界，不主动罗列多种方案或写小论文。明确要求展开时再补充关键步骤。口述段不要直接念英文函数名、变量名或 SQL 关键字，除非面试官专门问名称；用中文常用说法解释，例如说“按手机号分组，挑出出现超过一次的组”，不要在口述段说 GROUP BY 或 HAVING。需要代码或 SQL 时先给能直接说出口的中文思路，再给一种完整正确的代码或 SQL，并用中文简短解释；题目要求比较多种写法时才展开。代码块内保留准确的原始标识和关键字。项目事实按来源使用；没有证据不要编造个人经历、数字、结果或已上线功能。假设和改进建议要说清楚，指标保留口径。';
const FACT_RULES = '只回答最近的问题，保留同题条件；依据资料，不虚构经历、结果或指标；建议和现有实现分开。首句直接给能口述的核心回答，不要先复述问题或用“关于这个问题”开场；是非题和是否使用某项技术先给有依据的结论，依据不足时直接说无法确认，不能猜。先用一两句说清结论和最关键原因，再按问题需要补充具体做法和必要边界；多个子问各自直接作答。用户风格中的分点、加粗等格式可保留，但不要让复述问题挡住结论。';
const isCode = q => /(?:编写|写出|写(?:一段|个)?代码|手写|手撕|代码实现|完整程序|SQL查询|写.{0,8}SQL|实现.{0,20}(?:函数|方法|遍历|算法))|\bSQL\b.{0,20}(?:怎么写|如何写|语句|查询|代码|设计)|\b(?:implement|write\s+(?:code|a function|SQL))\b/i.test(q);
function plan(question = '', interviewPlan) {
  const q = String(question);
  const selectedMultiple = q.startsWith('请逐一回答以下所有问题：\n');
  const code = isCode(q);
  const personalDetail=/自己买|己买|谁买|采购|报销|账号来源|付费方式/.test(q);
  const detailed = /(?:请|要求|需要|逐项|详细|完整).{0,6}(?:展开|详解|解释|比较|列出)|详细(?:说明|讲|回答)|展开(?:讲|说|一下)|逐项比较|in detail|elaborate/i.test(q);
  const confirmation=/了解|熟悉/.test(q)&&/吧|先问|方面/.test(q)&&!/怎么|如何|为什么|区别|是什么|原理|范式|有哪些|检索|采样|工具调用|上下文|温度|向量|后训练|\b(?:RAG|MCP|Schema|SQL|Transformer|ReAct|PNE|Skill|Memory|Token)\b|temperature|top[- _]?p/i.test(q);
  const brief = /^(?:什么是|是否|是不是|简单|一句话|what is|define)/i.test(q);
  return { version: VERSION, level: code ? 'code' : detailed ? 'detailed' : brief ? 'brief' : 'standard',
    confirmation,personalDetail,selectedMultiple,questionCount: Math.max(1, interviewPlan?.subQuestions?.length || 1), code, detailed,
    targetCharacters: code ? null : detailed ? [240, 360] : brief ? [80, 160] : [140, 220],
    maxVisibleCharacters: code || selectedMultiple ? null : detailed ? 360 : 260,
    points: detailed ? [3, 4] : [1, 3], sentenceLimit: detailed ? 8 : 6,
    maxTokens: code ? 6000 : selectedMultiple ? 2000 : personalDetail ? 180 : confirmation ? 200 : detailed ? 1000 : 600 };
}
function instruction(p = plan()) {
  if(p.selectedMultiple)return '用户明确选择了多个当前问题；逐一回答全部所选问题及其必要条件，不忽略较早的所选问题。每题先用口语短句给结论，再补充必要说明；不编造个人经历、指标或项目实现。';
  if(p.confirmation)return p.customStyle ? '这是确认是否可以继续提问，遵循用户设置的风格，不擅自展开未问内容。' : '这只是确认是否可以继续提问，用一句自然确认即可，不主动讲后训练、指标或答题策略，不强制编号。';
  if(p.personalDetail)return (p.customStyle ? '这是个人费用归属追问，遵循用户设置的回答风格。' : '这是个人费用归属追问，直接短答，不展开技术评测或合规。') + '只据已确认的采购信息回答；来源没有时说明待确认。不能由使用API推断个人购买、团队采购或报销。';
  return (p.customStyle ? FACT_RULES : RULES) + '首句直接回答，不复述问题；是非题或是否使用某项技术先给有依据的结论，无法确认时直接说明。省略的技术对象优先参考最近面试官原话，必要时说明假设；不要把通用知识问题变成项目经历。Java 线程状态需区分 monitor 竞争的 BLOCKED 与 AQS 等待；版本相关实现需说明假设，不臆造默认版本。面试官背景和岗位要求不是本人经历，无源码的实现只作建议。' + (p.code ? '先用自然中文详细解释思路、关键步骤、复杂度和边界，再给完整代码或 SQL。用户提供代码或报错时优先定位具体问题并保留其接口和变量；要求可运行示例或自主构造输入输出时，包含入口、样例输入与预期输出；输入格式不明时说明假设，不伪造运行结果。代码保留原始标识，不截断。SQL 保持题目口径，聚合先确定粒度，注意重复行和除零。'
    : p.customStyle ? '遵循用户设置的风格和长度；完整回答问题。'
    : p.detailed ? '用户要求展开时按需解释，语言仍然自然。' : '简单问题尽量用两三句短话；多个子问逐一覆盖，不牺牲必要条件。');
}
function visibleText(text) { return String(text || '').replace(/```[^\n]*\n?|```/g, '').replace(/(?:^|\n)\s*(?:\d+[.)、]|[-+])\s*/g, '').replace(/[*_`#>~\s]/gu, ''); }
function visibleCharacters(text) { return Array.from(visibleText(text)).length; }
// The raw answer is always retained. Never use this local presentation cap as a quality pass.
function presentation(raw, p = plan()) {
  if (p.code || p.customStyle || p.selectedMultiple || visibleCharacters(raw) <= p.maxVisibleCharacters) return { text: raw, displayTruncated: false };
  let text = '';
  for (const sentence of String(raw).match(/[^。！？!?]+[。！？!?]|[^。！？!?]+$/gu) || []) {
    if (visibleCharacters(text + sentence) > p.maxVisibleCharacters) break;
    text += sentence;
  }
  return { text, displayTruncated: true };
}
module.exports = { VERSION, RULES, FACT_RULES, plan, instruction, isCode, visibleCharacters, presentation };
