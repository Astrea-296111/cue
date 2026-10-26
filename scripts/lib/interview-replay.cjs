'use strict';
// The original TXT is immutable. Canonicalize only the prefix available at the case's timestamp.
function adapt(testCase,allEvents=[]) {
  const historical=Number.isInteger(testCase.sourceEventIndex);
  const prefix=historical?allEvents.slice(0,testCase.sourceEventIndex):testCase.contextBefore||[];
  const latest=new Map(),revisions=[];
  for(const [index,event] of prefix.entries()) {
    if(!/^(?:本人|面试官|手动输入的问题（非语音记录）|角色待确认|说话人待确认|修订 · 说话人待确认)$/.test(event.role))continue;
    const rawText=String(event.text||''),match=/\n?（发言 ([^\n]+?) · 版本 (\d+)）\s*$/u.exec(rawText);
    const eventId=match?match[1].trim():'audit-input-'+(event.index??index),revision=match?Number(match[2]):1;
    const text=rawText.replace(/\n?（发言 [^\n]+ · 版本 \d+）\s*$/u,'').trim();if(!text)continue;
    const prior=latest.get(eventId);if(prior&&prior.revision>revision)continue;
    const speaker=event.role==='本人'?'candidate':event.role.includes('待确认')?'unknown':'interviewer';
    const timestamp=event.time?Date.parse(event.time.replace(/\//g,'-').replace(' ','T')+'+08:00'):null;
    const item={eventId,revision,speaker,channel:speaker==='candidate'||speaker==='unknown'&&/:you:/.test(eventId)?'you':'them',roleCorrected:event.role.startsWith('修订'),text,rawText,sourceIndex:event.index??index,
      startMs:prior?.startMs??timestamp,endMs:timestamp,role:event.role};
    latest.set(eventId,item);revisions.push({sourceIndex:item.sourceIndex,eventId,revision,replacesRevision:prior?.revision??null});
  }
  return {schemaVersion:1,source:'original transcript prefix',cutoffExclusive:historical?testCase.sourceEventIndex:null,
    prefixEvents:prefix.length,events:[...latest.values()],revisions,aiSuggestionsIncluded:false};
}
module.exports={adapt};
