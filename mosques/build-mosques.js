#!/usr/bin/env node
// build-mosques.js — extract all Islamic places of worship worldwide from OpenStreetMap
// Runs Overpass queries on a 5°×5° global grid. Resumable. Rate-limited. Endpoint failover.
//
// USAGE:
//   node build-mosques.js                          # full world, 5° tiles
//   node build-mosques.js --tile=10                # 10° tiles (fewer, bigger files)
//   node build-mosques.js --bbox=-10,35,20,60      # only Europe (minLng,minLat,maxLng,maxLat)
//   node build-mosques.js --resume                 # skip tiles already saved
//   node build-mosques.js --out=./mosques          # output dir (default ./mosques)
//   node build-mosques.js --sleep=6                # seconds between requests (default 6)
//
// OUTPUT:
//   ./mosques/manifest.json      list of non-empty tiles + total count + timestamp
//   ./mosques/{lat}_{lng}.json   array of mosque entries per tile
//
// TILE NAMING:
//   lat/lng floored to grid step, e.g. "50_-5.json" holds 50..55 N, -5..0 E
//
// REQUIREMENTS: Node.js 18+ (built-in fetch)

'use strict';
const fs = require('fs');
const path = require('path');

// ── Args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const STEP    = parseInt(args.tile || 5);           // grid step in degrees
const OUT_DIR = args.out || './mosques';
const SLEEP   = parseFloat(args.sleep || 6) * 1000; // ms between requests
const RESUME  = !!args.resume;
const BBOX    = args.bbox ? args.bbox.split(',').map(Number) : [-180, -60, 180, 75];
                          // [minLng, minLat, maxLng, maxLat] — skip polar regions by default

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

const NAME_RE = 'mosque|masjid|masjed|musallah|musalla|musollah|jamia|jamiah|jame|jaame|dars|madrasa|madrassa|madrasah|islamic centre|islamic center|islamic society|islamic community|prayer hall|prayer room|namaz|surau';

// ── Setup ────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tileFile = (lat, lng) => path.join(OUT_DIR, `${lat}_${lng}.json`);

// Build list of tiles to process
const tiles = [];
for (let lat = Math.floor(BBOX[1] / STEP) * STEP; lat < BBOX[3]; lat += STEP) {
  for (let lng = Math.floor(BBOX[0] / STEP) * STEP; lng < BBOX[2]; lng += STEP) {
    tiles.push([lat, lng]);
  }
}
console.log(`Grid: ${tiles.length} tiles at ${STEP}° step, bbox=[${BBOX.join(',')}]`);

// ── Query builder ────────────────────────────────────────────────────
const buildQuery = (lat, lng) => {
  const s = lat, w = lng, n = lat + STEP, e = lng + STEP;
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:180];(`
    + `node["amenity"="place_of_worship"]["religion"="muslim"](${bbox});`
    + `way["amenity"="place_of_worship"]["religion"="muslim"](${bbox});`
    + `relation["amenity"="place_of_worship"]["religion"="muslim"](${bbox});`
    + `node["building"="mosque"](${bbox});`
    + `way["building"="mosque"](${bbox});`
    + `node["amenity"="community_centre"]["religion"="muslim"](${bbox});`
    + `way["amenity"="community_centre"]["religion"="muslim"](${bbox});`
    + `node["name"~"${NAME_RE}",i](${bbox});`
    + `way["name"~"${NAME_RE}",i](${bbox});`
    + `);out center 5000;`;
};

// ── Overpass fetch with endpoint failover ────────────────────────────
let epIdx = 0;
async function fetchOverpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const url = ENDPOINTS[epIdx];
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(200000)
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (err) {
      lastErr = err;
      epIdx = (epIdx + 1) % ENDPOINTS.length;
      await sleep(Math.min(30000, 5000 * (attempt + 1))); // backoff
    }
  }
  throw lastErr;
}

// ── Parse OSM element → minimal record ───────────────────────────────
const parseElement = el => {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!lat || !lng) return null;
  const t = el.tags || {};
  return {
    id: el.type[0] + el.id,           // 'n123', 'w456', 'r789'
    name: t.name || t['name:en'] || t.alt_name || 'Islamic place',
    lat: +lat.toFixed(6),
    lng: +lng.toFixed(6),
    addr: t['addr:street'] || t['addr:city'] || '',
    type: t.place_of_worship || t.building || t.amenity || 'mosque'
  };
};

// ── Main loop ────────────────────────────────────────────────────────
(async () => {
  let processed = 0, totalRecords = 0, failed = [];
  const startTime = Date.now();

  for (const [lat, lng] of tiles) {
    processed++;
    const fname = tileFile(lat, lng);

    if (RESUME && fs.existsSync(fname)) {
      console.log(`[${processed}/${tiles.length}] SKIP ${lat}_${lng} (exists)`);
      continue;
    }

    const t0 = Date.now();
    let data;
    try {
      data = await fetchOverpass(buildQuery(lat, lng));
    } catch (err) {
      console.error(`[${processed}/${tiles.length}] FAIL ${lat}_${lng}: ${err.message}`);
      failed.push([lat, lng]);
      await sleep(SLEEP);
      continue;
    }

    // Dedup by OSM id (element may match multiple filters)
    const seen = new Set();
    const records = [];
    for (const el of data.elements) {
      const rec = parseElement(el);
      if (!rec || seen.has(rec.id)) continue;
      seen.add(rec.id);
      records.push(rec);
    }

    if (records.length) {
      fs.writeFileSync(fname, JSON.stringify(records));
      totalRecords += records.length;
    } else if (fs.existsSync(fname)) {
      fs.unlinkSync(fname); // clean out empty stale files
    }

    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${processed}/${tiles.length}] ${lat}_${lng}: ${records.length.toString().padStart(4)} mosques (${dt}s)`);

    await sleep(SLEEP);
  }

  // ── Manifest ─────────────────────────────────────────────────────
  const written = fs.readdirSync(OUT_DIR).filter(f => /^-?\d+_-?\d+\.json$/.test(f));
  const manifest = {
    generated: new Date().toISOString(),
    step: STEP,
    tiles: written.map(f => f.replace('.json', '')),
    totalRecords,
    totalTiles: written.length,
    failed: failed.map(([la, ln]) => `${la}_${ln}`)
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const dur = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\nDONE in ${dur} min`);
  console.log(`  tiles with data: ${written.length}`);
  console.log(`  total mosques  : ${totalRecords}`);
  if (failed.length) console.log(`  failed tiles   : ${failed.length} (rerun with --resume)`);
})();
