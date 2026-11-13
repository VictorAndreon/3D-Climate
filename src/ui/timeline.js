// Linha do tempo (rodapé): play/pause, velocidades, rótulo, trilho com marcas de dia, marcador "agora",
// faixa de horas com chuva, botão 72 h / 7 dias, scrub por arrasto e teclado.
import { fmtLabel, fmtDay, localHourOf } from './format.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function createTimeline(el, { clock, times, rainByHour }) {
  el.hidden = false;
  el.innerHTML = '';
  const controls = h('div', 'tl-controls');
  const play = h('button', 'tl-play'); play.type = 'button';
  const speeds = h('div', 'tl-speeds');
  for (const s of [0.5, 1, 4]) { const b = h('button', '', `${String(s).replace('.', ',')}×`); b.type = 'button'; b.dataset.speed = s; speeds.append(b); }
  const label = h('div', 'tl-label');
  const now = h('button', 'tl-now', 'agora'); now.type = 'button'; now.title = 'Voltar para agora (Home)';
  const range = h('button', 'tl-range'); range.type = 'button';
  controls.append(play, speeds, label, now, range);

  const track = h('div', 'tl-track');
  track.setAttribute('role', 'slider'); track.setAttribute('aria-label', 'Hora da previsão'); track.tabIndex = 0;
  const rail = h('div', 'tl-rail'), rain = h('div', 'tl-rain'), fill = h('div', 'tl-fill'), days = h('div', 'tl-days');
  const nowMark = h('div', 'tl-nowmark'); nowMark.title = 'agora';
  const thumb = h('div', 'tl-thumb');
  rail.append(rain, fill);
  track.append(days, rail, nowMark, thumb);
  el.append(controls, track);

  const pct = (t) => ((t - clock.tMin) / (clock.tMax - clock.tMin || 1)) * 100;
  const unixAt = (t) => times[0] + t * 3600;

  let builtFor = null;
  function buildStatic() {                       // marcas de dia e faixa de chuva dependem da faixa (72 h / 7 dias)
    builtFor = clock.range;
    days.innerHTML = ''; rain.innerHTML = '';
    for (let i = Math.ceil(clock.tMin); i <= Math.floor(clock.tMax); i++) {
      if (Math.round(localHourOf(unixAt(i))) % 24 !== 0) continue;         // meia-noite local
      const d = h('div', 'tl-day'); d.style.left = `${pct(i)}%`;
      d.append(h('span', '', fmtDay(unixAt(i))));
      days.append(d);
    }
    // precip[i] cobre o intervalo (i-1, i]: junta horas consecutivas em um segmento só
    let start = null;
    const flush = (end) => { if (start == null) return; const s = h('div', 'tl-wet'); const a = Math.max(pct(start), 0), b = Math.min(pct(end), 100); s.style.left = `${a}%`; s.style.width = `${Math.max(b - a, 0.3)}%`; rain.append(s); start = null; };
    for (let i = Math.max(1, Math.floor(clock.tMin)); i <= Math.ceil(clock.tMax) && i < rainByHour.length; i++) {
      if (rainByHour[i]) { if (start == null) start = i - 1; } else flush(i - 1);
    }
    flush(Math.min(Math.ceil(clock.tMax), rainByHour.length - 1));
    range.textContent = clock.range === '72h' ? '7 dias' : '72 h';
    range.title = clock.range === '72h' ? 'Mostrar os 7 dias de previsão' : 'Mostrar só as próximas 72 h';
  }

  function update() {
    if (builtFor !== clock.range) buildStatic();
    const p = pct(clock.t);
    thumb.style.left = `${p}%`; fill.style.width = `${p}%`;
    nowMark.style.left = `${pct(clock.tNow)}%`;
    const unix = Math.floor(unixAt(clock.t) / 600) * 600;                   // rótulo em passos de 10 min
    label.textContent = fmtLabel(unix);
    play.textContent = clock.playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', clock.playing ? 'Pausar' : 'Reproduzir');
    play.title = clock.playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)';
    for (const b of speeds.children) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === clock.speed));
    track.setAttribute('aria-valuetext', label.textContent);
  }

  play.addEventListener('click', () => clock.toggle());
  speeds.addEventListener('click', (e) => { const s = e.target.dataset?.speed; if (s) clock.setSpeed(Number(s)); });
  now.addEventListener('click', () => clock.home());
  range.addEventListener('click', () => clock.setRange(clock.range === '72h' ? '7d' : '72h'));

  // scrub por arrasto (mouse e toque)
  let dragging = false, wasPlaying = false;
  const seekTo = (e) => { const r = rail.getBoundingClientRect(); clock.seek(clock.tMin + ((e.clientX - r.left) / r.width) * (clock.tMax - clock.tMin)); };
  track.addEventListener('pointerdown', (e) => { dragging = true; wasPlaying = clock.playing; clock.pause(); track.setPointerCapture(e.pointerId); seekTo(e); e.preventDefault(); });
  track.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
  const end = () => { if (!dragging) return; dragging = false; if (wasPlaying) clock.play(); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);

  // teclado: espaço = play/pause, setas = ±1 h, Home = agora
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') { if (tag === 'BUTTON') return; clock.toggle(); }      // em botão, o espaço já clica
    else if (e.code === 'ArrowRight') clock.step(1);
    else if (e.code === 'ArrowLeft') clock.step(-1);
    else if (e.code === 'Home') clock.home();
    else return;
    e.preventDefault();
  });

  clock.onChange(update);
  update();
  return { update };
}
