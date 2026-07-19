# Mosque Tiles

OpenStreetMap-derived Islamic places of worship, sliced into a 5°×5° grid.

## Files
- `manifest.json` — list of non-empty tiles + total count + timestamp
- `{lat}_{lng}.json` — array of mosque records for that tile
- `build-mosques.js` — the script used to generate these

File `50_-5.json` covers latitudes 50–55, longitudes -5 to 0.

## Record schema
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

## Source
OpenStreetMap contributors, via Overpass API. Licensed under [ODbL](https://opendatacommons.org/licenses/odbl/).

## Regenerating
```bash
node build-mosques.js --resume
```
