#!/usr/bin/env python3
"""NVIDIA ovrtx first-frame smoke test for a generated OpenUSD viewer wrapper.

This script intentionally uses NVIDIA ovrtx for rendering. It does not render USD
in the browser and it does not use WebGL/Three.js. It saves one CPU-readback PPM
only as validation evidence after ovrtx produced LdrColor.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

os.environ.setdefault("OVRTX_SKIP_USD_CHECK", "1")


def _configure_ovrtx_environment() -> None:
    """Set ovrtx plugin paths early, then re-exec so LD_LIBRARY_PATH applies."""
    if os.environ.get("_OVRTX_FIRST_FRAME_ENV") == "1":
        return
    try:
        import ovrtx  # type: ignore
    except Exception:
        return

    package_dir = Path(ovrtx.__file__).resolve().parent
    bin_dir = package_dir / "bin"
    plugins_dir = bin_dir / "plugins"
    if bin_dir.is_dir():
        os.environ.setdefault("OVRTX_BIN_PATH", str(bin_dir))
    if plugins_dir.is_dir():
        ld_parts = [part for part in os.environ.get("LD_LIBRARY_PATH", "").split(":") if part]
        if str(plugins_dir) not in ld_parts:
            os.environ["LD_LIBRARY_PATH"] = ":".join([str(plugins_dir), *ld_parts])
    os.environ["_OVRTX_FIRST_FRAME_ENV"] = "1"
    os.execv(sys.executable, [sys.executable, *sys.argv])


_configure_ovrtx_environment()

import numpy as np  # noqa: E402
from ovrtx import Device, Renderer, RendererConfig  # type: ignore  # noqa: E402

DEFAULT_RENDER_PRODUCT = "/Render/OVServer/ViewportTexture0"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render one ovrtx LdrColor frame from a composite USD stage.")
    parser.add_argument("--stage", required=True, help="Path to the ovrtx composite .usda file.")
    parser.add_argument("--render-product", default=DEFAULT_RENDER_PRODUCT, help="RenderProduct prim path to step.")
    parser.add_argument("--gpu", default="0", help="CUDA GPU index list for ovrtx active_cuda_gpus, e.g. '0'.")
    parser.add_argument("--warmup-frames", type=int, default=4, help="Maximum frames to step before declaring failure.")
    parser.add_argument("--output-json", default="ovrtx_first_frame_report.json", help="Report path to write.")
    parser.add_argument("--output-ppm", default="ovrtx_first_frame.ppm", help="PPM image path to write when LdrColor is available.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    stage = Path(args.stage).resolve()
    report: dict[str, Any] = {
        "status": "failed",
        "stage": str(stage),
        "render_product": args.render_product,
        "gpu": args.gpu,
        "started_at_unix": time.time(),
        "environment": {
            "OVRTX_SKIP_USD_CHECK": os.environ.get("OVRTX_SKIP_USD_CHECK", ""),
            "OVRTX_BIN_PATH": os.environ.get("OVRTX_BIN_PATH", ""),
            "LD_LIBRARY_PATH_contains_ovrtx_plugins": "ovrtx" in os.environ.get("LD_LIBRARY_PATH", "").lower(),
        },
        "frames": [],
    }

    try:
        if not stage.exists():
            raise FileNotFoundError(f"stage not found: {stage}")

        renderer = Renderer(config=RendererConfig(sync_mode=True, active_cuda_gpus=args.gpu, keep_system_alive=True))
        report["renderer_version"] = str(getattr(renderer, "version", "version unavailable"))
        renderer.open_usd(str(stage))

        last_error = None
        for frame_index in range(max(1, args.warmup_frames)):
            step_started = time.time()
            products = renderer.step(render_products={args.render_product}, delta_time=1.0 / 60.0)
            try:
                ctx = products.__enter__() if hasattr(products, "__enter__") else products
                frame_report, pixels = inspect_products(ctx, args.render_product)
                frame_report["frame_index"] = frame_index
                frame_report["step_seconds"] = round(time.time() - step_started, 6)
                report["frames"].append(frame_report)
                if pixels is not None:
                    write_ppm(Path(args.output_ppm), pixels)
                    frame_report["output_ppm"] = str(Path(args.output_ppm).resolve())
                    report["status"] = "passed" if frame_report.get("nonblank_rgb") else "failed"
                    report["reason"] = "LdrColor frame produced" if frame_report.get("nonblank_rgb") else "LdrColor frame was present but visually blank"
                    break
            finally:
                if hasattr(products, "__exit__"):
                    products.__exit__(None, None, None)
        else:
            last_error = "No LdrColor frame was produced by ovrtx within warmup frames."

        if report["status"] != "passed" and "reason" not in report:
            report["reason"] = last_error or "ovrtx frame validation failed."
    except Exception as exc:  # pragma: no cover - this script runs on NVIDIA hosts, not local CI.
        report["status"] = "failed"
        report["error"] = repr(exc)
        report["traceback"] = traceback.format_exc()
    finally:
        report["finished_at_unix"] = time.time()
        report["elapsed_seconds"] = round(report["finished_at_unix"] - report["started_at_unix"], 6)
        output_json = Path(args.output_json)
        output_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))

    return 0 if report["status"] == "passed" else 1


def inspect_products(ctx: Any, render_product: str) -> tuple[dict[str, Any], np.ndarray[Any, Any] | None]:
    frame_report: dict[str, Any] = {"render_product_found": render_product in ctx}
    if render_product not in ctx:
        frame_report["available_products"] = list(ctx.keys()) if hasattr(ctx, "keys") else []
        return frame_report, None

    product = ctx[render_product]
    frame_count = 0
    last_names: list[str] = []
    for frame in getattr(product, "frames", []):
        frame_count += 1
        render_vars = getattr(frame, "render_vars", {})
        last_names = list(render_vars.keys()) if hasattr(render_vars, "keys") else list(render_vars)
        if "LdrColor" not in render_vars:
            continue
        with render_vars["LdrColor"].map(device=Device.CPU) as mapped:
            pixels = np.from_dlpack(mapped).copy()
        frame_report.update(pixel_stats(pixels))
        frame_report["render_vars"] = last_names
        return frame_report, pixels

    frame_report["frame_count"] = frame_count
    frame_report["render_vars"] = last_names
    return frame_report, None


def pixel_stats(pixels: np.ndarray[Any, Any]) -> dict[str, Any]:
    array = np.asarray(pixels)
    rgb = array[..., :3] if array.ndim >= 3 and array.shape[-1] >= 3 else array
    stats: dict[str, Any] = {
        "shape": list(array.shape),
        "dtype": str(array.dtype),
        "min": number(array.min()) if array.size else None,
        "max": number(array.max()) if array.size else None,
        "mean": number(array.mean()) if array.size else None,
        "rgb_min": number(rgb.min()) if rgb.size else None,
        "rgb_max": number(rgb.max()) if rgb.size else None,
        "rgb_mean": number(rgb.mean()) if rgb.size else None,
        "nonzero_rgb_pixels": int(np.count_nonzero(np.any(rgb != 0, axis=-1))) if rgb.ndim >= 3 else int(np.count_nonzero(rgb)),
    }
    stats["nonblank_rgb"] = bool(rgb.size and stats["rgb_max"] is not None and stats["rgb_max"] > stats["rgb_min"])
    return stats


def write_ppm(path: Path, pixels: np.ndarray[Any, Any]) -> None:
    array = np.asarray(pixels)
    if array.ndim != 3 or array.shape[2] < 3:
        raise ValueError(f"expected HxWxC image with at least three channels, got {array.shape}")
    rgb = array[:, :, :3]
    if rgb.dtype != np.uint8:
        rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    path.write_bytes(b"P6\n%d %d\n255\n" % (rgb.shape[1], rgb.shape[0]) + rgb.tobytes())


def number(value: Any) -> float | int:
    scalar = value.item() if hasattr(value, "item") else value
    if isinstance(scalar, float):
        return round(scalar, 6)
    return int(scalar)


if __name__ == "__main__":
    raise SystemExit(main())
