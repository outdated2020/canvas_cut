const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const outputDir = path.resolve(process.argv[2]);
app.setPath('userData', path.join(outputDir, 'ui-profile'));
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('White model UI test timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: {
    preload: path.join(__dirname, 'white-model-ui-preload.cjs'), sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await window.loadFile(path.join(__dirname, '../../apps/desktop/dist/renderer/index.html'));
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function waitFor(code) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(code)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`UI condition not met: ${code}`);
  }
  await waitFor(`Array.from(document.querySelectorAll('.panel-tabs button')).some(button => button.textContent === 'Canvas')`);
  await evaluate(`Array.from(document.querySelectorAll('.panel-tabs button')).find(button => button.textContent === 'Canvas').click()`);
  await waitFor(`!!document.querySelector('.canvas-card')`);
  await evaluate(`document.querySelector('.canvas-card').click()`);
  await waitFor(`!!document.querySelector('option[value="white-model-video"]')`);
  await evaluate(`(() => { const select = document.querySelector('option[value="white-model-video"]').parentElement; select.value = 'white-model-video'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Add node').click()`);
  await waitFor(`!!document.querySelector('.white-model-node')`);
  await evaluate(`document.querySelector('.white-model-node').click()`);
  await waitFor(`!!document.querySelector('.white-model-preview canvas')`);
  assert.equal(await evaluate(`document.querySelector('.white-model-preview canvas').width`), 480);
  await evaluate(`(() => { const input = Array.from(document.querySelectorAll('.white-model-params .params-field')).find(label => label.textContent.includes('视角')).querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '60'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await waitFor(`document.querySelector('.white-model-params .params-actions button').disabled === false`);
  await evaluate(`document.querySelector('.white-model-params').requestSubmit()`);
  await waitFor(`window.whiteModelUiTest.snapshot().nodes.find(node => node.id === 'local').params.camera.fov === 60`);
  await evaluate(`document.querySelector('button[title="Expand"]').click()`);
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await new Promise(resolve => setTimeout(resolve, 350));
  await evaluate(`document.querySelector('.react-flow__controls-fitview').click()`);
  await new Promise(resolve => setTimeout(resolve, 350));
  await fs.mkdir(outputDir, { recursive: true });
  const screenshot = path.join(outputDir, 'editor.png');
  await fs.writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ui: 'passed', screenshot, savedFov: 60 }));
  window.destroy(); clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
