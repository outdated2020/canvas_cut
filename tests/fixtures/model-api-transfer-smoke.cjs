const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path'), fs = require('node:fs/promises'), assert = require('node:assert/strict');
if (!process.argv[2]) throw Error('Pass an isolated output directory');
const outputDir = path.resolve(process.argv[2]);
app.setPath('userData', path.join(outputDir, 'profile'));
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('Model API UI timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const core = require('../../packages/core/dist/index.js');
  const transfer = require('../../apps/desktop/dist/main/model-api-transfer.js');
  await fs.mkdir(outputDir, { recursive: true });
  const exportPath = path.join(outputDir, 'export.json'), importPath = path.join(outputDir, 'import.json');
  let cancel = false, saveCount = 0;
  let saved = { arkBaseUrl: 'https://ark.fixture/v3', arkImageModel: 'fixture-image', arkVideoModel: 'fixture-video', arkApiKey: 'fake-ark-secret',
    agentBaseUrl: 'https://agent.fixture/v1', agentModel: 'fixture-agent', agentApiKey: 'fake-agent-secret',
    tosAccessKeyId: 'fake-tos-id', tosAccessKeySecret: 'fake-tos-secret', tosBucket: 'bucket', tosRegion: 'cn-beijing', tosEndpoint: 'https://tos.fixture', ffmpegPath: 'machine-specific' };
  const dialogs = { save: async () => cancel ? undefined : exportPath, open: async () => cancel ? undefined : importPath };
  ipcMain.handle('canvas-cut:invoke', async (_event, channel, payload) => {
    if (channel === 'settings.export-model-api') return transfer.exportModelApiSettings(dialogs, payload.settings, payload.includeSecrets === true);
    if (channel === 'settings.import-model-api') return transfer.importModelApiSettings(dialogs);
    if (channel === 'settings.get-runtime') return saved;
    if (channel === 'settings.set-runtime') { const { path, ...values } = payload; saved = values; saveCount++; return { configured: true }; }
    if (channel === 'config.get') return core.createDefaultConfigFile();
    if (channel === 'project.open') return { id: 'test', path: payload.path, name: '配置迁移测试', settings: core.defaultProjectSettings(), timeline: { schemaVersion: 1, tracks: [] } };
    if (channel === 'agent.runtime.get') return { config: {}, skills: [], ptyAvailable: true };
    if (['canvas.list', 'asset.list', 'preset.list', 'job.list', 'agent.conversations.list'].includes(channel)) return [];
    if (channel === 'agent.history' || channel === 'agent.get-run') return { messages: [], events: [], run: null };
    if (channel === 'timeline.get') return { schemaVersion: 1, tracks: [] };
    throw Error('Unexpected fixture channel: ' + channel);
  });
  const win = new BrowserWindow({ show: false, width: 1200, height: 960, webPreferences: {
    preload: path.join(__dirname, '../../apps/desktop/dist/preload/preload.js'), sandbox: false, contextIsolation: true, nodeIntegration: false,
    offscreen: true, backgroundThrottling: false
  } });
  const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  const evaluate = async code => {
    try { return await win.webContents.executeJavaScript(code); }
    catch (error) { throw Error(`Browser check failed: ${code}\n${errors.join('\n')}\n${error}`); }
  }, delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(code) { for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await delay(40); } throw Error('Condition not met: ' + code); }
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const field = text => `Array.from(document.querySelectorAll('.settings-modal label')).find(l=>l.textContent.trim()===${JSON.stringify(text)}).querySelector('input').value`;
  await win.loadFile(path.join(__dirname, '../../apps/desktop/dist/renderer/index.html'));
  await waitFor(`!!document.querySelector('button[title="Settings"]')`);
  await evaluate(`document.querySelector('button[title="Settings"]').click()`);
  await waitFor(`!!document.querySelector('.model-api-transfer')`);
  assert.equal(await evaluate(`document.querySelector('.model-api-transfer input').checked`), false);
  await click('导出配置');
  await waitFor(`document.querySelector('.model-api-transfer').textContent.includes('不包含密钥')`);
  const withoutKeys = JSON.parse(await fs.readFile(exportPath, 'utf8')).settings;
  for (const key of ['arkApiKey', 'agentApiKey', 'tosAccessKeyId', 'tosAccessKeySecret', 'ffmpegPath']) assert.ok(!(key in withoutKeys));
  await evaluate(`document.querySelector('.model-api-transfer input').click()`);
  await click('导出配置');
  await waitFor(`document.querySelector('.model-api-transfer [role="status"]')?.textContent.includes('明文密钥')`);
  assert.equal(JSON.parse(await fs.readFile(exportPath, 'utf8')).settings.agentApiKey, 'fake-agent-secret');
  await fs.writeFile(importPath, transfer.serializeModelApiSettings({ agentModel: '跨电脑模型', arkImageModel: 'custom-image' }, false));
  cancel = true; await click('导入配置');
  await waitFor(`!document.querySelector('.model-api-transfer').disabled`);
  assert.equal(await evaluate(field('Agent Model')), 'fixture-agent');
  cancel = false;
  await fs.writeFile(importPath, '{invalid'); await click('导入配置');
  await waitFor(`document.querySelector('.model-api-transfer').textContent.includes('不是有效的 JSON')`);
  assert.equal(await evaluate(field('Agent Model')), 'fixture-agent');
  await fs.writeFile(importPath, transfer.serializeModelApiSettings({ agentModel: '跨电脑模型', arkImageModel: 'custom-image' }, false));
  await click('导入配置');
  await waitFor(`document.querySelector('.model-api-transfer').textContent.includes('配置已填入表单')`);
  assert.equal(await evaluate(field('Agent Model')), '跨电脑模型');
  assert.equal(await evaluate(field('Agent API Key')), 'fake-agent-secret');
  assert.equal(await evaluate(field('FFmpeg path')), 'machine-specific');
  assert.equal(saveCount, 0);
  await fs.writeFile(path.join(outputDir, 'settings.png'), (await win.webContents.capturePage()).toPNG());
  await click('保存'); await waitFor(`!document.querySelector('.settings-modal')`);
  assert.equal(saveCount, 1); assert.equal(saved.agentModel, '跨电脑模型'); assert.equal(saved.agentApiKey, 'fake-agent-secret');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ui: 'passed', checks: 'real preload, optional credentials, dialog cancellation, invalid file recovery, import draft and explicit save', outputDir }));
  win.destroy(); clearTimeout(timeout); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); app.exit(1); });
