'use strict';
const fs=require('fs'),path=require('path');
const {compileProjectPacks}=require('../src/project-fact-packs');
const index=compileProjectPacks();
fs.writeFileSync(path.join(__dirname,'../project-packs/index.json'),JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify({revision:index.revision,cards:index.cards.length,coverage:index.coverage},null,2));
