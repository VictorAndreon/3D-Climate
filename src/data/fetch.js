// Busca da previsão no Open-Meteo: lotes de 50 pontos, no máximo 4 em paralelo.
import { HOURLY, normalizeResponse, buildSeries } from './normalize.js';

export const API = 'https://api.open-meteo.com/v1/forecast';

export function buildUrls(grid, batch = 50) {
  const urls = [];
  for (let a = 0; a < grid.nP; a += batch) {
    const b = Math.min(a + batch, grid.nP), la = [], lo = [];
    for (let p = a; p < b; p++) { la.push(grid.lats[p].toFixed(2)); lo.push(grid.lons[p].toFixed(2)); }
    urls.push(`${API}?latitude=${la.join(',')}&longitude=${lo.join(',')}&hourly=${HOURLY.join(',')}&forecast_hours=168&timeformat=unixtime&timezone=America/Sao_Paulo`);
  }
  return urls;
}

/** Rejeita em qualquer falha (rede, HTTP != 2xx, error:true, lote incompleto, séries tortas). */
export async function fetchForecast(grid, { fetchImpl = fetch, parallel = 4, batch = 50, timeoutMs = 10000 } = {}) {
  const urls = buildUrls(grid, batch), parts = new Array(urls.length);
  const all = new AbortController();               // um lote falhou: aborta os outros (não gasta cota à toa)
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++, expected = Math.min(batch, grid.nP - i * batch);
      const ctl = new AbortController();
      const onAll = () => ctl.abort();
      all.signal.addEventListener('abort', onAll);
      const timer = setTimeout(() => ctl.abort(), timeoutMs);   // rede pendurada vira falha, não espera eterna
      let locs;
      try {
        const res = await fetchImpl(urls[i], { signal: ctl.signal });
        if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
        locs = normalizeResponse(await res.json());
      } finally { clearTimeout(timer); all.signal.removeEventListener('abort', onAll); }
      if (locs.length !== expected) throw new Error(`Open-Meteo: lote ${i} com ${locs.length} locais, esperado ${expected}`);
      parts[i] = locs;
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker)); }
  catch (e) { all.abort(); throw e; }
  return buildSeries(grid, parts.flat());
}
