import type {
  BeatAnalysisResult,
  ExportRequest,
  HardwareCapabilities,
  LutLibraryEntry,
  ParsedLut3D,
  StabilizationEngine,
  StabilizationFrameTransform,
  StabilizationMode,
} from '../types/editor';
import { parseColorstudiesBinLut, parseCubeLut } from '../engine/cubeParser';

interface ElectronFifilmApi {
  isElectron: boolean;
  getPathForFile?(file: File): string;
  getCapabilities(): Promise<HardwareCapabilities>;
  listLuts(): Promise<LutLibraryEntry[]>;
  readLut(filePath: string): Promise<{ format: 'cube' | 'colorstudies-bin'; text?: string; base64?: string }>;
  saveLutToColorstudies(name: string, content: string): Promise<LutLibraryEntry>;
  stabilizeVideo(params: {
    inputPath: string;
    mode: StabilizationMode;
    engine: StabilizationEngine;
    smoothness: number;
    strength: number;
    autoCropZoom: number;
    rollingShutter: number;
  }): Promise<{
    engineUsed: string;
    stabilizedFilePath: string;
    trajectory: StabilizationFrameTransform[];
    message: string;
  }>;
  onStabilizeProgress?(cb: (data: { progress: number; stage: string }) => void): () => void;
  exportVideo(req: ExportRequest): Promise<{
    outputPath: string;
    encoderUsed: string;
    elapsedMs: number;
  }>;
  extractWaveform(filePath: string): Promise<number[]>;
  analyzeBeats(filePath: string): Promise<BeatAnalysisResult>;
  stageMedia?(fileName: string, bytes: Uint8Array): Promise<string>;
  pickVideoFiles(): Promise<string[]>;
  pickExportPath(defaultName: string): Promise<string | null>;
}

declare global {
  interface Window {
    fifilm?: ElectronFifilmApi;
  }
}

const lutCache = new Map<string, ParsedLut3D>();

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

export function resolveLocalFilePath(file: File): string | undefined {
  if (window.fifilm?.getPathForFile) {
    const p = window.fifilm.getPathForFile(file);
    if (p) return p;
  }
  const legacy = (file as File & { path?: string }).path;
  return legacy || undefined;
}

/**
 * Stages a browser File blob to local temp cache when running in Vite dev mode
 * so real FFmpeg libvidstab stabilization & multi-track export work identically
 * in both browser preview and Electron .exe desktop builds.
 */
export async function stageFileToDiskIfNeeded(file: File): Promise<string | undefined> {
  const existing = resolveLocalFilePath(file);
  if (existing) return existing;

  try {
    const buf = await file.arrayBuffer();
    if (window.fifilm?.stageMedia) {
      return await window.fifilm.stageMedia(file.name, new Uint8Array(buf));
    }
    const res = await fetch(`/api/fifilm/stage-media?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.filePath as string;
  } catch {
    return undefined;
  }
}

export async function fetchCapabilities(): Promise<HardwareCapabilities> {
  if (window.fifilm) return window.fifilm.getCapabilities();
  const res = await fetch('/api/fifilm/capabilities');
  if (!res.ok) throw new Error('Failed to probe hardware capabilities');
  return res.json();
}

export async function fetchLutLibrary(): Promise<LutLibraryEntry[]> {
  if (window.fifilm) return window.fifilm.listLuts();
  const res = await fetch('/api/fifilm/luts');
  if (!res.ok) throw new Error('Failed to scan colorstudies LUT library');
  return res.json();
}

export async function loadParsedLut(entry: {
  id: string;
  name: string;
  filePath: string;
  format: 'cube' | 'colorstudies-bin';
}): Promise<ParsedLut3D> {
  const cached = lutCache.get(entry.id);
  if (cached) return cached;

  let payload: { format: 'cube' | 'colorstudies-bin'; text?: string; base64?: string };
  if (window.fifilm) {
    payload = await window.fifilm.readLut(entry.filePath);
  } else {
    const res = await fetch('/api/fifilm/lut-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: entry.filePath }),
    });
    if (!res.ok) throw new Error(`Failed to load LUT "${entry.name}"`);
    payload = await res.json();
  }

  let parsed: ParsedLut3D;
  if (payload.format === 'cube' && payload.text) {
    parsed = parseCubeLut(payload.text, entry.id, entry.name);
  } else if (payload.base64) {
    parsed = await parseColorstudiesBinLut(base64ToArrayBuffer(payload.base64), entry.id, entry.name);
  } else {
    throw new Error(`Unsupported LUT payload for "${entry.name}"`);
  }

  lutCache.set(entry.id, parsed);
  return parsed;
}

export function getCachedLutMap(): Map<string, ParsedLut3D> {
  return lutCache;
}

export async function saveNewCubeLut(name: string, cubeContent: string): Promise<LutLibraryEntry> {
  if (window.fifilm) return window.fifilm.saveLutToColorstudies(name, cubeContent);
  const res = await fetch('/api/fifilm/save-lut', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content: cubeContent }),
  });
  if (!res.ok) throw new Error('Failed to save .cube LUT to colorstudies');
  return res.json();
}

export async function runBackendStabilize(
  params: {
    inputPath: string;
    mode: StabilizationMode;
    engine: StabilizationEngine;
    smoothness: number;
    strength: number;
    autoCropZoom: number;
    rollingShutter: number;
  },
  onProgress?: (progress: number, stage: string) => void
) {
  if (window.fifilm) {
    const unsub = onProgress && window.fifilm.onStabilizeProgress
      ? window.fifilm.onStabilizeProgress((d) => onProgress(d.progress, d.stage))
      : undefined;
    try {
      const r = await window.fifilm.stabilizeVideo(params);
      return {
        ...r,
        previewUrl: `file:///${r.stabilizedFilePath.replace(/\\/g, '/')}`,
      };
    } finally {
      unsub?.();
    }
  }
  onProgress?.(25, 'Running two-pass libvidstab on backend...');
  const res = await fetch('/api/fifilm/stabilize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Stabilization failed' }));
    throw new Error(err.error || 'Stabilization failed');
  }
  const r = await res.json();
  onProgress?.(100, 'Stabilization ready');
  return {
    ...r,
    previewUrl: `/api/fifilm/media?path=${encodeURIComponent(r.stabilizedFilePath)}`,
  };
}

export async function runBackendBeatAnalysis(inputPath: string): Promise<BeatAnalysisResult> {
  if (window.fifilm) return window.fifilm.analyzeBeats(inputPath);
  const res = await fetch('/api/fifilm/analyze-beats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputPath }),
  });
  if (!res.ok) throw new Error('Beat analysis failed');
  return res.json();
}

export async function runBackendExport(req: ExportRequest) {
  if (window.fifilm) return window.fifilm.exportVideo(req);
  const res = await fetch('/api/fifilm/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Export failed' }));
    throw new Error(err.error || 'Export failed');
  }
  return res.json();
}
