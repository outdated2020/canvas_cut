import type { WhiteModelRequest } from '@canvas-cut/core/dist/canvas/white-model';
import { WhiteModelScene } from './white-model-scene';

const api = (window as unknown as { whiteModelApi: {
  getConfig(): Promise<WhiteModelRequest>;
  frame(index: number, png: string): Promise<void>;
  complete(error?: string): Promise<void>;
} }).whiteModelApi;

async function exportFrames() {
  let scene: WhiteModelScene | undefined;
  try {
    const request = await api.getConfig();
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    scene = new WhiteModelScene(canvas, request);
    for (let index = 0; index < request.frameCount; index++) {
      scene.render(request.frameCount > 1 ? index / (request.frameCount - 1) : 0);
      // Capture synchronously after rendering; no real-time timer or dropped frames.
      const png = canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
      await api.frame(index, png);
    }
    await api.complete();
  } catch (error) {
    await api.complete(error instanceof Error ? error.message : String(error)).catch(() => undefined);
  } finally {
    scene?.dispose();
  }
}
void exportFrames();
