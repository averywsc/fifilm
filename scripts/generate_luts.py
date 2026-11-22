#!/usr/bin/env python3
"""
Fifilm Curated 3D .cube LUT Generator
=====================================
Mathematically synthesizes production-grade 33x33x33 (or custom-size) Adobe .cube
3D LUTs directly into the external colorstudies LUT library directory.

Usage:
    python scripts/generate_luts.py
    python scripts/generate_luts.py --output "C:\\Users\\Avery\\Documents\\GitHub\\colorstudies\\luts" --size 33
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Callable

import numpy as np

DEFAULT_COLORSTUDIES_DIR = Path(r"C:\Users\Avery\Documents\GitHub\colorstudies\luts")


def srgb_to_linear(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1.0 / 2.4) - 0.055)


def rec709_luma(rgb: np.ndarray) -> np.ndarray:
    return (
        0.2126 * rgb[..., 0:1]
        + 0.7152 * rgb[..., 1:2]
        + 0.0722 * rgb[..., 2:3]
    )


def smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0 + 1e-8), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def sigmoid_contrast(x: np.ndarray, strength: float = 1.0, pivot: float = 0.5) -> np.ndarray:
    """Smooth S-curve filmic contrast preserving [0, 1] endpoints."""
    if abs(strength) < 1e-6:
        return x
    k = 1.0 + strength * 2.4
    s = 1.0 / (1.0 + np.exp(-k * (x - pivot)))
    s0 = 1.0 / (1.0 + np.exp(-k * (0.0 - pivot)))
    s1 = 1.0 / (1.0 + np.exp(-k * (1.0 - pivot)))
    return np.clip((s - s0) / (s1 - s0 + 1e-8), 0.0, 1.0)


def apply_matrix(rgb: np.ndarray, mat: np.ndarray) -> np.ndarray:
    return np.einsum("...j,ij->...i", rgb, mat)


def adjust_saturation(rgb: np.ndarray, factor: float) -> np.ndarray:
    luma = rec709_luma(rgb)
    return luma + (rgb - luma) * factor


def rgb_to_hue_deg(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin + 1e-8
    h = np.zeros_like(cmax)
    mask_r = cmax == r
    mask_g = (cmax == g) & (~mask_r)
    mask_b = (~mask_r) & (~mask_g)
    h = np.where(mask_r, ((g - b) / delta) % 6.0, h)
    h = np.where(mask_g, ((b - r) / delta) + 2.0, h)
    h = np.where(mask_b, ((r - g) / delta) + 4.0, h)
    return (h * 60.0) % 360.0


# ---------------------------------------------------------------------------
# Curated Look Transforms (input/output: float64 array shape (..., 3) in [0, 1])
# ---------------------------------------------------------------------------

def look_kodak_2383_print(rgb: np.ndarray) -> np.ndarray:
    """Classic D65 Kodak 2383 print stock emulation: warm creamy highlights,
    deep cyan-teal shadows, rich red/yellow density, and classic print S-curve."""
    lin = srgb_to_linear(rgb)
    # Subtle print-film dye crosstalk matrix (deepens reds & blues, tames neon greens)
    crosstalk = np.array([
        [1.045, -0.025, -0.020],
        [-0.015, 1.010,  0.005],
        [-0.020,  0.030,  0.990],
    ])
    lin = np.clip(apply_matrix(lin, crosstalk), 0.0, 1.5)
    col = linear_to_srgb(np.clip(lin, 0.0, 1.0))

    # Print S-curve with gentle highlight roll-off and rich shadow toe
    col = sigmoid_contrast(col, strength=0.72, pivot=0.46)
    luma = rec709_luma(col)

    # Split-tone characteristic of 2383 D65 print: cool teal-cyan shadows, warm golden highlights
    shadow_w = 1.0 - smoothstep(0.05, 0.55, luma)
    high_w = smoothstep(0.45, 0.96, luma)
    col = col + shadow_w * np.array([-0.022, 0.006, 0.024])
    col = col + high_w * np.array([0.028, 0.010, -0.026])

    # Subtle matte print floor & shoulder compression
    col = 0.016 + col * 0.968
    col = adjust_saturation(col, 1.08)
    return np.clip(col, 0.0, 1.0)


def look_bleach_bypass(rgb: np.ndarray) -> np.ndarray:
    """Silver-retention bleach bypass: crisp contrast, desaturated steel midtones,
    and cool metallic shadows with preserved highlight snap."""
    luma = rec709_luma(rgb)
    # Blend monochrome silver density via overlay/soft-light inspired curve
    silver = sigmoid_contrast(luma, strength=1.15, pivot=0.48)
    desat = luma + (rgb - luma) * 0.42

    # Overlay blend with silver channel
    overlay = np.where(
        desat < 0.5,
        2.0 * desat * silver,
        1.0 - 2.0 * (1.0 - desat) * (1.0 - silver),
    )
    col = 0.42 * desat + 0.58 * overlay

    # Cool steel cast in shadows, clean crisp highlights
    shadow_w = 1.0 - smoothstep(0.0, 0.6, luma)
    col = col + shadow_w * np.array([-0.018, 0.002, 0.022])
    col = sigmoid_contrast(col, strength=0.45, pivot=0.50)
    return np.clip(col, 0.0, 1.0)


def look_warm_halation(rgb: np.ndarray) -> np.ndarray:
    """Golden-hour cinema look with crimson-amber highlight roll-off mimicking
    anti-halation layer scatter on tungsten/daylight cinema stock."""
    lin = srgb_to_linear(rgb)
    warm_mat = np.array([
        [1.06,  0.02, -0.02],
        [0.01,  1.01, -0.01],
        [-0.02, 0.00,  0.94],
    ])
    lin = np.clip(apply_matrix(lin, warm_mat), 0.0, 1.5)
    col = linear_to_srgb(np.clip(lin, 0.0, 1.0))

    luma = rec709_luma(col)
    # Halation shoulder bloom in upper luminance: shifts specular edges subtly orange-red
    halo_w = smoothstep(0.58, 0.98, luma)
    col = col + halo_w * np.array([0.055, 0.014, -0.032])

    # Gentle lifted velvet shadow floor
    shadow_w = 1.0 - smoothstep(0.0, 0.40, luma)
    col = col + shadow_w * np.array([0.014, 0.006, 0.008])

    col = sigmoid_contrast(col, strength=0.35, pivot=0.48)
    col = 0.018 + col * 0.965
    return np.clip(col, 0.0, 1.0)


def look_teal_and_orange(rgb: np.ndarray) -> np.ndarray:
    """Balanced cinematic Teal & Orange separation with skin-tone hue protection."""
    luma = rec709_luma(rgb)
    hue = rgb_to_hue_deg(rgb)[..., None]

    # Skin/warm hue mask centered around 28 degrees (orange-amber)
    dist_warm = np.minimum(np.abs(hue - 28.0), 360.0 - np.abs(hue - 28.0))
    warm_mask = np.exp(-0.5 * (dist_warm / 36.0) ** 2)

    # Cool hue mask centered around 200 degrees (teal-cyan-blue)
    dist_cool = np.minimum(np.abs(hue - 200.0), 360.0 - np.abs(hue - 200.0))
    cool_mask = np.exp(-0.5 * (dist_cool / 55.0) ** 2)

    shadow_w = 1.0 - smoothstep(0.05, 0.62, luma)
    mid_high_w = smoothstep(0.28, 0.85, luma)

    col = rgb.copy()
    # Push shadows toward rich cinema teal
    col = col + shadow_w * (1.0 - 0.55 * warm_mask) * np.array([-0.048, 0.014, 0.042])
    # Push warm midtones/highlights toward golden amber
    col = col + mid_high_w * (0.45 + 0.55 * warm_mask) * np.array([0.046, 0.012, -0.044])
    # Slightly deepen cool hues
    col = col + cool_mask * np.array([-0.025, 0.008, 0.022])

    col = sigmoid_contrast(col, strength=0.58, pivot=0.47)
    col = adjust_saturation(col, 1.12)
    return np.clip(col, 0.0, 1.0)


def look_silver_monochrome(rgb: np.ndarray) -> np.ndarray:
    """Panchromatic Tri-X / Double-X inspired black-and-white with red-filter sky
    depth, selenium-cooled blacks, and creamy highlight roll-off."""
    lin = srgb_to_linear(rgb)
    # Panchromatic spectral response emphasizing warm skin & deepening blue skies
    mono_lin = (
        0.34 * lin[..., 0:1]
        + 0.56 * lin[..., 1:2]
        + 0.10 * lin[..., 2:3]
    )
    mono = linear_to_srgb(np.clip(mono_lin, 0.0, 1.0))
    mono = sigmoid_contrast(mono, strength=0.88, pivot=0.47)

    # Soft highlight roll-off + rich darkroom floor
    mono = 0.015 + mono * 0.968
    shadow_w = 1.0 - smoothstep(0.0, 0.55, mono)
    high_w = smoothstep(0.55, 1.0, mono)

    # Very subtle selenium darkroom toning (cool deep shadows, warm ivory paper highlights)
    col = np.repeat(mono, 3, axis=-1)
    col = col + shadow_w * np.array([-0.006, -0.003, 0.010])
    col = col + high_w * np.array([0.008, 0.005, -0.006])
    return np.clip(col, 0.0, 1.0)


def look_soft_matte_log_to_rec709(rgb: np.ndarray) -> np.ndarray:
    """Log-to-Rec.709 technical-plus-aesthetic conversion LUT (friendly for
    Apple Log, S-Log3, and flat camera profiles) with lifted matte shadows
    and smooth filmic highlight compression."""
    # Expand flat log dynamic range around middle gray (~0.42 in typical log)
    x = np.clip(rgb, 0.0, 1.0)
    # Log-expansion pseudo-linearization
    lin = np.power(np.clip((x - 0.092) / 0.84, 0.0, 1.35), 2.15)
    # Filmic ACES-inspired soft highlight roll-off (Reinhard-like rational curve)
    a, b, c, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    filmic = (lin * (a * lin + b)) / (lin * (c * lin + d) + e)
    col = linear_to_srgb(np.clip(filmic, 0.0, 1.0))

    # Restore natural Rec.709 saturation from flat log gamut
    col = adjust_saturation(col, 1.26)

    # Soft matte black lift (0.035 floor) + gentle cream shoulder
    col = 0.035 + col * 0.942
    luma = rec709_luma(col)
    col = col + (1.0 - smoothstep(0.0, 0.35, luma)) * np.array([0.004, 0.006, 0.012])
    return np.clip(col, 0.0, 1.0)


def look_fujifilm_eterna_250d(rgb: np.ndarray) -> np.ndarray:
    """Understated cinema negative inspired by Fujifilm Eterna 250D: clean
    emerald foliage, gentle pastel skin highlights, wide shadow latitude."""
    lin = srgb_to_linear(rgb)
    eterna_mat = np.array([
        [0.985,  0.025, -0.010],
        [-0.012, 1.028, -0.016],
        [0.008,  0.022,  0.970],
    ])
    lin = np.clip(apply_matrix(lin, eterna_mat), 0.0, 1.4)
    col = linear_to_srgb(np.clip(lin, 0.0, 1.0))

    # Gentle low-contrast cinema curve
    col = sigmoid_contrast(col, strength=0.28, pivot=0.48)
    col = adjust_saturation(col, 0.91)

    luma = rec709_luma(col)
    shadow_w = 1.0 - smoothstep(0.0, 0.45, luma)
    high_w = smoothstep(0.55, 1.0, luma)
    col = col + shadow_w * np.array([-0.006, 0.010, 0.010])
    col = col + high_w * np.array([0.010, 0.008, -0.006])
    col = 0.022 + col * 0.958
    return np.clip(col, 0.0, 1.0)


def look_midnight_navy_noir(rgb: np.ndarray) -> np.ndarray:
    """Totone-inspired nocturnal grade: deep midnight navy shadows (#080C18),
    crisp silver-white highlights, and controlled neon saturation."""
    col = sigmoid_contrast(rgb, strength=0.78, pivot=0.45)
    luma = rec709_luma(col)
    shadow_w = 1.0 - smoothstep(0.02, 0.58, luma)
    high_w = smoothstep(0.65, 1.0, luma)

    # Midnight navy shadow tint + pure crisp highlights
    col = adjust_saturation(col, 0.86)
    col = col + shadow_w * np.array([-0.036, -0.010, 0.048])
    col = col + high_w * np.array([0.012, 0.014, 0.018])
    col = 0.012 + col * 0.980
    return np.clip(col, 0.0, 1.0)


CURATED_LUTS: list[tuple[str, str, Callable[[np.ndarray], np.ndarray]]] = [
    ("Fifilm - Kodak 2383 Print", "Fifilm - Kodak 2383 Print.cube", look_kodak_2383_print),
    ("Fifilm - Bleach Bypass", "Fifilm - Bleach Bypass.cube", look_bleach_bypass),
    ("Fifilm - Warm Halation", "Fifilm - Warm Halation.cube", look_warm_halation),
    ("Fifilm - Teal and Orange", "Fifilm - Teal and Orange.cube", look_teal_and_orange),
    ("Fifilm - Silver Monochrome", "Fifilm - Silver Monochrome.cube", look_silver_monochrome),
    ("Fifilm - Soft Matte Log-to-Rec709", "Fifilm - Soft Matte Log-to-Rec709.cube", look_soft_matte_log_to_rec709),
    ("Fifilm - Fujifilm Eterna 250D", "Fifilm - Fujifilm Eterna 250D.cube", look_fujifilm_eterna_250d),
    ("Fifilm - Midnight Navy Noir", "Fifilm - Midnight Navy Noir.cube", look_midnight_navy_noir),
]


def build_cube_grid(size: int) -> np.ndarray:
    """Build standard Adobe .cube 3D grid with Red varying fastest, then Green, then Blue."""
    axis = np.linspace(0.0, 1.0, size, dtype=np.float64)
    # meshgrid indexing='ij' over (b, g, r) ensures r varies fastest in C-order flatten
    b, g, r = np.meshgrid(axis, axis, axis, indexing="ij")
    return np.stack([r, g, b], axis=-1).reshape(-1, 3)


def write_cube_file(path: Path, title: str, size: int, rgb_table: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    header = (
        f"# Generated by Fifilm 3D LUT Generator\n"
        f'TITLE "{title}"\n'
        f"LUT_3D_SIZE {size}\n"
        f"DOMAIN_MIN 0.000000 0.000000 0.000000\n"
        f"DOMAIN_MAX 1.000000 1.000000 1.000000\n"
    )
    lines = [
        f"{r:.6f} {g:.6f} {b:.6f}\n"
        for r, g, b in np.clip(rgb_table, 0.0, 1.0)
    ]
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(header)
        fh.writelines(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate curated 3D .cube LUTs for Fifilm.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_COLORSTUDIES_DIR,
        help="Destination folder for generated .cube files.",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=33,
        help="3D LUT cube resolution per axis (default: 33).",
    )
    args = parser.parse_args()

    grid = build_cube_grid(args.size)
    print(f"Generating {len(CURATED_LUTS)} curated {args.size}^3 .cube LUTs into: {args.output}")
    for title, filename, transform in CURATED_LUTS:
        transformed = transform(grid)
        out_path = args.output / filename
        write_cube_file(out_path, title, args.size, transformed)
        print(f"  [OK] {out_path.name} ({out_path.stat().st_size:,} bytes)")
    print("Done.")


if __name__ == "__main__":
    main()
