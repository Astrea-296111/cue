'use strict';

// Trim only a clearly unrelated older topic; keep uncertain links and all
// setup/constraints that belong to the latest scene.
const TOPICS = [
  ['sql', /\b(?:sql|mysql|postgres(?:ql)?)\b|数据库|事务隔离|查询语句|数据表/i],
  ['cache', /\bredis\b|缓存|缓存击穿|缓存雪崩/i],
  ['java', /\b(?:java|jvm|gc)\b|虚拟机|垃圾回收/i],
  ['queue', /\b(?:kafka|rabbitmq|rocketmq)\b|消息队列|消息投递/i],
  ['network', /\b(?:http|https|tcp|udp)\b|网络协议|三次握手/i],
  ['intro', /自我介绍|介绍一下自己/],
];
function topics(text) { return new Set(TOPICS.filter(([,re])=>re.test(text)).map(([name])=>name)); }
function focusSnapshot(snapshot) {
  const parts=(snapshot?.segments || []).filter(part=>!part.answered && part.text);
  if (parts.length < 2) return snapshot;
  let latest=topics(parts.at(-1).text);
  if (!latest.size) return snapshot;
  let cut=0;
  for(let i=parts.length-2;i>=0;i--){
    const before=topics(parts[i].text);
    if (!before.size) continue;
    if (/(?:假设|假如|如果|前提|条件|场景|情况下|不能|必须)/.test(parts[i].text)) continue;
    if (![...before].some(t=>latest.has(t))) { cut=i+1; break; }
    latest=new Set([...latest,...before]);
  }
  if (!cut) return snapshot;
  const selected=parts.slice(cut), keys=new Set(selected.flatMap(part=>part.partIds || [part.id]));
  const text=selected.map(part=>part.text).join('\n');
  const sourceKeys=(snapshot.sourceKeys||[]).filter(key=>keys.has(key));
  return {...snapshot,text,completePrefix:text,parts:selected.map(part=>part.text),
    sourceKeys,keys:new Set(sourceKeys),focusedFromEarlier:true};
}
module.exports = { focusSnapshot };
