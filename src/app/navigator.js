// Navegador: entra e sai de uma região sem recarregar a página. Carrega região e dado com a região atual ainda na tela
// (document.body.dataset.loading = sigla), mergulha a câmera, e só então troca: palco, sessão nova (mesmo instante da
// linha do tempo, play e velocidade), câmera. Pedido novo supera o anterior. O histórico do navegador acompanha.
import { loadRegion, regionBounds } from '../data/region.js';
import { framing } from '../render/scene.js';
import { regionSearch } from '../ui/region-nav.js';
import { parseConfig, DEFAULT_REGION } from '../ui/config.js';
import { createSession } from './session.js';
import { createWaitNotice } from '../ui/wait.js';

const MSG_MS = 5000;
const DIVE_S = 1.1;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * loadData(region, signal, onWait) → data (a mesma forma de loadWeather); sessionDeps: { lights }, repassado a cada sessão;
 * onSession(session) roda a cada sessão nova (a primeira inclusive), no mesmo quadro da troca.
 */
export function createNavigator({ view, stage, index, cfg, loadData, sessionDeps, onSession = () => {} }) {
  const ufs = index.map((r) => r.id);
  let current = null, reqId = 0, diving = false, swapChain = Promise.resolve(), msgTimer = 0;
  const waitNotice = createWaitNotice(document.getElementById('api-wait'), { hide: true, flag: document.body });   // "aguardando a API…" ao entrar num estado
  const loads = new Map();                                   // sigla -> { ctl, promise }: carga em voo de cada região
  const hasCam = () => new URLSearchParams(location.search).has('cam');   // cam= fixa a vista (roteiros): sem voo de abertura

  function makeSession(region, data, from) {
    const s = createSession({ view, stage, region, data, from, index, go: (id, opts) => go(id, opts), ...sessionDeps });
    current = s;
    onSession(s);
    return s;
  }

  /** Câmera da região nova: vista padrão dela e, se couber, voo de abertura; com município, a câmera vai até ele. */
  async function arrive(session, { mun, animate, req = reqId }) {
    let focused = false;
    if (mun && session.region.hasCities) focused = await session.focusMun(mun, animate ? 0.9 : 0);
    if (!focused && animate && !hasCam() && req === reqId && session === current) view.flyIn('se');   // pedido superado não mexe na câmera
  }

  /** Carga de região e dado; quem pede a mesma região em voo reaproveita a promessa (duplo toque = uma carga só). */
  function load(id, info) {
    let l = loads.get(id);
    if (l) return l.promise;
    const ctl = new AbortController();
    const promise = (async () => { const region = await loadRegion(info); return { region, data: await loadData(region, ctl.signal, waitNotice) }; })();
    l = { ctl, promise };
    loads.set(id, l);
    const drop = () => { if (loads.get(id) === l) loads.delete(id); waitNotice(null); };
    promise.then(drop, drop);
    return promise;
  }
  /** Pedido novo supera as cargas das outras regiões: aborta as requisições delas (não gasta cota à toa). */
  function abortLoadsExcept(keep) {
    for (const [id, l] of loads) if (id !== keep) { l.ctl.abort(); loads.delete(id); }
  }

  /** Primeira sessão, depois de palco e dado prontos. */
  async function start(region, data) {
    const s = makeSession(region, data);
    await arrive(s, { mun: cfg.mun, animate: !reduced() });   // voo de abertura (arrive o pula com cam= na URL)
  }

  function say(text) {
    const el = document.getElementById('region-msg');
    clearTimeout(msgTimer);
    el.textContent = text; el.hidden = false;
    msgTimer = setTimeout(() => { el.hidden = true; el.textContent = ''; }, MSG_MS);
  }
  const clearLoading = () => { delete document.body.dataset.loading; };
  const urlOf = (region) => { const q = regionSearch(location.search, { uf: region.id === DEFAULT_REGION ? null : region.id }); return location.pathname + (q ? `?${q}` : '') + location.hash; };
  /** Voltar/avançar para uma região que não carregou: a URL já mudou, a cena não; a URL volta a dizer o que está na tela. */
  const failed = (pop, req) => { if (pop && req === reqId) history.replaceState(null, '', urlOf(current.region)); };

  /** Passa a região para o palco e troca a sessão no mesmo quadro (nada entre as duas coisas espera um quadro). */
  async function commit(req, region, data, { mun, pop, info }) {
    if (req !== reqId) return false;                           // superado enquanto esperava a vez: a cena não é tocada
    try { await stage.setRegion(region); }
    catch (e) { console.warn('troca de região falhou', e); if (req === reqId) { clearLoading(); say(`Não foi possível carregar ${info.name}.`); failed(pop, req); } return false; }
    const old = current;
    const from = { t: old.clock.t, times: old.field.times, playing: old.clock.playing, speed: old.clock.speed, range: old.clock.range };
    old.dispose();
    const s = makeSession(region, data, from);               // o campo novo nasce aqui: nenhum quadro roda com o campo velho na região nova
    view.setRegion(region.bounds);
    if (!pop) history.pushState(null, '', urlOf(region));
    if (req === reqId) clearLoading();
    await arrive(s, { mun, animate: !reduced(), req });
    return req === reqId;                                      // superado no meio da troca: a troca terminou, mas este pedido não vale
  }

  /** Vai para a região `id`. Resolve true se terminou nela; false se foi superado ou falhou. */
  async function go(id, { mun = null, pop = false } = {}) {
    const info = index.find((r) => r.id === id);
    if (!info) return false;
    const req = ++reqId;
    abortLoadsExcept(id === current.region.id ? null : id);
    if (id === current.region.id) {                            // já está lá: cancela a carga pendente e, se havia mergulho, desfaz
      clearLoading();
      if (diving) { diving = false; view.controls.dispatchEvent({ type: 'start' }); view.setRegion(current.region.bounds); }   // 'start' cancela o voo; a câmera volta à vista da região
      if (mun) await current.focusMun(mun, 0.9);
      return true;
    }
    document.body.dataset.loading = id;
    let region, data;
    try { ({ region, data } = await load(id, info)); }
    catch (e) {
      console.warn('região indisponível', e);
      if (req === reqId) { clearLoading(); say(`Não foi possível carregar ${info.name}.`); failed(pop, req); }
      return false;
    }
    if (req !== reqId) return false;
    if (region.kind === 'uf' && current.region.kind !== 'uf' && data.status.kind === 'demo-fallback') {
      clearLoading();                                          // do Brasil: dado sintético por falha de rede não vale a troca
      say(`Não foi possível carregar ${info.name}.`);
      failed(pop, req);
      return false;
    }
    if (region.kind === 'uf' && current.region.kind !== 'uf' && !reduced()) {      // mergulho até o centro do estado, ainda na cena do Brasil
      const b = regionBounds(info, current.region.proj);
      diving = true;
      try { await view.flyTo({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }, { dist: framing(b).dist, seconds: DIVE_S }); }
      finally { if (req === reqId) diving = false; }
      if (req !== reqId) return false;
    }
    const done = swapChain.then(() => commit(req, region, data, { mun, pop, info }));
    swapChain = done.catch(() => {});
    return done;
  }

  const fromUrl = () => parseConfig(location.search, { ufs, defaultUf: DEFAULT_REGION });
  window.addEventListener('popstate', () => { const c = fromUrl(); go(c.uf, { mun: c.mun, pop: true }); });

  return { get current() { return current; }, get loading() { return document.body.dataset.loading ?? null; }, start, go, back: () => go(DEFAULT_REGION) };
}
