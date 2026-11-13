// Portão 6: caminho AO VIVO + CACHE inteiro, sem rede — a API é interceptada e respondida com a fixture
// reescrita para começar na hora atual. Verifica: 11 requisições na 1ª carga, zero na 2ª (cache válido),
// primeiro quadro útil < 3 s com cache, fallback para DEMO sem rede e sem cache, aviso de desatualizado
// com cache vencido e rede fora, e nenhum host além da API do tempo.
const fs = require('node:fs');
const path = require('node:path');
const { serve, launch, ROOT } = require('./lib.cjs');

const geo = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/rs.json'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/fixture.json'), 'utf8'));
const { lon0, lat0, step, nx, cells } = geo.grid;
const byCoord = new Map(cells.map((c, p) => [`${(lat0 + Math.floor(c / nx) * step).toFixed(2)},${(lon0 + (c % nx) * step).toFixed(2)}`, p]));

(async () => {
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
  const hosts = new Set();

  async function newPage(ctx, online) {
    const page = await ctx.newPage();
    const st = { api: 0, errors: [] };
    page.on('pageerror', (e) => st.errors.push(String(e)));
    page.on('request', (r) => hosts.add(new URL(r.url()).host));
    await page.route('https://api.open-meteo.com/**', (route) => {
      st.api++;
      if (!online) return route.abort('internetdisconnected');
      const sp = new URL(route.request().url()).searchParams, la = sp.get('latitude').split(','), lo = sp.get('longitude').split(',');
      const start = Math.floor(Date.now() / 3600000) * 3600;
      const body = la.map((v, i) => {
        const src = fixture[byCoord.get(`${v},${lo[i]}`)];
        return { latitude: +v, longitude: +lo[i], hourly: { ...src.hourly, time: src.hourly.time.map((_, h) => start + h * 3600) } };
      });
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) });
    });
    return { page, st };
  }
  const load = async (page, query = 'debug=1&cam=se') => { await page.goto(`${srv.url}index.html?${query}`); await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 }); };
  const badge = (page) => page.textContent('#badge');

  // (1) primeira carga: ao vivo
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let { page, st } = await newPage(ctx, true);
  await load(page);
  let b = await badge(page);
  check('1ª carga: 11 requisições à API', st.api === 11, `${st.api}`);
  check('1ª carga: selo "dados de HH:MM · Open-Meteo"', /^dados de \d{2}:\d{2} · Open-Meteo$/.test(b) && (await page.evaluate(() => __rs.status.kind)) === 'live', b);
  check('1ª carga: "agora" achado por timestamp dentro da 1ª hora', await page.evaluate(() => __rs.tNow >= 0 && __rs.tNow < 1));
  await page.close();

  // (2) recarga dentro da validade: zero requisições, primeiro quadro < 3 s
  ({ page, st } = await newPage(ctx, true));
  await load(page);
  const ff = await page.evaluate(() => __rs.firstFrameMs);
  check('2ª carga: zero requisições à API (cache válido)', st.api === 0 && (await page.evaluate(() => __rs.status.kind)) === 'cache', `${st.api}`);
  check('2ª carga: primeiro quadro útil < 3 s', ff < 3000, `${ff.toFixed(0)} ms (Chromium headless)`);
  check('2ª carga: sem exceção', st.errors.length === 0, st.errors.join(' / '));

  // (4) cache envelhecido (2 h) + rede fora: aviso de desatualizado
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('rs-tempo-3d', 1);
    req.onsuccess = () => {
      const tx = req.result.transaction('forecast', 'readwrite'), store = tx.objectStore('forecast');
      store.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { c.value.fetchedAt -= 7200; c.update(c.value); c.continue(); } };
      tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }));
  await page.close();
  ({ page, st } = await newPage(ctx, false));
  await load(page);
  b = await badge(page);
  check('cache vencido + rede fora: selo "(desatualizados)"', /^dados de \d{2}:\d{2} \(desatualizados\)$/.test(b) && st.api > 0, b);
  check('cache vencido + rede fora: selo com cor de aviso', await page.evaluate(() => document.getElementById('badge').classList.contains('warn')));
  await page.close(); await ctx.close();

  // (3) sem cache + rede fora: modo demo com aviso
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  ({ page, st } = await newPage(ctx2, false));
  await load(page);
  b = await badge(page);
  check('sem cache + rede fora: selo "DEMO — dados sintéticos"', b === 'DEMO — dados sintéticos' && (await page.evaluate(() => __rs.status.kind)) === 'demo-fallback', b);
  check('sem cache + rede fora: cena renderiza', (await page.evaluate(() => __rs.stats().puffs)) > 0);
  await page.close();

  // modos demo e fixture não tocam na API
  ({ page, st } = await newPage(ctx2, true));
  await load(page, 'demo=1&debug=1&cam=se');
  check('?demo=1 não chama a API', st.api === 0);
  await load(page, 'fixture=1&debug=1&cam=se');
  check('?fixture=1 não chama a API e avisa que é gravação', st.api === 0 && (await badge(page)).startsWith('FIXTURE — gravado em'));
  await page.close(); await ctx2.close();

  // (5) nenhuma requisição externa além da API do tempo
  const local = new URL(srv.url).host, extra = [...hosts].filter((h) => h !== local && h !== 'api.open-meteo.com');
  check('nenhum host além do próprio servidor e de api.open-meteo.com', extra.length === 0, [...hosts].join(', '));

  await browser.close(); srv.close();
  console.log(fails.length ? `FALHOU: ${fails.join('; ')}` : 'PORTÃO 6 OK');
  process.exit(fails.length ? 1 : 0);
})();
