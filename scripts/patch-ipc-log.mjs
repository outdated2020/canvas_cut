import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/desktop/src/main/main.ts";
let c = readFileSync(path, "utf8");

// Add log to canvas.render handler
c = c.replace(
  "case 'canvas.render':",
  `case 'canvas.render':
        logger.info('canvas.render requested: canvasId=' + payload.canvasId + ' force=' + payload.force);`
);

// Add log to job.submit
c = c.replace(
  "case 'job.submit':",
  `case 'job.submit':
        logger.info('job.submit requested: type=' + payload.type);`
);

// Add log to job.status
c = c.replace(
  "case 'job.status':",
  `case 'job.status':
        logger.info('job.status requested: jobId=' + payload.jobId);`
);

// Add log to timeline.export
c = c.replace(
  "case 'timeline.export':",
  `case 'timeline.export':
        logger.info('timeline.export requested');`
);

writeFileSync(path, c);
console.log("IPC logs patched");