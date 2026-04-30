// Roofing Hail Intelligence Map MVP
// Static browser app. No server required. Uses Leaflet + IEM LSR endpoint.
// For production: proxy/weather service should handle MRMS GRIB2 -> GeoJSON conversion.

const map = L.map('map').setView([37.6872, -97.3301], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let roofData = [];
let lsrReports = [];
let scoredRoofs = [];
let roofLayer = L.layerGroup().addTo(map);
let lsrLayer = L.layerGroup().addTo(map);
let meshLayer = L.layerGroup().addTo(map);

const statusEl = document.getElementById('status');

function setStatus(msg) { statusEl.textContent = msg; }

function toUTCStringFromLocalInput(value) {
  // Treat input as UTC fields for simplicity.
  return value + ':00Z';
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function colorForPriority(p) {
  return p === 'P1' ? '#d62728' : p === 'P2' ? '#ff9800' : p === 'P3' ? '#1f77b4' : '#7f8c8d';
}

function hailColor(h) {
  if (h >= 2) return '#d62728';
  if (h >= 1.5) return '#ff9800';
  if (h >= 1.0) return '#f2cf3a';
  return '#7f8c8d';
}

function parseCSV(text) {
  const rows = text.trim().split(/\r?\n/);
  const headers = rows.shift().split(',').map(h => h.trim());
  return rows.map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
    obj.lat = parseFloat(obj.lat);
    obj.lon = parseFloat(obj.lon);
    obj.roof_age = parseFloat(obj.roof_age || '0');
    return obj;
  }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

function renderRoofs() {
  roofLayer.clearLayers();
  roofData.forEach(r => {
    const marker = L.circleMarker([r.lat, r.lon], {
      radius: 7,
      color: '#222',
      weight: 1,
      fillColor: '#7f8c8d',
      fillOpacity: .85
    }).bindPopup(`<b>${r.property}</b><br>${r.address || ''}<br>Roof: ${r.roof_type || ''}<br>Age: ${r.roof_age || ''}`);
    r._marker = marker;
    marker.addTo(roofLayer);
  });
  if (roofData.length) {
    const bounds = L.latLngBounds(roofData.map(r => [r.lat, r.lon]));
    map.fitBounds(bounds.pad(0.25));
  }
}

async function loadSampleRoofs() {
  const res = await fetch('sample_roofs.csv');
  const text = await res.text();
  roofData = parseCSV(text);
  renderRoofs();
  setStatus(`Loaded ${roofData.length} sample roofs.`);
}

document.getElementById('loadSampleRoofs').addEventListener('click', loadSampleRoofs);

document.getElementById('roofFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  roofData = parseCSV(text);
  renderRoofs();
  setStatus(`Loaded ${roofData.length} roofs from CSV.`);
});

async function loadLSR() {
  lsrLayer.clearLayers();
  lsrReports = [];
  const state = document.getElementById('state').value;
  const start = toUTCStringFromLocalInput(document.getElementById('startTime').value);
  const end = toUTCStringFromLocalInput(document.getElementById('endTime').value);
  const stateParam = state === 'ALL' ? '' : `&state=${encodeURIComponent(state)}`;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py?${stateParam}&sts=${encodeURIComponent(start)}&ets=${encodeURIComponent(end)}&fmt=geojson`;
  setStatus('Loading hail reports...');
  try {
    const res = await fetch(url);
    const geo = await res.json();
    lsrReports = (geo.features || [])
      .filter(f => String(f.properties?.TYPETEXT || f.properties?.typetext || '').toUpperCase().includes('HAIL'))
      .map(f => {
        const props = f.properties || {};
        const coords = f.geometry.coordinates;
        return {
          lat: coords[1],
          lon: coords[0],
          mag: parseFloat(props.MAG || props.mag || '0'),
          valid: props.VALID || props.valid || '',
          city: props.CITY || props.city || '',
          county: props.COUNTY || props.county || '',
          source: props.SOURCE || props.source || '',
          remark: props.REMARK || props.remark || ''
        };
      }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));

    lsrReports.forEach(r => {
      L.circleMarker([r.lat, r.lon], {
        radius: Math.max(5, Math.min(14, r.mag * 4)),
        color: hailColor(r.mag),
        fillColor: hailColor(r.mag),
        fillOpacity: .75
      }).bindPopup(`<b>Hail ${r.mag || '?'}"</b><br>${r.valid}<br>${r.city}, ${r.county}<br>${r.source}<br>${r.remark}`)
      .addTo(lsrLayer);
    });
    setStatus(`Loaded ${lsrReports.length} hail Local Storm Reports.`);
  } catch (err) {
    console.error(err);
    setStatus('Could not load live LSR data. Try sample swath or check browser CORS/network.');
  }
}
document.getElementById('loadLSR').addEventListener('click', loadLSR);

async function loadGeoJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function getFeatureHail(f) {
  const p = f.properties || {};
  return parseFloat(p.hail_inches || p.MESH || p.mesh || p.max_hail || p.hail || '0');
}

function renderMeshGeoJson(geo) {
  meshLayer.clearLayers();
  L.geoJSON(geo, {
    style: f => {
      const h = getFeatureHail(f);
      return { color: hailColor(h), weight: 2, fillColor: hailColor(h), fillOpacity: .18 };
    },
    onEachFeature: (f, layer) => {
      const h = getFeatureHail(f);
      layer.bindPopup(`<b>Estimated hail swath</b><br>${h || '?'} inches`);
    }
  }).addTo(meshLayer);
  setStatus('Loaded hail swath GeoJSON.');
}

document.getElementById('meshFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const geo = await loadGeoJsonFile(file);
  renderMeshGeoJson(geo);
});

document.getElementById('loadSampleMesh').addEventListener('click', async () => {
  const res = await fetch('sample_mesh_swath.geojson');
  const geo = await res.json();
  renderMeshGeoJson(geo);
});

function pointInPolygon(point, vs) {
  const x = point[1], y = point[0]; // lon, lat
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function maxMeshAtRoof(roof) {
  let maxHail = 0;
  meshLayer.eachLayer(layer => {
    if (!layer.feature || !layer.feature.geometry) return;
    const geom = layer.feature.geometry;
    const hail = getFeatureHail(layer.feature);
    if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0];
      if (pointInPolygon([roof.lat, roof.lon], ring)) maxHail = Math.max(maxHail, hail);
    }
    if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => {
        if (pointInPolygon([roof.lat, roof.lon], poly[0])) maxHail = Math.max(maxHail, hail);
      });
    }
  });
  return maxHail;
}

function scoreRoofs() {
  const radius = parseFloat(document.getElementById('radiusMiles').value || '3');
  const threshold = parseFloat(document.getElementById('priorityThreshold').value || '1.5');

  scoredRoofs = roofData.map(r => {
    let nearest = null;
    let maxNearbyHail = 0;
    lsrReports.forEach(rep => {
      const d = milesBetween(r.lat, r.lon, rep.lat, rep.lon);
      if (!nearest || d < nearest.distance) nearest = { ...rep, distance: d };
      if (d <= radius) maxNearbyHail = Math.max(maxNearbyHail, rep.mag || 0);
    });

    const meshHail = maxMeshAtRoof(r);
    const estHail = Math.max(meshHail || 0, maxNearbyHail || 0);
    const vulnerable = (r.roof_age || 0) >= 12 || /tpo|epdm|modified|mod/i.test(r.roof_type || '');
    let priority = 'P4';
    let why = 'No material hail exposure found in selected data.';
    if (estHail >= 2.0) { priority = 'P1'; why = 'At or near ≥2.00 inch hail exposure.'; }
    else if (estHail >= threshold) { priority = 'P2'; why = `At or near ≥${threshold.toFixed(2)} inch hail exposure.`; }
    else if (nearest && nearest.distance <= radius) { priority = 'P3'; why = `Within ${nearest.distance.toFixed(1)} mi of hail report.`; }
    if (priority !== 'P1' && vulnerable && nearest && nearest.distance <= radius * 1.5) {
      why += ' Roof vulnerability/age increases inspection value.';
      if (priority === 'P4') priority = 'P3';
    }
    return { ...r, priority, estHail, nearestDistance: nearest?.distance ?? null, nearestReport: nearest, why };
  }).sort((a, b) => a.priority.localeCompare(b.priority) || (b.estHail - a.estHail));

  renderScoredRoofs();
  setStatus(`Scored ${scoredRoofs.length} roofs. ${scoredRoofs.filter(r => r.priority === 'P1').length} Priority 1.`);
}
document.getElementById('scoreRoofs').addEventListener('click', scoreRoofs);

function renderScoredRoofs() {
  roofLayer.clearLayers();
  const tbody = document.querySelector('#resultsTable tbody');
  tbody.innerHTML = '';
  scoredRoofs.forEach(r => {
    L.circleMarker([r.lat, r.lon], {
      radius: 8,
      color: '#222',
      weight: 1,
      fillColor: colorForPriority(r.priority),
      fillOpacity: .9
    }).bindPopup(`<b>${r.property}</b><br><b>${r.priority}</b><br>Est. hail: ${r.estHail.toFixed(2)}"<br>${r.why}<br>${r.address || ''}`)
    .addTo(roofLayer);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="priority ${r.priority}">${r.priority}</span></td>
      <td>${r.property || ''}<br><span class="note">${r.address || ''}</span></td>
      <td>${r.estHail ? r.estHail.toFixed(2) + '"' : '-'}</td>
      <td>${r.nearestDistance == null ? '-' : r.nearestDistance.toFixed(1) + ' mi'}<br><span class="note">${r.nearestReport?.valid || ''}</span></td>
      <td>${r.roof_type || ''}</td>
      <td>${r.roof_age || ''}</td>
      <td>${r.why}</td>`;
    tbody.appendChild(tr);
  });
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  if (!scoredRoofs.length) scoreRoofs();
  const headers = ['priority','property','address','lat','lon','estimated_hail_inches','nearest_report_miles','nearest_report_time','roof_type','roof_age','insurer','warranty','why'];
  const rows = [headers.join(',')];
  scoredRoofs.forEach(r => {
    rows.push([
      r.priority, r.property, r.address, r.lat, r.lon, r.estHail.toFixed(2),
      r.nearestDistance == null ? '' : r.nearestDistance.toFixed(2),
      r.nearestReport?.valid || '', r.roof_type, r.roof_age, r.insurer, r.warranty, r.why
    ].map(csvEscape).join(','));
  });
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'roof_hail_inspection_priority.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
document.getElementById('exportCsv').addEventListener('click', exportCsv);

loadSampleRoofs();
