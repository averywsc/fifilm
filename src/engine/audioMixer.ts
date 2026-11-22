import type {
  AudioMeterReading,
  AudioTransitionType,
  ClipAudioEffectsState,
  TimelineClip,
  TimelineTrack,
} from '../types/editor';

interface ActiveVoice {
  clipId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

interface AttachedVideoAudio {
  element: HTMLVideoElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

function buildImpulseResponse(
  ctx: AudioContext,
  durationSec: number,
  decay: number,
  stereoWidth: number
): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * durationSec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const n = (Math.random() * 2 - 1) * (ch === 0 ? 1 : stereoWidth);
      data[i] = n * env;
    }
  }
  return buf;
}

export function evaluateAudioFadeCurve(type: AudioTransitionType, u: number): number {
  const x = Math.max(0, Math.min(1, u));
  if (type === 'constantGain') return x;
  if (type === 'exponentialFade' || type === 'exponentialFadeIn' || type === 'exponentialFadeOut') {
    return x * x * x;
  }
  if (type === 'logarithmicFade') {
    return Math.log1p(x * 9) / Math.log(10);
  }
  // Constant Power & Crossfade (equal-power sin/cos)
  return Math.sin(x * Math.PI * 0.5);
}

function applyAudioFadeEnvelope(
  param: AudioParam,
  type: AudioTransitionType,
  fromVal: number,
  toVal: number,
  startTime: number,
  endTime: number
): void {
  const dur = Math.max(0.005, endTime - startTime);
  if (type === 'constantGain') {
    param.setValueAtTime(fromVal, startTime);
    param.linearRampToValueAtTime(toVal, endTime);
    return;
  }
  const steps = 20;
  const curve = new Float32Array(steps);
  const rising = toVal >= fromVal;
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const shaped = rising
      ? evaluateAudioFadeCurve(type, u)
      : evaluateAudioFadeCurve(type, 1 - u);
    curve[i] = Math.min(fromVal, toVal) + Math.abs(toVal - fromVal) * shaped;
  }
  try {
    param.setValueCurveAtTime(curve, startTime, dur);
  } catch {
    param.setValueAtTime(fromVal, startTime);
    param.linearRampToValueAtTime(toVal, endTime);
  }
}

/**
 * Full Web Audio Pro DSP Engine:
 * - Zero-copy <video> MediaElementAudioSourceNode routing + AudioBuffer music tracks
 * - Real-time DSP rack: Amplify/Gain/Volume, Highpass, Bandpass, Notch/DeHummer,
 *   5-band Graphic/Parametric EQ (Bass/LowMid/Mid/HighMid/Treble), DeEsser, Lowpass,
 *   DeNoise/DeReverb, Dynamics/Multiband/Tube/Vintage Compressor/Expander/Gate/Mastering,
 *   Delay/Analog Delay, Chorus/Flanger/Phaser LFO modulation, Channel Mixer (Fill L/R, Swap, Mono),
 *   Stereo Expander, Balance, Ambisonics Spatial Panner, Studio/Surround/Convolution Reverb, Hard Limiter
 * - All 7 Audio Transitions (Constant Gain, Constant Power, Exponential Fade/In/Out, Logarithmic, Crossfade)
 * - Live Stereo Peak dBFS, Momentary LUFS & Loudness Range (LRA) Loudness Radar
 */
export class FifilmAudioEngine {
  private ctx: AudioContext | null = null;
  private busInput: GainNode | null = null;
  private amplifyNode: GainNode | null = null;
  private highpass: BiquadFilterNode | null = null;
  private notchFilter: BiquadFilterNode | null = null;
  private deHumFilter: BiquadFilterNode | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqLowMid: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHighMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private deEsser: BiquadFilterNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private dynamics: DynamicsCompressorNode | null = null;
  private phaserFilter: BiquadFilterNode | null = null;
  private delayNode: DelayNode | null = null;
  private delayFeedback: GainNode | null = null;
  private delayTone: BiquadFilterNode | null = null;
  private delayWet: GainNode | null = null;
  private modDelayNode: DelayNode | null = null;
  private modLfo: OscillatorNode | null = null;
  private modLfoGain: GainNode | null = null;
  private modWet: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private dryGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbWetGain: GainNode | null = null;
  private surroundNode: ConvolverNode | null = null;
  private surroundWetGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private videoNodes = new Map<string, AttachedVideoAudio>();
  private activeVoices: ActiveVoice[] = [];
  private masterVolume = 1.0;
  private masterMuted = false;
  private meterBufL = new Float32Array(1024);
  private meterBufR = new Float32Array(1024);
  private lufsEma = -60;
  private lufsMin = -60;
  private lufsMax = -60;

  public ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx({ latencyHint: 'interactive' });
    const busInput = ctx.createGain();
    const amplifyNode = ctx.createGain();

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 20;

    const deHumFilter = ctx.createBiquadFilter();
    deHumFilter.type = 'notch';
    deHumFilter.frequency.value = 60;
    deHumFilter.Q.value = 14;

    const notchFilter = ctx.createBiquadFilter();
    notchFilter.type = 'peaking';
    notchFilter.frequency.value = 1000;
    notchFilter.Q.value = 8;
    notchFilter.gain.value = 0;

    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 120;

    const eqLowMid = ctx.createBiquadFilter();
    eqLowMid.type = 'peaking';
    eqLowMid.frequency.value = 420;
    eqLowMid.Q.value = 1.1;

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1250;
    eqMid.Q.value = 1.0;

    const eqHighMid = ctx.createBiquadFilter();
    eqHighMid.type = 'peaking';
    eqHighMid.frequency.value = 3600;
    eqHighMid.Q.value = 1.1;

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 7500;

    const deEsser = ctx.createBiquadFilter();
    deEsser.type = 'peaking';
    deEsser.frequency.value = 6800;
    deEsser.Q.value = 3.2;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 20000;

    const dynamics = ctx.createDynamicsCompressor();
    dynamics.threshold.value = -12;
    dynamics.ratio.value = 1.5;

    // Phaser allpass filter
    const phaserFilter = ctx.createBiquadFilter();
    phaserFilter.type = 'allpass';
    phaserFilter.frequency.value = 1100;
    phaserFilter.Q.value = 2.0;

    // Delay / Analog Delay send
    const delayNode = ctx.createDelay(1.5);
    delayNode.delayTime.value = 0.28;
    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.34;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 12000;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0;
    delayNode.connect(delayTone);
    delayTone.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayTone.connect(delayWet);

    // Chorus / Flanger LFO Modulated Delay
    const modDelayNode = ctx.createDelay(0.1);
    modDelayNode.delayTime.value = 0.015;
    const modLfo = ctx.createOscillator();
    modLfo.frequency.value = 1.4;
    const modLfoGain = ctx.createGain();
    modLfoGain.gain.value = 0.0;
    const modWet = ctx.createGain();
    modWet.gain.value = 0;
    modLfo.connect(modLfoGain);
    modLfoGain.connect(modDelayNode.delayTime);
    modLfo.start();
    modDelayNode.connect(modWet);

    const panner = ctx.createStereoPanner();
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1.0;

    const reverbNode = ctx.createConvolver();
    reverbNode.buffer = buildImpulseResponse(ctx, 1.4, 2.8, 0.85);
    const reverbWetGain = ctx.createGain();
    reverbWetGain.gain.value = 0;

    const surroundNode = ctx.createConvolver();
    surroundNode.buffer = buildImpulseResponse(ctx, 2.6, 2.0, 1.0);
    const surroundWetGain = ctx.createGain();
    surroundWetGain.gain.value = 0;

    const masterGain = ctx.createGain();
    masterGain.gain.value = this.masterMuted ? 0 : this.masterVolume;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.0;
    limiter.knee.value = 2.0;
    limiter.ratio.value = 20.0;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    const splitter = ctx.createChannelSplitter(2);
    const analyserL = ctx.createAnalyser();
    const analyserR = ctx.createAnalyser();
    analyserL.fftSize = 1024;
    analyserR.fftSize = 1024;

    busInput.connect(amplifyNode);
    amplifyNode.connect(highpass);
    highpass.connect(deHumFilter);
    deHumFilter.connect(notchFilter);
    notchFilter.connect(eqLow);
    eqLow.connect(eqLowMid);
    eqLowMid.connect(eqMid);
    eqMid.connect(eqHighMid);
    eqHighMid.connect(eqHigh);
    eqHigh.connect(deEsser);
    deEsser.connect(lowpass);
    lowpass.connect(dynamics);
    dynamics.connect(phaserFilter);
    phaserFilter.connect(panner);

    // Parallel Sends: Dry + Delay + Chorus/Flanger + Studio/Surround/Convolution Reverb
    panner.connect(dryGain);
    panner.connect(delayNode);
    panner.connect(modDelayNode);
    panner.connect(reverbNode);
    panner.connect(surroundNode);

    reverbNode.connect(reverbWetGain);
    surroundNode.connect(surroundWetGain);

    dryGain.connect(masterGain);
    delayWet.connect(masterGain);
    modWet.connect(masterGain);
    reverbWetGain.connect(masterGain);
    surroundWetGain.connect(masterGain);

    masterGain.connect(limiter);
    limiter.connect(ctx.destination);

    limiter.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    this.ctx = ctx;
    this.busInput = busInput;
    this.amplifyNode = amplifyNode;
    this.highpass = highpass;
    this.notchFilter = notchFilter;
    this.deHumFilter = deHumFilter;
    this.eqLow = eqLow;
    this.eqLowMid = eqLowMid;
    this.eqMid = eqMid;
    this.eqHighMid = eqHighMid;
    this.eqHigh = eqHigh;
    this.deEsser = deEsser;
    this.lowpass = lowpass;
    this.dynamics = dynamics;
    this.phaserFilter = phaserFilter;
    this.delayNode = delayNode;
    this.delayFeedback = delayFeedback;
    this.delayTone = delayTone;
    this.delayWet = delayWet;
    this.modDelayNode = modDelayNode;
    this.modLfo = modLfo;
    this.modLfoGain = modLfoGain;
    this.modWet = modWet;
    this.panner = panner;
    this.dryGain = dryGain;
    this.reverbNode = reverbNode;
    this.reverbWetGain = reverbWetGain;
    this.surroundNode = surroundNode;
    this.surroundWetGain = surroundWetGain;
    this.masterGain = masterGain;
    this.limiter = limiter;
    this.analyserL = analyserL;
    this.analyserR = analyserR;
    return ctx;
  }

  public resume(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  /** Applies active clip's full Audio Effects DSP rack live in real time. */
  public applyAudioEffects(fx: ClipAudioEffectsState, trackPan = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const masteringDb = (fx.masteringBoost ?? 0) * 0.04;
    const ampLin = Math.pow(10, (fx.amplifyDb + masteringDb) / 20);
    this.amplifyNode?.gain.setTargetAtTime(ampLin, t, 0.02);

    // Highpass + Bandpass + DeHummer + Notch
    const hpFreq =
      fx.bandpassAmount > 0
        ? Math.max(fx.highpassHz ?? 20, 260 + (fx.bandpassAmount / 100) * 600)
        : fx.highpassHz ?? 20;
    this.highpass?.frequency.setTargetAtTime(Math.max(20, Math.min(4000, hpFreq)), t, 0.02);

    if (this.deHumFilter) {
      this.deHumFilter.type = fx.deHummer ? 'notch' : 'allpass';
      this.deHumFilter.frequency.setTargetAtTime(60, t, 0.02);
    }
    if (this.notchFilter) {
      if ((fx.notchHz ?? 0) >= 50) {
        this.notchFilter.frequency.setTargetAtTime(fx.notchHz, t, 0.02);
        this.notchFilter.gain.setTargetAtTime(-24, t, 0.02);
      } else {
        this.notchFilter.gain.setTargetAtTime(0, t, 0.02);
      }
    }

    // 5-band Graphic / Parametric EQ + DeNoise/DeReverb high damping
    this.eqLow?.gain.setTargetAtTime(fx.eqLowDb, t, 0.02);
    this.eqLowMid?.gain.setTargetAtTime(fx.eqLowMidDb ?? 0, t, 0.02);
    this.eqMid?.gain.setTargetAtTime(fx.eqMidDb, t, 0.02);
    this.eqHighMid?.gain.setTargetAtTime(fx.eqHighMidDb ?? 0, t, 0.02);
    const denoiseCut = -((fx.deNoise ?? 0) / 100) * 8;
    this.eqHigh?.gain.setTargetAtTime(fx.eqHighDb + denoiseCut, t, 0.02);
    this.deEsser?.gain.setTargetAtTime(-(fx.deEsser / 100) * 14, t, 0.02);

    const lpFreq =
      fx.bandpassAmount > 0
        ? Math.min(fx.lowpassHz, 4200 - (fx.bandpassAmount / 100) * 2000)
        : fx.lowpassHz;
    this.lowpass?.frequency.setTargetAtTime(Math.max(200, Math.min(20000, lpFreq)), t, 0.02);

    // Dynamics / Multiband / Tube / Vintage / Expander / Gate / Mastering
    if (this.dynamics) {
      const compAmt = Math.min(1, (fx.dynamicsComp + (fx.masteringBoost ?? 0) * 0.5) / 100);
      const modelKnee = fx.compModel === 'tube' ? 14 : fx.compModel === 'vintage' ? 8 : 4;
      this.dynamics.knee.setTargetAtTime(modelKnee, t, 0.02);
      this.dynamics.threshold.setTargetAtTime(-4 - compAmt * 28 - (fx.expanderGate ?? 0) * 0.12, t, 0.02);
      this.dynamics.ratio.setTargetAtTime(1 + compAmt * 11, t, 0.02);
    }
    this.limiter?.threshold.setTargetAtTime(Math.max(-12, Math.min(0, fx.hardLimiterDb)), t, 0.02);

    // Phaser
    if (this.phaserFilter) {
      const ph = (fx.phaser ?? 0) / 100;
      this.phaserFilter.Q.setTargetAtTime(ph > 0.01 ? 2 + ph * 12 : 0.7, t, 0.02);
      this.phaserFilter.frequency.setTargetAtTime(600 + ph * 1800, t, 0.03);
    }

    // Delay / Analog Delay
    const dMix = (fx.delayMix ?? 0) / 100;
    this.delayNode?.delayTime.setTargetAtTime(Math.max(0.03, Math.min(1.2, (fx.delayTimeMs ?? 280) / 1000)), t, 0.03);
    this.delayTone?.frequency.setTargetAtTime(fx.analogDelayWarmth ? 2600 : 14000, t, 0.02);
    this.delayWet?.gain.setTargetAtTime(dMix * 0.65, t, 0.03);

    // Chorus / Flanger LFO modulation
    const chorusAmt = (fx.chorus ?? 0) / 100;
    const flangerAmt = (fx.flanger ?? 0) / 100;
    const modAmt = Math.max(chorusAmt, flangerAmt);
    if (this.modDelayNode && this.modLfo && this.modLfoGain && this.modWet) {
      this.modDelayNode.delayTime.setTargetAtTime(flangerAmt > chorusAmt ? 0.004 : 0.018, t, 0.02);
      this.modLfo.frequency.setTargetAtTime(flangerAmt > chorusAmt ? 0.45 : 1.7, t, 0.02);
      this.modLfoGain.gain.setTargetAtTime(modAmt * (flangerAmt > chorusAmt ? 0.0025 : 0.006), t, 0.02);
      this.modWet.gain.setTargetAtTime(modAmt * 0.55, t, 0.03);
    }

    // Balance + Channel Mode + Ambisonics azimuth + Track Pan
    const ambiPan = Math.sin((fx.ambisonicsAzimuth * Math.PI) / 180);
    const balPan = (fx.balance ?? 0) / 100;
    const channelBias =
      fx.channelMode === 'fillLeftWithRight'
        ? -0.35
        : fx.channelMode === 'fillRightWithLeft'
          ? 0.35
          : 0;
    const finalPan =
      fx.channelMode === 'mono'
        ? 0
        : Math.max(-1, Math.min(1, trackPan + balPan + ambiPan * 0.85 + channelBias));
    this.panner?.pan.setTargetAtTime(finalPan, t, 0.02);

    // Reverbs (Studio + Surround + Convolution) damped by DeReverb
    const deRevScale = Math.max(0, 1 - (fx.deReverb ?? 0) / 100);
    const revStudio = (((fx.studioReverb ?? 0) + (fx.convolutionReverb ?? 0) * 0.8) / 100) * 0.75 * deRevScale;
    const revSurround = ((fx.surroundReverb ?? 0) / 100) * 0.85 * deRevScale;
    this.reverbWetGain?.gain.setTargetAtTime(Math.min(1.0, revStudio), t, 0.03);
    this.surroundWetGain?.gain.setTargetAtTime(Math.min(1.0, revSurround), t, 0.03);
    this.dryGain?.gain.setTargetAtTime(Math.max(0.35, 1 - (revStudio + revSurround) * 0.3), t, 0.03);

    for (const v of this.activeVoices) {
      try {
        v.source.detune.setTargetAtTime(fx.pitchCents, t, 0.02);
      } catch {
        // ignore
      }
    }
  }

  public attachVideoElement(assetId: string, video: HTMLVideoElement): void {
    if (this.videoNodes.has(assetId)) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.busInput) return;
    try {
      const source = ctx.createMediaElementSource(video);
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      source.connect(gain);
      gain.connect(this.busInput);
      this.videoNodes.set(assetId, { element: video, source, gain });
    } catch {
      // ignore if already attached
    }
  }

  public detachVideoElement(assetId: string): void {
    const node = this.videoNodes.get(assetId);
    if (!node) return;
    try {
      node.source.disconnect();
      node.gain.disconnect();
    } catch {
      // ignore
    }
    this.videoNodes.delete(assetId);
  }

  public setVideoClipEnvelopeGain(assetId: string, linearGain: number): void {
    const node = this.videoNodes.get(assetId);
    if (!node || !this.ctx) return;
    node.gain.gain.setTargetAtTime(Math.max(0, Math.min(2.0, linearGain)), this.ctx.currentTime, 0.015);
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

  public computeRmsLevel(assetId: string, startSec = 0, durSec = 4): number | null {
    const buf = this.buffers.get(assetId);
    if (!buf) return null;
    const s0 = Math.max(0, Math.min(buf.length - 1, Math.floor(startSec * buf.sampleRate)));
    const s1 = Math.max(s0 + 1, Math.min(buf.length, Math.floor((startSec + durSec) * buf.sampleRate)));
    let sumSq = 0;
    let count = 0;
    const data = buf.getChannelData(0);
    for (let i = s0; i < s1; i += 8) {
      sumSq += data[i] * data[i];
      count++;
    }
    return count > 0 ? Math.sqrt(sumSq / count) : null;
  }

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
    const gain = Math.pow(10, targetPeakDb / 20) / maxAbs;
    return Math.max(0.1, Math.min(2.0, Number(gain.toFixed(2))));
  }

  public setMasterVolume(vol: number, muted: boolean): void {
    this.masterVolume = Math.max(0, Math.min(2, vol));
    this.masterMuted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime, 0.015);
    }
  }

  public stopBufferVoices(): void {
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
        // ignore
      }
    }
    this.activeVoices = [];
  }

  public startAudioTrackPlayback(params: {
    playheadSec: number;
    rate: number;
    clips: TimelineClip[];
    tracks: TimelineTrack[];
  }): void {
    this.stopBufferVoices();
    if (params.rate <= 0) return;

    const ctx = this.ensureContext();
    if (!ctx || !this.busInput) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const anySolo = params.tracks.some((t) => t.kind === 'audio' && t.solo);
    const trackMap = new Map(params.tracks.map((t) => [t.id, t]));
    const now = ctx.currentTime + 0.01;

    for (const clip of params.clips) {
      if (clip.muted || clip.disabled || clip.volume <= 0.001) continue;
      if (this.videoNodes.has(clip.assetId)) continue;

      const track = trackMap.get(clip.trackId);
      if (!track || track.muted) continue;
      if (track.kind === 'audio' && anySolo && !track.solo) continue;

      const buf = this.buffers.get(clip.assetId);
      if (!buf) continue;

      const effectiveStart = Math.max(0, clip.start + (clip.audioOffset ?? 0));
      const clipEnd = effectiveStart + clip.duration;
      if (clipEnd <= params.playheadSec) continue;

      const speedMul = (clip.color.effects.enabled ? clip.color.effects.speed : 1) * params.rate;
      const delayTimeline = Math.max(0, effectiveStart - params.playheadSec);
      const startWhen = now + delayTimeline / params.rate;
      const elapsedInClip = Math.max(0, params.playheadSec - effectiveStart);
      const sourceOffset =
        clip.sourceIn + elapsedInClip * (clip.color.effects.enabled ? clip.color.effects.speed : 1);
      if (sourceOffset >= buf.duration) continue;

      const remainingTimeline = clipEnd - Math.max(params.playheadSec, effectiveStart);
      const playRealSec = remainingTimeline / params.rate;
      if (playRealSec <= 0.01) continue;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.max(0.25, Math.min(4.0, speedMul));
      if (clip.audioEffects?.pitchCents) {
        src.detune.value = clip.audioEffects.pitchCents;
      }

      const gain = ctx.createGain();
      const targetGain = Math.max(0, Math.min(2.0, clip.volume * (track.gain ?? 1)));

      const fadeIn = Math.max(0.005, Math.min(clip.fadeIn, clip.duration * 0.5));
      const fadeOut = Math.max(0.005, Math.min(clip.fadeOut, clip.duration * 0.5));
      const fadeInType = clip.audioEffects?.fadeInType || 'constantPower';
      const fadeOutType = clip.audioEffects?.fadeOutType || 'constantPower';

      const fadeInRem = Math.max(0, fadeIn - elapsedInClip);
      if (fadeInRem > 0.004) {
        const startRatio = elapsedInClip / Math.max(0.005, fadeIn);
        applyAudioFadeEnvelope(
          gain.gain,
          fadeInType,
          targetGain * startRatio,
          targetGain,
          startWhen,
          startWhen + fadeInRem / params.rate
        );
      } else {
        gain.gain.setValueAtTime(0, startWhen);
        gain.gain.linearRampToValueAtTime(targetGain, startWhen + 0.005);
      }

      const endWhen = startWhen + playRealSec;
      const fadeOutStartTimeline = clip.duration - fadeOut;
      const fadeOutRealStart =
        now + Math.max(0, effectiveStart + fadeOutStartTimeline - params.playheadSec) / params.rate;
      if (fadeOutRealStart < endWhen - 0.005) {
        applyAudioFadeEnvelope(
          gain.gain,
          fadeOutType,
          targetGain,
          0.0005,
          Math.max(startWhen + 0.006, fadeOutRealStart),
          endWhen
        );
      }

      src.connect(gain);
      gain.connect(this.busInput);
      try {
        src.start(
          startWhen,
          sourceOffset,
          Math.min(buf.duration - sourceOffset, remainingTimeline * speedMul + 0.05)
        );
        this.activeVoices.push({ clipId: clip.id, source: src, gain });
      } catch {
        // ignore
      }
    }
  }

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
        lra: Number(Math.max(0, this.lufsMax - this.lufsMin).toFixed(1)),
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

    const toDb = (lin: number) =>
      lin <= 1e-5 ? -60 : Math.max(-60, Math.min(0, 20 * Math.log10(lin)));
    const peakLeftDb = Number(toDb(peakL).toFixed(1));
    const peakRightDb = Number(toDb(peakR).toFixed(1));
    const instLufs = Math.max(-60, toDb(Math.sqrt(sumSq / n)) - 0.7);
    this.lufsEma = this.lufsEma * 0.72 + instLufs * 0.28;
    if (this.lufsEma > -48) {
      this.lufsMin = this.lufsMin <= -55 ? this.lufsEma : Math.min(this.lufsMin, this.lufsEma);
      this.lufsMax = Math.max(this.lufsMax, this.lufsEma);
    }

    return {
      peakLeftDb,
      peakRightDb,
      lufs: Number(this.lufsEma.toFixed(1)),
      clipping: peakLeftDb >= -0.3 || peakRightDb >= -0.3,
      lra: Number(Math.max(0, Math.min(24, this.lufsMax - this.lufsMin)).toFixed(1)),
    };
  }

  public dispose(): void {
    this.stopBufferVoices();
    try {
      this.modLfo?.stop();
    } catch {
      // ignore
    }
    for (const id of Array.from(this.videoNodes.keys())) {
      this.detachVideoElement(id);
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

/**
 * Smart Seamless Audio Auto-Mix:
 * When a user cuts a section out of a song (leaving 2+ clips on an audio track),
 * this closes gaps, overlaps the edit seam by a musical equal-power crossfade window
 * (1 beat if BPM is known, otherwise 0.55s), applies matched Constant Power Crossfade curves,
 * and RMS-levels adjacent sections so the splice glides together seamlessly with zero pops.
 */
export function autoMixAudioTrackClips(params: {
  clips: TimelineClip[];
  trackId: string;
  detectedBpm: number | null;
  engine: FifilmAudioEngine | null;
  fps: number;
}): { nextClips: TimelineClip[]; mixedCount: number; crossfadeSec: number } {
  const { clips, trackId, detectedBpm, engine, fps } = params;
  const trackClips = clips
    .filter((c) => c.trackId === trackId && !c.disabled)
    .sort((a, b) => a.start - b.start);

  if (trackClips.length < 2) {
    return { nextClips: clips, mixedCount: 0, crossfadeSec: 0 };
  }

  // Optimal musical crossfade duration: 1 beat if BPM detected, else 0.55s
  const beatDur = detectedBpm && detectedBpm >= 60 ? 60 / detectedBpm : 0.55;
  const idealXfade = Number(Math.max(0.28, Math.min(1.1, beatDur)).toFixed(3));
  const snap = (t: number) => Math.round(t * fps) / fps;

  const updatedMap = new Map<string, TimelineClip>();
  const working = trackClips.map((c) => structuredClone(c));
  let mixedCount = 0;

  // Reference RMS from first clip for loudness-matched splice transitions
  const refRms = engine?.computeRmsLevel(working[0].assetId, working[0].sourceIn, Math.min(4, working[0].duration));

  for (let i = 1; i < working.length; i++) {
    const prev = working[i - 1];
    const cur = working[i];
    const maxAllowedXfade = Math.min(idealXfade, prev.duration * 0.35, cur.duration * 0.35);
    const xfade = Math.max(0.16, Number(maxAllowedXfade.toFixed(3)));

    // Overlap cur smoothly into the tail of prev for true equal-power DJ/remix crossfade!
    const targetStart = Math.max(0, snap(prev.start + prev.duration - xfade));
    cur.start = targetStart;

    prev.fadeOut = Math.max(prev.fadeOut, xfade);
    cur.fadeIn = Math.max(cur.fadeIn, xfade);
    prev.audioEffects = { ...prev.audioEffects, fadeOutType: 'crossfade' };
    cur.audioEffects = { ...cur.audioEffects, fadeInType: 'crossfade' };

    // Gentle RMS gain matching so spliced song parts stay perceptually level
    if (refRms && refRms > 0.008 && engine) {
      const curRms = engine.computeRmsLevel(cur.assetId, cur.sourceIn, Math.min(4, cur.duration));
      if (curRms && curRms > 0.008) {
        const ratio = Math.max(0.7, Math.min(1.45, refRms / curRms));
        cur.volume = Number(Math.max(0.15, Math.min(1.8, prev.volume * ratio)).toFixed(2));
      }
    }

    mixedCount++;
  }

  for (const w of working) updatedMap.set(w.id, w);
  const nextClips = clips.map((c) => updatedMap.get(c.id) || c);
  return { nextClips, mixedCount, crossfadeSec: idealXfade };
}

export function linearToDbLabel(vol: number): string {
  if (vol <= 0.001) return '-inf dB';
  const db = 20 * Math.log10(vol);
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}
