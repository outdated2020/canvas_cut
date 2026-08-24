import { readFileSync, writeFileSync } from "node:fs";

// Fix daemon.ts
let d = readFileSync("apps/desktop/src/main/daemon.ts", "utf8");
// Remove the broken first line and fix
const daemonBad = "import { randomUUID } from 'node:crypto';\r\nimport { logger } from '@canvas-cut/core';";
const daemonGood = "import { randomUUID } from 'node:crypto';\nimport { logger } from '@canvas-cut/core';";
d = d.replace(daemonBad, daemonGood);
writeFileSync("apps/desktop/src/main/daemon.ts", d);
console.log("daemon.ts fixed");

// Fix job-worker.ts
let w = readFileSync("apps/desktop/src/main/job-worker.ts", "utf8");
// Remove duplicate logger import (the one with \r\n issue)
const workerBad = "import type { JobStore } from './job-store';\r\nimport { logger } from '@canvas-cut/core';";
const workerGood = "import type { JobStore } from './job-store';\nimport { logger } from '@canvas-cut/core';";
w = w.replace(workerBad, workerGood);
writeFileSync("apps/desktop/src/main/job-worker.ts", w);
console.log("job-worker.ts fixed");