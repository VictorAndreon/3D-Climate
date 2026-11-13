import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeries } from '../src/data/series.js';
import { loadWeather } from '../src/data/source.js';

const NOW = 1794580860, HOUR0 = 1794578400;
const grid = { nP: 3 };
const mk = (start = HOUR0, tag = 0) => { const s = createSeries(3, 168, start); s.low[0] = tag; return s; };
/** deps falsos que registram chamadas. */
function deps({ cache = null, fetch = 'ok', save = 'ok', cacheThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    fetchForecast: async () => { calls.push('fetch'); if (fetch === 'fail') throw new Error('rede'); return mk(HOUR0, 1); },
    loadCache: async (gv) => { calls.push('loadCache:' + gv); if (cacheThrows) return null; return cache; },
    saveCache: async (gv, s, at) => { calls.push(`saveCache:${gv}:${s.low[0]}:${at}`); if (save === 'fail') throw new Error('quota'); },
    loadFixture: async () => { calls.push('fixture'); return mk(1700000000, 3); },
    syntheticSeries: (g, start) => { calls.push('synthetic:' + start); return mk(start, 4); },
  };
}
const run = (mode, d) => loadWeather({ mode, grid, gridVersion: 'gv', nowUnix: NOW, deps: d });

test('cache de 59 min: não chama fetch, kind cache', async () => {
  const d = deps({ cache: { series: mk(HOUR0, 2), fetchedAt: NOW - 59 * 60 } }), r = await run('live', d);
  assert.equal(r.status.kind, 'cache'); assert.equal(r.status.fetchedAt, NOW - 59 * 60); assert.equal(r.series.low[0], 2); assert(!d.calls.includes('fetch')); assert.equal(r.nowUnix, NOW);
});
test('cache de 61 min + fetch ok: kind live e saveCache com a série nova', async () => {
  const d = deps({ cache: { series: mk(HOUR0, 2), fetchedAt: NOW - 61 * 60 } }), r = await run('live', d);
  assert.equal(r.status.kind, 'live'); assert.equal(r.status.fetchedAt, NOW); assert.equal(r.series.low[0], 1); assert(d.calls.includes(`saveCache:gv:1:${NOW}`));
});
test('sem cache + fetch ok: kind live', async () => { const r = await run('live', deps()); assert.equal(r.status.kind, 'live'); assert.equal(r.series.low[0], 1); });
test('cache de 3 h + fetch falha: kind stale, fetchedAt do cache', async () => {
  const r = await run('live', deps({ cache: { series: mk(HOUR0 - 3 * 3600, 2), fetchedAt: NOW - 3 * 3600 }, fetch: 'fail' }));
  assert.equal(r.status.kind, 'stale'); assert.equal(r.status.fetchedAt, NOW - 3 * 3600); assert.equal(r.series.low[0], 2);
});
test('sem cache + fetch falha: kind demo-fallback com sintética a partir da hora atual', async () => {
  const d = deps({ fetch: 'fail' }), r = await run('live', d);
  assert.equal(r.status.kind, 'demo-fallback'); assert.equal(r.series.low[0], 4); assert(d.calls.includes('synthetic:' + HOUR0));
});
test('cache cuja série terminou antes de agora + fetch falha: demo-fallback', async () => {
  const r = await run('live', deps({ cache: { series: mk(NOW - 200 * 3600, 2), fetchedAt: NOW - 190 * 3600 }, fetch: 'fail' }));
  assert.equal(r.status.kind, 'demo-fallback');
});
test('cache "novo" mas com série que já terminou não vale como cache válido', async () => {
  const r = await run('live', deps({ cache: { series: mk(NOW - 200 * 3600, 2), fetchedAt: NOW - 60 } }));
  assert.equal(r.status.kind, 'live');
});
test('cache de outra grade (nP diferente) é ignorado', async () => {
  const other = createSeries(5, 168, HOUR0), r = await run('live', deps({ cache: { series: other, fetchedAt: NOW - 60 }, fetch: 'fail' }));
  assert.equal(r.status.kind, 'demo-fallback');
});
test('loadCache devolvendo null (IndexedDB indisponível) se comporta como sem cache', async () => { const r = await run('live', deps({ cacheThrows: true })); assert.equal(r.status.kind, 'live'); });
test('loadCache que rejeita também é tratado como sem cache', async () => {
  const d = deps(); d.loadCache = async () => { throw new Error('idb'); };
  assert.equal((await run('live', d)).status.kind, 'live');
});
test('saveCache rejeitando não derruba o caminho live', async () => { const r = await run('live', deps({ save: 'fail' })); assert.equal(r.status.kind, 'live'); });
test('mode demo: nenhuma dep de rede ou cache é chamada', async () => {
  const d = deps(), r = await run('demo', d);
  assert.equal(r.status.kind, 'demo'); assert.deepEqual(d.calls, ['synthetic:' + HOUR0]); assert.equal(r.nowUnix, NOW);
});
test('mode fixture: nowUnix devolvido === times[0], kind fixture', async () => {
  const d = deps(), r = await run('fixture', d);
  assert.equal(r.status.kind, 'fixture'); assert.equal(r.nowUnix, 1700000000); assert.equal(r.status.fetchedAt, 1700000000); assert.deepEqual(d.calls, ['fixture']);
});
test('Final#3: loadCache que nunca resolve não trava a carga', async () => {
  const d = deps(); d.loadCache = () => new Promise(() => {});
  const r = await loadWeather({ mode: 'live', grid, gridVersion: 'gv', nowUnix: NOW, deps: d, cacheTimeoutMs: 30 });
  assert.equal(r.status.kind, 'live');
});
test('Final#3: saveCache que nunca resolve não trava a carga', async () => {
  const d = deps(); d.saveCache = () => new Promise(() => {});
  const r = await loadWeather({ mode: 'live', grid, gridVersion: 'gv', nowUnix: NOW, deps: d, cacheTimeoutMs: 30 });
  assert.equal(r.status.kind, 'live');
});
import { shouldReload } from '../src/data/source.js';
test('Final#4: dado ao vivo com mais de 1 h pede recarga; demo e fixture nunca', () => {
  const at = 1000000;
  assert.equal(shouldReload({ kind: 'live', fetchedAt: at }, at + 3599, at), false);
  assert.equal(shouldReload({ kind: 'live', fetchedAt: at }, at + 3601, at), true);
  assert.equal(shouldReload({ kind: 'cache', fetchedAt: at }, at + 3601, at), true);
  for (const kind of ['demo', 'demo-fallback', 'fixture']) assert.equal(shouldReload({ kind, fetchedAt: at }, at + 99999, at), false);
});
test('Final#4: desatualizado tenta de novo no máximo a cada 15 min (não a cada troca de aba)', () => {
  const at = 1000000, loaded = at + 7200;
  assert.equal(shouldReload({ kind: 'stale', fetchedAt: at }, loaded + 60, loaded), false);
  assert.equal(shouldReload({ kind: 'stale', fetchedAt: at }, loaded + 901, loaded), true);
});
