// Sessão de uma região: tudo que vive enquanto uma região está na tela (campo do tempo, relógio, linha do tempo, selo,
// tooltip, painel, seleção de município, busca e botão de voltar). Cada sessão tem o próprio AbortController: dispose()
// aborta, e nenhum ouvinte, download ou animação da sessão antiga mexe na região nova. O palco e a câmera são da cena
// e não morrem com a sessão. Nunca reaproveite um relógio entre regiões: as inscrições dele não saem.
import { createWeatherField } from '../data/weather-field.js';
import { createMunicipioIndex } from '../data/city.js';
import { skyState, applySky } from '../render/light.js';
import { createCityLift } from '../render/city-lift.js';
import { createClock } from '../ui/clock.js';
import { carryTime } from '../ui/clock-carry.js';
import { createTimeline } from '../ui/timeline.js';
import { createTooltip, nearestCity } from '../ui/tooltip.js';
import { createLegend } from '../ui/legend.js';
import { createCityPanel } from '../ui/city-panel.js';
import { createCitySelect } from '../ui/city-select.js';
import { createCitySearch, fold } from '../ui/city-search.js';
import { createRegionNav } from '../ui/region-nav.js';
import { makeFormat } from '../ui/format.js';
import { DEFAULT_REGION } from '../ui/config.js';

const REGIONS = './assets/regions/';
const idle = (fn) => (window.requestIdleCallback ?? ((f) => setTimeout(f, 500)))(fn);
const cancelIdle = (h) => (window.cancelIdleCallback ?? clearTimeout)(h);

// dados nacionais, iguais para qualquer sessão do Brasil: baixados uma vez; se falhar, a próxima tentativa baixa de novo
let statesP = null, searchP = null;
const loadStates = () => (statesP ??= fetch(`${REGIONS}BR-ufs.json`).then((r) => r.json()).then((j) => createMunicipioIndex(j.items)).catch((e) => { statesP = null; throw e; }));
const loadSearch = () => (searchP ??= fetch(`${REGIONS}busca.json`).then((r) => r.json()).catch((e) => { searchP = null; throw e; }));

/**
 * region, data: da região e do dado já carregados. from: { t, times, playing, speed, range } da sessão anterior (o mesmo
 * instante absoluto, play e velocidade continuam). index: o índice de regiões (a busca nacional lista os estados).
 * go(id, { mun }): navega (clique num estado, busca, botão de voltar). lights: luzes da cena, onde o céu é aplicado.
 */
export function createSession({ view, stage, region, data, from, index, go, lights }) {
  const ctl = new AbortController(), { signal } = ctl;
  const { geo, grid, proj } = region;
  const fmt = makeFormat(region.tz);
  const field = createWeatherField(grid, data.series);       // o campo da região nova nasce junto com a sessão, antes de qualquer refresh
  // "agora" achado pelo timestamp, nunca assumido como índice 0
  const tNow = Math.min(Math.max((data.nowUnix - field.times[0]) / 3600, 0), field.nT - 1);
  const tEndAll = field.nT - 1, tEnd72 = Math.min(tNow + 72, tEndAll);
  const clock = createClock({
    tNow, tEnd72, tEndAll,
    from: from && { t: carryTime(from, field.times, { tNow, tMax: tEndAll }), playing: from.playing, speed: from.speed, range: from.range },
  });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  createTimeline(document.getElementById('timeline'), { clock, times: field.times, rainByHour: field.rainShareByHour(), fmt, signal });
  createLegend(document.getElementById('legend'), document.getElementById('badge'), data.status, fmt);
  const lift = createCityLift({ proj, reducedMotion, groundLL: (lon, lat) => stage.map.userData.heightLL?.(lon, lat) ?? 0 });
  view.scene.add(lift.group);
  const pickLand = (x, y) => {
    const { land, inside } = stage.map.userData;             // relevo: a malha cobre o retângulo, a máscara diz o que é estado
    const hit = view.pick(lift.mesh ? [lift.mesh, land] : land, x, y);
    return hit && (!inside || inside(hit.x, hit.z)) ? hit : null;
  };

  // visão Brasil: o ponteiro está sobre um estado (índice de polígonos, baixado sem pressa); município não existe aí
  let stateIndex = null;
  const getStates = () => loadStates().then((i) => (stateIndex = i));
  const stateAt = (lon, lat) => stateIndex?.find(lon, lat)?.name ?? nearestCity(geo.municipios, lon, lat);   // sem o índice, ou fora dos polígonos: centro de estado mais próximo
  if (!region.hasCities) {
    const h = idle(() => { if (!signal.aborted) getStates().catch(() => {}); });
    signal.addEventListener('abort', () => cancelIdle(h), { once: true });
  }
  // no toque quem abre é o painel do município (tem tudo que o tooltip mostraria)
  const tooltip = createTooltip(document.getElementById('tooltip'), {
    canvas: view.renderer.domElement, pick: pickLand, field, clock, municipios: geo.municipios, tapToShow: false, proj,
    nameAt: region.hasCities ? undefined : stateAt, signal,
  });

  let citySelect = null, search = null;
  if (region.hasCities) {
    const panel = createCityPanel(document.getElementById('city'), { clock, field, fmt, onClose: () => citySelect.close(), signal });
    citySelect = createCitySelect({
      canvas: view.renderer.domElement, pick: pickLand, lift, panel, municipios: geo.municipios, proj, munUrl: region.munUrl, signal,
      onSelect: (m) => { document.body.classList.toggle('city-open', !!m); if (m) tooltip.hide(); search.setValue(m?.name ?? ''); },
    });
    // busca por nome: seleciona como um clique e leva a câmera até o município
    search = createCitySearch(document.getElementById('search'), {
      items: geo.municipios.map(([name]) => ({ label: name, sub: '', kind: 'mun', uf: region.id, key: fold(name) })), signal,
      onPick: async ({ label }) => {
        const ll = await citySelect.selectByName(label).catch((err) => { console.warn('município indisponível', err); return null; });
        if (ll && !signal.aborted) { const s = proj.toScene(ll[0], ll[1]); view.focusOn(s.x, s.z, { seconds: reducedMotion ? 0 : 0.9 }); }
      },
    });
  } else {
    // Brasil: clique ou toque num estado entra nele; a busca é nacional (estados + municípios, estes baixados no primeiro foco)
    const canvasEl = view.renderer.domElement;
    let down = null;
    canvasEl.addEventListener('pointerdown', (e) => { if (e.button === 0) down = { x: e.clientX, y: e.clientY }; }, { signal });
    canvasEl.addEventListener('pointerup', async (e) => {
      const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 8;
      down = null;
      const hit = tap && pickLand(e.clientX, e.clientY);
      if (!hit) return;
      const { lon, lat } = proj.toLonLat(hit.x, hit.z);
      const st = (stateIndex ?? await getStates().catch(() => null))?.find(lon, lat);
      if (st && !signal.aborted) go(st.id);
    }, { signal });
    canvasEl.addEventListener('pointercancel', () => { down = null; }, { signal });
    const stateItems = index.filter((r) => r.kind === 'uf').map((r) => ({ label: r.name, sub: 'estado', kind: 'uf', uf: r.id, key: fold(r.name) }));
    search = createCitySearch(document.getElementById('search'), {
      items: stateItems, placeholder: 'Buscar estado ou município…', signal,
      // se o download falhar a promessa rejeita e o próximo foco tenta de novo
      onFirstFocus: () => loadSearch().then((j) => {
        if (!signal.aborted) search.setItems([...stateItems, ...j.items.map(([label, uf, , , ibge]) => ({ label, sub: uf, kind: 'mun', uf, ibge, key: fold(label) }))]);
      }).catch((err) => { console.warn('busca de municípios indisponível', err); throw err; }),
      onPick: (item) => go(item.uf, { mun: item.kind === 'mun' ? item.ibge : null }),
    });
  }
  createRegionNav(document.getElementById('region-back'), { region, onBack: () => go(DEFAULT_REGION), signal });

  function refresh(now) {
    const sky = skyState(fmt.localHourOf(field.times[0] + clock.t * 3600));
    applySky(sky, { renderer: view.renderer, lights, ground: stage.map.userData.ground, clouds: stage.clouds, rain: stage.rain });
    stage.clouds.update(field, clock.t, now);
    stage.rain.update(field, clock.t);
    stage.lightning.update(field, clock.t);
    stage.dots?.update(field, clock.t);
  }

  /** ?mun= e a busca nacional: seleciona o município e leva a câmera até ele. Devolve se deu certo. */
  async function focusMun(id, seconds = 0) {
    if (!citySelect) return false;
    const ll = await citySelect.selectById(id).catch((err) => { console.warn('município indisponível', err); return null; });
    if (!ll || signal.aborted) return false;
    const s = proj.toScene(ll[0], ll[1]);
    view.focusOn(s.x, s.z, { seconds: reducedMotion ? 0 : seconds });
    return true;
  }

  function dispose() {
    if (signal.aborted) return;
    ctl.abort();
    citySelect?.close();                                      // solta a peça levantada e fecha o painel
    tooltip.hide();
    lift.release();
    document.body.classList.remove('city-open');
  }

  return {
    region, field, clock, citySelect, data, status: data.status, tNow, fmt, lift, loadedAt: Date.now() / 1000,
    refresh, focusMun, dispose,
    frame(dt) { clock.tick(dt); lift.frame(dt); },
  };
}
