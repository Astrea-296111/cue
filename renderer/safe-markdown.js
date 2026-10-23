(function(root) {
  'use strict';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const inline = s => esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  function renderMarkdown(text) {
    let html='', code=false, fence='', list=null, item=false, paragraphs=[];
    const flush = () => { if(paragraphs.length) {html+='<p>'+inline(paragraphs.join(' '))+'</p>';paragraphs=[];} };
    const closeList = () => { if(item){html+='</li>';item=false;} if(list){html+=`</${list}>`;list=null;} };
    for(const line of String(text).replace(/\r\n/g,'\n').split('\n')) {
      const mark=/^\s*(`{3,}|~{3,})/.exec(line);
      if(mark && (!code || mark[1][0]===fence[0]&&mark[1].length>=fence.length)) {
        if(code){html+='</code></pre>';code=false;} else {flush();closeList();html+='<pre><code>';code=true;fence=mark[1];} continue;
      }
      if(code){html+=esc(line)+'\n';continue;}
      const ordered=/^\s{0,3}(\d{1,9})[.)]\s+(.+)$/.exec(line);
      const bullet=/^\s{0,3}[-*+]\s+(.+)$/.exec(line);
      if(ordered||bullet) {
        flush(); const type=ordered?'ol':'ul';
        if(list!==type){closeList();html+=ordered?`<ol start="${Number(ordered[1])}">`:'<ul>';list=type;}
        if(item)html+='</li>';
        html+='<li>'+inline(ordered?ordered[2]:bullet[1]);item=true;continue;
      }
      if(!line.trim()){flush();continue;}
      if(list&&/^\s{2,}\S/.test(line)){html+='<br>'+inline(line.trim());continue;}
      closeList();paragraphs.push(line.trim());
    }
    flush();closeList();if(code)html+='</code></pre>';return html;
  }
  if(typeof module!=='undefined')module.exports={renderMarkdown};else root.CueMarkdown={renderMarkdown};
})(typeof window==='undefined'?globalThis:window);
