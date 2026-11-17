// Portão da região por ?uf=: SP abre com grade e cidades próprias, o fuso segue a região, DF e AM têm nuvem e chuva,
// uf desconhecida cai no Brasil, a fixture só vale no RS, ?mun= abre o município, API fora do ar vira demo com aviso.
const { serve, launch, open } = require('./lib.cjs');

(async () => {
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
  const label = (pg) => pg.evaluate(() => ({ text: document.querySelector('.tl-label').textContent, unix: __rs.field.times[0] + __rs.clock.t * 3600 }));
  const hourOf = (text) => Number(text.match(/(\d\d):\d\d$/)[1]);

  // ---------- SP: grade, região, busca, relevo desabilitado ----------
  {
    const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1&uf=SP&relevo=1');
    check('SP: grade com 469 pontos', await page.evaluate(() => __rs.grid.nP) === 469);
    check('SP: região SP', await page.evaluate(() => __rs.region.id) === 'SP');
    await page.fill('.cs-input', 'Campinas');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.getElementById('city').hidden && /Campinas/.test(document.getElementById('city').textContent), null, { timeout: 15000 }).catch(() => {});
    check('SP: busca abre o painel de Campinas', await page.evaluate(() => !document.getElementById('city').hidden && /Campinas/.test(document.getElementById('city').textContent)));
    await page.click('#debug-toggle');
    check('SP: relevo desabilitado no menu', await page.evaluate(() => document.querySelector('input[name=relevo]').disabled && document.querySelector('input[name=exagero]').disabled));
    check('SP: relevo=1 da URL ignorado, sem aviso', await page.evaluate(() => !__rs.stage.state.relevo && !__rs.stage.state.relevoDisponivel && document.querySelector('.dbg-msg').textContent === '' && !document.querySelector('input[name=relevo]').checked));
    check('SP: sem erro de console', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ---------- fuso: AM 1 h atrás do RS ----------
  {
    const rs = await open(browser, srv.url, 'demo=1&debug=1&uf=RS&t=5');
    const a = await label(rs.page); await rs.page.close();
    const am = await open(browser, srv.url, 'demo=1&debug=1&uf=AM&t=5');
    const b = await label(am.page); await am.page.close();
    const diff = (hourOf(a.text) - hourOf(b.text) - Math.round((a.unix - b.unix) / 3600) + 48) % 24;
    check('AM: rótulo 1 h atrás do RS', diff === 1, `${a.text} | ${b.text}`);
  }

  // ---------- DF e AM: há nuvem em algum horário ----------
  for (const uf of ['DF', 'AM']) {
    const { page, errors } = await open(browser, srv.url, `demo=1&debug=1&uf=${uf}&t=0`, { timeout: 60000 });
    let best = 0, at = -1;
    for (let h = 0; h <= 48 && best === 0; h += 6) {
      await page.evaluate((hh) => __rs.clock.seek(__rs.tNow + hh), h);
      await page.waitForTimeout(500);
      const n = await page.evaluate(() => __rs.stats().puffs);
      if (n > best) { best = n; at = h; }
    }
    check(`${uf}: abre e tem nuvens`, best > 0, `puffs ${best} em t=${at}`);
    check(`${uf}: região e sem erro de console`, await page.evaluate(() => __rs.region.id) === uf && errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ---------- uf desconhecida ----------
  {
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&uf=xx');
    check('uf=xx abre no Brasil', await page.evaluate(() => __rs.region.id) === 'BR');
    await page.close();
  }

  // ---------- fixture só no RS ----------
  {
    const { page } = await open(browser, srv.url, 'fixture=1&debug=1&uf=SP');
    check('fixture em SP não vira fixture', await page.evaluate(() => __rs.status.kind) !== 'fixture', await page.evaluate(() => __rs.status.kind));
    await page.close();
  }

  // ---------- ?mun= ----------
  {
    const { page } = await open(browser, srv.url, 'demo=1&debug=1&uf=SP&mun=3550308');
    check('mun=3550308 abre o painel de São Paulo', await page.evaluate(() => !document.getElementById('city').hidden && /São Paulo/.test(document.getElementById('city').textContent)));
    await page.close();
    const bad = await open(browser, srv.url, 'demo=1&debug=1&uf=SP&mun=0000000');
    check('mun desconhecido é ignorado', await bad.page.evaluate(() => document.getElementById('city').hidden) && bad.errors.length === 0, bad.errors.join(' | '));
    await bad.page.close();
  }

  // ---------- API fora do ar ----------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('https://api.open-meteo.com/**', (r) => r.abort());
    await page.goto(`${srv.url}index.html?debug=1&uf=SP`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
    check('API fora: SP cai em demo-fallback', await page.evaluate(() => __rs.status.kind) === 'demo-fallback');
    check('API fora: selo com classe warn', await page.evaluate(() => document.getElementById('badge').classList.contains('warn')));
    check('API fora: sem erro de página', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} falha(s): ${fails.join('; ')}`); process.exit(1); }
  console.log('\nportão da região: ok');
})().catch((e) => { console.error(e); process.exit(1); });
