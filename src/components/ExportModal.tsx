import React, { useMemo, useState } from 'react';
import type {
  ExportAudioClipSpec,
  ExportAudioFormat,
  ExportResolution,
  HardwareCapabilities,
  MediaAsset,
  TimelineClip,
  TimelineTrack,
} from '../types/editor';
import { bakeGradeToCube } from '../engine/cubeParser';
import { getCachedLutMap, runBackendExport, saveNewCubeLut } from '../services/bridge';

interface ExportModalProps {
  clip: TimelineClip | null;
  asset: MediaAsset | null;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  assets: Map<string, MediaAsset>;
  masterVolume: number;
  masterMuted: boolean;
  capabilities: HardwareCapabilities | null;
  inPoint: number | null;
  outPoint: number | null;
  onClose: () => void;
  onLutSavedToColorstudies: () => void;
}

type PresetId = 'web_4k' | 'prores_master' | 'social_vertical' | 'hevc_archive' | 'audio_wav';

const DELIVERY_PRESETS: Array<{
  id: PresetId;
  title: string;
  desc: string;
  codec: 'h264_hw' | 'hevc_hw' | 'prores' | 'prores_4444' | 'h264_cpu' | 'audio_wav' | 'audio_mp3';
  resolution: ExportResolution;
  bitrateMbps: number;
  qualityMode: 'bitrate' | 'crf';
  crf: number;
  audioFormat: ExportAudioFormat;
  ext: string;
}> = [
  {
    id: 'web_4k',
    title: 'Web / YouTube 4K',
    desc: 'H.264 GPU 45 Mbps AAC 320k',
    codec: 'h264_hw',
    resolution: '2160p',
    bitrateMbps: 45,
    qualityMode: 'bitrate',
    crf: 18,
    audioFormat: 'aac_320',
    ext: '.mp4',
  },
  {
    id: 'prores_master',
    title: 'ProRes 422 HQ Master',
    desc: '10-bit 4:2:2 PCM 24-bit',
    codec: 'prores',
    resolution: 'source',
    bitrateMbps: 180,
    qualityMode: 'bitrate',
    crf: 14,
    audioFormat: 'pcm_24',
    ext: '.mov',
  },
  {
    id: 'social_vertical',
    title: 'Vertical 9:16 1080p',
    desc: '1080x1920 H.264 20 Mbps',
    codec: 'h264_hw',
    resolution: 'vertical1080',
    bitrateMbps: 20,
    qualityMode: 'bitrate',
    crf: 19,
    audioFormat: 'aac_320',
    ext: '.mp4',
  },
  {
    id: 'hevc_archive',
    title: 'HEVC 10-bit Archive',
    desc: 'H.265 GPU Constant Quality',
    codec: 'hevc_hw',
    resolution: 'source',
    bitrateMbps: 28,
    qualityMode: 'crf',
    crf: 19,
    audioFormat: 'aac_320',
    ext: '.mp4',
  },
  {
    id: 'audio_wav',
    title: 'Audio Master WAV',
    desc: '48 kHz 24-bit uncompressed',
    codec: 'audio_wav',
    resolution: 'source',
    bitrateMbps: 2,
    qualityMode: 'bitrate',
    crf: 18,
    audioFormat: 'pcm_24',
    ext: '.wav',
  },
];

export const ExportModal: React.FC<ExportModalProps> = ({
  clip,
  asset,
  clips,
  tracks,
  assets,
  masterVolume,
  masterMuted,
  capabilities,
  inPoint,
  outPoint,
  onClose,
  onLutSavedToColorstudies,
}) => {
  const baseName = (clip?.name || 'fifilm-export').replace(/\.[^.]+$/, '');
  const [preset, setPreset] = useState<PresetId>('web_4k');
  const [codec, setCodec] = useState<
    'h264_hw' | 'hevc_hw' | 'prores' | 'prores_4444' | 'h264_cpu' | 'audio_wav' | 'audio_mp3'
  >('h264_hw');
  const [resolution, setResolution] = useState<ExportResolution>('source');
  const [fps, setFps] = useState<number>(0);
  const [qualityMode, setQualityMode] = useState<'bitrate' | 'crf'>('bitrate');
  const [bitrateMbps, setBitrateMbps] = useState(36);
  const [crf, setCrf] = useState(18);
  const [audioFormat, setAudioFormat] = useState<ExportAudioFormat>('aac_320');
  const [loudnessNormalize, setLoudnessNormalize] = useState(false);
  const [useMarkedRange, setUseMarkedRange] = useState(inPoint !== null && outPoint !== null);
  const [outputPath, setOutputPath] = useState(`C:\\Users\\Avery\\Videos\\${baseName}_graded.mp4`);
  const [lutName, setLutName] = useState(`Fifilm - ${baseName}`);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const applyPreset = (id: PresetId) => {
    const p = DELIVERY_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setCodec(p.codec);
    setResolution(p.resolution);
    setBitrateMbps(p.bitrateMbps);
    setQualityMode(p.qualityMode);
    setCrf(p.crf);
    setAudioFormat(p.audioFormat);
    setOutputPath((prev) => prev.replace(/\.[^.]+$/, p.ext));
  };

  const durationSec = useMemo(() => {
    if (!clip) return 0;
    if (useMarkedRange && inPoint !== null && outPoint !== null && outPoint > inPoint) {
      return outPoint - inPoint;
    }
    return clip.duration;
  }, [clip, useMarkedRange, inPoint, outPoint]);

  const estimatedMb = useMemo(() => {
    if (durationSec <= 0) return '0.0';
    if (codec === 'audio_wav') return ((durationSec * 2.304) / 8).toFixed(1);
    if (codec === 'audio_mp3') return ((durationSec * 0.32) / 8).toFixed(1);
    const mbps = codec === 'prores_4444' ? 330 : codec === 'prores' ? 185 : bitrateMbps;
    return ((durationSec * mbps) / 8).toFixed(1);
  }, [durationSec, codec, bitrateMbps]);

  const handleBrowse = async () => {
    if (window.fifilm) {
      const picked = await window.fifilm.pickExportPath(outputPath);
      if (picked) setOutputPath(picked);
    }
  };

  const handleExportVideo = async () => {
    if (!clip || !asset) {
      setStatus('Select a clip on the timeline first.');
      return;
    }
    if (!asset.filePath) {
      setStatus(
        'This clip is a procedural sample without a local file path. Import a local video file in Electron mode for hardware FFmpeg render, or export the baked .cube LUT below.'
      );
      return;
    }
    setBusy(true);
    setStatus('Baking color grade and multi-LUT stack to tetrahedral .cube and encoding via FFmpeg...');
    try {
      const bakedCube = bakeGradeToCube(clip.name, clip.color, getCachedLutMap(), 33);
      const startSec =
        useMarkedRange && inPoint !== null
          ? Math.max(0, inPoint - clip.start + clip.sourceIn)
          : clip.sourceIn;
      const exportWindowStart = useMarkedRange && inPoint !== null ? inPoint : clip.start;
      const exportWindowEnd = exportWindowStart + durationSec;

      // Gather active audio/music tracks overlapping the export range (respecting mute/solo)
      const trackMap = new Map(tracks.map((t) => [t.id, t]));
      const anySolo = tracks.some((t) => t.kind === 'audio' && t.solo);
      const audioTracks: ExportAudioClipSpec[] = [];

      if (!masterMuted) {
        for (const c of clips) {
          if (c.id === clip.id || c.muted || c.volume <= 0.001) continue;
          const tr = trackMap.get(c.trackId);
          if (!tr || tr.muted) continue;
          if (tr.kind === 'audio' && anySolo && !tr.solo) continue;
          const a = assets.get(c.assetId);
          if (!a?.filePath || !a.hasAudio) continue;
          const overlapStart = Math.max(exportWindowStart, c.start);
          const overlapEnd = Math.min(exportWindowEnd, c.start + c.duration);
          if (overlapEnd <= overlapStart + 0.02) continue;

          audioTracks.push({
            filePath: a.filePath,
            timelineStart: Math.max(0, overlapStart - exportWindowStart),
            sourceIn: c.sourceIn + Math.max(0, overlapStart - c.start),
            duration: overlapEnd - overlapStart,
            volume: c.volume,
            fadeIn: c.fadeIn,
            fadeOut: c.fadeOut,
          });
        }
      }

      const res = await runBackendExport({
        inputPath: asset.filePath,
        outputPath,
        codec,
        qualityMode,
        bitrateMbps,
        crf,
        resolution,
        fps,
        audioFormat: masterMuted ? 'none' : audioFormat,
        loudnessNormalize,
        startSec,
        durationSec,
        masterVolume: masterMuted ? 0 : masterVolume,
        videoClipVolume: clip.volume,
        videoClipFadeIn: clip.fadeIn,
        videoClipFadeOut: clip.fadeOut,
        videoClipMuted: clip.muted,
        audioTracks,
        lutPaths: [],
        stabilizedPath: clip.stabilization.enabled ? clip.stabilization.stabilizedFilePath : undefined,
        bakedCubeContent: bakedCube,
      });
      setStatus(`Rendered via ${res.encoderUsed} in ${(res.elapsedMs / 1000).toFixed(1)}s to ${res.outputPath}`);
    } catch (err) {
      setStatus(`Export error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLut = async () => {
    if (!clip) return;
    setBusy(true);
    try {
      const cube = bakeGradeToCube(lutName, clip.color, getCachedLutMap(), 33);
      const saved = await saveNewCubeLut(lutName, cube);
      setStatus(`Saved 33³ .cube LUT to colorstudies: ${saved.filePath}`);
      onLutSavedToColorstudies();
    } catch (err) {
      setStatus(`Save LUT failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const isAudioOnly = codec === 'audio_wav' || codec === 'audio_mp3';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>
        <p className="status-note">
          Hardware engine: {capabilities?.ffmpegAvailable ? capabilities.recommendedEncoder : 'Unavailable'}
          {capabilities?.hwaccels.length ? ` (${capabilities.hwaccels.join(', ')})` : ''}
        </p>

        <div className="section-header" style={{ marginTop: 12 }}>
          <span>Delivery Presets</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--mute)' }}>
            Est. ~{estimatedMb} MB
          </span>
        </div>

        <div className="preset-grid">
          {DELIVERY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`preset-card ${preset === p.id ? 'active' : ''}`}
              onClick={() => applyPreset(p.id)}
            >
              <strong>{p.title}</strong>
              <span>{p.desc}</span>
            </button>
          ))}
        </div>

        <div className="form-grid">
          <label>Format / Codec</label>
          <select value={codec} onChange={(e) => setCodec(e.target.value as typeof codec)}>
            <option value="h264_hw">H.264 Hardware ({capabilities?.recommendedEncoder || 'GPU'})</option>
            <option value="hevc_hw">HEVC H.265 Hardware (NVENC)</option>
            <option value="prores">Apple ProRes 422 HQ (10-bit MOV)</option>
            <option value="prores_4444">Apple ProRes 4444 (10-bit MOV)</option>
            <option value="h264_cpu">H.264 Master (libx264 software)</option>
            <option value="audio_wav">Audio Only WAV (48 kHz 24-bit)</option>
            <option value="audio_mp3">Audio Only MP3 (320 kbps)</option>
          </select>

          {!isAudioOnly && (
            <>
              <label>Resolution</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as ExportResolution)}
              >
                <option value="source">Match Source</option>
                <option value="2160p">3840 x 2160 (4K UHD)</option>
                <option value="1080p">1920 x 1080 (Full HD)</option>
                <option value="720p">1280 x 720 (HD)</option>
                <option value="vertical1080">1080 x 1920 (9:16 Vertical)</option>
              </select>

              <label>Frame Rate</label>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={0}>Match Source</option>
                <option value={24}>24 fps</option>
                <option value={25}>25 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>

              {codec !== 'prores' && codec !== 'prores_4444' && (
                <>
                  <label>Rate Control</label>
                  <div className="seg-group" style={{ margin: 0 }}>
                    <button
                      type="button"
                      className={qualityMode === 'bitrate' ? 'active' : ''}
                      onClick={() => setQualityMode('bitrate')}
                    >
                      Target Bitrate
                    </button>
                    <button
                      type="button"
                      className={qualityMode === 'crf' ? 'active' : ''}
                      onClick={() => setQualityMode('crf')}
                    >
                      Constant Quality (CRF)
                    </button>
                  </div>

                  <label>{qualityMode === 'bitrate' ? 'Bitrate' : 'Quality (CRF)'}</label>
                  {qualityMode === 'bitrate' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="range"
                        min={6}
                        max={140}
                        step={2}
                        value={bitrateMbps}
                        onChange={(e) => setBitrateMbps(Number(e.target.value))}
                      />
                      <span className="mono" style={{ minWidth: 62, textAlign: 'right' }}>
                        {bitrateMbps} Mbps
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="range"
                        min={12}
                        max={28}
                        step={1}
                        value={crf}
                        onChange={(e) => setCrf(Number(e.target.value))}
                      />
                      <span className="mono" style={{ minWidth: 62, textAlign: 'right' }}>
                        CRF {crf}
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <label>Audio Stream</label>
          <select
            value={audioFormat}
            onChange={(e) => setAudioFormat(e.target.value as ExportAudioFormat)}
          >
            <option value="aac_320">AAC 320 kbps 48 kHz</option>
            <option value="aac_256">AAC 256 kbps 48 kHz</option>
            <option value="pcm_24">PCM 24-bit Uncompressed</option>
            <option value="none">No Audio</option>
          </select>

          <label>Loudness & Range</label>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={loudnessNormalize}
                onChange={(e) => setLoudnessNormalize(e.target.checked)}
              />
              Normalize -14 LUFS
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={useMarkedRange}
                disabled={inPoint === null || outPoint === null}
                onChange={(e) => setUseMarkedRange(e.target.checked)}
              />
              In/Out Range Only
            </label>
          </div>

          <label>Output File</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              style={{ flex: 1 }}
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
            />
            {window.fifilm && (
              <button type="button" onClick={handleBrowse}>
                Browse
              </button>
            )}
          </div>
        </div>

        <div className="section-header" style={{ marginTop: 14 }}>
          <span>Export Baked Grade to colorstudies (.cube)</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            style={{ flex: 1 }}
            value={lutName}
            onChange={(e) => setLutName(e.target.value)}
            placeholder="Fifilm - Custom Look"
          />
          <button type="button" disabled={busy || !clip} onClick={handleSaveLut}>
            Save .cube
          </button>
        </div>

        {status && (
          <p className="status-note" style={{ color: 'var(--ink)', marginTop: 10 }}>
            {status}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" disabled={busy || !clip} onClick={handleExportVideo}>
            {busy ? 'Rendering...' : 'Render Export'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const KeysModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const rows: Array<[string, string]> = [
    ['Space', 'Play / Pause'],
    ['J / K / L', 'Variable-speed shuttle (Reverse / Stop / Forward)'],
    ['Left / Right', 'Step 1 frame backward / forward'],
    ['Shift + Left / Right', 'Jump 10 frames'],
    ['N', 'Toggle magnetic timeline & beat snapping'],
    ['B  or  Ctrl + B', 'Razor split clip at playhead'],
    ['I / O', 'Mark Sequence In / Out points'],
    ['M', 'Add timeline marker at playhead'],
    ['Shift + V', 'Toggle View All Layers (fit all tracks)'],
    ['Shift + Z', 'Fit entire timeline horizontally'],
    ['Delete / Shift+Del', 'Delete / Ripple delete selected clip'],
    ['Ctrl + Scroll', 'Cursor-centered horizontal zoom (timeline or preview)'],
    ['\\ (Hold)', 'Hold to compare original ungraded frame'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / Redo'],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard Shortcuts</h2>
        <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
          {rows.map(([k, desc]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 10px',
                borderRadius: 4,
                background: 'var(--bg)',
              }}
            >
              <span className="mono" style={{ color: 'var(--acc)', fontSize: 12 }}>
                {k}
              </span>
              <span style={{ color: 'var(--mute)', fontSize: 12 }}>{desc}</span>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
