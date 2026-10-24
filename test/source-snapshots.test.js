'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {exclusionReason}=require('../scripts/sync-project-sources.cjs');

test('public source snapshots match pinned Git blobs and the exact distribution whitelist',()=>{
  const root=path.resolve(__dirname,'../materials');
  const lock=JSON.parse(fs.readFileSync(path.join(root,'source-lock.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.deepEqual(lock.projects.map(project=>project.id).sort(),['arclight','cae']);
  for(const project of lock.projects) {
    assert.equal(project.public,true);assert.match(project.commit,/^[a-f0-9]{40}$/);assert.equal(project.sourceTruncated,false);
    const source=manifest.sources.find(item=>item.projectId===project.id);
    assert.equal(source.root,'projects/'+project.id);
    assert.deepEqual(source.files,project.files.filter(file=>file.indexed).map(file=>({path:file.path,sha256:file.sha256})));
    for(const file of project.files) {
      const bytes=fs.readFileSync(path.join(root,source.root,file.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
      assert.equal(bytes.length,file.bytes,file.path);
      if(!file.generated) {
        assert.equal(exclusionReason(file.path),null,file.path);
        assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),file.gitBlob,file.path);
      }
    }
    const identity=fs.readFileSync(path.join(root,source.root,'interview/project.md'),'utf8');
    assert.ok(identity.includes('source_revision: '+project.commit));
    assert.ok(project.excluded.length>0&&project.excluded.every(file=>typeof file.reason==='string'));
  }
  for(const file of ['../escape.py','.env','server/private-key.pem','backend/src/test/java/ThingTest.java','tests/test_context.py','demo-data/input.json','frontend/package-lock.json'])assert.ok(exclusionReason(file),file);
  const navigation=JSON.parse(fs.readFileSync(path.join(root,manifest.navigation.path),'utf8'));
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,manifest.navigation.path))).digest('hex'),manifest.navigation.sha256);
  const bundle=JSON.parse(fs.readFileSync(path.join(root,'bundle.json'),'utf8'));
  for(const entry of navigation.entries){
    assert.equal(lock.projects.find(project=>project.id===entry.projectId).commit,entry.sourceRevision);
    assert.ok(bundle.sources.chunks.some(chunk=>chunk.projectId===entry.projectId&&chunk.path===entry.path&&(!entry.symbol||chunk.symbol===entry.symbol)&&entry.keywords.every(word=>chunk.navigationTerms?.includes(word))));
  }
});
