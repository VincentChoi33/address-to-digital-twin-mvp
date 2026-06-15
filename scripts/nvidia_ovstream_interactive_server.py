#!/usr/bin/env python3
"""Interactive NVIDIA ovrtx -> ovstream server for the address twin.

Unlike the smoke server, this keeps a real ovstream WebRTC session alive and
accepts browser-side custom messages/native input.  The server owns the USD
stage mutation: camera presets/orbit/zoom are applied through ovrtx
``Renderer.write_attribute`` and every rendered CUDA LdrColor frame is converted
with NVIDIA Warp into the BGRA CUDA buffer expected by ovstream.

Supported AppStreamer messages:
  {"event_type":"camera.set", "id":"...", "payload":{"preset":"home|top|north|east|close"}}
  {"event_type":"camera.set", "payload":{"translate":[x,y,z], "rotateXYZ":[rx,ry,rz]}}
  {"event_type":"camera.orbit", "payload":{"yawDeltaDeg":15, "pitchDeltaDeg":0, "zoomFactor":1}}
  {"event_type":"camera.zoom", "payload":{"factor":0.85}}
  {"event_type":"layer.visibility", "payload":{"layer":"flood", "visible":true}}

The layer command is acknowledged and recorded for UI/health telemetry; if the
flood prim is available the server also attempts a best-effort USD visibility
write.  Camera interaction is the primary verified interactive path.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import math
import os
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

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

import numpy as np  # type: ignore  # noqa: E402
import ovstream  # type: ignore  # noqa: E402
import warp as wp  # type: ignore  # noqa: E402
from ovrtx import Device, Renderer, RendererConfig  # type: ignore  # noqa: E402

DEFAULT_RENDER_PRODUCT = "/Render/OVServer/ViewportTexture0"
DEFAULT_CAMERA_PRIM = "/OVCamera"
DEFAULT_FLOOD_PRIM = "/sadang_317_6/Geometry/FloodScenario_Cloudburst_WaterReference"

HOME_TRANSLATE = [1.155714, 108.644012, 185.86432]
HOME_ROTATE = [-29.376483, 0.0, 0.0]


@wp.kernel
def _rgba_to_bgra(src: wp.array3d(dtype=wp.uint8), dst: wp.array3d(dtype=wp.uint8)):
    y, x, c = wp.tid()
    if c == 0:
        dst[y, x, c] = src[y, x, 2]
    elif c == 2:
        dst[y, x, c] = src[y, x, 0]
    else:
        dst[y, x, c] = src[y, x, c]


@dataclass
class CameraPose:
    translate: list[float] = field(default_factory=lambda: HOME_TRANSLATE.copy())
    rotate_xyz: list[float] = field(default_factory=lambda: HOME_ROTATE.copy())
    yaw_deg: float = 0.0
    pitch_deg: float = -29.376483
    distance_m: float = 185.0
    height_m: float = 108.0
    target: list[float] = field(default_factory=lambda: [0.0, 8.0, 0.0])
    dirty: bool = True

    def snapshot(self) -> dict[str, Any]:
        return {
            "translate": [round(v, 6) for v in self.translate],
            "rotateXYZ": [round(v, 6) for v in self.rotate_xyz],
            "yawDeg": round(self.yaw_deg, 4),
            "pitchDeg": round(self.pitch_deg, 4),
            "distanceM": round(self.distance_m, 4),
            "heightM": round(self.height_m, 4),
        }

    def set_pose(self, translate: list[float] | None = None, rotate_xyz: list[float] | None = None) -> None:
        if translate is not None:
            self.translate = [float(v) for v in translate[:3]]
            dx = self.translate[0] - self.target[0]
            dz = self.translate[2] - self.target[2]
            self.distance_m = max(1.0, math.sqrt(dx * dx + dz * dz))
            self.height_m = float(self.translate[1])
            self.yaw_deg = math.degrees(math.atan2(dx, dz)) if self.distance_m > 0 else self.yaw_deg
        if rotate_xyz is not None:
            self.rotate_xyz = [float(v) for v in rotate_xyz[:3]]
            self.pitch_deg = float(self.rotate_xyz[0])
            self.yaw_deg = float(self.rotate_xyz[1])
        self.dirty = True

    def preset(self, name: str) -> None:
        normalized = name.strip().lower()
        presets: dict[str, tuple[list[float], list[float], float, float, float]] = {
            "home": (HOME_TRANSLATE.copy(), HOME_ROTATE.copy(), 0.0, -29.376483, 185.0),
            "north": ([0.0, 112.0, 218.0], [-31.0, 0.0, 0.0], 0.0, -31.0, 218.0),
            "east": ([218.0, 112.0, 0.0], [-31.0, 90.0, 0.0], 90.0, -31.0, 218.0),
            "south": ([0.0, 112.0, -218.0], [-31.0, 180.0, 0.0], 180.0, -31.0, 218.0),
            "west": ([-218.0, 112.0, 0.0], [-31.0, -90.0, 0.0], -90.0, -31.0, 218.0),
            "top": ([0.0, 260.0, 0.1], [-89.5, 0.0, 0.0], 0.0, -89.5, 1.0),
            "close": ([0.0, 70.0, 122.0], [-32.0, 0.0, 0.0], 0.0, -32.0, 122.0),
        }
        translate, rotate, yaw, pitch, distance = presets.get(normalized, presets["home"])
        self.translate = translate
        self.rotate_xyz = rotate
        self.yaw_deg = yaw
        self.pitch_deg = pitch
        self.distance_m = distance
        self.height_m = translate[1]
        self.dirty = True

    def orbit(self, yaw_delta_deg: float = 0.0, pitch_delta_deg: float = 0.0, zoom_factor: float = 1.0) -> None:
        self.yaw_deg = (self.yaw_deg + float(yaw_delta_deg) + 540.0) % 360.0 - 180.0
        self.pitch_deg = max(-86.0, min(-12.0, self.pitch_deg + float(pitch_delta_deg)))
        self.distance_m = max(35.0, min(420.0, self.distance_m * max(0.2, min(4.0, float(zoom_factor)))))
        # Keep the demo stable: pitch changes view angle; height follows distance enough to avoid ground clipping.
        self.height_m = max(36.0, min(265.0, abs(math.sin(math.radians(self.pitch_deg))) * self.distance_m + 18.0))
        yaw = math.radians(self.yaw_deg)
        self.translate = [
            self.target[0] + math.sin(yaw) * self.distance_m,
            self.height_m,
            self.target[2] + math.cos(yaw) * self.distance_m,
        ]
        self.rotate_xyz = [self.pitch_deg, self.yaw_deg, 0.0]
        self.dirty = True


@dataclass
class InteractiveState:
    ready: threading.Event = field(default_factory=threading.Event)
    stop: threading.Event = field(default_factory=threading.Event)
    lock: threading.RLock = field(default_factory=threading.RLock)
    last_reason: str = "not ready"
    connected: bool = False
    started_at_unix: float = field(default_factory=time.time)
    frames_rendered: int = 0
    frames_submitted: int = 0
    transient_frame_errors: int = 0
    camera_writes: int = 0
    input_events: int = 0
    custom_messages: int = 0
    last_input: dict[str, Any] | None = None
    last_message: dict[str, Any] | str | None = None
    last_ack: dict[str, Any] | None = None
    last_error: str | None = None
    layer_visibility: dict[str, bool] = field(default_factory=lambda: {"flood": True})
    camera: CameraPose = field(default_factory=CameraPose)
    mouse_drag_active: bool = False
    last_mouse_xy: tuple[int, int] | None = None

    def health_payload(self) -> dict[str, Any]:
        with self.lock:
            return {
                "ready": self.ready.is_set(),
                "reason": self.last_reason,
                "connected": self.connected,
                "uptimeSeconds": round(time.time() - self.started_at_unix, 3),
                "framesRendered": self.frames_rendered,
                "framesSubmitted": self.frames_submitted,
                "transientFrameErrors": self.transient_frame_errors,
                "cameraWrites": self.camera_writes,
                "inputEvents": self.input_events,
                "customMessages": self.custom_messages,
                "camera": self.camera.snapshot(),
                "layerVisibility": dict(self.layer_visibility),
                "lastInput": self.last_input,
                "lastMessage": self.last_message,
                "lastAck": self.last_ack,
                "lastError": self.last_error,
            }


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        state: InteractiveState = self.server.interactive_state  # type: ignore[attr-defined]
        if self.path not in {"/healthz", "/health"}:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"not found")
            return
        payload = state.health_payload()
        self.send_response(200 if payload["ready"] else 503)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt: str, *args: Any) -> None:
        return


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start an interactive NVIDIA ovrtx -> ovstream WebRTC server.")
    parser.add_argument("--stage", required=True, help="Path to the ovrtx composite .usda file.")
    parser.add_argument("--render-product", default=DEFAULT_RENDER_PRODUCT, help="RenderProduct prim path to step.")
    parser.add_argument("--camera-prim", default=DEFAULT_CAMERA_PRIM, help="Camera prim path to mutate.")
    parser.add_argument("--flood-prim", default=DEFAULT_FLOOD_PRIM, help="Flood/water prim path for best-effort visibility toggles.")
    parser.add_argument("--gpu", default="0", help="CUDA GPU index list for ovrtx active_cuda_gpus, e.g. '0'.")
    parser.add_argument("--signaling-port", type=int, default=49100, help="ovstream WebRTC signaling port; 0 lets ovstream choose.")
    parser.add_argument("--stream-port", type=int, default=0, help="ovstream media stream port; 0 uses ovstream default.")
    parser.add_argument("--public-ip", default="127.0.0.1", help="WebRTC public IP advertised by ovstream.")
    parser.add_argument("--health-port", type=int, default=18081, help="HTTP /healthz JSON port.")
    parser.add_argument("--target-fps", type=int, default=8, help="Target render/stream FPS after warmup.")
    parser.add_argument("--hold-seconds", type=float, default=3600.0, help="Seconds to keep ovstream alive after readiness.")
    parser.add_argument("--output-json", default="ovstream_interactive_report.json", help="Report path to write.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    stage = Path(args.stage).resolve()
    state = InteractiveState()
    report: dict[str, Any] = {
        "status": "failed",
        "mode": "interactive",
        "stage": str(stage),
        "render_product": args.render_product,
        "camera_prim": args.camera_prim,
        "flood_prim": args.flood_prim,
        "gpu": args.gpu,
        "started_at_unix": state.started_at_unix,
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
        "commands": ["camera.set", "camera.orbit", "camera.zoom", "layer.visibility"],
        "environment": {
            "OVRTX_SKIP_USD_CHECK": os.environ.get("OVRTX_SKIP_USD_CHECK", ""),
            "OVRTX_BIN_PATH": os.environ.get("OVRTX_BIN_PATH", ""),
            "LD_LIBRARY_PATH_contains_ovrtx_plugins": "ovrtx" in os.environ.get("LD_LIBRARY_PATH", "").lower(),
        },
    }
    health_server: ThreadingHTTPServer | None = None
    stream_server: Any | None = None
    ovstream_initialized = False

    def send_ack(event_type: str, payload: dict[str, Any], correlation_id: str | None = None) -> None:
        nonlocal stream_server
        message = {"event_type": event_type, "id": correlation_id or new_id(), "payload": payload}
        with state.lock:
            state.last_ack = message
        if stream_server is not None:
            try:
                stream_server.send_message(json.dumps(message, ensure_ascii=False))
            except Exception as exc:  # pragma: no cover - GPU host callback path.
                with state.lock:
                    state.last_error = f"send_ack: {exc!r}"

    try:
        if not stage.exists():
            raise FileNotFoundError(f"stage not found: {stage}")

        health_server = ReusableThreadingHTTPServer(("0.0.0.0", args.health_port), HealthHandler)
        health_server.interactive_state = state  # type: ignore[attr-defined]
        threading.Thread(target=health_server.serve_forever, daemon=True).start()

        wp.init()
        renderer = Renderer(config=RendererConfig(sync_mode=True, active_cuda_gpus=args.gpu, keep_system_alive=True))
        report["renderer_version"] = str(getattr(renderer, "version", "version unavailable"))
        renderer.open_usd(str(stage))
        apply_camera(renderer, args.camera_prim, state)

        first = render_bgra_frame(renderer, args.render_product, args.gpu, None)
        report["first_bgra_frame"] = first["report"]

        ovstream.initialize(log_min_severity=ovstream.LogLevel.WARNING)
        ovstream_initialized = True
        report["ovstream"]["version"] = str(ovstream.get_version())
        stream_server = ovstream.Server(ovstream.ServerType.WEBRTC)
        stream_server.on_connection = lambda connected: handle_connection(state, bool(connected), send_ack)
        stream_server.on_input = lambda event: handle_input(event, state, send_ack)
        stream_server.on_message = lambda message: handle_message(message, state, renderer, args, send_ack)
        if hasattr(stream_server, "on_unicode"):
            stream_server.on_unicode = lambda text: handle_unicode(text, state, send_ack)
        report["callbacks_registered_before_start"] = True

        config = ovstream.ServerConfig(
            width=int(first["width"]),
            height=int(first["height"]),
            target_fps=max(1, int(args.target_fps)),
            stream_port=max(0, int(args.stream_port)),
            video_input=ovstream.VideoInput.CUDA,
            webrtc_signal_port=max(0, int(args.signaling_port)),
            webrtc_public_ip=args.public_ip,
        )
        stream_server.start(config)
        with state.lock:
            state.ready.set()
            state.last_reason = "ovrtx frame ready; ovstream WebRTC server started; interactive callbacks registered"
        report["ovstream"]["started"] = True
        send_ack("server.ready", {"camera": state.camera.snapshot(), "commands": report["commands"]})

        frame_interval = 1.0 / max(1, int(args.target_fps))
        deadline = time.time() + max(0.0, float(args.hold_seconds))
        reuse_buffer: Any | None = first["buffer"]
        while time.time() < deadline and not state.stop.is_set():
            loop_started = time.time()
            try:
                with state.lock:
                    camera_dirty = state.camera.dirty
                if camera_dirty:
                    apply_camera(renderer, args.camera_prim, state)

                rendered = render_bgra_frame(renderer, args.render_product, args.gpu, reuse_buffer)
                reuse_buffer = rendered["buffer"]
                frame = ovstream.VideoFrame.from_cuda_array(reuse_buffer)
                with state.lock:
                    state.frames_rendered += 1
                try:
                    stream_server.stream_video(frame)
                    with state.lock:
                        state.frames_submitted += 1
                except Exception as exc:
                    with state.lock:
                        state.transient_frame_errors += 1
                        state.last_error = f"stream_video: {exc!r}"
            except Exception as exc:  # pragma: no cover - GPU host loop path.
                with state.lock:
                    state.last_error = f"render_loop: {exc!r}"
                time.sleep(0.25)

            elapsed = time.time() - loop_started
            if elapsed < frame_interval:
                time.sleep(frame_interval - elapsed)

        report["status"] = "passed"
        report["reason"] = "interactive ovrtx camera mutation + Warp BGRA CUDA conversion + ovstream WebRTC loop completed."
    except Exception as exc:  # pragma: no cover - GPU host script.
        report["status"] = "failed"
        report["error"] = repr(exc)
        report["traceback"] = traceback.format_exc()
        with state.lock:
            state.last_error = repr(exc)
    finally:
        report["final_state"] = state.health_payload()
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
        output_json.parent.mkdir(parents=True, exist_ok=True)
        output_json.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps(report, indent=2, ensure_ascii=False))

    return 0 if report["status"] == "passed" else 1


def render_bgra_frame(renderer: Any, render_product: str, gpu: str, reuse_buffer: Any | None) -> dict[str, Any]:
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
                dst = reuse_buffer
                if dst is None or tuple(int(dim) for dim in dst.shape) != shape:
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
                        "copy_rule": "red/blue channels swapped into app-owned warp CUDA buffer",
                    },
                }
        raise RuntimeError("No LdrColor render var produced by ovrtx.")
    finally:
        if hasattr(products, "__exit__"):
            products.__exit__(None, None, None)


def apply_camera(renderer: Any, camera_prim: str, state: InteractiveState) -> None:
    with state.lock:
        translate = np.array([state.camera.translate], dtype=np.float64)
        rotate = np.array([state.camera.rotate_xyz], dtype=np.float64)
    renderer.write_attribute([camera_prim], "xformOp:translate", translate)
    renderer.write_attribute([camera_prim], "xformOp:rotateXYZ", rotate)
    with state.lock:
        state.camera.dirty = False
        state.camera_writes += 1


def apply_layer_visibility(renderer: Any, prim_path: str, visible: bool, state: InteractiveState) -> str:
    # ovrtx write_attribute support for token attrs can vary by build.  Keep the
    # server interactive even when this best-effort mutation is unavailable.
    try:
        value = "inherited" if visible else "invisible"
        renderer.write_attribute([prim_path], "visibility", value)
        return "usd visibility write attempted"
    except Exception as exc:  # pragma: no cover - build-specific GPU path.
        with state.lock:
            state.last_error = f"layer.visibility: {exc!r}"
        return f"recorded only; USD visibility write unavailable: {exc!r}"


def handle_connection(state: InteractiveState, connected: bool, send_ack: Any) -> None:
    with state.lock:
        state.connected = connected
        state.last_reason = "client connected" if connected else "client disconnected; server still ready"
    send_ack("server.connection", {"connected": connected})


def handle_input(event: Any, state: InteractiveState, send_ack: Any) -> None:
    input_payload = event_to_dict(event)
    with state.lock:
        state.input_events += 1
        state.last_input = input_payload

    mouse = getattr(event, "mouse", None)
    keyboard = getattr(event, "keyboard", None)
    if mouse is not None:
        handle_mouse(mouse, state)
    if keyboard is not None:
        handle_keyboard(keyboard, state)

    if state.input_events % 20 == 1:
        send_ack("server.input", {"count": state.input_events, "camera": state.camera.snapshot()})


def handle_mouse(mouse: Any, state: InteractiveState) -> None:
    mouse_type = enum_name(getattr(mouse, "type", None)).lower()
    x = int(getattr(mouse, "x", 0) or 0)
    y = int(getattr(mouse, "y", 0) or 0)
    if "button" in mouse_type:
        down = "down" in enum_name(getattr(mouse, "button_state", None)).lower()
        with state.lock:
            state.mouse_drag_active = down
            state.last_mouse_xy = (x, y)
    elif "move" in mouse_type:
        with state.lock:
            previous = state.last_mouse_xy
            dragging = state.mouse_drag_active
            state.last_mouse_xy = (x, y)
        if dragging and previous is not None:
            dx = x - previous[0]
            dy = y - previous[1]
            with state.lock:
                state.camera.orbit(yaw_delta_deg=dx * 0.16, pitch_delta_deg=-dy * 0.08, zoom_factor=1.0)
    elif "wheel" in mouse_type:
        scroll_y = float(getattr(mouse, "scroll_y", 0.0) or 0.0)
        data = float(getattr(mouse, "data", 0.0) or 0.0)
        delta = scroll_y if scroll_y != 0 else data
        factor = 0.88 if delta > 0 else 1.14
        with state.lock:
            state.camera.orbit(zoom_factor=factor)


def handle_keyboard(keyboard: Any, state: InteractiveState) -> None:
    down = "down" in enum_name(getattr(keyboard, "key_state", None)).lower()
    if not down:
        return
    code = int(getattr(keyboard, "key_code", 0) or 0)
    with state.lock:
        if code in {72, 82}:  # H/R
            state.camera.preset("home")
        elif code == 84:  # T
            state.camera.preset("top")
        elif code in {37, 65}:  # left/A
            state.camera.orbit(yaw_delta_deg=-12)
        elif code in {39, 68}:  # right/D
            state.camera.orbit(yaw_delta_deg=12)
        elif code in {38, 87}:  # up/W
            state.camera.orbit(zoom_factor=0.86)
        elif code in {40, 83}:  # down/S
            state.camera.orbit(zoom_factor=1.16)


def handle_message(message: Any, state: InteractiveState, renderer: Any, args: argparse.Namespace, send_ack: Any) -> None:
    parsed = parse_message(message)
    correlation_id = parsed.get("id") if isinstance(parsed.get("id"), str) else None
    event_type = str(parsed.get("event_type") or parsed.get("type") or "unknown")
    payload = parsed.get("payload") if isinstance(parsed.get("payload"), dict) else {}
    with state.lock:
        state.custom_messages += 1
        state.last_message = parsed

    result: dict[str, Any] = {"handled": False, "event_type": event_type}
    try:
        if event_type == "camera.set":
            preset = payload.get("preset")
            translate = payload.get("translate")
            rotate = payload.get("rotateXYZ") or payload.get("rotate_xyz")
            with state.lock:
                if isinstance(preset, str):
                    state.camera.preset(preset)
                else:
                    state.camera.set_pose(
                        translate=list(translate) if is_number_triplet(translate) else None,
                        rotate_xyz=list(rotate) if is_number_triplet(rotate) else None,
                    )
                result = {"handled": True, "event_type": event_type, "camera": state.camera.snapshot()}
        elif event_type == "camera.orbit":
            yaw_delta = number(payload.get("yawDeltaDeg"), 0.0)
            pitch_delta = number(payload.get("pitchDeltaDeg"), 0.0)
            zoom_factor = number(payload.get("zoomFactor"), 1.0)
            with state.lock:
                state.camera.orbit(yaw_delta_deg=yaw_delta, pitch_delta_deg=pitch_delta, zoom_factor=zoom_factor)
                result = {"handled": True, "event_type": event_type, "camera": state.camera.snapshot()}
        elif event_type == "camera.zoom":
            zoom_factor = number(payload.get("factor"), 1.0)
            with state.lock:
                state.camera.orbit(zoom_factor=zoom_factor)
                result = {"handled": True, "event_type": event_type, "camera": state.camera.snapshot()}
        elif event_type == "layer.visibility":
            layer = str(payload.get("layer") or "flood")
            visible = bool(payload.get("visible", True))
            with state.lock:
                state.layer_visibility[layer] = visible
            visibility_result = apply_layer_visibility(renderer, args.flood_prim, visible, state) if layer == "flood" else "recorded only"
            result = {
                "handled": True,
                "event_type": event_type,
                "layer": layer,
                "visible": visible,
                "result": visibility_result,
            }
        elif event_type == "server.stop":
            state.stop.set()
            result = {"handled": True, "event_type": event_type, "stopping": True}
    except Exception as exc:  # pragma: no cover - GPU host callback path.
        result = {"handled": False, "event_type": event_type, "error": repr(exc)}
        with state.lock:
            state.last_error = f"handle_message: {exc!r}"
    send_ack("server.ack", result, correlation_id)


def handle_unicode(text: str, state: InteractiveState, send_ack: Any) -> None:
    with state.lock:
        state.custom_messages += 1
        state.last_message = {"unicode": text}
    send_ack("server.unicode", {"text": text})


def parse_message(message: Any) -> dict[str, Any]:
    if isinstance(message, bytes):
        message = message.decode("utf-8", errors="replace")
    if isinstance(message, str):
        try:
            parsed = json.loads(message)
            return parsed if isinstance(parsed, dict) else {"payload": {"value": parsed}}
        except json.JSONDecodeError:
            return {"event_type": "text", "payload": {"text": message}}
    if dataclasses.is_dataclass(message):
        return dataclasses.asdict(message)
    if isinstance(message, dict):
        return message
    data = getattr(message, "data", None)
    if data is not None:
        return parse_message(data)
    return {"event_type": "unknown", "payload": {"repr": repr(message)}}


def event_to_dict(event: Any) -> dict[str, Any]:
    if dataclasses.is_dataclass(event):
        return sanitize_dataclass(dataclasses.asdict(event))
    return {"repr": repr(event)}


def sanitize_dataclass(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: sanitize_dataclass(item) for key, item in value.items() if item is not None}
    if isinstance(value, list):
        return [sanitize_dataclass(item) for item in value]
    if hasattr(value, "name"):
        return value.name
    return value


def enum_name(value: Any) -> str:
    return str(getattr(value, "name", value or ""))


def number(value: Any, fallback: float) -> float:
    try:
        if value is None:
            return fallback
        return float(value)
    except (TypeError, ValueError):
        return fallback


def is_number_triplet(value: Any) -> bool:
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return False
    try:
        [float(value[0]), float(value[1]), float(value[2])]
        return True
    except (TypeError, ValueError):
        return False


def new_id() -> str:
    return f"server-{int(time.time() * 1000)}"


if __name__ == "__main__":
    raise SystemExit(main())
