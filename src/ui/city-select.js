// Clique (ou toque) no mapa seleciona o município: a peça dele sobe e o painel abre.
// A busca por nome (selectByName) faz o mesmo. Clique fora do estado ou Esc fecha. A malha por município só é baixada quando precisa.
import { createMunicipioIndex } from '../data/city.js';

const TAP_PX = 8;

export function createCitySelect({ canvas, pick, lift, panel, municipios, proj, onSelect = () => {} }) {
  let index = null, loading = null, current = null;
  const centers = new Map(municipios.map(([name, lon, lat]) => [name, [lon, lat]]));
  const load = () => (loading ??= fetch('./assets/municipios.json').then((r) => r.json()).then((j) => { index = createMunicipioIndex(j.items); return index; }));

  function close() {
    if (!current) return;
    current = null;
    lift.clear(); panel.hide(); onSelect(null);
    canvas.focus?.({ preventScroll: true });
  }

  async function selectAt(clientX, clientY) {
    const hit = pick(clientX, clientY);
    if (!hit) { close(); return; }
    const { lon, lat } = proj.toLonLat(hit.x, hit.z);
    const idx = index ?? await load();
    const m = idx.find(lon, lat);
    if (!m) { close(); return; }
    show(m, [lon, lat]);
  }

  function show(m, fallbackLL) {
    if (current === m) return;
    current = m;
    lift.select(m.polys);
    panel.show(m, centers.get(m.name) ?? fallbackLL);
    onSelect(m);
  }

  /** Seleciona pelo nome (busca), como se o município tivesse sido clicado. Devolve [lon, lat] do centro, ou null. */
  async function selectByName(name) {
    const m = (index ?? await load()).byName(name), ll = centers.get(name);
    if (!m || !ll) return null;
    show(m, ll);
    return ll;
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_PX;
    down = null;
    if (tap) selectAt(e.clientX, e.clientY).catch((err) => console.warn('município indisponível', err));
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // adianta o download quando o navegador estiver ocioso, para o primeiro clique ser imediato
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 1500)))(() => load().catch(() => { loading = null; }));

  /** O mapa de baixo trocou (relevo): refaz a peça levantada na altura nova, sem fechar nada. */
  function relift() { if (current) lift.select(current.polys, { instant: true }); }

  return { close, selectAt, selectByName, relift, get current() { return current; } };
}
