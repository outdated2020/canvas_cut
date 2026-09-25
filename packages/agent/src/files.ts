import { promises as fs } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import ignore from 'ignore';
import picomatch from 'picomatch';
import type { ToolContext } from './host';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const MAX = 16 * 1024 * 1024;
export const fileHash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export function fileError(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
export function decode(data: Buffer) {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
  catch { return fileError('INVALID_ENCODING', 'Expected UTF-8'); }
  if (text.includes('\0')) fileError('BINARY_FILE', 'Binary files are not supported');
  return text;
}
async function bytes(path: string) {
  const stat = await fs.stat(path);
  if (!stat.isFile()) fileError('NOT_FILE', `Not a file: ${path}`);
  if (stat.size > MAX) fileError('FILE_TOO_LARGE', 'File exceeds 16 MiB');
  const data = await fs.readFile(path);
  if (data.length > MAX) fileError('FILE_TOO_LARGE', 'File exceeds 16 MiB');
  return data;
}
async function exists(path: string) { try { await fs.lstat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function actualPath(path: string): Promise<string> {
  try { return await fs.realpath(path); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    if (await exists(path)) fileError('BROKEN_SYMLINK', path);
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await actualPath(parent), path.slice(parent.length).replace(/^[/\\]+/, ''));
  }
}
const pathKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
// All file mutations in this runtime share a serial gate, including multiple hosts.
let mutationTail: Promise<unknown> = Promise.resolve();
export function serializeFiles<T>(fn: () => Promise<T>): Promise<T> {
  const next = mutationTail.catch(() => undefined).then(fn); mutationTail = next; return next;
}
async function replace(path: string, data: Buffer, create = false, mode?: number) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { flag: 'wx' });
    if (mode !== undefined) await fs.chmod(temp, mode);
    if (create) await fs.link(temp, path);
    else { await fs.chmod(temp, (await fs.stat(path)).mode); await fs.rename(temp, path); }
  } finally { await fs.rm(temp, { force: true }); }
}
interface Snapshot { hash: string; lines: Set<number>; total: number }
interface Change { path: string; before: string | null; after: string | null; mode?: number }
interface Journal { id: string; status: string; changes: Change[] }
export class FileTools {
  private snapshots = new Map<string, Snapshot>();
  constructor(readonly cwd: string, readonly journalDir: string) {}
  private key(path: string, ctx: ToolContext) { return `${ctx.sessionId}:${ctx.runId}:${pathKey(path)}`; }
  async execute(name: string, args: Record<string, any>, ctx: ToolContext): Promise<unknown> {
    ctx.signal.throwIfAborted();
    const path = resolve(this.cwd, args.path ?? '.');
    if (name === 'read_file') {
      const target = await actualPath(path), data = await bytes(target), raw = decode(data), hasBom = raw.startsWith('\ufeff');
      const text = hasBom ? raw.slice(1) : raw;
      const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      const start = args.startLine ?? 1, count = args.lineCount ?? 200, hash = fileHash(data);
      const key = this.key(target, ctx), old = this.snapshots.get(key);
      const snapshot = old?.hash === hash ? old : { hash, lines: new Set<number>(), total: lines.length };
      for (let i = start - 1; i < Math.min(lines.length, start - 1 + count); i++) snapshot.lines.add(i);
      this.snapshots.set(key, snapshot);
      const crlf = text.includes('\r\n'), lf = /(?<!\r)\n/.test(text);
      return { path, resolvedPath: target, content: lines.slice(start - 1, start - 1 + count).join(''), startLine: start, totalLines: lines.length,
        nextLine: start - 1 + count < lines.length ? start + count : null, fileHash: hash, sizeBytes: data.length,
        lineEnding: crlf && lf ? 'mixed' : crlf ? 'crlf' : lf ? 'lf' : 'none', hasBom };
    }
    if (name === 'write_file') return serializeFiles(async () => {
      const target = await actualPath(path), mode = args.mode ?? 'create', present = await exists(target);
      if (mode === 'create' && present) fileError('ALREADY_EXISTS', target);
      if (mode === 'create' && args.expectedHash) fileError('INVALID_PARAMS', 'create cannot specify expectedHash');
      if (mode === 'overwrite' && !present) fileError('NOT_FOUND', target);
      const before = present ? await bytes(target) : null;
      if (mode === 'overwrite' && (!args.expectedHash || fileHash(before!) !== args.expectedHash)) fileError('FILE_CHANGED', 'Read current file and pass expectedHash');
      const body = String(args.content);
      const data = Buffer.from((before && decode(before).startsWith('\ufeff') && !body.startsWith('\ufeff') ? '\ufeff' : '') + body);
      decode(data);
      if (data.length > 1024 * 1024) fileError('FILE_TOO_LARGE', 'write_file is limited to 1 MiB');
      if (args.createDirectories) await fs.mkdir(dirname(target), { recursive: true });
      ctx.signal.throwIfAborted(); await replace(target, data, mode === 'create');
      return { path, resolvedPath: target, operation: present ? 'overwritten' : 'created', bytes: data.length, previousHash: before ? fileHash(before) : null, fileHash: fileHash(data) };
    });
    if (name === 'apply_patch') return serializeFiles(() => this.patch(args.patch, ctx));
    const entries: Array<{ path: string; relativePath: string; type: string }> = [], diagnostics: Array<{ path: string; reason: string }> = [];
    const isList = name === 'list_files';
    const rootStat = await fs.stat(path);
    const root = rootStat.isDirectory() ? path : dirname(path);
    const walk = async (dir: string, depth: number, rules: Array<{ root: string; matcher: ReturnType<typeof ignore> }>) => {
      ctx.signal.throwIfAborted();
      if (!isList && args.respectGitignore !== false) {
        try { rules = [...rules, { root: dir, matcher: ignore().add(await fs.readFile(join(dir, '.gitignore'), 'utf8')) }]; }
        catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push({ path: dir, reason: String(e) }); }
      }
      let children;
      try { children = await fs.readdir(dir, { withFileTypes: true }); }
      catch (e) { if (dir === root) throw e; diagnostics.push({ path: dir, reason: String(e) }); return; }
      for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if ((!args.includeHidden && entry.name.startsWith('.')) || (!isList && entry.name === '.git')) continue;
        const full = join(dir, entry.name), rel = relative(root, full).replace(/\\/g, '/');
        if (!isList && rules.some(rule => rule.matcher.ignores(relative(rule.root, full).replace(/\\/g, '/') + (entry.isDirectory() ? '/' : '')))) continue;
        const type = entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other';
        if (isList || type === 'file') entries.push({ path: full, relativePath: rel, type });
        if (entry.isDirectory() && (!isList || depth < (args.depth ?? 1))) await walk(full, depth + 1, rules);
      }
    };
    if (rootStat.isDirectory()) await walk(root, 1, []);
    else if (isList) fileError('NOT_DIRECTORY', path);
    else entries.push({ path, relativePath: relative(root, path), type: 'file' });
    const offset = args.offset ?? 0, limit = args.limit ?? 100;
    const paginate = <T>(items: T[]) => ({ items: items.slice(offset, offset + limit), nextOffset: offset + limit < items.length ? offset + limit : null });
    if (isList) { const page = paginate(entries); return { path, entries: page.items, nextOffset: page.nextOffset, diagnostics }; }
    const include = picomatch(name === 'search_files' ? args.pattern : args.include ?? ['**/*'], { dot: true });
    const exclude = picomatch(args.exclude ?? [], { dot: true });
    const files = entries.filter(e => include(e.relativePath) && !exclude(e.relativePath)).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    if (name === 'search_files') { const page = paginate(files); return { root, files: page.items, nextOffset: page.nextOffset, diagnostics }; }
    if (name !== 'search_text') fileError('UNKNOWN_TOOL', name);
    if (args.regex && (/\(\?[=!<]|\\[1-9]|\\k</.test(args.query))) fileError('INVALID_REGEX', 'Lookaround and backreferences are unsupported');
    let pattern: RegExp;
    try { pattern = new RegExp(args.regex ? args.query : String(args.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.caseSensitive === false ? 'i' : ''); }
    catch { return fileError('INVALID_REGEX', 'Invalid regular expression'); }
    const matches = [];
    for (const entry of files) {
      ctx.signal.throwIfAborted();
      try {
        const lines = decode(await bytes(entry.path)).replace(/^\ufeff/, '').split(/\r?\n/);
        let matchingLines: Set<number> | undefined;
        try {
          const result = await execFileAsync('rg', ['--no-config', '--json', '--text', '--encoding', 'utf-8', ...(args.regex ? [] : ['--fixed-strings']), ...(args.caseSensitive === false ? ['--ignore-case'] : ['--case-sensitive']), '--', String(args.query), entry.path], { windowsHide: true, signal: ctx.signal, timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
          matchingLines = new Set(result.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(record => record.type === 'match').map(record => record.data.line_number - 1));
        } catch (error) {
          ctx.signal.throwIfAborted();
          const code = (error as { code?: string | number }).code;
          if (code === 1) matchingLines = new Set();
          else if (code !== 'ENOENT') throw error;
        }
        for (let i = 0; i < lines.length; i++) if (matchingLines ? matchingLines.has(i) : pattern.test(lines[i]!)) {
          const text = [...lines[i]!], context = args.contextLines ?? 0;
          const excerpt = (from: number, to: number) => lines.slice(from, to).map((text, index) => ({ line: from + index + 1, text: [...text].slice(0, 2000).join('') }));
          matches.push({ path: entry.path, line: i + 1, text: text.slice(0, 2000).join(''), textTruncated: text.length > 2000, before: excerpt(Math.max(0, i - context), i), after: excerpt(i + 1, i + 1 + context) });
        }
      } catch (e) { ctx.signal.throwIfAborted(); diagnostics.push({ path: entry.path, reason: String(e) }); }
    }
    const page = paginate(matches); return { matches: page.items, nextOffset: page.nextOffset, diagnostics };
  }
  private async patch(source: string, ctx: ToolContext) {
    if (Buffer.byteLength(source) > 1024 * 1024) fileError('PATCH_TOO_LARGE', 'Patch exceeds 1 MiB');
    const operations = parsePatch(source), changes: Change[] = [], reports = [], used = new Set<string>();
    let total = 0;
    for (const op of operations) {
      const path = await actualPath(resolve(this.cwd, op.path));
      const target = op.move ? await actualPath(resolve(this.cwd, op.move)) : path;
      for (const p of new Set([path, target])) { const key = pathKey(p); if (used.has(key)) fileError('CONFLICTING_PATH', p); used.add(key); }
      const present = await exists(path);
      if (op.kind === 'add' && present) fileError('ALREADY_EXISTS', path);
      if (op.kind !== 'add' && !present) fileError('NOT_FOUND', path);
      if (target !== path && await exists(target)) fileError('ALREADY_EXISTS', target);
      const before = present ? await bytes(path) : null;
      const mode = present ? (await fs.stat(path)).mode : undefined;
      if (before) {
        const snapshot = this.snapshots.get(this.key(path, ctx));
        if (!snapshot || snapshot.hash !== fileHash(before) || snapshot.lines.size !== snapshot.total) fileError('FILE_CHANGED', `Read all current lines before patching ${path}`);
      }
      const after = op.kind === 'delete' ? null : Buffer.from(op.kind === 'add' ? op.body.map(line => line.slice(1)).join('\n') + (op.body.length ? '\n' : '') : updateText(decode(before!), op.body));
      if (after) decode(after);
      if ((after?.length ?? 0) > MAX) fileError('FILE_TOO_LARGE', target);
      total += (before?.length ?? 0) + (after?.length ?? 0);
      if (total > 64 * 1024 * 1024) fileError('PATCH_TOO_LARGE', 'Total patch data exceeds 64 MiB');
      changes.push({ path, before: before?.toString('base64') ?? null, after: target === path ? after?.toString('base64') ?? null : null, mode });
      if (target !== path) changes.push({ path: target, before: null, after: after!.toString('base64'), mode });
      reports.push({ operation: op.kind === 'add' ? 'added' : op.kind === 'delete' ? 'deleted' : op.move ? 'moved' : 'updated', path: target, ...(op.move ? { previousPath: path } : {}), previousHash: before ? fileHash(before) : null, fileHash: after ? fileHash(after) : null, additions: op.body.filter(l => l.startsWith('+')).length, deletions: op.kind === 'delete' ? decode(before!).split('\n').length : op.body.filter(l => l.startsWith('-')).length });
    }
    ctx.signal.throwIfAborted();
    const journal: Journal = { id: randomUUID(), status: 'pending', changes };
    await fs.mkdir(this.journalDir, { recursive: true });
    const journalPath = join(this.journalDir, `${journal.id}.json`);
    await saveJournal(journalPath, journal);
    try {
      for (const change of changes) {
        ctx.signal.throwIfAborted();
        const current = await exists(change.path) ? (await bytes(change.path)).toString('base64') : null;
        if (current !== change.before) fileError('FILE_CHANGED', change.path);
        if (change.after === null) await fs.unlink(change.path);
        else { await fs.mkdir(dirname(change.path), { recursive: true }); await replace(change.path, Buffer.from(change.after, 'base64'), change.before === null, change.mode); }
      }
      journal.status = 'committed'; await saveJournal(journalPath, journal);
    } catch (e) {
      const conflicts = await rollback(journal);
      journal.status = conflicts.length ? 'conflict' : 'rolled-back'; await saveJournal(journalPath, journal);
      if (conflicts.length) fileError('RECOVERY_CONFLICT', `Backups: ${journalPath}; conflicts: ${conflicts.join(', ')}`);
      throw e;
    }
    return { files: reports, transactionId: journal.id };
  }
}
async function saveJournal(path: string, journal: Journal) {
  const temp = `${path}.tmp`; await fs.writeFile(temp, JSON.stringify(journal)); await fs.rename(temp, path);
}
async function rollback(journal: Journal) {
  const conflicts: string[] = [];
  for (const change of [...journal.changes].reverse()) {
    try {
      const current = await exists(change.path) ? (await bytes(change.path)).toString('base64') : null;
      if (current === change.before) continue;
      if (current !== change.after) { conflicts.push(change.path); continue; }
      if (change.before === null) await fs.unlink(change.path);
      else await replace(change.path, Buffer.from(change.before, 'base64'), current === null, change.mode);
    } catch { conflicts.push(change.path); }
  }
  return conflicts;
}
export async function recoverPatches(directory: string) {
  return serializeFiles(async () => {
    const diagnostics: string[] = [];
    let entries: string[];
    try { entries = await fs.readdir(directory); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return diagnostics; throw e; }
    for (const entry of entries.filter(e => e.endsWith('.json'))) {
      const path = join(directory, entry), journal = JSON.parse(await fs.readFile(path, 'utf8')) as Journal;
      if (journal.status !== 'pending') continue;
      const conflicts = await rollback(journal); journal.status = conflicts.length ? 'conflict' : 'rolled-back'; await saveJournal(path, journal);
      diagnostics.push(`${journal.id}: ${journal.status}${conflicts.length ? ': ' + conflicts.join(', ') : ''}`);
    }
    return diagnostics;
  });
}
interface PatchOp { kind: 'add' | 'update' | 'delete'; path: string; move?: string; body: string[] }
function parsePatch(source: string): PatchOp[] {
  const lines = source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') fileError('INVALID_PATCH', 'Missing patch delimiters');
  const operations: PatchOp[] = []; let current: PatchOp | undefined;
  for (const line of lines) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) { current = { kind: header[1]!.toLowerCase() as PatchOp['kind'], path: header[2]!, body: [] }; operations.push(current); }
    else if (line.startsWith('*** Move to: ') && current?.kind === 'update' && !current.move && !current.body.length) current.move = line.slice(13);
    else if (current && current.kind !== 'delete') current.body.push(line);
    else fileError('INVALID_PATCH', `Unexpected line: ${line}`);
  }
  if (!operations.length || operations.length > 100) fileError('INVALID_PATCH', 'Expected 1–100 file operations');
  for (const op of operations) if (op.kind === 'add' && op.body.some(l => !l.startsWith('+'))) fileError('INVALID_PATCH', 'Add lines require +');
  for (const op of operations) if (op.kind === 'update' && !op.move && !op.body.length) fileError('INVALID_PATCH', 'Update requires at least one hunk');
  return operations;
}
function updateText(raw: string, body: string[]) {
  const bom = raw.startsWith('\ufeff') ? '\ufeff' : '', text = raw.slice(bom.length);
  if (text.includes('\r\n') && /(?<!\r)\n/.test(text)) fileError('MIXED_LINE_ENDINGS', 'Use write_file for mixed line endings');
  const eol = text.includes('\r\n') ? '\r\n' : '\n', trailing = text.endsWith('\n');
  let lines = text ? text.split(/\r?\n/) : []; if (trailing) lines.pop();
  let cursor = 0, index = 0;
  while (index < body.length) {
    const header = body[index++]!;
    if (header !== '@@' && !header.startsWith('@@ ')) fileError('INVALID_PATCH', 'Expected @@');
    if (header.startsWith('@@ ')) {
      const anchor = header.slice(3), positions = lines.flatMap((line, i) => i >= cursor && line === anchor ? [i] : []);
      if (positions.length !== 1) fileError('AMBIGUOUS_CONTEXT', `Non-unique anchor: ${anchor}`);
      cursor = positions[0]! + 1;
    }
    const old: string[] = [], replacement: string[] = []; let eof = false;
    while (index < body.length && !body[index]!.startsWith('@@')) {
      const line = body[index++]!;
      if (line === '*** End of File') { eof = true; if (index < body.length && !body[index]!.startsWith('@@')) fileError('INVALID_PATCH', 'EOF marker must end hunk'); break; }
      if (![' ', '+', '-'].includes(line[0] ?? '')) fileError('INVALID_PATCH', `Invalid hunk line: ${line}`);
      if (line[0] !== '+') old.push(line.slice(1));
      if (line[0] !== '-') replacement.push(line.slice(1));
    }
    const positions: number[] = [];
    for (let i = cursor; i <= lines.length - old.length; i++) if ((!eof || i + old.length === lines.length) && old.every((line, n) => lines[i + n] === line)) positions.push(i);
    if (!positions.length) fileError('CONTEXT_NOT_FOUND', 'Hunk does not match');
    if (positions.length !== 1) fileError('AMBIGUOUS_CONTEXT', 'Add more context to the hunk');
    const at = positions[0]!; lines.splice(at, old.length, ...replacement); cursor = at + replacement.length;
  }
  return bom + lines.join(eol) + (trailing && lines.length ? eol : '');
}
