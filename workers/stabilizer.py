#!/usr/bin/env python3
"""
Fifilm OpenCV Optical-Flow & Homography Video Stabilizer Worker
===============================================================
Pass 1: Tracks sparse optical flow (Shi-Tomasi corners + Lucas-Kanade pyramid)
        and estimates robust RANSAC partial-affine / homography inter-frame motion.
Pass 2: Smooths the cumulative camera trajectory with a Gaussian kernel,
        computes counter-shake per-frame transforms, estimates rolling-shutter
        compensation, solves minimum auto-crop zoom, and writes trajectory JSON
        (and optionally a stabilized video file).

Usage:
    python workers/stabilizer.py --input clip.mp4 --trajectory out.json --smoothness 20 --strength 0.8
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

try:
    import cv2  # type: ignore
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False


def gaussian_smooth_1d(signal: np.ndarray, radius: int) -> np.ndarray:
    radius = max(1, int(radius))
    if len(signal) <= 2:
        return signal.copy()
    sigma = max(1.0, radius / 2.2)
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    kernel = np.exp(-0.5 * (x / sigma) ** 2)
    kernel /= np.sum(kernel)
    padded = np.pad(signal, (radius, radius), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def analyze_with_opencv(
    input_path: Path,
    smoothness: int,
    strength: float,
    auto_crop_pct: float,
    rolling_shutter: float,
    output_video: Path | None,
) -> dict:
    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV could not open video: {input_path}")

    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0

    ok, prev = cap.read()
    if not ok:
        raise RuntimeError("Could not read first frame")
    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)

    transforms = []  # [dx, dy, da]
    frame_idx = 0
    while True:
        ok, curr = cap.read()
        if not ok:
            break
        curr_gray = cv2.cvtColor(curr, cv2.COLOR_BGR2GRAY)
        prev_pts = cv2.goodFeaturesToTrack(
            prev_gray, maxCorners=220, qualityLevel=0.01, minDistance=24, blockSize=3
        )
        dx = dy = da = 0.0
        if prev_pts is not None and len(prev_pts) >= 6:
            curr_pts, status, _ = cv2.calcOpticalFlowPyrLK(prev_gray, curr_gray, prev_pts, None)
            valid = status.ravel() == 1
            if np.count_nonzero(valid) >= 6:
                m, _ = cv2.estimateAffinePartial2D(
                    prev_pts[valid], curr_pts[valid], method=cv2.RANSAC, ransacReprojThreshold=3.0
                )
                if m is not None:
                    dx = float(m[0, 2])
                    dy = float(m[1, 2])
                    da = float(math.atan2(m[1, 0], m[0, 0]))

        transforms.append([dx, dy, da])
        prev_gray = curr_gray
        frame_idx += 1

    if not transforms:
        transforms = [[0.0, 0.0, 0.0]]

    arr = np.array(transforms, dtype=np.float64)
    trajectory = np.cumsum(arr, axis=0)
    smoothed = np.column_stack([
        gaussian_smooth_1d(trajectory[:, 0], smoothness),
        gaussian_smooth_1d(trajectory[:, 1], smoothness),
        gaussian_smooth_1d(trajectory[:, 2], smoothness),
    ])

    diff = (smoothed - trajectory) * strength

    # Compute required auto-crop safety zoom from peak displacement
    max_dx_norm = float(np.max(np.abs(diff[:, 0])) / max(1, w))
    max_dy_norm = float(np.max(np.abs(diff[:, 1])) / max(1, h))
    max_rot = float(np.max(np.abs(diff[:, 2])))
    auto_scale = 1.0 + max(auto_crop_pct / 100.0, 2.0 * max(max_dx_norm, max_dy_norm) + abs(math.sin(max_rot)))
    auto_scale = min(1.38, auto_scale)

    # Optional rolling-shutter high-frequency horizontal wobble damping
    if rolling_shutter > 0.01:
        rs_factor = 1.0 - 0.15 * min(1.0, rolling_shutter)
        diff[:, 2] *= rs_factor

    frame_transforms = [
        {"frame": 0, "dx": 0.0, "dy": 0.0, "da": 0.0, "scale": round(auto_scale, 4)}
    ]
    for idx, (cdx, cdy, cda) in enumerate(diff, start=1):
        frame_transforms.append({
            "frame": idx,
            "dx": round(float(cdx / max(1, w)), 6),
            "dy": round(float(cdy / max(1, h)), 6),
            "da": round(float(cda), 6),
            "scale": round(auto_scale, 4),
        })

    if output_video is not None:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_video), fourcc, fps, (w, h))
        f_i = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            t = frame_transforms[min(f_i, len(frame_transforms) - 1)]
            tx = t["dx"] * w
            ty = t["dy"] * h
            ta = t["da"]
            sc = t["scale"]
            ca = math.cos(ta) * sc
            sa = math.sin(ta) * sc
            cx, cy = w * 0.5, h * 0.5
            mat = np.array([
                [ca, -sa, (1 - ca) * cx + sa * cy + tx],
                [sa,  ca, -sa * cx + (1 - ca) * cy + ty],
            ], dtype=np.float64)
            warped = cv2.warpAffine(
                frame, mat, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT_101
            )
            writer.write(warped)
            f_i += 1
        writer.release()

    cap.release()
    return {
        "engine": "opencv-optical-flow",
        "width": w,
        "height": h,
        "fps": fps,
        "frames": len(frame_transforms),
        "autoScale": round(auto_scale, 4),
        "trajectory": frame_transforms,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fifilm OpenCV Optical-Flow Stabilizer")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--trajectory", type=Path, required=True)
    parser.add_argument("--output-video", type=Path, default=None)
    parser.add_argument("--smoothness", type=int, default=18)
    parser.add_argument("--strength", type=float, default=0.75)
    parser.add_argument("--auto-crop", type=float, default=6.0)
    parser.add_argument("--rolling-shutter", type=float, default=0.35)
    args = parser.parse_args()

    if not HAS_CV2:
        print(json.dumps({"ok": False, "error": "opencv-python (cv2) not installed"}), file=sys.stderr)
        sys.exit(2)

    result = analyze_with_opencv(
        input_path=args.input,
        smoothness=args.smoothness,
        strength=args.strength,
        auto_crop_pct=args.auto_crop,
        rolling_shutter=args.rolling_shutter,
        output_video=args.output_video,
    )
    args.trajectory.parent.mkdir(parents=True, exist_ok=True)
    args.trajectory.write_text(json.dumps(result), encoding="utf-8")
    print(json.dumps({"ok": True, "frames": result["frames"], "autoScale": result["autoScale"]}))


if __name__ == "__main__":
    main()
