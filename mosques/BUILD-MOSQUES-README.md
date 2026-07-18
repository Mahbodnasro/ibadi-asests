# build-mosques.js — how to run

## What it does
Queries OpenStreetMap (via Overpass) for every Islamic place of worship in the world and saves them as JSON tiles you can host on your assets repo. The app then loads only the tile(s) near the user — no live Overpass dependency.

## Requirements
- **Node.js 18 or newer** (built-in `fetch`). Check with `node --version`.
- No `npm install` needed — script uses only Node built-ins.

## Usage
```bash
# Save the file to a working folder, then:
cd ~/some-folder
node build-mosques.js
```

## Options
| Flag | Default | Meaning |
|---|---|---|
| `--tile=5` | 5 | grid step in degrees (5 = ~500km cells, ~1000 tiles world) |
| `--out=./mosques` | ./mosques | output directory |
| `--sleep=6` | 6 | seconds to wait between requests (be kind to Overpass) |
| `--resume` | off | skip tiles already saved (safe to re-run after crash) |
| `--bbox=W,S,E,N` | world | limit to a bbox (lng,lat,lng,lat), e.g. `--bbox=-10,35,20,60` for Europe |

## Time & size expectations
- Full world at 5° step: **~1000 tiles × 6s = ~1.5 hours**. Some tiles take longer (dense urban).
- Total data: expect **50–150 MB** across ~200–400 non-empty tile files (ocean tiles produce empty files).
- Full world at 10° step: **~250 tiles × 6s = ~25 min**, larger files (~500KB–2MB each).

## Suggested first run
Test with a small region first to make sure it works:
```bash
node build-mosques.js --bbox=-10,35,20,60 --tile=5
```
That's Europe (~50 tiles, ~5 min). Verify the output looks right, then run the full world.

## Resuming after a crash
```bash
node build-mosques.js --resume
```
Already-saved tiles are skipped. Failed tiles from the previous run are listed at the end and can be retried.

## Output structure
```
mosques/
  manifest.json       # { generated, step, tiles: ["50_-5", ...], totalRecords, ... }
  50_-5.json          # array of mosque records for that tile
  50_0.json
  ...
```

Each record:
```json
{
  "id": "n1234567",
  "name": "Al-Rahma Mosque",
  "lat": 51.512345,
  "lng": -0.123456,
  "addr": "Some Street",
  "type": "mosque"
}
```

Tile naming: file `50_-5.json` covers **lat 50 to 55, lng -5 to 0** (assuming `--tile=5`).

## Uploading to GitHub
Once the run completes, push the `mosques/` folder to `Mahbodnasro/ibadi-asests`. The app (in a future edit) will fetch tiles from `raw.githubusercontent.com/Mahbodnasro/ibadi-asests/main/mosques/{tile}.json` on demand.

## Rate limiting
Default is 6s between requests. Overpass allows up to ~2 req/sec but crashes for heavy users often. If the run fails often, increase to `--sleep=10`. If you have your own Overpass instance, you can go faster.

## Troubleshooting
- **"HTTP 429" errors**: rate-limited. Increase `--sleep`.
- **Timeout errors on dense cities**: script retries via endpoint failover. If persistent, the tile in that spot may need to be split — re-run just that region with `--tile=2 --bbox=X,Y,Z,W`.
- **Empty tiles**: normal — ocean, Antarctica, Sahara interior etc. The manifest excludes these.
