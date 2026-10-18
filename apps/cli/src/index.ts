#!/usr/bin/env node

import { CLI_MANIFEST, logger, CanvasCutError, ERROR_CODES } from '@canvas-cut/core';
import { manifest, canvasList, assetList, assetImport, refreshCanvasClips } from './commands/discovery';
import { parseArgs, CliOptions } from './args';
import { exitForResult, failure, printResult, success } from './output';
import { projectInit, projectOpen, projectStatus } from './commands/project';
import {
  canvasCreate,
  canvasEdgeConnect,
  canvasEdgeRemove,
  canvasGet,
  canvasNodeAdd,
  canvasNodeRemove,
  canvasNodeSetParam,
  canvasRemove,
  canvasRename,
  canvasRender,
  canvasStatus
} from './commands/canvas';
import {
  generateImageToImage,
  generateImageToVideo,
  generateTextToImage,
  generateTextToVideo,
  generateVideoToVideo
} from './commands/generate';
import { jobCancel, jobList, jobStatus, jobWait } from './commands/job';
import {
  timelineAddAudio,
  timelineAddClip,
  timelineAddSubtitle,
  timelineAddTrack,
  timelineAddTransition,
  timelineExport,
  timelineGet,
  timelineInit,
  timelineMoveClip,
  timelineRemoveClip,
  timelineRemoveTrack,
  timelineRemoveTransition,
  timelineSetOpacity,
  timelineSetSpeed,
  timelineSetTransform,
  timelineSetVolume,
  timelineSplitClip,
  timelineTrimClip
} from './commands/timeline';
import { presetApply, presetList, presetSave } from './commands/preset';
import { runMcpServer } from './mcp/server';

type Handler = (options: CliOptions) => Promise<unknown> | unknown;

const dispatch = new Map<string, Handler>([
  ['manifest', manifest],
  ['canvas list', canvasList],
  ['asset list', assetList],
  ['asset import', assetImport],
  ['timeline refresh-canvases', refreshCanvasClips],
  ['project init', projectInit],
  ['project open', projectOpen],
  ['project status', projectStatus],
  ['generate text-to-image', generateTextToImage],
  ['generate text-to-video', generateTextToVideo],
  ['generate image-to-image', generateImageToImage],
  ['generate image-to-video', generateImageToVideo],
  ['generate video-to-video', generateVideoToVideo],
  ['job status', jobStatus],
  ['job wait', jobWait],
  ['job cancel', jobCancel],
  ['job list', jobList],
  ['canvas create', canvasCreate],
  ['canvas get', canvasGet],
  ['canvas remove', canvasRemove],
  ['canvas rename', canvasRename],
  ['canvas node add', canvasNodeAdd],
  ['canvas node remove', canvasNodeRemove],
  ['canvas node set-param', canvasNodeSetParam],
  ['canvas edge connect', canvasEdgeConnect],
  ['canvas edge remove', canvasEdgeRemove],
  ['canvas render', canvasRender],
  ['canvas status', canvasStatus],
  ['timeline init', timelineInit],
  ['timeline get', timelineGet],
  ['timeline add-track', timelineAddTrack],
  ['timeline add-clip', timelineAddClip],
  ['timeline add-subtitle', timelineAddSubtitle],
  ['timeline add-audio', timelineAddAudio],
  ['timeline split-clip', timelineSplitClip],
  ['timeline trim-clip', timelineTrimClip],
  ['timeline move-clip', timelineMoveClip],
  ['timeline set-transform', timelineSetTransform],
  ['timeline set-opacity', timelineSetOpacity],
  ['timeline set-speed', timelineSetSpeed],
  ['timeline set-volume', timelineSetVolume],
  ['timeline remove-clip', timelineRemoveClip],
  ['timeline remove-track', timelineRemoveTrack],
  ['timeline add-transition', timelineAddTransition],
  ['timeline remove-transition', timelineRemoveTransition],
  ['timeline export', timelineExport],
  ['preset save', presetSave],
  ['preset list', presetList],
  ['preset apply', presetApply],
  ['mcp', runMcpServer]
]);

function resolveCommand(positionals: string[]): { command: string; args: string[] } | null {
  for (const length of [3, 2, 1]) {
    const key = positionals.slice(0, length).join(' ');
    if (dispatch.has(key)) {
      return { command: key, args: positionals.slice(length) };
    }
  }
  return null;
}

function printUsage(): void {
  process.stdout.write(
    [
      'canvas-cut - generative video creation CLI',
      '',
      'Usage: canvas-cut <command> [options]',
      '',
      'Commands:',
      '  project init|open|status',
      '  generate text-to-image|text-to-video|image-to-image|image-to-video|video-to-video',
      '  job status|wait|cancel|list',
      '  canvas create|get|rename|remove|node add|node remove|node set-param|edge connect|edge remove|render|status',
      '  timeline init|get|add-track|add-clip|add-subtitle|add-audio|split-clip|trim-clip|move-clip|set-transform|set-opacity|set-speed|set-volume|remove-clip|remove-track|add-transition|remove-transition|export',
      '  preset save|list|apply',
      '  manifest                     list commands and parameter schemas',
      '  asset list|import',
      '  mcp                          start MCP stdio server (Agent, screenshot and Code Mode tools)',
      '',
      'Global options: --project <path> --json --dry-run --help',
      ''
    ].join('\n')
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  logger.setConsoleStderr(true);

  if (options.help || options.positionals.length === 0) {
    if (options.help && options.positionals.length) {
      const command = resolveCommand(options.positionals)?.command;
      const detail = CLI_MANIFEST.find((item) => item.command === command?.replace(/ /g, '.'));
      printResult(success({ usage: command ? 'canvas-cut ' + command + ' [options]' : 'canvas-cut <command> [options]', command: detail, ...manifest() }), options.json);
    } else printUsage();
    process.exitCode = options.help ? 0 : 2;
    return;
  }

  const resolved = resolveCommand(options.positionals);
  if (!resolved) {
    const result = failure(new Error(`Unknown command: ${options.positionals.join(' ')}`));
    printResult(result, options.json);
    exitForResult(result);
    return;
  }

  const handler = dispatch.get(resolved.command) as Handler;
  const commandOptions: CliOptions = {
    ...options,
    positionals: resolved.args
  };

  if (resolved.command === 'mcp' && !options.dryRun) {
    await runMcpServer(commandOptions);
    return;
  }

  try {
    const dryRunSupported = resolved.command.startsWith('generate ') || ['canvas render', 'timeline export'].includes(resolved.command);
    if (options.dryRun && !dryRunSupported) throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, '--dry-run is not supported by this command; no changes made');
    const data = await handler(commandOptions);
    const result = success(data);
    printResult(result, options.json);
    exitForResult(result);
  } catch (error) {
    const result = failure(error);
    printResult(result, options.json);
    exitForResult(result);
  }
}

void main();
