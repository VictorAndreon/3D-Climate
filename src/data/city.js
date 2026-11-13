// Município clicado: qual polígono contém o ponto e o resumo da previsão no centro dele. Módulo puro.
import { WET_MM } from './weather-field.js';

/** items: [id, nome, áreaKm², polígonos [[anel externo plano, ...furos]]] (assets/municipios.json). */
export function createMunicipioIndex(items) {
  const list = items.map(([id, name, area, polys]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [outer] of polys) for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
      minY = Math.min(minY, outer[i + 1]); maxY = Math.max(maxY, outer[i + 1]);
    }
    return { id, name, area, polys, box: [minX, minY, maxX, maxY] };
  });
  const byName = new Map(list.map((m) => [m.name, m]));
  return {
    list,
    byName: (name) => byName.get(name) ?? null,
    find(lon, lat) {
      for (const m of list) {
        const [x0, y0, x1, y1] = m.box;
        if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
        if (m.polys.some(([outer, ...holes]) => inRing(outer, lon, lat) && !holes.some((h) => inRing(h, lon, lat)))) return m;
      }
      return null;
    },
  };
}

function inRing(r, x, y) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Cobertura total aproximada: camadas tratadas como independentes. */
export const totalCover = (low, mid, high) => 100 * (1 - (1 - low / 100) * (1 - mid / 100) * (1 - high / 100));

/**
 * Resumo da janela (t, tEnd] de um nó da grade. precip[h] é o acumulado de (h-1, h].
 * Devolve horas molhadas, total em mm, horas de trovoada, e quando a chuva começa ou para.
 */
export function rainOutlook(pt, t, tEnd) {
  const nT = pt.precip.length;
  const wet = (h) => h >= 0 && h < nT && pt.precip[h] >= WET_MM;
  const hNow = Math.min(Math.max(Math.ceil(t), 0), nT - 1);
  const hEnd = Math.min(Math.floor(tEnd + 1e-9), nT - 1);
  let wetHours = 0, totalMm = 0, stormHours = 0, peak = 0, peakHour = -1;
  for (let h = hNow + (Number.isInteger(t) ? 1 : 0); h <= hEnd; h++) {
    if (!wet(h)) continue;
    wetHours++; totalMm += pt.precip[h];
    if (pt.code[h] >= 95 && pt.code[h] <= 99) stormHours++;
    if (pt.precip[h] > peak) { peak = pt.precip[h]; peakHour = h; }
  }
  const rainingNow = wet(hNow);
  let change = -1;                                  // hora em que o estado (chovendo/seco) vira
  for (let h = hNow + 1; h <= hEnd; h++) if (wet(h) !== rainingNow) { change = h - 1; break; }
  return { wetHours, totalMm, stormHours, peak, peakHour, rainingNow, change, hours: Math.max(0, Math.round(tEnd - t)) };
}
