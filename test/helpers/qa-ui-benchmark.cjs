'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
module.exports=async({js,requests,output})=>{
  const {library}=require('../../scripts/benchmark-live-interaction.cjs'),source=library(),times=[];
  source.projects[0].kind='knowledge';for(const item of source.items)item.delivery='prefer_verbatim';
  await js(`(async()=>{const preview=await cue.qaPrepare({text:${JSON.stringify(JSON.stringify(source))}});return cue.qaCommit(preview);})()`);
  const calls=requests.length;
  for(let i=0;i<100;i++){
    const question='杉木平台'+source.items[i].question,expected=source.items[i].answerShort;
    const duration=await js(`(async()=>{
      await cue.dialogueEvent({eventId:'ui-qa-benchmark-${i}',utteranceKey:'ui-qa-${i}',utteranceOrder:${i},sourceId:'ui-benchmark',channel:'them',speaker:'interviewer',text:${JSON.stringify(question)},isFinal:false});
      return new Promise((resolve,reject)=>{
        const started=performance.now(),watch=new MutationObserver(()=>{
          const text=document.querySelector('.response-group:first-child .ai-text')?.textContent||'';
          if(text.includes(${JSON.stringify(expected)})){watch.disconnect();clearTimeout(timer);resolve(performance.now()-started);}
        });
        const timer=setTimeout(()=>{watch.disconnect();reject(new Error('No direct answer DOM'));},2000);
        watch.observe(document.body,{subtree:true,childList:true,characterData:true});
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true}));
      });
    })()`);
    times.push(duration);
  }
  assert.equal(requests.length,calls);
  const sorted=[...times].sort((a,b)=>a-b),result={build:require('../../src/build-info').getBuildIdentity(),measuredAt:new Date().toISOString(),environment:{electron:process.versions.electron,node:process.version,platform:process.platform,cpu:require('os').cpus()[0].model},samples:times.length,cards:1000,modelCalls:0,p50:sorted[49],p95:sorted[94],max:sorted.at(-1),
    boundary:'Synthetic foreground DOM Ctrl+Enter to answer text inserted in actual Electron DOM. Hot material/OS caches. No physical keypress or pixel-paint timing.',times};
  if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));}
  return result;
};
