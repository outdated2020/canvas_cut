import { useEffect, useRef, useMemo, useState } from 'react';
import { usePlayer } from './usePlayer';
import { useAgentChat } from './useAgentChat';
import { Conversations, useConversations } from './Conversations';
import { ChatMarkdown } from './ChatMarkdown';
import { AgentActivity } from './AgentActivity';
import { RuntimeSettings } from './RuntimeSettings';
import { ModelApiTransfer } from './ModelApiTransfer';
import { ContextUsageRing } from './ContextUsageRing';
import { Player } from './Player';
import { CanvasGraphView } from './CanvasGraphView';
import { CanvasName } from './CanvasName';
import { nodeLabels } from './NodeParamsInline';
import { defaultWhiteModelParams } from '@canvas-cut/core/dist/canvas/white-model';
import { TimelineView } from './TimelineView';
import { Icon } from './icons';
import type { TimelineFile, Track, Clip } from '@canvas-cut/core';
import { createCanvasRefreshCoordinator, projectKey, type CanvasChangeNotification } from './canvas-sync';

declare global {
  interface Window {
    api: {
      invoke(channel: string, payload?: Record<string, unknown>): Promise<unknown>;
      onCanvasChanged(callback: (change: CanvasChangeNotification) => void): () => void;
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

function formatTimelineTime(ms: number, fps: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frameMs = 1000 / fps;
  const frames = Math.floor((ms % 1000) / frameMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

export function App() {
  const [projectPath, setProjectPath] = useState('C:\\Users\\liqijun\\Desktop\\canvas_cut\\demo-project');
  const [projectName, setProjectName] = useState('Demo Project');
  const [project, setProject] = useState<AnyRecord | null>(null);
  const [config, setConfig] = useState<AnyRecord | null>(null);
  const [timeline, setTimeline] = useState<TimelineFile | null>(null);
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
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [aiView, setAiView] = useState<AiView>('templates');
  const [centerTab, setCenterTab] = useState<CenterTab>('assets');
  const [assetTab, setAssetTab] = useState<AssetTab>('my-assets');
  const [assetSearch, setAssetSearch] = useState('');
  const [selectedAssetPath, setSelectedAssetPath] = useState<string | null>(null);
  const [assetView, setAssetView] = useState<'grid' | 'list'>('grid');
  const [sortActive, setSortActive] = useState(false);
  const [filterActive, setFilterActive] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [snapOn, setSnapOn] = useState(true);
  const [zoom, setZoom] = useState(50);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [razorMode, setRazorMode] = useState(false);
  const [canvasExpanded, setCanvasExpanded] = useState(false);
  const [draggingAsset, setDraggingAsset] = useState<AnyRecord | null>(null);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const conversations = useConversations(projectPath);
  const draftKey = JSON.stringify([projectPath, conversations.selected]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const chatInput = drafts[draftKey] ?? '';
  const setChatInput = (value: string) => setDrafts(current => ({ ...current, [draftKey]: value }));
  const agentChat = useAgentChat(projectPath, conversations.selected, async () => { await Promise.all([refreshSidebar(), refreshTimeline(), refreshCanvas().catch(() => setCanvas(null))]); }, () => setAiView('chat'));
  const { messages: chatMessages, setMessages: setChatMessages } = agentChat;
  const [canvas, setCanvas] = useState<AnyRecord | null>(null);
  const viewIdentity = useRef({ key: '', projectPath, canvasId: null as string | null, epoch: 0 });
  const viewProjectPath = project?.path ?? projectPath;
  const viewKey = JSON.stringify([projectKey(viewProjectPath), canvas?.id ?? null]);
  if (viewIdentity.current.key !== viewKey) viewIdentity.current = { key: viewKey, projectPath: viewProjectPath, canvasId: canvas?.id ?? null, epoch: viewIdentity.current.epoch + 1 };
  const canvasReadRevision = useRef(0);
  const projectInput = useRef(projectPath); projectInput.current = projectPath;

  useEffect(() => {
    const refresh = createCanvasRefreshCoordinator({
      target: () => viewIdentity.current,
      loadSidebar: readSidebar,
      loadCanvas: async (path, id) => await invoke('canvas.get', { path, canvasId: id }) as AnyRecord,
      applySidebar,
      applyCanvas: data => setCanvas(data),
      onError: error => addLog(`Canvas refresh failed: ${String(error)}`)
    });
    const unsubscribe = window.api.onCanvasChanged(refresh.receive);
    return () => { unsubscribe(); refresh.dispose(); };
  }, []);
  const [deletingCanvas, setDeletingCanvas] = useState<string | null>(null);
  const [canvasDeleteError, setCanvasDeleteError] = useState('');
  const [centerColWidth, setCenterColWidth] = useState(42); // percentage of workspace width
  const [isDraggingResizer, setIsDraggingResizer] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState({
    arkApiKey: '',
    arkBaseUrl: '',
    arkImageModel: '',
    arkVideoModel: '',
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
      if (projectInput.current !== projectPath) return null;
      if (project && projectKey(project.path) !== projectKey(result.path)) { canvasReadRevision.current++; setCanvas(null); }
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

  async function readSidebar(path: string) {
    const [canvasList, assetList, presetList, jobList] = await Promise.all([
      invoke('canvas.list', { path }).catch(() => []),
      invoke('asset.list', { path }).catch(() => []),
      invoke('preset.list', { path }).catch(() => []),
      invoke('job.list', { path }).catch(() => [])
    ]);
    return { canvasList, assetList, presetList, jobList };
  }
  function applySidebar({ canvasList, assetList, presetList, jobList }: Awaited<ReturnType<typeof readSidebar>>) {
    setCanvases(canvasList as AnyRecord[]);
    setAssets(assetList as AnyRecord[]);
    setPresets(presetList as AnyRecord[]);
    setJobs(jobList as AnyRecord[]);
  }
  async function refreshSidebar() {
    const data = await readSidebar(projectPath);
    if (projectInput.current === projectPath) applySidebar(data);
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

  async function renameCanvas(canvasId: string, name: string) {
    const path = viewProjectPath;
    const result = await invoke('canvas.rename', { path, canvasId, name }) as AnyRecord;
    if (projectKey(projectInput.current) !== projectKey(path)) return;
    setCanvases(current => current.map(item => item.id === canvasId ? { ...item, name: result.name } : item));
    setCanvas(current => current?.id === canvasId ? { ...current, name: result.name, version: Math.max(current.version, result.version) } : current);
  }

  async function deleteCanvas(canvasId: string) {
    if (deletingCanvas) return;
    setDeletingCanvas(canvasId);
    setCanvasDeleteError('');
    try {
      const result = await invoke('canvas.remove', { path: projectPath, canvasId }) as AnyRecord;
      if (!result.removed) return;
      setCanvas((current) => current?.id === canvasId ? null : current);
      await refreshSidebar();
      addLog('画布已删除');
    } catch (error) {
      setCanvasDeleteError(String(error));
    } finally {
      setDeletingCanvas(null);
    }
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
    const revision = ++canvasReadRevision.current;
    const epoch = viewIdentity.current.epoch;
    const updated = (await invoke('canvas.get', {
      path: projectPath,
      canvasId: currentCanvasId
    })) as AnyRecord;
    if (canvasReadRevision.current !== revision || projectInput.current !== projectPath) return;
    if (viewIdentity.current.epoch !== epoch) return;
    setCanvas(updated);
  }

  async function addNode(type: string): Promise<string> {
    if (!canvas) throw new Error('请先打开画布');
    const target = viewIdentity.current;
    const defaultParams: Record<string, unknown> = {};
    if (type === 'text-input') defaultParams.text = 'Your prompt here';
    else if (type === 'text-to-image' || type === 'text-to-video') {
      defaultParams.prompt = 'A beautiful landscape';
      if (type === 'text-to-video') defaultParams.durationMs = 5000;
    } else if (type === 'image-to-image' || type === 'image-to-video') {
      defaultParams.prompt = 'Enhance this image';
      if (type === 'image-to-video') defaultParams.durationMs = 5000;
    } else if (type === 'white-model-video') {
      Object.assign(defaultParams, defaultWhiteModelParams());
    } else if (type === 'video-to-video') {
      defaultParams.prompt = 'Edit this video';
      defaultParams.mode = 'edit';
    }
    const added = await invoke('canvas.node.add', {
      path: projectPath,
      canvasId: canvas.id,
      type,
      params: defaultParams
    }) as AnyRecord;
    if (viewIdentity.current.epoch === target.epoch) {
      await refreshCanvas(canvas.id).catch(error => addLog(`Canvas refresh failed: ${String(error)}`));
    }
    return added.id;
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
    const name = type === 'video' ? `V${(timeline?.tracks?.filter((t: Track) => t.type === 'video').length ?? 0) + 1}` : type === 'audio' ? `A${(timeline?.tracks?.filter((t: Track) => t.type === 'audio').length ?? 0) + 1}` : `S${(timeline?.tracks?.filter((t: Track) => t.type === 'subtitle').length ?? 0) + 1}`;
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
    const outputNode = canvas.nodes?.find((n: AnyRecord) => n.type === 'output');
    const cachedResult = outputNode?.cachedResult;
    let durationMs = 5000;
    if (cachedResult?.durationMs) {
      durationMs = cachedResult.durationMs;
    }
    if (!cachedResult) {
      const ok = window.confirm('画布尚未渲染，是否先渲染再加入时间线？');
      if (!ok) return;
      try {
        const renderResult = (await invoke('canvas.render', {
          path: projectPath,
          canvasId: canvas.id,
          force: false
        })) as AnyRecord;
        setJobId(renderResult.jobId);
        addLog(`Canvas rendering: ${renderResult.jobId}`);
        setTasksOpen(true);
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(async () => {
            try {
              const status = (await invoke('job.status', {
                path: projectPath,
                jobId: renderResult.jobId
              })) as AnyRecord;
              if (['succeeded', 'failed', 'cancelled'].includes(status.status)) {
                clearInterval(checkInterval);
                resolve();
              }
            } catch {
              clearInterval(checkInterval);
              resolve();
            }
          }, 2000);
        });
        const updatedCanvas = (await invoke('canvas.get', {
          path: projectPath,
          canvasId: canvas.id
        })) as AnyRecord;
        setCanvas(updatedCanvas);
        const updatedOutput = updatedCanvas.nodes?.find((n: AnyRecord) => n.type === 'output');
        if (!updatedOutput?.cachedResult || updatedOutput.status !== 'succeeded') throw new Error('Canvas did not render successfully');
        if (updatedOutput?.cachedResult?.durationMs) {
          durationMs = updatedOutput.cachedResult.durationMs;
        }
      } catch (error) {
        addLog(`Canvas render failed: ${String(error)}`);
        return;
      }
    }
    await invoke('timeline.add-clip', {
      path: projectPath,
      trackId,
      kind: 'canvas',
      canvasId: canvas.id,
      startMs: 0,
      durationMs
    });
    await refreshTimeline();
  }

  async function addAssetToTimeline(asset: AnyRecord, startMs: number = 0, targetTrackId?: string) {
    if (!timeline) return;
    const targetType = asset.type === 'audio' ? 'audio' : 'video';
    let trackId = targetTrackId ?? timeline.tracks?.find((t: Track) => t.type === targetType)?.id;
    if (targetTrackId) {
      const target = timeline.tracks.find((track) => track.id === targetTrackId);
      if (!target || (target.type !== targetType && !(target.type === 'image' && asset.type === 'image'))) {
        addLog('The asset is incompatible with the selected track'); return;
      }
    }
    if (!trackId) {
      await addTrack(targetType);
      const refreshed = (await invoke('timeline.get', { path: projectPath })) as TimelineFile;
      trackId = refreshed.tracks?.find((t) => t.type === targetType)?.id;
      if (!trackId) return;
    }
    await invoke('timeline.add-clip', {
      path: projectPath,
      trackId,
      kind: 'media',
      asset: asset.path,
      startMs
    });
    await refreshTimeline();
  }

  async function moveTimelineClip(clipId: string, startMs: number) {
    await invoke('timeline.move-clip', { path: projectPath, clipId, startMs });
    await refreshTimeline();
  }

  async function removeTimelineClip(clipId: string) {
    await invoke('timeline.remove-clip', { path: projectPath, clipId });
    setSelectedClipId(null);
    await refreshTimeline();
  }

  async function removeTimelineTrack(trackId: string) {
    await invoke('timeline.remove-track', { path: projectPath, trackId });
    await refreshTimeline();
  }

  async function splitTimelineClip(clipId: string, atMs: number) {
    await invoke('timeline.split-clip', { path: projectPath, clipId, atMs });
    await refreshTimeline();
  }

  async function trimTimelineClip(clipId: string, inMs: number, outMs: number, startMs?: number) {
    await invoke('timeline.trim-clip', { path: projectPath, clipId, inMs, outMs, startMs });
    await refreshTimeline();
  }

  async function setClipParam(clipId: string, param: string, value: unknown) {
    await invoke('timeline.set-clip-param', { path: projectPath, clipId, param, value });
    await refreshTimeline();
  }

  async function addClipTransition(clipId: string, transitionType: string = 'crossfade', durationMs: number = 500) {
    await invoke('timeline.add-transition', { path: projectPath, clipId, transitionType, durationMs });
    await refreshTimeline();
  }

  async function removeClipTransition(clipId: string) {
    await invoke('timeline.remove-transition', { path: projectPath, clipId });
    await refreshTimeline();
  }

  async function refreshTimeline() {
    const result = (await invoke('timeline.get', { path: projectPath })) as TimelineFile;
    setTimeline(result);
    const duration = (result.tracks ?? []).reduce((max: number, track: Track) => {
      return (track.clips ?? []).reduce(
        (trackMax: number, clip: Clip) => Math.max(trackMax, clip.startMs + clip.durationMs),
        max
      );
    }, 0);
  }

  const [exportOpen, setExportOpen] = useState(false);
  const [exportWidth, setExportWidth] = useState(1920);
  const [exportHeight, setExportHeight] = useState(1080);
  const [exportFps, setExportFps] = useState(30);
  const [exportCrf, setExportCrf] = useState(18);

  async function exportTimeline() {
    try {
      const output = `${projectPath}\\export.mp4`;
      const result = (await invoke('timeline.export', { path: projectPath, outputPath: output, width: exportWidth, height: exportHeight, fps: exportFps, crf: exportCrf })) as AnyRecord;
      setJobId(result.jobId);
      addLog(`Export submitted: ${result.jobId}`);
      setTasksOpen(true);
      setExportOpen(false);
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
    if (settingsSaving) return;
    setSettingsError('');
    setSettingsSaving(true);
    try {
      const result = await invoke('settings.set-runtime', { path: projectPath, ...runtimeSettings });
      addLog(`Runtime settings applied: ${JSON.stringify(result)}`);
      const updated = await invoke('config.get', { path: projectPath }) as AnyRecord;
      setConfig(updated);
      setSettingsOpen(false);
    } catch (error) {
      setSettingsError(String(error));
      addLog(String(error));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function openSettings() {
    setSettingsError('');
    try {
      const saved = (await invoke('settings.get-runtime', { path: projectPath })) as AnyRecord;
      setRuntimeSettings((current) => ({ ...current, ...saved }));
    } catch (error) {
      setSettingsError(String(error));
      addLog(String(error));
    }
    setSettingsOpen(true);
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || agentChat.busy || !agentChat.ready || !conversations.current || conversations.current.archivedAt) return;
    setAiView('chat');
    if (await agentChat.send(text)) setDrafts(current => current[draftKey]?.trim() === text ? { ...current, [draftKey]: '' } : current);
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

  const {
    playing,
    playheadMs,
    speed,
    looping,
    duration,
    previewAsset,
    timelineMode,
    videoRef,
    audioRef,
    toggle,
    seek,
    stepForward,
    stepBack,
    goToStart,
    goToEnd,
    setSpeed,
    toggleLoop,
  } = usePlayer({ timeline, assets, canvas, selectedAssetPath, fps: project?.settings?.fps ?? 30 });

  useEffect(() => {
    if (!draggingAsset) return;

    function handlePointerMove(e: PointerEvent) {
      setDragPos({ x: e.clientX, y: e.clientY });
    }

    function handlePointerUp(e: PointerEvent) {
      const asset = draggingAsset;
      if (!asset) { setDraggingAsset(null); return; }
      // Check if dropped on a timeline track
      const timelineEl = document.querySelector('.timeline-panel');
      if (timelineEl) {
        const trackLanes = timelineEl.querySelectorAll('.track-lane');
        for (const lane of Array.from(trackLanes)) {
          const rect = lane.getBoundingClientRect();
          if (e.clientY >= rect.top && e.clientY <= rect.bottom &&
              e.clientX >= rect.left && e.clientX <= rect.right) {
            const trackId = lane.getAttribute('data-track-id');
            if (trackId) {
              const totalMs = duration > 0 ? duration : 30000;
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(rect.width, 1)));
              const startMs = Math.round(ratio * totalMs);
              void addAssetToTimeline(asset, startMs);
              break;
            }
          }
        }
      }
      setDraggingAsset(null);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingAsset, duration]);

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
          <button className="btn-export" onClick={() => setExportOpen(true)} disabled={!timeline}>Export</button>
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
                    <span className="template-thumb">
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
              <Conversations model={conversations} busy={agentChat.busy} />
              <div className="ai-scroll ai-chat">
                {chatMessages.map((message, index) => (
                  <div key={index} className={`chat-message ${message.role}`}><ChatMarkdown text={message.text} /></div>
                ))}
                <AgentActivity events={agentChat.events} run={agentChat.run} />
              </div>
            </>
          )}
          <div className="ai-composer">
            <div className="agent-mode">Local trusted · {navigator.platform.includes('Win') ? 'PowerShell' : 'Bash'}</div>
            {agentChat.error && <div role="alert" className="agent-error">{agentChat.error}</div>}
            <div className="composer-row">
              <select defaultValue="agent">
                <option value="agent">Agent</option>
              </select>
              <span className="composer-tools">
                <button className="ibtn" title="Add" onClick={() => addLog('Add is not implemented yet')}><Icon name="plus" size={15} /></button>
                <button className="ibtn" title="Attach" onClick={() => addLog('Attach is not implemented yet')}><Icon name="attach" size={15} /></button>
                <button className="ibtn" title="Voice input" onClick={() => addLog('Voice input is not implemented yet')}><Icon name="mic" size={15} /></button>
                <button className="ibtn" title="对话管理" onClick={() => setAiView('chat')}><Icon name="history" size={15} /></button>
                <button className="ibtn" title="More" onClick={() => addLog('More is not implemented yet')}><Icon name="dots" size={15} /></button>
              </span>
            </div>
            <textarea
              disabled={!agentChat.ready || !conversations.current || Boolean(conversations.current.archivedAt)}
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
              <ContextUsageRing usage={agentChat.contextUsage} />
              {agentChat.busy ? <button className="send-button" onClick={() => void agentChat.stop()} title="Stop Agent; submitted generation jobs continue">Stop</button> : <button className="send-button" disabled={!agentChat.ready || !conversations.current || Boolean(conversations.current.archivedAt) || !chatInput.trim()} onClick={sendChatMessage} title="Send"><Icon name="send" size={14} /></button>}
            </div>
          </div>
        </aside>

        <section className={`center-panel${centerTab === 'canvas' && canvasExpanded ? ' canvas-expanded' : ''}`}>
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
                      <button className="ibtn" title="Upload" onClick={importAssets}><Icon name="upload" size={15} /></button>
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
                        <p className="empty-title">Import your first media</p>
                        <p className="empty-sub">Import media or drag clips here.</p>
                        <button className="empty-cta" onClick={importAssets}>Import media</button>
                      </div>
                    ) : assetView === 'grid' ? (
                      <div className="asset-grid">
                        {filteredAssets.map((asset) => (
                          <div
                            key={asset.path}
                            className={`asset-card${selectedAssetPath === asset.path ? ' selected' : ''}`}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              setSelectedAssetPath(asset.path);
                              setDraggingAsset(asset);
                              setDragPos({ x: e.clientX, y: e.clientY });
                              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                            }}
                            onDoubleClick={() => {
                              void addAssetToTimeline(asset);
                            }}
                            title="拖拽到时间线，或双击快速添加"
                          >
                            <span className="asset-thumb">
                              {asset.type === 'image' ? (
                                <img src={'file:///' + asset.path.replace(/\\/g, '/').replace(/^\/+/, '')} alt={asset.name} style={{ pointerEvents: 'none' }} />
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
                          <div
                            key={asset.path}
                            className={`asset-row${selectedAssetPath === asset.path ? ' selected' : ''}`}
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.preventDefault();
                              setSelectedAssetPath(asset.path);
                              setDraggingAsset(asset);
                              setDragPos({ x: e.clientX, y: e.clientY });
                              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                            }}
                            onDoubleClick={() => {
                              void addAssetToTimeline(asset);
                            }}
                            title="拖拽到时间线，或双击快速添加"
                          >
                            {asset.type === 'image' ? (
                              <img src={'file:///' + asset.path.replace(/\\/g, '/').replace(/^\/+/, '')} alt={asset.name} style={{ width: 15, height: 15, objectFit: 'cover', borderRadius: 2, pointerEvents: 'none' }} />
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
              <div className="panel-tabs">
                <button onClick={() => { setAssetTab('my-assets'); setCenterTab('assets'); }}>My Assets</button>
                <button onClick={() => { setAssetTab('library'); setCenterTab('assets'); }}>Library</button>
                <button className="active" onClick={() => setCenterTab('canvas')}>Canvas</button>
                <button onClick={() => { setAssetTab('transcript'); setCenterTab('assets'); }}>Transcript</button>
              </div>
              <div className="canvas-toolbar">
                <button className="tb-primary" onClick={createBlankCanvas} disabled={!project}><Icon name="plus" size={13} /> New canvas</button>
                {canvas && (
                  <>
                    <button className="ibtn" title="Back" onClick={() => { setCenterTab('canvas'); setCanvas(null); setCanvasExpanded(false); }}><Icon name="chevronLeft" size={15} /></button>
                    <CanvasName key={viewKey} name={canvas.name} fallback={`Canvas ${Math.max(1, canvases.findIndex(item => item.id === canvas.id) + 1)}`}
                      onRename={name => renameCanvas(canvas.id, name)} />
                    <button className="ibtn" title={canvasExpanded ? 'Shrink' : 'Expand'} onClick={() => setCanvasExpanded(!canvasExpanded)}><Icon name={canvasExpanded ? 'fit' : 'expand'} size={15} /></button>
                    <select value={newNodeType} onChange={(event) => setNewNodeType(event.target.value)}>
                      {Object.entries(nodeLabels).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
                    </select>
                    <button className="tb-text" onClick={() => void addNode(newNodeType).catch(error => addLog(String(error)))} disabled={!canvas}>Add node</button>
                    <button className="tb-text" onClick={() => renderCanvas(false)} disabled={!canvas}>Render</button>
                    <button className="tb-text accent" onClick={() => renderCanvas(true)} disabled={!canvas}>Force render</button>
                    <button className="tb-text canvas-delete-action" onClick={() => void deleteCanvas(canvas.id)} disabled={!!deletingCanvas}>删除画布</button>
                  </>
                )}
              </div>
              <div className="canvas-body">
                {canvasDeleteError && <div className="canvas-delete-error" role="alert">{canvasDeleteError}<button onClick={() => setCanvasDeleteError('')} aria-label="关闭提示">×</button></div>}
                {canvas ? (
                  <CanvasGraphView
                    key={viewKey}
                    canvas={canvas}
                    projectPath={viewProjectPath}
                    assets={assets}
                    canvases={canvases}
                    onConnect={connectCanvasNodes}
                    onRemoveNode={removeNode}
                    onRemoveEdge={removeEdge}
                    onUpdateNodeParams={updateNodeParams}
                    onAddNode={addNode}
                    config={config}
                  />
                ) : canvases.length > 0 ? (
                  <div className="canvas-grid">
                    {canvases.map((item, index) => (
                      <div key={item.id} className="canvas-card-wrap">
                      <button className="canvas-card" aria-label={`打开画布 ${item.name || `Canvas ${index + 1}`}`} onClick={() => openCanvas(item.id)}>
                        <span className="canvas-card-icon"><Icon name="share" size={16} /></span>
                        <span className="canvas-card-title" aria-hidden="true">{item.name || `Canvas ${index + 1}`}</span>
                        <span className="canvas-card-meta">{item.nodeCount} nodes</span>
                      </button>
                      <CanvasName key={`${projectKey(viewProjectPath)}:${item.id}`} name={item.name} fallback={`Canvas ${index + 1}`} onRename={name => renameCanvas(item.id, name)} />
                      <button className="canvas-card-delete" aria-label={`删除 ${item.name || `Canvas ${index + 1}`}`} title="删除画布" disabled={!!deletingCanvas} onClick={() => void deleteCanvas(item.id)}>
                        {deletingCanvas === item.id ? '删除中…' : '删除'}
                      </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state-static">
                    <Icon name="spark" size={40} />
                    <p className="empty-title">No canvas yet</p>
                    <p className="empty-sub">Create a canvas to start building your flow.</p>
                    <button className="empty-cta" onClick={createBlankCanvas}><Icon name="plus" size={13} /> New canvas</button>
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

        <Player
          previewAsset={previewAsset}
          timelineMode={timelineMode}
          timeline={timeline}
          width={project?.settings?.width ?? 1920}
          height={project?.settings?.height ?? 1080}
          playing={playing}
          playheadMs={playheadMs}
          speed={speed}
          looping={looping}
          duration={duration}
          videoRef={videoRef}
          audioRef={audioRef}
          onToggle={toggle}
          onGoToStart={goToStart}
          onGoToEnd={goToEnd}
          onStepBack={stepBack}
          onStepForward={stepForward}
          onSetSpeed={setSpeed}
          onToggleLoop={toggleLoop}
          fileUrl={fileUrl}
          fps={project?.settings?.fps ?? 30}
        />

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
              <button className="ibtn" title="Go to start" onClick={goToStart}><Icon name="skipBack" size={14} /></button>
              <button className={`ibtn ${playing ? 'active' : ''}`} title="Play / pause" onClick={toggle}>
                <Icon name={playing ? 'pause' : 'play'} size={14} />
              </button>
              <button className="ibtn" title="Go to end" onClick={goToEnd}><Icon name="skipFwd" size={14} /></button>
              <span className="tl-sep" />
              <button className={`ibtn ${snapOn ? 'active' : ''}`} title="Snapping" onClick={() => setSnapOn(!snapOn)}><Icon name="magnet" size={15} /></button>
              <button className={`ibtn ${razorMode ? 'active' : ''}`} title="Razor" onClick={() => setRazorMode(!razorMode)}><Icon name="scissors" size={14} /></button>
              <button className="ibtn" title="Unlink"><Icon name="unlink" size={14} /></button>
              <button className="ibtn" title="Marker"><Icon name="marker" size={14} /></button>
            </div>
            <button className="tb-text" onClick={async () => {
              try { await invoke('timeline.refresh-canvases', { path: projectPath }); await refreshTimeline(); }
              catch (error) { addLog(String(error)); }
            }}>Update canvas clips</button>
            <div className="tl-time">{formatTimelineTime(playheadMs, project?.settings?.fps ?? 30)} / {formatTimelineTime(duration, project?.settings?.fps ?? 30)}</div>
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
            onRemoveClip={removeTimelineClip}
            onSplitClip={splitTimelineClip}
            onTrimClip={trimTimelineClip}
            onRemoveTrack={removeTimelineTrack}
            onDropAsset={(asset, trackId, startMs) => {
              void addAssetToTimeline(asset, startMs, trackId);
            }}
            draggingAsset={draggingAsset}
            dragPos={dragPos}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            zoom={zoom}
            playheadMs={playheadMs}
            onSeek={seek}
            razorMode={razorMode}
            fps={project?.settings?.fps ?? 30}
          />
        </footer>
      </div>

      {draggingAsset && (
        <div
          className="drag-ghost"
          style={{ left: dragPos.x + 15, top: dragPos.y + 15 }}
        >
          {draggingAsset.name}
        </div>
      )}

      {settingsOpen && (
        <div className="settings-overlay">
          <div className="settings-modal">
            <h2>设置</h2>
            <ModelApiTransfer settings={runtimeSettings} disabled={settingsSaving}
              onImport={values => setRuntimeSettings(current => ({ ...current, ...values }))} />
            <h3 className="settings-section-title">图像与视频生成 · 火山方舟</h3>
            <p className="settings-help">模型和服务地址保存到当前项目。视频模型需支持图生视频，并在你的账号下可用。</p>
            <label>ARK Base URL <input value={runtimeSettings.arkBaseUrl} placeholder="https://ark.cn-beijing.volces.com/api/v3" onChange={(event) => setRuntimeSettings({ ...runtimeSettings, arkBaseUrl: event.target.value })} /></label>
            <label>ARK API Key <input type="password" value={runtimeSettings.arkApiKey} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, arkApiKey: event.target.value })} /></label>
            <label>图像模型 / Image Model <input value={runtimeSettings.arkImageModel} placeholder="图像模型或接入点 ID" onChange={(event) => setRuntimeSettings({ ...runtimeSettings, arkImageModel: event.target.value })} /></label>
            <label>视频模型 / Video Model <input value={runtimeSettings.arkVideoModel} placeholder="支持图生视频的模型或接入点 ID" onChange={(event) => setRuntimeSettings({ ...runtimeSettings, arkVideoModel: event.target.value })} /></label>
            <h3 className="settings-section-title">图片上传 · TOS</h3>
            <p className="settings-help">本地图片需要上传后交给视频模型读取。存储桶、地域和 Endpoint 应相互匹配。</p>
            <label>TOS Access Key ID <input value={runtimeSettings.tosAccessKeyId} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosAccessKeyId: event.target.value })} /></label>
            <label>TOS Access Key Secret <input type="password" value={runtimeSettings.tosAccessKeySecret} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosAccessKeySecret: event.target.value })} /></label>
            <label>TOS Bucket <input value={runtimeSettings.tosBucket} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosBucket: event.target.value })} /></label>
            <label>TOS Region <input value={runtimeSettings.tosRegion} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosRegion: event.target.value })} /></label>
            <label>TOS Endpoint <input value={runtimeSettings.tosEndpoint} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, tosEndpoint: event.target.value })} /></label>
            <h3 className="settings-section-title">成片导出</h3>
            <label>FFmpeg path <input value={runtimeSettings.ffmpegPath} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, ffmpegPath: event.target.value })} /></label>
            <h3 className="settings-section-title">Agent 对话</h3>
            <label>Agent Base URL <input value={runtimeSettings.agentBaseUrl} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, agentBaseUrl: event.target.value })} /></label>
            <label>Agent API Key <input type="password" value={runtimeSettings.agentApiKey} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, agentApiKey: event.target.value })} /></label>
            <label>Agent Model <input value={runtimeSettings.agentModel} onChange={(event) => setRuntimeSettings({ ...runtimeSettings, agentModel: event.target.value })} /></label>
            <RuntimeSettings projectPath={projectPath} />
            {settingsError && <div className="agent-error" role="alert">{settingsError}</div>}
            <div className="settings-actions">
              <button onClick={saveRuntimeSettings} disabled={settingsSaving}>{settingsSaving ? '保存中…' : '保存'}</button>
              <button onClick={() => setSettingsOpen(false)} disabled={settingsSaving}>取消</button>
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="settings-overlay" onClick={() => setExportOpen(false)}>
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Export</h2>
            <label>Width <input type="number" value={exportWidth} onChange={(e) => setExportWidth(Number(e.target.value))} /></label>
            <label>Height <input type="number" value={exportHeight} onChange={(e) => setExportHeight(Number(e.target.value))} /></label>
            <label>FPS <input type="number" value={exportFps} onChange={(e) => setExportFps(Number(e.target.value))} /></label>
            <label>Quality (CRF, lower=better) <input type="number" min={0} max={51} value={exportCrf} onChange={(e) => setExportCrf(Number(e.target.value))} /></label>
            <div className="settings-actions">
              <button className="btn-export" onClick={exportTimeline}>Export to {projectPath}\export.mp4</button>
              <button onClick={() => setExportOpen(false)}>Cancel</button>
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
