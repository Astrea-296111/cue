'use strict';

// Actual speech and model suggestions deliberately have different write paths.
// This ledger records what was said; none of its claims are project evidence.
const { tokenize } = require('./project-search');

const clean = value => String(value == null ? '' : value).trim();
const copy = value => JSON.parse(JSON.stringify(value));
const normalizeTerms = value => clean(value).replace(/卡夫卡/g, 'Kafka').replace(/\bout\s+box\b/gi, 'Outbox').replace(/\brabbit\s*mq\b/gi, 'RabbitMQ');
const PROJECTS = [['cae', /\bcae(?:-job-platform)?\b|CAE仿真平台/i], ['arclight', /\barclight\b|\bmewcode\b/i]];
const NEW_TOPIC = /换个(?:问题|话题)|换一(?:个|道)问题|新话题|先不聊|不(?:结合|涉及|针对).{0,12}项目|(?:单独|只|一般)(?:问|聊|讲|讨论).{0,14}(?:原理|概念|知识)|\b(?:new topic|in general|without (?:the |your )?project)\b/i;
const REF = /刚才|前面|改口|你说|你提到|那|这个|这里|它|继续|这样|口误|怎么算|\b(?:you said|what about|why that|how does it)\b/i;
const CORRECTION = /口误|说错|纠正|更正|更准确|准确说|应该(?:说|是)|实际(?:是|用)|不是.{0,80}而是|改口|不对[，,。\s]|我说.{0,20}大概|\b(?:I\s+(?:meant|mean|misspoke|was\s+(?:wrong|mistaken))|let\s+me\s+(?:correct|rephrase)|more\s+precisely|to\s+be\s+(?:more\s+)?precise)\b/i;
const FAMILIES = [
  ['broker', /kafka|rabbit\s*mq|卡夫卡|消息队列|派发|分区/i],
  ['delivery', /exactly.?once|at.least.once|恰好一次|至少一次|幂等|重复|去重|重投|任务身份|唯一约束|竞争|故障测试|确认丢|confirm|out\s*box/i],
  ['resources', /unknown|license|资源|超卖|释放|节点|进程|solver|fencing|\bpid\b/i],
  ['isolation', /worktree|mailbox|sharedtaskstore|\bcas\b|共享任务|共享状态|共享文件|隔离|目录|路径|依赖|软链接|symlink|realpath|include|并发写|同时改/i],
  ['context-cost', /31(?:\.57)?\s*%|token|压缩|上下文|成本|77\s*%/i],
  ['acceptance-metric', /281|300\s*批|50\s*case|受理|完成时间/i],
  ['recovery-metric', /12\.6|30\s*轮|收敛|恢复条件/i],
  ['evaluation', /swe.?bench|31\.33|43\.67|12\.3[34]|百分点|成功率|评测|泛化|测试|\bci\b|真实输出|验收/i],
  ['tool-loading', /schema|18\.6|4\.2|工具.{0,8}(?:加载|成本|上下文)|初始|完整任务成本/i],
  ['cancellation', /取消|传播|迟到|abort|cancel|中断|fork|继承|工具对话|子进程|协程/i],
  ['reporting', /报告|模板|渲染|求解结果|复用/i],
  ['query-boundaries', /\bsql\b|\bsku\b|受控查询|仓范围|时区|缺货口径|字段|业务口径|join|粒度|重复计数/i]
];

function projectIds(text, hint = []) {
  const explicit = PROJECTS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  return explicit.length ? explicit : [...hint];
}
function terms(text) { return new Set(tokenize(text, true)); }
function intersection(left, right) { let n = 0; for (const term of left) if (right.has(term)) n++; return n; }
function overlaps(left, right) { return !left.length || !right.length || left.some(id => right.includes(id)); }
function family(text) { return FAMILIES.filter(([, pattern]) => pattern.test(text)).map(([id]) => id); }
function numericClaims(text) { return [...text.matchAll(/\d+(?:\.\d+)?\s*(?:%|ms|毫秒|秒|s\b|轮|组|批次?|并发|个|项|k\b|天|个月)?/gi)].map(match => match[0]); }
function modality(text) {
  if (/(?:如果|假如|假设|倘若|要是|将来|未来|后续考虑)|\b(?:if|suppose|hypothetically|would consider)\b/i.test(text)) return 'hypothetical';
  if (/[?？]\s*$|^(?:为什么|为何|怎么|如何|是否|能否|what\b|why\b|how\b|would\b)/i.test(text)) return 'question';
  return 'assertion';
}
function correctionTerms(text) {
  return terms(text.replace(CORRECTION,' ').replace(/刚才|不是|实际|应该|更正|纠正|口误|我说|准确|我们|就是|用了|使用|采用|这个|那个|是|的/g,' '));
}
function identifiers(text) {
  return new Set((text.match(/[A-Za-z][A-Za-z0-9_]{1,63}/g)||[]).map(value=>value.toLowerCase())
    // Conversational correction words are not topic identities. In particular,
    // two utterances beginning "I said" need not be about the same subject.
    .filter(value=>!['cae','arclight','mewcode','ms','token','tokens','the','and','was','is','we','used',
      'said','say','mean','meant','misspoke','wrong','mistaken','correct','rephrase','precisely','precise','more','let','me',
      'actually','has','have','had','are','our','this','that','its','it','for','not','but','my','so','now','then','to','be'].includes(value)));
}
function correctionTargets(previousClaims, claim) {
  const candidates=previousClaims.filter(previous=>['affirmed','contradicted'].includes(previous.status)&&overlaps(previous.projectIds,claim.projectIds)&&
    (claim.concepts.length?previous.concepts.some(group=>claim.concepts.includes(group)):intersection(correctionTerms(previous.text),correctionTerms(claim.text))));
  if(!candidates.length)return [];
  const nextIds=identifiers(claim.text),nextTerms=correctionTerms(claim.text);
  const scored=candidates.map(previous=>({previous,identifierScore:intersection(identifiers(previous.text),nextIds),termScore:intersection(correctionTerms(previous.text),nextTerms)}));
  const bestIdentifier=Math.max(...scored.map(item=>item.identifierScore));
  // A broad family such as evaluation contains independent CI and benchmark
  // claims. Prefer the correction's named subject over that broad category.
  if(bestIdentifier>0)return scored.filter(item=>item.identifierScore>0).map(item=>item.previous);
  const bestTerms=Math.max(...scored.map(item=>item.termScore));
  if(bestTerms>0)return scored.filter(item=>item.termScore===bestTerms).map(item=>item.previous);
  // A bare correction normally refers to the latest matching utterance. Older
  // versions of that same named subject may be retired too, but unrelated
  // claims sharing only the coarse family remain in the record.
  const latest=candidates.at(-1),latestIds=identifiers(latest.text);
  return candidates.filter(previous=>previous===latest||intersection(identifiers(previous.text),latestIds)>0);
}

class SpokenClaimLedger {
  constructor() { this.claims = []; }
  rebuild(events, evidenceRevision = null) {
    const claims = [];
    const byId = new Map(events.map(event=>[event.eventId,event]));
    for (const event of events) {
      if (!event.isFinal || !['candidate', 'unknown'].includes(event.speaker)) continue;
      const echo=event.echoOf&&byId.get(event.echoOf);
      if(echo&&(echo.roleCorrected||event.ingestOrder>echo.ingestOrder)) continue;
      const groups = family(event.normalizedText);
      const speechModality=modality(event.normalizedText);
      const unitCorrection = /百分点/.test(event.normalizedText) && claims.some(previous => previous.status==='affirmed'&&/%/.test(previous.text)&&overlaps(previous.projectIds,event.projectIds)&&previous.concepts.some(group=>groups.includes(group)));
      const explicitCorrection = CORRECTION.test(event.normalizedText) || unitCorrection || event.source==='user-correction';
      const claim = { id: 'spoken:' + event.eventId, eventIds: echo?[event.eventId,echo.eventId]:[event.eventId], revision: event.revision,
        projectIds: [...event.projectIds], text: event.normalizedText, rawText: event.rawText,
        numericClaims: numericClaims(event.normalizedText), concepts: groups,
        modality:speechModality, status: event.speaker === 'unknown' ? 'uncertain' : speechModality==='assertion'?'affirmed':speechModality,
        correction: explicitCorrection, manuallyCorrected:event.source==='user-correction', replaces: [], evidenceRevision: event.evidenceRevision };
      if (explicitCorrection && event.speaker === 'candidate' && speechModality==='assertion') {
        for (const previous of correctionTargets(claims,claim)) {
          // Only a human correction can retire an earlier spoken claim.
          previous.status = 'corrected'; previous.replacedBy = claim.id;
          claim.replaces.push(previous.id);
        }
      } else if(event.speaker==='candidate'&&speechModality==='assertion') {
        const broker=text=>/kafka/i.test(text)&&!/rabbit\s*mq/i.test(text)?'kafka':/rabbit\s*mq/i.test(text)&&!/kafka/i.test(text)?'rabbitmq':null;
        const nextBroker=broker(claim.text);
        if(nextBroker) for(const previous of claims) {
          const oldBroker=broker(previous.text);
          if(previous.status==='affirmed'&&overlaps(previous.projectIds,claim.projectIds)&&oldBroker&&oldBroker!==nextBroker) {
            previous.status='contradicted';claim.status='contradicted';
            claim.contradicts=[...(claim.contradicts||[]),previous.id];
          }
        }
      }
      claims.push(claim);
    }
    this.claims = claims;
  }
  snapshot() { return copy(this.claims); }
}

class DialogueStore {
  constructor({ sessionId, maxEvents = 1200 } = {}) { this.maxEvents = maxEvents; this.sequence = 0; this.reset(sessionId); }
  reset(sessionId) {
    this.sessionId = clean(sessionId) || 'dialogue-' + Date.now() + '-' + ++this.sequence;
    this.revision = 0; this.ingestOrder = 0; this.relativeOrigin = null; this.events = new Map(); this.suggestions = new Map(); this.activeProjectIds = [];
    this.ledger = new SpokenClaimLedger(); this.evidenceRevision = null;
  }
  setActiveProject(ids = [], evidenceRevision = this.evidenceRevision) {
    this.activeProjectIds = [...ids]; this.evidenceRevision = evidenceRevision;
  }
  ingest(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的对话事件');
    const sessionId = clean(input.sessionId || input.session_id) || this.sessionId;
    if (sessionId !== this.sessionId) return { accepted: false, reason: 'stale-session' };
    if (input.type === 'suggestion' || input.speaker === 'assistant' || input.speaker === 'ai') return { accepted: false, reason: 'not-human-speech' };
    const channel = ['you', 'them'].includes(input.channel) ? input.channel : null;
    const rawText = clean(input.rawText == null ? input.text : input.rawText);
    const text = normalizeTerms(input.normalizedText == null ? input.text : input.normalizedText);
    if(!text) return {accepted:false,reason:'empty'};
    if (text.length > 16000 || rawText.length > 16000) throw new Error('单条发言过长');
    const eventId = clean(input.eventId || input.event_id || input.utteranceKey &&
      [input.sourceId || input.source || 'asr', input.sourceSessionId || this.sessionId, channel, input.utteranceKey].join(':')) || 'speech-' + ++this.sequence;
    if (eventId.length > 512) throw new Error('无效的发言标识');
    const previous = this.events.get(eventId);
    const isFinal = input.isFinal !== false && input.is_final !== false;
    const suppliedRevision = input.revision ?? input.eventRevision ?? input.event_revision ?? input.utteranceRevision;
    const explicitRevision = Number.isInteger(suppliedRevision) && suppliedRevision >= 0;
    const revision = explicitRevision ? suppliedRevision : previous ? previous.revision + (previous.text !== text || previous.isFinal !== isFinal ? 1 : 0) : 1;
    if (previous && revision < previous.revision) return { accepted: false, reason: 'stale-revision', event: copy(previous) };
    if (previous?.isFinal && !isFinal) return { accepted: false, reason: 'final-already-committed', event: copy(previous) };
    const requestedSpeaker = input.speaker;
    const speaker = input.roleUncertain || Number.isFinite(input.roleConfidence) && input.roleConfidence < 0.6 ? 'unknown'
      : ['candidate', 'interviewer', 'unknown'].includes(requestedSpeaker) ? requestedSpeaker
      : channel === 'you' ? 'candidate' : channel === 'them' ? 'interviewer' : 'unknown';
    if (previous && revision === previous.revision && previous.isFinal === isFinal) {
      if (previous.text === text && previous.speaker === speaker) return { accepted: false, reason: 'duplicate', event: copy(previous) };
      return { accepted: false, reason: 'revision-conflict', event: copy(previous) };
    }
    const numberOrNull = value => Number.isFinite(value) ? value : null;
    const receivedAt = numberOrNull(input.receivedAt) ?? Date.now();
    const startMs = numberOrNull(input.startMs) ?? numberOrNull(input.start_ms) ?? numberOrNull(input.at_ms) ?? numberOrNull(input.ts) ?? previous?.startMs ?? receivedAt;
    const endMs = numberOrNull(input.endMs) ?? numberOrNull(input.end_ms) ?? previous?.endMs ?? startMs;
    if(Number.isFinite(input.at_ms)&&this.relativeOrigin===null) this.relativeOrigin=this.events.size?Math.max(...[...this.events.values()].map(event=>event.orderMs??event.startMs))+1-input.at_ms:0;
    const orderMs=previous?.orderMs ?? (Number.isFinite(input.at_ms)?this.relativeOrigin+input.at_ms:startMs);
    const event = { sessionId, eventId, speaker, channel: channel || (speaker === 'candidate' ? 'you' : speaker === 'interviewer' ? 'them' : null),
      text, rawText, normalizedText: text, revision, isFinal, startMs, endMs, receivedAt,
      ingestOrder: previous?.ingestOrder ?? ++this.ingestOrder, orderMs,
      confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : null,
      source: clean(input.source || input.sourceId) || 'manual',
      sourceId: clean(input.sourceId), sourceSessionId: clean(input.sourceSessionId), utteranceKey: clean(input.utteranceKey),
      utteranceOrder:numberOrNull(input.utteranceOrder) ?? numberOrNull(input.at_ms) ?? previous?.utteranceOrder ?? null,
      projectIds: Array.isArray(input.projectIds) ? input.projectIds.filter(id => typeof id === 'string').slice(0, 4) : projectIds(text, this.activeProjectIds),
      evidenceRevision: Object.hasOwn(input,'evidenceRevision') ? input.evidenceRevision : previous?.evidenceRevision ?? this.evidenceRevision,
      ...(input.roleCorrected ? { roleCorrected: true,correctionHistory:copy((input.correctionHistory||[]).slice(-16)) } : {}) };
    // A simultaneous exact copy on both channels is an echo candidate. Keep it
    // for inspection, but never invent a second affirmed human claim from it.
    if (!input.roleCorrected && isFinal) {
      const fingerprint = value => value.replace(/[\s，,。.!！?？:：;；]/g, '').toLowerCase();
      const echo = text.length >= 6 && this.ordered().find(other => other.eventId !== eventId && other.isFinal && !other.roleCorrected && other.channel && event.channel && other.channel !== event.channel &&
        fingerprint(other.text) === fingerprint(text) && Math.abs(other.startMs - startMs) <= 1800);
      if (echo) {
        event.echoOf = echo.eventId; event.speaker = 'unknown';
        // Arrival order cannot decide which channel was the real speaker.
        this.events.set(echo.eventId, { ...echo, speaker:'unknown', echoOf:eventId });
      }
    }
    this.events.set(eventId, event); this.revision++;
    if (this.events.size > this.maxEvents) {
      const oldest = this.ordered().find(item => !item.isFinal) || this.ordered()[0];
      this.events.delete(oldest.eventId);
    }
    this.ledger.rebuild(this.ordered(), this.evidenceRevision);
    return { accepted: true, event: copy(event), sessionId: this.sessionId, revision: this.revision };
  }
  correct({ sessionId, eventId, text, speaker, revision } = {}) {
    if (sessionId && sessionId !== this.sessionId) return {accepted:false,reason:'stale-session'};
    const previous = this.events.get(clean(eventId));
    if (!previous) return { accepted: false, reason: 'event-not-found' };
    if (speaker != null && !['candidate','interviewer','unknown'].includes(speaker)) throw new Error('无效的说话人');
    const result = this.ingest({ ...previous, echoOf:undefined, text: text == null ? previous.text : text, normalizedText: text == null ? previous.text : text,
      rawText: previous.rawText, speaker: speaker || previous.speaker, roleCorrected: true,
      correctionHistory:[...(previous.correctionHistory||[]),{revision:previous.revision,text:previous.text,speaker:previous.speaker}].slice(-16),
      revision: Number.isInteger(revision) ? revision : previous.revision + 1, isFinal: true, source: 'user-correction' });
    return result;
  }
  ordered() { return [...this.events.values()].sort((a, b) => a.orderMs - b.orderMs || a.ingestOrder - b.ingestOrder); }
  recordSuggestion({ requestId, sessionId = this.sessionId, status, text, question, eventIds }) {
    if (!requestId || sessionId !== this.sessionId) return false;
    const previous = this.suggestions.get(requestId);
    this.suggestions.set(requestId, { ...previous, requestId, status, text:text ?? previous?.text ?? '', question:question ?? previous?.question ?? '', sourceEventIds: [...(eventIds ?? previous?.sourceEventIds ?? [])], sessionId });
    while (this.suggestions.size > 80) this.suggestions.delete(this.suggestions.keys().next().value);
    return true;
  }
  selectContext({ question = '', projectIds: ids = [], maxChars = 3600, maxEvents = 10 } = {}) {
    if (NEW_TOPIC.test(question)) return { text: '', eventIds: [], claims: [], projectIds: [], revision: this.revision, sessionId: this.sessionId };
    const qTerms = terms(question), qFamilies = family(question);
    const metaConversation=/(?:发言|改口|口误|对话|说过).{0,16}(?:保留|记住|保存|承接)|最近.{0,8}(?:句话|发言|对话)/.test(question);
    ids=ids.length?ids:metaConversation?[]:this.activeProjectIds;
    const ranked = this.ledger.claims.filter(claim => claim.status !== 'corrected' && overlaps(ids, claim.projectIds)).map((claim, index, all) => {
      const shared = intersection(qTerms, terms(claim.text));
      const sharedFamily = claim.concepts.filter(group => qFamilies.includes(group)).length;
      const recency = index >= all.length - 3;
      const active = this.activeProjectIds.length && overlaps(this.activeProjectIds, claim.projectIds);
      const score = shared * 3 + sharedFamily * 8 + (recency ? 3 : 0) + (claim.correction ? 12 : 0) + (claim.numericClaims.length && (shared || sharedFamily) ? 8 : 0);
      return { claim, index, score, relevant: metaConversation&&claim.correction || shared > 0 || sharedFamily > 0 || recency && (REF.test(question) || active&&qTerms.size<=2) };
    }).filter(item => item.relevant).sort((a, b) => b.score - a.score || b.index - a.index);
    const chosen = []; let remaining = maxChars;
    for (const item of ranked.slice(0, maxEvents)) {
      const claim = item.claim;
      const status = claim.status === 'uncertain' ? '说话人待确认，不当成候选人已说' : claim.status==='hypothetical'?'候选人提出的假设或后续设计，不是项目已实现事实':claim.status==='question'?'候选人提出的问题，不当成实现断言':claim.status==='contradicted'?'候选人前后说法冲突，按证据澄清':claim.correction||claim.manuallyCorrected ? '候选人已主动纠正，沿用此版本，不重复提醒旧口误' : '候选人实际发言，可能有口误';
      const block = `[${status}；event=${claim.eventIds.join(',')}]\n${claim.text}`;
      // The character target is soft. Never silently erase the most relevant
      // complete correction/number merely because it is longer than the target.
      if (block.length > remaining && (chosen.length || !claim.correction&&!claim.numericClaims.length)) continue;
      chosen.push({ ...item, block }); remaining -= block.length + 2;
    }
    chosen.sort((a, b) => a.index - b.index);
    return { text: chosen.map(item => item.block).join('\n\n'), eventIds: chosen.flatMap(item => item.claim.eventIds),
      claims: chosen.map(item => copy(item.claim)), projectIds: [...new Set(chosen.filter(item=>item.claim.status!=='uncertain').flatMap(item => item.claim.projectIds))],
      revision: this.revision, sessionId: this.sessionId };
  }
  snapshot(options = {}) {
    return { sessionId: this.sessionId, revision: this.revision, events: copy(this.ordered()),
      claims: this.ledger.snapshot(), suggestions: copy([...this.suggestions.values()]), context: this.selectContext(options) };
  }
}

const SPOKEN_CONTEXT_RULES = '\n真人发言与建议分开：SPOKEN_STATE 是候选人实际说过或人工修订的内容，不是实现证据。先用它理解当前问题的实体、数字和指代，再按源码/资料校准事实；旧 AI 建议从未自动成为候选人发言。若实际发言与可靠证据冲突，用一句自然的“更准确说/刚才口误”纠正后回答，不顺着编造。纠正后仍须回答当前具体选择及理由；涉及替代设计时标明“如果改用”，给出一个可用方案及边界，不能只说需要重新设计或后续评估。若候选人已主动纠正，直接沿用新版本，不反复道歉。正确的近似数补口径即可，角色未确认的发言不能强行归给候选人。';

module.exports = { DialogueStore, SpokenClaimLedger, SPOKEN_CONTEXT_RULES, projectIds };
