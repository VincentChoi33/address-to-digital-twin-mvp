#!/usr/bin/env python3
"""NVIDIA ovrtx → ovstream readiness smoke server.

This script proves the server-side half of the NVIDIA-only browser path:
ovrtx renders the USD wrapper, the LdrColor CUDA render var is converted from
RGBA8 to an app-owned BGRA8 CUDA buffer, ovstream WebRTC starts with callbacks
registered, and /healthz flips to ready only after that first converted frame.

It does not use WebGL/Three.js and it does not claim browser decode success; a
separate browser/WebRTC validation must still connect to the reported signaling
endpoint and capture the HTML video first frame.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

os.environ.setdefault("OVRTX_SKIP_USD_CHECK", "1")


def _configure_ovrtx_environment() -> None:
    """Set ovrtx plugin paths early, then re-exec so LD_LIBRARY_PATH applies."""
    if os.environ.get("_OVRTX_OVSTREAM_ENV") == "1":
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
    os.environ["_OVRTX_OVSTREAM_ENV"] = "1"
    os.execv(sys.executable, [sys.executable, *sys.argv])


_configure_ovrtx_environment()

import ovstream  # type: ignore  # noqa: E402
import warp as wp  # type: ignore  # noqa: E402
from ovrtx import Device, Renderer, RendererConfig  # type: ignore  # noqa: E402

DEFAULT_RENDER_PRODUCT = "/Render/OVServer/ViewportTexture0"


@wp.kernel
def _rgba_to_bgra(src: wp.array3d(dtype=wp.uint8), dst: wp.array3d(dtype=wp.uint8)):
    y, x, c = wp.tid()
    if c == 0:
        dst[y, x, c] = src[y, x, 2]
    elif c == 2:
        dst[y, x, c] = src[y, x, 0]
    else:
        dst[y, x, c] = src[y, x, c]


class ReadinessState:
    def __init__(self) -> None:
        self.ready = threading.Event()
        self.last_reason = "not ready"


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        state: ReadinessState = self.server.readiness_state  # type: ignore[attr-defined]
        if self.path != "/healthz":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        if state.ready.is_set():
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(503)
            self.end_headers()
            self.wfile.write(state.last_reason.encode("utf-8", errors="replace"))

    def log_message(self, fmt: str, *args: Any) -> None:
        return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start ovstream WebRTC after one ovrtx BGRA frame is ready.")
    parser.add_argument("--stage", required=True, help="Path to the ovrtx composite .usda file.")
    parser.add_argument("--render-product", default=DEFAULT_RENDER_PRODUCT, help="RenderProduct prim path to step.")
    parser.add_argument("--gpu", default="0", help="CUDA GPU index list for ovrtx active_cuda_gpus, e.g. '0'.")
    parser.add_argument("--signaling-port", type=int, default=49100, help="ovstream WebRTC signaling port; 0 lets ovstream choose.")
    parser.add_argument("--stream-port", type=int, default=0, help="ovstream media stream port; 0 uses ovstream default.")
    parser.add_argument("--public-ip", default="127.0.0.1", help="WebRTC public IP advertised by ovstream.")
    parser.add_argument("--health-port", type=int, default=18081, help="HTTP /healthz port for readiness validation.")
    parser.add_argument("--target-fps", type=int, default=30, help="ovstream target FPS.")
    parser.add_argument("--hold-seconds", type=float, default=5.0, help="Seconds to keep ovstream alive after readiness.")
    parser.add_argument("--output-json", default="ovstream_smoke_report.json", help="Report path to write.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    stage = Path(args.stage).resolve()
    state = ReadinessState()
    report: dict[str, Any] = {
        "status": "failed",
        "stage": str(stage),
        "render_product": args.render_product,
        "gpu": args.gpu,
        "started_at_unix": time.time(),
        "ovstream": {
            "server_type": "WEBRTC",
            "video_input": "CUDA",
            "signaling_port": args.signaling_port,
            "stream_port": args.stream_port,
            "public_ip": args.public_ip,
            "target_fps": args.target_fps,
        },
        "healthz": {"port": args.health_port},
        "callbacks_registered_before_start": False,
        "environment": {
            "OVRTX_SKIP_USD_CHECK": os.environ.get("OVRTX_SKIP_USD_CHECK", ""),
            "OVRTX_BIN_PATH": os.environ.get("OVRTX_BIN_PATH", ""),
            "LD_LIBRARY_PATH_contains_ovrtx_plugins": "ovrtx" in os.environ.get("LD_LIBRARY_PATH", "").lower(),
        },
    }
    health_server: ThreadingHTTPServer | None = None
    stream_server: Any | None = None
    ovstream_initialized = False

    try:
        if not stage.exists():
            raise FileNotFoundError(f"stage not found: {stage}")

        health_server = ThreadingHTTPServer(("0.0.0.0", args.health_port), HealthHandler)
        health_server.readiness_state = state  # type: ignore[attr-defined]
        threading.Thread(target=health_server.serve_forever, daemon=True).start()
        report["healthz"]["before_ready"] = probe_health(args.health_port)

        wp.init()
        renderer = Renderer(config=RendererConfig(sync_mode=True, active_cuda_gpus=args.gpu, keep_system_alive=True))
        report["renderer_version"] = str(getattr(renderer, "version", "version unavailable"))
        renderer.open_usd(str(stage))

        conversion = render_first_bgra_frame(renderer, args.render_product, args.gpu)
        report["first_bgra_frame"] = conversion["report"]
        stream_bgra = conversion["buffer"]
        state.last_reason = "first BGRA frame ready"
        state.ready.set()
        report["healthz"]["after_ready"] = probe_health(args.health_port)

        ovstream.initialize(log_min_severity=ovstream.LogLevel.WARNING)
        ovstream_initialized = True
        report["ovstream"]["version"] = str(ovstream.get_version())
        stream_server = ovstream.Server(ovstream.ServerType.WEBRTC)
        stream_server.on_connection = lambda connected: None
        stream_server.on_message = lambda message: None
        stream_server.on_input = lambda event: None
        if hasattr(stream_server, "on_unicode"):
            stream_server.on_unicode = lambda text: None
        report["callbacks_registered_before_start"] = True
        config = ovstream.ServerConfig(
            width=int(conversion["width"]),
            height=int(conversion["height"]),
            target_fps=max(1, int(args.target_fps)),
            stream_port=max(0, int(args.stream_port)),
            video_input=ovstream.VideoInput.CUDA,
            webrtc_signal_port=max(0, int(args.signaling_port)),
            webrtc_public_ip=args.public_ip,
        )
        stream_server.start(config)
        report["ovstream"]["started"] = True

        frame = ovstream.VideoFrame.from_cuda_array(stream_bgra)
        submitted_frames = 0
        transient_frame_errors = 0
        deadline = time.time() + max(0.0, float(args.hold_seconds))
        while time.time() < deadline:
            try:
                stream_server.stream_video(frame)
                submitted_frames += 1
            except Exception as exc:
                transient_frame_errors += 1
                report["ovstream"]["stream_video_last_error"] = repr(exc)
            time.sleep(1.0 / max(1, int(args.target_fps)))
        report["ovstream"]["stream_video_submitted_frames"] = submitted_frames
        report["ovstream"]["stream_video_transient_errors"] = transient_frame_errors
        if submitted_frames > 0:
            report["ovstream"]["stream_video_status"] = "submitted"
        elif transient_frame_errors > 0:
            report["ovstream"]["stream_video_status"] = "transient_without_client"
        else:
            report["ovstream"]["stream_video_status"] = "not_attempted"

        report["status"] = "passed"
        report["reason"] = "ovrtx LdrColor converted to persistent BGRA CUDA buffer; ovstream WebRTC server started; /healthz returned 200 only after the converted frame."
    except Exception as exc:  # pragma: no cover - GPU host script.
        report["status"] = "failed"
        report["error"] = repr(exc)
        report["traceback"] = traceback.format_exc()
    finally:
        if stream_server is not None:
            try:
                stream_server.stop()
            except Exception as exc:
                report.setdefault("shutdown_errors", []).append(f"stream stop: {exc!r}")
            try:
                stream_server.close()
            except Exception as exc:
                report.setdefault("shutdown_errors", []).append(f"stream close: {exc!r}")
        if ovstream_initialized:
            try:
                ovstream.shutdown()
            except Exception as exc:
                report.setdefault("shutdown_errors", []).append(f"ovstream shutdown: {exc!r}")
        if health_server is not None:
            try:
                health_server.shutdown()
                health_server.server_close()
            except Exception as exc:
                report.setdefault("shutdown_errors", []).append(f"health shutdown: {exc!r}")
        report["finished_at_unix"] = time.time()
        report["elapsed_seconds"] = round(report["finished_at_unix"] - report["started_at_unix"], 6)
        output_json = Path(args.output_json)
        output_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))

    return 0 if report["status"] == "passed" else 1


def render_first_bgra_frame(renderer: Any, render_product: str, gpu: str) -> dict[str, Any]:
    step_started = time.time()
    products = renderer.step(render_products={render_product}, delta_time=1.0 / 60.0)
    try:
        ctx = products.__enter__() if hasattr(products, "__enter__") else products
        if render_product not in ctx:
            available = list(ctx.keys()) if hasattr(ctx, "keys") else []
            raise RuntimeError(f"render product not found: {render_product}; available={available}")
        product = ctx[render_product]
        for frame in getattr(product, "frames", []):
            render_vars = getattr(frame, "render_vars", {})
            if "LdrColor" not in render_vars:
                continue
            with render_vars["LdrColor"].map(device=Device.CUDA) as mapped:
                src = wp.from_dlpack(mapped)
                shape = tuple(int(dim) for dim in src.shape)
                if len(shape) != 3 or shape[2] != 4:
                    raise RuntimeError(f"expected LdrColor HxWx4, got shape={shape}")
                height, width = shape[0], shape[1]
                dst = wp.empty(shape=shape, dtype=wp.uint8, device=f"cuda:{gpu.split(',')[0].strip() or '0'}")
                wp.launch(_rgba_to_bgra, dim=shape, inputs=[src, dst], device=dst.device)
                wp.synchronize_device(dst.device)
                return {
                    "buffer": dst,
                    "width": width,
                    "height": height,
                    "report": {
                        "render_var": "LdrColor",
                        "source_format": "RGBA8 CUDA",
                        "stream_format": "BGRA8 CUDA",
                        "shape": list(shape),
                        "dtype": str(src.dtype),
                        "step_seconds": round(time.time() - step_started, 6),
                        "copy_rule": "red/blue channels swapped into persistent app-owned warp CUDA buffer",
                    },
                }
        raise RuntimeError("No LdrColor render var produced by ovrtx.")
    finally:
        if hasattr(products, "__exit__"):
            products.__exit__(None, None, None)


def probe_health(port: int) -> dict[str, Any]:
    url = f"http://127.0.0.1:{port}/healthz"
    try:
        with urlopen(url, timeout=2) as response:
            body = response.read().decode("utf-8", errors="replace")
            return {"http_status": int(response.status), "body": body}
    except HTTPError as exc:
        return {"http_status": int(exc.code), "body": exc.read().decode("utf-8", errors="replace")}
    except URLError as exc:
        return {"http_status": None, "error": repr(exc)}


if __name__ == "__main__":
    raise SystemExit(main())
