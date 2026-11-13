// Decide de onde vêm os dados: ao vivo, cache, cache vencido, demo ou fixture (design §5.4 e §5.5).
// Nunca apresenta dado sintético como real: o status devolvido diz exatamente o que é.
export const CACHE_TTL = 3600;
export const STALE_RETRY = 900;          // desatualizado: nova tentativa no máximo a cada 15 min

/** Promessa que desiste depois de `ms` devolvendo `fallback` (IndexedDB que nunca responde não trava a carga). */
const within = (p, ms, fallback) => Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);

/** Recarregar a página? Ao vivo/cache: dado com mais de 1 h. Desatualizado: 15 min desde a carga. Demo/fixture: nunca. */
export function shouldReload(status, nowUnix, loadedAtUnix) {
  if (status.kind === 'live' || status.kind === 'cache') return nowUnix - status.fetchedAt > CACHE_TTL;
  if (status.kind === 'stale') return nowUnix - loadedAtUnix > STALE_RETRY;
  return false;
}

const hourFloor = (unix) => Math.floor(unix / 3600) * 3600;
const covers = (series, nowUnix) => series.times[series.nT - 1] >= nowUnix;

export async function loadWeather({ mode, grid, gridVersion, nowUnix, deps, cacheTimeoutMs = 1500 }) {
  if (mode === 'demo') return { series: deps.syntheticSeries(grid, hourFloor(nowUnix)), status: { kind: 'demo', fetchedAt: nowUnix }, nowUnix };
  if (mode === 'fixture') {
    const series = await deps.loadFixture();
    // a gravação envelhece: o "agora" da cena passa a ser o início dela
    return { series, status: { kind: 'fixture', fetchedAt: series.times[0] }, nowUnix: series.times[0] };
  }
  let cache = null;
  cache = await within(deps.loadCache(gridVersion), cacheTimeoutMs, null);
  if (cache && (cache.series?.nP !== grid.nP || !covers(cache.series, nowUnix))) cache = null;   // outra grade ou série que já terminou
  if (cache && nowUnix - cache.fetchedAt < CACHE_TTL) return { series: cache.series, status: { kind: 'cache', fetchedAt: cache.fetchedAt }, nowUnix };
  try {
    const series = await deps.fetchForecast(grid);
    await within(deps.saveCache(gridVersion, series, nowUnix), cacheTimeoutMs, null);   // sem cache: segue ao vivo
    return { series, status: { kind: 'live', fetchedAt: nowUnix }, nowUnix };
  } catch {
    if (cache) return { series: cache.series, status: { kind: 'stale', fetchedAt: cache.fetchedAt }, nowUnix };
    return { series: deps.syntheticSeries(grid, hourFloor(nowUnix)), status: { kind: 'demo-fallback', fetchedAt: nowUnix }, nowUnix };
  }
}
