#!/usr/bin/env python3
"""NVIDIA Warp/CUDA shallow-water flood smoke for the Sadang OpenUSD handoff.

This is a GPU-host acceptance artifact, not a browser/WebGL fallback. It uses
NVIDIA Warp kernels on a CUDA device to run a compact virtual-pipe-like
shallow-water update over a deterministic terrain/drain/building mask and writes
machine-readable evidence plus a PGM depth preview.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import sys
from typing import Any


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def blocked(reason: str, args: argparse.Namespace, code: int = 2) -> int:
    report = {
        "status": "blocked",
        "passed": False,
        "reason": reason,
        "nvidia_product": "NVIDIA Warp / CUDA",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "grid_size": args.grid_size,
        "steps": args.steps,
        "required_runtime": ["NVIDIA GPU", "CUDA driver", "nvidia-smi", "warp-lang Python package"],
    }
    write_json(Path(args.output_json), report)
    print(json.dumps({"status": "blocked", "reason": reason, "output_json": args.output_json}, indent=2))
    return 0 if args.allow_missing else code


def main() -> int:
    parser = argparse.ArgumentParser(description="Run NVIDIA Warp/CUDA shallow-water flood smoke.")
    parser.add_argument("--stage", default="sadang_317_6.usda", help="Source OpenUSD stage label recorded in the report.")
    parser.add_argument("--output-json", default="warp_flood_report.json")
    parser.add_argument("--output-pgm", default="warp_flood_depth.pgm")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--grid-size", type=int, default=96)
    parser.add_argument("--steps", type=int, default=180)
    parser.add_argument("--dt", type=float, default=0.055)
    parser.add_argument("--rain-mm-per-hour", type=float, default=140.0)
    parser.add_argument("--rain-amplifier", type=float, default=120.0, help="Smoke acceleration factor; report keeps physical rainfall separately.")
    parser.add_argument("--allow-missing", action="store_true", help="Write blocked report with exit 0 when Warp/CUDA is unavailable.")
    args = parser.parse_args()

    try:
        import warp as wp
    except Exception as exc:  # pragma: no cover - exercised on GPU host / optional CI environments
        return blocked(f"Could not import NVIDIA Warp runtime: {exc}", args)
    try:
        import numpy as np
    except Exception as exc:  # pragma: no cover
        return blocked(f"Could not import numpy for the Warp smoke harness: {exc}", args)

    try:
        wp.init()
        device = wp.get_device(args.device)
        if not getattr(device, "is_cuda", False):
            return blocked(f"Requested device {args.device!r} is not a CUDA device.", args)
    except Exception as exc:  # pragma: no cover
        return blocked(f"Could not initialize NVIDIA Warp CUDA device {args.device!r}: {exc}", args)

    n = int(args.grid_size)
    if n < 16:
        raise SystemExit("--grid-size must be >= 16")
    cell_m = 440.0 / float(n)
    terrain_np, solid_np, drain_np = build_smoke_domain(n)
    water_np = np.zeros((n, n), dtype=np.float32)
    next_np = np.zeros((n, n), dtype=np.float32)

    terrain = wp.array(terrain_np.reshape(-1), dtype=wp.float32, device=device)
    solid = wp.array(solid_np.reshape(-1), dtype=wp.float32, device=device)
    drain = wp.array(drain_np.reshape(-1), dtype=wp.float32, device=device)
    water_a = wp.array(water_np.reshape(-1), dtype=wp.float32, device=device)
    water_b = wp.array(next_np.reshape(-1), dtype=wp.float32, device=device)

    rain_m_per_s = (args.rain_mm_per_hour / 1000.0) / 3600.0
    rain_per_step = rain_m_per_s * args.rain_amplifier * args.dt
    drain_per_step = 0.045 * args.dt
    conductance = 0.18 * args.dt

    for step in range(args.steps):
        wp.launch(
            shallow_water_step,
            dim=n * n,
            inputs=[terrain, solid, drain, water_a, water_b, n, rain_per_step, drain_per_step, conductance],
            device=device,
        )
        water_a, water_b = water_b, water_a
        if step % 30 == 0:
            wp.synchronize_device(device)
    wp.synchronize_device(device)

    final = water_a.numpy().reshape((n, n))
    wet = final[solid_np < 0.5]
    flooded = wet[wet > 0.10]
    stats = {
        "max_depth_m": float(wet.max(initial=0.0)),
        "mean_depth_m": float(wet.mean() if wet.size else 0.0),
        "flooded_area_m2_gt_10cm": float(flooded.size * cell_m * cell_m),
        "water_volume_m3": float(wet.sum() * cell_m * cell_m),
        "nonzero_cells": int((wet > 0.001).sum()),
    }
    write_pgm(Path(args.output_pgm), final, solid_np)
    report = {
        "status": "passed",
        "passed": True,
        "nvidia_product": "NVIDIA Warp / CUDA",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "stage": args.stage,
        "device": str(device),
        "warp_version": getattr(wp, "__version__", "unknown"),
        "grid_size": n,
        "cell_size_m": cell_m,
        "steps": args.steps,
        "dt_seconds": args.dt,
        "rain_mm_per_hour": args.rain_mm_per_hour,
        "rain_amplifier": args.rain_amplifier,
        "kernel": "shallow_water_step",
        "outputs": {"depth_pgm": args.output_pgm},
        "stats": stats,
        "acceptance": {
            "nonzero_water": stats["nonzero_cells"] > 0,
            "max_depth_positive": stats["max_depth_m"] > 0.0,
            "cuda_device": True,
        },
    }
    write_json(Path(args.output_json), report)
    print(json.dumps({"status": "passed", "stats": stats, "output_json": args.output_json, "output_pgm": args.output_pgm}, indent=2))
    return 0


def build_smoke_domain(n: int):
    import numpy as np

    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    nx = (x / max(1, n - 1)) - 0.5
    ny = (y / max(1, n - 1)) - 0.5
    bowl = 0.65 * (nx * nx + ny * ny)
    south_slope = 0.28 * ny
    street_valley = -0.18 * np.exp(-((nx * 8.0) ** 2)) - 0.10 * np.exp(-(((ny + 0.18) * 9.0) ** 2))
    terrain = (bowl + south_slope + street_valley).astype(np.float32)
    solid = np.zeros((n, n), dtype=np.float32)
    # Building-like blocks: no direct rainfall/water surface. These mirror the
    # committed USD's role as static obstacle/collider smoke, not survey-grade geometry.
    for cx, cy, rx, ry in ((0.28, 0.32, 0.07, 0.08), (-0.25, 0.20, 0.08, 0.06), (0.10, -0.12, 0.06, 0.10), (-0.18, -0.25, 0.07, 0.07)):
        mask = (abs(nx - cx) < rx) & (abs(ny - cy) < ry)
        solid[mask] = 1.0
    drain = np.zeros((n, n), dtype=np.float32)
    drain[(abs(nx) < 0.025) & (ny > -0.35) & (ny < 0.35)] = 1.0
    drain[(abs(ny + 0.18) < 0.025) & (nx > -0.42) & (nx < 0.42)] = 1.0
    return terrain, solid, drain


def write_pgm(path: Path, depth, solid) -> None:
    import numpy as np

    visible = depth.copy()
    visible[solid > 0.5] = 0.0
    max_depth = float(visible.max(initial=0.0))
    if max_depth <= 0.0:
        image = np.zeros_like(visible, dtype=np.uint8)
    else:
        image = np.clip((visible / max_depth) * 255.0, 0, 255).astype(np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        handle.write(f"P5\n{image.shape[1]} {image.shape[0]}\n255\n".encode("ascii"))
        handle.write(image.tobytes())


# Kernels are defined after helper functions so Python can import this script on
# machines without Warp; they are compiled only after import succeeds in main().
try:  # pragma: no cover - optional runtime dependency
    import warp as wp

    @wp.kernel
    def shallow_water_step(
        terrain: wp.array(dtype=wp.float32),
        solid: wp.array(dtype=wp.float32),
        drain: wp.array(dtype=wp.float32),
        water_in: wp.array(dtype=wp.float32),
        water_out: wp.array(dtype=wp.float32),
        n: int,
        rain_per_step: float,
        drain_per_step: float,
        conductance: float,
    ):
        tid = wp.tid()
        x = tid % n
        y = tid // n
        if solid[tid] > 0.5:
            water_out[tid] = 0.0
            return
        h = terrain[tid] + water_in[tid]
        delta = 0.0
        if x > 0:
            j = tid - 1
            delta += terrain[j] + water_in[j] - h
        if x < n - 1:
            j = tid + 1
            delta += terrain[j] + water_in[j] - h
        if y > 0:
            j = tid - n
            delta += terrain[j] + water_in[j] - h
        if y < n - 1:
            j = tid + n
            delta += terrain[j] + water_in[j] - h
        value = water_in[tid] + conductance * delta + rain_per_step
        if drain[tid] > 0.5:
            value -= drain_per_step
        if x == 0 or y == 0 or x == n - 1 or y == n - 1:
            value *= 0.82
        if value < 0.0:
            value = 0.0
        if value > 2.5:
            value = 2.5
        water_out[tid] = value

except Exception:  # pragma: no cover
    pass


if __name__ == "__main__":
    raise SystemExit(main())
