import { readFileSync, writeFileSync } from "node:fs";

// Fix daemon.ts
let d = readFileSync("apps/desktop/src/main/daemon.ts", "utf8");
d = d.replace(
  /import \{ randomUUID \} from 'node:crypto';[\s\S]*?import \{ logger \} from '@canvas-cut\/core';/,
  "import { randomUUID } from 'node:crypto';\nimport { logger } from '@canvas-cut/core';"
);
writeFileSync("apps/desktop/src/main/daemon.ts", d);

// Fix job-worker.ts
let w = readFileSync("apps/desktop/src/main/job-worker.ts", "utf8");
w = w.replace(
  /import type \{ JobStore \} from '.\/job-store';[\s\S]*?import \{ logger \} from '@canvas-cut\/core';/,
  "import type { JobStore } from './job-store';\nimport { logger } from '@canvas-cut/core';"
);
writeFileSync("apps/desktop/src/main/job-worker.ts", w);

// Verify
d = readFileSync("apps/desktop/src/main/daemon.ts", "utf8");
console.log("daemon line1:", JSON.stringify(d.split("\n")[0]));
w = readFileSync("apps/desktop/src/main/job-worker.ts", "utf8");
console.log("worker line30:", JSON.stringify(w.split("\n")[29]));
console.log("done");