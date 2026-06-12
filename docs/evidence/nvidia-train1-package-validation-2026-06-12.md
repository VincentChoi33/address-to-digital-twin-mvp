# NVIDIA train1 package validation — 2026-06-12

Host: train1 / gpu1

## npm run nvidia:validate

```json
{
  "package_dir": "/home/choihy/address-to-digital-twin-mvp-nvidia-check/src/samples/sadang_317_6/omniverse",
  "status": "passed",
  "checks": [
    {
      "id": "HANDOFF.STATUS.001",
      "status": "passed",
      "evidence": "handoff status=ready_for_gpu_host"
    },
    {
      "id": "HANDOFF.FILE.sadang_317_6.usda",
      "status": "passed",
      "evidence": "sadang_317_6.usda size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.sadang_317_6.ovrtx_viewer.usda",
      "status": "passed",
      "evidence": "sadang_317_6.ovrtx_viewer.usda size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.nvidia_ovrtx_first_frame.py",
      "status": "passed",
      "evidence": "nvidia_ovrtx_first_frame.py size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.nvidia_ovstream_smoke_server.py",
      "status": "passed",
      "evidence": "nvidia_ovstream_smoke_server.py size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.nvidia_stack_manifest.json",
      "status": "passed",
      "evidence": "nvidia_stack_manifest.json size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.nvidia_runtime_preflight.json",
      "status": "passed",
      "evidence": "nvidia_runtime_preflight.json size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.nvidia_runtime_preflight.md",
      "status": "passed",
      "evidence": "nvidia_runtime_preflight.md size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.simready_minimum_report.json",
      "status": "passed",
      "evidence": "simready_minimum_report.json size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.usdchecker_report.txt",
      "status": "passed",
      "evidence": "usdchecker_report.txt size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.README.md",
      "status": "passed",
      "evidence": "README.md size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.NVIDIA_GPU_HOST_RUNBOOK.md",
      "status": "passed",
      "evidence": "NVIDIA_GPU_HOST_RUNBOOK.md size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.ovstream_viewer_contract.json",
      "status": "passed",
      "evidence": "ovstream_viewer_contract.json size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.OVSTREAM_VIEWER_RUNBOOK.md",
      "status": "passed",
      "evidence": "OVSTREAM_VIEWER_RUNBOOK.md size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.../twin.json",
      "status": "passed",
      "evidence": "../twin.json size and sha256 match."
    },
    {
      "id": "HANDOFF.FILE.../source_manifest.json",
      "status": "passed",
      "evidence": "../source_manifest.json size and sha256 match."
    },
    {
      "id": "USD.UNITS.001",
      "status": "passed",
      "evidence": "USD stage contains metersPerUnit = 1."
    },
    {
      "id": "USD.MATERIAL_BINDING.001",
      "status": "passed",
      "evidence": "USD stage contains MaterialBindingAPI."
    },
    {
      "id": "USD.PHYSICS_SCENE.001",
      "status": "passed",
      "evidence": "USD stage contains PhysicsScene."
    },
    {
      "id": "USD.PHYSICS_COLLISION.001",
      "status": "passed",
      "evidence": "collision APIs=27, enabled=27"
    },
    {
      "id": "OVRTX.COMPOSITE_SUBLAYER.001",
      "status": "passed",
      "evidence": "ovrtx wrapper sublayers the source OpenUSD stage by basename."
    },
    {
      "id": "OVRTX.RENDER_PIPELINE.001",
      "status": "passed",
      "evidence": "ovrtx wrapper authors Camera -> RenderProduct -> RenderVar -> RenderSettings."
    },
    {
      "id": "OVRTX.FIRST_FRAME_SCRIPT.001",
      "status": "passed",
      "evidence": "first-frame smoke script uses ovrtx RendererConfig and LdrColor."
    },
    {
      "id": "OVSTREAM.SMOKE_SERVER.001",
      "status": "passed",
      "evidence": "ovstream smoke server starts WebRTC, gates /healthz, and submits BGRA CUDA frames."
    },
    {
      "id": "USD.CHECKER_REPORT.001",
      "status": "passed",
      "evidence": "usdchecker report is present and records success or an explicit not-run reason."
    },
    {
      "id": "PREFLIGHT.OVSTREAM_GATE.001",
      "status": "passed",
      "evidence": "runtime preflight includes OMNIVERSE.OVSTREAM.001."
    },
    {
      "id": "PREFLIGHT.STREAMING_SUMMARY.001",
      "status": "passed",
      "evidence": "omniverse_streaming_ready=false"
    },
    {
      "id": "VIEWER.CONTRACT_SURFACE.001",
      "status": "passed",
      "evidence": "viewer contract requires HTML video / ovstream surface."
    },
    {
      "id": "VIEWER.FORBIDDEN_RENDERERS.001",
      "status": "passed",
      "evidence": "forbidden=WebGL,Three.js,Babylon.js,PlayCanvas,A-Frame,model-viewer,react-three-fiber,glTF browser viewer"
    },
    {
      "id": "VIEWER.OVSTREAM_GATE.001",
      "status": "passed",
      "evidence": "viewer contract includes OMNIVERSE.OVSTREAM.001 gate."
    }
  ]
}
```

## ovrtx first-frame

```json
{
  "status": "passed",
  "stage": "/home/choihy/address-to-digital-twin-mvp-nvidia-check/src/samples/sadang_317_6/omniverse/sadang_317_6.ovrtx_viewer.usda",
  "render_product": "/Render/OVServer/ViewportTexture0",
  "gpu": "0",
  "started_at_unix": 1781257516.1817348,
  "environment": {
    "OVRTX_SKIP_USD_CHECK": "1",
    "OVRTX_BIN_PATH": "/home/choihy/.local/lib/python3.12/site-packages/ovrtx/bin",
    "LD_LIBRARY_PATH_contains_ovrtx_plugins": true
  },
  "frames": [
    {
      "render_product_found": true,
      "shape": [
        720,
        1280,
        4
      ],
      "dtype": "uint8",
      "min": 0,
      "max": 255,
      "mean": 120.69644,
      "rgb_min": 0,
      "rgb_max": 217,
      "rgb_mean": 75.928587,
      "nonzero_rgb_pixels": 824793,
      "nonblank_rgb": true,
      "render_vars": [
        "LdrColor"
      ],
      "frame_index": 0,
      "step_seconds": 115.33351,
      "output_ppm": "/home/choihy/address-to-digital-twin-mvp-nvidia-check/src/samples/sadang_317_6/omniverse/ovrtx_first_frame.ppm"
    }
  ],
  "renderer_version": "(0, 3, 0)",
  "reason": "LdrColor frame produced",
  "finished_at_unix": 1781257657.9530513,
  "elapsed_seconds": 141.771317
}
```

## ovstream smoke server

```json
{
  "status": "passed",
  "stage": "/home/choihy/address-to-digital-twin-mvp-nvidia-check/src/samples/sadang_317_6/omniverse/sadang_317_6.ovrtx_viewer.usda",
  "render_product": "/Render/OVServer/ViewportTexture0",
  "gpu": "0",
  "started_at_unix": 1781258533.1447284,
  "ovstream": {
    "server_type": "WEBRTC",
    "video_input": "CUDA",
    "signaling_port": 49100,
    "stream_port": 0,
    "public_ip": "127.0.0.1",
    "target_fps": 30,
    "version": "(0, 3, 0)",
    "started": true,
    "stream_video_first_frame": "transient_without_client",
    "stream_video_error": "OvstreamError('webrtc: cannot stream video frame: no client connected')"
  },
  "healthz": {
    "port": 18081,
    "before_ready": {
      "http_status": 503,
      "body": "not ready"
    },
    "after_ready": {
      "http_status": 200,
      "body": "ok"
    }
  },
  "callbacks_registered_before_start": true,
  "environment": {
    "OVRTX_SKIP_USD_CHECK": "1",
    "OVRTX_BIN_PATH": "/home/choihy/.local/lib/python3.12/site-packages/ovrtx/bin",
    "LD_LIBRARY_PATH_contains_ovrtx_plugins": true
  },
  "renderer_version": "(0, 3, 0)",
  "first_bgra_frame": {
    "render_var": "LdrColor",
    "source_format": "RGBA8 CUDA",
    "stream_format": "BGRA8 CUDA",
    "shape": [
      720,
      1280,
      4
    ],
    "dtype": "<class 'warp._src.types.uint8'>",
    "step_seconds": 1.665695,
    "copy_rule": "red/blue channels swapped into persistent app-owned warp CUDA buffer"
  },
  "reason": "ovrtx LdrColor converted to persistent BGRA CUDA buffer; ovstream WebRTC server started; /healthz returned 200 only after the converted frame.",
  "finished_at_unix": 1781258550.674191,
  "elapsed_seconds": 17.529463
}
```
