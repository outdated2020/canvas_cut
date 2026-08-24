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

console.log("ARK baseUrl:", config.provider.volcengine.baseUrl);
console.log("model:", config.provider.volcengine.imageModel);
console.log("Calling text-to-image with prompt: 'a red apple on a white table, studio lighting'...\n");

const t0 = Date.now();
const job = await provider.textToImage({
  prompt: "a red apple on a white table, studio lighting",
  width: 1920,
  height: 1920
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log("Done in", elapsed, "s");
console.log("status:", job.status);
if (job.result) {
  console.log("asset path:", job.result.path);
  console.log("asset size:", (job.result.sizeBytes / 1024).toFixed(1), "KB");
  console.log("asset type:", job.result.type);
}