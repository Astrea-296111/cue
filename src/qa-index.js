'use strict';
const { performance } = require('perf_hooks');
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '')
  .replace(/^(?:请问|麻烦讲讲|请介绍一下)/,'').replace(/(?:呢|吗)$/,'').replace(/怎么|怎样/g,'如何');
const grams = text => new Set([...text].slice(0, -1).map((_, i) => text.slice(i, i + 2)));
const constraints = text => JSON.stringify({ negative: /不|没|未|禁止|避免|别|without|not\b/i.test(text),
  asks:(text.match(/如何|为什么|为何|什么|哪些|多少|是否|是不是|怎么办|怎样|怎么/g)||[]).length,
  conjunctions:(text.match(/以及|并且|另外|然后|同时|又/g)||[]).length,
  numbers: (text.match(/\d+(?:\.\d+)?(?:ms|秒|毫秒|分钟|小时|%|s\b)?/g) || []).sort(), hypothetical: /如果|假设|会如何|会怎么|将来|打算|设计这类/.test(text), historical: /当时|做过|实际|已经|曾经/.test(text) });
class QAIndex {
  constructor(index, revision = '') {
    this.revision = revision; this.projects = index.projects;
    this.rows = index.cards.filter(c => c.questions?.length && c.answerShort?.trim() && !['missing', 'draft'].includes(c.status)).map(card => ({ card,
      questions: card.questions.map(text => {
        const project=index.projects.find(p=>p.id===card.projectId);
        const key=[project.name,...project.aliases,project.id].reduce((q,name)=>q.replaceAll(normalize(name),''),normalize(text));
        return {text,key,grams:grams(key),constraints:constraints(key)};
      }) }));
  }
  match(question, { projectId = '', referenceContext = '', detailed = false } = {}) {
    const start = performance.now();
    const mentions = this.projects.filter(p => [p.name, ...(p.aliases || []), p.id].some(n => n && question.toLowerCase().includes(n.toLowerCase())));
    let scope = mentions.map(p => p.id);
    if (!scope.length && projectId) scope = [projectId];
    if (!scope.length && referenceContext) scope = this.projects.filter(p => [p.name, ...p.aliases].some(n => referenceContext.includes(n))).map(p => p.id);
    const pool = this.rows.filter(r => scope.length ? scope.includes(r.card.projectId) : this.projects.find(p => p.id === r.card.projectId)?.kind === 'knowledge');
    const key = mentions.reduce((q, p) => [p.name, ...p.aliases, p.id].reduce((s, n) => s.replaceAll(normalize(n), ''), q), normalize(question));
    const queryGrams = grams(key);
    const ranked = pool.map(row => {
      const best = row.questions.filter(q=>q.constraints===constraints(key)).map(q => ({ q, score: q.key === key ? 1 : [...queryGrams].filter(g => q.grams.has(g)).length / Math.max(queryGrams.size, q.grams.size, 1) }))
        .sort((a, b) => b.score - a.score)[0];
      return { ...row, ...best };
    }).filter(r=>r.q).sort((a, b) => b.score - a.score);
    const first = ranked[0], second = ranked[1], margin = first ? first.score - (second?.score || 0) : 0;
    let reason = 'no-match';
    if (first) {
      const c = first.card;
      if (c.qa?.enabled === false || c.qa?.delivery === 'evidence_only') reason = 'disabled-or-evidence-only';
      else if (scope.length > 1) reason = 'ambiguous-project';
      else if (c.qa?.excludeIntents?.some(t => normalize(question).includes(normalize(t)))) reason = 'excluded-intent';
      else if (c.qa?.mustCover?.some(t => !normalize(question).includes(normalize(t)))) reason = 'incomplete-coverage';
      else if (first.score < 0.9 || first.score < 1 && (key.length < 8 || margin < 0.15)) reason = 'insufficient-coverage-or-margin';
      else if (ranked.some((r, i) => i && (first.score===1?r.score===1:r.score >= first.score - 0.05) && (r.card.answerShort !== c.answerShort || r.card.applicableVersion !== c.applicableVersion))) reason = 'conflicting-answers';
      else reason = 'verbatim';
    }
    const answer = reason === 'verbatim' ? (detailed && (first.card.qa?.answerDetailed || first.card.deepPoints.join('\n\n')) || first.card.answerShort) : '';
    const boundaries = first?.card.boundaries || [];
    return { direct: reason === 'verbatim', reason, answer: answer ? [answer, ...boundaries.filter(b => !answer.includes(b))].join('\n\n') : '',
      cardId: first?.card.cardId, standardQuestion: first?.card.questions[0], projectId: first?.card.projectId,
      version: first?.card.applicableVersion, revision: this.revision, score: first?.score || 0, margin,
      candidates: ranked.slice(0, 3).map(r => ({ cardId: r.card.cardId, score: r.score })), selectionMs: performance.now() - start };
  }
}
module.exports = { QAIndex, normalize };
