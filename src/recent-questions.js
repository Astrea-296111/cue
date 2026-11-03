'use strict';
const {QuestionResolver,isLikelyCompleteQuestion}=require('./question-resolver');

// An independent speech-only resolver: clearing or answering the live target
// must never mutate this rolling history.
class RecentQuestions {
  constructor(limit=6) { this.limit=limit; this.resolver=new QuestionResolver(); this.items=[]; this.seen=new Set(); this.session=0; }
  newSession() { this.resolver.reset(); this.session++; this.seen.clear(); }
  speechState(data) { this.resolver.speechState(data); }
  observe(data, final) {
    if (data?.channel!=='them' || data.speaker==='candidate' || data.roleCorrected && data.speaker!=='interviewer') return;
    this.resolver.observe(data, final);
    const snapshot=this.resolver.resolveForSubmit({allowPartial:true});
    const parts=snapshot.segments || []; let context=[];
    for (const part of parts) {
      if (!isLikelyCompleteQuestion(part.text)) { context.push(part.text); continue; }
      const id=this.session+':'+part.id, text=[...context,part.text].filter(Boolean).join('\n'); context=[];
      // Interim and final fragments can temporarily form separate groups and
      // later coalesce. Reconcile by the resolver's actual utterance identities,
      // not text similarity, so a genuinely repeated question stays visible.
      const members=new Set((part.partIds || [part.id]).map(key=>this.session+':'+key));
      for (const member of members) if(member!==id) this.seen.add(member);
      const existing=this.items.find(item=>item.id===id) || this.items.find(item=>members.has(item.id));
      this.items=this.items.filter(item=>item===existing || !members.has(item.id));
      if (existing) { existing.id=id; existing.text=text; }
      else if (!this.seen.has(id)) { this.seen.add(id); this.items.push({id,text}); if(this.items.length>this.limit)this.items.shift(); }
    }
  }
  snapshot() { return this.items.map(({id,text})=>({id,text})); }
}
module.exports={RecentQuestions};
