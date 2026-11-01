'use strict';
// Only a small allowlist of generic technology names is sent to the public API;
// interview text, project names and personal data never leave via this lookup.
const TERMS = [
  [/\b(?:sql|mysql|postgresql)\b|数据库|数据表/i,'SQL'],
  [/\bredis\b|缓存/i,'Redis'], [/\b(?:java|jvm)\b|虚拟机/i,'Java虚拟机'],
  [/\bkafka\b|消息队列/i,'消息队列'], [/\b(?:http|tcp)\b|网络协议/i,'TCP'],
  [/\b(?:llm|大语言模型)\b|大模型/i,'大语言模型'], [/\b(?:agent|智能体)\b/i,'智能体'],
  [/负载均衡|负载平衡/i,'负载均衡'], [/并发|多线程/i,'并发计算'], [/事务隔离|数据库事务/i,'数据库事务'],
  [/算法|时间复杂度/i,'算法'], [/\bpython\b/i,'Python'], [/机器学习/i,'机器学习'],
];
const cache=new Map(), pending=new Map();
function queryFor(text) { return [...new Set(TERMS.filter(([re])=>re.test(text)).map(([,term])=>term))].slice(0,3).join(' '); }
function plain(text) {return String(text || '').replace(/<[^>]*>/g,'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,400);}
async function lookup(question,{fetchImpl,signal,timeoutMs=1500,ignorePending=false}={}) {
  const query=queryFor(question);
  if(!query) return {status:'no-supported-terms',sources:[]};
  if(typeof fetchImpl!=='function')return {status:'unavailable',sources:[]};
  const previous=cache.get(query);if(previous && Date.now()-previous.at<(previous.value.status==='ok'?300000:30000))return {...previous.value,cached:true};
  if (!ignorePending && pending.has(query)) return pending.get(query);
  const url=new URL('https://zh.wikipedia.org/w/api.php');
  for(const [key,value] of Object.entries({action:'query',list:'search',srsearch:query,srlimit:'3',format:'json',utf8:'1'}))url.searchParams.set(key,value);
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  let timer;
  try {
    const request=(async()=>{const response=await fetchImpl(url.toString(),{signal:controller.signal,headers:{accept:'application/json'}});
      if(!response.ok)throw new Error('http');const body=await response.text();if(body.length>200000)throw new Error('oversize');
      const results=JSON.parse(body).query?.search;if(!Array.isArray(results))throw new Error('shape');
      return results.slice(0,3).map(row=>({title:plain(row.title),snippet:plain(row.snippet)})).filter(row=>row.title&&row.snippet);
    })();
    const sources=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('timeout'));},timeoutMs);})]);
    const value={status:sources.length?'ok':'no-results',sources};if(sources.length){cache.set(query,{at:Date.now(),value});while(cache.size>64)cache.delete(cache.keys().next().value);}return value;
  } catch { const value={status:signal?.aborted?'canceled':'unavailable',sources:[]};if(value.status==='unavailable'){cache.set(query,{at:Date.now(),value});while(cache.size>64)cache.delete(cache.keys().next().value);}return value; }
  finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function prime(question,fetchImpl) {
  const query=queryFor(question);if(!query||typeof fetchImpl!=='function'||pending.has(query))return;
  const previous=cache.get(query);if(previous&&Date.now()-previous.at<(previous.value.status==='ok'?300000:30000))return;
  const task=lookup(question,{fetchImpl,ignorePending:true}).finally(()=>pending.delete(query));pending.set(query,task);
}
module.exports={queryFor,lookup,prime};
