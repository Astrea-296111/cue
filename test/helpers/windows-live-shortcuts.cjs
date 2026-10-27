'use strict';
const fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({win,js,events,output})=>{
  const result={platform:process.platform,status:'unverified',scope:'Windows CI desktop; native synthetic keybd_event chords, real globalShortcut and renderer actions; screen capture/model mocked. No physical user keyboard or audio claim.',rows:[]};
  if(process.platform!=='win32'){result.reason='Requires Windows';return result;}
  try{
    const koffi=require('koffi'),user32=koffi.load('user32.dll'),key=user32.func('void keybd_event(uint8_t,uint8_t,uint32_t,uintptr_t)');
    for(const focus of ['foreground','input','background']){
      if(focus==='background')win.hide();
      else{win.show();win.focus();await js(focus==='input'?"document.getElementById('input').focus()":"document.activeElement?.blur()");}
      await pause(180);
      for(const [mode,vk,shift] of [['leetcode',0x48,false],['assist',0xBF,true]]){
        const before=events.length;key(0x11,0,0,0);if(shift)key(0x10,0,0,0);key(vk,0,0,0);key(vk,0,2,0);if(shift)key(0x10,0,2,0);key(0x11,0,2,0);
        const until=Date.now()+2000;while(events.length===before&&Date.now()<until)await pause(20);await pause(180);
        const received=events.slice(before).filter(e=>e.channel==='llm:start');
        const passed=received.length===1&&received[0].mode===mode;
        result.rows.push({focus,key:shift?'Ctrl+?':'Ctrl+H',expected:mode,received:received.map(e=>e.mode),passed});
        if(!passed)throw new Error('Native shortcut did not produce one expected action');
      }
    }
    result.status='passed';
  }catch(error){result.status='unverified';result.reason=error.message;}
  finally{win.show();win.focus();if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));}}
  return result;
};
