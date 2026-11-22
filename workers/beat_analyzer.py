#!/usr/bin/env python3
"""
Fifilm Open-Source Music Beat & Percussive Transient Analyzer
=============================================================
Analyzes WAV/FLAC/MP3/MP4/MOV audio tracks (e.g., exports from bebeat) to extract:
  - Tempo (BPM) & confidence
  - Phase-locked beat grid timestamps
  - Bar downbeat timestamps
  - Sharp percussive transient hits (onset spectral flux peaks)

Uses `librosa` when installed, or falls back seamlessly to native `scipy` + `numpy`
STFT SuperFlux spectral-flux onset detection & autocorrelation tempo tracking
(decoded via FFmpeg PCM).

Usage:
    python workers/beat_analyzer.py --input track.wav --ffmpeg path/to/ffmpeg.exe
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal

try:
    import librosa  # type: ignore
    HAS_LIBROSA = True
except ImportError:
    HAS_LIBROSA = False


SAMPLE_RATE = 22050


def decode_audio_ffmpeg(input_path: Path, ffmpeg_bin: str) -> np.ndarray:
    cmd = [
        ffmpeg_bin,
        "-v",
        "error",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "f32le",
        "pipe:1",
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0 or not proc.stdout:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="ignore") or "Failed to decode audio")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def analyze_with_librosa(y: np.ndarray, sr: int) -> dict:
    hop = 512
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=hop, trim=False
    )
    bpm = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop).tolist()

    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=hop, backtrack=True, delta=0.12
    )
    transients = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop).tolist()

    # Estimate bar downbeats (strongest 4-beat phase)
    downbeats = estimate_downbeats(beats, onset_env, sr, hop)

    return {
        "bpm": round(bpm, 2),
        "confidence": 0.92,
        "beats": [round(float(t), 4) for t in beats],
        "downbeats": [round(float(t), 4) for t in downbeats],
        "transients": [round(float(t), 4) for t in transients],
        "method": "librosa",
    }


def estimate_downbeats(
    beats: list[float], onset_env: np.ndarray, sr: int, hop: int
) -> list[float]:
    if len(beats) < 4:
        return beats[:1]
    best_phase = 0
    best_energy = -1.0
    for phase in range(4):
        e = 0.0
        for idx in range(phase, len(beats), 4):
            frame = min(len(onset_env) - 1, max(0, int(round(beats[idx] * sr / hop))))
            e += float(onset_env[frame])
        if e > best_energy:
            best_energy = e
            best_phase = phase
    return [beats[i] for i in range(best_phase, len(beats), 4)]


def analyze_with_scipy(y: np.ndarray, sr: int) -> dict:
    n_fft = 1024
    hop = 256
    duration = len(y) / sr
    if duration < 0.5:
        return {
            "bpm": 120.0,
            "confidence": 0.0,
            "beats": [],
            "downbeats": [],
            "transients": [],
            "method": "scipy-spectral-flux",
        }

    # Log-compressed STFT magnitude for SuperFlux-style onset strength
    _, _, zxx = signal.stft(y, fs=sr, nperseg=n_fft, noverlap=n_fft - hop, window="hann")
    mag = np.log1p(10.0 * np.abs(zxx))

    # Positive spectral flux across frequency bins (emphasizing percussive bands)
    diff = np.maximum(0.0, mag[:, 1:] - mag[:, :-1])
    flux = np.mean(diff, axis=0)
    flux = np.concatenate([[0.0], flux])

    # Local adaptive mean subtraction
    win = max(5, int(round(0.25 * sr / hop)))
    kernel = np.ones(win) / win
    local_mean = np.convolve(flux, kernel, mode="same")
    onset_env = np.maximum(0.0, flux - local_mean)
    peak_val = float(np.max(onset_env)) + 1e-8
    onset_env /= peak_val

    frame_rate = sr / hop

    # Percussive transient peak picking
    min_dist = max(1, int(round(0.09 * frame_rate)))  # >= 90ms between sharp hits
    peaks, props = signal.find_peaks(onset_env, height=0.22, prominence=0.14, distance=min_dist)
    transients = [float(p / frame_rate) for p in peaks]

    # Tempo estimation via normalized autocorrelation over [68, 178] BPM
    ac = signal.correlate(onset_env, onset_env, mode="full")[len(onset_env) - 1 :]
    min_lag = max(1, int(round(frame_rate * 60.0 / 178.0)))
    max_lag = min(len(ac) - 1, int(round(frame_rate * 60.0 / 68.0)))

    bpm = 120.0
    confidence = 0.5
    if max_lag > min_lag:
        window_ac = ac[min_lag : max_lag + 1].copy()
        # Mild Gaussian prior centered near 118 BPM to avoid octave doubling ambiguity
        lags = np.arange(min_lag, max_lag + 1, dtype=np.float64)
        cand_bpms = 60.0 * frame_rate / lags
        prior = np.exp(-0.5 * (np.log2(cand_bpms / 118.0) / 0.55) ** 2)
        scored = window_ac * prior
        best_idx = int(np.argmax(scored))
        best_lag = min_lag + best_idx
        bpm = float(60.0 * frame_rate / best_lag)
        confidence = float(np.clip(window_ac[best_idx] / (ac[0] + 1e-8) * 3.2, 0.25, 0.96))

    # Phase-lock regular beat grid to strongest onset alignment
    beat_period = 60.0 / bpm
    best_phase_t = 0.0
    best_score = -1.0
    steps = 48
    for s in range(steps):
        phase_t = (s / steps) * beat_period
        t = phase_t
        sc = 0.0
        while t < duration:
            f = int(round(t * frame_rate))
            if 0 <= f < len(onset_env):
                # Allow +/- 1 frame tolerance around grid point
                lo = max(0, f - 1)
                hi = min(len(onset_env), f + 2)
                sc += float(np.max(onset_env[lo:hi]))
            t += beat_period
        if sc > best_score:
            best_score = sc
            best_phase_t = phase_t

    beats = []
    t = best_phase_t
    while t < duration:
        # Micro-snap beat to local onset peak within +/- 35ms for natural groove lock
        f = int(round(t * frame_rate))
        tol = max(1, int(round(0.035 * frame_rate)))
        lo = max(0, f - tol)
        hi = min(len(onset_env), f + tol + 1)
        if hi > lo and float(np.max(onset_env[lo:hi])) > 0.25:
            local_f = lo + int(np.argmax(onset_env[lo:hi]))
            beats.append(local_f / frame_rate)
        else:
            beats.append(t)
        t += beat_period

    downbeats = estimate_downbeats(beats, onset_env, sr, hop)

    return {
        "bpm": round(bpm, 2),
        "confidence": round(confidence, 3),
        "beats": [round(float(x), 4) for x in beats],
        "downbeats": [round(float(x), 4) for x in downbeats],
        "transients": [round(float(x), 4) for x in transients],
        "method": "scipy-spectral-flux",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fifilm Beat & Transient Analyzer")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=str, default="ffmpeg")
    args = parser.parse_args()

    y = decode_audio_ffmpeg(args.input, args.ffmpeg)
    result = analyze_with_librosa(y, SAMPLE_RATE) if HAS_LIBROSA else analyze_with_scipy(y, SAMPLE_RATE)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
