# NVIDIA ovstream Direct Browser Viewer

This is the browser half of the NVIDIA-only viewer path. It uses NVIDIA
`@nvidia/ov-web-rtc` in Direct mode to display an `ovstream` WebRTC media track
inside `video#remote-video`. It does **not** render USD with WebGL, Three.js,
Babylon, glTF, or any browser-side 3D renderer.

## Install

```bash
npm install
npm run build
npx playwright install chromium
```

The local `.npmrc` scopes `@nvidia/*` packages to NVIDIA's Omniverse npm
registry while keeping normal dependencies on npmjs.

## Run against a GPU host

Start the server on the NVIDIA host:

```bash
cd src/samples/sadang_317_6/omniverse
python3 nvidia_ovstream_smoke_server.py \
  --stage sadang_317_6.ovrtx_viewer.usda \
  --public-ip <browser-reachable-gpu-host> \
  --signaling-port 49100 \
  --hold-seconds 300
```

Then serve this client:

```bash
npm run dev -- --port 5191
```

Open:

```text
http://localhost:5191/?server=<browser-reachable-gpu-host>&signalingport=49100
```

Validation requires the video element to report nonzero `videoWidth` and
`videoHeight`; the page sets `document.body.dataset.firstVideoFrame="true"` when
that browser-side first frame is observed.

For a reproducible browser-side evidence artifact, keep the Vite client and
GPU host server running, then execute:

```bash
npm run probe:first-frame -- \
  --url "http://127.0.0.1:5191/?server=127.0.0.1&signalingport=49100" \
  --output-json browser_first_frame_report.json \
  --screenshot browser_first_frame.png
```
