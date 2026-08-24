import { VolcengineProvider, FileAssetDownloader } from "../packages/core/dist/index.js";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const config = JSON.parse(readFileSync(join(root, "demo-project", "config.json"), "utf8"));
const apiKey = process.env.ARK_API_KEY;
if (!apiKey) {
  console.error("ARK_API_KEY is not set");
  process.exit(1);
}

const downloader = new FileAssetDownloader(join(root, "demo-project", "assets"));
const provider = new VolcengineProvider(config.provider.volcengine, apiKey, downloader);

console.log("model:", config.provider.volcengine.videoModel);
console.log("Calling text-to-video: 'a red apple rotating on a white table'...\n");

const t0 = Date.now();
let job = await provider.textToVideo({
  prompt: "a red apple rotating on a white table",
  width: 1920,
  height: 1080,
  durationMs: 5000
});
console.log(`Submitted: jobId=${job.jobId} status=${job.status}`);

let delay = 2000;
const maxWait = 5 * 60 * 1000;
while (job.status === "pending" || job.status === "running") {
  if (Date.now() - t0 > maxWait) {
    console.error("Timed out waiting for video");
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, delay));
  job = await provider.getJob(job.jobId, "text-to-video");
  console.log(`  poll: status=${job.status}`);
  delay = Math.min(10000, Math.round(delay * 1.5));
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log("Done in", elapsed, "s");
console.log("status:", job.status);
if (job.status === "succeeded" && job.result) {
  console.log("asset path:", job.result.path);
  console.log("asset size:", (job.result.sizeBytes / 1024).toFixed(1), "KB");
  console.log("asset type:", job.result.type);
} else if (job.error) {
  console.log("error:", JSON.stringify(job.error));
}