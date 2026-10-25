'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const time=value=>new Date(Number.isFinite(value)?value:Date.now()).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const text=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/\0/g,'');
const role=speaker=>({candidate:'本人',interviewer:'面试官',unknown:'说话人待确认'})[speaker]||'说话人待确认';

// Append confirmed observations asynchronously. The conversation ledger may
// evict old events, but this file keeps the whole session and revision history.
class InterviewTranscriptRecorder {
  constructor({directory,enabled=true,onStatus=()=>{},io=fs.promises}={}) {
    this.directory=directory;this.enabled=enabled;this.onStatus=onStatus;this.io=io;
    this.pending=Promise.resolve();this.file=null;this.sessionId=null;this.lastError=null;this.pendingBytes=0;
  }
  status(){return {enabled:this.enabled,fileName:this.file?.name||null,savedEntries:this.file?.savedEntries||0,
    pendingBytes:this.pendingBytes,error:this.lastError};}
  notify(){try{this.onStatus(this.status());}catch{/* Recording must not interrupt an answer. */}}
  configure(enabled){
    enabled=enabled!==false;
    if(this.enabled===enabled)return;
    if(!enabled)this.endSession('已暂停记录');
    this.enabled=enabled;this.notify();
  }
  startSession(sessionId){
    if(this.sessionId===sessionId)return;
    this.endSession('本次会话结束');this.sessionId=sessionId;
  }
  endSession(reason='本次会话结束'){
    if(this.file)this.append(this.file,`\n[${time()}] ${reason}\n`);
    this.file=null;this.notify();
  }
  ensureFile(sessionId){
    if(!this.enabled)return null;
    if(!this.sessionId)this.startSession(sessionId);
    if(sessionId!==this.sessionId)return null;
    if(!this.file){
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      this.file={name:`CUE-面试-${stamp}-${randomUUID().slice(0,8)}.txt`,seen:new Map(),answers:new Set(),savedEntries:0};
      this.append(this.file,`\uFEFFCUE 面试对话记录\n开始：${time()}（北京时间）\n会话：${text(sessionId)}\n真人发言按识别确认顺序保存；修订保留原记录。手动输入和 CUE 建议另行标注，不代表本人已说出。\n`);
    }
    return this.file;
  }
  append(file,body,{entry=false}={}){
    const bytes=Buffer.byteLength(body);
    if(this.pendingBytes+bytes>16*1024*1024){this.lastError={code:'recording-backlog',message:'记录积压过多，部分内容尚未保存。请检查磁盘并及时备份当前对话。'};this.notify();return;}
    this.pendingBytes+=bytes;
    this.pending=this.pending.then(async()=>{
      await this.io.mkdir(this.directory,{recursive:true,mode:0o700});
      await this.io.appendFile(path.join(this.directory,file.name),body,{encoding:'utf8',mode:0o600});
      if(entry)file.savedEntries++;
    }).catch(error=>{
      this.lastError={code:typeof error.code==='string'?error.code:'recording-write-failed',message:'面试记录保存失败，当前转写仍可在界面查看。请检查磁盘空间和目录权限。'};
    }).finally(()=>{this.pendingBytes-=bytes;this.notify();});
  }
  recordEvent(event){
    if(!event?.isFinal||!text(event.text).trim())return;
    const file=this.ensureFile(event.sessionId);if(!file)return;
    const signature=createHash('sha256').update(JSON.stringify([event.revision,event.speaker,event.text])).digest('hex');
    if(file.seen.get(event.eventId)===signature)return;
    const revision=file.seen.has(event.eventId);file.seen.set(event.eventId,signature);
    const label=`${revision?'修订 · ':''}${role(event.speaker)}`;
    this.append(file,`\n[${time(event.receivedAt)}] ${label}\n${text(event.text)}\n（发言 ${text(event.eventId)} · 版本 ${event.revision}）\n`,{entry:true});
  }
  recordManualQuestion({sessionId,requestId,question}){
    const file=this.ensureFile(sessionId);if(!file||!text(question).trim()||file.answers.has('question:'+requestId))return;
    file.answers.add('question:'+requestId);
    this.append(file,`\n[${time()}] 手动输入的问题（非语音记录）\n${text(question)}\n`,{entry:true});
  }
  recordAnswer({sessionId,requestId,question,answer}){
    const file=this.ensureFile(sessionId);if(!file||!text(answer).trim()||file.answers.has(requestId))return;
    file.answers.add(requestId);
    this.append(file,`\n[${time()}] CUE 建议（未确认说出）\n对应问题：${text(question)}\n${text(answer)}\n`,{entry:true});
  }
  async flush(){await this.pending;return this.status();}
}

module.exports={InterviewTranscriptRecorder};
