const { app, BrowserWindow } = require('electron');
const path = require('node:path'), fs = require('node:fs/promises'), assert = require('node:assert/strict');
const outputDir = path.resolve(process.argv[2]);
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.setPath('userData', path.join(outputDir, 'profile'));
app.on('window-all-closed', () => {});
process.env.CANVAS_NAME_TEST_ROOT = path.join(outputDir, `project-${process.pid}`);
const timeout = setTimeout(() => { console.error('Canvas name UI timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  await fs.mkdir(outputDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: {
    preload: path.join(__dirname, 'canvas-name-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false
  } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(code) { for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await delay(30); } throw Error('Condition not met: ' + code); }
  async function list() {
    await waitFor(`!!document.querySelector('.panel-tabs')`);
    await evaluate(`Array.from(document.querySelectorAll('.panel-tabs button')).find(b=>b.textContent==='Canvas').click()`);
    await waitFor(`document.querySelectorAll('.canvas-card').length===2`);
  }
  const first = '.canvas-card-wrap:first-child .canvas-name-editor';
  async function edit(selector) {
    await evaluate(`document.querySelector('${selector} .canvas-name-label').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
    await waitFor(`!!document.querySelector('${selector} input')`);
  }
  async function type(selector, value) {
    await evaluate(`(()=>{const i=document.querySelector('${selector} input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(value)});i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  async function save(selector) { await evaluate(`document.querySelector('${selector} form').requestSubmit()`); }
  await win.loadFile(path.join(__dirname, '../../apps/desktop/dist/renderer/index.html'));
  await list();
  assert.equal(await evaluate(`document.querySelector('${first} .canvas-name-label').textContent`), 'Canvas 1');
  assert.equal(await evaluate(`document.querySelector('.canvas-card-wrap:nth-child(2) .canvas-name-label').textContent`), '已有名称');
  await edit(first);
  assert.equal(await evaluate(`!!document.querySelector('.canvas-graph')`), false, 'Editing the card name must not open the canvas');
  await type(first, '  广州塔与悟空 🐒  '); await save(first);
  await waitFor(`document.querySelector('${first} .canvas-name-label')?.textContent==='广州塔与悟空 🐒'`);
  assert.equal((await evaluate(`window.canvasNameTest.read('legacy')`)).name, '广州塔与悟空 🐒');
  await edit(first); await type(first, '取消这次修改');
  await evaluate(`document.querySelector('${first} input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await waitFor(`!document.querySelector('${first} input')`);
  assert.equal((await evaluate(`window.canvasNameTest.read('legacy')`)).name, '广州塔与悟空 🐒');
  await edit(first); await type(first, '   '); await save(first);
  await waitFor(`!!document.querySelector('${first} [role="alert"]')`);
  assert.equal(await evaluate(`document.querySelector('${first} input').value`), '   ');
  await type(first, '可重试的名字'); await evaluate(`window.canvasNameTest.failNext()`); await save(first);
  await waitFor(`document.querySelector('${first} [role="alert"]')?.textContent.includes('测试保存失败')`);
  assert.equal(await evaluate(`document.querySelector('${first} input').value`), '可重试的名字');
  await save(first);
  await waitFor(`document.querySelector('${first} .canvas-name-label')?.textContent==='可重试的名字'`);
  await evaluate(`document.querySelector('.canvas-card').click()`);
  const toolbar = '.canvas-toolbar > .canvas-name-editor';
  await waitFor(`!!document.querySelector('${toolbar}')`);
  await evaluate(`document.querySelector('${toolbar} .canvas-name-edit').click()`);
  await waitFor(`!!document.querySelector('${toolbar} input')`);
  await type(toolbar, '悟空飞往鸟巢');
  win.webContents.focus();
  await evaluate(`document.querySelector('${toolbar} input').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(`document.querySelector('${toolbar} .canvas-name-label')?.textContent==='悟空飞往鸟巢'`);
  await evaluate(`window.canvasNameTest.renameExternally('legacy','外部同步名称')`);
  await waitFor(`document.querySelector('${toolbar} .canvas-name-label')?.textContent==='外部同步名称'`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.canvas-toolbar > button')).every(button=>getComputedStyle(button).whiteSpace==='nowrap')`), true);
  await fs.writeFile(path.join(outputDir, 'toolbar.png'), (await win.webContents.capturePage()).toPNG());
  await new Promise(resolve => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await list();
  await waitFor(`document.querySelector('${first} .canvas-name-label')?.textContent==='外部同步名称'`);
  await fs.writeFile(path.join(outputDir, 'cards.png'), (await win.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ui: 'passed', checks: 'list and toolbar rename, Unicode, Escape, invalid name, failure retry, external notification and disk persistence after reload', screenshots: outputDir }));
  win.destroy(); clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
