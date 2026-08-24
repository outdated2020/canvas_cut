import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/desktop/src/renderer/App.tsx";
let c = readFileSync(path, "utf8");

// 1. add config state
c = c.replace(
  /const \[project, setProject\] = useState<AnyRecord \| null>\(null\);/,
  "const [project, setProject] = useState<AnyRecord | null>(null);\n  const [config, setConfig] = useState<AnyRecord | null>(null);"
);

// 2. load config in openProject
c = c.replace(
  /(setTimeline\(result\.timeline\);\s*\n\s*setLog\('Project opened'\);)/,
  "setTimeline(result.timeline);\n      const cfg = await invoke('config.get', { path: projectPath }) as AnyRecord;\n      setConfig(cfg);\n      setLog('Project opened');"
);

// 3. pass config to CanvasGraphView
c = c.replace(
  /onUpdateNodeParams=\{updateNodeParams\}/,
  "onUpdateNodeParams={updateNodeParams}\n                    config={config}"
);

writeFileSync(path, c);
console.log("App.tsx patched");