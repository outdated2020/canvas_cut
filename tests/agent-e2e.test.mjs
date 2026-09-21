import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import core from '../packages/core/dist/index.js';
import agent from '../packages/agent/dist/index.js';
import serverModule from '../apps/desktop/dist/main/ipc-server.js';
import daemonModule from '../apps/desktop/dist/main/daemon.js';
import workerModule from '../apps/desktop/dist/main/job-worker.js';
import storeModule from '../apps/desktop/dist/main/job-store.js';

test('Agent shell CLI to IPC, daemon, fake provider, render and timeline round trip',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agent-e2e-'));
 const store=new core.ProjectStore(dir);await store.init('E2E');
 const asset={id:'fake-image',type:'image',path:join(dir,'assets','fake.png'),sizeBytes:1};await writeFile(asset.path,'fixture');
 const jobStore=new storeModule.InMemoryJobStore();const worker=new workerModule.JobWorker(store,jobStore,{pollIntervalMs:20});
 let generations=0;worker.createProvider=async()=>({textToImage:async()=>{generations++;return {jobId:'remote',status:'succeeded',result:asset};}});
 const daemon=new daemonModule.DaemonService();daemon.getContext=async()=>({store,jobStore,worker,activeCanvasRenders:new Map()});
 const server=new serverModule.LocalIpcServer({userDataDir:join(dir,'canvas-cut')},daemon);
 const host=new agent.LocalAgentHost({cwd:dir,logDir:join(dir,'logs'),env:{APPDATA:dir}});
 try {
  await server.start();worker.start();
  const script=`const {spawnSync}=require('node:child_process');
const cli=${JSON.stringify(resolve('apps/cli/dist/index.js'))};
function cc(...args){const p=spawnSync(process.execPath,[cli,...args,'--json'],{encoding:'utf8'});const result=JSON.parse(p.stdout);if(p.status!==0||!result.ok)throw Error(JSON.stringify(result));return result.data;}
const c=cc('canvas','create').canvasId;
const a=cc('canvas','node','add','--canvas',c,'--type','text-input','--params',JSON.stringify({text:'test'})).nodeId;
const b=cc('canvas','node','add','--canvas',c,'--type','text-to-image').nodeId;
const o=cc('canvas','node','add','--canvas',c,'--type','output').nodeId;
cc('canvas','edge','connect','--canvas',c,'--from',a+':text','--to',b+':text');
cc('canvas','edge','connect','--canvas',c,'--from',b+':image','--to',o+':image');
const submitted=cc('canvas','render',c,'--idempotency-key','stable-e2e');
const repeated=cc('canvas','render',c,'--idempotency-key','stable-e2e');
if(submitted.jobId!==repeated.jobId)throw Error('Duplicate job');
cc('job','wait',submitted.jobId,'--timeout-ms','10000');
const track=cc('timeline','add-track','--type','video','--name','V1').trackId;
cc('timeline','add-clip','--track',track,'--kind','canvas','--canvas',c,'--duration-ms','3000');
console.log(JSON.stringify({canvasId:c,jobId:submitted.jobId}));`;
  const messages=[{role:'user',content:'Build and render a test canvas'}];let step=0;
  const fetch=async(_url,request)=>{
   const body=JSON.parse(request.body);let action;
   if(step===0) action=['write_file',{path:'workflow.cjs',content:script}];
   else if(step===1) action=['exec_command',{command:process.platform==='win32'?`& '${process.execPath.replace(/'/g,"''")}' ./workflow.cjs`:`'${process.execPath}' ./workflow.cjs`}];
   else {
    const result=JSON.parse(body.messages.at(-1).content);assert.equal(result.ok,true);
    const output=result.data;
    if(output.status==='running')action=['read_process_output',{processId:output.processId,stdoutOffset:output.stdout.nextOffset,stderrOffset:output.stderr.nextOffset,waitMs:1000}];
    else assert.equal(output.exitCode,0,output.stderr.text);
   }
   step++;
   return new Response(JSON.stringify({id:'r'+step,object:'chat.completion',created:1,model:'test',choices:[{index:0,finish_reason:action?'tool_calls':'stop',message:action?{role:'assistant',content:null,tool_calls:[{id:'c'+step,type:'function',function:{name:action[0],arguments:JSON.stringify(action[1])}}]}:{role:'assistant',content:'Rendered'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
  };
  const result=await agent.runAgentMessage({apiKey:'test',fetch,host,skills:new agent.SkillRegistry([]),context:{sessionId:'s',runId:'r',signal:new AbortController().signal},logDir:dir,messages,save:async()=>{},emit:async()=>{}});
  assert.equal(result.text,'Rendered');assert.equal(generations,1);
  const timeline=await store.readTimeline();assert.equal(timeline.tracks[0].clips[0].durationMs,3000);
  assert.equal(jobStore.list({parentId:null})[0].status,'succeeded');
 } finally {await host.stopRun('r');worker.stop();await server.stop();await rm(dir,{recursive:true,force:true,maxRetries:3});}
});
