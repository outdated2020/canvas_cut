import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import agent from '../packages/agent/dist/index.js';
const { LocalAgentHost, SkillRegistry, parseSkill, AgentSessionService, BASE_TOOLS, boundedToolResult } = agent;
const context = () => ({sessionId:'session',runId:'run',signal:new AbortController().signal});
async function fixture(t) { const dir=await mkdtemp(join(tmpdir(),'agent 中文 space-')); t.after(()=>rm(dir,{recursive:true,force:true})); return dir; }
function model(actions, inspect=()=>{}) { let step=0; return async (_url,request) => {
  inspect(JSON.parse(request.body),step);
  const action=actions[step++];
  return new Response(JSON.stringify({id:`response-${step}`,object:'chat.completion',created:1,model:'test',choices:[{index:0,finish_reason:action?'tool_calls':'stop',message:action?{role:'assistant',content:null,tool_calls:[{id:`call-${step}`,type:'function',function:{name:action[0],arguments:JSON.stringify(action[1])}}]}:{role:'assistant',content:'Done'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'content-type':'application/json'}});
}; }

test('system prompt is layered, identifies the run and uses the skill loader consistently', () => {
 const prompt=agent.buildSystemPrompt({mode:'trusted-local',platform:'win32',shell:'powershell',projectPath:'C:\\project',cwd:'C:\\work',sessionId:'session-1',runId:'run-1',maxSteps:32,contextLimitCharacters:100000,applicationPrompt:'Use the application CLI.',recoveryContext:'Previous run was interrupted.',skills:[{frontmatter:{name:'demo',description:'Demo workflow'},sourcePath:'C:\\skills\\demo\\SKILL.md'}]});
 const headings=['Identity','Scope and authority','Runtime context','Execution protocol','Application instructions','Skills','Recovery context'];
 let previous=-1; for(const heading of headings){const index=prompt.indexOf(`## ${heading}`);assert.ok(index>previous,heading);previous=index;}
 assert.match(prompt,/projectPath: C:\\project/);assert.match(prompt,/sessionId: session-1/);assert.match(prompt,/runId: run-1/);
 assert.match(prompt,/Use the application CLI/);assert.match(prompt,/load_skill/);
 assert.doesNotMatch(prompt,/SKILL\.md with read_file/);
 assert.match(prompt,/Previous run was interrupted/);
});

test('real SDK uses only base tools and persists call before filesystem mutation',async t=>{
 const dir=await fixture(t), messages=[{role:'user',content:'write and read'}], host=new LocalAgentHost({cwd:dir,logDir:join(dir,'logs')});
 let saved=[], checked=false;
 const execute=host.execute.bind(host); host.execute=async (...args)=>{assert.equal(saved.at(-1).role,'assistant');checked=true;return execute(...args);};
 const result=await agent.runAgentMessage({apiKey:'test',streaming:false,model:'test',host,skills:new SkillRegistry([]),context:context(),logDir:dir,messages,save:async m=>{saved=structuredClone(m);},emit:async()=>{},fetch:model([['write_file',{path:'你好.txt',content:'中文\nsecond'}],['read_file',{path:'你好.txt'}]],body=>assert.deepEqual(body.tools.map(t=>t.function.name).sort(),[...Object.keys(BASE_TOOLS),'list_skills','load_skill'].sort()))});
 assert.equal(result.text,'Done');assert.ok(checked);assert.equal(await readFile(join(dir,'你好.txt'),'utf8'),'中文\nsecond');assert.equal(messages.filter(m=>m.role==='tool').length,2);
});

test('file tools enforce unique edits, paginate, and retain oversized results in logs',async t=>{
 const dir=await fixture(t),host=new LocalAgentHost({cwd:dir,logDir:dir}),ctx=context();
 await host.execute('write_file',{path:'a.txt',content:'same\nsame\n末行'},ctx);
 await host.execute('read_file',{path:'a.txt'},ctx);
 await assert.rejects(host.execute('apply_patch',{patch:'*** Begin Patch\n*** Update File: a.txt\n@@\n-same\n+x\n*** End Patch'},ctx),/context/i);
 await host.execute('apply_patch',{patch:'*** Begin Patch\n*** Update File: a.txt\n@@\n-末行\n+结束\n*** End Patch'},ctx);
 const page=await host.execute('read_file',{path:'a.txt',startLine:2,lineCount:1},ctx);assert.equal(page.content,'same\n');assert.equal(page.nextLine,3);
 const large=await boundedToolResult({text:'中'.repeat(20000)},dir);assert.equal(large.truncated,true);assert.equal(JSON.parse(await readFile(large.logPath,'utf8')).text.length,20000);
});

test('skills parse CRLF YAML, project overrides builtin, invalid skills produce diagnostics',async t=>{
 const dir=await fixture(t);
 for(const name of ['builtin/demo','project/demo','project/bad']) await mkdir(join(dir,name),{recursive:true});
 const source='---\r\nname: demo\r\ndescription: >-\r\n  Hello world\r\ntriggers:\r\n  - video\r\n---\r\n';
 assert.deepEqual(parseSkill('\ufeff'+source,join(dir,'SKILL.md')).frontmatter.triggers,['video']);
 await writeFile(join(dir,'builtin/demo/SKILL.md'),source+'builtin');await writeFile(join(dir,'project/demo/SKILL.md'),source+'project');await writeFile(join(dir,'project/bad/SKILL.md'),'bad');
 const registry=new SkillRegistry([join(dir,'builtin'),join(dir,'project')]);assert.equal((await registry.list())[0].body,'project');assert.equal(registry.diagnostics.length,1);
});

test('real native shell preserves Chinese output across byte pages, isolates ownership and stops process trees',async t=>{
 const dir=await fixture(t),host=new LocalAgentHost({cwd:dir,logDir:dir}),ctx=context();t.after(()=>host.stopRun(ctx.runId));
 const command=process.platform==='win32'?"[Console]::Write(('中文' * 10000))":"printf '中文%.0s' {1..10000}";
 let result=await host.execute('exec_command',{command},ctx),output=result.stdout.text;
 while(result.status==='running'||result.stdout.text){result=await host.execute('read_process_output',{processId:result.processId,stdoutOffset:result.stdout.nextOffset,stderrOffset:result.stderr.nextOffset,waitMs:100},ctx);output+=result.stdout.text;}
 assert.equal(output,'中文'.repeat(10000));assert.equal(result.exitCode,0);
 await assert.rejects(host.execute('read_process_output',{processId:result.processId},{...ctx,sessionId:'other'}),/session/);
 const slow=await host.execute('exec_command',{command:process.platform==='win32'?'Start-Sleep -Seconds 30':'sleep 30',timeoutMs:150},ctx);assert.equal(slow.status,'timed-out');
 const running=await host.execute('exec_command',{command:process.platform==='win32'?'Start-Sleep -Seconds 30':'sleep 30'},ctx);
 assert.equal((await host.execute('terminate_process',{processId:running.processId},ctx)).status,'cancelled');
 assert.equal(agent.cleanEnvironment({PATH:'ok',ARK_API_KEY:'hidden',ACCESS_TOKEN:'hidden'}).ARK_API_KEY,undefined);
});

test('session persists full tool history and recovers interrupted calls without executing them',async t=>{
 const dir=await fixture(t); const options={storageDir:join(dir,'sessions'),configure:async()=>({apiKey:'test',streaming:false,fetch:model([['write_file',{path:'result.txt',content:'saved'}]])}),createHost:(cwd,logDir)=>new LocalAgentHost({cwd,logDir}),skillDirectories:()=>[]};
 const service=new AgentSessionService(options);assert.equal((await service.chat(dir,'do it')).text,'Done');
 const saved=await service.history(dir);assert.ok(saved.messages.some(m=>m.role==='tool'));assert.equal(JSON.stringify(saved).includes('apiKey'),false);
 saved.run.status='running';saved.messages.push({role:'assistant',content:[{type:'tool-call',toolCallId:'pending',toolName:'write_file',input:{path:'never.txt',content:'no'}}]});
 await writeFile(join(options.storageDir,saved.id+'.json'),JSON.stringify(saved));
 const restarted=new AgentSessionService(options);
 const recovered=await restarted.history(dir);assert.equal(recovered.run.status,'interrupted');assert.ok(JSON.stringify(recovered.messages).includes('interrupted'));await assert.rejects(readFile(join(dir,'never.txt')),/ENOENT/);
 const prompts=[];
 options.configure=async()=>({apiKey:'test',streaming:false,applicationPrompt:'Application-specific guidance',fetch:model([],body=>prompts.push(body.messages[0].content))});
 assert.equal((await restarted.chat(dir,'Inspect state and continue')).text,'Done');
 assert.ok(prompts[0].includes('## Recovery context'));
 assert.ok(prompts[0].includes(saved.run.id));
 assert.ok(prompts[0].includes('Application-specific guidance'));
 await assert.rejects(readFile(join(dir,'never.txt')),/ENOENT/);
 await restarted.chat(dir,'Next independent request');
 assert.ok(!prompts[1].includes('## Recovery context'));
});

test('concurrent starts rejected and cancellation persists terminal state',async t=>{
 const dir=await fixture(t);
 const service=new AgentSessionService({storageDir:join(dir,'sessions'),configure:async()=>({apiKey:'test',streaming:false,fetch:async(_u,r)=>new Promise((_,reject)=>{r.signal.addEventListener('abort',()=>reject(r.signal.reason),{once:true});if(r.signal.aborted)reject(r.signal.reason);})}),createHost:(cwd,logDir)=>new LocalAgentHost({cwd,logDir}),skillDirectories:()=>[]});
 const first=service.start(dir,'wait');await assert.rejects(service.start(dir,'duplicate'),/running task/);await first;
 await service.cancel(dir);await service.shutdown();assert.equal((await service.history(dir)).run.status,'cancelled');
});

test('Agent invokes installed CLI through native shell and reads bundled skill', async t=>{
 const dir=await fixture(t);
 const core=(await import('../packages/core/dist/index.js')).default;
 const {createAgentService}=(await import('../apps/desktop/dist/main/agent-service.js')).default;
 const store=new core.ProjectStore(dir);await store.init('Integration');
 const service=await createAgentService({userDataDir:join(dir,'userdata'),appRoot:resolve('apps/desktop'),executable:process.execPath,settings:async()=>({agentApiKey:'test'})});
 const configure=service.options.configure;
 service.options.configure=async path=>({...await configure(path),streaming:false,fetch:model([['load_skill',{name:'canvas-cut',lineCount:2000}],['exec_command',{command:'canvas-cut canvas create --json',yieldTimeMs:10000}],['exec_command',{command:'canvas-cut canvas list --json',yieldTimeMs:10000}]])});
 assert.equal((await service.chat(dir,'Create a canvas using the skill')).text,'Done');
 assert.equal((await store.listCanvasFiles()).length,1);
 const history=await service.history(dir);
 assert.ok(history.events.some(event=>event.type==='skill-loaded'&&event.data.name==='canvas-cut'));
 for(const event of history.events.filter(e=>e.type==='tool-result'&&e.data.name==='exec_command')) {
   const output=event.data.result.data;assert.equal(output.exitCode,0);assert.equal(JSON.parse(output.stdout.text).ok,true);
 }
});
