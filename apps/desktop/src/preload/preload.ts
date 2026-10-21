import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  onCanvasChanged(callback: (change: { projectPath: string; canvasId: string }) => void) {
    const listener = (_event: Electron.IpcRendererEvent, change: { projectPath: string; canvasId: string }) => callback(change);
    ipcRenderer.on('canvas-cut:canvas-changed', listener);
    return () => ipcRenderer.removeListener('canvas-cut:canvas-changed', listener);
  },
  invoke(channel: string, payload: Record<string, unknown> = {}) {
    const allowed = new Set([
      'project.init',
      'project.open',
      'project.status',
      'canvas.create',
      'canvas.rename',
      'canvas.remove',
      'canvas.get',
      'canvas.list',
      'canvas.node.add',
      'canvas.node.remove',
      'canvas.node.set-param',
      'canvas.edge.connect',
      'canvas.edge.remove',
      'canvas.render',
      'timeline.get',
      'timeline.refresh-canvases',
      'timeline.add-track',
      'timeline.add-clip',
      'timeline.add-subtitle',
      'timeline.move-clip',
      'timeline.remove-clip',
      'timeline.remove-track',
      'timeline.split-clip',
      'timeline.trim-clip',
      'timeline.set-clip-param',
      'timeline.add-transition',
      'timeline.remove-transition',
      'timeline.export',
      'asset.list',
      'asset.import',
      'preset.list',
      'preset.apply',
      'job.submit',
      'job.status',
      'job.wait',
      'job.cancel',
      'job.list',
      'job.clear',
      'agent.chat',
      'agent.start',
      'agent.get-run',
      'agent.cancel',
      'agent.history',
      'agent.conversations.list',
      'agent.conversations.create',
      'agent.conversations.manage',
      'agent.runtime.get',
      'agent.runtime.set',
      'agent.runtime.test',
      'config.get',
      'settings.get-runtime',
      'settings.export-model-api',
      'settings.import-model-api',
      'settings.set-runtime'
    ]);
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Channel is not allowed: ${channel}`));
    }
    return ipcRenderer.invoke('canvas-cut:invoke', channel, payload);
  }
});
