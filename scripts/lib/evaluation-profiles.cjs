'use strict';
// Versioned offline evaluation budgets. Product deadlines/output settings are
// supplied through normal settings and never silently rewritten in the adapter.
const VERSION = 'cue-evaluation-profile-v2';
const PROFILES = Object.freeze({
  smoke: { repeats:1, sessionLimit:2, concurrency:2, retryLimit:1, timeoutMs:90000, outputCeiling:8192 },
  regression: { repeats:1, sessionLimit:20, concurrency:2, retryLimit:1, timeoutMs:90000, outputCeiling:8192 },
  deep: { repeats:3, sessionLimit:20, concurrency:4, retryLimit:2, timeoutMs:120000, outputCeiling:16384 },
  stress: { repeats:3, sessionLimit:100, concurrency:4, retryLimit:2, timeoutMs:120000, outputCeiling:16384 }
});
const integer = (value,min,max,name) => { if(!Number.isInteger(value)||value<min||value>max)throw new Error('Invalid evaluation '+name);return value; };
function resolveProfile(input={},providerCount=2) {
  const name=input.profile||'smoke', base=PROFILES[name]; if(!base)throw new Error('Unknown evaluation profile.');
  const repeats=integer(input.repeats??base.repeats,1,20,'repetitions');
  const concurrency=integer(input.concurrency??base.concurrency,1,4,'concurrency');
  const retryLimit=integer(input.retryLimit??base.retryLimit,0,3,'retry limit');
  const timeoutMs=integer(input.timeoutMs??base.timeoutMs,60000,120000,'offline timeout');
  const outputCeiling=integer(input.outputCeiling??base.outputCeiling,1,16384,'output ceiling');
  const shardCount=integer(input.shardCount??1,1,100,'shard count');
  const shardIndex=integer(input.shardIndex??0,0,shardCount-1,'shard index');
  if(input.sessionIds!=null&&(!Array.isArray(input.sessionIds)||!input.sessionIds.length||input.sessionIds.length>100||new Set(input.sessionIds).size!==input.sessionIds.length))throw new Error('Invalid session selection.');
  return {version:VERSION,name,...base,repeats,concurrency,retryLimit,timeoutMs,outputCeiling,shardCount,shardIndex,sessionIds:input.sessionIds||null,providerCount};
}
function buildTasks(sessions,profile,providerIds) {
  const selected=profile.sessionIds?sessions.filter(s=>profile.sessionIds.includes(s.id)):sessions.slice(0,profile.sessionLimit);
  if(profile.sessionIds&&selected.length!==profile.sessionIds.length)throw new Error('Unknown selected session.');
  const tasks=[];let ordinal=0;
  for(const provider of providerIds)for(let repeat=0;repeat<profile.repeats;repeat++)for(const session of selected){
    if(ordinal++%profile.shardCount===profile.shardIndex)tasks.push({provider,repeat,session});
  }
  return tasks;
}
module.exports={VERSION,PROFILES,resolveProfile,buildTasks};
