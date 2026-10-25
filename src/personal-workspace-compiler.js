'use strict';
// Offline compiler: input attachments remain local; only anonymous schemas/tests belong in Git.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {validateIndex,migrateCard} = require('./project-fact-packs');
const {validatePersonalWorkspace,sanitizeResumeForPrompt} = require('./personal-workspace');
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const read = file => fs.readFileSync(file,'utf8');
function safeRead(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '..' || p === '.')) throw new Error('来源路径无效');
  const file = path.join(root,relative), stat=fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(file).startsWith(fs.realpathSync(root)+path.sep)) throw new Error('来源必须是目录内的普通文件');
  return fs.readFileSync(file);
}
function verifyAttachments(taskDirectory) {
  const manifest = JSON.parse(read(path.join(taskDirectory,'manifest.json')));
  if (!Array.isArray(manifest.files)) throw new Error('任务来源清单缺失');
  return manifest.files.map(entry => {
    const data = safeRead(taskDirectory,entry.path);
    if (data.length !== entry.bytes || sha(data) !== entry.sha256) throw new Error('任务来源摘要不匹配：'+entry.path);
    return {path:entry.path,bytes:data.length,sha256:entry.sha256};
  });
}
function docType(question) {
  if (/职责|个人|团队/.test(question.topic)) return 'ownership';
  if (/指标|Token|SWE|受理边界|协作代价|消融/.test(question.topic)) return 'performance';
  if (/选型|一致性|消息|并发资源/.test(question.topic)) return 'decision';
  if (/故障|困难|排障/.test(question.topic)) return 'challenge';
  if (/边界|共享任务|Mailbox/.test(question.topic)) return 'limitation';
  return 'implementation';
}
function compilePersonalWorkspace({taskDirectory,baselinePath,resumeText,auditPath,sourceRoots={}}) {
  taskDirectory = path.resolve(taskDirectory);
  const sourceManifest = verifyAttachments(taskDirectory), seedPath='handoff/data/project_profile_seed.json', seedText=read(path.join(taskDirectory,'data/project_profile_seed.json')), seed=JSON.parse(seedText);
  if (seed.schema_version !== 'cue_handoff_seed_v1' || seed.candidate_profile?.subject_role !== 'candidate') throw new Error('资料 seed 类型或候选人主体无效');
  const seedSource = symbol => ({path:seedPath,symbol,commit:null,contentSha256:sha(seedText),artifactPath:'data/project_profile_seed.json',artifactSha256:sha(seedText)});
  const rawSource = (relative,symbol) => {const entry=sourceManifest.find(r => r.path===relative); if(!entry)throw new Error('原始来源未登记：'+relative);return {path:'handoff/'+relative,symbol,commit:null,contentSha256:entry.sha256,artifactSha256:entry.sha256};};
  const baseline = baselinePath ? JSON.parse(read(baselinePath)) : null;
  if (baseline) validatePersonalWorkspace(baseline);
  const audit = auditPath && fs.existsSync(auditPath) ? JSON.parse(read(auditPath)) : {cards:[]};
  const auditRows = new Map((audit.cards || []).map(row=>[row.cardId,row]));
  const sourceDocuments = {...baseline?.facts.sourceDocuments,[seedPath]:seedText};
  const mergeLog = [], cards = [];
  for (const original of baseline?.facts.cards || []) {
    let card=migrateCard(original), review=auditRows.get(original.cardId);
    const changes=[];
    if (review?.replacementText) {card.text=review.replacementText;card.answerShort=card.text;card.deepPoints=card.text.split(/\n\s*\n/);card.sources.push(seedSource('legacy_review['+card.cardId+']'));changes.push('amended-from-authoritative-attachments');}
    if (original.provenance==='USER') {
      card.status='source-claim';card.implementation='resume_claim';
      if (!review) {card.status='draft';card.truthScope='unverified';card.implementation='resume_claim';card.boundaries.push('旧用户资料待按本轮附件核对；不得据此扩写历史细节。');changes.push('legacy-review-required');}
    }
    if (original.provenance==='CODE') {
      const checks=[];
      for (const check of review?.codeChecks || []) {
        const file=check.localPath ? path.resolve(check.localPath) : sourceRoots[card.projectId] ? path.join(sourceRoots[card.projectId],check.path) : null;
        if (!file || !fs.existsSync(file)) throw new Error('源码核查文件缺失：'+card.cardId+' '+check.path);
        const body=fs.readFileSync(file), contentSha256=sha(body);
        if (check.contentSha256 && check.contentSha256!==contentSha256) throw new Error('源码核查摘要变化：'+check.path);
        const symbol=check.symbol || body.toString('utf8').split('\n').find(line=>line.trim())?.trim();
        if (!/^[a-f0-9]{40}$/.test(check.commit) || !symbol || !body.toString('utf8').includes(symbol)) throw new Error('源码核查提交或符号无效：'+card.cardId);
        checks.push({path:check.path,commit:check.commit,symbol,contentSha256});
        // Self-contained fixed-version source text; keep the original reference path too.
        sourceDocuments['code/'+card.projectId+'/'+check.path]=body.toString('utf8');
      }
      if(checks.length) {card.status='verified';card.implementation='current_public_repo';card.verification={method:'source-review',checkedSources:checks};card.sources=checks.map(check=>({...check,path:'code/'+card.projectId+'/'+check.path,repositoryPath:check.path}));changes.push('actual-source-review');}
      else {card.status='source-claim';card.boundaries.push('旧代码卡尚未完成本次实际源码复核；不作为独立验证。');changes.push('code-not-reverified');}
    }
    if (original.provenance==='LOCAL-BENCH') {
      const experiment=review?.experiment || (review?.recommendedExperiment ? {...review.recommendedExperiment,localPath:review.codeChecks?.[0]?.localPath} : null);
      if (experiment) {
        const body=fs.readFileSync(experiment.localPath), contentSha256=sha(body), reportPath='code/'+card.projectId+'/'+experiment.reportPath;
        if(contentSha256!==experiment.contentSha256)throw new Error('实验报告摘要不匹配');
        sourceDocuments[reportPath]=body.toString('utf8');
        card.provenance='LOCAL-BENCH';card.status='source-claim';card.implementation='unverified_reference';card.experiment={reportPath,contentSha256,verificationScope:'published-report-not-independent-rerun',performedBy:experiment.performedBy,performedAt:experiment.performedAt};
        card.sources=[{path:reportPath,symbol:'published benchmark',commit:null,contentSha256}];changes.push('published-benchmark-report-preserved');
      }
    }
    for(const [key,reviewKey] of [['provenance','recommendedProvenance'],['status','recommendedStatus'],['implementation','recommendedImplementation'],['truthScope','recommendedTruthScope']]) if(review?.[reviewKey])card[key]=review[reviewKey];
    if(card.provenance==='REFERENCE-STORY') {
      const scenario=seed.narrative_scenarios.find(s=>s.id===review?.storyId);
      if(!scenario)throw new Error('旧叙事卡缺少对应场景：'+card.cardId);
      card.story={background:scenario.background,trigger:scenario.trigger,investigation:scenario.investigation,attempts:[scenario.alternative_and_rejection],solution:scenario.solution,tradeoff:scenario.tradeoff_and_remaining_risk,validationMethod:scenario.validation_plan,remainingIssues:scenario.tradeoff_and_remaining_risk};
      card.related=[...new Set([...card.related,scenario.id])];card.boundaries.push(scenario.usage);
    }
    card.history=[...(card.history||[]),{schemaVersion:1,reason:review?.reason||'v1-compatible-migration',original:copy(original)}];
    card.applicableVersion=original.sources.find(s=>s.commit)?.commit || 'legacy-user-supplied';
    if(!card.facts?.length) {
      const claims=(card.deepPoints?.length?card.deepPoints:[card.text]).flatMap(value=>String(value).split(/(?<=[。！？；])\s*|\n+/)).map(value=>value.trim()).filter(Boolean);
      card.facts=claims.map((value,index)=>({key:card.cardId+'.claim-'+(index+1),value,scope:card.implementation,applicableVersion:card.applicableVersion}));
    }
    card.boundaries=[...new Set([...card.boundaries,...(review?.boundaries||[])])];
    if(review?.reason)card.cannotSay=[...new Set([...card.cannotSay,...(review.cannotSay||[])])];
    mergeLog.push({cardId:card.cardId,action:changes.length?'update':'retain',reason:review?.reason||'stable-id-preserved',changes,oldSha256:sha(JSON.stringify(original)),newSha256:sha(JSON.stringify(card))});cards.push(card);
  }
  const ids=new Set(cards.map(c=>c.cardId));
  function add(card, collection, original) {
    if (ids.has(card.cardId)) throw new Error('新增资料稳定 ID 冲突：'+card.cardId);
    card.seedOrigin={collection,id:original.id};ids.add(card.cardId);cards.push(card);mergeLog.push({cardId:card.cardId,action:'add',source:collection,sourceId:original.id});
  }
  for (const q of seed.question_answers) {
    const user=/^resume_claim/.test(q.evidence_kind), future=/proposed_design|design_for_validation/.test(q.evidence_kind);
    const general=q.project_id==='general';
    const provenance=user?'USER':future?'FUTURE':'REFERENCE';
    const implementation=user?'resume_claim':future?'proposed_design':general?'general_knowledge':'unverified_reference';
    const boundaries=[...q.boundaries], cannotSay=[...q.boundaries];
    if(!user&&!general)boundaries.push('附件问答为设计与实现参考；具体当前代码实现以独立源码证据为准。');
    const relevantStories=seed.narrative_scenarios.filter(s=>s.source_refs.includes(q.id)).map(s=>s.id);
    const text=[q.question,q.answer_short,...boundaries.map(b=>'边界：'+b),'追问：'+q.followup_questions.join('；')].join('\n');
    const sources=[seedSource('question_answers[id='+q.id+']')];
    if(user)sources.push(rawSource('inputs/resume.pdf','resume claim'));
    add({cardId:q.id,projectId:q.project_id,docType:docType(q),truthScope:future?'planned':user?'implemented':'unverified',status:'source-claim',provenance,implementation,
      path:'handoff/qa/'+q.id+'.md',topic:q.topic,questions:[q.question],answerShort:q.answer_short,deepPoints:[q.answer_short],facts:[{key:q.id+'.answer',value:q.answer_short}],boundaries,cannotSay,followups:q.followup_questions,
      applicableVersion:general?'general-knowledge-2026-10-24':seed.upstream_shas[q.project_id]||'resume-2026-10-24',text,keywords:[q.topic,q.question,...q.followup_questions],related:relevantStories,sources,sourceRefs:q.source_refs,evidenceKind:q.evidence_kind,answerMethod:q.answer_method},'question_answers',q);
  }
  for (const s of seed.narrative_scenarios) {
    const story={background:s.background,trigger:s.trigger,investigation:s.investigation,attempts:[s.alternative_and_rejection],solution:s.solution,tradeoff:s.tradeoff_and_remaining_risk,validationMethod:s.validation_plan,remainingIssues:s.tradeoff_and_remaining_risk};
    add({cardId:s.id,projectId:s.project_id,docType:'challenge',truthScope:'hypothetical',status:'source-claim',provenance:'REFERENCE-STORY',implementation:'narrative_scenario',path:'handoff/stories/'+s.id+'.md',topic:s.title,questions:[s.title+'怎么排查和解决？'],answerShort:s.first_person_narrative_example,
      deepPoints:[s.background,s.trigger,s.investigation,s.alternative_and_rejection,s.solution,s.validation_plan,s.tradeoff_and_remaining_risk],facts:[{key:s.id+'.scenario',value:s.solution}],boundaries:[s.usage],cannotSay:['不可据此声称真实事故已经发生、实验已经执行或源码拥有尚未验证的保证。'],followups:['为什么不用更简单的方案？','如何验证方案有效？'],applicableVersion:seed.upstream_shas[s.project_id],
      text:[s.title,s.first_person_narrative_example,...Object.entries(story).map(([k,v])=>k+'：'+(Array.isArray(v)?v.join('；'):v)),'范围：'+s.usage].join('\n'),keywords:[s.title,...s.source_refs],related:s.source_refs,sources:[seedSource('narrative_scenarios[id='+s.id+']')],story,verificationStatus:s.verification_status},'narrative_scenarios',s);
  }
  for (const m of seed.metric_claims) {
    add({cardId:'metric.'+m.id,projectId:m.project_id,docType:'performance',truthScope:'test_only',status:'source-claim',provenance:'USER',implementation:'resume_claim',path:'handoff/metrics/'+m.id+'.md',topic:m.id,questions:[m.value+'的测试口径是什么？'],answerShort:m.value+'；'+m.scope,deepPoints:[m.scope],facts:[{key:m.id,value:m.value,scope:m.scope}],boundaries:[m.scope,'该指标来自简历声明，本次没有独立重跑原始实验。'],cannotSay:['不得生成原始日志、扩展未给样本或与公开本地 benchmark 拼成前后对照。'],followups:['计时边界是什么？','如何复现并判断质量？'],applicableVersion:'resume-2026-10-24',text:m.value+'\n口径：'+m.scope+'\n来源：简历声明，未经独立重跑。',keywords:[m.value,m.scope,m.id],related:seed.question_answers.filter(q=>q.project_id===m.project_id&&q.evidence_kind.includes('resume_claim')&&q.answer_short.includes(m.value.split('%')[0])).map(q=>q.id),sources:[seedSource('metric_claims[id='+m.id+']'),rawSource(m.source,'metric '+m.id)],independentlyVerified:false},'metric_claims',m);
  }
  const originalProjects=baseline?.facts.projects || [{id:'cae',name:'CAE',aliases:['CAE-Platform']},{id:'arclight',name:'Arclight',aliases:['MewCode','mewcode']}];
  const projects=originalProjects.filter(p=>p.id!=='general').map(p=>({...p,resumeOrder:seed.candidate_profile.resume_project_order.indexOf(p.id)+1})).sort((a,b)=>a.resumeOrder-b.resumeOrder);
  projects.push({id:'general',name:'通用知识与岗位准备',aliases:['通用知识','岗位准备'],kind:'knowledge'});
  const originalResume=resumeText || read(path.join(taskDirectory,'inputs/resume-parsed.txt')), resume=sanitizeResumeForPrompt(originalResume).trim();
  sourceDocuments['handoff/inputs/resume-model.txt']=resume;
  const jdText=read(path.join(taskDirectory,'inputs/job_descriptions.txt')), marker=jdText.indexOf('岗位2');
  if(marker<0)throw new Error('岗位文件未找到两个独立岗位');
  sourceDocuments['handoff/inputs/job_descriptions.txt']=jdText;
  const cp=seed.candidate_profile;
  const candidateProfile={name:cp.name,subjectRole:'candidate',status:cp.status,source:rawSource(cp.source,'candidate profile'),education:cp.education,availability:cp.availability,employment:cp.employment,resumeProjectOrder:cp.resume_project_order,projects:cp.projects,doNotInfer:cp.do_not_infer,contactPolicy:cp.contact_policy};
  const jobProfiles=seed.job_profiles.map((job,i)=>({id:job.id,label:i===0?'淘天供应链 AI 算法工程师':'基础安全 Java 后端实习',jobDescription:(i===0?jdText.slice(0,marker):jdText.slice(marker)).trim(),priorityTopics:job.priority_topics,source:rawSource('inputs/job_descriptions.txt',i===0?'岗位1':'岗位2'),selfIntroductions:selfIntroductions(cp,job.id)}));
  const facts=validateIndex({schemaVersion:2,projects,cards,sourceDocuments,provenanceNotes:{schema:'v2-explicit-scope',metricClaims:'USER/source-claim; no independent rerun',narrativeScenarios:'REFERENCE-STORY; not historical evidence',general:'kind:knowledge; excluded from resume project order',codeBoundaries:seed.code_boundaries,sourceIdMap:seed.source_id_map},updatedAt:seed.created_at});
  const workspace=validatePersonalWorkspace({schemaVersion:2,facts,profile:{resumeText:resume,jobDescription:jobProfiles[0].jobDescription,candidateProfile,jobProfiles,activeJobProfileId:'ai_supply_chain'},sourceManifest,mergeLog});
  return {workspace,manifest:{schemaVersion:2,workspaceRevision:workspace.revision,factsSha256:sha(JSON.stringify(facts)),counts:{cards:cards.length,legacy:baseline?.facts.cards.length||0,qa:seed.question_answers.length,stories:seed.narrative_scenarios.length,metrics:seed.metric_claims.length,knowledge:cards.filter(c=>c.projectId==='general').length,verifiedCode:cards.filter(c=>c.provenance==='CODE'&&c.status==='verified').length,sources:sourceManifest.length},sourceManifest,privateOnly:true},mergeLog};
}
function selfIntroductions(cp,id) {
  const start='我是'+cp.name+'，目前在暨南大学攻读网络空间安全硕士，预计 2028 年毕业。';
  if(id==='ai_supply_chain')return {seconds30:start+'希望申请供应链 AI 算法岗位。我做过 Arclight 编程 Agent，重点是 Agent Loop、上下文管理和评测，能把模型调用、工具执行与测试串成可检查的闭环。',seconds60:start+'希望申请供应链 AI 算法岗位。我在个人项目 Arclight 中实现 Agent Loop、上下文预算、MCP 按需工具加载与多代理协作，并关注任务完成质量和 Token 成本的取舍。此前 CAE 后端经历让我重视状态、身份和可靠数据链路。我希望把这些能力迁移到供应链问题建模、工具与评测中；模型后训练和供应链世界模型属于继续学习与设计的方向。'};
  return {seconds30:start+'希望申请基础安全 Java 后端实习。我做过 CAE 任务平台后端，重点负责可靠受理、Job 与 Execution 状态以及资源约束，能结合事务、幂等和对账讨论故障边界。',seconds60:start+'希望申请基础安全 Java 后端实习。我在 CAE 项目中负责统一提交与批量编排、资源预占、Outbox、消费幂等和执行对账，也做输入治理及报告阶段重试。我习惯先界定身份、状态和事务边界，再用故障场景验证。安全专业背景帮助我理解鉴权与隔离的要求，完整 KMS 和权限中台属于可迁移设计方向。我每周可到岗五天、连续实习六个月，具体到岗日期按当前安排确认。'};
}
module.exports={compilePersonalWorkspace,verifyAttachments,sha};
