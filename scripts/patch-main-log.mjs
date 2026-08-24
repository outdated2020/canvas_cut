import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/desktop/src/main/main.ts";
let c = readFileSync(path, "utf8");

// Add logger import
c = c.replace(
  "import {",
  `import { logger,`
);

// Add startup logs
c = c.replace(
  "void app.whenReady().then(async () => {",
  `void app.whenReady().then(async () => {
    logger.info('App starting...');
    logger.info('userData: ' + app.getPath('userData'));`
);

c = c.replace(
  "const localSettings = await readLocalRuntimeSettings();",
  `logger.info('Loading runtime settings...');
    const localSettings = await readLocalRuntimeSettings();`
);

c = c.replace(
  "if (typeof localSettings.arkApiKey === 'string' && localSettings.arkApiKey) {",
  `if (typeof localSettings.arkApiKey === 'string' && localSettings.arkApiKey) {
      logger.info('ARK_API_KEY found in settings');`
);

c = c.replace(
  "daemon = new DaemonService();",
  `logger.info('Starting DaemonService...');
    daemon = new DaemonService();`
);

c = c.replace(
  "ipcServer = new LocalIpcServer(",
  `logger.info('Starting IPC server...');
    ipcServer = new LocalIpcServer(`
);

c = c.replace(
  "await ipcServer.start();",
  `await ipcServer.start();
    logger.info('IPC server started on ' + ipcServer.endpoint);`
);

c = c.replace(
  "registerIpcHandlers();",
  `logger.info('Registering IPC handlers...');
    registerIpcHandlers();`
);

c = c.replace(
  "mainWindow = createWindow();",
  `logger.info('Creating main window...');
    mainWindow = createWindow();`
);

c = c.replace(
  "app.on('before-quit', () => {",
  `app.on('before-quit', () => {
    logger.info('App quitting...');`
);

writeFileSync(path, c);
console.log("main.ts logs patched");