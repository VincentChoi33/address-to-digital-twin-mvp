# Validation Levels

The repository separates deterministic software checks from external runtime
evidence.

| Level | What it proves | Command |
| --- | --- | --- |
| Unit | address, manifest, rendering helpers, flood inputs, and NVIDIA contracts | `npm test` |
| Static | TypeScript correctness | `npm run lint` |
| Build | production browser bundle | `npm run build` |
| Sample | keyless deterministic twin generation | `npm run sample:sadang` |
| Package | OpenUSD export, handoff hashes, and package contract | `npm run nvidia:package` |
| Public safety | no workstation home paths or private network addresses in published evidence | `npm run public:check` |
| External GPU | RTX, ovstream, Warp/CUDA, and optional Content Agents services | GPU-host workflow |

External GPU evidence is historical and environment-specific. It should not be
interpreted as a guarantee that those services are available in every clone or
deployment.

## Current release gate

A public release must pass:

```bash
npm ci
npm run verify
npm run sample:sadang
npm run nvidia:package
npm --prefix nvidia-viewer ci
npm --prefix nvidia-viewer run build
```

The root and NVIDIA viewer dependency audits must contain no production
vulnerabilities. Development-only advisories are reviewed and updated before
release.
