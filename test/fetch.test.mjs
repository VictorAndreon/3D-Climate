import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeGrid } from '../src/data/grid.js';
import { buildUrls, fetchForecast } from '../src/data/fetch.js';
import { HOURLY } from '../src/data/normalize.js';

const grid = makeGrid(JSON.parse(readFileSync('assets/rs.json', 'utf8')).grid);
const lats = (url) => new URL(url).searchParams.get('latitude').split(',');
/** Servidor falso: devolve cloud_cover_low = índice global do ponto (pela latitude/longitude pedidas). */
function fakeFetch({ delay = () => 0, mutate } = {}) {
  const st = { calls: 0, live: 0, maxLive: 0 };
  const impl = async (url) => {
    const n = ++st.calls; st.live++; st.maxLive = Math.max(st.maxLive, st.live);
    await new Promise((r) => setTimeout(r, delay(n)));
    st.live--;
    const sp = new URL(url).searchParams, la = sp.get('latitude').split(','), lo = sp.get('longitude').split(',');
    let body = la.map((v, i) => {
      const p = grid.nearest(+lo[i], +v);
      return { latitude: +v + 0.018, longitude: +lo[i] + 0.021, hourly: { time: [0, 3600], ...Object.fromEntries(HOURLY.map((k) => [k, [0, 0]])), cloud_cover_low: [p % 101, 0], precipitation: [p, 0] } };
    });
    if (body.length === 1) body = body[0];
    let res = { ok: true, status: 200, json: async () => body };
    if (mutate) res = mutate(res, n, body) ?? res;
    return res;
  };
  return { impl, st };
}

test('11 URLs, 50 pontos nas 10 primeiras e 46 na última', () => {
  const u = buildUrls(grid);
  assert.equal(u.length, 11); for (let i = 0; i < 10; i++) assert.equal(lats(u[i]).length, 50); assert.equal(lats(u[10]).length, 46);
});
test('URL tem os 7 hourly, forecast_hours=168, timeformat=unixtime, timezone=America/Sao_Paulo', () => {
  const u = new URL(buildUrls(grid)[0]), sp = u.searchParams;
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(sp.get('hourly'), 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,weather_code,wind_speed_10m,wind_direction_10m');
  assert.equal(sp.get('forecast_hours'), '168'); assert.equal(sp.get('timeformat'), 'unixtime'); assert.equal(sp.get('timezone'), 'America/Sao_Paulo');
  assert.equal(sp.get('latitude').split(',')[0], grid.lats[0].toFixed(2)); assert.equal(sp.get('longitude').split(',')[49], grid.lons[49].toFixed(2));
});
test('no máximo 4 requisições simultâneas, 11 no total', async () => {
  const { impl, st } = fakeFetch({ delay: () => 5 });
  await fetchForecast(grid, { fetchImpl: impl });
  assert.equal(st.calls, 11); assert(st.maxLive <= 4 && st.maxLive >= 2, `maxLive=${st.maxLive}`);
});
test('junta os lotes na ordem de p mesmo se resolverem fora de ordem', async () => {
  const { impl } = fakeFetch({ delay: (n) => (12 - n) * 3 });
  const s = await fetchForecast(grid, { fetchImpl: impl });
  assert.equal(s.nP, grid.nP); assert.equal(s.nT, 2);
  for (let p = 0; p < grid.nP; p++) assert.equal(s.precip[p * 2], p);
});
for (const [name, mutate] of [
  ['HTTP 400', (r, n) => (n === 3 ? { ok: false, status: 400, json: async () => ({ error: true, reason: 'bad' }) } : r)],
  ['HTTP 429', (r, n) => (n === 1 ? { ok: false, status: 429, json: async () => ({}) } : r)],
  ['corpo error:true com 200', (r, n) => (n === 2 ? { ok: true, status: 200, json: async () => ({ error: true, reason: 'limite' }) } : r)],
  ['lote com 49 locais', (r, n, body) => (n === 2 ? { ok: true, status: 200, json: async () => body.slice(1) } : r)],
  ['JSON inválido', (r, n) => (n === 4 ? { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } } : r)],
]) test(`${name} rejeita a promessa`, async () => { await assert.rejects(fetchForecast(grid, { fetchImpl: fakeFetch({ mutate }).impl })); });
test('fetch que lança (rede fora) rejeita', async () => { await assert.rejects(fetchForecast(grid, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } })); });
test('lote de 1 ponto (resposta-objeto) funciona', async () => {
  const g51 = { ...grid, nP: 51, lons: grid.lons.subarray(0, 51), lats: grid.lats.subarray(0, 51) };
  const u = buildUrls(g51); assert.equal(u.length, 2); assert.equal(lats(u[1]).length, 1);
  const s = await fetchForecast(g51, { fetchImpl: fakeFetch().impl });
  assert.equal(s.nP, 51); assert.equal(s.precip[50 * 2], 50);
});
