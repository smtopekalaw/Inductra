# Roofing Hail Intelligence Map — MVP

This is a static browser-based prototype for a roofing hail triage map.

## What it does now

- Loads a roof portfolio CSV.
- Pulls archived NWS Local Storm Reports for a selected storm window from Iowa State IEM.
- Displays hail report points by magnitude.
- Accepts a converted MRMS/MESH GeoJSON hail swath layer.
- Scores roofs by estimated hail exposure, proximity, and roof vulnerability.
- Exports an inspection-priority CSV.

## How to run

1. Unzip the package.
2. Open `index.html` in a browser.
3. Use the sample roof portfolio and sample hail swath, or upload your own CSV/GeoJSON.

Some browsers block live web requests from local files. If the live LSR load fails, run a local server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Roof CSV format

Required columns:

```text
property,address,lat,lon,roof_type,roof_age,insurer,warranty
```

## MESH GeoJSON format

The app expects polygons with a hail-size property such as:

```json
{ "hail_inches": 2.25 }
```

Supported property aliases include `hail_inches`, `MESH`, `mesh`, `max_hail`, and `hail`.

## Production roadmap

1. Add backend job to convert NOAA MRMS GRIB2 MESH products into GeoJSON/vector tiles.
2. Store roofs and storm events in PostGIS.
3. Add authentication and customer workspaces.
4. Add PDF claim report generation.
5. Add CRM/export routing for sales and inspection crews.
6. Add EagleView/Nearmap links and insurer-specific reporting language.
