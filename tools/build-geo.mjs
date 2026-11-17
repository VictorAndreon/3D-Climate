// Baixa a malha municipal de cada UF, simplifica e gera assets/regions/: um par <UF>.json / <UF>-mun.json por
// estado, BR.json / BR-ufs.json para o país, busca.json e index.json (contorno, bordas internas, centroides,
// grade de 0,25° nos estados e de 1° no Brasil). Roda uma vez; saída commitada.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { RS_PROJECTION, fitProjection } from '../src/geo/projection.js';

const URL_OF = (ibge) => `https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${ibge}-mun.json`;
const OUT_DIR = 'assets/regions';
const MAX_BYTES = 350 * 1024;
const STEP = 0.25, STEP_BR = 1;
const MIN_RING_KM2 = 50;
const ISLAND_KM = 150;                       // anel mais longe que isso do corpo do estado fica fora do bbox
const MAPSHAPER = resolve('node_modules/.bin/mapshaper');

// código IBGE, sigla, nome, fuso (o padrão é o de Brasília)
const SP_TZ = 'America/Sao_Paulo';
const UFS = [
  [11, 'RO', 'Rondônia', 'America/Porto_Velho'], [12, 'AC', 'Acre', 'America/Rio_Branco'], [13, 'AM', 'Amazonas', 'America/Manaus'],
  [14, 'RR', 'Roraima', 'America/Boa_Vista'], [15, 'PA', 'Pará'], [16, 'AP', 'Amapá'], [17, 'TO', 'Tocantins'],
  [21, 'MA', 'Maranhão'], [22, 'PI', 'Piauí'], [23, 'CE', 'Ceará'], [24, 'RN', 'Rio Grande do Norte'], [25, 'PB', 'Paraíba'],
  [26, 'PE', 'Pernambuco'], [27, 'AL', 'Alagoas'], [28, 'SE', 'Sergipe'], [29, 'BA', 'Bahia'],
  [31, 'MG', 'Minas Gerais'], [32, 'ES', 'Espírito Santo'], [33, 'RJ', 'Rio de Janeiro'], [35, 'SP', 'São Paulo'],
  [41, 'PR', 'Paraná'], [42, 'SC', 'Santa Catarina'], [43, 'RS', 'Rio Grande do Sul'],
  [50, 'MS', 'Mato Grosso do Sul', 'America/Campo_Grande'], [51, 'MT', 'Mato Grosso', 'America/Cuiaba'], [52, 'GO', 'Goiás'], [53, 'DF', 'Distrito Federal'],
].map(([ibge, id, name, tz = SP_TZ]) => ({ ibge, id, name, tz }));

const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const r3 = (v) => Math.round(v * 1000) / 1000;
const byName = (a, b) => a.localeCompare(b, 'pt-BR');
const flat = (ring) => ring.flatMap(([x, y]) => [r3(x), r3(y)]);

// --- centroides (geometria original) ---
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j], [x1, y1] = ring[i], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  return { area: Math.abs(a / 2), x: cx / (3 * a), y: cy / (3 * a) };
}
const ringKm2 = (ring) => ringCentroid(ring).area * 111.32 * 111.32 * Math.cos((30.4 * Math.PI) / 180);
const trueKm2 = (ring) => { const c = ringCentroid(ring); return c.area * 111.32 * 111.32 * Math.cos((c.y * Math.PI) / 180); };
const polyKm2 = (p) => trueKm2(p[0]) - p.slice(1).reduce((s, h) => s + trueKm2(h), 0);

// --- grade (geometria original): nós dentro da região + 8 vizinhos ---
const inRing = (r, x, y) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
function makeGridFor(allPolys, step) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const boxes = allPolys.map((p) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1); minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
    return [x0, y0, x1, y1];
  });
  const inside = (x, y) => allPolys.some((p, k) => {
    const b = boxes[k];
    return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inRing(p[0], x, y) && !p.slice(1).some((h) => inRing(h, x, y));
  });
  const i0 = Math.floor(minX / step) - 1, i1 = Math.ceil(maxX / step) + 1;
  const j0 = Math.floor(minY / step) - 1, j1 = Math.ceil(maxY / step) + 1;
  const nx = i1 - i0 + 1, ny = j1 - j0 + 1;
  const mask = new Uint8Array(nx * ny);
  let nInside = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside((i0 + i) * step, (j0 + j) * step)) { mask[j * nx + i] = 1; nInside++; }
  const cells = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let keep = false;
    for (let b = -1; b <= 1 && !keep; b++) for (let a = -1; a <= 1; a++) {
      const ii = i + a, jj = j + b;
      if (ii >= 0 && ii < nx && jj >= 0 && jj < ny && mask[jj * nx + ii]) { keep = true; break; }
    }
    if (keep) cells.push(j * nx + i);
  }
  const grid = { lon0: i0 * step, lat0: j0 * step, step, nx, ny, cells };
  // com outro passo que 0,25° a versão leva o passo no fim, para o cache não confundir grades
  const gridVersion = `g1:${grid.lon0}:${grid.lat0}:${nx}x${ny}:${cells.length}` + (step === STEP ? '' : `:s${step}`);
  return { grid, gridVersion, nInside };
}

// --- ilhas: anéis longe do corpo do estado não entram no enquadramento ---
const ringBox = (ring) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};
const gapKm = (a, b) => {
  const dLon = Math.max(0, a[0] - b[2], b[0] - a[2]), dLat = Math.max(0, a[1] - b[3], b[1] - a[3]);
  const lat = (Math.max(a[1], b[1]) + Math.min(a[3], b[3])) / 2;
  return Math.hypot(dLon * Math.cos((lat * Math.PI) / 180), dLat) * 111.32;
};
/** Caixa [minLon, minLat, maxLon, maxLat] do corpo principal: parte do maior anel e agrega os que ficam a ≤ ISLAND_KM. */
function mainBBox(polys) {
  const rings = polys.map((p) => ({ box: ringBox(p[0]), area: ringCentroid(p[0]).area }));
  const seed = rings.reduce((m, r) => (r.area > m.area ? r : m));
  let box = [...seed.box];
  const taken = new Set([seed]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rings) {
      if (taken.has(r) || gapKm(box, r.box) > ISLAND_KM) continue;
      taken.add(r); grew = true;
      box = [Math.min(box[0], r.box[0]), Math.min(box[1], r.box[1]), Math.max(box[2], r.box[2]), Math.max(box[3], r.box[3])];
    }
  }
  return box.map(r3);
}
// Trindade, Martin Vaz (ES) e São Pedro e São Paulo (PE) saem de tudo; nenhuma parte do continente passa de -30°
const isOceanic = (p) => ringCentroid(p[0]).x > -30;
const cleanGeometry = (g) => {
  const polys = polysOf(g).filter((p) => !isOceanic(p));
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
};

// --- mapshaper ---
const q = { stdio: 'ignore' };
const geoms = (file) => { const j = JSON.parse(readFileSync(file, 'utf8')); return j.features ? j.features.map((f) => f.geometry) : j.geometries ?? [j]; };
const outlineOf = (file) => geoms(file).flatMap(polysOf)
  .filter((p) => ringKm2(p[0]) >= MIN_RING_KM2)
  .map((p) => [p[0], ...p.slice(1).filter((h) => ringKm2(h) >= MIN_RING_KM2)].map(flat));
const bordersOf = (file) => geoms(file).flatMap((g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [])).map(flat);

/** Simplifica e dissolve até o arquivo montado por assemble(outline, borders) caber no teto; devolve o JSON, a porcentagem atingida e o arquivo simplificado. */
function simplifyToCap(dir, raw, pct, dissolveField, assemble) {
  const simp = join(dir, 'simp.json'), outl = join(dir, 'outline.json'), bord = join(dir, 'borders.json');
  const build = () => {
    if (dissolveField) {
      execFileSync(MAPSHAPER, [raw, '-simplify', `${pct}%`, 'keep-shapes', '-dissolve', dissolveField, '-o', 'force', simp], q);
    } else execFileSync(MAPSHAPER, [raw, '-simplify', `${pct}%`, 'keep-shapes', '-o', 'force', simp], q);
    execFileSync(MAPSHAPER, [simp, '-dissolve', '-o', 'force', 'precision=0.001', outl], q);
    execFileSync(MAPSHAPER, [simp, '-innerlines', '-o', 'force', 'precision=0.001', bord], q);
    return assemble(outlineOf(outl), bordersOf(bord));
  };
  let json = build();
  while (Buffer.byteLength(json) > MAX_BYTES && pct > 0.5) { pct = Math.round(pct * 0.8 * 10) / 10; json = build(); }
  return { json, pct, simp };
}

// --- download ---
const dir = mkdtempSync(join(tmpdir(), 'br-geo-'));   // diretório vazio só para o dado baixado
mkdirSync(OUT_DIR, { recursive: true });
const states = [];   // por UF: { uf, features (limpos), areaById }
for (const uf of UFS) {
  const sub = join(dir, uf.id); mkdirSync(sub);
  const raw = join(sub, 'mun.json');
  execFileSync('curl', ['-sSfL', '--max-time', '120', '-o', raw, URL_OF(uf.ibge)]);
  const src = JSON.parse(readFileSync(raw, 'utf8'));
  const features = src.features.map((f) => ({ ...f, geometry: cleanGeometry(f.geometry) }));
  writeFileSync(raw, JSON.stringify({ ...src, features }));
  states.push({ uf, sub, raw, features });
}

const index = [], busca = [], brCenters = [];
const rows = [];
let total = 0;
const bytes = (f) => statSync(f).size;

for (const st of states) {
  const { uf, sub, raw, features } = st;
  const allPolys = features.flatMap((f) => polysOf(f.geometry));

  const municipios = features.map((f) => {
    let best = null;
    for (const p of polysOf(f.geometry)) { const c = ringCentroid(p[0]); if (!best || c.area > best.area) best = c; }
    return [f.properties.name, r3(best.x), r3(best.y), f.properties.id];
  }).sort((a, b) => byName(a[0], b[0]));
  for (const [nome, lon, lat, id] of municipios) busca.push([nome, uf.id, lon, lat, id]);

  const { grid, gridVersion, nInside } = makeGridFor(allPolys, STEP);
  const munCoords = municipios.map((m) => m.slice(0, 3));
  const { json: file, pct } = simplifyToCap(sub, raw, 40, null, (outline, borders) => JSON.stringify({ gridVersion, outline, borders, municipios: munCoords, grid }));
  if (Buffer.byteLength(file) > MAX_BYTES) throw new Error(`${uf.id}: ${Buffer.byteLength(file)} bytes passa do teto`);
  writeFileSync(join(OUT_DIR, `${uf.id}.json`), file);

  // polígono de cada município (mesma simplificação das bordas, para casar com o desenho)
  const simpOnly = join(sub, 'simp-mun.json');
  execFileSync(MAPSHAPER, [raw, '-simplify', `${pct}%`, 'keep-shapes', '-o', 'force', simpOnly], q);
  const areaById = new Map(features.map((f) => [f.properties.id, polysOf(f.geometry).reduce((s, p) => s + polyKm2(p), 0)]));
  st.areaById = areaById;
  const items = JSON.parse(readFileSync(simpOnly, 'utf8')).features
    .map((f) => [f.properties.id, f.properties.name, Math.round(areaById.get(f.properties.id)), polysOf(f.geometry).map((p) => p.map(flat))])
    .sort((a, b) => byName(a[1], b[1]));
  writeFileSync(join(OUT_DIR, `${uf.id}-mun.json`), JSON.stringify({ gridVersion, items }));

  const [x0, y0, x1, y1] = mainBBox(allPolys);
  const bbox = [x0, y0, x1, y1];
  const proj = uf.id === 'RS' ? RS_PROJECTION : fitProjection({ minLon: x0, maxLon: x1, minLat: y0, maxLat: y1 });
  index.push({ id: uf.id, name: uf.name, kind: 'uf', ibge: uf.ibge, tz: uf.tz, bbox, proj, step: STEP, nP: grid.cells.length, gridVersion });

  // centro do estado para o mapa do Brasil: média dos centros dos anéis do corpo principal, ponderada pela área
  let sa = 0, sx = 0, sy = 0;
  for (const p of allPolys) {
    const c = ringCentroid(p[0]);
    if (c.x < x0 || c.x > x1 || c.y < y0 || c.y > y1) continue;
    sa += c.area; sx += c.x * c.area; sy += c.y * c.area;
  }
  brCenters.push([uf.name, r3(sx / sa), r3(sy / sa)]);
  total += features.length;
  rows.push(`${uf.id} nP ${grid.cells.length} (dentro ${nInside}) ${bytes(join(OUT_DIR, `${uf.id}.json`))} B + ${bytes(join(OUT_DIR, `${uf.id}-mun.json`))} B, simplify ${pct}%, ${features.length} municípios, ${gridVersion}`);
  console.log(rows.at(-1));
}

// --- Brasil: UFs dissolvidas, contorno do país e divisas estaduais ---
{
  const sub = join(dir, 'BR'); mkdirSync(sub);
  const all = join(sub, 'all.json');
  const features = states.flatMap((st) => st.features.map((f) => ({ type: 'Feature', properties: { uf: st.uf.id }, geometry: f.geometry })));
  writeFileSync(all, JSON.stringify({ type: 'FeatureCollection', features }));
  const allPolys = features.flatMap((f) => polysOf(f.geometry));
  const { grid, gridVersion, nInside } = makeGridFor(allPolys, STEP_BR);
  brCenters.sort((a, b) => byName(a[0], b[0]));
  const { json: file, pct, simp } = simplifyToCap(sub, all, 3, 'uf', (outline, borders) => JSON.stringify({ gridVersion, outline, borders, municipios: brCenters, grid }));
  if (Buffer.byteLength(file) > MAX_BYTES) throw new Error(`BR: ${Buffer.byteLength(file)} bytes passa do teto`);
  writeFileSync(join(OUT_DIR, 'BR.json'), file);

  const ufById = new Map(UFS.map((u) => [u.id, u]));
  const kmById = new Map(states.map((st) => [st.uf.id, [...st.areaById.values()].reduce((s, a) => s + a, 0)]));
  const ufItems = JSON.parse(readFileSync(simp, 'utf8')).features
    .map((f) => [f.properties.uf, ufById.get(f.properties.uf).name, Math.round(kmById.get(f.properties.uf)), polysOf(f.geometry).map((p) => p.map(flat))])
    .sort((a, b) => byName(a[1], b[1]));
  writeFileSync(join(OUT_DIR, 'BR-ufs.json'), JSON.stringify({ gridVersion, items: ufItems }));

  // enquadramento do país: corpo principal, sem as ilhas distantes
  const mainBox = mainBBox(allPolys);
  const [x0, y0, x1, y1] = mainBox;
  index.unshift({
    id: 'BR', name: 'Brasil', kind: 'pais', ibge: 76, tz: SP_TZ, bbox: mainBox,
    proj: fitProjection({ minLon: x0, maxLon: x1, minLat: y0, maxLat: y1 }), step: STEP_BR, nP: grid.cells.length, gridVersion,
  });
  rows.unshift(`BR nP ${grid.cells.length} (dentro ${nInside}) ${bytes(join(OUT_DIR, 'BR.json'))} B + ${bytes(join(OUT_DIR, 'BR-ufs.json'))} B, simplify ${pct}%, ${gridVersion}`);
  console.log(rows[0]);
}

index.splice(1, 27, ...index.slice(1).sort((a, b) => byName(a.name, b.name)));
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify({ regions: index }));
busca.sort((a, b) => byName(a[0], b[0]) || byName(a[1], b[1]));
writeFileSync(join(OUT_DIR, 'busca.json'), JSON.stringify({ items: busca }));
console.log(`busca.json: ${busca.length} municípios (${total} nas UFs); index.json: ${index.length} regiões`);
