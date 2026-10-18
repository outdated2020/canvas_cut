import { contextBridge, ipcRenderer } from 'electron';

const session = process.argv.find(arg => arg.startsWith('--white-model-session='))?.split('=')[1];
if (!session) throw new Error('Missing white model render session');
const channel = `canvas-cut:white-model:${session}`;
contextBridge.exposeInMainWorld('whiteModelApi', {
  getConfig: () => ipcRenderer.invoke(channel, { action: 'config' }),
  frame: (index: number, png: string) => ipcRenderer.invoke(channel, { action: 'frame', index, png }),
  complete: (error?: string) => ipcRenderer.invoke(channel, { action: 'complete', error })
});
