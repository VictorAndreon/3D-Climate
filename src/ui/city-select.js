// Clique (ou toque) no mapa seleciona o município: a peça dele sobe e o painel abre.
// A busca por nome (selectByName) e o código IBGE (selectById, ?mun=) fazem o mesmo. Clique fora do estado ou Esc fecha. A malha por município só é baixada quando precisa.
import { createMunicipioIndex } from '../data/city.js';

const TAP_PX = 8;

export function createCitySelect({ canvas, pick, lift, panel, municipios, proj, munUrl, onSelect = () => {}, signal }) {
  let index = null, loading = null, current = null;
  const centers = new Map(municipios.map(([name, lon, lat]) => [name, [lon, lat]]));
  const load = () => (loading ??= fetch(munUrl).then((r) => r.json()).then((j) => { index = createMunicipioIndex(j.items); return index; }));

  function close() {
    if (!current) return;
    current = null;
    lift.clear(); panel.hide(); onSelect(null);
    canvas.focus?.({ preventScroll: true });
  }

  async function selectAt(clientX, clientY) {
    if (signal?.aborted) return;
    const hit = pick(clientX, clientY);
    if (!hit) { close(); return; }
    const { lon, lat } = proj.toLonLat(hit.x, hit.z);
    const idx = index ?? await load();
    if (signal?.aborted) return;                               // a sessão acabou durante o download: nada de peça nem painel
    const m = idx.find(lon, lat);
    if (!m) { close(); return; }
    show(m, [lon, lat]);
  }

  function show(m, fallbackLL) {
    if (signal?.aborted || current === m) return;
    current = m;
    lift.select(m.polys);
    panel.show(m, centers.get(m.name) ?? fallbackLL);
    onSelect(m);
  }

  /** Seleciona pelo nome (busca), como se o município tivesse sido clicado. Devolve [lon, lat] do centro, ou null. */
  async function selectByName(name) {
    const idx = index ?? await load();
    if (signal?.aborted) return null;
    const m = idx.byName(name), ll = centers.get(name);
    if (!m || !ll) return null;
    show(m, ll);
    return ll;
  }

  /** Seleciona pelo código IBGE; código desconhecido não faz nada (null). */
  async function selectById(id) {
    const idx = index ?? await load();
    if (signal?.aborted) return null;
    const m = idx.list.find((x) => x.id === String(id)), ll = m && centers.get(m.name);
    if (!m || !ll) return null;
    show(m, ll);
    return ll;
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; }, { signal });
  canvas.addEventListener('pointerup', (e) => {
    const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_PX;
    down = null;
    if (tap) selectAt(e.clientX, e.clientY).catch((err) => console.warn('município indisponível', err));
  }, { signal });
  canvas.addEventListener('pointercancel', () => { down = null; }, { signal });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { signal });

  // adianta o download quando o navegador estiver ocioso, para o primeiro clique ser imediato
  // (sessão encerrada antes de o navegador ficar ocioso: não baixa nada)
  const idle = (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500)))(() => { if (!signal?.aborted) load().catch(() => { loading = null; }); });
  signal?.addEventListener('abort', () => (window.cancelIdleCallback ?? clearTimeout)(idle), { once: true });

  /** O mapa de baixo trocou (relevo): refaz a peça levantada na altura nova, sem fechar nada. */
  function relift() { if (current) lift.select(current.polys, { instant: true }); }

  return { close, selectAt, selectByName, selectById, relift, get current() { return current; } };
}
