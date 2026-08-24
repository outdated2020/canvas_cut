export interface CliCommandManifest {
  command: string;
  description: string;
  longRunning?: boolean;
  parameters: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'json';
    required?: boolean;
  }>;
}

export const CLI_MANIFEST: CliCommandManifest[] = [
  { command: 'project.init', description: 'Create a new project', parameters: [{ name: 'name', type: 'string', required: true }, { name: 'path', type: 'string' }] },
  { command: 'project.open', description: 'Open a project', parameters: [{ name: 'path', type: 'string' }] },
  { command: 'project.status', description: 'Project status', parameters: [] },
  { command: 'generate.text-to-image', description: 'Generate an image from text', longRunning: true, parameters: [{ name: 'prompt', type: 'string', required: true }, { name: 'width', type: 'number' }, { name: 'height', type: 'number' }, { name: 'seed', type: 'number' }, { name: 'style', type: 'string' }] },
  { command: 'generate.text-to-video', description: 'Generate a video from text', longRunning: true, parameters: [{ name: 'prompt', type: 'string', required: true }, { name: 'duration-ms', type: 'number' }, { name: 'fps', type: 'number' }, { name: 'width', type: 'number' }, { name: 'height', type: 'number' }] },
  { command: 'generate.image-to-image', description: 'Generate an image from an image', longRunning: true, parameters: [{ name: 'image', type: 'string', required: true }, { name: 'prompt', type: 'string', required: true }, { name: 'strength', type: 'number' }, { name: 'width', type: 'number' }, { name: 'height', type: 'number' }] },
  { command: 'generate.image-to-video', description: 'Generate a video from an image', longRunning: true, parameters: [{ name: 'image', type: 'string', required: true }, { name: 'prompt', type: 'string', required: true }, { name: 'duration-ms', type: 'number' }, { name: 'fps', type: 'number' }, { name: 'width', type: 'number' }, { name: 'height', type: 'number' }] },
  { command: 'generate.video-to-video', description: 'Edit or extend a video', longRunning: true, parameters: [{ name: 'video', type: 'string', required: true }, { name: 'prompt', type: 'string', required: true }, { name: 'mode', type: 'string', required: true }] },
  { command: 'job.status', description: 'Get job status', parameters: [{ name: 'jobId', type: 'string', required: true }] },
  { command: 'job.wait', description: 'Wait for job completion', parameters: [{ name: 'jobId', type: 'string', required: true }, { name: 'timeout-ms', type: 'number' }] },
  { command: 'job.cancel', description: 'Cancel a job', parameters: [{ name: 'jobId', type: 'string', required: true }] },
  { command: 'job.list', description: 'List jobs', parameters: [{ name: 'status', type: 'string' }] },
  { command: 'canvas.create', description: 'Create a canvas', parameters: [{ name: 'name', type: 'string' }] },
  { command: 'canvas.get', description: 'Get a canvas', parameters: [{ name: 'canvasId', type: 'string', required: true }] },
  { command: 'canvas.remove', description: 'Remove a canvas', parameters: [{ name: 'canvasId', type: 'string', required: true }] },
  { command: 'canvas.node.add', description: 'Add a canvas node', parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'type', type: 'string', required: true }, { name: 'params', type: 'json' }] },
  { command: 'canvas.node.remove', description: 'Remove a canvas node', parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'node', type: 'string', required: true }] },
  { command: 'canvas.node.set-param', description: 'Set node parameters', parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'node', type: 'string', required: true }, { name: 'params', type: 'json', required: true }] },
  { command: 'canvas.edge.connect', description: 'Connect two node ports', parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'from', type: 'string', required: true }, { name: 'to', type: 'string', required: true }] },
  { command: 'canvas.edge.remove', description: 'Remove an edge', parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'edge', type: 'string', required: true }] },
  { command: 'canvas.render', description: 'Render a canvas', longRunning: true, parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'node', type: 'string' }, { name: 'force', type: 'boolean' }] },
  { command: 'canvas.status', description: 'Canvas status', parameters: [{ name: 'canvasId', type: 'string', required: true }] },
  { command: 'timeline.init', description: 'Initialize a timeline', parameters: [] },
  { command: 'timeline.get', description: 'Get the timeline', parameters: [] },
  { command: 'timeline.add-track', description: 'Add a track', parameters: [{ name: 'type', type: 'string', required: true }, { name: 'name', type: 'string' }] },
  { command: 'timeline.add-clip', description: 'Add a clip', parameters: [{ name: 'track', type: 'string', required: true }, { name: 'kind', type: 'string', required: true }, { name: 'asset', type: 'string' }, { name: 'canvas', type: 'string' }, { name: 'start-ms', type: 'number' }, { name: 'duration-ms', type: 'number' }] },
  { command: 'timeline.add-subtitle', description: 'Add a subtitle clip', parameters: [{ name: 'track', type: 'string', required: true }, { name: 'text', type: 'string', required: true }, { name: 'start-ms', type: 'number' }, { name: 'duration-ms', type: 'number' }] },
  { command: 'timeline.add-audio', description: 'Add an audio clip', parameters: [{ name: 'track', type: 'string', required: true }, { name: 'asset', type: 'string', required: true }, { name: 'start-ms', type: 'number' }] },
  { command: 'timeline.split-clip', description: 'Split a clip', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'at-ms', type: 'number', required: true }] },
  { command: 'timeline.trim-clip', description: 'Trim a clip', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'in-ms', type: 'number', required: true }, { name: 'out-ms', type: 'number', required: true }] },
  { command: 'timeline.move-clip', description: 'Move a clip', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'start-ms', type: 'number', required: true }] },
  { command: 'timeline.set-transform', description: 'Set clip transform', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'x', type: 'number' }, { name: 'y', type: 'number' }, { name: 'scale', type: 'number' }, { name: 'rotation', type: 'number' }] },
  { command: 'timeline.set-opacity', description: 'Set clip opacity', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'opacity', type: 'number', required: true }] },
  { command: 'timeline.set-speed', description: 'Set clip speed', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'speed', type: 'number', required: true }] },
  { command: 'timeline.set-volume', description: 'Set clip volume', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'volume', type: 'number', required: true }] },
  { command: 'timeline.remove-clip', description: 'Remove a clip', parameters: [{ name: 'clip', type: 'string', required: true }] },
  { command: 'timeline.remove-track', description: 'Remove a track', parameters: [{ name: 'track', type: 'string', required: true }] },
  { command: 'timeline.add-transition', description: 'Add a transition', parameters: [{ name: 'clip', type: 'string', required: true }, { name: 'type', type: 'string', required: true }, { name: 'duration-ms', type: 'number' }] },
  { command: 'timeline.remove-transition', description: 'Remove a transition', parameters: [{ name: 'clip', type: 'string', required: true }] },
  { command: 'timeline.export', description: 'Export the timeline', longRunning: true, parameters: [{ name: 'output', type: 'string', required: true }, { name: 'profile', type: 'string' }] },
  { command: 'preset.save', description: 'Save a canvas as a preset', parameters: [{ name: 'canvas', type: 'string', required: true }, { name: 'name', type: 'string', required: true }] },
  { command: 'preset.list', description: 'List presets', parameters: [] },
  { command: 'preset.apply', description: 'Apply a preset', parameters: [{ name: 'preset', type: 'string', required: true }, { name: 'name', type: 'string' }] }
];

export function findManifest(command: string): CliCommandManifest | undefined {
  return CLI_MANIFEST.find((item) => item.command === command);
}
