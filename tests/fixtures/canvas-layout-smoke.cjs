const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const outputDir = path.resolve(process.argv[2]);
app.setPath('userData', path.join(outputDir, 'profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Canvas layout test timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: {
    preload: path.join(__dirname, 'canvas-layout-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true
  } });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  const evaluate = code => window.webContents.executeJavaScript(code);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(code) {
    for (let attempt = 0; attempt < 120; attempt++) { if (await evaluate(code)) return; await delay(50); }
    throw Error(`UI condition not met: ${code}`);
  }
  await window.loadFile(path.join(__dirname, '../../apps/desktop/dist/renderer/index.html'));
  await evaluate(`localStorage.clear()`);
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload(); });
  async function openCanvas() {
    await waitFor(`!!document.querySelector('.panel-tabs')`);
    await evaluate(`Array.from(document.querySelectorAll('.panel-tabs button')).find(b=>b.textContent==='Canvas').click()`);
    await waitFor(`!!document.querySelector('.canvas-card')`);
    await evaluate(`document.querySelector('.canvas-card').click()`);
    await waitFor(`document.querySelectorAll('.react-flow__node-canvasNode').length===4 && Array.from(document.querySelectorAll('.react-flow__node-canvasNode')).every(n=>n.style.visibility==='visible')`);
    await evaluate(`document.querySelector('button[title="Expand"]').click()`);
    await delay(400);
    await evaluate(`document.querySelector('.react-flow__controls-fitview').click()`);
    await delay(400);
  }
  await openCanvas();
  await fs.mkdir(outputDir,{recursive:true});
  async function captureToolbar(name) {
    await delay(80);
    const bounds=await evaluate(`(() => {const r=document.querySelector('.canvas-layout-tools').getBoundingClientRect();return {x:Math.floor(r.x-8),y:Math.floor(r.y-8),width:Math.ceil(r.width+16),height:Math.ceil(r.height+16)};})()`);
    await fs.writeFile(path.join(outputDir,name),(await window.webContents.capturePage(bounds)).toPNG());
  }
  assert.equal(await evaluate(`document.querySelectorAll('.canvas-layout-tools button').length`),1,'Idle canvas only shows the snap icon');
  assert.equal(await evaluate(`!!document.querySelector('.canvas-selection-actions')`),false);
  await captureToolbar('toolbar-idle.png');
  await evaluate(`document.querySelector('.canvas-snap-toggle').click()`);
  await waitFor(`document.querySelector('.canvas-snap-toggle').getAttribute('aria-pressed')==='false'`);
  await evaluate(`document.querySelector('.canvas-snap-toggle').click()`);
  await waitFor(`document.querySelector('.canvas-snap-toggle').getAttribute('aria-pressed')==='true'`);
  const snapshot = await evaluate(`window.layoutTest.snapshot()`);
  async function rect(id) { return evaluate(`(() => {const r=document.querySelector('.react-flow__node[data-id="${id}"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`); }
  async function position(id) { return evaluate(`(() => {const m=new DOMMatrixReadOnly(document.querySelector('.react-flow__node[data-id="${id}"]').style.transform);return {x:m.m41,y:m.m42};})()`); }
  async function drag(from, to, beforeRelease) {
    window.webContents.sendInputEvent({ type:'mouseMove',x:Math.round(from.x),y:Math.round(from.y) });
    window.webContents.sendInputEvent({ type:'mouseDown',button:'left',x:Math.round(from.x),y:Math.round(from.y) });
    for(let i=1;i<=8;i++) { window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+(to.x-from.x)*i/8),y:Math.round(from.y+(to.y-from.y)*i/8)}); await delay(20); }
    if (beforeRelease) await beforeRelease(to);
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',x:Math.round(to.x),y:Math.round(to.y)});
    await delay(300);
  }
  // Drag B close enough to A for a right-side snap, at the current fit-view zoom.
  const a = await rect('a'), b = await rect('b');
  const zoom = await evaluate(`new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a`);
  await drag({x:b.x+30,y:b.y+40},{x:a.x+a.width+24*zoom+30+8,y:a.y+40+6}, async to => {
    await waitFor(`document.querySelectorAll('.canvas-snap-guides line').length===2`);
    const guide=await evaluate(`(() => {const line=document.querySelector('.canvas-snap-guides line');const point=new DOMPoint(Number(line.getAttribute('x1')),Number(line.getAttribute('y1'))).matrixTransform(line.getScreenCTM());return {y:point.y,pointerEvents:getComputedStyle(document.querySelector('.canvas-snap-guides')).pointerEvents};})()`);
    assert.ok(Math.abs(guide.y-a.y)<1,'Guide follows the viewport and target top edge');
    assert.equal(guide.pointerEvents,'none','Guides must not intercept dragging');
    await fs.writeFile(path.join(outputDir,'snap-guides.png'),(await window.webContents.capturePage()).toPNG());
    window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(to.x),y:Math.round(to.y+80)});
    await waitFor(`!document.querySelector('.canvas-snap-guides')`);
    window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(to.x),y:Math.round(to.y)});
    await waitFor(`!!document.querySelector('.canvas-snap-guides')`);
  });
  assert.equal(await evaluate(`!!document.querySelector('.canvas-snap-guides')`),false,'Guides disappear after releasing the node');
  const ap = await position('a'), bp = await position('b');
  assert.ok(Math.abs(bp.y-ap.y)<0.1, 'Same-type nodes align vertically');
  assert.ok(Math.abs(bp.x-ap.x-(a.width/zoom+24))<0.1, `Same-type nodes keep a 24-unit gap: ${JSON.stringify({ap,bp,a,zoom,expected:a.width/zoom+24})}`);
  // Shift-click a second node; group with keyboard shortcut.
  const selectRect = await rect('a');
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Shift'});
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',x:Math.round(selectRect.x+20),y:Math.round(selectRect.y+30),modifiers:['shift']});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',x:Math.round(selectRect.x+20),y:Math.round(selectRect.y+30),modifiers:['shift']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Shift'});
  await waitFor(`document.querySelectorAll('.react-flow__node.selected').length===2`);
  assert.equal(await evaluate(`document.querySelector('.canvas-selection-count').textContent`),'已选 2');
  await captureToolbar('toolbar-selected.png');
  await evaluate(`document.querySelector('.canvas-graph').dispatchEvent(new KeyboardEvent('keydown',{key:'g',ctrlKey:true,bubbles:true}))`);
  await waitFor(`!!document.querySelector('.canvas-group-frame')`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.canvas-layout-tools button')).some(b=>b.textContent==='打组')`),false,'Group selection only offers executable actions');
  const startA=await position('a'),startB=await position('b');
  const header=await evaluate(`(() => {const r=document.querySelector('.canvas-group-drag').getBoundingClientRect();return {x:r.right-70,y:r.y+17};})()`);
  await drag(header,{x:header.x+80,y:header.y+50});
  const endA=await position('a'),endB=await position('b');
  assert.ok(Math.abs((endA.x-startA.x)-(endB.x-startB.x))<0.1 && Math.abs(endA.x-startA.x)>20,'Group moves both members equally');
  assert.ok(Math.abs((endA.y-startA.y)-(endB.y-startB.y))<0.1,'Group preserves member vertical offsets');
  await evaluate(`(() => {const input=document.querySelector('input[aria-label="分组名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'角色参考');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await waitFor(`document.querySelector('input[aria-label="分组名称"]').value==='角色参考'`);
  await delay(250);
  await evaluate(`window.layoutTest.refresh('C:/Users/liqijun/Desktop/canvas_cut/demo-project')`);
  await delay(350);
  assert.deepEqual(await position('a'),endA,'Graph refresh preserves group placement');
  assert.deepEqual(await evaluate(`window.layoutTest.snapshot()`),snapshot,'Presentation grouping leaves graph and edges untouched');
  await fs.mkdir(outputDir,{recursive:true});
  await fs.writeFile(path.join(outputDir,'group.png'),(await window.webContents.capturePage()).toPNG());
  await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.webContents.reload(); });
  await openCanvas();
  await waitFor(`document.querySelector('input[aria-label="分组名称"]')?.value==='角色参考'`);
  assert.deepEqual(await position('a'),endA,'Reload restores node position');
  assert.deepEqual(await position('b'),endB,'Reload restores both group members');
  const memberRect=await rect('b');
  const beforeMember=await position('b');
  await drag({x:memberRect.x+30,y:memberRect.y+40},{x:memberRect.x+30,y:memberRect.y+100});
  const afterMember=await position('b');
  assert.ok(afterMember.y>beforeMember.y+10,'A member remains draggable while the group is selected');
  assert.deepEqual(await position('a'),endA,'Dragging a member does not move the other members');
  await evaluate(`document.querySelector('.canvas-group-drag button').click()`);
  await waitFor(`!document.querySelector('.canvas-group-frame')`);
  assert.deepEqual(await position('a'),endA,'Ungroup does not move members');
  assert.deepEqual(await evaluate(`window.layoutTest.snapshot()`),snapshot,'Ungroup does not delete business nodes');
  // A mixed-type group is visual only. Deleting its frame dissolves it.
  const mixedA=await rect('a');
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',x:Math.round(mixedA.x+20),y:Math.round(mixedA.y+30)});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',x:Math.round(mixedA.x+20),y:Math.round(mixedA.y+30)});
  await waitFor(`document.querySelectorAll('.react-flow__node.selected').length===1 && !!document.querySelector('.react-flow__node[data-id="a"].selected')`);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'Shift'});
  await delay(50);
  const mixedC=await rect('c');
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',x:Math.round(mixedC.x+20),y:Math.round(mixedC.y+30),modifiers:['shift']});
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',x:Math.round(mixedC.x+20),y:Math.round(mixedC.y+30),modifiers:['shift']});
  window.webContents.sendInputEvent({type:'keyUp',keyCode:'Shift'});
  await waitFor(`document.querySelectorAll('.react-flow__node.selected').length===2`);
  await evaluate(`Array.from(document.querySelectorAll('.canvas-layout-tools button')).find(b=>b.textContent==='打组').click()`);
  await waitFor(`!!document.querySelector('.canvas-group-frame')`);
  await evaluate(`document.querySelector('.react-flow__node-canvasGroup').dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',code:'Backspace',bubbles:true}))`);
  await waitFor(`!document.querySelector('.canvas-group-frame')`);
  assert.deepEqual(await evaluate(`window.layoutTest.snapshot()`),snapshot,'Deleting a group frame keeps all business nodes and edges');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ui:'passed',snap:'same-type alignment',groups:'create, rename, move, refresh, reload, ungroup',graph:'unchanged',screenshot:path.join(outputDir,'group.png')}));
  window.destroy();clearTimeout(timeout);app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timeout);app.exit(1);});
