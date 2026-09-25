# Agent Runtime

`packages/agent` is a Node library independent of Electron and `@canvas-cut/core`.
The desktop host supplies model credentials, project cwd, skill directories and the
`canvas-cut` launcher. Execution is trusted local execution, not a filesystem sandbox.

## Components

- `runtime.ts`: AI SDK single-step streaming, sequential tool execution, budgets and in-run summary compaction.
- `tools.ts`: ToolRegistry and JSON Schema validation. `edit_file` is no longer registered.
- `files.ts`: UTF-8 files, search and journaled multi-file patches.
- `host.ts` / `pty.ts`: native pipes, PTY, stdin, cancellation and run ownership.
- `skills.ts`: built-in → user → project precedence; `list_skills` and `load_skill` load instructions on demand.
- `mcp.ts`: outbound stdio / Streamable HTTP tools and resources, independent of the existing CLI MCP server.
- `sessions.ts`: session snapshots, append-only event journal and interrupted-run recovery.

## System prompt composition

`buildSystemPrompt` assembles the prompt in explicit layers: Identity, Scope and
authority, Runtime context, Execution protocol, Application instructions, Skills,
and an optional Recovery context. Runtime context includes mode, platform, shell,
cwd, session/run IDs, maximum steps and the configured context-character limit.
The desktop supplies Canvas Cut-specific guidance through `applicationPrompt`;
generic runtime code does not embed application workflow details.

Skill metadata is listed in the prompt, while instructions are loaded through
`list_skills` and `load_skill`. A run following an interrupted run receives a
recovery warning containing the previous run ID and error.

## Standalone use

### Desktop conversations

The Chat tab (or composer History button) exposes project-scoped conversations:
create, switch, rename, archive/restore and delete. Each conversation has its own
message history, event cursor, running task, context usage and in-memory input draft.
Switching does not cancel a background task; Stop applies only to the selected conversation.
The selected conversation is remembered locally, and metadata/history survive restart.
Archived conversations are readable but must be restored before sending. Management
operations are blocked while that conversation is starting or running.

Desktop IPC: `agent.conversations.list({path})`, `agent.conversations.create({path})`,
`agent.conversations.manage({path, conversationId, action, title?})`, where action is
`rename`, `archive`, `restore` or `delete`. Existing chat/history/run/cancel APIs
continue to accept `conversationId` and default to `default` for legacy callers.
Deletion is soft: the list hides the entry but snapshots, events and run logs remain
on disk. There is no trash UI yet; a known deleted conversation ID can be recovered
using `service.manage(projectPath, conversationId, 'restore')`. Legacy default
conversations are retained without moving or clearing their messages.

```ts
import { AgentSessionService, LocalAgentHost } from '@canvas-cut/agent';

const service = new AgentSessionService({
  storageDir: '/absolute/runtime/sessions',
  configure: async () => ({
    apiKey: process.env.AGENT_API_KEY!,
    baseUrl: 'https://your-provider.example/v1',
    model: 'your-model',
    maxSteps: 64,
    contextLimitCharacters: 200000,
    compactThresholdCharacters: 120000
  }),
  createHost: (cwd, logDir) => new LocalAgentHost({
    cwd, logDir, journalDir: '/absolute/runtime/patches'
  }),
  skillDirectories: cwd => ['/absolute/builtin-skills', `${cwd}/skills`]
});
const { runId } = await service.start('/absolute/workspace', 'Complete my task');
// Poll getRun(workspace, conversationId, cursor); runId identifies this execution.
// cancel() aborts the model and owned shell processes, not remote application jobs.
// shutdown() must be awaited before the host exits.
```

Streaming is enabled by default. `streaming: false` remains available for compatible
non-streaming providers and deterministic tests. A tool's complete call is saved
before execution. Tool results are saved before the next model request. There is no
automatic retry of uncertain side effects. `maxSteps` defaults to 64. Character
budgets include system/tool definitions; displayed token estimates are calibrated
from reported model usage, not an assertion of the provider's context window.

Each conversation has one active run. Tool operations in a step execute serially.
Standalone callers may pass `additionalTools: ToolDefinition[]` to runAgentMessage;
each definition provides name, description, inputSchema and execute(input, context).
Duplicate names fail registration rather than overriding existing tools.
MCP discovery refreshes at step boundaries and that step uses a frozen tool map.
Step/tool/text/usage/compaction/diagnostic events have monotonically increasing
cursors. Text deltas and final text share a message ID.

## File tools

Paths are absolute or relative to cwd; no `~`, environment or shell expansion.
UTF-8 is validated strictly. File hashes cover original bytes including BOM and
line endings. Line numbering starts at 1, offsets at 0. Unknown input fields fail.
Reading a symlink resolves its file target; traversal does not follow symlink dirs.
Modification of a symlink path targets the resolved file (including deletion).

| Tool | Required inputs | Optional inputs (default) |
| --- | --- | --- |
| `list_files` | `path: string` | `depth: 1..5 (1)`, `offset: 0..100000 (0)`, `limit: 1..500 (100)`, `includeHidden: boolean (false)` |
| `search_files` | `pattern: glob` | `path: string (.)`, `exclude: string[] ([])`, `includeHidden: false`, `respectGitignore: true`, `offset: 0`, `limit: 100` |
| `search_text` | `query: nonempty string` | `path: string (.)`, `regex: false`, `caseSensitive: true`, `include: string[] ([**/*])`, `exclude: []`, `includeHidden: false`, `respectGitignore: true`, `contextLines: 0..5 (0)`, `offset: 0`, `limit: 100` |
| `read_file` | `path: string` | `startLine: 1..10000000 (1)`, `lineCount: 1..2000 (200)` |
| `write_file` | `path: string`, `content: string` | `mode: create/overwrite (create)`, `createDirectories: false`, `expectedHash: SHA-256 (required for overwrite, forbidden for create)` |
| `apply_patch` | `patch: string` | None |

Directory entries return path, relativePath, type and nextOffset. Search returns
ordered files/matching lines and nextOffset; text hits include before/after context
and a textTruncated flag. Dot-prefixed names are considered hidden. `.git` is excluded
from search. Nested .gitignore rules apply by default. Text search uses rg when
available, with a Node fallback when absent. It supports single-line patterns,
excluding lookaround/backreferences. Regex engines can differ on advanced Unicode
constructs; prefer literal search for portable exact behavior.

read_file returns content with original newlines, totalLines, nextLine, fileHash,
sizeBytes, lineEnding and hasBom. UTF-8 text files are limited to 16 MiB. write_file
accepts up to 1 MiB, creates exclusively by default and preserves BOM on overwrite.
Tool results beyond 32 KiB are archived with a preview and readable logPath.

### apply_patch

```text
*** Begin Patch
*** Add File: src/new.ts
+export const value = 1;
*** Update File: src/old.ts
*** Move to: src/renamed.ts
@@
-export const name = "old";
+export const name = "new";
*** Delete File: src/unused.ts
*** End Patch
```

`@@` starts a hunk. Space-prefixed lines are context, `-` removes and `+` adds.
`@@ exact anchor line` locates a unique preceding line. `*** End of File` anchors
a hunk to EOF. Context must match exactly and uniquely; there is no fuzzy matching.
Mixed-newline updates are rejected; use explicit whole-file overwrite instead.
Existing BOM/newline style and trailing newline state are preserved; new files use LF.

Read all pages of an existing file in the current run before updating, moving or
deleting it. The host remembers hashes and page coverage. Changed snapshots fail
with FILE_CHANGED. Add targets and move destinations must not exist. Parents are
created when needed. Conflicting operations on the same actual path are rejected.
Limits: 1 MiB patch, 100 operations, 16 MiB per file and 64 MiB combined before/after.

All operations are validated before writes. The journal stores before/after bytes
before commit. Each replacement is atomic; the multi-file transaction is not
OS-atomic. On failure it rolls back only files still matching its own results.
External conflicts are preserved and reported with backup locations. Call
recoverPatches(journalDir) on startup (the desktop does this) to recover pending
transactions. Keep journals if recovery is needed; automatic retention pruning is
not implemented. Directories created for a failed patch can remain empty.

## Terminal tools

| Tool | Inputs |
| --- | --- |
| `exec_command` | required `command`; optional `cwd`, `shell: bash/powershell`, `tty: false`, `yieldTimeMs: 0..10000 (1000)`, `timeoutMs: 100..1800000 (1800000)`, `cols: 10..500 (100)`, `rows: 2..300 (30)` |
| `write_stdin` | required `processId`; optional `chars: ''`, `action: write/eof/interrupt`, `waitMs: 0..10000 (1000)`, `stdoutOffset: 0`, `stderrOffset: 0` |
| `read_process_output` | required `processId`; optional `waitMs`, `stdoutOffset`, `stderrOffset` as above |
| `terminate_process` | required `processId` |
| `resize_terminal` | required `processId`, `cols`, `rows` with the ranges above |

Output includes processId, status, exitCode and incremental stdout/stderr byte
cursors. PTY output is merged in stdout and retains terminal escape sequences.
Empty write_stdin polls without writing. Pipe EOF closes stdin. PTY EOF is terminal
specific: send the appropriate control character in chars. `interrupt` sends Ctrl-C
to a PTY; Windows pipe processes require termination instead. Input is limited to
1 MiB, logs to 64 MiB per process. Each process belongs to its session and run.

Windows defaults to PowerShell; bashPath selects Git Bash (common installation
paths are also detected). WSL path mapping is not implemented. PTY availability
depends on node-pty native binaries. Version 1.1.0 is pinned because the Windows
adapter contains a narrowly scoped console-cleanup workaround, covered by Node
and Electron native smoke tests. Re-test this adapter when upgrading node-pty.

## Desktop configuration and MCP

Open Settings → Agent Runtime / MCP / Skills. Save configuration separately using
the runtime save button. Changes apply on the next run; MCP connection testing is
explicit and can launch configured local servers.

```json
{
  "maxSteps": 64,
  "contextLimitCharacters": 200000,
  "compactThresholdCharacters": 120000,
  "supportsImages": false,
  "mcpServers": [
    { "name": "local", "transport": "stdio", "command": "node", "args": ["/absolute/server.js"] },
    { "name": "remote", "transport": "http", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer replace-me" } }
  ]
}
```

Optional server fields: enabled, cwd, env, headers, timeoutMs (1000..120000).
Transport initialization defaults to 15s, calls to 30s. Only configured transports
are used; no OAuth, legacy SSE, sampling, prompts or elicitation in this version.
Server failures produce diagnostics. Disconnected clients reconnect only at the
next step, never by replaying an uncertain tool call.

MCP tools are namespaced and validated, including nested input schemas. The
generic resource tools are mcp_list_resources(server, cursor?),
mcp_list_resource_templates(server, cursor?), mcp_read_resource(server, uri).
Binary outputs become local attachments. With supportsImages enabled, up to four
images of at most 4 MiB each are also passed to the model. Do not enable it for a
text-only model. Other attachments remain referenced files.

The entire desktop runtime configuration is encrypted with safeStorage. Reading
configuration redacts env/headers and reports hasCredentials. Omitted credentials
retain stored values; explicit empty objects clear them. Names identify servers,
so renaming a server requires re-entering credentials. Runtime configuration
secrets are not injected into model messages or ordinary shell environments.

## Validation

`npm test` covers file/patch contracts, streaming with a real SDK and mock model,
session recovery, real pipes, real Windows PTY, outbound stdio and HTTP MCP, and the
existing CLI/daemon rendering loop. `npm run build:desktop` builds TypeScript and UI.
Native smoke tests launch both Node and Electron with fixed-output commands.
Restricted environments may need permission for Electron path resolution.

Real paid model quality, Linux/macOS native execution and installer distribution
require validation on those environments; automated model tests do not establish
real-provider planning quality.
