# NVIDIA train1 Warp flood smoke — 2026-06-13

Host: `train1` / `gpu1`  
Runtime: NVIDIA Warp 1.14.0, CUDA Toolkit 12.9, NVIDIA driver 13.0  
Device used: `cuda:0` / NVIDIA GeForce RTX 3090

## Command

```bash
python3 nvidia_warp_flood_smoke.py \
  --stage sadang_317_6.usda \
  --output-json warp_flood_report.json \
  --output-pgm warp_flood_depth.pgm
```

The script was copied from the generated Omniverse handoff package and executed on the GPU host from `/tmp/address-warp-41706d5-v2`.

## Result

Status: **passed**

| Metric | Value |
| --- | ---: |
| Grid size | 128 × 128 |
| Steps | 240 |
| Rainfall recorded | 140 mm/h |
| Smoke acceleration | 300× |
| Max depth | 0.1576678604 m |
| Mean depth | 0.1308909655 m |
| Flooded area > 10 cm | 147,019.7266 m² |
| Water volume | 23,243.21875 m³ |
| Nonzero water cells | 14,044 |

Acceptance flags from the JSON report:

- `nonzero_water=true`
- `max_depth_positive=true`
- `flooded_area_gt_10cm=true`
- `cuda_device=true`

## Artifacts

- Raw report: [`nvidia-train1-warp-flood-smoke-2026-06-13.json`](nvidia-train1-warp-flood-smoke-2026-06-13.json)
- Raw depth PGM: [`nvidia-train1-warp-flood-depth-2026-06-13.pgm`](nvidia-train1-warp-flood-depth-2026-06-13.pgm)
- PNG preview: [`nvidia-train1-warp-flood-depth-2026-06-13.png`](nvidia-train1-warp-flood-depth-2026-06-13.png)

![NVIDIA Warp flood depth preview](nvidia-train1-warp-flood-depth-2026-06-13.png)
