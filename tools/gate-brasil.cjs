// Portão do Brasil como região de abertura: abre em BR (887 pontos, 1°), tooltip com o nome do estado, clique/toque num estado
// entra nele NO LUGAR (sem recarregar a página), "← Brasil" volta, busca nacional navega, o histórico do navegador funciona,
// a hora e o play são mantidos, rajadas valem pelo último pedido, nada vaza, falha ao entrar não troca, e o botão não cobre
// busca, selo nem menu de debug.
const { serve, launch, open } = require('./lib.cjs');

const UFS27 = ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'];
const READY = () => document.documentElement.dataset.ready === '1';

(async () => {
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };

  /** Ponto da tela (CSS px) sobre o centro de um estado do mapa do Brasil, projetado com a câmera da cena. */
  const screenOf = (page, stateName) => page.evaluate(async (name) => {
    const THREE = await import('three');
    const [, lon, lat] = __rs.region.geo.municipios.find((m) => m[0] === name);
    const s = __rs.region.proj.toScene(lon, lat);
    const v = new THREE.Vector3(s.x, 0, s.z).project(__rs.view.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }, stateName);
  /** Espera a troca no lugar terminar: URL com os trechos, sessão da região pedida (BR sem uf) e nada carregando. */
  const after = async (page, urlPart) => {
    await page.waitForFunction((parts) => parts.every((p) => location.search.includes(p)), urlPart, { timeout: 60000 });
    const id = (urlPart.find((p) => p.startsWith('uf=')) ?? 'uf=BR').slice(3);
    await landed(page, id);
  };
  const landed = (page, id) => page.waitForFunction((want) => window.__rs.region.id === want && !document.body.dataset.loading, id, { timeout: 120000 });
  const backToBR = async (page) => { await page.waitForFunction(() => !location.search.includes('uf='), null, { timeout: 60000 }); await landed(page, 'BR'); };
  const same = (page) => page.evaluate(() => window.__mesma === 1);
  const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const rects = (page, sels) => page.evaluate((ss) => Object.fromEntries(ss.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }]; })), sels);
  const listOf = (page) => page.evaluate(() => [...document.querySelectorAll('.cs-list li')].map((li) => ({ label: li.firstChild.textContent + (li.querySelector('b')?.textContent ?? '') + (li.childNodes[2]?.nodeType === 3 ? li.childNodes[2].textContent : ''), text: li.textContent, sub: li.querySelector('.cs-sub')?.textContent ?? '' })));
  const search = async (page, text, want) => {
    await page.fill('.cs-input', text);
    await page.waitForFunction((src) => [...document.querySelectorAll('.cs-list li')].some(eval(src)), want.toString(), { timeout: 60000 }).catch(() => {});
  };

  /** O voo de abertura terminou: o teto de distância voltou ao da vista (o navegador por software engasga e alonga o voo). */
  const flown = (page) => page.evaluate(async () => {
    const { framing } = await import('./src/render/scene.js');
    for (let i = 0; i < 1200; i++) { if (__rs.view.controls.maxDistance <= framing(__rs.region.bounds).maxDistance + 0.01) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  });

  // ---------- abertura ----------
  {
    const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1', { timeout: 120000 });
    check('BR: região BR', await page.evaluate(() => __rs.region.id) === 'BR');
    check('BR: 887 pontos a 1°', await page.evaluate(() => __rs.grid.nP === 887 && __rs.grid.step === 1));
    check('BR: #region-back oculto', await page.evaluate(() => document.getElementById('region-back').hidden));
    check('BR: #city oculto', await page.evaluate(() => document.getElementById('city').hidden));
    check('BR: busca visível', await page.evaluate(() => !document.getElementById('search').hidden));
    let best = 0, at = -1;
    for (let h = 0; h <= 48 && best === 0; h += 6) {
      await page.evaluate((hh) => __rs.clock.seek(__rs.tNow + hh), h);
      await page.waitForTimeout(500);
      const n = await page.evaluate(() => __rs.stats().puffs);
      if (n > best) { best = n; at = h; }
    }
    check('BR: tem nuvens em algum horário', best > 0, `puffs ${best} em t=${at}`);
    await page.click('#debug-toggle');
    check('BR: relevo e fixture desabilitados no menu', await page.evaluate(() => document.querySelector('input[name=relevo]').disabled && document.querySelector('input[name=dados][value=fixture]').disabled));
    check('BR: demo e ao vivo seguem habilitados', await page.evaluate(() => !document.querySelector('input[name=dados][value=demo]').disabled && !document.querySelector('input[name=dados][value=live]').disabled));
    check('BR: sem erro de console', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&uf=RS', { timeout: 60000 });
    await page.click('#debug-toggle');
    check('RS: fixture habilitado no menu', await page.evaluate(() => !document.querySelector('input[name=dados][value=fixture]').disabled));
    check('RS: #region-back visível', await page.evaluate(() => !document.getElementById('region-back').hidden));
    await page.close();
  }

  // ---------- tooltip, clique em estado, voltar (desktop) ----------
  {
    const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1&cam=top', { timeout: 120000 });
    await page.mouse.move(640, 400);
    await page.waitForFunction(() => !document.getElementById('tooltip').hidden, null, { timeout: 15000 }).catch(() => {});
    const title = await page.evaluate(() => document.querySelector('#tooltip .tt-title')?.textContent ?? '');
    check('tooltip no centro mostra um dos 27 estados', UFS27.includes(title), title);
    const sp = await screenOf(page, 'São Paulo');
    await page.mouse.move(sp.x, sp.y);
    await page.waitForFunction(() => document.querySelector('#tooltip .tt-title')?.textContent === 'São Paulo', null, { timeout: 15000 }).catch(() => {});
    check('tooltip sobre SP diz São Paulo', await page.evaluate(() => document.querySelector('#tooltip .tt-title')?.textContent) === 'São Paulo');
    await page.evaluate(() => { window.__mesma = 1; });
    await page.mouse.click(sp.x, sp.y);
    await after(page, ['uf=SP', 'demo=1', 'debug=1']);
    check('clique em SP entra sem recarregar', await same(page));
    check('clique em SP: abre SP, URL preserva demo e debug', await page.evaluate(() => __rs.region.id) === 'SP');
    check('SP: #region-back visível', await page.evaluate(() => !document.getElementById('region-back').hidden));
    const r = await rects(page, ['#region-back', '#search', '#badge', '#debug-toggle']);
    check('desktop: #region-back não cobre busca, selo nem menu', apart(r['#region-back'], r['#search']) && apart(r['#region-back'], r['#badge']) && apart(r['#region-back'], r['#debug-toggle']), JSON.stringify(r));
    await page.evaluate(() => { window.__mesma = 1; });
    await page.click('#region-back');
    await backToBR(page);
    check('← Brasil volta sem recarregar', await same(page));
    check('← Brasil volta ao Brasil sem uf', await page.evaluate(() => __rs.region.id === 'BR' && !location.search.includes('uf=') && location.search.includes('demo=1')));
    check('sem erro de console (clique e volta)', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ---------- busca nacional ----------
  {
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&cam=top', { timeout: 120000 });
    await search(page, 'campinas', (li) => /Campinas/.test(li.textContent) && li.querySelector('.cs-sub')?.textContent === 'SP');
    const l = await listOf(page);
    check('busca "campinas": lista Campinas com SP', l.some((x) => x.text.startsWith('Campinas') && x.sub === 'SP'), JSON.stringify(l.map((x) => x.text)));
    await page.evaluate(() => [...document.querySelectorAll('.cs-list li')].find((li) => li.textContent.startsWith('Campinas') && li.querySelector('.cs-sub')?.textContent === 'SP').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await after(page, ['uf=SP']);
    await page.waitForFunction(() => !document.getElementById('city').hidden, null, { timeout: 60000 });
    check('escolher Campinas abre SP com o painel de Campinas', await page.evaluate(() => __rs.region.id === 'SP' && !document.getElementById('city').hidden && /Campinas/.test(document.getElementById('city').textContent)));
    await page.close();
  }
  {
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&cam=top', { timeout: 120000 });
    await search(page, 'são domingos', (li) => li.querySelector('.cs-sub')?.textContent === 'SC');
    const l = (await listOf(page)).filter((x) => x.text.startsWith('São Domingos'));
    check('busca "são domingos": mais de uma linha, UFs diferentes', l.length > 1 && new Set(l.map((x) => x.sub)).size === l.length, JSON.stringify(l.map((x) => x.text)));
    await page.evaluate(() => [...document.querySelectorAll('.cs-list li')].find((li) => li.querySelector('.cs-sub')?.textContent === 'SC').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await after(page, ['uf=SC']);
    check('escolher São Domingos de SC abre SC', await page.evaluate(() => __rs.region.id) === 'SC');
    await page.close();
  }
  {
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&cam=top', { timeout: 120000 });
    await search(page, 'bahia', (li) => /Bahia/.test(li.textContent));
    const l = await listOf(page);
    check('busca "bahia": a primeira linha é o estado', l.length > 0 && l[0].text.startsWith('Bahia') && l[0].sub === 'estado', JSON.stringify(l.map((x) => x.text)));
    await page.keyboard.press('Enter');
    await after(page, ['uf=BA']);
    check('escolher Bahia abre BA', await page.evaluate(() => __rs.region.id) === 'BA');
    await page.close();
  }


  // ---------- troca no lugar ----------
  const abs = (page) => page.evaluate(() => __rs.field.times[0] + __rs.clock.t * 3600);
  {
    const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1&t=20', { timeout: 120000 });
    await page.evaluate(() => { window.__mesma = 1; });
    const before = await abs(page);
    check('go(SP) resolve true', await page.evaluate(() => __rs.nav.go('SP')) === true);
    check('go(SP): região SP, URL com uf, demo e debug, mesma página', await page.evaluate(() => __rs.region.id === 'SP' && ['uf=SP', 'demo=1', 'debug=1'].every((p) => location.search.includes(p)) && window.__mesma === 1), await page.evaluate(() => location.search));
    const afterT = await abs(page);
    check('hora mantida: o instante absoluto difere em menos de 1 s', Math.abs(afterT - before) < 1, `${before} -> ${afterT}`);
    check('sem loading preso', await page.evaluate(() => !document.body.dataset.loading));
    // histórico
    const histLen = await page.evaluate(() => history.length);
    await page.evaluate(() => history.back());
    await landed(page, 'BR');
    check('history.back volta ao Brasil sem recarregar', await page.evaluate(() => !location.search.includes('uf=') && window.__mesma === 1));
    await page.evaluate(() => history.forward());
    await landed(page, 'SP');
    check('history.forward volta a SP sem recarregar', await page.evaluate(() => location.search.includes('uf=SP') && window.__mesma === 1));
    check('popstate não criou entradas novas', await page.evaluate(() => history.length) === histLen, `${histLen}`);
    await page.evaluate(() => __rs.nav.go('BR'));
    check('go(BR) volta ao Brasil e tira uf', await page.evaluate(() => __rs.region.id === 'BR' && !location.search.includes('uf=') && location.search.includes('demo=1')));
    // rajada
    await page.evaluate(() => { __rs.nav.go('AM'); return __rs.nav.go('SC'); });
    await landed(page, 'SC');
    check('rajada AM, SC: termina em SC', await page.evaluate(() => __rs.region.id === 'SC' && location.search.includes('uf=SC') && !location.search.includes('uf=AM')));
    check('rajada: exatamente uma peça "land" na cena', await page.evaluate(() => { let n = 0; __rs.view.scene.traverse((o) => { if (o.name === 'land') n++; }); return n; }) === 1);
    check('sem erro de console (troca no lugar)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    // play e velocidade mantidos
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&t=10', { timeout: 120000 });
    await page.evaluate(() => { __rs.clock.setSpeed(4); __rs.clock.play(); });
    await page.evaluate(() => __rs.nav.go('PR'));
    check('play mantido ao entrar em PR', await page.evaluate(() => __rs.region.id === 'PR' && __rs.clock.playing === true && __rs.clock.speed === 4));
    await page.close();
  }
  {
    // menu de debug preservado
    const { page } = await open(browser, srv.url, 'demo=1&debug=1', { timeout: 120000 });
    await page.check('input[name=nuvens][value=sprite]');
    await page.evaluate(() => __rs.stage.idle());
    await page.evaluate(() => __rs.nav.go('SP'));
    check('nuvens=sprite preservado depois de entrar em SP', await page.evaluate(() => document.querySelector('input[name=nuvens][value=sprite]').checked && __rs.stage.state.nuvens === 'sprite' && location.search.includes('nuvens=sprite')), await page.evaluate(() => location.search));
    check('menu: relevo desabilitado em SP, fixture também', await page.evaluate(() => document.querySelector('input[name=relevo]').disabled && document.querySelector('input[name=dados][value=fixture]').disabled));
    await page.evaluate(() => __rs.nav.go('RS'));
    check('menu: no RS relevo e fixture voltam a ficar habilitados', await page.evaluate(() => !document.querySelector('input[name=relevo]').disabled && !document.querySelector('input[name=dados][value=fixture]').disabled));
    await page.close();
  }
  {
    // ouvintes e memória: 3 idas e voltas BR <-> SP
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
      window.__keys = [];
      const add = window.addEventListener.bind(window);
      window.addEventListener = (type, fn, opts) => { if (type === 'keydown') window.__keys.push(opts?.signal ?? null); return add(type, fn, opts); };
      window.__liveKeys = () => window.__keys.filter((s) => !s?.aborted).length;
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${srv.url}index.html?demo=1&debug=1`);
    await page.waitForFunction(READY, null, { timeout: 120000 });
    const settle = async () => { await page.evaluate(() => __rs.stage.idle()); await page.waitForTimeout(1500); };
    await settle();
    const mem0 = await page.evaluate(() => __rs.memory()), keysBR = await page.evaluate(() => __liveKeys());
    await page.evaluate(() => __rs.nav.go('SP'));
    await settle();
    const keysSP = await page.evaluate(() => __liveKeys());
    await page.evaluate(() => __rs.citySelect.selectByName('Campinas'));
    await page.evaluate(async () => { await __rs.nav.go('BR'); await __rs.nav.go('SP'); await __rs.nav.go('BR'); await __rs.nav.go('SP'); await __rs.nav.go('BR'); await __rs.nav.go('SP'); });
    check('3 idas e voltas: ouvintes de teclado vivos iguais aos da primeira visita', await page.evaluate(() => __liveKeys()) === keysSP, `${keysSP} -> ${await page.evaluate(() => __liveKeys())}`);
    await page.evaluate(async () => { await __rs.citySelect.selectByName('Campinas'); });
    await page.evaluate(() => { window.__changes = 0; new MutationObserver(() => { window.__changes++; }).observe(document.getElementById('city'), { attributes: true, attributeFilter: ['hidden'] }); __rs.clock.pause(); });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('Escape com município aberto fecha o painel uma vez só', await page.evaluate(() => document.getElementById('city').hidden && window.__changes === 1), await page.evaluate(() => `${window.__changes}`));
    const p0 = await page.evaluate(() => __rs.clock.playing);
    await page.keyboard.press('Space');
    check('espaço alterna o play uma vez só', await page.evaluate((was) => __rs.clock.playing === !was, p0));
    await page.evaluate(() => __rs.nav.go('BR'));
    check('ouvintes de teclado no Brasil iguais aos da abertura', await page.evaluate(() => __liveKeys()) === keysBR, `${keysBR} -> ${await page.evaluate(() => __liveKeys())}`);
    await settle();
    const mem1 = await page.evaluate(() => __rs.memory());
    check('memória de GPU depois de BR, SP, BR, SP, BR igual à de antes', JSON.stringify(mem0) === JSON.stringify(mem1), `${JSON.stringify(mem0)} -> ${JSON.stringify(mem1)}`);
    check('sem erro de página (idas e voltas)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    // clique real no mapa e voltar; busca nacional sem recarga
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&cam=top', { timeout: 120000 });
    await page.evaluate(() => { window.__mesma = 1; });
    const mg = await screenOf(page, 'Minas Gerais');
    await page.mouse.click(mg.x, mg.y);
    await after(page, ['uf=MG']);
    check('clique no centro de MG entra em MG sem recarregar', await same(page));
    await page.click('#region-back');
    await backToBR(page);
    check('#region-back volta ao Brasil sem recarregar', await page.evaluate(() => window.__mesma === 1 && __rs.region.id === 'BR'));
    await search(page, 'campinas', (li) => /Campinas/.test(li.textContent) && li.querySelector('.cs-sub')?.textContent === 'SP');
    await page.evaluate(() => [...document.querySelectorAll('.cs-list li')].find((li) => li.textContent.startsWith('Campinas') && li.querySelector('.cs-sub')?.textContent === 'SP').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await after(page, ['uf=SP']);
    await page.waitForFunction(() => !document.getElementById('city').hidden && /Campinas/.test(document.getElementById('city').textContent), null, { timeout: 60000 });
    check('busca "Campinas — SP" termina em SP com o painel aberto, sem recarregar', await same(page));
    check('mun não vai para a URL', await page.evaluate(() => !location.search.includes('mun=')));
    await page.close();
  }
  {
    // falha ao entrar: o Brasil responde, o estado não
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('https://api.open-meteo.com/**', (route) => {
      const sp = new URL(route.request().url()).searchParams, la = sp.get('latitude').split(','), lo = sp.get('longitude').split(',');
      if (![...la, ...lo].every((v) => Number.isInteger(Number(v)))) return route.abort('failed');       // grade de 0,25°: é um estado
      const start = Math.floor(Date.now() / 3600000) * 3600, n = 168, arr = (v) => Array.from({ length: n }, () => v);
      const body = la.map((v, i) => ({ latitude: +v, longitude: +lo[i], hourly: { time: Array.from({ length: n }, (_, h) => start + h * 3600), cloud_cover_low: arr(30), cloud_cover_mid: arr(20), cloud_cover_high: arr(10), precipitation: arr(0), weather_code: arr(1), wind_speed_10m: arr(10), wind_direction_10m: arr(90) } }));
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) });
    });
    await page.goto(`${srv.url}index.html?debug=1`);
    await page.waitForFunction(READY, null, { timeout: 120000 });
    check('falha: o Brasil abriu com dado ao vivo', await page.evaluate(() => __rs.status.kind) === 'live');
    check('falha: go(SP) resolve false', await page.evaluate(() => __rs.nav.go('SP')) === false);
    check('falha: continua em BR, sem uf na URL', await page.evaluate(() => __rs.region.id === 'BR' && !location.search.includes('uf=')));
    check('falha: #region-msg avisa', await page.evaluate(() => /Não foi possível carregar São Paulo/.test(document.getElementById('region-msg').textContent) && !document.getElementById('region-msg').hidden));
    check('falha: nada carregando', await page.evaluate(() => !document.body.dataset.loading));
    await page.waitForFunction(() => document.getElementById('region-msg').hidden, null, { timeout: 15000 }).catch(() => {});
    check('falha: o aviso some em ~5 s', await page.evaluate(() => document.getElementById('region-msg').hidden));
    check('falha: sem erro de página', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    // aberto direto num estado, o botão leva ao Brasil sem recarregar
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&uf=SP', { timeout: 120000 });
    await page.evaluate(() => { window.__mesma = 1; });
    await page.click('#region-back');
    await backToBR(page);
    check('uf=SP direto: #region-back leva ao Brasil sem recarregar', await page.evaluate(() => window.__mesma === 1 && __rs.region.id === 'BR'));
    await page.close();
  }
  {
    // movimento reduzido: corte seco, câmera na vista padrão
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const { page } = await open(ctx, srv.url, 'demo=1&debug=1', { timeout: 120000 });
    const t0 = Date.now();
    check('movimento reduzido: go(RJ) resolve true', await page.evaluate(() => __rs.nav.go('RJ')) === true);
    const r = await page.evaluate(async () => {
      const { framing } = await import('./src/render/scene.js');
      const f = framing(__rs.region.bounds), c = __rs.view.camera.position, t = __rs.view.controls.target;
      return { dist: Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z), want: f.dist, dx: t.x - f.target.x, dz: t.z - f.target.z };
    });
    check('movimento reduzido: câmera na vista padrão do estado', Math.abs(r.dist - r.want) < 0.5 && Math.abs(r.dx) < 0.1 && Math.abs(r.dz) < 0.1, JSON.stringify(r));
    await page.close(); await ctx.close();
  }

  {
    // busca nacional: se o download de busca.json falhar no primeiro foco, o foco seguinte tenta de novo
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let hits = 0;
    await page.route('**/busca.json', (r) => (++hits === 1 ? r.abort('failed') : r.continue()));
    await page.goto(`${srv.url}index.html?demo=1&cam=top`);
    await page.waitForFunction(READY, null, { timeout: 120000 });
    await page.focus('.cs-input');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelector('.cs-input').blur());
    await page.focus('.cs-input');
    await search(page, 'campinas', (li) => /Campinas/.test(li.textContent) && li.querySelector('.cs-sub')?.textContent === 'SP');
    check('busca: depois de falhar no 1º foco, o 2º baixa de novo e acha Campinas', hits === 2 && (await listOf(page)).some((x) => x.text.startsWith('Campinas') && x.sub === 'SP'), `${hits} pedidos`);
    await page.close();
  }

  {
    // pedido pela região que já está na tela durante o mergulho: o voo é cancelado e a câmera volta à vista do Brasil
    const { page } = await open(browser, srv.url, 'demo=1&debug=1', { timeout: 120000 });
    await flown(page);                                            // o voo de abertura termina (o navegador por software o alonga)
    const view = () => page.evaluate(async () => {
      const { framing } = await import('./src/render/scene.js');
      const f = framing(__rs.region.bounds), c = __rs.view.camera.position, t = __rs.view.controls.target;
      return { dist: Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z), want: f.dist, dx: t.x - f.target.x, dz: t.z - f.target.z };
    });
    const r = await page.evaluate(async () => {
      const first = __rs.nav.go('SP');
      await new Promise((res) => setTimeout(res, 400));
      const back = await __rs.nav.go('BR');
      return { first: await first, back };
    });
    await page.waitForTimeout(1500);
    const v = await view();
    check('mergulho cancelado: go(SP) false, go(BR) true, continua em BR', r.first === false && r.back === true && await page.evaluate(() => __rs.region.id === 'BR' && !location.search.includes('uf=') && !document.body.dataset.loading), JSON.stringify(r));
    check('mergulho cancelado: câmera de volta ao enquadramento do Brasil', Math.abs(v.dist - v.want) < 1 && Math.abs(v.dx) < 0.5 && Math.abs(v.dz) < 0.5, JSON.stringify(v));
    await page.close();
  }


  // ---------- revisão final: cargas duplicadas ou superadas, voo de abertura, relevo, histórico ----------
  /** API do tempo falsa: o Brasil (graus inteiros) e os estados respondem; `slow(url)` atrasa respostas; `seen` registra tudo. */
  const mockApi = async (page, { slow = () => 0, failStates = false } = {}) => {
    const seen = [];
    await page.route('https://api.open-meteo.com/**', async (route) => {
      const url = route.request().url(), sp = new URL(url).searchParams, la = sp.get('latitude').split(','), lo = sp.get('longitude').split(',');
      const isState = ![...la, ...lo].every((v) => Number.isInteger(Number(v)));
      const meanLat = la.reduce((a, v) => a + Number(v), 0) / la.length, meanLon = lo.reduce((a, v) => a + Number(v), 0) / lo.length;
      const uf = !isState ? 'BR' : meanLon < -56 ? 'AM' : meanLat < -25.6 ? 'SC' : 'SP';
      seen.push(uf);
      if (isState && failStates) return route.abort('failed');
      const ms = slow(uf);
      if (ms) await new Promise((r) => setTimeout(r, ms));
      const start = Math.floor(Date.now() / 3600000) * 3600, n = 168, arr = (v) => Array.from({ length: n }, () => v);
      const body = la.map((v, i) => ({ latitude: +v, longitude: +lo[i], hourly: { time: Array.from({ length: n }, (_, h) => start + h * 3600), cloud_cover_low: arr(30), cloud_cover_mid: arr(20), cloud_cover_high: arr(10), precipitation: arr(0), weather_code: arr(1), wind_speed_10m: arr(10), wind_direction_10m: arr(90) } }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.length === 1 ? body[0] : body) }).catch(() => {});   // pedido abortado: a resposta não tem para quem ir
    });
    return seen;
  };
  const openLive = async (query, opts) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const seen = await mockApi(page, opts);
    await page.goto(`${srv.url}index.html?${query}`);
    await page.waitForFunction(READY, null, { timeout: 120000 });
    return { page, errors, seen };
  };
  {
    // duplo toque: dois go('SP') seguidos são UMA carga de SP
    const { page, errors, seen } = await openLive('debug=1');
    const batches = await page.evaluate(async () => Math.ceil((await __rs.loadRegion('SP')).grid.nP / 50));
    seen.length = 0;
    const r = await page.evaluate(async () => { const a = __rs.nav.go('SP'), b = __rs.nav.go('SP'); return [await a, await b]; });
    check('duplo go(SP): o primeiro é superado, o segundo termina em SP', r[0] === false && r[1] === true && await page.evaluate(() => __rs.region.id) === 'SP', JSON.stringify(r));
    check('duplo go(SP): as requisições são as de UMA carga de SP', seen.filter((u) => u === 'SP').length === batches, `${seen.filter((u) => u === 'SP').length} de ${batches}`);
    check('duplo go(SP): sem erro de página', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    // rajada AM, SC: a carga de AM em voo é abortada, sem aviso de falha
    const { page, errors, seen } = await openLive('debug=1', { slow: (u) => (u === 'AM' ? 1500 : 0) });
    const amBatches = await page.evaluate(async () => Math.ceil((await __rs.loadRegion('AM')).grid.nP / 50));
    let finished = 0;
    page.on('requestfinished', (rq) => { const sp = new URL(rq.url()).searchParams; if (sp.get('latitude') && Number(sp.get('longitude').split(',')[0]) < -56) finished++; });
    seen.length = 0;
    await page.evaluate(() => { window.__am = __rs.nav.go('AM'); });
    while (seen.filter((u) => u === 'AM').length === 0) await page.waitForTimeout(50);   // a carga de AM já está na rede
    const r = await page.evaluate(async () => { const sc = __rs.nav.go('SC'); return [await window.__am, await sc]; });
    await landed(page, 'SC');
    await page.waitForTimeout(3500);                              // dá tempo de uma carga de AM que não foi abortada terminar
    const am = seen.filter((u) => u === 'AM').length;
    check('rajada AM, SC: AM superado, termina em SC', r[0] === false && r[1] === true && await page.evaluate(() => __rs.region.id === 'SC' && location.search.includes('uf=SC')), JSON.stringify(r));
    check('rajada AM, SC: as requisições de AM em voo foram abortadas', am <= 4 && am < amBatches && finished === 0, `${am} iniciadas de ${amBatches}, ${finished} completas`);
    check('rajada AM, SC: sem mensagem de falha', await page.evaluate(() => document.getElementById('region-msg').hidden && document.getElementById('region-msg').textContent === ''));
    check('rajada AM, SC: sem erro de página', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  {
    // voo de abertura: sem cam= a câmera se move; com cam= fica parada
    const dist = (page) => page.evaluate(() => { const c = __rs.view.camera.position, t = __rs.view.controls.target; return Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z); });
    const want = (page) => page.evaluate(async () => (await import('./src/render/scene.js')).framing(__rs.region.bounds).dist);
    const { page } = await open(browser, srv.url, 'demo=1&debug=1', { timeout: 120000 });
    const w = await want(page), d0 = await dist(page);
    await flown(page);
    const d1 = await dist(page);
    check('voo de abertura: sem cam= a câmera começa longe e chega à vista padrão', d0 > w * 1.1 && Math.abs(d1 - w) < 1, `${d0.toFixed(1)} -> ${d1.toFixed(1)} (vista ${w.toFixed(1)})`);
    await page.close();
    const { page: fixed } = await open(browser, srv.url, 'demo=1&debug=1&cam=se', { timeout: 120000 });
    const f0 = await dist(fixed);
    await fixed.waitForTimeout(3000);
    const f1 = await dist(fixed);
    check('voo de abertura: com cam=se a câmera não se move', Math.abs(f0 - w) < 1 && Math.abs(f1 - f0) < 0.01, `${f0.toFixed(2)} -> ${f1.toFixed(2)}`);
    await fixed.close();
  }
  {
    // callbacks por quadro do voo não se acumulam
    const { page } = await open(browser, srv.url, 'demo=1&debug=1', { timeout: 120000 });
    await flown(page);
    const c0 = await page.evaluate(() => __rs.view.frameCount());
    await page.evaluate(async () => { for (let i = 0; i < 3; i++) { await __rs.nav.go('SP'); await __rs.nav.go('BR'); } });
    await flown(page);
    const c1 = await page.evaluate(() => __rs.view.frameCount());
    check('3 idas e voltas BR <-> SP: callbacks por quadro iguais aos de antes', c1 === c0, `${c0} -> ${c1}`);
    await page.close();
  }
  {
    // relevo: RS com relevo -> Brasil -> RS volta com relevo, e a URL continua dizendo relevo=1
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&uf=RS&relevo=1&cam=se', { timeout: 120000 });
    check('RS abre com relevo', await page.evaluate(() => __rs.stage.state.relevo));
    await page.evaluate(() => __rs.nav.go('BR'));
    check('BR: relevo fora, controle desabilitado e desmarcado', await page.evaluate(() => !__rs.stage.state.relevo && document.querySelector('input[name=relevo]').disabled && !document.querySelector('input[name=relevo]').checked));
    await page.evaluate(() => __rs.nav.go('RS'));
    await page.evaluate(() => __rs.stage.idle());
    check('RS -> BR -> RS: o relevo volta na tela', await page.evaluate(() => __rs.stage.state.relevo && !!__rs.stage.map.userData.heightAt));
    check('RS -> BR -> RS: URL com relevo=1 e menu marcado', await page.evaluate(() => location.search.includes('relevo=1') && document.querySelector('input[name=relevo]').checked && !document.querySelector('input[name=relevo]').disabled), await page.evaluate(() => location.search));
    await page.close();
  }
  {
    // voltar/avançar para um estado que não carrega: a URL volta a dizer o que está na tela
    const { page, errors } = await openLive('debug=1', { failStates: true });
    await page.evaluate(() => { history.pushState(null, '', '?debug=1&uf=SP'); history.back(); });
    await page.waitForFunction(() => !location.search.includes('uf='));
    await page.evaluate(() => history.forward());
    await page.waitForFunction(() => !document.getElementById('region-msg').hidden, null, { timeout: 60000 });
    check('história: avançar para SP que falha mantém o Brasil na tela', await page.evaluate(() => __rs.region.id === 'BR' && !document.body.dataset.loading));
    check('história: ... e a URL sem uf', await page.evaluate(() => !location.search.includes('uf=') && location.search.includes('debug=1')), await page.evaluate(() => location.search));
    check('história: sem erro de página', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ---------- celular: tudo por toque ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const { page, errors } = await open(ctx, srv.url, 'demo=1&debug=1&cam=top', { timeout: 120000 });
    check('celular: BR com 887 pontos', await page.evaluate(() => __rs.region.id === 'BR' && __rs.grid.nP === 887));
    const sp = await screenOf(page, 'São Paulo');
    await page.touchscreen.tap(sp.x, sp.y);
    await after(page, ['uf=SP']);
    check('celular: toque em SP abre SP', await page.evaluate(() => __rs.region.id) === 'SP');
    const r = await rects(page, ['#region-back', '#search', '#badge', '#debug-toggle']);
    check('celular: #region-back não cobre busca, selo nem menu', apart(r['#region-back'], r['#search']) && apart(r['#region-back'], r['#badge']) && apart(r['#region-back'], r['#debug-toggle']), JSON.stringify(r));
    await page.tap('#region-back');
    await backToBR(page);
    check('celular: ← Brasil volta', await page.evaluate(() => __rs.region.id) === 'BR');
    await page.tap('.dbg-close');                                 // debug=1 abre o menu, que no celular cobre a lista da busca
    await page.tap('.cs-input');
    await page.fill('.cs-input', 'bahia');
    await page.waitForFunction(() => document.querySelector('.cs-list li'), null, { timeout: 30000 });
    await page.tap('.cs-list li');
    await after(page, ['uf=BA']);
    check('celular: busca por toque abre BA', await page.evaluate(() => __rs.region.id) === 'BA');
    check('celular: sem erro de console', errors.length === 0, errors.join(' | '));
    await page.close(); await ctx.close();
  }

  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} falha(s): ${fails.join('; ')}`); process.exit(1); }
  console.log('\nportão do Brasil: ok');
})().catch((e) => { console.error(e); process.exit(1); });
