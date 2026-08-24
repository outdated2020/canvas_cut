import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/desktop/src/renderer/App.tsx";
let c = readFileSync(path, "utf8");

const start = c.indexOf("async function renderCanvas(force = false)");
const end = c.indexOf("async function refreshCanvas", start);
if (start < 0 || end < 0) {
  console.error("Could not find renderCanvas function");
  process.exit(1);
}

const newFn = `  async function renderCanvas(force = false) {
    if (!canvas) return;
    try {
      const result = (await invoke('canvas.render', {
        path: projectPath,
        canvasId: canvas.id,
        force
      })) as AnyRecord;
      setJobId(result.jobId);
      setLog(\`Render submitted: \${result.jobId}\`);
      await refreshSidebar();

      const poll = async () => {
        try {
          const job = await invoke('job.status', { path: projectPath, jobId: result.jobId }) as AnyRecord;
          if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
            setLog(\`Render \${job.status}: \${result.jobId}\`);
            await refreshCanvas();
            await refreshSidebar();
            return;
          }
          setTimeout(poll, 2000);
        } catch {
          // stop polling on error
        }
      };
      setTimeout(poll, 2000);
    } catch (error) {
      setLog(String(error));
    }
  }`;

c = c.slice(0, start) + newFn + c.slice(end);
writeFileSync(path, c);
console.log("renderCanvas patched");