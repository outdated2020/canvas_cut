import { BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export interface UiScreenshotResult {
  path: string;
  width: number;
  height: number;
  bytes: number;
  capturedAt: number;
}

export function screenshotFilePath(userDataDir: string): string {
  return join(userDataDir, 'ui-screenshots', 'main-window-latest.png');
}

export async function captureWindowScreenshot(
  window: BrowserWindow,
  userDataDir: string
): Promise<UiScreenshotResult> {
  if (window.isDestroyed()) {
    throw new Error('Main window is destroyed');
  }
  const image = await window.webContents.capturePage();
  if (image.isEmpty()) {
    throw new Error('Captured screenshot is empty');
  }
  const png = image.toPNG();
  const file = screenshotFilePath(userDataDir);
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, png);
  const { width, height } = image.getSize();
  return { path: file, width, height, bytes: png.byteLength, capturedAt: Date.now() };
}
