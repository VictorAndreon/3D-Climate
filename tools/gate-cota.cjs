// Portão do limite por minuto da API (600 pontos/min no plano grátis): uma resposta 429 não é falha, a carga espera a
// janela e continua. API SEMPRE simulada com page.route (nunca a real: gasta a cota do dono).
//  1) abertura do Brasil com 429 num lote -> #loading mostra "aguardando a API…", depois a cena abre ao vivo;
//  2) entrar em SP a partir do Brasil com 429 no primeiro lote do estado -> espera no indicador do estado, termina em SP ao vivo.
const { serve, launch } = require('./lib.cjs');

const READY = () => document.documentElement.dataset.ready === '1';
const WAIT = /aguardando a API \(limite por minuto\)… \d+ s/;
/** Brasil = grade de 1,5°; qualquer outra coisa é um estado. `refuse(isState, n)` decide quando responder 429 (n conta os lotes do tipo). */
const onBrGrid = (v) => Math.abs(Number(v) / 1.5 - Math.round(Number(v) / 1.5)) < 1e-6;
async function mockApi(page, { refuse, resetIn = 2 }) {
  const st = { br: 0, uf: 0, refused: 0 };
  await page.route('https://api.open-meteo.com/**', async (route) => {
    const sp = new URL(route.request().url()).searchParams, la = sp.get('latitude').split(','), lo = sp.get('longitude').split(',');
    const isState = ![...la, ...lo].every(onBrGrid);
    const n = ++st[isState ? 'uf' : 'br'];
    if (refuse(isState, n)) {
      st.refused++;
      return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'access-control-expose-headers': 'X-RateLimit-Reset', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + resetIn) }, body: JSON.stringify({ error: true, reason: 'limite' }) });
    }
    const start = Math.floor(Date.now() / 3600000) * 3600, h = 168, arr = (v) => Array.from({ length: h }, () => v);
    const body = la.map((v, i) => ({ latitude: +v, longitude: +lo[i], hourly: { time: Array.from({ length: h }, (_, k) => start + k * 3600), cloud_cover_low: arr(30), cloud_cover_mid: arr(20), cloud_cover_high: arr(10), precipitation: arr(0), weather_code: arr(1), wind_speed_10m: arr(10), wind_direction_10m: arr(90) } }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) }).catch(() => {});
  });
  return st;
}

(async () => {
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
  const fresh = async () => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); return { ctx, page }; };

  {
    // 1) abertura
    const { ctx, page } = await fresh();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const st = await mockApi(page, { refuse: (isState, n) => !isState && n === 3 });
    await page.goto(`${srv.url}index.html?debug=1`);
    await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('loading').textContent) && !document.getElementById('loading').hidden, WAIT.source, { timeout: 60000 });
    const txt = await page.evaluate(() => document.getElementById('loading').textContent);
    check('abertura: #loading mostra a espera da API', WAIT.test(txt), txt);
    await page.waitForFunction(READY, null, { timeout: 120000 });
    check('abertura: terminou ao vivo (não demo-fallback)', await page.evaluate(() => __rs.status.kind) === 'live', await page.evaluate(() => __rs.status.kind));
    check('abertura: um lote recusado, nada refeito além dele', st.refused === 1 && st.br === Math.ceil(429 / 50) + 1, JSON.stringify(st));
    check('abertura: sem erro de página', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  {
    // 2) entrar em SP
    const { ctx, page } = await fresh();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    const st = await mockApi(page, { refuse: (isState, n) => isState && n === 1 });
    await page.goto(`${srv.url}index.html?debug=1`);
    await page.waitForFunction(READY, null, { timeout: 120000 });
    check('estado: o Brasil abriu ao vivo', await page.evaluate(() => __rs.status.kind) === 'live');
    const going = page.evaluate(() => __rs.nav.go('SP'));
    await page.waitForFunction((src) => { const e = document.getElementById('api-wait'); return !e.hidden && new RegExp(src).test(e.textContent); }, WAIT.source, { timeout: 60000 });
    const info = await page.evaluate(() => ({ txt: document.getElementById('api-wait').textContent, loading: document.body.dataset.loading, waiting: document.body.dataset.waiting, region: __rs.region.id }));
    check('estado: o indicador mostra a espera, com o Brasil ainda na tela', WAIT.test(info.txt) && info.loading === 'SP' && info.waiting === '1' && info.region === 'BR', JSON.stringify(info));
    check('estado: go(SP) resolve true', await going === true);
    await page.waitForFunction(() => __rs.region.id === 'SP' && !document.body.dataset.loading, null, { timeout: 120000 });
    const end = await page.evaluate(() => ({ kind: __rs.status.kind, hidden: document.getElementById('api-wait').hidden, waiting: document.body.dataset.waiting ?? null }));
    check('estado: terminou em SP ao vivo, aviso apagado', end.kind === 'live' && end.hidden && end.waiting === null, JSON.stringify(end));
    check('estado: um lote recusado', st.refused === 1, JSON.stringify(st));
    check('estado: sem erro de página', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} falha(s): ${fails.join('; ')}`); process.exit(1); }
  console.log('\ntudo ok');
})().catch((e) => { console.error(e); process.exit(1); });
