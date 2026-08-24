export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  bufferSize?: number;
  logFile?: string;
  onEntry?: (entry: LogEntry) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

let fsAppend: ((file: string, line: string) => void) | undefined;
try {
  const fs = require('node:fs');
  fsAppend = (file: string, line: string) => {
    try {
        fs.appendFileSync(file, line + '\n', 'utf8');
      } catch (e: unknown) {
        console.error('[logger] Failed to write log file:', (e as Error).message);
      }
  };
} catch {
  // 浏览器环境，无 fs 模块
}

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly maxBuffer: number;
  private readonly minLevel: number;
  private readonly listeners: Array<(entry: LogEntry) => void> = [];
  private logFile: string | undefined;

  constructor(options: LoggerOptions = {}) {
    this.maxBuffer = options.bufferSize ?? 500;
    this.minLevel = LEVEL_ORDER[options.level ?? 'debug'] ?? 0;
    this.logFile = options.logFile;
    if (options.onEntry) this.listeners.push(options.onEntry);

    // 默认输出到 console
    this.listeners.push((entry: LogEntry) => {
      const ts = new Date(entry.timestamp).toISOString().slice(0, 23).replace('T', ' ');
      const fn =
        entry.level === 'error'
          ? console.error
          : entry.level === 'warn'
            ? console.warn
            : console.log;
      fn('[' + ts + '] [' + entry.level.toUpperCase() + '] ' + entry.message, entry.data ?? '');
    });
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }
  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }
  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }
  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    const entry: LogEntry = { timestamp: Date.now(), level, message, data };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(-this.maxBuffer);
    }

    // 写入文件
    if (this.logFile && fsAppend) {
      const ts = new Date(entry.timestamp).toISOString().slice(0, 23).replace('T', ' ');
      const line = '[' + ts + '] [' + level.toUpperCase() + '] ' + message;
      fsAppend(this.logFile, line);
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // ignore listener errors
      }
    }
  }

  entries(): ReadonlyArray<LogEntry> {
    return this.buffer;
  }

  clear(): void {
    this.buffer = [];
  }

  setLogFile(file: string): void { this.logFile = file; }

  onEntry(listener: (entry: LogEntry) => void): void {
    this.listeners.push(listener);
  }
}

// 全局单例（无文件输出，适合 renderer 或不需要文件日志的场景）
export const logger = new Logger({ level: 'debug' });