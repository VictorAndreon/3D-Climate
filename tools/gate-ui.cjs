// Portão 5: roteiro de interface em modo demo — play, espaço, scrub, velocidade, setas, Home, 7 dias, tooltip, selo.
const fs = require('node:fs');
const { serve, launch, open } = require('./lib.cjs');

(async () => {
  fs.mkdirSync('shots', { recursive: true });
  const srv = await serve(), browser = await launch();
  const fails = [];
  const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
  const clock = (page) => page.evaluate(() => ({ t: __rs.clock.t, playing: __rs.clock.playing, speed: __rs.clock.speed, tMax: __rs.clock.tMax, tNow: __rs.clock.tNow }));

  const { page, errors } = await open(browser, srv.url, 'demo=1&debug=1');
  let c0 = await clock(page);
  check('abre pausado em "agora"', !c0.playing && Math.abs(c0.t - c0.tNow) < 1e-9);

  await page.click('.tl-play'); await page.waitForTimeout(700);
  let c = await clock(page);
  check('play avança a linha do tempo', c.playing && c.t > c0.t + 0.05, `t ${c0.t.toFixed(2)} -> ${c.t.toFixed(2)}`);

  await page.mouse.move(640, 200);                       // tira o foco visual do botão
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space'); await page.waitForTimeout(100);
  c = await clock(page);
  check('espaço pausa', !c.playing);

  const box = await page.locator('.tl-track').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7);
  await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 5 }); await page.mouse.up();
  const cs = await clock(page);
  check('scrub por arrasto muda o tempo', Math.abs((cs.t - cs.tNow) / (cs.tMax - cs.tNow) - 0.6) < 0.03, `fração ${((cs.t - cs.tNow) / (cs.tMax - cs.tNow)).toFixed(3)}`);
  const label = await page.textContent('.tl-label');
  check('rótulo no formato "sex 14/11, 15:00"', /^(dom|seg|ter|qua|qui|sex|sáb) \d{2}\/\d{2}, \d{2}:\d{2}$/.test(label), label);

  await page.click('.tl-speeds button[data-speed="4"]');
  check('troca de velocidade para 4×', (await clock(page)).speed === 4);

  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  c = await clock(page);
  check('seta direita vai para a próxima hora cheia', c.t === Math.floor(cs.t + 1e-9) + 1, `${cs.t.toFixed(2)} -> ${c.t}`);
  await page.keyboard.press('ArrowLeft');
  check('seta esquerda volta 1 h', (await clock(page)).t === c.t - 1);
  await page.keyboard.press('Home');
  c = await clock(page);
  check('Home volta para agora', Math.abs(c.t - c.tNow) < 1e-9);

  await page.click('.tl-range');
  const c7 = await clock(page);
  check('botão 7 dias amplia a faixa', c7.tMax > c.tMax + 24, `tMax ${c.tMax.toFixed(1)} -> ${c7.tMax.toFixed(1)}`);
  await page.click('.tl-range');

  await page.mouse.move(700, 380, { steps: 3 }); await page.waitForTimeout(150);
  const tip = await page.evaluate(() => { const e = document.getElementById('tooltip'); return { hidden: e.hidden, text: e.innerText }; });
  check('tooltip abre sobre o estado com %, mm/h e km/h', !tip.hidden && tip.text.includes('%') && tip.text.includes('mm/h') && tip.text.includes('km/h'), tip.text.replace(/\n/g, ' | '));
  await page.screenshot({ path: 'shots/gate5-desktop.png' });
  await page.mouse.move(30, 300, { steps: 3 }); await page.waitForTimeout(150);
  check('tooltip some fora do estado', await page.evaluate(() => document.getElementById('tooltip').hidden));

  await page.mouse.click(700, 380); await page.waitForTimeout(1500);
  const city = await page.evaluate(() => ({ name: __rs.citySelect.current?.name, text: document.getElementById('city').innerText }));
  check('clique no estado seleciona o município e abre o painel', city.name && city.text.includes(city.name) && city.text.includes('km²') && city.text.includes('mm/h'), city.name);
  const before = (await clock(page)).t;
  const svgBox = await page.locator('.cp-svg').boundingBox();
  await page.mouse.click(svgBox.x + svgBox.width * 0.5, svgBox.y + svgBox.height * 0.5);
  check('clique no meteograma move a linha do tempo', Math.abs((await clock(page)).t - before) > 1);
  await page.screenshot({ path: 'shots/gate5-city.png' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);
  check('Esc fecha o município', await page.evaluate(() => !__rs.citySelect.current && document.getElementById('city').hidden));
  await page.keyboard.press('Home');

  const badge = await page.textContent('#badge');
  check('selo de demo visível', badge.includes('DEMO') && await page.evaluate(() => document.getElementById('badge').classList.contains('warn')), badge);
  check('legenda com 5 itens', (await page.locator('#legend .lg-item').count()) === 5);
  check('sem erro no console (desktop)', errors.length === 0, errors.join(' / '));
  await page.close();

  // celular: toque abre o tooltip, rodapé cabe na tela
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const m = await ctx.newPage();
  const merr = []; m.on('console', (x) => { if (x.type() === 'error') merr.push(x.text()); }); m.on('pageerror', (e) => merr.push(String(e)));
  await m.goto(`${srv.url}index.html?demo=1&debug=1`);
  await m.waitForFunction(() => document.documentElement.dataset.ready === '1');
  const fb = await m.locator('#timeline').boundingBox();
  check('rodapé cabe na largura do celular', fb.x >= 0 && fb.x + fb.width <= 390, `${fb.x.toFixed(0)}..${(fb.x + fb.width).toFixed(0)}`);
  await m.touchscreen.tap(210, 430); await m.waitForTimeout(1500);
  const sel = await m.evaluate(() => ({ name: __rs.citySelect.current?.name, panel: !document.getElementById('city').hidden, tip: !document.getElementById('tooltip').hidden }));
  check('toque abre o painel do município no celular (no lugar do tooltip)', sel.name && sel.panel && !sel.tip, JSON.stringify(sel));
  const cb = await m.locator('#city').boundingBox(), tb = await m.locator('#timeline').boundingBox();
  check('painel do município não cobre o rodapé', cb.y + cb.height <= tb.y, `${(cb.y + cb.height).toFixed(0)} <= ${tb.y.toFixed(0)}`);
  await m.screenshot({ path: 'shots/gate5-mobile.png' });
  check('sem erro no console (celular)', merr.length === 0, merr.join(' / '));
  await ctx.close();

  await browser.close(); srv.close();
  console.log(fails.length ? `FALHOU: ${fails.join('; ')}` : 'PORTÃO 5 OK');
  process.exit(fails.length ? 1 : 0);
})();
