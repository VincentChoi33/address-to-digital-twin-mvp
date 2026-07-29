# Data Provenance

Every generated twin records where each layer came from and how confidently it
should be interpreted.

## Source policy

| Layer | Preferred source | Offline behavior | Persistence |
| --- | --- | --- | --- |
| Address normalization | Juso or VWorld | deterministic normalization | derived summary only |
| Coordinates | VWorld, then Nominatim | deterministic sample coordinate | selected result only |
| Buildings and parcels | VWorld WFS | seeded procedural geometry | derived geometry and source label |
| Roads and context | OpenStreetMap/Overpass | seeded procedural context | derived geometry and source label |
| Terrain and basemap | configured public tile source | procedural ground | no live tile cache |

Raw provider responses and API credentials are not committed. The
`source_manifest.json` artifact records selected providers, confidence, and
fallback decisions so the viewer never presents procedural geometry as
authoritative survey data.

## Public sample

The committed sample represents a public, non-sensitive demonstration
location. It is a preview twin, not cadastral, legal, BIM, or decision-grade
data. Exact production use requires a separate review of provider terms,
attribution, caching, and redistribution rights.

## Reproducibility

`npm run sample:sadang` regenerates the deterministic sample without API keys.
Network-backed runs may improve fidelity and must preserve the same provenance
contract.
