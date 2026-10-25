#!/usr/bin/env node
'use strict';
const {prepareRecovery,mergeRecovery}=require('./lib/judge-recovery.cjs');
function main(args=process.argv.slice(2)){
  const options={},command=args[0]==='merge'?'merge':'prepare';if(['merge','prepare'].includes(args[0]))args=args.slice(1);
  const names={'--source-dir':'sourceDir','--output-dir':'outputDir','--recovery-dir':'recoveryDir','--shards':'shards'};
  for(let i=0;i<args.length;i++){if(!names[args[i]]||!args[i+1])throw new Error('Use prepare|merge --source-dir PRIVATE_SOURCE --output-dir PRIVATE_OUTPUT [--shards 8|--recovery-dir PRIVATE_RECOVERY].');options[names[args[i]]]=args[++i];}
  if(!options.sourceDir||!options.outputDir||command==='merge'&&!options.recoveryDir)throw new Error('Explicit private source and output directories are required.');
  if(options.shards!==undefined)options.shards=Number(options.shards);
  const result=command==='merge'?mergeRecovery(options):prepareRecovery(options);
  process.stdout.write(JSON.stringify(command==='merge'?{mode:result.mode,status:result.status,generationExecutedAcrossRecoveryRuns:0,crossModelVerifiedCases:result.judging.crossModelVerifiedCases}:{kind:result.kind,selectedCases:result.selectedCases,partitions:result.jobs.length,generationCallsToExecute:0,maximumPayloadBytes:Math.max(...result.jobs.map(job=>job.payloadBytes))})+'\n');
}
if(require.main===module)try{main();}catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
module.exports={main};
