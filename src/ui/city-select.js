// Clique (ou toque) no mapa seleciona o município: a peça dele sobe e o painel abre.
// Clique fora do estado ou Esc fecha. A malha por município só é baixada quando precisa.
import { toLonLat } from '../geo/projection.js';
import { createMunicipioIndex } from '../data/city.js';

const TAP_PX = 8;

export function createCitySelect({ canvas, pick, lift, panel, municipios, onSelect = () => {} }) {
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
    const { lon, lat } = toLonLat(hit.x, hit.z);
    const idx = index ?? await load();
    const m = idx.find(lon, lat);
    if (!m) { close(); return; }
    if (current === m) return;
    current = m;
    lift.select(m.polys);
    panel.show(m, centers.get(m.name) ?? [lon, lat]);
    onSelect(m);
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

  return { close, selectAt, get current() { return current; } };
}
