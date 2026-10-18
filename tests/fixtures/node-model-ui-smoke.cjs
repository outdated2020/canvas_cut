const {app,BrowserWindow}=require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const outputDir=path.resolve(process.argv[2]);
app.setPath('userData',path.join(outputDir,'profile'));app.on('window-all-closed',()=>{});
const timeout=setTimeout(()=>{console.error('Node model UI test timed out');app.exit(1);},60000);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1600,height:1100,webPreferences:{preload:path.join(__dirname,'node-model-ui-preload.cjs'),sandbox:false,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
  const evaluate=code=>win.webContents.executeJavaScript(code);
  async function waitFor(code){for(let i=0;i<120;i++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI condition not met: '+code);}
  await win.loadFile(path.join(__dirname,'../../apps/desktop/dist/renderer/index.html'));
  await waitFor(`!!document.querySelector('.panel-tabs')`);
  await evaluate(`Array.from(document.querySelectorAll('.panel-tabs button')).find(b=>b.textContent==='Canvas').click()`);
  await waitFor(`!!document.querySelector('.canvas-card')`);
  await evaluate(`document.querySelector('.canvas-card').click()`);
  await waitFor(`document.querySelectorAll('.react-flow__node').length===5`);
  await evaluate(`document.querySelector('button[title="Expand"]').click()`);
  for(const type of ['text-to-image','image-to-image','text-to-video','image-to-video','video-to-video']){
    const selector=`.react-flow__node[data-id="${type}"]`;
    const expectedDefault=type.endsWith('-to-video')?'doubao-seedance-2-0-mini-260615':'project-image-default';
    const knownModel=type.endsWith('-to-video')?'doubao-seedance-2-0-fast-260128':'doubao-seedream-5-0-flash-260915';
    async function select(value){
      await evaluate(`(()=>{const select=document.querySelector('${selector} select[aria-label="节点模型"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(value)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    }
    async function input(value){
      await evaluate(`(()=>{const input=document.querySelector('${selector} input[aria-label="自定义模型 ID"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    }
    async function save(value){
      await evaluate(`document.querySelector('${selector} form').requestSubmit()`);
      await waitFor(`window.nodeModelTest.snapshot().nodes.find(n=>n.id==='${type}').params.model===${JSON.stringify(value)}`);
      await waitFor(`document.querySelector('${selector} .footer-model').title===${JSON.stringify(value||expectedDefault)}`);
    }
    await evaluate(`document.querySelector('${selector} .canvas-node-shell').click()`);
    await waitFor(`!!document.querySelector('${selector} select[aria-label="节点模型"]')`);
    const options=await evaluate(`Array.from(document.querySelectorAll('${selector} select[aria-label="节点模型"] optgroup option')).map(o=>o.value)`);
    assert.equal(options.length,type.endsWith('-to-video')?4:2);
    assert.ok(options.includes(knownModel));
    assert.ok(options.every(id=>id.includes(type.endsWith('-to-video')?'seedance':'seedream')));
    const initial=type==='text-to-image'?'legacy-image-model':type==='video-to-video'?'ep-existing-video':'';
    assert.equal(await evaluate(`document.querySelector('${selector} select[aria-label="节点模型"]').value`),initial?'__custom_model__':'');
    if(initial)assert.equal(await evaluate(`document.querySelector('${selector} input[aria-label="自定义模型 ID"]').value`),initial);
    await select(knownModel);
    assert.equal(await evaluate(`!!document.querySelector('${selector} input[aria-label="自定义模型 ID"]')`),false);
    await save(knownModel);
    await evaluate(`document.querySelector('${selector} .canvas-node-shell').click()`);
    await evaluate(`document.querySelector('${selector} .canvas-node-shell').click()`);
    await waitFor(`document.querySelector('${selector} select[aria-label="节点模型"]')?.value===${JSON.stringify(knownModel)}`);
    await select('__custom_model__');
    await waitFor(`!!document.querySelector('${selector} input[aria-label="自定义模型 ID"]')`);
    await input('');
    assert.equal(await evaluate(`document.querySelector('${selector} select[aria-label="节点模型"]').value`),'__custom_model__');
    await input(knownModel);
    assert.equal(await evaluate(`document.querySelector('${selector} select[aria-label="节点模型"]').value`),'__custom_model__','Typing a catalog ID must not hide the input');
    await input(`${type}-custom`);
    await save(`${type}-custom`);
    await evaluate(`document.querySelector('${selector} .canvas-node-shell').click()`);
    await evaluate(`document.querySelector('${selector} .canvas-node-shell').click()`);
    await waitFor(`document.querySelector('${selector} input[aria-label="自定义模型 ID"]')?.value==='${type}-custom'`);
    if(type==='text-to-image'){
      await evaluate(`document.querySelector('${selector} input[aria-label="自定义模型 ID"]').scrollIntoView({block:'nearest'})`);
      await new Promise(r=>setTimeout(r,100));
      const bounds=await evaluate(`(()=>{const r=document.querySelector('${selector} .canvas-node-shell').getBoundingClientRect();const x=Math.max(0,Math.floor(r.x)),y=Math.max(0,Math.floor(r.y));return {x,y,width:Math.min(innerWidth-x,Math.ceil(r.width)),height:Math.min(innerHeight-y,Math.ceil(r.height))};})()`);
      await fs.mkdir(outputDir,{recursive:true});await fs.writeFile(path.join(outputDir,'model-panel.png'),(await win.webContents.capturePage(bounds)).toPNG());
    }
    await select('');
    await save('');
    assert.equal(await evaluate(`!!document.querySelector('${selector} input[aria-label="自定义模型 ID"]')`),false);
    if(type.endsWith('-to-video'))assert.match(await evaluate(`document.querySelector('${selector} select[aria-label="节点模型"] option[value=""]').textContent`),/Seedance 2.0 Mini/);
    await evaluate(`document.querySelector('${selector} .canvas-node-shell').click()`);
  }
  await evaluate(`document.querySelector('.react-flow__node[data-id="text-to-image"] .canvas-node-shell').click()`);
  await new Promise(r=>setTimeout(r,250));
  await fs.mkdir(outputDir,{recursive:true});await fs.writeFile(path.join(outputDir,'editor.png'),(await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ui:'passed',nodeTypes:5,model:'filtered catalogs, select/save/reopen, preserve legacy IDs, custom editing and reset to default',screenshot:path.join(outputDir,'editor.png')}));
  win.destroy();clearTimeout(timeout);app.exit(0);
}).catch(e=>{console.error(e);clearTimeout(timeout);app.exit(1);});
