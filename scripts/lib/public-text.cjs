'use strict';
const credential=/^(?:api[-_]?keys?|(?:QWEN|DEEPSEEK)_API_KEY|authorization|proxy-authorization|cookie|set-cookie|password|access_token|refresh_token|client_secret|secret)$/i;
function redact(value,secrets=[],changes=[],location='$') {
  if(typeof value==='string') {let text=value;for(const secret of secrets.filter(Boolean))text=text.split(secret).join('[REDACTED]');if(text!==value)changes.push({path:location,reason:'known-credential-value'});return text;}
  if(Array.isArray(value))return value.map((item,i)=>redact(item,secrets,changes,location+'['+i+']'));
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>{
    if(credential.test(key)){changes.push({path:location+'.'+key,reason:'credential-field'});return [key,'[REDACTED]'];}
    return [key,redact(item,secrets,changes,location+'.'+key)];
  }));
}
module.exports={redact};
