import { readFileSync, writeFileSync } from "node:fs";
const path = "apps/desktop/src/main/main.ts";
let c = readFileSync(path, "utf8");

// Fix the broken import block
const bad = `  withProjectLock,
} from '@canvas-cut/core';  logger
} from '@canvas-cut/core';`;

const good = `  withProjectLock,
  logger
} from '@canvas-cut/core';`;

c = c.replace(bad, good);
writeFileSync(path, c);
console.log("import fixed");