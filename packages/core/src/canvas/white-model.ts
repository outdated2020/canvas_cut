import { CanvasCutError, ERROR_CODES } from '../errors';
import type { ProjectSettings } from '../types';

export type Vector3Tuple = [number, number, number];
export interface WhiteModelObject {
  shape: 'box' | 'sphere' | 'cylinder';
  position: Vector3Tuple;
  size: Vector3Tuple;
  rotation: Vector3Tuple;
  endPosition?: Vector3Tuple;
  endRotation?: Vector3Tuple;
}
export interface WhiteModelRequest {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  frameCount: number;
  objects: WhiteModelObject[];
  camera: { start: Vector3Tuple; end: Vector3Tuple; target: Vector3Tuple; fov: number };
  background: string;
  ground: boolean;
  lightIntensity: number;
}

export function defaultWhiteModelParams() {
  return {
    width: 1280, height: 720, fps: 30, durationMs: 5000,
    objects: [
      { shape: 'box' as const, position: [-2, 1, 0], size: [2, 2, 2], rotation: [0, 0, 0] },
      { shape: 'sphere' as const, position: [1, 1, 0], size: [2, 2, 2], rotation: [0, 0, 0] },
      { shape: 'cylinder' as const, position: [0, 1.5, -3], size: [1.5, 3, 1.5], rotation: [0, 0, 0] }
    ],
    camera: { start: [8, 5, 10], end: [-8, 4, 10], target: [0, 1, 0], fov: 45 },
    background: '#dfe3e8', ground: true, lightIntensity: 3
  };
}

/** Shared validation for UI, MCP parameters and render-time project defaults. */
export function buildWhiteModelRequest(params: Record<string, unknown>, settings?: Pick<ProjectSettings, 'width' | 'height' | 'fps'>): WhiteModelRequest {
  const defaults = defaultWhiteModelParams();
  function invalid(field: string): never {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Invalid white-model-video parameter: ${field}`);
  }
  function number(value: unknown, fallback: number, min: number, max: number, field: string, integer = false): number {
    const result = value === undefined ? fallback : value;
    if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) invalid(field);
    return result;
  }
  function vector(value: unknown, fallback: number[], field: string, min = -1000, max = 1000): Vector3Tuple {
    const result = value === undefined ? fallback : value;
    if (!Array.isArray(result) || result.length !== 3) invalid(field);
    return result.map((component, i) => number(component, fallback[i]!, min, max, `${field}[${i}]`)) as Vector3Tuple;
  }
  const width = number(params.width, settings?.width ?? defaults.width, 64, 1920, 'width', true);
  const height = number(params.height, settings?.height ?? defaults.height, 64, 1920, 'height', true);
  if (width % 2 || height % 2 || width * height > 1920 * 1080) invalid('width/height (even dimensions, at most 1920×1080 pixels)');
  const fps = number(params.fps, settings?.fps ?? defaults.fps, 1, 60, 'fps', true);
  const durationMs = number(params.durationMs, defaults.durationMs, 100, 30000, 'durationMs', true);
  const inputObjects = params.objects === undefined ? defaults.objects : params.objects;
  if (!Array.isArray(inputObjects) || inputObjects.length < 1 || inputObjects.length > 100) invalid('objects (1–100 primitives)');
  const objects = inputObjects.map((input, index): WhiteModelObject => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`objects[${index}]`);
    const item = input as Record<string, unknown>;
    if (!['box', 'sphere', 'cylinder'].includes(String(item.shape))) invalid(`objects[${index}].shape`);
    return {
      shape: item.shape as WhiteModelObject['shape'],
      position: vector(item.position, [0, 1, 0], `objects[${index}].position`),
      size: vector(item.size, [1, 1, 1], `objects[${index}].size`, 0.01),
      rotation: vector(item.rotation, [0, 0, 0], `objects[${index}].rotation`, -3600, 3600),
      ...(item.endPosition === undefined ? {} : { endPosition: vector(item.endPosition, [0, 1, 0], `objects[${index}].endPosition`) }),
      ...(item.endRotation === undefined ? {} : { endRotation: vector(item.endRotation, [0, 0, 0], `objects[${index}].endRotation`, -3600, 3600) })
    };
  });
  if (params.camera !== undefined && (!params.camera || typeof params.camera !== 'object' || Array.isArray(params.camera))) invalid('camera');
  const cameraParams = (params.camera ?? {}) as Record<string, unknown>;
  const camera = {
    start: vector(cameraParams.start, defaults.camera.start, 'camera.start'),
    end: vector(cameraParams.end, defaults.camera.end, 'camera.end'),
    target: vector(cameraParams.target, defaults.camera.target, 'camera.target'),
    fov: number(cameraParams.fov, defaults.camera.fov, 10, 100, 'camera.fov')
  };
  for (const position of [camera.start, camera.end]) {
    if (position.every((v, i) => v === camera.target[i])) invalid('camera (position must differ from target)');
  }
  const background = params.background ?? defaults.background;
  if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) invalid('background');
  const ground = params.ground ?? defaults.ground;
  if (typeof ground !== 'boolean') invalid('ground');
  return {
    width, height, fps, durationMs, frameCount: Math.max(1, Math.round(durationMs * fps / 1000)),
    objects, camera, background, ground,
    lightIntensity: number(params.lightIntensity, defaults.lightIntensity, 0, 10, 'lightIntensity')
  };
}

export const whiteModelParamsSchema = {
  width: { type: 'integer', minimum: 64, maximum: 1920, multipleOf: 2 },
  height: { type: 'integer', minimum: 64, maximum: 1920, multipleOf: 2 },
  fps: { type: 'integer', minimum: 1, maximum: 60 },
  durationMs: { type: 'integer', minimum: 100, maximum: 30000, description: 'Local video duration in milliseconds, rounded to the nearest frame.' },
  objects: { type: 'array', minItems: 1, maxItems: 100, items: {
    type: 'object', required: ['shape'], additionalProperties: false,
    properties: {
      shape: { enum: ['box', 'sphere', 'cylinder'] },
      ...Object.fromEntries(['position', 'size', 'rotation', 'endPosition', 'endRotation'].map(key => [key, {
        type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: key === 'size' ? 0.01 : key.includes('otation') ? -3600 : -1000, maximum: key.includes('otation') ? 3600 : 1000 },
        description: key.includes('otation') ? 'XYZ Euler angles in degrees.' : 'XYZ components in scene units.'
      }]))
    }
  } },
  camera: { type: 'object', additionalProperties: false, properties: {
    ...Object.fromEntries(['start', 'end', 'target'].map(key => [key, { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -1000, maximum: 1000 } }])),
    fov: { type: 'number', minimum: 10, maximum: 100 }
  } },
  background: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
  ground: { type: 'boolean' }, lightIntensity: { type: 'number', minimum: 0, maximum: 10 }
};
