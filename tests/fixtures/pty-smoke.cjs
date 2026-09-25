const { createTerminal } = require('../../packages/agent/dist/pty.js');
const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-Command', 'Write-Output NATIVE_PTY_OK'] : ['-c', 'printf NATIVE_PTY_OK'];
const terminal = createTerminal(shell, args, { cwd: process.cwd(), env: process.env, cols: 80, rows: 24 });
let output = '';
const timer = setTimeout(() => { terminal.kill(); process.exitCode = 1; }, 10000);
terminal.onData(data => { output += data; if (data.includes('\x1b[6n')) terminal.write('\x1b[1;1R'); });
terminal.onExit(event => { clearTimeout(timer); if (event.exitCode || !output.includes('NATIVE_PTY_OK')) { console.error(output); process.exitCode = 1; } else console.log('NATIVE_PTY_OK'); });
