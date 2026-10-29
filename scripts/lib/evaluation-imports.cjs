'use strict';
const crypto=require('node:crypto');
// Private encrypted data only. Paths are never accepted from a remote payload.
function validateImports(value){
  if(value===undefined)return undefined;
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['qa','zips'].includes(k))||!Array.isArray(value.qa)||!Array.isArray(value.zips)||value.qa.length>4||value.zips.length>4)throw new Error('Invalid private material imports.');
  const qa=value.qa.map(v=>{
    if(typeof v!=='string'||Buffer.byteLength(v)>2*1024*1024)throw new Error('Invalid QA import.');
    return v;
  });
  const zips=value.zips.map(v=>{
    if(!v||Object.keys(v).some(k=>!['name','base64','sha256'].includes(k))||!/^[a-zA-Z0-9_.-]{1,100}\.zip$/i.test(v.name||'')||typeof v.base64!=='string'||v.base64.length>4*1024*1024||!/^[a-f0-9]{64}$/.test(v.sha256||''))throw new Error('Invalid ZIP import.');
    const bytes=Buffer.from(v.base64,'base64');
    if(!bytes.length||bytes.toString('base64')!==v.base64||crypto.createHash('sha256').update(bytes).digest('hex')!==v.sha256)throw new Error('ZIP import digest mismatch.');
    return {name:v.name,base64:v.base64,sha256:v.sha256};
  });
  if(new Set(zips.map(v=>v.name)).size!==zips.length)throw new Error('Duplicate ZIP names.');
  return {qa,zips};
}
module.exports={validateImports};
