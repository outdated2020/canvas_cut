import { readFileSync, writeFileSync } from "node:fs";

const path = "apps/desktop/src/renderer/App.tsx";
let c = readFileSync(path, "utf8");

// 1. Replace log state with logEntries + addLog
c = c.replace(
  "const [log, setLog] = useState('');",
  `const [logEntries, setLogEntries] = useState<Array<{time: string, text: string}>>([]);
  const [logOpen, setLogOpen] = useState(false);

  function addLog(text: string) {
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ':' + now.getSeconds().toString().padStart(2,'0');
    setLogEntries(prev => [...prev.slice(-199), { time, text }]);
    console.log('[' + time + ']', text);
  }`
);

// 2. Replace all setLog( calls with addLog(
c = c.replace(/setLog\(/g, "addLog(");

// 3. Replace bottom <pre> with log panel
c = c.replace(
  "<pre>{log || 'Ready'}</pre>",
  `<div className="log-panel">
      <div className="log-toggle" onClick={() => setLogOpen(!logOpen)}>
        <Icon name="list" size={13} />
        <span>Log ({logEntries.length})</span>
        <span className="log-arrow">{logOpen ? '▾' : '▸'}</span>
      </div>
      {logOpen && (
        <div className="log-body">
          {logEntries.length === 0 ? (
            <div className="log-empty">No entries yet</div>
          ) : (
            logEntries.map((entry, i) => (
              <div key={i} className="log-line">
                <span className="log-time">{entry.time}</span>
                <span className="log-text">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>`
);

writeFileSync(path, c);
console.log("log panel patched");