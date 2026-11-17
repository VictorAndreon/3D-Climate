// Portão do Brasil como região de abertura: abre em BR (887 pontos, 1°), tooltip com o nome do estado, clique/toque num estado
// navega para ele, "← Brasil" volta, busca nacional (estado e município) navega, e o botão não cobre busca, selo nem menu de debug.
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
  const after = async (page, urlPart) => {
    await page.waitForURL((u) => urlPart.every((p) => u.search.includes(p)), { timeout: 30000 });
    await page.waitForFunction(READY, null, { timeout: 60000 });
  };
  const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const rects = (page, sels) => page.evaluate((ss) => Object.fromEntries(ss.map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, { left: r.left, right: r.right, top: r.top, bottom: r.bottom }]; })), sels);
  const listOf = (page) => page.evaluate(() => [...document.querySelectorAll('.cs-list li')].map((li) => ({ label: li.firstChild.textContent + (li.querySelector('b')?.textContent ?? '') + (li.childNodes[2]?.nodeType === 3 ? li.childNodes[2].textContent : ''), text: li.textContent, sub: li.querySelector('.cs-sub')?.textContent ?? '' })));
  const search = async (page, text, want) => {
    await page.fill('.cs-input', text);
    await page.waitForFunction((src) => [...document.querySelectorAll('.cs-list li')].some(eval(src)), want.toString(), { timeout: 60000 }).catch(() => {});
  };

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
    await page.mouse.click(sp.x, sp.y);
    await after(page, ['uf=SP', 'demo=1', 'debug=1']);
    check('clique em SP: abre SP, URL preserva demo e debug', await page.evaluate(() => __rs.region.id) === 'SP');
    check('SP: #region-back visível', await page.evaluate(() => !document.getElementById('region-back').hidden));
    const r = await rects(page, ['#region-back', '#search', '#badge', '#debug-toggle']);
    check('desktop: #region-back não cobre busca, selo nem menu', apart(r['#region-back'], r['#search']) && apart(r['#region-back'], r['#badge']) && apart(r['#region-back'], r['#debug-toggle']), JSON.stringify(r));
    await page.click('#region-back');
    await page.waitForURL((u) => !u.search.includes('uf='), { timeout: 30000 });
    await page.waitForFunction(READY, null, { timeout: 120000 });
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
    await after(page, ['uf=SP', 'mun=3509502']);
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
    await page.waitForURL((u) => !u.search.includes('uf='), { timeout: 30000 });
    await page.waitForFunction(READY, null, { timeout: 120000 });
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
