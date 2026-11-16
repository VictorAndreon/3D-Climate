// Portão do menu de debug: o palco troca nuvens, relevo e grade no lugar (sem recarregar, sem vazar),
// e o menu reflete e reescreve a URL.
const { serve, launch, open } = require('./lib.cjs');

(async () => {
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
  const frames = (pg, n = 4) => pg.evaluate((k) => new Promise((res) => { const f = () => (k-- > 0 ? requestAnimationFrame(f) : res()); f(); }), n);

  // ---------- palco ----------
  {
  const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1&t=30');
  await frames(page);
  const st = () => page.evaluate(() => ({ ...__rs.stage.state, mem: __rs.memory(), info: __rs.stats().cloudInfo, t: __rs.clock.t }));
  const cam = () => page.evaluate(() => __rs.view.camera.position.toArray());   // expor `view` em __rs

  const a = await st();
  check('abre com sólidas, sem relevo, grade ligada', a.nuvens === 'solidas' && !a.relevo && a.grade);

  await page.evaluate(() => __rs.stage.setClouds('volume'));
  let s = await st();
  check('volume entra no lugar', s.nuvens === 'volume' && /^volume /.test(s.info));
  check('horário não muda na troca', s.t === a.t);

  await page.evaluate(() => __rs.stage.setClouds('sprite'));
  check('sprite entra no lugar', (await st()).nuvens === 'sprite');

  // Review Focus 1: rajada, sem esperar a primeira
  await page.evaluate(async () => { __rs.stage.setClouds('volume'); __rs.stage.setClouds('solidas'); await __rs.stage.idle(); });
  check('rajada: vale a última', (await st()).nuvens === 'solidas');

  const c0 = await cam();
  await page.evaluate(() => __rs.stage.setRelief(true, 12));
  s = await st();
  check('relevo liga', s.relevo && s.exagero === 12);
  const h12 = await page.evaluate(() => __rs.stage.map.userData.heightAt(0, 0));
  await page.evaluate(() => __rs.stage.setRelief(true, 24));
  const h24 = await page.evaluate(() => __rs.stage.map.userData.heightAt(0, 0));
  check('exagero 24 dobra a altura', Math.abs(h24 - 2 * h12) < 1e-6 && h12 > 0, `${h12} -> ${h24}`);
  check('câmera não muda na troca', JSON.stringify(await cam()) === JSON.stringify(c0));

  // Review Focus 4: município selecionado sobrevive à troca de mapa
  await page.evaluate(() => __rs.citySelect.selectByName('Porto Alegre'));
  const liftTop = () => page.evaluate(() => { const g = __rs.view.scene.getObjectByName('city').geometry; g.computeBoundingBox(); return g.boundingBox.max.y; });
  const topRelief = await liftTop();
  await page.evaluate(() => __rs.stage.setRelief(false));
  const topFlat = await liftTop();
  check('peça levantada desce para a altura do mapa plano', topRelief > topFlat + 0.01, `${topRelief.toFixed(3)} -> ${topFlat.toFixed(3)}`);
  check('município continua selecionado ao desligar o relevo',
    await page.evaluate(() => !document.getElementById('city').hidden && /Porto Alegre/.test(document.getElementById('city').textContent)));
  await page.keyboard.press('Escape');

  await page.evaluate(() => __rs.stage.setDots(false));
  check('grade desliga', await page.evaluate(() => !__rs.stage.state.grade && !__rs.view.scene.getObjectByName('grid-dots')));
  await page.evaluate(() => __rs.stage.setDots(true));

  // Review Focus 5: ida e volta não vaza
  await page.evaluate(async () => { for (let i = 0; i < 3; i++) { await __rs.stage.setClouds('volume'); await __rs.stage.setRelief(true, 12); await __rs.stage.setClouds('sprite'); await __rs.stage.setRelief(false); await __rs.stage.setClouds('solidas'); } });
  await page.waitForTimeout(900); await frames(page);
  const b = await st();
  check('memória volta ao inicial', b.mem.geometries === a.mem.geometries && b.mem.textures === a.mem.textures, JSON.stringify([a.mem, b.mem]));
  check('sem erro de console', errors.length === 0, errors.join(' | '));
  await page.close();
  }

  // estado inicial pela URL
  {
  const { page } = await open(browser, srv.url, 'demo=1&debug=1&nuvens=volume&relevo=1&exagero=20');
  const s = await page.evaluate(() => __rs.stage.state);
  check('URL monta o estado inicial', s.nuvens === 'volume' && s.relevo && s.exagero === 20 && s.grade, JSON.stringify(s));
  await page.close();
  }

  // ---------- menu ----------
  {
  const { page: m } = await open(browser, srv.url, 'demo=1&cam=top&t=5');
  check('fechado por padrão, só o botão', await m.evaluate(() => document.getElementById('debug').hidden && document.getElementById('debug-toggle').getBoundingClientRect().width > 0));
  check('sem debug=1 não expõe __rs', await m.evaluate(() => typeof window.__rs === 'undefined'));
  await m.click('#debug-toggle');
  check('abre no clique', await m.evaluate(() => !document.getElementById('debug').hidden));
  check('estatísticas aparecem', /fps/.test(await m.textContent('.dbg-stats')));

  await m.check('input[name=nuvens][value=sprite]');
  await m.waitForFunction(() => location.search.includes('nuvens=sprite'));
  check('URL preserva cam e t', await m.evaluate(() => location.search === '?cam=top&t=5&nuvens=sprite&demo=1'), await m.evaluate(() => location.search));

  check('exagero desabilitado sem relevo', await m.isDisabled('input[name=exagero]'));
  await m.check('input[name=relevo]');
  await m.waitForFunction(() => location.search.includes('relevo=1'));
  await m.fill('input[name=exagero]', '20');
  await m.waitForFunction(() => location.search.includes('exagero=20'));
  check('rótulo do exagero', /20×/.test(await m.textContent('#debug')));

  await m.check('input[name=qualidade][value=baixo]');
  await m.waitForFunction(() => location.search.includes('qualidade=baixo'));
  check('estatística mostra qualidade travada', /qualidade baixo/.test(await m.textContent('.dbg-stats')));

  await m.check('input[name=grade]');
  await m.waitForFunction(() => location.search.includes('grade=1'));

  // recarregar com a URL atual reproduz o menu
  await m.reload(); await m.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await m.click('#debug-toggle');
  check('recarregado: menu reflete a URL', await m.evaluate(() => {
    const v = (n) => document.querySelector(`input[name=${n}]:checked`)?.value;
    return v('nuvens') === 'sprite' && v('qualidade') === 'baixo' && document.querySelector('input[name=relevo]').checked
      && document.querySelector('input[name=exagero]').value === '20' && document.querySelector('input[name=grade]').checked;
  }));

  // Dados recarrega com a URL nova
  await m.check('input[name=dados][value=fixture]');
  await m.waitForURL(/fixture=1/); await m.waitForFunction(() => document.documentElement.dataset.ready === '1');
  check('Dados troca a fonte recarregando', await m.evaluate(() => !location.search.includes('demo=1')));

  // rajada pelo menu: controles, URL e palco terminam iguais
  const { page: r } = await open(browser, srv.url, 'demo=1&debug=1');
  await r.evaluate(() => { document.querySelector('input[name=nuvens][value=volume]').click(); document.querySelector('input[name=nuvens][value=sprite]').click(); });
  await r.waitForFunction(() => location.search.includes('nuvens=sprite'));
  await r.evaluate(() => __rs.stage.idle()); await r.waitForTimeout(200);
  check('rajada no menu: rádio, URL e palco em sprite', await r.evaluate(() => document.querySelector('input[name=nuvens]:checked').value === 'sprite' && __rs.stage.state.nuvens === 'sprite' && !location.search.includes('volume')));
  await r.close();

  // relevo indisponível já na abertura (?relevo=1): menu não pode marcar relevo sobre o mapa plano
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/relief.bin.gz', (rt) => rt.abort());
  const { page: b0 } = await open(ctx, srv.url, 'demo=1&debug=1&relevo=1&exagero=20');
  check('abertura com relevo falho: desmarcado, aviso, URL sem relevo', await b0.evaluate(() => !document.querySelector('input[name=relevo]').checked
    && document.querySelector('input[name=exagero]').disabled && document.querySelector('.dbg-msg').textContent.includes('Relevo indisponível') && !location.search.includes('relevo')),
    await b0.evaluate(() => `${document.querySelector('input[name=relevo]').checked} "${document.querySelector('.dbg-msg').textContent}" ${location.search}`));
  await ctx.close();

  // Review Focus 3: relevo indisponível
  const { page: f } = await open(browser, srv.url, 'demo=1');
  await f.route('**/relief.bin.gz', (r) => r.abort());
  await f.click('#debug-toggle'); await f.check('input[name=relevo]').catch(() => {});
  await f.waitForFunction(() => document.querySelector('.dbg-msg').textContent.includes('Relevo indisponível'));
  check('relevo falho: desmarcado, URL intacta', await f.evaluate(() => !document.querySelector('input[name=relevo]').checked && !location.search.includes('relevo')));

  await m.close(); await f.close();                        // cada página aberta segue renderizando; fecha antes de abrir mais
  // sobreposição, desktop e celular
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const { page: p } = await open(browser, srv.url, 'demo=1&debug=1', { width: w, height: h });
    await p.evaluate(() => __rs.citySelect.selectByName('Porto Alegre')); await p.waitForTimeout(400);
    check(`painel do município aberto em ${w}×${h}`, await p.evaluate(() => !document.getElementById('city').hidden));
    const hit = await p.evaluate(() => {
      const r = (id) => { const e = document.getElementById(id); return e && !e.hidden ? e.getBoundingClientRect() : null; };
      const d = r('debug'), over = (b) => b && !(d.right <= b.left || d.left >= b.right || d.bottom <= b.top || d.top >= b.bottom);
      return ['timeline', 'search', 'city'].filter((id) => over(r(id)));
    });
    check(`menu não cobre nada em ${w}×${h}`, hit.length === 0, hit.join(','));
    await p.close();
  }
  }

  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} falha(s): ${fails.join('; ')}`); process.exit(1); }
  console.log('\nportão do menu de debug: ok');
})().catch((e) => { console.error(e); process.exit(1); });
