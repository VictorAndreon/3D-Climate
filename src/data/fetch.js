// Busca da previsão no Open-Meteo: lotes de 50 pontos, no máximo 4 em paralelo.
import { HOURLY, normalizeResponse, buildSeries } from './normalize.js';

export const API = 'https://api.open-meteo.com/v1/forecast';

export function buildUrls(grid, batch = 50) {
  const urls = [];
  for (let a = 0; a < grid.nP; a += batch) {
    const b = Math.min(a + batch, grid.nP), la = [], lo = [];
    for (let p = a; p < b; p++) { la.push(grid.lats[p].toFixed(2)); lo.push(grid.lons[p].toFixed(2)); }
    urls.push(`${API}?latitude=${la.join(',')}&longitude=${lo.join(',')}&hourly=${HOURLY.join(',')}&forecast_hours=168&timeformat=unixtime&timezone=America/Sao_Paulo`);
  }
  return urls;
}

export const MAX_REFUSED_WINDOWS = 3;       // janelas de 1 min recusadas seguidas (sem nenhum lote entre elas) antes de desistir

const abortError = () => new DOMException('carga abortada', 'AbortError');
/** Dorme `ms`; o `signal` cancela a espera (rejeita na hora). */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(abortError());
  const done = () => { clearTimeout(t); signal.removeEventListener('abort', onAbort); };
  const onAbort = () => { done(); reject(abortError()); };
  const t = setTimeout(() => { done(); resolve(); }, ms);
  signal.addEventListener('abort', onAbort);
});

/** Fim da janela de cota segundo `X-RateLimit-Reset` (segundos unix) + padding; sem o cabeçalho (o CORS pode escondê-lo), agora + padrão. */
function waitUntil(res, nowMs, { waitPadMs, waitDefaultMs }) {
  const reset = Number(res.headers?.get?.('X-RateLimit-Reset'));
  return Number.isFinite(reset) && reset > 0 ? Math.max(reset * 1000 + waitPadMs, nowMs) : nowMs + waitDefaultMs;
}

/** Rejeita em qualquer falha (rede, HTTP != 2xx, error:true, lote incompleto, séries tortas).
 *  HTTP 429 (limite de pontos por minuto) não é falha: guarda os lotes recebidos, todos os trabalhadores param, espera a
 *  janela liberar e refaz os que faltam; `onWait({ until })` avisa o começo da espera (ms unix) e `onWait(null)` o fim.
 *  Só rejeita se MAX_REFUSED_WINDOWS janelas seguidas forem recusadas. O tempo-limite por lote não conta a espera.
 *  `signal` externo: quem pediu desistiu (pedido superado); aborta os lotes em voo, a espera e os que faltam. */
export async function fetchForecast(grid, { fetchImpl = fetch, parallel = 4, batch = 50, timeoutMs = 10000, signal, onWait, waitPadMs = 1000, waitDefaultMs = 61000 } = {}) {
  const urls = buildUrls(grid, batch), parts = new Array(urls.length);
  const all = new AbortController();               // um lote falhou: aborta os outros (não gasta cota à toa)
  const onOuter = () => all.abort();
  if (signal?.aborted) throw abortError();
  signal?.addEventListener('abort', onOuter);
  let next = 0, gate = null, windowId = 0, refused = 0;
  const retry = [];                                // lotes recusados por 429, a refazer antes dos novos
  const nextBatch = () => (retry.length ? retry.shift() : next < urls.length ? next++ : -1);

  /** Primeira recusa da janela: todos esperam o mesmo portão. Recusas de pedidos já em voo na mesma janela só reenfileiram. */
  function refuse(res, startedIn) {
    if (gate || startedIn !== windowId) return;
    if (++refused >= MAX_REFUSED_WINDOWS) throw new Error(`Open-Meteo: HTTP 429 em ${refused} janelas seguidas`);
    const until = waitUntil(res, Date.now(), { waitPadMs, waitDefaultMs });
    onWait?.({ until });
    gate = (async () => {
      try { await sleep(until - Date.now(), all.signal); }
      finally { gate = null; windowId++; onWait?.(null); }
    })();
    gate.catch(() => {});                          // quem espera o portão recebe o erro; aqui só evita rejeição solta
  }

  async function worker() {
    for (;;) {
      while (gate) await gate;
      if (all.signal.aborted) throw abortError();
      const i = nextBatch();
      if (i < 0) return;
      const expected = Math.min(batch, grid.nP - i * batch), startedIn = windowId;
      const ctl = new AbortController();
      const onAll = () => ctl.abort();
      all.signal.addEventListener('abort', onAll);
      const timer = setTimeout(() => ctl.abort(), timeoutMs);   // rede pendurada vira falha, não espera eterna
      let locs;
      try {
        const res = await fetchImpl(urls[i], { signal: ctl.signal });
        if (res.status === 429) { retry.push(i); refuse(res, startedIn); continue; }
        if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
        locs = normalizeResponse(await res.json());
      } finally { clearTimeout(timer); all.signal.removeEventListener('abort', onAll); }
      if (locs.length !== expected) throw new Error(`Open-Meteo: lote ${i} com ${locs.length} locais, esperado ${expected}`);
      parts[i] = locs;
      refused = 0;                                 // a API aceitou um lote: a sequência de janelas recusadas acabou
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, worker)); }
  catch (e) { all.abort(); throw e; }
  finally { signal?.removeEventListener('abort', onOuter); }
  return buildSeries(grid, parts.flat());
}
