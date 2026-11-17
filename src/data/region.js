// Região carregável: índice (assets/regions/index.json) e, por região, contorno, grade e projeção prontos para a cena.
// O relevo só existe para o RS (é o único .bin gerado); a malha por município só existe nas UFs.
import { makeGrid } from './grid.js';
import { makeProjection } from '../geo/projection.js';

const DIR = './assets/regions/';
const getJson = async (fetchImpl, url) => {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
};

/** RegionInfo[]: Brasil primeiro, depois os estados por nome. */
export async function loadIndex(fetchImpl = fetch) {
  return (await getJson(fetchImpl, `${DIR}index.json`)).regions;
}

/** Retângulo do bbox na cena (x leste, z sul), com uma célula de folga em cada lado. */
export function regionBounds(info, proj) {
  const [minLon, minLat, maxLon, maxLat] = info.bbox;
  const a = proj.toScene(minLon, maxLat), b = proj.toScene(maxLon, minLat), cell = proj.cell(info.step);
  return { minX: a.x - cell.x, maxX: b.x + cell.x, minZ: a.z - cell.z, maxZ: b.z + cell.z };
}

/** Region = { id, name, kind, tz, geo, grid, gridVersion, proj, bounds, hasCities, hasRelief, munUrl }. */
export async function loadRegion(info, fetchImpl = fetch) {
  const geo = await getJson(fetchImpl, `${DIR}${info.id}.json`);
  const proj = makeProjection(info.proj);
  const hasCities = info.kind === 'uf';
  return {
    id: info.id, name: info.name, kind: info.kind, tz: info.tz,
    geo, grid: makeGrid(geo.grid), gridVersion: geo.gridVersion, proj, bounds: regionBounds(info, proj),
    hasCities, hasRelief: info.id === 'RS', munUrl: hasCities ? `${DIR}${info.id}-mun.json` : null,
  };
}
