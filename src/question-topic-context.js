'use strict';
const stripAuditMarker=text=>String(text||'').replace(/\n?（发言 [^\n]+ · 版本 \d+）\s*$/u,'').trim();
// Input is already grouped and bounded by LiveQuestionWindow; never search
// archived transcript fragments for a matching technology.
function reference(question, turns=[]) {
  if (!require('./live-context-policy').needsReference(stripAuditMarker(question))) return '';
  return turns.slice(-1).filter(t=>t.channel !== 'you').map(t=>stripAuditMarker(t.text)).filter(Boolean).join('\n');
}
module.exports={reference,stripAuditMarker};
