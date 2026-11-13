// Decide de onde vêm os dados: ao vivo, cache, cache vencido, demo ou fixture (design §5.4 e §5.5).
// Nunca apresenta dado sintético como real: o status devolvido diz exatamente o que é.
export const CACHE_TTL = 3600;

const hourFloor = (unix) => Math.floor(unix / 3600) * 3600;
const covers = (series, nowUnix) => series.times[series.nT - 1] >= nowUnix;

export async function loadWeather({ mode, grid, gridVersion, nowUnix, deps }) {
  if (mode === 'demo') return { series: deps.syntheticSeries(grid, hourFloor(nowUnix)), status: { kind: 'demo', fetchedAt: nowUnix }, nowUnix };
  if (mode === 'fixture') {
    const series = await deps.loadFixture();
    // a gravação envelhece: o "agora" da cena passa a ser o início dela
    return { series, status: { kind: 'fixture', fetchedAt: series.times[0] }, nowUnix: series.times[0] };
  }
  let cache = null;
  try { cache = await deps.loadCache(gridVersion); } catch { cache = null; }
  if (cache && (cache.series?.nP !== grid.nP || !covers(cache.series, nowUnix))) cache = null;   // outra grade ou série que já terminou
  if (cache && nowUnix - cache.fetchedAt < CACHE_TTL) return { series: cache.series, status: { kind: 'cache', fetchedAt: cache.fetchedAt }, nowUnix };
  try {
    const series = await deps.fetchForecast(grid);
    try { await deps.saveCache(gridVersion, series, nowUnix); } catch { /* sem cache: segue ao vivo */ }
    return { series, status: { kind: 'live', fetchedAt: nowUnix }, nowUnix };
  } catch {
    if (cache) return { series: cache.series, status: { kind: 'stale', fetchedAt: cache.fetchedAt }, nowUnix };
    return { series: deps.syntheticSeries(grid, hourFloor(nowUnix)), status: { kind: 'demo-fallback', fetchedAt: nowUnix }, nowUnix };
  }
}
