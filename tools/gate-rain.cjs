// Portão 4: em fixture e demo, visto de cima, em 5 horários no meio do intervalo:
// toda coluna e todo traço de chuva desenhado cai em célula cujo dado bruto é molhado (≥ 0,1 mm).
const fs = require('node:fs');
const { serve, launch, open } = require('./lib.cjs');

(async () => {
  fs.mkdirSync('shots', { recursive: true });
  const srv = await serve(), browser = await launch();
  let bad = 0;
  for (const mode of ['fixture', 'demo']) {
    let total = 0;
    for (const t of [0.5, 12.5, 24.5, 48.5, 71.5]) {
      const { page, errors } = await open(browser, srv.url, `${mode}=1&debug=1&cam=top&t=${t}`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `shots/gate4-${mode}-${t}.png` });
      const r = await page.evaluate(() => {
        const t = __rs.clock.t, g = __rs.grid;
        // A1 (§6): o ponto pertence à célula do nó de grade mais próximo; vale o dado BRUTO desse nó
        const wet = (o) => { const p = g.nearest(o.lon, o.lat); return __rs.field.cellInfo(g.lons[p], g.lats[p], t).precip >= 0.1; };
        const cols = __rs.rainColumns().filter((c) => c.active), strokes = __rs.rainStrokes();
        return { t, cols: cols.length, strokes: strokes.length, badCols: cols.filter((c) => !wet(c)).length, badStrokes: strokes.filter((s) => !wet(s)).length, drops: __rs.stats().drops };
      });
      total += r.cols;
      bad += r.badCols + r.badStrokes + errors.length;
      console.log(`${mode} t=${t}: ${r.cols} colunas, ${r.strokes} traços; violações: ${r.badCols} colunas, ${r.badStrokes} traços; erros de console: ${errors.length}`);
      if (errors.length) console.log(errors.join('\n'));
      await page.close();
    }
    console.log(`${mode}: ${total} colunas ativas somadas${total === 0 ? '  (!) nenhuma chuva nesta fonte: o portão vale pela outra' : ''}`);
  }
  await browser.close(); srv.close();
  console.log(bad ? `FALHOU: ${bad} violações` : 'PORTÃO 4 OK');
  process.exit(bad ? 1 : 0);
})();
