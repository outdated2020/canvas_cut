import { useEffect, useState } from 'react';
import { CanvasGraphView } from './CanvasGraphView';
import { TimelineView } from './TimelineView';
import { Icon } from './icons';

declare global {
  interface Window {
    api: {
      invoke(channel: string, payload?: Record<string, unknown>): Promise<unknown>;
    };
  }
}

type AnyRecord = Record<string, any>;
type AiView = 'templates' | 'chat' | 'presets';
type CenterTab = 'assets' | 'canvas';
type AssetTab = 'my-assets' | 'library' | 'transcript';

const templateCards: Array<{ title: string; icon: string; gradient: string; pro?: boolean; prompt: string }> = [
  { title: 'Talking Head Editing', icon: 'person', gradient: 'linear-gradient(135deg,#7b5ce0,#b48ce0)', prompt: 'Create a talking head video of me presenting this script, with auto captions.' },
  { title: 'Motion Graphics', icon: 'spark', gradient: 'linear-gradient(135deg,#3d7bd9,#6fc3df)', prompt: 'Create a motion graphics intro animation for my brand.' },
  { title: 'Seedance 2.5', icon: 'film', gradient: 'linear-gradient(135deg,#e8863a,#f5c04e)', pro: true, prompt: 'Generate a cinematic 5s video of a mountain sunrise with Seedance.' },
  { title: 'Product / App Promo', icon: 'phone', gradient: 'linear-gradient(135deg,#2aa876,#7bd9a8)', prompt: 'Make a 15s promo video showcasing my mobile app features.' },
  { title: 'AI Short Film', icon: 'clapper', gradient: 'linear-gradient(135deg,#d9536f,#e88fb0)', prompt: 'Write and produce a 30s AI short film about a robot discovering music.' },
  { title: 'Explainer Video', icon: 'playCircle', gradient: 'linear-gradient(135deg,#3aa8a0,#7bd0d9)', prompt: 'Create an explainer video that shows how my product works.' }
];

function fileUrl(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function formatTimelineTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function App() {
  const [projectPath, setProjectPath] = useState('C:\\Users\\liqijun\\Desktop\\canvas_cut\\demo-project');
  const [projectName, setProjectName] = useState('Demo Project');
  const [project, setProject] = useState<AnyRecord | null>(null);
  const [config, setConfig] = useState<AnyRecord | null>(null);
  const [timeline, setTimeline] = useState<AnyRecord | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [canvases, setCanvases] = useState<AnyRecord[]>([]);
  const [assets, setAssets] = useState<AnyRecord[]>([]);
  const [presets, setPresets] = useState<AnyRecord[]>([]);
  const [jobs, setJobs] = useState<AnyRecord[]>([]);
  const [logEntries, setLogEntries] = useState<Array<{time: string, text: string}>>([]);
  const [logOpen, setLogOpen] = useState(false);

  function addLog(text: string) {
    const now = new Date();
    const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ':' + now.getSeconds().toString().padStart(2,'0');
    setLogEntries(prev => [...prev.slice(-199), { time, text }]);
    console.log('[' + time + ']', text);
  }
  const [newNodeType, setNewNodeType] = useState('text-to-video');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiView, setAiView] = useState<AiView>('templates');
  const [centerTab, setCenterTab] = useState<CenterTab>('assets');
  const [assetTab, setAssetTab] = useState<AssetTab>('my-assets');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetView, setAssetView] = useState<'grid' | 'list'>('grid');
  const [sortActive, setSortActive] = useState(false);
  const [filterActive, setFilterActive] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [timelineDurationMs, setTimelineDurationMs] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<AnyRecord[]>([]);
  const [canvas, setCanvas] = useState<AnyRecord | null>(null);
  const [centerColWidth, setCenterColWidth] = useState(42); // percentage of workspace width
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState({
    arkApiKey: '',
    tosAccessKeyId: '',
    tosAccessKeySecret: '',
    tosBucket: '',
    tosRegion: 'cn-beijing',
    tosEndpoint: 'https://tos-cn-beijing.volces.com',
    ffmpegPath: '',
    agentBaseUrl: 'https://api.openai.com/v1',
    agentApiKey: '',
    agentModel: 'gpt-4o-mini'
  });

  async function invoke(channel: string, payload: Record<string, unknown> = {}) {
    return window.api.invoke(channel, payload);
  }

  function handleResizerMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setIsDraggingResizer(true);

    const workspace = (e.currentTarget as HTMLElement).parentElement;
    if (!workspace) return;
    const startX = e.clientX;
    const workspaceRect = workspace.getBoundingClientRect();
    const startPct = (centerColWidth / 100) * workspaceRect.width;

    function onMouseMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const newWidth = startPct + dx;
      const minWidth = 280;
      const maxWidth = workspaceRect.width - 280;
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      const pct = (clamped / workspaceRect.width) * 100;
      setCenterColWidth(pct);
    }

    function onMouseUp() {
      setIsDraggingResizer(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  async function initProject(): Promise<AnyRecord | null> {
    try {
      await invoke('project.init', { path: projectPath, name: projectName });
      addLog('Project initialized');
    } catch (error) {
      // Project already exists is fine — fall through and open it
      addLog(`Init skipped: ${String(error).slice(0, 120)}`);
    }
    return openProject();
  }

  async function openProject(): Promise<AnyRecord | null> {
    try {
      const result = (await invoke('project.open', { path: projectPath })) as AnyRecord;
      setProject(result);
      setTimeline(result.timeline);
      const cfg = await invoke('config.get', { path: projectPath }) as AnyRecord;
      setConfig(cfg);
      addLog('Project opened');
      await refreshSidebar();
      return result;
    } catch (error) {
      addLog(`Open project failed: ${String(error)}`);
      return null;
    }
  }

  async function ensureProject(): Promise<AnyRecord | null> {
    if (project) return project;
    const opened = await openProject();
    if (opened) return opened;
    return initProject();
  }

  async function refreshSidebar() {
    const [canvasList, assetList, presetList, jobList] = await Promise.all([
      invoke('canvas.list', { path: projectPath }).catch(() => []),
      invoke('asset.list', { path: projectPath }).catch(() => []),
      invoke('preset.list', { path: projectPath }).catch(() => []),
      invoke('job.list', { path: projectPath }).catch(() => [])
    ]);
    setCanvases(canvasList as AnyRecord[]);
    setAssets(assetList as AnyRecord[]);
    setPresets(presetList as AnyRecord[]);
    setJobs(jobList as AnyRecord[]);
  }

  function useTemplatePrompt(prompt: string) {
    setChatInput(prompt);
    setAiView('chat');
  }

  async function createBlankCanvas() {
    const activeProject = await ensureProject();
    if (!activeProject) {
      addLog('Open or init a project first');
      return;
    }
    try {
      const created = (await invoke('canvas.create', {
        path: projectPath,
        name: 'Canvas'
      })) as AnyRecord;
      const inputNode = (await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: created.id,
        type: 'text-input',
        params: { text: 'A cinematic mountain sunrise' }
      })) as AnyRecord;
      const genNode = (await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: created.id,
        type: 'text-to-video',
        params: { durationMs: 5000 }
      })) as AnyRecord;
      const outputNode = (await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: created.id,
        type: 'output',
        params: {}
      })) as AnyRecord;
      await invoke('canvas.edge.connect', {
        path: projectPath,
        canvasId: created.id,
        source: inputNode.id,
        sourcePort: 'text',
        target: genNode.id,
        targetPort: 'text'
      });
      await invoke('canvas.edge.connect', {
        path: projectPath,
        canvasId: created.id,
        source: genNode.id,
        sourcePort: 'video',
        target: outputNode.id,
        targetPort: 'video'
      });
      await refreshCanvas(created.id);
      await refreshSidebar();
      addLog('Created canvas');
    } catch (error) {
      addLog(String(error));
    }
  }

  async function createCanvasFromPrompt(prompt: string, title: string) {
    const activeProject = await ensureProject();
    if (!activeProject) {
      addLog('Open or init a project first');
      return;
    }
    try {
      const created = (await invoke('canvas.create', {
        path: projectPath,
        name: title
      })) as AnyRecord;
      const inputNode = (await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: created.id,
        type: 'text-input',
        params: { text: prompt }
      })) as AnyRecord;
      const genNode = (await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: created.id,
        type: 'text-to-video',
        params: { durationMs: 5000 }
      })) as AnyRecord;
      const outputNode = (await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: created.id,
        type: 'output',
        params: {}
      })) as AnyRecord;
      await invoke('canvas.edge.connect', {
        path: projectPath,
        canvasId: created.id,
        source: inputNode.id,
        sourcePort: 'text',
        target: genNode.id,
        targetPort: 'text'
      });
      await invoke('canvas.edge.connect', {
        path: projectPath,
        canvasId: created.id,
        source: genNode.id,
        sourcePort: 'video',
        target: outputNode.id,
        targetPort: 'video'
      });
      await refreshCanvas(created.id);
      await refreshSidebar();
      setChatMessages((messages) => [
        ...messages,
        { role: 'user', text: prompt },
        { role: 'assistant', text: `Created canvas "${title}" with a text-to-video flow.` }
      ]);
      setAiView('chat');
    } catch (error) {
      addLog(String(error));
    }
  }

  async function importAssets() {
    try {
      const result = (await invoke('asset.import', { path: projectPath })) as AnyRecord;
      if (result.imported?.length > 0) {
        addLog(`Imported ${result.imported.length} assets`);
        await refreshSidebar();
      }
    } catch (error) {
      addLog(String(error));
    }
  }

  async function applyPreset(presetId: string, name: string) {
    try {
      const canvas = (await invoke('preset.apply', { path: projectPath, presetId, name })) as AnyRecord;
      await refreshCanvas(canvas.id);
      await refreshSidebar();
      setCenterTab('canvas');
      addLog(`Applied preset: ${name}`);
    } catch (error) {
      addLog(String(error));
    }
  }

  async function openCanvas(canvasId: string) {
    if (!canvasId) return;
    await refreshCanvas(canvasId);
    setCenterTab('canvas');
  }

    async function renderCanvas(force = false) {
    if (!canvas) return;
    try {
      const result = (await invoke('canvas.render', {
        path: projectPath,
        canvasId: canvas.id,
        force
      })) as AnyRecord;
      setJobId(result.jobId);
      addLog(`Render submitted: ${result.jobId}`);
      await refreshSidebar();

      const poll = async () => {
        try {
          const job = await invoke('job.status', { path: projectPath, jobId: result.jobId }) as AnyRecord;
          if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
            addLog(`Render ${job.status}: ${result.jobId}`);
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
      addLog(String(error));
    }
  }async function refreshCanvas(canvasId?: string) {
    const currentCanvasId = canvasId ?? canvas?.id;
    if (!currentCanvasId) return;
    const updated = (await invoke('canvas.get', {
      path: projectPath,
      canvasId: currentCanvasId
    })) as AnyRecord;
    setCanvas(updated);
  }

  async function addNode() {
    if (!canvas) return;
    try {
      const defaultParams: Record<string, unknown> = {};
      if (newNodeType === 'text-input') defaultParams.text = 'Your prompt here';
      else if (newNodeType === 'text-to-image' || newNodeType === 'text-to-video') {
        defaultParams.prompt = 'A beautiful landscape';
        if (newNodeType === 'text-to-video') defaultParams.durationMs = 5000;
      } else if (newNodeType === 'image-to-image' || newNodeType === 'image-to-video') {
        defaultParams.prompt = 'Enhance this image';
        if (newNodeType === 'image-to-video') defaultParams.durationMs = 5000;
      } else if (newNodeType === 'video-to-video') {
        defaultParams.prompt = 'Edit this video';
        defaultParams.mode = 'edit';
      }
      await invoke('canvas.node.add', {
        path: projectPath,
        canvasId: canvas.id,
        type: newNodeType,
        params: defaultParams
      });
      await refreshCanvas(canvas.id);
    } catch (error) {
      addLog(String(error));
    }
  }

  async function removeNode(nodeId: string) {
    if (!canvas) return;
    await invoke('canvas.node.remove', { path: projectPath, canvasId: canvas.id, nodeId });
    await refreshCanvas(canvas.id);
  }

  async function removeEdge(edgeId: string) {
    if (!canvas) return;
    await invoke('canvas.edge.remove', { path: projectPath, canvasId: canvas.id, edgeId });
    await refreshCanvas(canvas.id);
  }

  async function connectCanvasNodes(source: string, sourcePort: string, target: string, targetPort: string) {
    if (!canvas) return;
    await invoke('canvas.edge.connect', {
      path: projectPath,
      canvasId: canvas.id,
      source,
      sourcePort,
      target,
      targetPort
    });
    await refreshCanvas(canvas.id);
  }

  async function updateNodeParams(nodeId: string, params: AnyRecord) {
    if (!canvas) return;
    await invoke('canvas.node.set-param', {
      path: projectPath,
      canvasId: canvas.id,
      nodeId,
      params
    });
    await refreshCanvas(canvas.id);
  }

  async function refreshJob() {
    if (!jobId) return;
    const result = (await invoke('job.status', { path: projectPath, jobId })) as AnyRecord;
    if (result.status === 'succeeded') {
      await refreshCanvas(canvas?.id);
      await refreshSidebar();
    }
  }

  async function addTrack(type: 'video' | 'audio' | 'subtitle') {
    const name = type === 'video' ? `V${(timeline?.tracks?.filter((t: AnyRecord) => t.type === 'video').length ?? 0) + 1}` : type === 'audio' ? `A${(timeline?.tracks?.filter((t: AnyRecord) => t.type === 'audio').length ?? 0) + 1}` : `S${(timeline?.tracks?.filter((t: AnyRecord) => t.type === 'subtitle').length ?? 0) + 1}`;
    await invoke('timeline.add-track', { path: projectPath, type, name });
    await refreshTimeline();
  }

  async function addCanvasClipToTimeline() {
    if (!canvas || !timeline) return;
    const trackId = timeline.tracks?.[0]?.id;
    if (!trackId) {
      addLog('Add a video track first');
      return;
    }
    await invoke('timeline.add-clip', {
      path: projectPath,
      trackId,
      kind: 'canvas',
      canvasId: canvas.id,
      startMs: 0,
      durationMs: 5000
    });
    await refreshTimeline();
  }

  async function moveTimelineClip(clipId: string, startMs: number) {
    await invoke('timeline.move-clip', { path: projectPath, clipId, startMs });
    await refreshTimeline();
  }

  async function refreshTimeline() {
    const result = (await invoke('timeline.get', { path: projectPath })) as AnyRecord;
    setTimeline(result);
    const duration = (result.tracks ?? []).reduce((max: number, track: AnyRecord) => {
      return (track.clips ?? []).reduce(
        (trackMax: number, clip: AnyRecord) => Math.max(trackMax, clip.startMs + clip.durationMs),
        max
      );
    }, 0);
    setTimelineDurationMs(duration);
  }

  async function exportTimeline() {
    try {
      const output = `${projectPath}\\export.mp4`;
      const result = (await invoke('timeline.export', { path: projectPath, outputPath: output })) as AnyRecord;
      setJobId(result.jobId);
      addLog(`Export submitted: ${result.jobId}`);
      setTasksOpen(true);
    } catch (error) {
      addLog(String(error));
    }
  }

  async function cancelTask(taskId: string) {
    try {
      await invoke('job.cancel', { path: projectPath, jobId: taskId });
      await refreshSidebar();
    } catch (error) {
      addLog(String(error));
    }
  }

  async function clearCompletedTasks() {
    try {
      await invoke('job.clear', { path: projectPath });
      await refreshSidebar();
      addLog('Cleared completed tasks');
    } catch (error) {
      addLog(String(error));
    }
  }

  async function saveRuntimeSettings() {
    try {
      const result = await invoke('settings.set-runtime', { path: projectPath, ...runtimeSettings });
      addLog(`Runtime settings applied: ${JSON.stringify(result)}`);
      setSettingsOpen(false);
    } catch (error) {
      addLog(String(error));
    }
  }

  async function openSettings() {
    try {
      const saved = (await invoke('settings.get-runtime', { path: projectPath })) as AnyRecord;
      setRuntimeSettings((current) => ({ ...current, ...saved }));
    } catch (error) {
      addLog(String(error));
    }
    setSettingsOpen(true);
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text) return;
    const history = chatMessages.map((message) => ({ role: message.role, content: message.text }));
    setChatMessages((messages) => [...messages, { role: 'user', text }]);
    setChatInput('');
    setAiView('chat');
    try {
      const result = (await invoke('agent.chat', {
        path: projectPath,
        message: text,
        history
      })) as AnyRecord;
      setChatMessages((messages) => [...messages, { role: 'assistant', text: result.text }]);
    } catch (error) {
      setChatMessages((messages) => [...messages, { role: 'assistant', text: `Error: ${String(error)}` }]);
    }
  }

  useEffect(() => {
    void openProject();
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const timer = setInterval(() => {
      void refreshJob();
    }, 1500);
    return () => clearInterval(timer);
  }, [jobId, canvas?.id]);

  useEffect(() => {
    if (!project) return;
    const timer = setInterval(() => {
      void refreshSidebar();
    }, 5000);
    return () => clearInterval(timer);
  }, [project]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setPlayheadMs((current) => {
        const next = current + 100;
        if (timelineDurationMs > 0 && next >= timelineDurationMs) {
          setPlaying(false);
          return timelineDurationMs;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, timelineDurationMs]);

  const selectedNode = canvas?.nodes?.find((node: AnyRecord) => node.status === 'succeeded');
  const previewAsset = selectedNode?.cachedResult ?? null;
  const runningJobs = jobs.filter((job) => job.status === 'running' || job.status === 'pending').length;
  const filteredAssets = assets.filter((asset) =>
    assetSearch ? String(asset.name ?? '').toLowerCase().includes(assetSearch.toLowerCase()) : true
  );

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="logo">CC</span>
          <button className="project-name" onClick={() => setProjectOpen(!projectOpen)} title="Project settings">
            {projectName}
            <Icon name="share" size={13} />
          </button>
          {projectOpen && (
            <div className="popover project-popover">
              <label>Project path
                <input value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
              </label>
              <label>Project name
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <div className="popover-actions">
                <button onClick={initProject}><Icon name="folderPlus" size={13} /> Init</button>
                <button onClick={openProject}><Icon name="folderOpen" size={13} /> Open</button>
              </div>
            </div>
          )}
        </div>
        <div className="titlebar-right">
          <button className="ibtn" disabled title="Undo"><Icon name="undo" /></button>
          <button className="ibtn" disabled title="Redo"><Icon name="redo" /></button>
          <button className={`avatar ${tasksOpen ? 'active' : ''}`} onClick={() => setTasksOpen(!tasksOpen)} title="Tasks">
            <Icon name="person" size={15} />
            {runningJobs > 0 && <span className="avatar-badge">{runningJobs}</span>}
          </button>
          {tasksOpen && (
            <div className="popover tasks-popover">
              <div className="popover-title">
                Tasks
                {jobs.some((j) => j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled') && (
                  <button className="task-clear-all" onClick={clearCompletedTasks} title="Clear completed tasks">
                    Clear
                  </button>
                )}
              </div>
              {jobs.length === 0 && <div className="popover-empty">No tasks yet</div>}
              {jobs.map((task) => (
                <div key={task.jobId} className="task-item">
                  <span className={`task-dot task-${task.status}`} />
                  {task.type} · {task.status}
                  {(task.status === 'pending' || task.status === 'running') && (
                    <button className="task-cancel" onClick={() => cancelTask(task.jobId)}>Cancel</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <button className="ibtn" onClick={openSettings} title="Settings"><Icon name="gear" /></button>
          <button className="btn-export" onClick={exportTimeline} disabled={!timeline}>Export</button>
        </div>
      </header>

      <div
        className={`workspace ${isDraggingResizer ? 'resizing' : ''}`}
        style={{ ['--center-col' as string]: `${centerColWidth}%` }}
      >
        <aside className="ai-panel">
          <div className="ai-head">
            <Icon name="home" size={15} />
            <span>AI</span>
            <div className="ai-head-tabs">
              <button className={aiView === 'templates' ? 'active' : ''} onClick={() => setAiView('templates')}>Templates</button>
              <button className={aiView === 'chat' ? 'active' : ''} onClick={() => setAiView('chat')}>Chat</button>
              <button className={aiView === 'presets' ? 'active' : ''} onClick={() => setAiView('presets')}>Presets</button>
            </div>
          </div>
          {aiView === 'presets' ? (
            <div className="ai-scroll preset-list">
              {presets.map((preset) => (
                <div key={preset.id} className="preset-item">
                  <div className="preset-name">{preset.name}</div>
                  <button onClick={() => applyPreset(preset.id, preset.name)}>Apply</button>
                </div>
              ))}
              {presets.length === 0 && <div className="empty-state-static">No presets yet</div>}
            </div>
          ) : aiView === 'templates' ? (
            <div className="ai-scroll">
              <h2 className="ai-title">What do you want to create today?</h2>
              <div className="template-grid">
                {templateCards.map((card) => (
                  <button key={card.title} className="template-card" onClick={() => useTemplatePrompt(card.prompt)} title={card.prompt}>
                    <span className="template-thumb" style={{ background: card.gradient }}>
                      <Icon name={card.icon} size={20} />
                      {card.pro && <span className="pro-badge">PRO</span>}
                    </span>
                    <span className="template-label">{card.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="chat-top">
                <button className="chat-new" onClick={() => setAiView('templates')}>
                  <Icon name="plus" size={13} /> New creation
                </button>
              </div>
              <div className="ai-scroll ai-chat">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`chat-message ${message.role}`}>{message.text}</div>
                ))}
              </div>
            </>
          )}
          <div className="ai-composer">
            <div className="composer-row">
              <select defaultValue="agent">
                <option value="agent">Agent</option>
              </select>
              <span className="composer-tools">
                <button className="ibtn" title="Add" onClick={() => addLog('Add is not implemented yet')}><Icon name="plus" size={15} /></button>
                <button className="ibtn" title="Attach" onClick={() => addLog('Attach is not implemented yet')}><Icon name="attach" size={15} /></button>
                <button className="ibtn" title="Voice input" onClick={() => addLog('Voice input is not implemented yet')}><Icon name="mic" size={15} /></button>
                <button className="ibtn" title="History" onClick={() => addLog('History is not implemented yet')}><Icon name="history" size={15} /></button>
                <button className="ibtn" title="More" onClick={() => addLog('More is not implemented yet')}><Icon name="dots" size={15} /></button>
              </span>
            </div>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault();
                  sendChatMessage();
                }
              }}
              placeholder="Describe what you'd like to create..."
            />
            <div className="composer-row composer-footer">
              <span className="composer-hint">Ctrl+Enter to send</span>
              <button className="send-button" onClick={sendChatMessage} title="Send"><Icon name="send" size={14} /></button>
            </div>
          </div>
        </aside>

        <section className="center-panel">
          {centerTab === 'assets' ? (
            <>
              <div className="panel-tabs">
                <button className={assetTab === 'my-assets' ? 'active' : ''} onClick={() => setAssetTab('my-assets')}>My Assets</button>
                <button className={assetTab === 'library' ? 'active' : ''} onClick={() => setAssetTab('library')}>Library</button>
                <button onClick={() => setCenterTab('canvas')}>Canvas</button>
                <button className={assetTab === 'transcript' ? 'active' : ''} onClick={() => setAssetTab('transcript')}>Transcript</button>
              </div>
              {assetTab === 'transcript' ? (
                <div className="assets-body">
                  <div className="empty-state-static">
                    <Icon name="list" size={40} />
                    <p className="empty-title">No transcript yet</p>
                    <p className="empty-sub">Transcript appears after you generate a talking-head video.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="assets-toolbar">
                    <span className="search-box">
                      <Icon name="search" size={14} />
                      <input
                        value={assetSearch}
                        onChange={(event) => setAssetSearch(event.target.value)}
                        placeholder="Search assets"
                      />
                    </span>
                    <span className="toolbar-group">
                      <button className={`ibtn ${assetView === 'grid' ? 'active' : ''}`} title="Upload" onClick={importAssets}><Icon name="upload" size={15} /></button>
                      <button className={`ibtn ${assetView === 'grid' ? 'active' : ''}`} title="Grid view" onClick={() => setAssetView('grid')}><Icon name="grid" size={15} /></button>
                      <button className={`ibtn ${assetView === 'list' ? 'active' : ''}`} title="List view" onClick={() => setAssetView('list')}><Icon name="list" size={15} /></button>
                      <button className={`ibtn ${sortActive ? 'active' : ''}`} title="Sort" onClick={() => setSortActive(!sortActive)}><Icon name="sort" size={15} /></button>
                      <button className={`ibtn ${filterActive ? 'active' : ''}`} title="Filter" onClick={() => setFilterActive(!filterActive)}><Icon name="filter" size={15} /></button>
                    </span>
                  </div>
                  <div className="assets-body">
                    {filteredAssets.length === 0 ? (
                      <div className="empty-state-static">
                        <Icon name="folder" size={44} />
                        <p className="empty-title">This bin is empty</p>
                        <p className="empty-sub">Import media or drag clips here.</p>
                      </div>
                    ) : assetView === 'grid' ? (
                      <div className="asset-grid">
                        {filteredAssets.map((asset) => (
                          <div key={asset.path} className="asset-card">
                            <span className="asset-thumb">
                              {asset.type === 'image' ? (
                                <img src={'file:///' + asset.path.replace(/\\/g, '/').replace(/^\/+/, '')} alt={asset.name} />
                              ) : (
                                <Icon name={asset.type === 'video' ? 'video' : 'image'} size={18} />
                              )}
                            </span>
                            <span className="asset-name">{asset.name}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="asset-list-view">
                        {filteredAssets.map((asset) => (
                          <div key={asset.path} className="asset-row">
                            {asset.type === 'image' ? (
                              <img src={'file:///' + asset.path.replace(/\\/g, '/').replace(/^\/+/, '')} alt={asset.name} style={{ width: 15, height: 15, objectFit: 'cover', borderRadius: 2 }} />
                            ) : (
                              <Icon name={asset.type === 'video' ? 'video' : 'image'} size={15} />
                            )}
                            <span>{asset.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="canvas-toolbar">
                <button className="ibtn" title="Back" onClick={() => { setCenterTab('assets'); setCanvas(null); }}><Icon name="chevronLeft" size={15} /></button>
                <button className="tb-text" onClick={createBlankCanvas} disabled={!project}><Icon name="plus" size={13} /> New canvas</button>
                {canvas && (
                  <>
                    <select value={newNodeType} onChange={(event) => setNewNodeType(event.target.value)}>
                      <option value="text-input">Text Input</option>
                      <option value="text-to-image">Text to Image</option>
                      <option value="text-to-video">Text to Video</option>
                      <option value="image-to-image">Image to Image</option>
                      <option value="image-to-video">Image to Video</option>
                      <option value="video-to-video">Video to Video</option>
                      <option value="output">Output</option>
                    </select>
                    <button className="tb-text" onClick={addNode} disabled={!canvas}>Add node</button>
                    <button className="tb-text" onClick={() => renderCanvas(false)} disabled={!canvas}>Render</button>
                    <button className="tb-text accent" onClick={() => renderCanvas(true)} disabled={!canvas}>Force render</button>
                  </>
                )}
              </div>
              <div className="canvas-body">
                {canvas ? (
                  <CanvasGraphView
                    canvas={canvas}
                    onConnect={connectCanvasNodes}
                    onRemoveNode={removeNode}
                    onRemoveEdge={removeEdge}
                    onUpdateNodeParams={updateNodeParams}
                    config={config}
                  />
                ) : canvases.length > 0 ? (
                  <div className="canvas-grid">
                    <button className="canvas-card canvas-card-new" onClick={createBlankCanvas}>
                      <span className="canvas-card-icon"><Icon name="plus" size={18} /></span>
                      <span className="canvas-card-title">New canvas</span>
                      <span className="canvas-card-meta">Start from a blank flow</span>
                    </button>
                    {canvases.map((item, index) => (
                      <button key={item.id} className="canvas-card" onClick={() => openCanvas(item.id)}>
                        <span className="canvas-card-icon"><Icon name="share" size={16} /></span>
                        <span className="canvas-card-title">Canvas {index + 1}</span>
                        <span className="canvas-card-meta">{item.nodeCount} nodes</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state-static">
                    <Icon name="spark" size={40} />
                    <p className="empty-title">No canvas yet</p>
                    <p className="empty-sub">Create a canvas to start building your flow.</p>
                    <button className="tb-text accent" onClick={createBlankCanvas}><Icon name="plus" size={13} /> New canvas</button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <div
          className={`panel-resizer ${isDraggingResizer ? 'dragging' : ''}`}
          onMouseDown={handleResizerMouseDown}
          title="Drag to resize"
        />

        <section className="viewer-panel">
          <div className="viewer-label">Viewer</div>
          <div className="viewer-body">
            {previewAsset?.path ? (
              /\.(png|jpe?g|webp|gif)$/i.test(previewAsset.path) ? (
                <img className="viewer-media" src={fileUrl(previewAsset.path)} alt="preview" />
              ) : /\.(mp4|webm|mov)$/i.test(previewAsset.path) ? (
                <video className="viewer-media" src={fileUrl(previewAsset.path)} controls />
              ) : (
                <div className="viewer-file">{previewAsset.path}</div>
              )
            ) : (
              <div className="viewer-drop">
                <Icon name="cloud" size={38} />
                <span>Drop media here</span>
              </div>
            )}
          </div>
        </section>

        <footer className="timeline-panel">
          <div className="timeline-toolbar">
            <div className="tl-group">
              <span className="add-wrap">
                <button className="ibtn" title="Add track or clip" onClick={() => setAddMenuOpen(!addMenuOpen)}><Icon name="plus" size={16} /></button>
                {addMenuOpen && (
                  <div className="popover add-popover">
                    <button onClick={() => { void addTrack('video'); setAddMenuOpen(false); }}>Add video track</button>
                    <button onClick={() => { void addTrack('audio'); setAddMenuOpen(false); }}>Add audio track</button>
                    <button onClick={() => { void addTrack('subtitle'); setAddMenuOpen(false); }}>Add subtitle track</button>
                    <button disabled={!canvas} onClick={() => { void addCanvasClipToTimeline(); setAddMenuOpen(false); }}>Add canvas clip</button>
                  </div>
                )}
              </span>
              <span className="tl-sep" />
              <button className="ibtn" title="Go to start"><Icon name="skipBack" size={14} /></button>
              <button className={`ibtn ${playing ? 'active' : ''}`} title="Play / pause" onClick={() => setPlaying(!playing)}>
                <Icon name={playing ? 'pause' : 'play'} size={14} />
              </button>
              <button className="ibtn" title="Go to end"><Icon name="skipFwd" size={14} /></button>
              <span className="tl-sep" />
              <button className={`ibtn ${snapOn ? 'active' : ''}`} title="Snapping" onClick={() => setSnapOn(!snapOn)}><Icon name="magnet" size={15} /></button>
              <button className="ibtn" title="Razor"><Icon name="scissors" size={14} /></button>
              <button className="ibtn" title="Unlink"><Icon name="unlink" size={14} /></button>
              <button className="ibtn" title="Marker"><Icon name="marker" size={14} /></button>
            </div>
            <div className="tl-time">{formatTimelineTime(playheadMs)} / {formatTimelineTime(timelineDurationMs)}</div>
            <div className="tl-group">
              <button className="ibtn" title="Zoom out" onClick={() => setZoom(Math.max(0, zoom - 10))}><Icon name="minus" size={14} /></button>
              <input className="zoom-slider" type="range" min={0} max={100} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <button className="ibtn" title="Zoom in" onClick={() => setZoom(Math.min(100, zoom + 10))}><Icon name="plus" size={14} /></button>
              <span className="tl-sep" />
              <button className="ibtn" title="Fit"><Icon name="fit" size={15} /></button>
              <button className="ibtn" title="Expand"><Icon name="expand" size={15} /></button>
            </div>
          </div>
          <TimelineView
            timeline={timeline}
            onMoveClip={moveTimelineClip}
            zoom={zoom}
            playheadMs={playheadMs}
            onSeek={setPlayheadMs}
          />
        </footer>
      </div>

      {settingsOpen && (
        <div className="settings-overlay">
          <div className="settings-modal">
            <h2>Runtime settings</h2>
            <label>ARK API Key <input type="password" value={runtimeSettings.arkApiKey} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, arkApiKey: event.target.value })} /></label>
            <label>TOS Access Key ID <input value={runtimeSettings.tosAccessKeyId} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosAccessKeyId: event.target.value })} /></label>
            <label>TOS Access Key Secret <input type="password" value={runtimeSettings.tosAccessKeySecret} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosAccessKeySecret: event.target.value })} /></label>
            <label>TOS Bucket <input value={runtimeSettings.tosBucket} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosBucket: event.target.value })} /></label>
            <label>TOS Region <input value={runtimeSettings.tosRegion} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosRegion: event.target.value })} /></label>
            <label>TOS Endpoint <input value={runtimeSettings.tosEndpoint} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosEndpoint: event.target.value })} /></label>
            <label>FFmpeg path <input value={runtimeSettings.ffmpegPath} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, ffmpegPath: event.target.value })} /></label>
            <label>Agent Base URL <input value={runtimeSettings.agentBaseUrl} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, agentBaseUrl: event.target.value })} /></label>
            <label>Agent API Key <input type="password" value={runtimeSettings.agentApiKey} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, agentApiKey: event.target.value })} /></label>
            <label>Agent Model <input value={runtimeSettings.agentModel} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, agentModel: event.target.value })} /></label>
            <div className="settings-actions">
              <button onClick={saveRuntimeSettings}>Save</button>
              <button onClick={() => setSettingsOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <footer className="statusbar">
        <div className="log-panel">
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
    </div>
      </footer>
    </main>
  );
}
