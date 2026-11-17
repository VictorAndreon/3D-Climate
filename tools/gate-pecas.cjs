// Portão das peças que sabem ser desligadas (tarefa 5): o `signal` das interfaces remove de verdade os ouvintes
// (janela e canvas) e o palco troca a região inteira no lugar, sem duplicar objetos nem vazar memória de GPU.
const { serve, launch, open } = require('./lib.cjs');

(async () => {
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
  const frames = (pg, n = 4) => pg.evaluate((k) => new Promise((res) => { const f = () => (k-- > 0 ? requestAnimationFrame(f) : res()); f(); }), n);

  // ---------- signal ----------
  {
    const { page, errors } = await open(browser, srv.url, 'demo=1&cam=top&uf=RS&t=5');
    const r = await page.evaluate(async () => {
      const { createClock } = await import('./src/ui/clock.js');
      const { createTimeline } = await import('./src/ui/timeline.js');
      const { createTooltip } = await import('./src/ui/tooltip.js');
      const { makeFormat } = await import('./src/ui/format.js');
      const ctl = new AbortController();
      const clock = createClock({ tNow: 0, tEnd72: 72, tEndAll: 167 });
      let toggles = 0; clock.toggle = () => { toggles++; };
      const el = document.createElement('div'); document.body.append(el);
      createTimeline(el, { clock, times: Float64Array.from({ length: 168 }, (_, i) => 1.8e9 + i * 3600), rainByHour: new Float32Array(168), fmt: makeFormat('America/Sao_Paulo'), signal: ctl.signal });
      const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
      key(); const before = toggles;
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      let picks = 0;
      createTooltip(document.createElement('div'), { canvas, pick: () => { picks++; return null; }, field: {}, clock, municipios: [], proj: {}, signal: ctl.signal });
      const move = () => canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 5, clientY: 5 }));
      move(); const picksBefore = picks;
      ctl.abort();
      key(); key(); move(); move();
      el.remove(); canvas.remove();
      return { before, after: toggles, picksBefore, picksAfter: picks };
    });
    check('teclado na janela funciona antes de abortar', r.before === 1, JSON.stringify(r));
    check('depois de abortar, o ouvinte da janela (timeline) não roda', r.after === r.before, JSON.stringify(r));
    check('ouvinte do canvas (tooltip) funciona antes de abortar', r.picksBefore === 1, JSON.stringify(r));
    check('depois de abortar, o ouvinte do canvas não roda', r.picksAfter === r.picksBefore, JSON.stringify(r));
    check('sem erro de console (signal)', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ---------- setRegion ----------
  {
    // RS com relevo e grade; nuvens sólidas. Depois PE e BR (sem relevo) e volta.
    const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1&cam=se&uf=RS&relevo=1&nuvens=solidas&grade=1&t=30');
    const st = () => page.evaluate(() => ({ ...__rs.stage.state, mem: __rs.memory(), kids: __rs.view.scene.children.length }));
    const count = (name) => page.evaluate((n) => { let k = 0; __rs.view.scene.traverse((o) => { if (o.name === n) k++; }); return k; }, name);
    await page.evaluate(async () => { window.__r = { RS: __rs.region, PE: await __rs.loadRegion('PE'), BR: await __rs.loadRegion('BR') }; });
    const first = await st();
    check('abre no RS com relevo e grade', first.relevo && first.grade && first.relevoDisponivel, JSON.stringify(first));
    const oldRain = await page.evaluate(() => __rs.stage.rain.mesh.uuid);

    await page.evaluate(() => __rs.stage.setRegion(__r.PE)); await frames(page);
    let s = await st();
    check('PE: um único "land"', (await count('land')) === 1);
    check('PE: nuvens e grade preservadas', s.nuvens === 'solidas' && s.grade, JSON.stringify(s));
    check('PE: relevo desligado e indisponível', !s.relevo && !s.relevoDisponivel, JSON.stringify(s));
    check('PE: uma chuva, um raio, uma grade', (await count('rain')) === 1 && (await count('lightning')) === 1 && (await count('grid-dots')) === 1);
    check('PE: a chuva é outra (a antiga saiu)', await page.evaluate((u) => __rs.stage.rain.mesh.uuid !== u, oldRain));
    check('PE: pontos da grade são os da grade nova', await page.evaluate(() => __rs.stage.dots.points.geometry.attributes.position.count === __r.PE.grid.nP));

    await page.evaluate(() => __rs.stage.setRegion(__r.RS)); await frames(page);
    s = await st();
    check('volta ao RS: o relevo pedido volta ligado, disponível de novo', s.relevo && s.relevoDisponivel, JSON.stringify(s));
    check('volta ao RS: relevo liga de novo', await page.evaluate(async () => { await __rs.stage.setRelief(true, 12); const ok = __rs.stage.state.relevo; await __rs.stage.setRelief(false); return ok; }));
    const base = await st();

    // rajada: vale o último pedido
    await page.evaluate(async () => { __rs.stage.setRegion(__r.PE); __rs.stage.setRegion(__r.BR); await __rs.stage.idle(); });
    check('rajada: vale a última (BR)', await page.evaluate(() => __rs.stage.dots.points.geometry.attributes.position.count === __r.BR.grid.nP));

    // pedidos de nuvem e de relevo correndo junto com setRegion, nas duas ordens: vale o último pedido e o estado diz a verdade
    const kindOf = () => page.evaluate(() => ({ st: __rs.stage.state.nuvens, solid: __rs.stage.clouds.objects?.length === 4, vol: /^volume/.test(__rs.stats().cloudInfo ?? '') }));
    await page.evaluate(async () => { __rs.stage.setClouds('volume'); __rs.stage.setRegion(__r.PE); await __rs.stage.idle(); });
    let k = await kindOf();
    check('nuvem pedida ANTES de setRegion não se perde (volume)', k.st === 'volume' && k.vol, JSON.stringify(k));
    await page.evaluate(async () => { __rs.stage.setRegion(__r.BR); __rs.stage.setClouds('sprite'); await __rs.stage.idle(); });
    k = await kindOf();
    check('nuvem pedida DURANTE setRegion vale (sprite): estado e cena batem', k.st === 'sprite' && !k.vol && !k.solid, JSON.stringify(k));
    await page.evaluate(async () => { __rs.stage.setRegion(__r.PE); __rs.stage.setClouds('volume'); __rs.stage.setClouds('solidas'); await __rs.stage.idle(); });
    k = await kindOf();
    check('rajada de nuvens durante setRegion: vale a última (sólidas)', k.st === 'solidas' && k.solid, JSON.stringify(k));
    await page.evaluate(() => __rs.stage.setRegion(__r.PE).then(() => __rs.stage.setRegion(__r.BR)));
    await page.evaluate(async () => { __rs.stage.setRelief(true, 12).catch(() => {}); __rs.stage.setRegion(__r.PE); await __rs.stage.idle(); });
    check('relevo pedido sem relevo na região: não vira estado fantasma', await page.evaluate(() => !__rs.stage.state.relevo), '');
    await page.evaluate(() => __rs.stage.setRegion(__r.RS));
    await page.evaluate(async () => { __rs.stage.setRelief(true, 12).catch(() => {}); __rs.stage.setRegion(__r.RS); await __rs.stage.idle(); });
    check('relevo pedido ANTES de setRegion não se perde', await page.evaluate(() => __rs.stage.state.relevo && !!__rs.stage.map.userData.heightAt), '');
    await page.evaluate(async () => { __rs.stage.setRelief(false); __rs.stage.setRegion(__r.RS); __rs.stage.setRelief(true, 12).catch(() => {}); await __rs.stage.idle(); });
    check('relevo pedido DURANTE setRegion vale: estado e mapa batem', await page.evaluate(() => __rs.stage.state.relevo && !!__rs.stage.map.userData.heightAt), '');
    await page.evaluate(async () => { __rs.stage.setRelief(true, 12).catch(() => {}); __rs.stage.setRegion(__r.PE); await __rs.stage.idle(); });
    check('relevo pedido e região sem relevo: desligado, mapa plano', await page.evaluate(() => !__rs.stage.state.relevo && !__rs.stage.map.userData.heightAt), '');
    check('um único "land" depois das corridas', (await count('land')) === 1);
    await page.evaluate(async () => { await __rs.stage.setRegion(__r.RS); await __rs.stage.setRelief(false); await __rs.stage.setClouds('solidas'); });

    await page.evaluate(async () => { for (let i = 0; i < 3; i++) { await __rs.stage.setRegion(__r.PE); await __rs.stage.setRegion(__r.BR); await __rs.stage.setRegion(__r.RS); } });
    await page.waitForTimeout(900); await frames(page);
    const b = await st();
    check('um único "land" ao fim', (await count('land')) === 1);
    check('mesma quantidade de objetos na cena', b.kids === base.kids, `${base.kids} -> ${b.kids}`);
    check('memória volta ao que era no RS', b.mem.geometries === base.mem.geometries && b.mem.textures === base.mem.textures, JSON.stringify([base.mem, b.mem]));
    check('sem erro de console (setRegion)', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close(); srv.close();
  console.log(fails.length ? `\n${fails.length} FALHA(S)` : '\ntudo ok');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
