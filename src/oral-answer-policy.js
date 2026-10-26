'use strict';

const VERSION = 'oral-2026-10-26-v1';
const RULES = '只回答当前问题。默认2–3点，每点开头用做法、原因、例子、结果等2–6字短提示词，紧跟1–2句能直接说出口的话。先给答案，不复述问题，不加开场。普通回答总长不超过260字符。一个概念一直用同一个名称；抽象名词直接跟简单例子。不重复项目背景，不自动补总结和下一问。项目事实按来源使用；未知结果不能编造，也不能把未知说成从未做过。';
const isCode = q => /(?:编写|写出|写(?:一段|个)?代码|手写|手撕|代码实现|完整程序|SQL查询|写.{0,8}SQL|实现.{0,20}(?:函数|方法|遍历|算法))|\b(?:implement|write\s+(?:code|a function|SQL))\b/i.test(q);
function plan(question = '', interviewPlan) {
  const q = String(question);
  const code = isCode(q);
  const detailed = /(?:请|要求|需要|逐项|详细|完整).{0,6}(?:展开|详解|解释|比较|列出)|详细(?:说明|讲|回答)|展开(?:讲|说|一下)|逐项比较|in detail|elaborate/i.test(q);
  const brief = /^(?:什么是|是否|是不是|简单|一句话|what is|define)/i.test(q);
  return { version: VERSION, level: code ? 'code' : detailed ? 'detailed' : brief ? 'brief' : 'standard',
    questionCount: Math.max(1, interviewPlan?.subQuestions?.length || 1), code, detailed,
    targetCharacters: code ? null : detailed ? [240, 360] : brief ? [80, 160] : [140, 220],
    maxVisibleCharacters: code ? null : detailed ? 360 : 260,
    points: detailed ? [3, 4] : [1, 3], sentenceLimit: detailed ? 8 : 6,
    maxTokens: code ? 6000 : detailed ? 1000 : 600 };
}
function instruction(p = plan()) {
  return RULES + (p.code ? '代码独立预算，给完整代码；解释保持简短，不截断代码。'
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
