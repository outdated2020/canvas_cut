import { CanvasCutError, ERROR_CODES } from '@canvas-cut/core';

export interface CliOptions {
  project?: string;
  json: boolean;
  dryRun: boolean;
  help: boolean;
  positionals: string[];
  flags: Record<string, string | boolean | undefined>;
}

function parseLongOption(value: string): { key: string; inline?: string } {
  const body = value.slice(2);
  const eq = body.indexOf('=');
  if (eq >= 0) {
    return { key: body.slice(0, eq), inline: body.slice(eq + 1) };
  }
  return { key: body };
}

export function parseArgs(argv: string[]): CliOptions {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | undefined> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const { key, inline } = parseLongOption(arg);
      if (inline !== undefined) {
        flags[key] = inline;
      } else {
        const next = argv[index + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          index += 1;
        } else {
          flags[key] = true;
        }
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const short = arg.slice(1);
      const key = {
        h: 'help',
        p: 'project'
      }[short] ?? short;
      const next = argv[index + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positionals.push(arg);
  }

  return {
    project:
      typeof flags.project === 'string'
        ? flags.project
        : typeof flags.path === 'string'
          ? flags.path
          : undefined,
    json: flags.json === true || flags.json === 'true',
    dryRun: flags['dry-run'] === true || flags['dry-run'] === 'true',
    help: flags.help === true || flags.help === 'true',
    positionals,
    flags
  };
}

export function stringFlag(
  flags: Record<string, string | boolean | undefined>,
  name: string,
  fallback?: string
): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : fallback;
}

export function numberFlag(
  flags: Record<string, string | boolean | undefined>,
  name: string,
  fallback?: number
): number | undefined {
  const value = flags[name];
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function boolFlag(
  flags: Record<string, string | boolean | undefined>,
  name: string,
  fallback = false
): boolean {
  const value = flags[name];
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === '1';
}

export function jsonFlag(
  flags: Record<string, string | boolean | undefined>,
  name: string
): Record<string, unknown> | undefined {
  const value = flags[name];
  if (typeof value !== 'string') return undefined;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new CanvasCutError(ERROR_CODES.INVALID_PARAMS, `Invalid JSON for --${name}`);
  }
}
