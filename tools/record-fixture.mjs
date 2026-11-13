// Grava assets/fixture.json a partir da API real (via curl). Se algum lote falhar, grava a sintética.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { makeGrid } from '../src/data/grid.js';
import { buildUrls } from '../src/data/fetch.js';
import { normalizeResponse, buildSeries } from '../src/data/normalize.js';
import { syntheticSeries, seriesToApiJson } from '../src/data/synthetic.js';

const run = promisify(execFile);
const OUT = 'assets/fixture.json';
const grid = makeGrid(JSON.parse(readFileSync('assets/rs.json', 'utf8')).grid);
const urls = buildUrls(grid);

async function fetchAll() {
  const parts = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      let stdout;
      for (let attempt = 1; ; attempt++) {                       // o proxy às vezes corta a conexão: até 4 tentativas
        try { ({ stdout } = await run('curl', ['-sS', '--max-time', '30', urls[i]], { maxBuffer: 64 * 1024 * 1024 })); break; }
        catch (e) { if (attempt === 4) throw new Error(`lote ${i}: ${String(e.stderr ?? e.message).trim().split('\n').pop()}`); await new Promise((r) => setTimeout(r, attempt * 2000)); }
      }
      const locs = normalizeResponse(JSON.parse(stdout));
      const expected = Math.min(50, grid.nP - i * 50);
      if (locs.length !== expected) throw new Error(`lote ${i}: ${locs.length} locais, esperado ${expected}`);
      parts[i] = locs.map((l) => ({ latitude: l.latitude, longitude: l.longitude, hourly: l.hourly }));
    }
  }
  await Promise.all([worker(), worker()]);
  return parts.flat();
}

let locations, kind = 'REAL';
try { locations = await fetchAll(); buildSeries(grid, locations); }
catch (e) {
  console.log(`API indisponível (${e.message}).`);
  kind = 'SINTÉTICA';
  locations = seriesToApiJson(grid, syntheticSeries(grid, Math.floor(Date.now() / 3600000) * 3600));
}
writeFileSync(OUT, JSON.stringify(locations));
const s = buildSeries(grid, locations);
let rainH = 0, stormH = 0, maxP = 0;
for (let h = 0; h < s.nT; h++) {
  let r = false, st = false;
  for (let p = 0; p < s.nP; p++) { const i = p * s.nT + h; if (s.precip[i] >= 0.1) r = true; if (s.code[i] >= 95 && s.code[i] <= 99) st = true; if (s.precip[i] > maxP) maxP = s.precip[i]; }
  rainH += r; stormH += st;
}
console.log(`FIXTURE ${kind}: ${OUT}, ${(statSync(OUT).size / 1048576).toFixed(2)} MB, ${s.nP} pontos x ${s.nT} h`);
console.log(`início ${new Date(s.times[0] * 1000).toISOString()}; horas com chuva em algum ponto: ${rainH}; com trovoada: ${stormH}; máx ${maxP.toFixed(1)} mm/h`);
