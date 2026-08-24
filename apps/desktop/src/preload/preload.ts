import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  invoke(channel: string, payload: Record<string, unknown> = {}) {
    const allowed = new Set([
      'project.init',
      'project.open',
      'project.status',
      'canvas.create',
      'canvas.get',
      'canvas.list',
      'canvas.node.add',
      'canvas.node.remove',
      'canvas.node.set-param',
      'canvas.edge.connect',
      'canvas.edge.remove',
      'canvas.render',
      'timeline.get',
      'timeline.add-track',
      'timeline.add-clip',
      'timeline.add-subtitle',
      'timeline.move-clip',
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
      'config.get',
      'settings.get-runtime',
      'settings.set-runtime'
    ]);
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Channel is not allowed: ${channel}`));
    }
    return ipcRenderer.invoke('canvas-cut:invoke', channel, payload);
  }
});
