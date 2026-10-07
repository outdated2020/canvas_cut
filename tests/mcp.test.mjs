import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import agent from '../packages/agent/dist/index.js';
import serverModule from '../apps/desktop/dist/main/ipc-server.js';

test('MCP stdio sends prompts into shared persisted desktop sessions and supports status, history and cancel',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mcp-agent-'));
 const service=new agent.AgentSessionService({storageDir:join(dir,'sessions'),configure:async()=>({apiKey:'test',fetch:async(_url,request)=>new Promise((_,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});if(request.signal.aborted)reject(request.signal.reason);})}),createHost:(cwd,logDir)=>new agent.LocalAgentHost({cwd,logDir}),skillDirectories:()=>[]});
 const server=new serverModule.LocalIpcServer({userDataDir:join(dir,'canvas-cut'),agentRequest:async(method,path,payload)=>{
  const id=payload.conversationId;
  if(method==='agent.start')return service.start(path,payload.message,id);
  if(method==='agent.history')return service.history(path,id);
  if(method==='agent.get-run')return service.getRun(path,id,payload.after);
  if(method==='agent.cancel')return service.cancel(path,id);
 }},{});
 let child, lines;const pending=new Map();let nextId=0;
 try {
  await server.start();
  const instancePath = join(dir, 'canvas-cut', 'ipc', 'instance.json');
  const instance = JSON.parse(await readFile(instancePath, 'utf8'));
  instance.startedAt = Date.now() - 48 * 60 * 60 * 1000;
  await writeFile(instancePath, JSON.stringify(instance));
  child=spawn(process.execPath,[resolve('apps/cli/dist/index.js'),'mcp','--project',dir],{env:{...process.env,APPDATA:dir},stdio:['pipe','pipe','pipe'],windowsHide:true});
  lines=createInterface({input:child.stdout});
  lines.on('line',line=>{const message=JSON.parse(line);const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);item.resolve(message);}});
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout'));},5000);pending.set(id,{resolve,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const call=async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).result;
  const unpack=result=>JSON.parse(result.content[0].text);
  assert.ok((await rpc('initialize',{protocolVersion:'2024-11-05'})).result.capabilities.tools);
  const tools=(await rpc('tools/list')).result.tools.map(t=>t.name);
  for(const name of ['ui_screenshot','agent_send_prompt','agent_get_run','agent_history','agent_cancel','search_tools','execute'])assert.ok(tools.includes(name));
  const discovered=unpack(await call('search_tools',{query:'agent_history'}));
  assert.equal(discovered.tools[0].name,'agent_history');
  assert.match(discovered.tools[0].declaration,/tools.agent_history/);
  assert.equal(unpack(await call('execute',{code:'return 2 + 3'})).result,5);
  const cancelId=nextId+1;
  const waiting=rpc('tools/call',{name:'execute',arguments:{code:'await new Promise(() => {})'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:cancelId,reason:'test cancellation'}})+'\n');
  const cancelled=(await waiting).result;assert.equal(cancelled.isError,true);assert.match(cancelled.content[0].text,/cancelled/);
  assert.equal((await call('agent_send_prompt',{prompt:' '})).isError,true);
  assert.equal((await call('agent_get_run',{after:-1})).isError,true);
  const start=unpack(await call('agent_send_prompt',{prompt:'外部发送的 prompt'}));assert.ok(start.runId);
  assert.equal((await service.history(dir)).messages[0].content,'外部发送的 prompt');
  assert.equal((await call('agent_send_prompt',{prompt:'duplicate'})).isError,true);
  const status=unpack(await call('agent_get_run'));assert.equal(status.run.id,start.runId);assert.equal(status.run.status,'running');
  const other=unpack(await call('agent_history',{conversationId:'other'}));assert.equal(other.messages.length,0);
  const history=unpack(await call('agent_history'));assert.equal(history.messages[0].content,'外部发送的 prompt');
  const combined=unpack(await call('execute',{code:'const results = await Promise.all([tools.agent_history({}), tools.agent_get_run({})]); return results.map(r => JSON.parse(r.content[0].text));'}));
  assert.equal(combined.calls,2);assert.equal(combined.result[0].messages[0].content,'外部发送的 prompt');assert.equal(combined.result[1].run.id,start.runId);
  assert.equal(unpack(await call('agent_cancel')).cancelled,true);
  await service.shutdown();
  assert.equal(unpack(await call('agent_get_run',{after:status.cursor})).run.status,'cancelled');
  const restored=new agent.AgentSessionService(service.options);assert.equal((await restored.history(dir)).messages[0].content,'外部发送的 prompt');
 } finally {
  for(const item of pending.values())clearTimeout(item.timer);
  if(child){child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);});}
  lines?.close();await service.shutdown();await server.stop();await rm(dir,{recursive:true,force:true});
 }
});
