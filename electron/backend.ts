import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type {
  BeatAnalysisResult,
  ExportRequest,
  HardwareCapabilities,
  LutLibraryEntry,
  StabilizationEngine,
  StabilizationFrameTransform,
  StabilizationMode,
} from '../src/types/editor';

const execFileAsync = promisify(execFile);

function getNodeRequire(): NodeRequire {
  if (typeof require === 'function') return require;
  return createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')).href);
}

export const COLORSTUDIES_ROOT =
  process.env.FIFILM_COLORSTUDIES_DIR || 'C:\\Users\\Avery\\Documents\\GitHub\\colorstudies';

export const CACHE_ROOT = path.join(os.tmpdir(), 'fifilm-cache');

/**
 * Resolves bundled native binaries (ffmpeg, ffprobe) reliably across:
 * 1. Packaged Windows Electron .exe (resources/app.asar.unpacked & resources/bin)
 * 2. Local development (node_modules/ffmpeg-static & ffprobe-static)
 * 3. System PATH fallback
 */
export function resolveBinaryPaths(): { ffmpegPath: string; ffprobePath: string } {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const platformDir = process.platform === 'win32' ? 'win32' : process.platform;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;

  const ffmpegCandidates: string[] = [];
  const ffprobeCandidates: string[] = [];

  // 1. Packaged Electron resources (unpacked from asar)
  if (resourcesPath) {
    ffmpegCandidates.push(
      path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', `ffmpeg${exeExt}`),
      path.join(resourcesPath, 'bin', `ffmpeg${exeExt}`)
    );
    ffprobeCandidates.push(
      path.join(
        resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'ffprobe-static',
        'bin',
        platformDir,
        process.arch,
        `ffprobe${exeExt}`
      ),
      path.join(resourcesPath, 'bin', `ffprobe${exeExt}`)
    );
  }

  // 2. Module resolution (rewriting app.asar -> app.asar.unpacked automatically)
  try {
    const req = getNodeRequire();
    const staticFfmpeg = req('ffmpeg-static') as string | null;
    if (staticFfmpeg) {
      ffmpegCandidates.push(staticFfmpeg.replace('app.asar', 'app.asar.unpacked'), staticFfmpeg);
    }
  } catch {
    // ignore
  }
  try {
    const req = getNodeRequire();
    const staticFfprobe = req('ffprobe-static') as { path?: string } | null;
    if (staticFfprobe?.path) {
      ffprobeCandidates.push(
        staticFfprobe.path.replace('app.asar', 'app.asar.unpacked'),
        staticFfprobe.path
      );
    }
  } catch {
    // ignore
  }

  // 3. CWD node_modules fallback
  ffmpegCandidates.push(path.join(process.cwd(), 'node_modules', 'ffmpeg-static', `ffmpeg${exeExt}`));
  ffprobeCandidates.push(
    path.join(
      process.cwd(),
      'node_modules',
      'ffprobe-static',
      'bin',
      platformDir,
      process.arch,
      `ffprobe${exeExt}`
    )
  );

  let ffmpegPath = 'ffmpeg';
  let ffprobePath = 'ffprobe';

  for (const cand of ffmpegCandidates) {
    if (cand && fsSync.existsSync(cand) && !cand.includes('app.asar' + path.sep)) {
      ffmpegPath = cand;
      break;
    }
  }
  for (const cand of ffprobeCandidates) {
    if (cand && fsSync.existsSync(cand) && !cand.includes('app.asar' + path.sep)) {
      ffprobePath = cand;
      break;
    }
  }

  return { ffmpegPath, ffprobePath };
}

export function resolveWorkerScript(scriptName: string): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates: string[] = [];
  if (resourcesPath) {
    candidates.push(
      path.join(resourcesPath, 'workers', scriptName),
      path.join(resourcesPath, 'app.asar.unpacked', 'workers', scriptName)
    );
  }
  candidates.push(
    path.resolve(process.cwd(), 'workers', scriptName),
    path.resolve(__dirname, '..', 'workers', scriptName)
  );
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return path.resolve(process.cwd(), 'workers', scriptName);
}

interface MediaProbeInfo {
  duration: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probeMediaFile(inputPath: string): Promise<MediaProbeInfo> {
  const { ffprobePath } = resolveBinaryPaths();
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', inputPath],
      { timeout: 10000 }
    );
    const json = JSON.parse(stdout);
    const streams = (json.streams || []) as Array<{ codec_type?: string; width?: number; height?: number }>;
    const vStream = streams.find((s) => s.codec_type === 'video');
    const aStream = streams.find((s) => s.codec_type === 'audio');
    const dur = parseFloat(json.format?.duration || '0');
    return {
      duration: Number.isFinite(dur) && dur > 0 ? dur : 0,
      width: vStream?.width || 1920,
      height: vStream?.height || 1080,
      hasVideo: !!vStream,
      hasAudio: !!aStream,
    };
  } catch {
    return { duration: 0, width: 1920, height: 1080, hasVideo: true, hasAudio: false };
  }
}

function parseFfmpegTimeSec(line: string): number | null {
  const m = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

function runFfmpegWithProgress(params: {
  ffmpegPath: string;
  args: string[];
  cwd?: string;
  durationSec?: number;
  onProgress?: (ratio01: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(params.ffmpegPath, params.args, {
      cwd: params.cwd,
      windowsHide: true,
    });
    let stderrTail = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderrTail = (stderrTail + text).slice(-2500);
      if (params.onProgress && params.durationSec && params.durationSec > 0) {
        const t = parseFfmpegTimeSec(text);
        if (t !== null) {
          params.onProgress(Math.max(0, Math.min(1, t / params.durationSec)));
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to launch FFmpeg (${params.ffmpegPath}): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const lines = stderrTail
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(-6)
          .join(' | ');
        reject(new Error(`FFmpeg exited with code ${code}: ${lines || 'Unknown error'}`));
      }
    });
  });
}

let cachedCaps: HardwareCapabilities | null = null;

export async function probeHardwareCapabilities(): Promise<HardwareCapabilities> {
  if (cachedCaps) return cachedCaps;

  const { ffmpegPath, ffprobePath } = resolveBinaryPaths();
  let ffmpegAvailable = false;
  let vidstabAvailable = false;
  let lut3dAvailable = false;
  let hwaccels: string[] = [];
  const encoders = {
    h264Nvenc: false,
    hevcNvenc: false,
    h264Qsv: false,
    h264Amf: false,
    h264Videotoolbox: false,
    h264Vaapi: false,
    prores: false,
    libx264: false,
    libx265: false,
  };

  try {
    const [filtersRes, hwRes, encRes] = await Promise.all([
      execFileAsync(ffmpegPath, ['-hide_banner', '-filters'], { timeout: 6000, windowsHide: true }),
      execFileAsync(ffmpegPath, ['-hide_banner', '-hwaccels'], { timeout: 6000, windowsHide: true }),
      execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], { timeout: 6000, windowsHide: true }),
    ]);
    ffmpegAvailable = true;
    const fOut = filtersRes.stdout;
    vidstabAvailable = fOut.includes('vidstabdetect') && fOut.includes('vidstabtransform');
    lut3dAvailable = fOut.includes('lut3d');

    hwaccels = hwRes.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.toLowerCase().startsWith('hardware acceleration'));

    const eOut = encRes.stdout;
    encoders.h264Nvenc = eOut.includes('h264_nvenc');
    encoders.hevcNvenc = eOut.includes('hevc_nvenc');
    encoders.h264Qsv = eOut.includes('h264_qsv');
    encoders.h264Amf = eOut.includes('h264_amf');
    encoders.h264Videotoolbox = eOut.includes('h264_videotoolbox');
    encoders.h264Vaapi = eOut.includes('h264_vaapi');
    encoders.prores = eOut.includes('prores_ks');
    encoders.libx264 = eOut.includes('libx264');
    encoders.libx265 = eOut.includes('libx265');
  } catch {
    ffmpegAvailable = false;
  }

  let pythonAvailable = false;
  let opencvAvailable = false;
  let librosaAvailable = false;
  try {
    const pyRes = await execFileAsync(
      'python',
      [
        '-c',
        'import importlib.util as u; print("CV2:" + str(bool(u.find_spec("cv2"))), "LIBROSA:" + str(bool(u.find_spec("librosa"))))',
      ],
      { timeout: 4000, windowsHide: true }
    );
    pythonAvailable = true;
    opencvAvailable = pyRes.stdout.includes('CV2:True');
    librosaAvailable = pyRes.stdout.includes('LIBROSA:True');
  } catch {
    pythonAvailable = false;
  }

  let recommendedEncoder = 'libx264';
  if (encoders.h264Nvenc) recommendedEncoder = 'h264_nvenc';
  else if (encoders.h264Qsv) recommendedEncoder = 'h264_qsv';
  else if (encoders.h264Amf) recommendedEncoder = 'h264_amf';
  else if (encoders.h264Videotoolbox) recommendedEncoder = 'h264_videotoolbox';

  cachedCaps = {
    ffmpegAvailable,
    ffmpegPath,
    ffprobePath,
    vidstabAvailable,
    lut3dAvailable,
    pythonAvailable,
    opencvAvailable,
    librosaAvailable,
    hwaccels,
    encoders,
    recommendedEncoder,
    colorstudiesPath: COLORSTUDIES_ROOT,
  };
  return cachedCaps;
}

function prettifyLutName(fileName: string): { name: string; pack: string; isLog: boolean } {
  const base = fileName.replace(/\.(cube|bin)$/i, '');
  const lower = base.toLowerCase();
  const isLog = lower.includes('log-to-rec') || lower.includes('log-2-to-rec') || lower.includes('log_to_rec');

  if (base.startsWith('Fifilm - ')) {
    return { name: base.replace(/^Fifilm - /, ''), pack: 'Fifilm Curated', isLog };
  }
  if (lower.startsWith('after-dark-')) {
    return {
      name: base.slice('after-dark-'.length).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      pack: 'After Dark',
      isLog,
    };
  }
  if (lower.startsWith('cinematic-v2-')) {
    return {
      name: base.slice('cinematic-v2-'.length).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      pack: 'Cinematic V2',
      isLog,
    };
  }
  if (lower.startsWith('warm-light-')) {
    return {
      name: base.slice('warm-light-'.length).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      pack: 'Warm Light',
      isLog,
    };
  }
  if (lower.startsWith('original-')) {
    return {
      name: base.slice('original-'.length).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      pack: 'Creative V1',
      isLog,
    };
  }
  return {
    name: base.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    pack: 'Colorstudies',
    isLog,
  };
}

export async function scanColorstudiesLuts(): Promise<LutLibraryEntry[]> {
  const entries: LutLibraryEntry[] = [];
  if (!fsSync.existsSync(COLORSTUDIES_ROOT)) return entries;

  async function walk(dir: string) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase();
        if (ext === '.cube' || ext === '.bin') {
          const stat = await fs.stat(full);
          const { name, pack, isLog } = prettifyLutName(item.name);
          const rel = path.relative(COLORSTUDIES_ROOT, full).replace(/\\/g, '/');
          entries.push({
            id: rel,
            name,
            fileName: item.name,
            filePath: full,
            pack,
            format: ext === '.cube' ? 'cube' : 'colorstudies-bin',
            isLogConversion: isLog,
            modifiedAt: stat.mtimeMs,
          });
        }
      }
    }
  }

  await walk(COLORSTUDIES_ROOT);
  entries.sort((a, b) => {
    if (a.format !== b.format) return a.format === 'cube' ? -1 : 1;
    if (a.pack !== b.pack) return a.pack.localeCompare(b.pack);
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export async function readLutFilePayload(
  lutFilePath: string
): Promise<{ format: 'cube' | 'colorstudies-bin'; text?: string; base64?: string }> {
  const resolved = path.resolve(lutFilePath);
  const ext = path.extname(resolved).toLowerCase();
  if (ext === '.cube') {
    const text = await fs.readFile(resolved, 'utf-8');
    return { format: 'cube', text };
  }
  const buf = await fs.readFile(resolved);
  return { format: 'colorstudies-bin', base64: buf.toString('base64') };
}

export async function saveCubeLutToColorstudies(
  name: string,
  cubeContent: string
): Promise<LutLibraryEntry> {
  const safeName = name.replace(/[<>:"/\\|?*]+/g, '').trim() || 'Fifilm Custom Look';
  const fileName = safeName.toLowerCase().endsWith('.cube') ? safeName : `${safeName}.cube`;
  const targetDir = path.join(COLORSTUDIES_ROOT, 'luts');
  await fs.mkdir(targetDir, { recursive: true });
  const filePath = path.join(targetDir, fileName);
  await fs.writeFile(filePath, cubeContent, 'utf-8');
  const rel = path.relative(COLORSTUDIES_ROOT, filePath).replace(/\\/g, '/');
  const meta = prettifyLutName(fileName);
  return {
    id: rel,
    name: meta.name,
    fileName,
    filePath,
    pack: meta.pack,
    format: 'cube',
    isLogConversion: meta.isLog,
    modifiedAt: Date.now(),
  };
}

export async function stageUploadedMedia(fileName: string, buffer: Buffer): Promise<string> {
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  const safe = fileName.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const target = path.join(CACHE_ROOT, `staged_${Date.now()}_${safe}`);
  await fs.writeFile(target, buffer);
  return target;
}

function parseVidstabTrf(trfText: string, width: number, height: number): StabilizationFrameTransform[] {
  const lines = trfText.split(/\r?\n/);
  const raw: Array<{ dx: number; dy: number; da: number }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('VID.STAB')) continue;
    const m = trimmed.match(/\(LM\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
    if (m) {
      raw.push({ dx: parseFloat(m[1]), dy: parseFloat(m[2]), da: parseFloat(m[3]) });
    } else {
      const nums = trimmed.split(/\s+/).map(Number).filter(Number.isFinite);
      if (nums.length >= 4) {
        raw.push({ dx: nums[1], dy: nums[2], da: nums[3] });
      }
    }
  }
  if (raw.length === 0) return [];
  return raw.map((r, i) => ({
    frame: i,
    dx: -r.dx / Math.max(1, width),
    dy: -r.dy / Math.max(1, height),
    da: -r.da,
    scale: 1.05,
  }));
}

export interface StabilizeJobParams {
  inputPath: string;
  mode: StabilizationMode;
  engine: StabilizationEngine;
  smoothness: number;
  strength: number;
  autoCropZoom: number;
  rollingShutter: number;
}

export interface StabilizeJobResult {
  engineUsed: string;
  stabilizedFilePath: string;
  trajectory: StabilizationFrameTransform[];
  message: string;
}

/**
 * Bulletproof two-pass FFmpeg libvidstab (or OpenCV optical-flow) stabilization.
 * Uses relative .trf filenames inside CACHE_ROOT cwd to eliminate Windows drive-colon
 * escaping glitches, streams real Pass 1 / Pass 2 progress, verifies outputs, and
 * cleans up temp .trf files reliably.
 */
export async function runVideoStabilization(
  params: StabilizeJobParams,
  onProgress?: (pct: number, stage: string) => void
): Promise<StabilizeJobResult> {
  if (!params.inputPath || !fsSync.existsSync(params.inputPath)) {
    throw new Error(`Input video file not found: ${params.inputPath}`);
  }

  const caps = await probeHardwareCapabilities();
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  const stamp = Date.now();
  const safeBase = path
    .basename(params.inputPath, path.extname(params.inputPath))
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40);

  const trfName = `stab_${safeBase}_${stamp}.trf`;
  const trfPath = path.join(CACHE_ROOT, trfName);
  const outPath = path.join(CACHE_ROOT, `stab_${safeBase}_${stamp}.mp4`);
  const trajJsonPath = path.join(CACHE_ROOT, `traj_${safeBase}_${stamp}.json`);

  const probe = await probeMediaFile(params.inputPath);
  if (!probe.hasVideo) {
    throw new Error('Selected file has no video stream to stabilize.');
  }

  // OpenCV optical-flow mode if explicitly requested and cv2 is installed
  if (params.engine === 'opencv' && caps.pythonAvailable && caps.opencvAvailable) {
    onProgress?.(10, 'Running OpenCV optical-flow tracking...');
    const workerScript = resolveWorkerScript('stabilizer.py');
    await execFileAsync(
      'python',
      [
        workerScript,
        '--input',
        params.inputPath,
        '--trajectory',
        trajJsonPath,
        '--output-video',
        outPath,
        '--smoothness',
        String(params.mode === 'lock' ? 999 : Math.round(params.smoothness)),
        '--strength',
        String(params.mode === 'lock' ? 1.0 : params.strength / 100),
        '--auto-crop',
        String(params.autoCropZoom),
        '--rolling-shutter',
        String(params.rollingShutter / 100),
      ],
      { timeout: 240000, windowsHide: true }
    );
    const parsed = JSON.parse(await fs.readFile(trajJsonPath, 'utf-8'));
    await fs.unlink(trajJsonPath).catch(() => {});
    onProgress?.(100, 'OpenCV stabilization complete');
    return {
      engineUsed: 'opencv-optical-flow',
      stabilizedFilePath: outPath,
      trajectory: parsed.trajectory || [],
      message: `${params.mode === 'lock' ? 'No Motion Tripod Lock' : 'Smooth Motion'} complete via OpenCV (${parsed.frames} frames).`,
    };
  }

  if (!caps.ffmpegAvailable || !caps.vidstabAvailable) {
    throw new Error(
      `FFmpeg libvidstab is unavailable (ffmpeg=${caps.ffmpegPath}, vidstab=${caps.vidstabAvailable}).`
    );
  }

  const shakiness = Math.max(1, Math.min(10, Math.round((params.strength / 100) * 8 + 2)));
  const smoothing = params.mode === 'lock' ? 0 : Math.max(1, Math.min(60, Math.round(params.smoothness)));
  const tripodArg = params.mode === 'lock' ? ':tripod=1' : '';
  const zoom = Math.max(0, Math.min(35, Math.round(params.autoCropZoom)));
  const optzoom = zoom > 0 ? 1 : 2; // 1 = optimal static zoom, 2 = adaptive zoom to prevent black borders

  try {
    // PASS 1: Motion vector analysis (uses relative trfName in CACHE_ROOT cwd)
    onProgress?.(4, 'Pass 1/2: Analyzing motion vectors (libvidstab)...');
    await runFfmpegWithProgress({
      ffmpegPath: caps.ffmpegPath,
      cwd: CACHE_ROOT,
      durationSec: probe.duration,
      args: [
        '-y',
        '-i',
        params.inputPath,
        '-vf',
        `vidstabdetect=shakiness=${shakiness}:accuracy=15${tripodArg}:result=${trfName}`,
        '-f',
        'null',
        '-',
      ],
      onProgress: (r) => onProgress?.(Math.round(5 + r * 43), 'Pass 1/2: Analyzing motion vectors...'),
    });

    if (!fsSync.existsSync(trfPath) || fsSync.statSync(trfPath).size === 0) {
      throw new Error('Pass 1 (vidstabdetect) did not produce motion transform data.');
    }

    // PASS 2: Transform, crop/auto-zoom, rolling-shutter gentle sharpening, clean H.264 render
    onProgress?.(50, 'Pass 2/2: Rendering stabilized video (bicubic transform)...');
    const vfTransform = [
      `vidstabtransform=input=${trfName}:smoothing=${smoothing}${tripodArg}:zoom=${zoom}:optzoom=${optzoom}:interpol=bicubic`,
      'unsharp=5:5:0.35:3:3:0.15',
    ].join(',');

    const pass2Args = [
      '-y',
      '-i',
      params.inputPath,
      '-vf',
      vfTransform,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '17',
      '-pix_fmt',
      'yuv420p',
      ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000'] : ['-an']),
      '-movflags',
      '+faststart',
      outPath,
    ];

    await runFfmpegWithProgress({
      ffmpegPath: caps.ffmpegPath,
      cwd: CACHE_ROOT,
      durationSec: probe.duration,
      args: pass2Args,
      onProgress: (r) => onProgress?.(Math.round(52 + r * 46), 'Pass 2/2: Transforming & encoding...'),
    });

    if (!fsSync.existsSync(outPath) || fsSync.statSync(outPath).size === 0) {
      throw new Error('Pass 2 (vidstabtransform) failed to write stabilized output video.');
    }

    let trajectory: StabilizationFrameTransform[] = [];
    try {
      const trfText = await fs.readFile(trfPath, 'utf-8');
      trajectory = parseVidstabTrf(trfText, probe.width, probe.height);
    } catch {
      trajectory = [];
    }

    onProgress?.(100, 'Stabilization ready');
    return {
      engineUsed: 'ffmpeg-libvidstab',
      stabilizedFilePath: outPath,
      trajectory,
      message:
        params.mode === 'lock'
          ? `No Motion tripod lock ready via libvidstab (zoom +${zoom}%).`
          : `Smooth Motion ready via libvidstab (smoothing ${smoothing}f, zoom +${zoom}%).`,
    };
  } finally {
    await fs.unlink(trfPath).catch(() => {});
  }
}

export async function analyzeBeatsOnDisk(inputPath: string): Promise<BeatAnalysisResult> {
  const caps = await probeHardwareCapabilities();
  if (!caps.pythonAvailable) {
    throw new Error('Python is required for disk-based beat analysis.');
  }
  const scriptPath = resolveWorkerScript('beat_analyzer.py');
  const { stdout } = await execFileAsync(
    'python',
    [scriptPath, '--input', inputPath, '--ffmpeg', caps.ffmpegPath],
    { timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  );
  return JSON.parse(stdout) as BeatAnalysisResult;
}

/**
 * Hardware-accelerated FFmpeg export with baked tetrahedral 3D LUT grading,
 * stabilized video source, and full multi-track sample-accurate audio mixing
 * (clip volumes, fade-in/fade-out envelopes, music tracks, master gain, brickwall limiter,
 * and optional -14 LUFS loudness normalization).
 */
export async function runHardwareExport(
  req: ExportRequest
): Promise<{ outputPath: string; encoderUsed: string; elapsedMs: number }> {
  const caps = await probeHardwareCapabilities();
  if (!caps.ffmpegAvailable) {
    throw new Error('FFmpeg binary not found.');
  }
  if (!req.inputPath || !fsSync.existsSync(req.inputPath)) {
    throw new Error(`Export source file not found: ${req.inputPath}`);
  }

  const t0 = Date.now();
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  await fs.mkdir(path.dirname(req.outputPath), { recursive: true });

  const sourceInput =
    req.stabilizedPath && fsSync.existsSync(req.stabilizedPath)
      ? req.stabilizedPath
      : req.inputPath;

  const probe = await probeMediaFile(sourceInput);
  const clipDur = req.durationSec > 0 ? req.durationSec : probe.duration || 10;
  const masterVol = req.masterVolume ?? 1.0;

  let bakedLutName: string | null = null;
  let bakedLutPath: string | null = null;
  if (req.bakedCubeContent && caps.lut3dAvailable && req.codec !== 'audio_wav' && req.codec !== 'audio_mp3') {
    bakedLutName = `export_grade_${t0}.cube`;
    bakedLutPath = path.join(CACHE_ROOT, bakedLutName);
    await fs.writeFile(bakedLutPath, req.bakedCubeContent, 'utf-8');
  }

  try {
    const args: string[] = ['-y'];
    // Input 0: primary video (and optional embedded audio)
    if (req.startSec > 0) args.push('-ss', req.startSec.toFixed(3));
    args.push('-i', sourceInput);
    if (req.durationSec > 0) args.push('-t', req.durationSec.toFixed(3));

    // Additional audio/music track inputs (1..K)
    const validAudioTracks = (req.audioTracks || []).filter(
      (t) => t.filePath && fsSync.existsSync(t.filePath) && t.volume > 0.001 && t.duration > 0.02
    );
    for (const at of validAudioTracks) {
      args.push('-i', at.filePath);
    }

    const filterParts: string[] = [];
    const isAudioOnly = req.codec === 'audio_wav' || req.codec === 'audio_mp3';

    // Video filter chain
    let videoMap = '0:v:0';
    if (!isAudioOnly) {
      const vFilters: string[] = [];
      if (req.resolution === '2160p') vFilters.push('scale=3840:2160:flags=lanczos');
      else if (req.resolution === '1080p') vFilters.push('scale=1920:1080:flags=lanczos');
      else if (req.resolution === '720p') vFilters.push('scale=1280:720:flags=lanczos');
      else if (req.resolution === 'vertical1080') {
        vFilters.push('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920');
      }
      if (bakedLutName) {
        vFilters.push(`lut3d=file=${bakedLutName}:interp=tetrahedral`);
      }
      if (vFilters.length > 0) {
        filterParts.push(`[0:v]${vFilters.join(',')}[vout]`);
        videoMap = '[vout]';
      }
    }

    // Multi-track Audio filtergraph (sample-rate normalized to 48kHz stereo, fades, volumes, amix + limiter)
    const audioLabels: string[] = [];
    if (req.audioFormat !== 'none') {
      const includePrimaryAudio =
        probe.hasAudio && !req.videoClipMuted && (req.videoClipVolume ?? 1) > 0.001;
      if (includePrimaryAudio) {
        const chain: string[] = [
          'aresample=48000:async=1',
          'aformat=channel_layouts=stereo',
          `volume=${(req.videoClipVolume ?? 1).toFixed(4)}`,
        ];
        if ((req.videoClipFadeIn ?? 0) > 0.01) {
          chain.push(`afade=t=in:st=0:d=${(req.videoClipFadeIn ?? 0).toFixed(3)}`);
        }
        if ((req.videoClipFadeOut ?? 0) > 0.01 && clipDur > (req.videoClipFadeOut ?? 0)) {
          const st = Math.max(0, clipDur - (req.videoClipFadeOut ?? 0));
          chain.push(`afade=t=out:st=${st.toFixed(3)}:d=${(req.videoClipFadeOut ?? 0).toFixed(3)}`);
        }
        filterParts.push(`[0:a]${chain.join(',')}[a_base]`);
        audioLabels.push('[a_base]');
      }

      validAudioTracks.forEach((at, i) => {
        const inputIdx = i + 1;
        const lbl = `[a_t${i}]`;
        const chain: string[] = [
          `atrim=start=${Math.max(0, at.sourceIn).toFixed(3)}:duration=${at.duration.toFixed(3)}`,
          'asetpts=PTS-STARTPTS',
          'aresample=48000:async=1',
          'aformat=channel_layouts=stereo',
          `volume=${at.volume.toFixed(4)}`,
        ];
        if (at.fadeIn > 0.01) {
          chain.push(`afade=t=in:st=0:d=${at.fadeIn.toFixed(3)}`);
        }
        if (at.fadeOut > 0.01 && at.duration > at.fadeOut) {
          chain.push(`afade=t=out:st=${Math.max(0, at.duration - at.fadeOut).toFixed(3)}:d=${at.fadeOut.toFixed(3)}`);
        }
        const delayMs = Math.max(0, Math.round(at.timelineStart * 1000));
        if (delayMs > 0) {
          chain.push(`adelay=${delayMs}|${delayMs}`);
        }
        filterParts.push(`[${inputIdx}:a]${chain.join(',')}${lbl}`);
        audioLabels.push(lbl);
      });
    }

    let audioMap: string | null = null;
    if (audioLabels.length > 0) {
      const masterChain: string[] = [];
      if (audioLabels.length > 1) {
        masterChain.push(`amix=inputs=${audioLabels.length}:duration=longest:normalize=0:dropout_transition=0`);
      }
      masterChain.push(`atrim=0:${clipDur.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
      if (Math.abs(masterVol - 1.0) > 0.005) {
        masterChain.push(`volume=${masterVol.toFixed(4)}`);
      }
      masterChain.push('alimiter=limit=0.95:attack=2:release=40');
      if (req.loudnessNormalize) {
        masterChain.push('loudnorm=I=-14:TP=-1.5:LRA=11');
      }
      filterParts.push(`${audioLabels.join('')}${masterChain.join(',')}[aout]`);
      audioMap = '[aout]';
    }

    if (filterParts.length > 0) {
      args.push('-filter_complex', filterParts.join(';'));
    }

    if (isAudioOnly) {
      if (!audioMap) {
        throw new Error('No active audio stream found to export.');
      }
      args.push('-map', audioMap, '-vn');
      if (req.codec === 'audio_wav') {
        args.push('-c:a', 'pcm_s24le', '-ar', '48000', req.outputPath);
      } else {
        args.push('-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '48000', req.outputPath);
      }
      await runFfmpegWithProgress({ ffmpegPath: caps.ffmpegPath, cwd: CACHE_ROOT, args });
      return {
        outputPath: req.outputPath,
        encoderUsed: req.codec === 'audio_wav' ? 'PCM 24-bit WAV' : 'MP3 320k',
        elapsedMs: Date.now() - t0,
      };
    }

    args.push('-map', videoMap);
    if (audioMap) {
      args.push('-map', audioMap);
    } else {
      args.push('-an');
    }

    if (req.fps > 0) args.push('-r', String(req.fps));

    let codecArgs: string[] = [];
    let encoderUsed = 'libx264';
    const useCrf = req.qualityMode === 'crf';

    if (req.codec === 'prores_4444' && caps.encoders.prores) {
      encoderUsed = 'prores_ks (4444)';
      codecArgs = ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le'];
    } else if (req.codec === 'prores' && caps.encoders.prores) {
      encoderUsed = 'prores_ks (422 HQ)';
      codecArgs = ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'];
    } else if (req.codec === 'hevc_hw' && caps.encoders.hevcNvenc) {
      encoderUsed = 'hevc_nvenc';
      codecArgs = useCrf
        ? ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-cq', String(req.crf), '-pix_fmt', 'yuv420p']
        : ['-c:v', 'hevc_nvenc', '-preset', 'p5', '-b:v', `${req.bitrateMbps}M`, '-pix_fmt', 'yuv420p'];
    } else if (req.codec === 'h264_hw' && caps.encoders.h264Nvenc) {
      encoderUsed = 'h264_nvenc';
      codecArgs = useCrf
        ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', String(req.crf), '-pix_fmt', 'yuv420p']
        : ['-c:v', 'h264_nvenc', '-preset', 'p5', '-b:v', `${req.bitrateMbps}M`, '-pix_fmt', 'yuv420p'];
    } else if (req.codec === 'h264_hw' && caps.encoders.h264Qsv) {
      encoderUsed = 'h264_qsv';
      codecArgs = ['-c:v', 'h264_qsv', '-b:v', `${req.bitrateMbps}M`, '-pix_fmt', 'nv12'];
    } else if (req.codec === 'h264_hw' && caps.encoders.h264Amf) {
      encoderUsed = 'h264_amf';
      codecArgs = ['-c:v', 'h264_amf', '-b:v', `${req.bitrateMbps}M`, '-pix_fmt', 'yuv420p'];
    } else {
      encoderUsed = 'libx264';
      codecArgs = useCrf
        ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(req.crf), '-pix_fmt', 'yuv420p']
        : ['-c:v', 'libx264', '-preset', 'medium', '-b:v', `${req.bitrateMbps}M`, '-pix_fmt', 'yuv420p'];
    }

    args.push(...codecArgs);

    if (audioMap) {
      if (req.audioFormat === 'pcm_24') {
        args.push('-c:a', 'pcm_s24le', '-ar', '48000');
      } else {
        args.push('-c:a', 'aac', '-b:a', req.audioFormat === 'aac_320' ? '320k' : '256k', '-ar', '48000');
      }
    }

    if (!req.outputPath.toLowerCase().endsWith('.mov')) {
      args.push('-movflags', '+faststart');
    }
    args.push(req.outputPath);

    try {
      await runFfmpegWithProgress({
        ffmpegPath: caps.ffmpegPath,
        cwd: CACHE_ROOT,
        durationSec: clipDur,
        args,
      });
    } catch (err) {
      if (encoderUsed.includes('nvenc') || encoderUsed.includes('qsv') || encoderUsed.includes('amf')) {
        const fallbackArgs = args
          .map((a) => (a === encoderUsed ? 'libx264' : a === '-cq' ? '-crf' : a))
          .filter((a) => a !== 'p5');
        const presetIdx = fallbackArgs.indexOf('-preset');
        if (presetIdx >= 0) fallbackArgs.splice(presetIdx + 1, 0, 'medium');
        encoderUsed = 'libx264 (fallback)';
        await runFfmpegWithProgress({
          ffmpegPath: caps.ffmpegPath,
          cwd: CACHE_ROOT,
          durationSec: clipDur,
          args: fallbackArgs,
        });
      } else {
        throw err;
      }
    }

    return {
      outputPath: req.outputPath,
      encoderUsed,
      elapsedMs: Date.now() - t0,
    };
  } finally {
    if (bakedLutPath) {
      await fs.unlink(bakedLutPath).catch(() => {});
    }
  }
}

export async function extractFfmpegWaveform(inputPath: string, buckets = 160): Promise<number[]> {
  const caps = await probeHardwareCapabilities();
  if (!caps.ffmpegAvailable) return [];

  return new Promise((resolve) => {
    const proc = spawn(
      caps.ffmpegPath,
      ['-i', inputPath, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'],
      { windowsHide: true }
    );
    const chunks: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => chunks.push(c));
    proc.on('close', () => {
      const buf = Buffer.concat(chunks);
      const totalSamples = Math.floor(buf.byteLength / 4);
      if (totalSamples === 0) return resolve([]);
      const step = Math.max(1, Math.floor(totalSamples / buckets));
      const peaks: number[] = [];
      let globalMax = 0.001;
      for (let i = 0; i < buckets; i++) {
        const start = i * step;
        const end = Math.min(totalSamples, start + step);
        let m = 0;
        for (let s = start; s < end; s += Math.max(1, Math.floor(step / 32))) {
          const v = Math.abs(buf.readFloatLE(s * 4));
          if (v > m) m = v;
        }
        peaks.push(m);
        if (m > globalMax) globalMax = m;
      }
      resolve(peaks.map((p) => Math.max(0.04, Math.min(1, p / globalMax))));
    });
    proc.on('error', () => resolve([]));
  });
}
