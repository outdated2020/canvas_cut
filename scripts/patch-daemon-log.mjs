import { readFileSync, writeFileSync } from "node:fs";

// daemon.ts
let d = readFileSync("apps/desktop/src/main/daemon.ts", "utf8");
d = d.replace(
  "import {",
  "import { logger,"
);
d = d.replace(
  "import { randomUUID }",
  "import { logger } from '@canvas-cut/core';`r`nimport { randomUUID"
);
// Fix: we need to add the import properly
d = readFileSync("apps/desktop/src/main/daemon.ts", "utf8");
// Add import after the first import line
d = d.replace(
  "import { randomUUID } from 'node:crypto';",
  "import { randomUUID } from 'node:crypto';`r`nimport { logger } from '@canvas-cut/core';"
);
d = d.replace(
  "async submitJob(",
  `async submitJob(`
);
d = d.replace(
  "const type = String(payload.type ?? '');",
  `const type = String(payload.type ?? '');
    logger.info('Daemon submitJob: type=' + type + (payload.canvasId ? ' canvasId=' + payload.canvasId : ''));`
);
d = d.replace(
  "const parentId = randomUUID();",
  `const parentId = randomUUID();
      logger.info('Daemon canvas.render: parentId=' + parentId + ' childJobs=' + plan.childJobs.length);`
);
writeFileSync("apps/desktop/src/main/daemon.ts", d);
console.log("daemon logs patched");