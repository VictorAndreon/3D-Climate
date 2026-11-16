// Palco: dono do mapa, das nuvens e dos pontos da grade. Troca cada um no lugar (menu de debug),
// liberando o que sai, sem mexer em câmera, relógio ou seleção. Em rajada, vale o último pedido.
import { createMap } from './map.js';
import { createReliefMap } from './relief-map.js';
import { createClouds } from './clouds.js';
import { createSolidClouds } from './clouds-solid.js';
import { createVolumeClouds } from './clouds-volume.js';
import { createGridDots } from '../ui/debug.js';

// tetos do nível alto: 6.000 puffs em sprite; 1.950 cachos sólidos + 1.400 cirros no padrão
const SLOT_COUNTS = { clouds: [2600, 2000, 1400], solid: [1150, 800] };

/** Junta nuvens sólidas (baixa, média) e sprites (alta) numa interface só. */
function combineClouds(solid, high) {
  const both = [solid, high];
  return {
    objects: [solid.shadow, solid.mesh, high.shadow, high.mesh],
    update: (f, t, now) => both.forEach((c) => c.update(f, t, now)),
    frame: (now, cam) => both.forEach((c) => c.frame(now, cam)),
    setFlashes: (l) => both.forEach((c) => c.setFlashes(l)),
    setSky: (s) => both.forEach((c) => c.setSky(s)),
    setQuality: (q) => both.forEach((c) => c.setQuality(q)),
    visibleCount: () => solid.visibleCount() + high.visibleCount(),
    dispose: () => both.forEach((c) => c.dispose()),
  };
}

/**
 * slots(count, seed): posições de nuvem dentro da área com dado. loadRelief() e loadNoise() devolvem promessas;
 * cada uma é chamada até dar certo uma vez e o resultado fica guardado. onSwap(what) roda depois de cada troca
 * ('map' | 'clouds' | 'dots'), para quem está de fora reaplicar céu, qualidade e dado no mesmo quadro.
 */
export function createStage({ view, geo, grid, bounds, slots, loadRelief, loadNoise, onSwap = () => {} }) {
  const state = { nuvens: null, relevo: false, exagero: 12, grade: false };
  let map = null, clouds = null, dots = null;
  let cloudReq = 0, mapReq = 0, reliefP = null, noiseP = null;
  const pending = new Set();
  const track = (p) => { pending.add(p); const done = () => pending.delete(p); p.then(done, done); return p; };
  const once = (get, load, set) => get() ?? set(load().catch((e) => { set(null); throw e; }));
  const slotCache = new Map();
  const slotsFor = (count, seed) => { const k = `${count}:${seed}`; if (!slotCache.has(k)) slotCache.set(k, slots(count, seed)); return slotCache.get(k); };

  function buildClouds(kind, noise) {
    if (kind === 'volume') return createVolumeClouds({ renderer: view.renderer, grid, bounds, noise });
    if (kind === 'sprite') return createClouds({ slotsByLayer: SLOT_COUNTS.clouds.map((n, i) => slotsFor(n, 101 + i)) });
    return combineClouds(
      createSolidClouds({ slotsByLayer: SLOT_COUNTS.solid.map((n, i) => slotsFor(n, 101 + i)) }),
      // cirros continuam finos e translúcidos (sprite), só na camada alta
      createClouds({ slotsByLayer: [new Float32Array(0), new Float32Array(0), slotsFor(SLOT_COUNTS.clouds[2], 103)] }),
    );
  }
  const objectsOf = (c) => c.objects ?? [c.shadow, c.mesh];

  async function setClouds(kind) {
    const req = ++cloudReq;                                    // pedido novo supera qualquer carga pendente
    if (clouds && kind === state.nuvens) return;
    const noise = kind === 'volume' ? await once(() => noiseP, loadNoise, (p) => (noiseP = p)) : null;
    if (req !== cloudReq) return;
    const next = buildClouds(kind, noise);
    if (clouds) { view.scene.remove(...objectsOf(clouds)); clouds.dispose(); }
    clouds = next; state.nuvens = kind;
    view.scene.add(...objectsOf(clouds));
    onSwap('clouds');
  }

  function swapMap(next) {
    if (map) { view.scene.remove(map); map.userData.dispose(); }
    map = next;
    view.scene.add(map);
    onSwap('map');
  }
  /** Rejeita se o relevo não carregar; nesse caso o mapa que estava continua (ou entra o plano, se não havia nenhum). */
  async function setRelief(on, exagero = state.exagero) {
    const req = ++mapReq;
    if (map && on === state.relevo && (!on || exagero === state.exagero)) { state.exagero = exagero; return; }
    if (!on) { state.relevo = false; state.exagero = exagero; swapMap(createMap(geo)); return; }
    let relief;
    try { relief = await once(() => reliefP, loadRelief, (p) => (reliefP = p)); }
    catch (e) { if (!map && req === mapReq) swapMap(createMap(geo)); throw e; }
    if (req !== mapReq) return;
    state.relevo = true; state.exagero = exagero;
    swapMap(createReliefMap(geo, relief, { exag: exagero }));
  }

  function setDots(on) {
    if (on === !!dots) return;
    if (dots) { view.scene.remove(dots.points); dots.points.geometry.dispose(); dots.points.material.dispose(); dots = null; }
    else { dots = createGridDots(grid); view.scene.add(dots.points); }
    state.grade = on;
    onSwap('dots');
  }

  return {
    get map() { return map; },
    get clouds() { return clouds; },
    get dots() { return dots; },
    get state() { return { ...state }; },
    setClouds: (kind) => track(setClouds(kind)),
    setRelief: (on, exagero) => track(setRelief(on, exagero)),
    setDots,
    /** Resolve quando não há troca pendente. */
    async idle() { while (pending.size) await Promise.allSettled([...pending]); },
  };
}
