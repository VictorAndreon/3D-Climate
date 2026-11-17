// Menu de debug: ajusta nuvens, relevo, grade, qualidade e fonte de dados com efeito na hora.
// A URL é o estado inicial e é reescrita a cada ajuste, então o link sempre reproduz o que está na tela.
import { writeConfig, EXAGERO, DEFAULT_REGION } from './config.js';

const NUVENS = [['solidas', 'sólidas'], ['volume', 'volume'], ['sprite', 'sprite']];
const QUALIDADE = [['auto', 'auto'], ['alto', 'alto'], ['medio', 'médio'], ['baixo', 'baixo']];
const DADOS = [['live', 'ao vivo'], ['demo', 'demo'], ['fixture', 'fixture']];
const QUALITY_LEVEL = { alto: 0, medio: 1, baixo: 2 };
const DRAG_MS = 150;                                        // arrastando o exagero, o relevo é refeito no máximo a cada 150 ms

const radios = (name, items) => `<div class="dbg-seg" role="radiogroup" aria-label="${name}">${items.map(([v, label]) => `<label><input type="radio" name="${name}" value="${v}"><span>${label}</span></label>`).join('')}</div>`;

export function createDebugMenu(el, { button, config, stage, quality, applyQuality, stats, reload = (url) => location.assign(url) }) {
  const cfg = { ...config };
  el.innerHTML = `
    <div class="dbg-head"><b>Debug</b><button type="button" class="dbg-close" aria-label="Fechar o menu de debug">×</button></div>
    <pre class="dbg-stats" aria-live="off"></pre>
    <div class="dbg-row"><span class="dbg-label">Nuvens</span>${radios('nuvens', NUVENS)}</div>
    <div class="dbg-row"><label class="dbg-label dbg-check"><input type="checkbox" name="relevo"><span>Relevo</span></label>
      <label class="dbg-range"><span class="dbg-sr">exagero</span><input type="range" name="exagero" min="${EXAGERO.min}" max="${EXAGERO.max}" step="${EXAGERO.step}"><output class="dbg-exag"></output></label></div>
    <div class="dbg-row"><label class="dbg-label dbg-check"><input type="checkbox" name="grade"><span>Grade</span></label><span class="dbg-hint">pontos do dado bruto</span></div>
    <div class="dbg-row"><span class="dbg-label">Qualidade</span>${radios('qualidade', QUALIDADE)}</div>
    <div class="dbg-row"><span class="dbg-label">Dados</span>${radios('dados', DADOS)}</div>
    <button type="button" id="debug-copy">copiar link com esta configuração</button>
    <div class="dbg-msg" role="status"></div>`;
  const $ = (sel) => el.querySelector(sel);
  const statsEl = $('.dbg-stats'), msgEl = $('.dbg-msg'), exag = $('input[name=exagero]'), exagOut = $('.dbg-exag');

  /** Controles espelham a configuração. */
  function sync() {
    for (const name of ['nuvens', 'qualidade', 'dados']) for (const r of el.querySelectorAll(`input[name=${name}]`)) r.checked = r.value === cfg[name];
    const relevoOk = stage.state.relevoDisponivel;                  // fora do RS não há relevo: controle desabilitado
    $('input[name=relevo]').checked = cfg.relevo; $('input[name=relevo]').disabled = !relevoOk;
    $('input[name=relevo]').title = relevoOk ? '' : 'Relevo disponível só no Rio Grande do Sul';
    $('input[name=grade]').checked = cfg.grade;
    const fx = $('input[name=dados][value=fixture]');            // a fixture é gravada só do RS: fora dele, trocar para ela recarregaria em dado ao vivo
    fx.disabled = cfg.uf !== 'RS'; fx.title = fx.disabled ? 'Fixture disponível só no Rio Grande do Sul' : '';
    exag.value = String(cfg.exagero); exag.disabled = !cfg.relevo || !relevoOk; exagOut.textContent = `${cfg.exagero}×`;
  }
  const query = () => writeConfig(location.search, cfg, { defaultUf: DEFAULT_REGION });
  const urlFor = (q) => location.pathname + (q ? `?${q}` : '') + location.hash;
  const writeUrl = () => history.replaceState(null, '', urlFor(query()));

  let msgTimer = 0;
  function say(text, ms = 0) {
    clearTimeout(msgTimer); msgEl.textContent = text;
    if (ms) msgTimer = setTimeout(() => { msgEl.textContent = ''; }, ms);
  }

  function renderStats() {
    const s = stats();
    statsEl.textContent = `${s.fps.toFixed(0)} fps · ${s.frameMs.toFixed(1)} ms\n${s.cloudInfo ?? `puffs ${s.puffs}`} · gotas ${s.drops}\ndraw calls ${s.drawCalls} · qualidade ${s.quality}`;
  }

  /** Pede a troca ao palco e, quando não houver mais nada pendente, espelha o que de fato ficou. */
  async function swap(input, run) {
    input.setAttribute('aria-busy', 'true');
    let failed = false;
    try { await run(); } catch { failed = true; }
    await stage.idle();
    input.removeAttribute('aria-busy');
    const st = stage.state;
    cfg.nuvens = st.nuvens; cfg.relevo = st.relevo; cfg.exagero = st.exagero; cfg.grade = st.grade;
    sync(); writeUrl(); renderStats();
    return !failed;
  }
  async function setRelief(input, on, exagero) {
    say('');
    if (!await swap(input, () => stage.setRelief(on, exagero))) say('Relevo indisponível.');
  }

  let dragTimer = 0, dragLast = 0;
  el.addEventListener('input', (e) => {
    if (e.target !== exag) return;
    exagOut.textContent = `${exag.value}×`;
    clearTimeout(dragTimer);
    const wait = Math.max(0, DRAG_MS - (performance.now() - dragLast));
    dragTimer = setTimeout(() => { dragLast = performance.now(); setRelief(exag, true, Number(exag.value)); }, wait);
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'nuvens') swap(t, () => stage.setClouds(t.value));
    else if (t.name === 'relevo') setRelief(t, t.checked, cfg.exagero);
    else if (t.name === 'exagero') { clearTimeout(dragTimer); dragLast = performance.now(); setRelief(t, true, Number(t.value)); }
    else if (t.name === 'grade') swap(t, () => stage.setDots(t.checked));
    else if (t.name === 'qualidade') {
      cfg.qualidade = t.value;
      quality.lock(t.value === 'auto' ? null : QUALITY_LEVEL[t.value]);
      applyQuality(quality.level);
      writeUrl(); renderStats();
    } else if (t.name === 'dados') { cfg.dados = t.value; reload(urlFor(query())); }   // única troca que recarrega
  });

  $('#debug-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); say('Link copiado.', 2000); }
    catch { say(location.href); }                           // sem permissão de área de transferência: mostra para copiar à mão
  });

  function setOpen(open) {
    el.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('debug-open', open);
    if (open) renderStats();
  }
  button.addEventListener('click', () => setOpen(el.hidden));
  $('.dbg-close').addEventListener('click', () => { setOpen(false); button.focus(); });
  // teclado dentro do menu fica no menu: Esc fecha o menu (não o município), setas e espaço não mexem na linha do tempo
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { setOpen(false); button.focus(); }
  });

  // o que está na tela manda: se o relevo pedido na URL não carregou, o menu abre desmarcado, com aviso, e a URL é corrigida
  if (config.relevo && !stage.state.relevo) { cfg.relevo = false; say('Relevo indisponível.'); writeUrl(); }
  sync();
  setOpen(cfg.debug);
  let acc = 0;
  return {
    /** Entrou noutra região no lugar: o menu passa a gravar a região nova na URL e reabilita o que ela permite. */
    setRegion(id) { cfg.uf = id; cfg.relevo = stage.state.relevo; sync(); },
    tick(dt) {
      if (el.hidden) return;
      acc += dt;
      if (acc >= 0.25) { acc = 0; renderStats(); }
    },
  };
}
