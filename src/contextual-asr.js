'use strict';
const RULES = [
  {id:'ablation',pattern:/骁龙实验/g,to:'消融实验',context:/实验|对照|评测|benchmark|SWE/i,protect:/芯片|手机|高通/},
  {id:'harness',pattern:/Honey词|行业/g,to:'harness',context:/评测|测试框架|SWE|benchmark/i,protect:/行业(?:发展|趋势|公司|前景)|制造业/},
  {id:'swe-bench',pattern:/Sweetie\s*Bench/gi,to:'SWE-bench',context:/修复|题|评测|300|benchmark/i},
  {id:'rerank',pattern:/R\s*lang/gi,to:'Rerank',context:/召回|重排|检索|稀疏|稠密/i,protect:/统计|语言|绘图/},
  {id:'react-agent',pattern:/\bReact\b/g,to:'ReAct',context:/Agent|推理.*行动|工具调用|智能体/i,protect:/前端|组件|hooks|jsx|框架/i},
  {id:'plan-execute',pattern:/\bPNE\b|\bP&E\b/g,to:'Plan-and-Execute',context:/Agent|规划|执行|对照|评测/i}
];
function normalize(rawText, contextText='') {
  let text=String(rawText||''); const rules=[];
  for(const rule of RULES) {
    if(!rule.context.test(text+'\n'+contextText)||rule.protect?.test(text))continue;
    const next=text.replace(rule.pattern,rule.to);
    if(next!==text)rules.push({ruleId:rule.id,confidence:0.85,basis:'current-or-recent-topic',before:text,after:next});
    text=next;
  }
  return {rawText:String(rawText||''),normalizedText:text,rules};
}
module.exports={normalize,RULES};
