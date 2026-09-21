import {
  CanvasCutError,
  ERROR_CODES,
  ImageToImageRequest,
  ImageToVideoRequest,
  TextToImageRequest,
  TextToVideoRequest,
  VideoToVideoRequest
} from '@canvas-cut/core';
import { createStore } from '../context';
import type { CliOptions } from '../args';
import { numberFlag, stringFlag } from '../args';
import { LocalIpcClient } from '../ipc/client';

function requiredPrompt(options: CliOptions): string {
  const prompt = stringFlag(options.flags, 'prompt');
  if (!prompt) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'generate command requires --prompt');
  }
  return prompt;
}

export async function generateTextToImage(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const project = await store.readProject();
  const prompt = requiredPrompt(options);
  const request: TextToImageRequest = {
    prompt,
    negativePrompt: stringFlag(options.flags, 'negative-prompt'),
    width: numberFlag(options.flags, 'width', project.settings.width) as number,
    height: numberFlag(options.flags, 'height', project.settings.height) as number,
    seed: numberFlag(options.flags, 'seed'),
    style: stringFlag(options.flags, 'style')
  };

  if (options.dryRun) {
    return { type: 'generate.text-to-image', request };
  }
  const client = new LocalIpcClient(store.paths.root, stringFlag(options.flags, 'idempotency-key'));
  return client.request('job.submit', { type: 'generate.text-to-image', request });
}

export async function generateTextToVideo(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const project = await store.readProject();
  const prompt = requiredPrompt(options);
  const request: TextToVideoRequest = {
    prompt,
    negativePrompt: stringFlag(options.flags, 'negative-prompt'),
    durationMs: numberFlag(options.flags, 'duration-ms'),
    fps: numberFlag(options.flags, 'fps', project.settings.fps),
    width: numberFlag(options.flags, 'width', project.settings.width),
    height: numberFlag(options.flags, 'height', project.settings.height),
    seed: numberFlag(options.flags, 'seed'),
    motionStrength: numberFlag(options.flags, 'motion-strength')
  };

  if (options.dryRun) {
    return { type: 'generate.text-to-video', request };
  }
  const client = new LocalIpcClient(store.paths.root, stringFlag(options.flags, 'idempotency-key'));
  return client.request('job.submit', { type: 'generate.text-to-video', request });
}

export async function generateImageToImage(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const project = await store.readProject();
  const prompt = requiredPrompt(options);
  const imagePath = stringFlag(options.flags, 'image');
  if (!imagePath) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'generate image-to-image requires --image');
  }
  const image = await store.importAsset(imagePath, 'image');
  const request: ImageToImageRequest = {
    image,
    prompt,
    negativePrompt: stringFlag(options.flags, 'negative-prompt'),
    strength: numberFlag(options.flags, 'strength'),
    width: numberFlag(options.flags, 'width', project.settings.width),
    height: numberFlag(options.flags, 'height', project.settings.height),
    seed: numberFlag(options.flags, 'seed')
  };

  if (options.dryRun) {
    return { type: 'generate.image-to-image', request };
  }
  const client = new LocalIpcClient(store.paths.root, stringFlag(options.flags, 'idempotency-key'));
  return client.request('job.submit', { type: 'generate.image-to-image', request });
}

export async function generateImageToVideo(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const project = await store.readProject();
  const prompt = requiredPrompt(options);
  const imagePath = stringFlag(options.flags, 'image');
  if (!imagePath) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'generate image-to-video requires --image');
  }
  const image = await store.importAsset(imagePath, 'image');
  const request: ImageToVideoRequest = {
    image,
    prompt,
    negativePrompt: stringFlag(options.flags, 'negative-prompt'),
    durationMs: numberFlag(options.flags, 'duration-ms', 5000) as number,
    fps: numberFlag(options.flags, 'fps', project.settings.fps),
    width: numberFlag(options.flags, 'width', project.settings.width),
    height: numberFlag(options.flags, 'height', project.settings.height),
    seed: numberFlag(options.flags, 'seed'),
    motionStrength: numberFlag(options.flags, 'motion-strength')
  };

  if (options.dryRun) {
    return { type: 'generate.image-to-video', request };
  }
  const client = new LocalIpcClient(store.paths.root, stringFlag(options.flags, 'idempotency-key'));
  return client.request('job.submit', { type: 'generate.image-to-video', request });
}

export async function generateVideoToVideo(options: CliOptions): Promise<unknown> {
  const store = createStore(options);
  await store.requireOpen();
  const project = await store.readProject();
  const prompt = requiredPrompt(options);
  const videoPath = stringFlag(options.flags, 'video');
  if (!videoPath) {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'generate video-to-video requires --video');
  }
  const mode = stringFlag(options.flags, 'mode');
  if (mode !== 'edit' && mode !== 'extend') {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, 'generate video-to-video requires --mode edit|extend');
  }
  const video = await store.importAsset(videoPath, 'video');
  const request: VideoToVideoRequest = {
    video,
    prompt,
    mode,
    durationMs: numberFlag(options.flags, 'duration-ms'),
    fps: numberFlag(options.flags, 'fps', project.settings.fps),
    width: numberFlag(options.flags, 'width', project.settings.width),
    height: numberFlag(options.flags, 'height', project.settings.height),
    seed: numberFlag(options.flags, 'seed'),
    motionStrength: numberFlag(options.flags, 'motion-strength')
  };

  if (options.dryRun) {
    return { type: 'generate.video-to-video', request };
  }
  const client = new LocalIpcClient(store.paths.root, stringFlag(options.flags, 'idempotency-key'));
  return client.request('job.submit', { type: 'generate.video-to-video', request });
}
