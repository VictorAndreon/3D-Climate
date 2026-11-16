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
  await page.evaluate(() => __rs.stage.setRelief(false));
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

  await browser.close(); srv.close();
  if (fails.length) { console.log(`\n${fails.length} falha(s): ${fails.join('; ')}`); process.exit(1); }
  console.log('\nportão do menu de debug: ok');
})().catch((e) => { console.error(e); process.exit(1); });
