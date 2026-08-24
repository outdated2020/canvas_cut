import { readFileSync, writeFileSync } from "node:fs";
const path = "packages/core/src/provider/volcengine.ts";
let c = readFileSync(path, "utf8");
const start = c.indexOf("function mapSize");
const end = c.indexOf("function mapRatio", start);
const newFn = 'function mapSize(width: number, height: number): string {\n  return `${width}x${height}`;\n}\n\n';
c = c.slice(0, start) + newFn + c.slice(end);
writeFileSync(path, c);
console.log("mapSize fixed");