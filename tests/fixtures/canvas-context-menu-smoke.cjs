const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const outputDir = path.resolve(process.argv[2]);
app.setPath('userData', path.join(outputDir, 'profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Context menu test timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: {
    preload: path.join(__dirname, 'canvas-context-menu-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true
  } });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await window.loadFile(path.join(__dirname, '../../apps/desktop/dist/renderer/index.html'));
  const evaluate = code => window.webContents.executeJavaScript(code);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(code) {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(code)) return; await delay(50); }
    throw Error(`UI condition not met: ${code}`);
  }
  await waitFor(`!!document.querySelector('.panel-tabs')`);
  await evaluate(`Array.from(document.querySelectorAll('.panel-tabs button')).find(b => b.textContent === 'Canvas').click()`);
  await waitFor(`!!document.querySelector('.canvas-card')`);
  await evaluate(`document.querySelector('.canvas-card').click()`);
  await waitFor(`!!document.querySelector('.react-flow__pane')`);
  await evaluate(`document.querySelector('button[title="Expand"]').click()`);
  await delay(400);
  // Change both zoom and pan to catch accidental use of raw screen coordinates.
  await evaluate(`document.querySelector('.react-flow__controls-zoomin').click()`);
  await delay(400);
  const pane = await evaluate(`(() => { const r=document.querySelector('.react-flow__pane').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
  const click = { x: Math.round(pane.x + pane.width - 80), y: Math.round(pane.y + 80) };
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', ...click });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', ...click });
  await waitFor(`!!document.querySelector('.canvas-add-menu')`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await waitFor(`!document.querySelector('.canvas-add-menu')`);
  const drag = { x: Math.round(pane.x + 40), y: Math.round(pane.y + pane.height - 40) };
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'middle', ...drag });
  window.webContents.sendInputEvent({ type: 'mouseMove', x: drag.x + 80, y: drag.y - 50 });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'middle', x: drag.x + 80, y: drag.y - 50 });
  await delay(200);
  async function openMenu(x = pane.x + pane.width - 24, y = pane.y + pane.height - 24) {
    x = Math.round(x); y = Math.round(y);
    await evaluate(`document.querySelector('.react-flow__pane').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:${x},clientY:${y},button:2}))`);
    await waitFor(`!!document.querySelector('.canvas-add-menu')`);
    return evaluate(`(() => { const r=document.querySelector('.react-flow__pane').getBoundingClientRect(),m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); return {x:(${x}-r.x-m.m41)/m.a,y:(${y}-r.y-m.m42)/m.d}; })()`);
  }
  await openMenu();
  assert.equal(await evaluate(`document.querySelectorAll('.canvas-add-menu [role="menuitem"]').length`), 13);
  assert.equal(await evaluate(`(() => {const r=document.querySelector('.canvas-add-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`), true);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await waitFor(`!document.querySelector('.canvas-add-menu')`);
  await openMenu();
  await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  await waitFor(`!document.querySelector('.canvas-add-menu')`);
  await openMenu();
  await evaluate(`document.querySelector('.canvas-add-menu').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`);
  assert.equal(await evaluate(`document.activeElement.textContent`), '图片输入');
  await evaluate(`window.contextMenuTest.failNext(); Array.from(document.querySelectorAll('.canvas-add-menu button')).find(b=>b.textContent==='文本输入').click()`);
  await waitFor(`document.querySelector('.canvas-add-menu [role="alert"]')?.textContent.includes('Test creation failed')`);
  assert.equal((await evaluate(`window.contextMenuTest.snapshot()`)).nodes.length, 1);
  const labels = ['文本输入','图片输入','视频输入','画布引用','文生图','图生图','文生视频','图生视频','视频转视频','白模视频','输出'];
  for (let i = 0; i < labels.length; i++) {
    const expected = await openMenu();
    await evaluate(`Array.from(document.querySelectorAll('.canvas-add-menu button')).find(b=>b.textContent===${JSON.stringify(labels[i])}).click()`);
    await waitFor(`!document.querySelector('.canvas-add-menu') && !!document.querySelector('.react-flow__node[data-id="added-${i+1}"]')`);
    const actual = await evaluate(`(() => {const m=new DOMMatrixReadOnly(document.querySelector('.react-flow__node[data-id="added-${i+1}"]').style.transform); return {x:m.m41,y:m.m42};})()`);
    assert.ok(Math.abs(actual.x - expected.x) < 0.1 && Math.abs(actual.y - expected.y) < 0.1, `Wrong position for ${labels[i]}: ${JSON.stringify({actual,expected})}`);
  }
  const graph = await evaluate(`window.contextMenuTest.snapshot()`);
  assert.equal(new Set(graph.nodes.map(node => node.type)).size, 11);
  assert.equal(graph.nodes.find(n => n.type === 'white-model-video').params.objects.length, 3);
  assert.equal(graph.nodes.find(n => n.type === 'video-to-video').params.mode, 'edit');
  assert.equal(graph.nodes.find(n => n.type === 'image-to-video').params.durationMs, 5000);
  await openMenu(pane.x + 250, pane.y + 80);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  assert.equal(await evaluate(`document.querySelector('.canvas-add-menu-title').textContent`), '添加节点');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'menu.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('button[title="Back"]').click()`);
  await waitFor(`document.querySelectorAll('.canvas-card').length === 2`);
  assert.equal(await evaluate(`!!document.querySelector('.canvas-add-menu')`), false);
  await evaluate(`document.querySelectorAll('.canvas-card')[1].click()`);
  await waitFor(`!!document.querySelector('.react-flow__pane') && document.querySelectorAll('.react-flow__node').length === 0`);
  await delay(200);
  const emptyPoint = await evaluate(`(() => {const r=document.querySelector('.react-flow__pane').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await openMenu(emptyPoint.x, emptyPoint.y);
  await evaluate(`Array.from(document.querySelectorAll('.canvas-add-menu button')).find(b=>b.textContent==='文本输入').click()`);
  await waitFor(`!document.querySelector('.canvas-add-menu') && !!document.querySelector('.react-flow__node[data-id="added-12"].selected')`);
  const emptyResult = await evaluate(`(() => {const r=document.querySelector('.react-flow__node[data-id="added-12"]').getBoundingClientRect();return {x:r.x,y:r.y};})()`);
  assert.ok(Math.abs(emptyResult.x - emptyPoint.x) < 1 && Math.abs(emptyResult.y - emptyPoint.y) < 1, 'First node in an empty canvas must stay at the clicked screen position');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ui: 'passed', nodeTypes: 11, positions: 'zoom/pan, empty canvas and notification race verified', failureRetry: 'passed', screenshot: path.join(outputDir, 'menu.png') }));
  window.destroy(); clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
