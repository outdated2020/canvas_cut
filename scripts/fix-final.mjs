import { readFileSync, writeFileSync } from "node:fs";

// Fix all literal `r`n in both files
const files = [
  "apps/desktop/src/main/daemon.ts",
  "apps/desktop/src/main/job-worker.ts"
];

for (const file of files) {
  let c = readFileSync(file, "utf8");
  // Replace literal backtick-r-backtick-n with actual newline
  c = c.replace(/`r`n/g, "\n");
  writeFileSync(file, c);
  console.log(file + " fixed");
}