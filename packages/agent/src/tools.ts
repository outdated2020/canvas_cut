import Ajv from 'ajv';
import type { ToolContext } from './host';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}
export class ToolRegistry {
  private definitions = new Map<string, ToolDefinition>();
  private validators = new Map<string, ReturnType<Ajv['compile']>>();
  private ajv = new Ajv({ strict: false, allErrors: true });
  register(definition: ToolDefinition) {
    if (this.definitions.has(definition.name)) throw new Error(`Duplicate tool: ${definition.name}`);
    this.validators.set(definition.name, this.ajv.compile(definition.inputSchema));
    this.definitions.set(definition.name, definition);
    return this;
  }
  list() { return [...this.definitions.values()]; }
  async execute(name: string, input: unknown, context: ToolContext) {
    context.signal.throwIfAborted();
    const definition = this.definitions.get(name), validate = this.validators.get(name);
    if (!definition || !validate) throw new Error(`Unknown tool: ${name}`);
    if (!validate(input)) throw new Error(`Invalid ${name} input: ${this.ajv.errorsText(validate.errors)}`);
    return definition.execute(input as Record<string, unknown>, context);
  }
}
const str = { type: 'string' }, bool = { type: 'boolean' };
const int = (maximum: number, minimum = 0) => ({ type: 'integer', minimum, maximum });
const strings = { type: 'array', items: str };
const page = { offset: int(100000), limit: int(500, 1) };
const search = { path: str, exclude: strings, includeHidden: bool, respectGitignore: bool, ...page };
const spec = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ description, properties, required });
export const BASE_TOOLS = {
  list_files: spec('List directory entries without following symlink directories.', { path: str, depth: int(5, 1), includeHidden: bool, ...page }, ['path']),
  search_files: spec('Find files by relative glob. Uses ignore rules by default.', { ...search, pattern: str }, ['pattern']),
  search_text: spec('Search UTF-8 files by literal text or single-line regex. No lookaround/backreferences.', { ...search, query: { type: 'string', minLength: 1 }, regex: bool, caseSensitive: bool, include: strings, contextLines: int(5) }, ['query']),
  read_file: spec('Read UTF-8 lines and return a content hash. Read all pages before applying a patch.', { path: str, startLine: int(10000000, 1), lineCount: int(2000, 1) }, ['path']),
  write_file: spec('Create a UTF-8 file, or explicitly overwrite with expectedHash from read_file. Default create never overwrites.', { path: str, content: str, mode: { enum: ['create', 'overwrite'] }, createDirectories: bool, expectedHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['path', 'content']),
  apply_patch: spec('Apply *** Begin Patch / *** End Patch with Add File, Update File, Delete File, Move to and @@ context hunks. Read existing files completely first. Exact unique context required.', { patch: str }, ['patch']),
  exec_command: spec('Start a shell command. tty enables a real PTY. Poll or write input with write_stdin. Processes end with this run.', { command: str, cwd: str, shell: { enum: ['bash', 'powershell'] }, tty: bool, yieldTimeMs: int(10000), timeoutMs: int(1800000, 100), cols: int(500, 10), rows: int(300, 2) }, ['command']),
  write_stdin: spec('Write to an owned process, or poll with empty chars. action supports write, eof and interrupt.', { processId: str, chars: str, action: { enum: ['write', 'eof', 'interrupt'] }, waitMs: int(10000), stdoutOffset: int(Number.MAX_SAFE_INTEGER), stderrOffset: int(Number.MAX_SAFE_INTEGER) }, ['processId']),
  read_process_output: spec('Read incremental output by byte offsets.', { processId: str, waitMs: int(10000), stdoutOffset: int(Number.MAX_SAFE_INTEGER), stderrOffset: int(Number.MAX_SAFE_INTEGER) }, ['processId']),
  terminate_process: spec('Terminate an owned process tree. Does not cancel application/remote jobs.', { processId: str }, ['processId']),
  resize_terminal: spec('Resize an owned PTY.', { processId: str, cols: int(500, 10), rows: int(300, 2) }, ['processId', 'cols', 'rows'])
};
