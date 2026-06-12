# NVIDIA ovstream Viewer Runbook — sadang_317_6

This file defines the browser viewer replacement for the Three.js MVP. It is a runtime-gated handoff, not a fake local renderer: the browser must display NVIDIA ovstream WebRTC video produced by an Omniverse RTX / ovrtx server.

## Contract summary

- Contract JSON: `ovstream_viewer_contract.json`
- Stage: `sadang_317_6.usda`
- Contract status: `contract_authored_runtime_gated`
- Current preflight status: `openusd_ready`
- Browser render surface: `HTML video element displaying the ovstream WebRTC media track with object-fit: contain`

## GPU host checks

Run these on the NVIDIA host before claiming the viewer is live:

```bash
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
python3 -c "import ovstream; ovstream.initialize(); print('ovstream OK', ovstream.get_version()); ovstream.shutdown()"
export OVRTX_SKIP_USD_CHECK=1
usdchecker sadang_317_6.usda
```

Then start the ovrtx/Omniverse server for `sadang_317_6.usda`, register ovstream callbacks before serving clients, and expose a readiness endpoint only after the first valid RTX frame has been copied into the stream buffer.

## Browser client rules

- Use a WebRTC video element only; use `object-fit: contain` and fixed stream resolution per session.
- Send camera/layer/AOV commands over the data channel; the server owns all USD stage mutation.
- Use NVIDIA native streaming input forwarding for mouse/keyboard/wheel/touch where available.
- Attach browser first-frame evidence to this package.

## Forbidden shortcuts

- WebGL
- Three.js
- Babylon.js
- PlayCanvas
- A-Frame
- model-viewer
- react-three-fiber
- glTF browser viewer

A browser WebGL screenshot can remain a fast MVP preview, but it is not NVIDIA-only viewer acceptance evidence.
