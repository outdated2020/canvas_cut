import { promises as fs } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { AgentSessionService, LocalAgentHost, atomicText } from '@canvas-cut/agent';

export async function createAgentService(options: {
  userDataDir: string; appRoot: string; executable: string;
  settings(): Promise<Record<string, unknown>>;
}) {
  const cliPath = join(options.appRoot, '..', 'cli', 'dist', 'index.js');
  await fs.access(cliPath);
  const binDir = join(options.userDataDir, 'agent', 'bin');
  const quoteSh = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const escapeCmd = (value: string) => value.replace(/%/g, '%%');
  if (process.platform === 'win32') {
    await atomicText(join(binDir, 'canvas-cut.cmd'), `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${escapeCmd(options.executable)}" "${escapeCmd(cliPath)}" %*\r\nexit /b %errorlevel%\r\n`);
  } else {
    const launcher = join(binDir, 'canvas-cut');
    await atomicText(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quoteSh(options.executable)} ${quoteSh(cliPath)} "$@"\n`);
    await fs.chmod(launcher, 0o755);
  }
  return new AgentSessionService({
    storageDir: join(options.userDataDir, 'agent', 'sessions'),
    configure: async (projectPath) => {
      await fs.access(join(projectPath, 'project.json'));
      const settings = await options.settings();
      return { apiKey: String(settings.agentApiKey ?? ''), baseUrl: String(settings.agentBaseUrl ?? ''), model: String(settings.agentModel ?? '') };
    },
    createHost: (cwd, logDir) => new LocalAgentHost({ cwd, logDir, env: { PATH: binDir + delimiter + (process.env.PATH ?? process.env.Path ?? '') } }),
    skillDirectories: (projectPath) => [join(options.appRoot, '..', '..', 'skills'), join(homedir(), '.canvas-cut', 'skills'), join(projectPath, 'skills')]
  });
}
