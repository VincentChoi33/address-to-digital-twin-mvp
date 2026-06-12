# NVIDIA train1 package validation — 2026-06-12

Remote host: `train1` (`gpu1`), reached via existing SSH config.

Command executed on the GPU host from a fresh clone of `VincentChoi33/address-to-digital-twin-mvp`:

```bash
cd ~/address-to-digital-twin-mvp-nvidia-check
export PATH="$HOME/.local/bin:$PATH"
npm ci
npm run nvidia:package
```

Additional user-site setup performed because the host had no Python `pip`/OpenUSD tools:

```bash
curl -fsSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
python3 /tmp/get-pip.py --user --break-system-packages
python3 -m pip install --user --break-system-packages usd-core
python3 -m pip install --user --break-system-packages ovstream ovrtx warp-lang numpy
python3 -c "from pxr import Usd; print('pxr ok')"
```

Observed result:

- `nvidia-smi`: passed — 8 × NVIDIA GeForce RTX 3090, driver 580.105.08, 24 GiB each.
- Docker: passed.
- Docker NVIDIA runtime: passed.
- OpenUSD Python runtime: passed after user-site `usd-core` install.
- Python `ovrtx` runtime: passed after user-site `ovrtx` install (`ovrtx-python-ok 0.3.0`).
- Python `ovstream` lifecycle: passed after user-site `ovstream` install (`ovstream-python-ok (0, 3, 0)`).
- `npm run nvidia:package`: passed.
- `nvidia:validate`: passed all package checks, including SHA inventory, USD units/material/physics semantics, `OMNIVERSE.OVSTREAM.001` preflight gate presence, and no-WebGL ovstream viewer contract.
- Remaining runtime blockers: no ovstream endpoint/env, no NVIDIA/NGC/NVCF or Content Agents credentials/endpoints. `usdchecker` CLI remains absent, but OpenUSD Python runtime is present and the Mac-side committed package has a `usdchecker` Success report.

Authoritative machine-readable preflight: [`nvidia-train1-runtime-preflight-2026-06-12.json`](nvidia-train1-runtime-preflight-2026-06-12.json).
