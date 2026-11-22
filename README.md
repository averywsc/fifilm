# Fifilm

High-performance, hardware-accelerated open-source non-linear video editor (video companion to **Totone**).

## Open-Source Foundation
- **Desktop & Packaging:** Electron + Vite + React 19 + TypeScript + `electron-builder` (builds both a Windows NSIS installer `.exe` and a standalone portable `.exe` with unpacked `ffmpeg.exe`, `ffprobe.exe`, and Python DSP workers).
- **Real-Time Grading, Effects & Multi-LUT GPU Engine:** Native **WebGL2** shader pipeline supporting up to 6 stacked 3D `TEXTURE_3D` LUTs per clip (Tetrahedral / Trilinear interpolation), primary correction, Lift / Gamma / Gain wheels, split toning, Film Halation, Pro-Mist Bloom, Sharpen, Blur, Chromatic Aberration, Vignette, Letterbox, and dual-texture Before/After Split Wipe.
- **Audio Engine & Music-to-Timeline Sync:** Sample-accurate 48 kHz Web Audio mixer with per-clip gain, Fade In / Fade Out envelopes, Peak Normalize (`-1 dBFS`), Mute / Solo, Master Fader, brickwall peak limiter, live Stereo Peak dBFS & momentary LUFS meters, multi-track FFmpeg export mixing (`amix` + `alimiter` + optional `-14 LUFS` `loudnorm`), and beat/downbeat/transient sync (`workers/beat_analyzer.py` + Web Audio spectral flux).
- **Two-Pass Video Stabilization:** Hardened `FFmpeg` (`libvidstab` `vidstabdetect` / `vidstabtransform`) with **Smooth Motion** and **No Motion (Tripod Lock)** modes, relative temp-path execution (immune to Windows drive-letter escaping), live Pass 1 / Pass 2 progress streaming, and optional OpenCV optical-flow worker (`workers/stabilizer.py`).
- **External `colorstudies` LUT Library:** Auto-scans `C:\Users\Avery\Documents\GitHub\colorstudies` for `.cube` and `colorstudies/luts/*.bin` 3D LUTs and bakes combined looks directly back to `.cube` files inside `colorstudies/luts/`.

## Development Commands

```powershell
cd C:\Users\Avery\Documents\GitHub\fifilm

# Install dependencies
npm install

# Run in browser dev mode (with live colorstudies, FFmpeg & libvidstab backend)
npm run dev

# Run as native Windows Electron desktop app
npm run electron:dev

# Generate curated 33^3 .cube LUTs into C:\Users\Avery\Documents\GitHub\colorstudies\luts
npm run luts:generate
```

## Building Standalone Windows `.exe` (Installer & Portable)

```powershell
cd C:\Users\Avery\Documents\GitHub\fifilm

# Build both NSIS Installer (Fifilm-Setup-0.1.0.exe) and Portable (Fifilm-0.1.0-Portable.exe)
npm run dist:win
```

Outputs are written to `C:\Users\Avery\Documents\GitHub\fifilm\release\`:
- `Fifilm-Setup-0.1.0.exe` (Windows NSIS installer with Desktop & Start Menu shortcuts)
- `Fifilm-0.1.0-Portable.exe` (standalone zero-install portable Windows executable)
- `win-unpacked\Fifilm.exe` (unpacked desktop bundle with `resources\app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe`, `ffprobe.exe`, and `resources\workers\`)

## Optional Python OpenCV / Librosa Setup
Two-pass `libvidstab` stabilization and `scipy` spectral-flux beat analysis work out of the box. To also enable local OpenCV optical-flow mode or `librosa`:
```powershell
pip install -r workers/requirements.txt
```
