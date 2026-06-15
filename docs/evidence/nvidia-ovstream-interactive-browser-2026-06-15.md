# NVIDIA ovstream interactive browser verification — 2026-06-15

## What passed
- train1 GPU process is running `scripts/nvidia_ovstream_interactive_server.py`.
- HTTP health through the Mac/Tailscale tunnel returns `ready: true`.
- Main app embeds the NVIDIA live viewer iframe from `:5191`.
- `@nvidia/ov-web-rtc` client starts and exposes camera/layer controls.
- The viewer polls live server telemetry from `/healthz`.

## Current blocker for first video frame
- Browser status: `signaling connected · media pending`.
- Server health shows `connected: false`, `framesSubmitted: 0`, and transient `no client connected` frame errors.
- Cause: SSH local forwarding carries TCP signaling/health, but WebRTC media needs a directly reachable ICE media path. train1 needs direct UDP/TCP media exposure or Tailscale/WireGuard installed on the GPU host.

## URLs used
- Main app: `http://100.112.23.29:5173/?nvidiaServer=100.112.23.29`
- NVIDIA live viewer: `http://100.112.23.29:5191/?server=100.112.23.29&signalingport=49100&streamport=49101&healthport=18081&autoconnect=1`
- Health: `http://100.112.23.29:18081/healthz`
