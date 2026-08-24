import { readFileSync, writeFileSync } from "node:fs";

let w = readFileSync("apps/desktop/src/main/job-worker.ts", "utf8");

// Add logger import
w = w.replace(
  "import type { JobStore } from './job-store';",
  "import type { JobStore } from './job-store';`r`nimport { logger } from '@canvas-cut/core';"
);

// Log in process
w = w.replace(
  "private async process(job: JobRecord): Promise<void> {",
  `private async process(job: JobRecord): Promise<void> {
    logger.info('JobWorker processing: id=' + job.id + ' type=' + job.type);`
);

w = w.replace(
  "const now = Date.now();`r`n    this.jobStore.update(job.id, { status: 'running', updated_at: now });",
  "const now = Date.now();`r`n    this.jobStore.update(job.id, { status: 'running', updated_at: now });`r`n    logger.info('JobWorker updated ' + job.id + ' to running');"
);

w = w.replace(
  "this.completeJob(job.id, providerJob.result);",
  `logger.info('JobWorker ' + job.id + ' generation succeeded (sync)');` + "`r`n      this.completeJob(job.id, providerJob.result);"
);

w = w.replace(
  "this.completeJob(job.id, result);",
  "this.completeJob(job.id, result);"
);

// Log completion
w = w.replace(
  "private completeJob(id: string, result?: AssetRef): void {",
  `private completeJob(id: string, result?: AssetRef): void {
    logger.info('JobWorker completeJob: id=' + id + ' result=' + (result ? result.type + ':' + (result.sizeBytes / 1024).toFixed(1) + 'KB' : 'none'));`
);

writeFileSync("apps/desktop/src/main/job-worker.ts", w);
console.log("worker logs patched");