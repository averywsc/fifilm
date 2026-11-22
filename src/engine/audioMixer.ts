import type { AudioMeterReading, TimelineClip, TimelineTrack } from '../types/editor';

interface ActiveVoice {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * Sample-accurate Web Audio NLE mixer with per-clip gain, fade-in/fade-out envelopes,
 * track mute/solo routing, master fader, anti-pop ramps, brickwall limiter,
 * and live stereo Peak dBFS / momentary LUFS metering.
 */
export class FifilmAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private activeVoices: ActiveVoice[] = [];
  private masterVolume = 1.0;
  private masterMuted = false;
  private meterBufL = new Float32Array(1024);
  private meterBufR = new Float32Array(1024);
  private lufsEma = -60;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx({ latencyHint: 'interactive' });
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.masterMuted ? 0 : this.masterVolume;

    // Gentle broadcast true-peak brickwall limiter to prevent digital clipping
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.0;
    limiter.knee.value = 3.0;
    limiter.ratio.value = 20.0;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 1024;
    analyserR.fftSize = 1024;

    masterGain.connect(limiter);
    limiter.connect(ctx.destination);
    limiter.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    this.ctx = ctx;
    this.masterGain = masterGain;
    this.limiter = limiter;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    return ctx;
  }

  public async decodeAndStore(assetId: string, blob: Blob): Promise<AudioBuffer | null> {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    try {
      const arr = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arr.slice(0));
      this.buffers.set(assetId, decoded);
      return decoded;
    } catch {
      return null;
    }
  }

  public hasBuffer(assetId: string): boolean {
    return this.buffers.has(assetId);
  }

  public getBuffer(assetId: string): AudioBuffer | undefined {
    return this.buffers.get(assetId);
  }

  /**
   * Computes peak dBFS and recommended linear volume gain to normalize a clip
   * cleanly to targetPeakDb (default -1.0 dBFS).
   */
  public computeNormalizeVolume(assetId: string, targetPeakDb = -1.0): number | null {
    const buf = this.buffers.get(assetId);
    if (!buf) return null;
    let maxAbs = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < data.length; i += 4) {
        const a = Math.abs(data[i]);
        if (a > maxAbs) maxAbs = a;
      }
    }
    if (maxAbs < 1e-5) return 1.0;
    const targetLinear = Math.pow(10, targetPeakDb / 20);
    const gain = targetLinear / maxAbs;
    return Math.max(0.1, Math.min(2.0, Number(gain.toFixed(2))));
  }

  /**
   * Synthesizes a clean, warm 124 BPM ambient demo AudioBuffer for the starter
   * music clip so sample-accurate audio playback, beat sync, fades, mute/solo,
   * and live peak/LUFS meters work immediately out of the box.
   */
  public ensureSampleMusicBuffer(assetId: string, durationSec = 24, bpm = 124): void {
    if (this.buffers.has(assetId)) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    const sr = ctx.sampleRate;
    const length = Math.floor(sr * durationSec);
    const buf = ctx.createBuffer(2, length, sr);
    const left = buf.getChannelData(0);
    const right = buf.getChannelData(1);

    const period = 60 / bpm;
    // Deep mellow chord progression (Am9 -> Fmaj7 -> Dm9 -> Em7)
    const chords = [
      [110.0, 164.81, 220.0, 261.63, 329.63],
      [87.31, 130.81, 174.61, 220.0, 261.63],
      [73.42, 110.0, 146.83, 174.61, 220.0],
      [82.41, 123.47, 164.81, 196.0, 246.94],
    ];

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const beatPos = t / period;
      const beatFrac = beatPos - Math.floor(beatPos);
      const beatIdx = Math.floor(beatPos);
      const barIdx = Math.floor(beatIdx / 4);
      const chord = chords[barIdx % chords.length];

      // Subtle warm kick on every beat, slightly stronger on downbeats
      const kickEnv = Math.exp(-beatFrac * 16.0);
      const kickFreq = 48 + 75 * Math.exp(-beatFrac * 38.0);
      const kick = Math.sin(2 * Math.PI * kickFreq * (beatFrac * period)) * kickEnv * (beatIdx % 4 === 0 ? 0.36 : 0.25);

      // Soft percussive off-beat click/hat for crisp transient timing
      const halfFrac = (beatPos * 2) % 1;
      const hatEnv = Math.exp(-halfFrac * 42.0);
      const noise = Math.sin(i * 12.9898) * Math.cos(i * 78.233);
      const hat = beatIdx % 2 === 1 ? noise * hatEnv * 0.055 : 0;

      // Sidechained warm pad swell
      const sidechain = Math.min(1, beatFrac * 3.5);
      let padL = 0;
      let padR = 0;
      for (let c = 0; c < chord.length; c++) {
        const f = chord[c];
        const phase = 2 * Math.PI * f * t;
        padL += Math.sin(phase + c * 0.3) * 0.038;
        padR += Math.sin(phase * 1.0018 - c * 0.2) * 0.038;
      }

      const envEdge = Math.min(1, t * 4, Math.max(0, (durationSec - t) * 4));
      left[i] = Math.tanh((kick + hat + padL * sidechain) * envEdge);
      right[i] = Math.tanh((kick + hat * 0.85 + padR * sidechain) * envEdge);
    }

    this.buffers.set(assetId, buf);
  }

  public setMasterVolume(vol: number, muted: boolean): void {
    this.masterVolume = Math.max(0, Math.min(2, vol));
    this.masterMuted = muted;
    if (this.ctx && this.masterGain) {
      const target = muted ? 0 : this.masterVolume;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
    }
  }

  public stop(): void {
    const ctx = this.ctx;
    for (const v of this.activeVoices) {
      try {
        if (ctx) {
          const now = ctx.currentTime;
          v.gain.gain.cancelScheduledValues(now);
          v.gain.gain.setValueAtTime(v.gain.gain.value, now);
          v.gain.gain.linearRampToValueAtTime(0, now + 0.008);
          v.source.stop(now + 0.01);
        } else {
          v.source.stop();
        }
      } catch {
        // already stopped
      }
    }
    this.activeVoices = [];
  }

  /**
   * Starts sample-accurate playback of all audible clips from `playheadSec`
   * at playback rate `rate` (only forward rates > 0 emit audio).
   */
  public startPlayback(params: {
    playheadSec: number;
    rate: number;
    clips: TimelineClip[];
    tracks: TimelineTrack[];
  }): void {
    this.stop();
    if (params.rate <= 0) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const anySolo = params.tracks.some((t) => t.kind === 'audio' && t.solo);
    const trackMap = new Map(params.tracks.map((t) => [t.id, t]));
    const now = ctx.currentTime + 0.01; // 10ms lookahead for exact cross-track sync

    for (const clip of params.clips) {
      if (clip.muted || clip.volume <= 0.001) continue;
      const track = trackMap.get(clip.trackId);
      if (!track) continue;
      if (track.muted) continue;
      if (track.kind === 'audio' && anySolo && !track.solo) continue;

      const buf = this.buffers.get(clip.assetId);
      if (!buf) continue;

      const clipEnd = clip.start + clip.duration;
      if (clipEnd <= params.playheadSec) continue;

      const speedMul = (clip.color.effects.enabled ? clip.color.effects.speed : 1) * params.rate;
      const delayTimeline = Math.max(0, clip.start - params.playheadSec);
      const startWhen = now + delayTimeline / params.rate;
      const elapsedInClip = Math.max(0, params.playheadSec - clip.start);
      const sourceOffset = clip.sourceIn + elapsedInClip * (clip.color.effects.enabled ? clip.color.effects.speed : 1);
      if (sourceOffset >= buf.duration) continue;

      const remainingTimeline = clipEnd - Math.max(params.playheadSec, clip.start);
      const playRealSec = remainingTimeline / params.rate;
      if (playRealSec <= 0.01) continue;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.max(0.25, Math.min(4.0, speedMul));

      const gain = ctx.createGain();
      const targetGain = Math.max(0, Math.min(2.0, clip.volume));

      // Schedule sample-accurate anti-pop ramp + fade-in + fade-out envelopes
      const fadeIn = Math.max(0.005, Math.min(clip.fadeIn, clip.duration * 0.5));
      const fadeOut = Math.max(0.005, Math.min(clip.fadeOut, clip.duration * 0.5));

      const fadeInRemaining = Math.max(0, fadeIn - elapsedInClip);
      if (fadeInRemaining > 0.002) {
        const startRatio = elapsedInClip / Math.max(0.005, fadeIn);
        gain.gain.setValueAtTime(targetGain * startRatio, startWhen);
        gain.gain.linearRampToValueAtTime(targetGain, startWhen + fadeInRemaining / params.rate);
      } else {
        gain.gain.setValueAtTime(0, startWhen);
        gain.gain.linearRampToValueAtTime(targetGain, startWhen + 0.005);
      }

      const endWhen = startWhen + playRealSec;
      const fadeOutStartTimeline = clip.duration - fadeOut;
      const fadeOutRealStart =
        now + Math.max(0, clip.start + fadeOutStartTimeline - params.playheadSec) / params.rate;
      if (fadeOutRealStart < endWhen) {
        gain.gain.setValueAtTime(targetGain, Math.max(startWhen + 0.006, fadeOutRealStart));
        gain.gain.linearRampToValueAtTime(0.0001, endWhen);
      }

      src.connect(gain);
      gain.connect(this.masterGain);
      try {
        src.start(startWhen, sourceOffset, Math.min(buf.duration - sourceOffset, remainingTimeline * speedMul + 0.05));
        this.activeVoices.push({ clipId: clip.id, source: src, gain });
      } catch {
        // ignore invalid start offset
      }
    }
  }

  /** Live volume update for currently playing voices without restarting playback */
  public updateClipVolumeLive(clipId: string, volume: number, muted: boolean): void {
    if (!this.ctx) return;
    const target = muted ? 0 : Math.max(0, Math.min(2, volume));
    for (const v of this.activeVoices) {
      if (v.clipId === clipId) {
        v.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
      }
    }
  }

  public getMeters(isPlaying: boolean): AudioMeterReading {
    if (!isPlaying || !this.analyserL || !this.analyserR) {
      this.lufsEma = Math.max(-60, this.lufsEma - 3.5);
      return {
        peakLeftDb: -60,
        peakRightDb: -60,
        lufs: Number(this.lufsEma.toFixed(1)),
        clipping: false,
      };
    }

    this.analyserL.getFloatTimeDomainData(this.meterBufL);
    this.analyserR.getFloatTimeDomainData(this.meterBufR);

    let peakL = 0;
    let peakR = 0;
    let sumSq = 0;
    const n = this.meterBufL.length;
    for (let i = 0; i < n; i++) {
      const l = this.meterBufL[i];
      const r = this.meterBufR[i];
      const al = Math.abs(l);
      const ar = Math.abs(r);
      if (al > peakL) peakL = al;
      if (ar > peakR) peakR = ar;
      sumSq += 0.5 * (l * l + r * r);
    }

    const toDb = (lin: number) => (lin <= 1e-5 ? -60 : Math.max(-60, Math.min(0, 20 * Math.log10(lin))));
    const peakLeftDb = Number(toDb(peakL).toFixed(1));
    const peakRightDb = Number(toDb(peakR).toFixed(1));
    const rmsDb = toDb(Math.sqrt(sumSq / n));
    // Momentary LUFS approximation (~RMS - 0.691 dB K-weighting offset)
    const instLufs = Math.max(-60, rmsDb - 0.7);
    this.lufsEma = this.lufsEma * 0.72 + instLufs * 0.28;

    return {
      peakLeftDb,
      peakRightDb,
      lufs: Number(this.lufsEma.toFixed(1)),
      clipping: peakLeftDb >= -0.3 || peakRightDb >= -0.3,
    };
  }

  public dispose(): void {
    this.stop();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export function linearToDbLabel(vol: number): string {
  if (vol <= 0.001) return '-inf dB';
  const db = 20 * Math.log10(vol);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}
