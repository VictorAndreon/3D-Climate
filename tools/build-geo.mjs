// Baixa a malha municipal do RS, simplifica e gera assets/rs.json
// (contorno, bordas internas, centroides, grade de 0,25°). Roda uma vez; saída commitada.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const URL = 'https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-43-mun.json';
const OUT = 'assets/rs.json';
const OUT_MUN = 'assets/municipios.json';      // polígono por município, carregado só ao clicar no mapa
const MAX_BYTES = 350 * 1024;
const STEP = 0.25;
const MIN_RING_KM2 = 50;
const MAPSHAPER = resolve('node_modules/.bin/mapshaper');

const dir = mkdtempSync(join(tmpdir(), 'rs-geo-'));   // diretório vazio só para o dado baixado
const raw = join(dir, 'mun.json');
execFileSync('curl', ['-sSfL', '--max-time', '60', '-o', raw, URL]);
const src = JSON.parse(readFileSync(raw, 'utf8'));

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const r3 = (v) => Math.round(v * 1000) / 1000;

// --- centroides (geometria original) ---
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  return { area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) };
}
const municipios = src.features.map((f) => {
  let best = null;
  for (const p of polysOf(f.geometry)) { const c = ringCentroid(p[0]); if (!best || c.area > best.area) best = c; }
  return [f.properties.name, r3(best.x), r3(best.y)];
}).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));

// --- grade (geometria original): nós dentro do estado + 8 vizinhos ---
const inRing = (r, x, y) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const allPolys = src.features.flatMap((f) => polysOf(f.geometry));
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of allPolys) for (const [x, y] of p[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const inside = (x, y) => allPolys.some((p) => inRing(p[0], x, y) && !p.slice(1).some((h) => inRing(h, x, y)));
const i0 = Math.floor(minX / STEP) - 1, i1 = Math.ceil(maxX / STEP) + 1;
const j0 = Math.floor(minY / STEP) - 1, j1 = Math.ceil(maxY / STEP) + 1;
const nx = i1 - i0 + 1, ny = j1 - j0 + 1;
const mask = new Uint8Array(nx * ny);
let nInside = 0;
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside((i0 + i) * STEP, (j0 + j) * STEP)) { mask[j * nx + i] = 1; nInside++; }
const cells = [];
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  let keep = false;
  for (let b = -1; b <= 1 && !keep; b++) for (let a = -1; a <= 1; a++) {
    const ii = i + a, jj = j + b;
    if (ii >= 0 && ii < nx && jj >= 0 && jj < ny && mask[jj * nx + ii]) { keep = true; break; }
  }
  if (keep) cells.push(j * nx + i);
}
const grid = { lon0: i0 * STEP, lat0: j0 * STEP, step: STEP, nx, ny, cells };
const gridVersion = `g1:${grid.lon0}:${grid.lat0}:${nx}x${ny}:${cells.length}`;

// --- simplificação com mapshaper ---
const flat = (ring) => ring.flatMap(([x, y]) => [r3(x), r3(y)]);
const ringKm2 = (ring) => ringCentroid(ring).area * 111.32 * 111.32 * Math.cos((30.4 * Math.PI) / 180);
function build(pct) {
  const simp = join(dir, 'simp.json'), outl = join(dir, 'outline.json'), bord = join(dir, 'borders.json');
  const q = { stdio: 'ignore' };
  execFileSync(MAPSHAPER, [raw, '-simplify', `${pct}%`, 'keep-shapes', '-o', 'force', simp], q);
  execFileSync(MAPSHAPER, [simp, '-dissolve', '-o', 'force', 'precision=0.001', outl], q);
  execFileSync(MAPSHAPER, [simp, '-innerlines', '-o', 'force', 'precision=0.001', bord], q);
  const geoms = (file) => { const j = JSON.parse(readFileSync(file, 'utf8')); return j.features ? j.features.map((f) => f.geometry) : j.geometries ?? [j]; };
  const outline = geoms(outl).flatMap(polysOf)
    .filter((p) => ringKm2(p[0]) >= MIN_RING_KM2)
    .map((p) => [p[0], ...p.slice(1).filter((h) => ringKm2(h) >= MIN_RING_KM2)].map(flat));
  const borders = geoms(bord).flatMap((g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])).map(flat);
  return JSON.stringify({ gridVersion, outline, borders, municipios, grid });
}
let pct = 40, json = build(pct);
while (Buffer.byteLength(json) > MAX_BYTES && pct > 0.5) { pct = Math.round(pct * 0.8 * 10) / 10; json = build(pct); }
writeFileSync(OUT, json);

// --- polígono de cada município (mesma simplificação das bordas, para casar com o desenho) ---
const trueKm2 = (ring) => { const c = ringCentroid(ring); return c.area * 111.32 * 111.32 * Math.cos((c.y * Math.PI) / 180); };
const polyKm2 = (p) => trueKm2(p[0]) - p.slice(1).reduce((s, h) => s + trueKm2(h), 0);
const areaById = new Map(src.features.map((f) => [f.properties.id, polysOf(f.geometry).reduce((s, p) => s + polyKm2(p), 0)]));
const simpFeatures = JSON.parse(readFileSync(join(dir, 'simp.json'), 'utf8')).features;
const items = simpFeatures.map((f) => [f.properties.id, f.properties.name, Math.round(areaById.get(f.properties.id)), polysOf(f.geometry).map((p) => p.map(flat))])
  .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
writeFileSync(OUT_MUN, JSON.stringify({ gridVersion, items }));
console.log(`${OUT_MUN}: ${statSync(OUT_MUN).size} bytes, ${items.length} municípios`);
const o = JSON.parse(json);
console.log(`${OUT}: ${statSync(OUT).size} bytes, simplify ${pct}%`);
console.log(`municípios ${municipios.length}; grade ${nx}x${ny}, ${nInside} dentro, ${cells.length} com borda; ${gridVersion}`);
console.log(`contorno: ${o.outline.length} polígono(s), anel principal ${Math.max(...o.outline.map((p) => p[0].length / 2))} vértices, furos ${o.outline.reduce((s, p) => s + p.length - 1, 0)}; bordas: ${o.borders.length} linhas`);
