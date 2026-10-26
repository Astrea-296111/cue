'use strict';
const stripAuditMarker=text=>String(text||'').replace(/\n?（发言 [^\n]+ · 版本 \d+）\s*$/u,'').trim();
const GROUPS=[
  ['sampling',/temperature|top[- _]?p|top[- _]?k|采样参数|温度参数/i],
  ['retrieval',/稀疏|稠密|召回|BM25|RRF|向量检索|两路检索/i],
  ['benchmark',/SWE|benchmark|评测|对照组|消融|骁龙实验|300.*题/i],
  ['mailbox',/Mailbox|结构化.*消息|消息.*协作/i]
  ,['repository',/改代码|改哪|代码仓库|代码量|代码的|get.*代码|仓库.*(?:建模|知识|图谱)/i]
  ,['strengths',/这(?:些|几个)方向|比较强|小模型训练|知识图谱|图数据库|哪一个可以.*介绍/i]
  ,['memory',/长期记忆|更新频率|存储内容|memories/i]
  ,['tools',/工具|MCP|Schema|关键词|参数.{0,8}(?:校验|传|错)|校验错误|错误码|路由/i]
  ,['business',/电商|库存|应用|角色|入口|触发|哪些环节|复杂度/i]
];
function reference(question,transcript=[]) {
  const q=stripAuditMarker(question);
  if(!/这些|他们是什么|它们|(?:它|这个|这一层|你这个|他这个)|怎么融合|这两路|对照组|消融|骁龙实验|什么样的结构化|刚才|那个实验|哪些角色|哪些环节|关键词|(?:哪一个|复杂度).*(?:强|最高|多少)/.test(q))return '';
  const prior=transcript.filter(t=>t.channel==='them').map(t=>stripAuditMarker(t.text)).filter(t=>t&&t!==q);
  const unique=[...new Set(prior.slice(-24))];
  const group=GROUPS.find(([,re])=>re.test(q)) || unique.slice().reverse().map(text=>GROUPS.find(([,re])=>re.test(text))).find(Boolean);
  const substantive=text=>text.replace(/[\s，,。？?！!]/g,'').length>=12&&!/^(?:你)?这些有了解过吗|^他们是什么东西/.test(text);
  const candidates=unique.filter(text=>substantive(text)&&(!group||group[1].test(text)));
  // Keep complete ASR turns with explicit entities, not just the last two fragments.
  const chosen=(candidates.length?candidates:unique.filter(substantive)).slice(-3);
  return chosen.join('\n');
}
module.exports={reference,stripAuditMarker};
