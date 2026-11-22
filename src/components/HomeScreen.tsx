import React, { useRef, useState } from 'react';
import {
  BookOpen,
  Clock,
  Copy,
  Download,
  Film,
  FolderOpen,
  Home,
  Layers,
  Music,
  Play,
  Plus,
  Scissors,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import type { AutoScaleMode, FifilmProject, SequenceSettings } from '../types/editor';

interface HomeScreenProps {
  projects: FifilmProject[];
  activeProjectId: string;
  onCreateProjectWithOptions: (opts: {
    name: string;
    sequencePatch: Partial<SequenceSettings>;
    initialFiles: File[];
  }) => void;
  onOpenProject: (id: string) => void;
  onDuplicateProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
  onExportProjectFile: (id: string) => void;
  onImportProjectFile: (file: File) => void;
}

const RES_OPTIONS: Array<{ id: string; label: string; w: number; h: number }> = [
  { id: '1080p', label: '1080p HD (1920x1080)', w: 1920, h: 1080 },
  { id: '4k', label: '4K UHD (3840x2160)', w: 3840, h: 2160 },
  { id: 'vertical', label: 'Vertical 9:16 (1080x1920)', w: 1080, h: 1920 },
  { id: 'square', label: 'Square 1:1 (1080x1080)', w: 1080, h: 1080 },
  { id: '720p', label: '720p HD (1280x720)', w: 1280, h: 720 },
];

const TUTORIAL_CHAPTERS: Array<{
  id: string;
  title: string;
  icon: React.ReactNode;
  summary: string;
  steps: Array<{ heading: string; body: string }>;
}> = [
  {
    id: 'start',
    title: '1. Starting & Importing',
    icon: <FolderOpen size={14} />,
    summary: 'Create a blank project, pick your sequence size, and drop in video or music.',
    steps: [
      {
        heading: 'Start clean with zero test clips',
        body: 'Every new project starts completely empty. Pick a name, resolution (1080p, 4K, Vertical 9:16), and frame rate on the Home Screen, and optionally attach your starting clips right before clicking Create Project.',
      },
      {
        heading: 'Automatic 1080p to 4K scaling',
        body: 'Auto-Fit scaling is enabled by default. Drop a 1080p clip onto a 4K sequence and Fifilm automatically scales it to 200% to fill the frame, or drops a 4K clip on a 1080p sequence to 50%. Change resolution anytime by clicking the resolution pill (e.g. 1080p 24fps) in the top bar.',
      },
      {
        heading: 'Adding more clips later',
        body: 'Drag and drop MP4, MOV, MKV, WebM, WAV, FLAC, or MP3 files directly onto the Program Monitor, or click Media / Music in the top bar. Use the Source Monitor in the left rail to mark In and Out points before Inserting (,) or Overwriting (.) onto the timeline.',
      },
    ],
  },
  {
    id: 'editing',
    title: '2. Cutting & Timeline Tools',
    icon: <Scissors size={14} />,
    summary: 'Cut cleanly, ripple trim at the playhead, drag fades, and right-click for everything.',
    steps: [
      {
        heading: '15-Tool Editing Strip',
        body: 'Docked on the left of the timeline: Selection (V), Track Select Forward (A), Ripple Edit (Shift+R), Rolling Edit (Shift+E), Rate Stretch (R), Razor (C), Slip (Y), Slide (U), Pen/Rectangle/Ellipse Shapes, Hand (H), Zoom (Z), Type (T), and Vertical Type (Shift+T).',
      },
      {
        heading: 'Fast Playhead Trimming & Precision Shortcuts',
        body: 'Press B or Ctrl+K to split at the playhead. Press Q to ripple trim the previous edit to the playhead, or W to ripple trim the next edit. Use Alt+Left/Right to nudge a clip 1 frame (add Shift for 5 frames), Alt+Up/Down to move tracks, F for Match Frame to Source Monitor, and Space / J-K-L or the JOG wheel to scrub.',
      },
      {
        heading: 'Easy On-Clip Fades & Right-Click Menu',
        body: 'Grab the small white circle handles on the top-left or top-right corner of any video or audio clip and drag inward for instant smooth fade-ins and fade-outs. Right-click any clip or gap to Cut, Copy, Paste Attributes, Link/Group, Nest, Add Markers, Color Label, Close Gaps, Remove Through Edits (//), or Reveal in Explorer.',
      },
    ],
  },
  {
    id: 'layers',
    title: '3. Layers, Blends, Masks & Keyframes',
    icon: <Layers size={14} />,
    summary: 'Stack titles, shapes, adjustment layers, blend modes, masks, and animated motion.',
    steps: [
      {
        heading: 'Multi-Layer Stacking & Blend Modes',
        body: 'Higher tracks composite over lower tracks in real time on the GPU. Add Titles (T), Vertical Type (Shift+T), Shapes, or Adjustment Layers from the Project Panel or Tools Strip, then switch Blend Mode in the Motion tab to Screen, Difference, Overlay, Multiply, Add, Soft Light, and more.',
      },
      {
        heading: 'Shape, HSL & Luminance Masks',
        body: 'In the Motion tab, isolate parts of any layer with Rectangle, Ellipse, Pen, HSL Color Key, or Luminance Masks with adjustable feather and invert.',
      },
      {
        heading: 'Smooth Keyframes & Basic 3D',
        body: 'Click the diamond icon next to Scale, Position, Rotation, Opacity, 3D Swivel/Tilt, Exposure, Blur, or Speed to add keyframes at the playhead. Move the playhead and adjust values again to animate smoothly with Ease In/Out, Linear, or Hold curves.',
      },
    ],
  },
  {
    id: 'color',
    title: '4. Colour, 3D LUTs & GPU FX',
    icon: <Sliders size={14} />,
    summary: 'Grade with wheels, curves, stacked colorstudies LUTs, scopes, and 115+ effects and transitions.',
    steps: [
      {
        heading: 'Primary, Curves, Levels & 3-Way Wheels',
        body: 'Open the Color tab for Exposure, Contrast, Highlights/Shadows, White Balance, RGB Color Balance, HLS Hue/Lightness, Gamma, Levels, Luma/RGB Curves, Lift/Gamma/Gain wheels, Split Toning, and organic Film Grain. Hold \\ or enable Split Wipe to compare Before and After.',
      },
      {
        heading: 'Stacked 3D LUTs from colorstudies',
        body: 'Open the LUTs tab to browse your automatically indexed colorstudies library (.cube and .bin). Stack up to 6 LUTs with tetrahedral interpolation, drag to reorder, adjust per-LUT intensity, or bake your entire grade back into a new .cube file.',
      },
      {
        heading: '83 GPU Video Effects & 33 Transitions',
        body: 'Open the Effects & Presets panel on the left rail to search and apply Film Halation, Pro-Mist Bloom, Lens Flare, Advanced Lightning, Ultra Key green screen, Kaleidoscope, Wave Warp, Mosaic, Emboss, Broadcast Colors, and 33 real-time transitions (Cross Dissolve, Clock Wipe, Iris Round, Cube Spin, Page Peel, and more).',
      },
    ],
  },
  {
    id: 'stab',
    title: '5. Video Stabilization',
    icon: <Waves size={14} />,
    summary: 'Remove camera shake with two-pass libvidstab Smooth Motion or Tripod Lock.',
    steps: [
      {
        heading: 'Smooth Motion vs No Motion',
        body: 'Select a shaky video clip and open the Stab tab. Choose Smooth Motion to keep intentional pans and walks silky like a gimbal, or No Motion to lock the camera still like a tripod.',
      },
      {
        heading: 'Fine-Tune & Verify Before/After',
        body: 'Adjust Smoothness, Strength, Auto-Crop Zoom (to avoid black edges), and Rolling Shutter handling, then click Analyze & Stabilize. Toggle Split Wipe or Hold to Compare to verify the stabilized shot immediately, and it carries cleanly into your final export.',
      },
    ],
  },
  {
    id: 'audio',
    title: '6. Audio Auto-Mix & Beat Sync',
    icon: <Music size={14} />,
    summary: 'Blend cut songs seamlessly, snap cuts to beats, and mix with real-time DSP effects.',
    steps: [
      {
        heading: 'Auto-Mix Seamless Song Cuts',
        body: 'Cut out the part of a song you do not want (leaving 2+ clips on your audio track), then click Auto-Mix on the timeline toolbar or in the Audio tab. Fifilm closes gaps, overlaps the edit seam by a musical beat-matched window, applies equal-power Crossfade curves, and RMS-matches loudness so the two sections blend smoothly with zero pops.',
      },
      {
        heading: 'Beat & Transient Timeline Sync',
        body: 'Importing music automatically detects BPM, downbeats, and sharp transients. Turn on Beat Grid and Magnetic Snapping (N) to lock video cuts to musical hits, or click Align to auto-align selected cuts to the nearest beat within your chosen millisecond tolerance.',
      },
      {
        heading: 'Essential Sound, 46 Audio FX & Loudness Radar',
        body: 'Use one-click Essential Sound presets (Dialogue, Music, SFX, Ambience), 5-Band EQ, DeEsser, DeHummer, DeNoise, Compressors, Delay, Chorus/Flanger/Phaser, Studio/Surround/Convolution Reverb, Ambisonics spatial panner, Audio Clip & Track Mixers, and the live LUFS / LRA Loudness Radar.',
      },
    ],
  },
  {
    id: 'export',
    title: '7. Export, Auto-Save & Projects',
    icon: <Download size={14} />,
    summary: 'Render with GPU encoders, save multiple projects, and protect work with auto-save.',
    steps: [
      {
        heading: 'Hardware GPU Video & Audio Export',
        body: 'Click Export in the top-right to choose presets like Web / YouTube 4K (H.264 NVENC), ProRes 422 HQ Master, Social Vertical 9:16, HEVC Archive, or Studio WAV Audio. Your colour grade, LUT stack, stabilization, audio fades, and music mix are baked cleanly into the output.',
      },
      {
        heading: 'Multiple Projects & Auto-Save',
        body: 'Fifilm automatically saves your project and sequence at your chosen interval (configurable in Settings). Switch between projects anytime from the top-left project menu or return to this Home Screen, and export portable .fifilm project files to share or back up.',
      },
    ],
  },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({
  projects,
  activeProjectId,
  onCreateProjectWithOptions,
  onOpenProject,
  onDuplicateProject,
  onDeleteProject,
  onExportProjectFile,
  onImportProjectFile,
}) => {
  const [section, setSection] = useState<'home' | 'guide'>('home');
  const [activeChapterId, setActiveChapterId] = useState<string>(TUTORIAL_CHAPTERS[0].id);

  // New Project form state
  const [projectName, setProjectName] = useState(`Project ${projects.length + 1}`);
  const [resId, setResId] = useState<string>('1080p');
  const [fps, setFps] = useState<number>(24);
  const [autoScale, setAutoScale] = useState<AutoScaleMode>('fit');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const mediaPickerRef = useRef<HTMLInputElement | null>(null);
  const projectImportRef = useRef<HTMLInputElement | null>(null);

  const activeChapter =
    TUTORIAL_CHAPTERS.find((c) => c.id === activeChapterId) || TUTORIAL_CHAPTERS[0];

  const handleQueueFiles = (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter(
      (f) =>
        f.type.startsWith('video/') ||
        f.type.startsWith('audio/') ||
        /\.(mp4|mov|mkv|webm|m4v|avi|wav|flac|mp3|ogg|aac|m4a)$/i.test(f.name)
    );
    if (incoming.length > 0) {
      setQueuedFiles((prev) => [...prev, ...incoming]);
    }
  };

  const handleStartNewProject = (e: React.FormEvent) => {
    e.preventDefault();
    const res = RES_OPTIONS.find((r) => r.id === resId) || RES_OPTIONS[0];
    onCreateProjectWithOptions({
      name: projectName.trim() || `Project ${projects.length + 1}`,
      sequencePatch: {
        name: `${projectName.trim() || 'Sequence'} 01`,
        width: res.w,
        height: res.h,
        fps,
        autoScaleMedia: autoScale,
      },
      initialFiles: queuedFiles,
    });
  };

  return (
    <div className="home-screen">
      <input
        ref={mediaPickerRef}
        type="file"
        accept="video/*,audio/*,.mp4,.mov,.mkv,.webm,.m4v,.wav,.flac,.mp3"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            handleQueueFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={projectImportRef}
        type="file"
        accept=".fifilm,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            onImportProjectFile(f);
            e.target.value = '';
          }
        }}
      />

      <header className="home-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h1 className="wordmark" style={{ fontSize: 20, margin: 0 }}>
            Fifilm
          </h1>
          <nav className="home-nav">
            <button
              type="button"
              className={section === 'home' ? 'active' : 'subtle'}
              onClick={() => setSection('home')}
            >
              <Home size={13} />
              Home &amp; Projects
            </button>
            <button
              type="button"
              className={section === 'guide' ? 'active' : 'subtle'}
              onClick={() => setSection('guide')}
            >
              <BookOpen size={13} />
              Guide &amp; Tutorial
            </button>
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="subtle"
            onClick={() => projectImportRef.current?.click()}
          >
            <Upload size={13} />
            Open .fifilm File
          </button>
          {projects.length > 0 && (
            <button
              type="button"
              className="primary"
              onClick={() => onOpenProject(activeProjectId || projects[0].id)}
            >
              <Play size={13} />
              Resume Last Project
            </button>
          )}
        </div>
      </header>

      <main className="home-body">
        {section === 'home' && (
          <div className="home-grid">
            {/* LEFT: New Project + Optional Import Footage */}
            <section className="home-card">
              <div className="home-card-head">
                <div>
                  <h2>New Project</h2>
                  <p>Start with an empty timeline or attach your starting clips right away.</p>
                </div>
              </div>

              <form onSubmit={handleStartNewProject} className="home-form">
                <label className="field-group">
                  <span>Project Name</span>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="My Film Edit"
                  />
                </label>

                <div className="modal-grid">
                  <label className="field-group">
                    <span>Sequence Resolution</span>
                    <select value={resId} onChange={(e) => setResId(e.target.value)}>
                      {RES_OPTIONS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-group">
                    <span>Frame Rate</span>
                    <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                      <option value={23.976}>23.976 fps (Cinema)</option>
                      <option value={24}>24 fps (Film)</option>
                      <option value={25}>25 fps (PAL)</option>
                      <option value={30}>30 fps (Web / Social)</option>
                      <option value={60}>60 fps (High Motion)</option>
                    </select>
                  </label>
                </div>

                <label className="field-group">
                  <span>Auto-Scale Mismatched Footage (1080p &lt;-&gt; 4K)</span>
                  <select
                    value={autoScale}
                    onChange={(e) => setAutoScale(e.target.value as AutoScaleMode)}
                  >
                    <option value="fit">Auto Fit to Frame Size (Recommended)</option>
                    <option value="fill">Auto Fill (Cover Frame)</option>
                    <option value="none">Native 100% (No Auto Scaling)</option>
                  </select>
                </label>

                {/* Optional Import Footage Dropzone */}
                <div
                  className={`home-dropzone ${dragOver ? 'drag-over' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    if (e.dataTransfer.files?.length) handleQueueFiles(e.dataTransfer.files);
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <strong style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                        Import Footage (Optional)
                      </strong>
                      <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 2 }}>
                        Drop videos or music here, or leave empty to start blank.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ghost-sm"
                      onClick={() => mediaPickerRef.current?.click()}
                    >
                      <FolderOpen size={12} />
                      Choose Files
                    </button>
                  </div>

                  {queuedFiles.length > 0 && (
                    <div className="home-queued-list">
                      {queuedFiles.map((f, idx) => (
                        <div key={`${f.name}-${idx}`} className="home-queued-item">
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.name}
                          </span>
                          <button
                            type="button"
                            className="subtle icon-btn"
                            onClick={() => setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))}
                            title="Remove file"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button type="submit" className="primary" style={{ width: '100%', padding: '10px 14px' }}>
                  <Plus size={14} />
                  {queuedFiles.length > 0
                    ? `Create Project & Import ${queuedFiles.length} File${queuedFiles.length > 1 ? 's' : ''}`
                    : 'Create Empty Project'}
                </button>
              </form>
            </section>

            {/* RIGHT: Recent Projects + Quick Guide Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <section className="home-card" style={{ flex: 1 }}>
                <div className="home-card-head">
                  <div>
                    <h2>Recent Projects ({projects.length})</h2>
                    <p>Pick up where you left off. All projects open clean with only your saved clips.</p>
                  </div>
                </div>

                {projects.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--mute)' }}>
                    No recent projects yet. Create your first project on the left.
                  </p>
                ) : (
                  <div className="home-recent-list">
                    {projects.map((p) => {
                      const seq = p.sequence || { width: 1920, height: 1080, fps: 24 };
                      return (
                        <div key={p.id} className="home-project-row">
                          <button
                            type="button"
                            className="home-project-main"
                            onClick={() => onOpenProject(p.id)}
                          >
                            <div className="home-project-icon">
                              <Film size={15} />
                            </div>
                            <div style={{ minWidth: 0, textAlign: 'left' }}>
                              <div className="home-project-name">{p.name}</div>
                              <div className="home-project-meta">
                                <span>{seq.width}x{seq.height} {seq.fps}fps</span>
                                <span>{p.clips.length} clip{p.clips.length === 1 ? '' : 's'}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                  <Clock size={10} />
                                  {new Date(p.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </button>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              type="button"
                              className="ghost-sm primary"
                              onClick={() => onOpenProject(p.id)}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              className="subtle icon-btn"
                              onClick={() => onDuplicateProject(p.id)}
                              title="Duplicate project"
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              type="button"
                              className="subtle icon-btn"
                              onClick={() => onExportProjectFile(p.id)}
                              title="Export .fifilm file"
                            >
                              <Download size={12} />
                            </button>
                            <button
                              type="button"
                              className="subtle icon-btn"
                              disabled={projects.length <= 1}
                              onClick={() => onDeleteProject(p.id)}
                              title="Delete project"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Quick Guide Banner Card */}
              <section className="home-card home-guide-cta">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={14} /> New to Fifilm? Read the Quick Tutorial
                    </h3>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--mute)' }}>
                      7 short, plain-English guides covering editing, fades, Auto-Mix song blending, 3D LUTs, stabilization, and 4K auto-scaling.
                    </p>
                  </div>
                  <button type="button" className="primary" onClick={() => setSection('guide')}>
                    <BookOpen size={13} />
                    Open Guide
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}

        {/* EASY-TO-READ GUIDE & TUTORIAL VIEW */}
        {section === 'guide' && (
          <div className="guide-layout">
            <aside className="guide-sidebar">
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 6px 8px' }}>
                Fifilm Tutorial
              </div>
              {TUTORIAL_CHAPTERS.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className={`guide-nav-btn ${activeChapter.id === ch.id ? 'active' : ''}`}
                  onClick={() => setActiveChapterId(ch.id)}
                >
                  {ch.icon}
                  <span>{ch.title}</span>
                </button>
              ))}

              <div className="guide-shortcuts-box">
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
                  Essential Keys
                </div>
                <div className="guide-key-row"><span>Play / Pause</span><kbd>Space</kbd></div>
                <div className="guide-key-row"><span>Split at Playhead</span><kbd>B</kbd></div>
                <div className="guide-key-row"><span>Ripple Trim Prev / Next</span><kbd>Q / W</kbd></div>
                <div className="guide-key-row"><span>Magnetic Snap</span><kbd>N</kbd></div>
                <div className="guide-key-row"><span>Match Frame</span><kbd>F</kbd></div>
                <div className="guide-key-row"><span>Add Title</span><kbd>T</kbd></div>
                <div className="guide-key-row"><span>Hold Before / After</span><kbd>\</kbd></div>
              </div>
            </aside>

            <section className="home-card guide-content">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 19 }}>{activeChapter.title}</h2>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--mute)' }}>{activeChapter.summary}</p>
                </div>
                <button type="button" className="ghost-sm" onClick={() => setSection('home')}>
                  Back to Projects
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeChapter.steps.map((st, idx) => (
                  <div key={st.heading} className="guide-step-card">
                    <div className="guide-step-num">{idx + 1}</div>
                    <div>
                      <h4>{st.heading}</h4>
                      <p>{st.body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
                <button
                  type="button"
                  disabled={TUTORIAL_CHAPTERS.findIndex((c) => c.id === activeChapter.id) === 0}
                  onClick={() => {
                    const idx = TUTORIAL_CHAPTERS.findIndex((c) => c.id === activeChapter.id);
                    if (idx > 0) setActiveChapterId(TUTORIAL_CHAPTERS[idx - 1].id);
                  }}
                >
                  Previous Lesson
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const idx = TUTORIAL_CHAPTERS.findIndex((c) => c.id === activeChapter.id);
                    if (idx < TUTORIAL_CHAPTERS.length - 1) {
                      setActiveChapterId(TUTORIAL_CHAPTERS[idx + 1].id);
                    } else {
                      setSection('home');
                    }
                  }}
                >
                  {TUTORIAL_CHAPTERS.findIndex((c) => c.id === activeChapter.id) <
                  TUTORIAL_CHAPTERS.length - 1
                    ? 'Next Lesson'
                    : 'Start Editing'}
                </button>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};
