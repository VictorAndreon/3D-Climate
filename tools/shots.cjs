// node tools/shots.cjs <saida.png> "<query>" [largura altura]
const path = require('node:path');
const fs = require('node:fs');
const { serve, launch, open } = require('./lib.cjs');

(async () => {
  const [out, query = '', w = '1280', h = '800'] = process.argv.slice(2);
  if (!out) { console.error('uso: node tools/shots.cjs <saida.png> "<query>" [largura altura]'); process.exit(2); }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const srv = await serve(), browser = await launch();
  let code = 0;
  try {
    const { page, errors } = await open(browser, srv.url, query, { width: +w, height: +h });
    await page.waitForTimeout(600);
    await page.screenshot({ path: out });
    const stats = await page.evaluate(() => (window.__rs?.stats ? window.__rs.stats() : null));
    if (stats) console.log(JSON.stringify(stats));
    if (errors.length) { console.error('ERROS NO CONSOLE:\n' + errors.join('\n')); code = 1; }
  } catch (e) { console.error(String(e)); code = 1; }
  await browser.close(); srv.close(); process.exit(code);
})();
