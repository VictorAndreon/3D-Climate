// Painel do município selecionado: tempo no instante da linha do tempo e meteograma da faixa visível
// (nuvem pendurada no topo, chuva caindo dela). Clicar no meteograma move a linha do tempo.
import { conditionText, fmtLabel, fmtDay, localHourOf } from './format.js';
import { windCardinal } from './tooltip.js';
import { totalCover, rainOutlook } from '../data/city.js';
import { WET_MM } from '../data/weather-field.js';

const W = 300, H = 132, CLOUD_H = 30, RAIN_Y = 34, RAIN_H = 74, AXIS_Y = 126;
const num = (v, d = 1) => v.toFixed(d).replace('.', ',');
const intBR = new Intl.NumberFormat('pt-BR');
const rainLen = (mm) => RAIN_H * Math.min(1, Math.sqrt(mm / 12));      // raiz: garoa ainda aparece, 12 mm/h enche

export function createCityPanel(el, { clock, field, onClose }) {
  el.innerHTML = `
    <header class="cp-head">
      <h2 class="cp-name"></h2>
      <button type="button" class="cp-close" aria-label="Fechar município (Esc)" title="Fechar (Esc)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
    </header>
    <p class="cp-facts"><span class="cp-area"></span><span class="cp-ibge"></span></p>
    <section class="cp-now">
      <p class="cp-when"></p>
      <p class="cp-cond"></p>
      <dl class="cp-nums">
        <div><dt>chuva</dt><dd class="cp-rain"></dd></div>
        <div><dt>vento</dt><dd class="cp-wind"></dd></div>
        <div><dt>nuvens</dt><dd class="cp-cloud"></dd></div>
      </dl>
    </section>
    <section class="cp-chart">
      <h3 class="cp-range"></h3>
      <svg class="cp-svg" viewBox="0 0 ${W} ${H}" role="img"></svg>
      <p class="cp-outlook"></p>
    </section>
    <p class="cp-note">Previsão no centro do município.</p>`;
  const $ = (s) => el.querySelector(s);
  const svg = $('.cp-svg');
  let city = null, pt = null, builtKey = '';

  $('.cp-close').addEventListener('click', () => onClose());
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose(); });

  const xOf = (t) => ((t - clock.tMin) / (clock.tMax - clock.tMin || 1)) * W;
  // meteograma: depende da faixa (72 h / 7 dias) e do município, não do instante
  function buildChart() {
    builtKey = `${city.id}:${clock.range}`;
    const h0 = Math.max(1, Math.floor(clock.tMin)), h1 = Math.min(Math.ceil(clock.tMax), field.nT - 1);
    let cloud = `M0 0`;
    for (let h = Math.floor(clock.tMin); h <= h1; h++) {
      const c = totalCover(pt.low[h], pt.mid[h], pt.high[h]) / 100;
      cloud += ` L${xOf(h).toFixed(1)} ${(c * CLOUD_H).toFixed(1)}`;
    }
    cloud += ` L${W} 0 Z`;
    const bw = Math.max(0.6, W / (clock.tMax - clock.tMin) - 0.6);
    let bars = '', storms = '';
    for (let h = h0; h <= h1; h++) {
      const mm = pt.precip[h];
      if (mm < WET_MM) continue;
      const x = Math.max(0, xOf(h - 1)), len = Math.max(2, rainLen(mm));
      const storm = pt.code[h] >= 95 && pt.code[h] <= 99;
      (storm ? (s) => { storms += s; } : (s) => { bars += s; })(`<rect x="${x.toFixed(1)}" y="${RAIN_Y}" width="${bw.toFixed(2)}" height="${len.toFixed(1)}" rx="0.6"/>`);
    }
    let days = '';
    for (let h = Math.ceil(clock.tMin); h <= Math.floor(clock.tMax); h++) {
      if (Math.round(localHourOf(field.times[0] + h * 3600)) % 24 !== 0) continue;
      const x = xOf(h).toFixed(1);
      days += `<line class="cp-day" x1="${x}" x2="${x}" y1="0" y2="${AXIS_Y - 9}"/>`;
      if (xOf(h) < W - 26) days += `<text x="${(xOf(h) + 3).toFixed(1)}" y="${AXIS_Y}">${fmtDay(field.times[0] + h * 3600)}</text>`;
    }
    svg.innerHTML = `${days}<path class="cp-cloudband" d="${cloud}"/><g class="cp-bars">${bars}</g><g class="cp-storms">${storms}</g>
      <line class="cp-cursor" y1="0" y2="${AXIS_Y - 9}"/>`;
    $('.cp-range').textContent = clock.range === '72h' ? 'Próximas 72 horas' : 'Próximos 7 dias';
  }

  function outlookText(o) {
    const at = (t) => fmtLabel(field.times[0] + t * 3600);
    if (!o.wetHours && !o.rainingNow) return `Sem chuva prevista até ${at(clock.tMax)}.`;
    const parts = [];
    if (o.rainingNow) parts.push(o.change >= 0 ? `Chovendo agora; deve parar por volta de ${at(o.change)}.` : 'Chovendo agora, sem pausa prevista na faixa.');
    else if (o.change >= 0) parts.push(`Próxima chuva: ${at(o.change)}.`);
    if (o.wetHours) {
      parts.push(`Chove em ${o.wetHours} das ${o.hours} horas seguintes, somando ${num(o.totalMm)} mm.`);
      if (o.stormHours) parts.push(o.stormHours === 1 ? 'Uma hora com trovoada.' : `${o.stormHours} horas com trovoada.`);
    }
    return parts.join(' ');
  }

  function update() {
    if (!city) return;
    if (builtKey !== `${city.id}:${clock.range}`) buildChart();
    const c = field.cellInfo(city.lon, city.lat, clock.t);
    const atNow = Math.abs(clock.t - clock.tNow) < 1 / 6;
    $('.cp-when').textContent = atNow ? 'Agora' : fmtLabel(Math.floor((field.times[0] + clock.t * 3600) / 600) * 600);
    $('.cp-cond').textContent = conditionText(c.code);
    $('.cp-cond').dataset.kind = c.code >= 95 ? 'storm' : c.precip >= WET_MM ? 'rain' : 'dry';
    $('.cp-rain').textContent = `${num(c.precip)} mm/h`;
    $('.cp-wind').textContent = `${Math.round(c.windSpeed)} km/h ${windCardinal(c.windDir)}`;
    $('.cp-cloud').textContent = `${Math.round(totalCover(c.low, c.mid, c.high))}%`;
    $('.cp-cloud').title = `baixa ${Math.round(c.low)}%, média ${Math.round(c.mid)}%, alta ${Math.round(c.high)}%`;
    const x = xOf(clock.t).toFixed(1);
    const cur = svg.querySelector('.cp-cursor'); cur.setAttribute('x1', x); cur.setAttribute('x2', x);
    const o = rainOutlook(pt, clock.t, clock.tMax);
    $('.cp-outlook').textContent = outlookText(o);
    svg.setAttribute('aria-label', `Meteograma de ${city.name}. ${$('.cp-outlook').textContent}`);
  }

  // clicar/arrastar no meteograma move a linha do tempo
  let scrubbing = false;
  const seek = (e) => { const r = svg.getBoundingClientRect(); clock.seek(clock.tMin + ((e.clientX - r.left) / r.width) * (clock.tMax - clock.tMin)); };
  svg.addEventListener('pointerdown', (e) => { scrubbing = true; clock.pause(); svg.setPointerCapture(e.pointerId); seek(e); });
  svg.addEventListener('pointermove', (e) => { if (scrubbing) seek(e); });
  svg.addEventListener('pointerup', () => { scrubbing = false; });
  svg.addEventListener('pointercancel', () => { scrubbing = false; });

  clock.onChange(update);

  return {
    /** m: item do índice; centro: [lon, lat] do centroide. */
    show(m, [lon, lat]) {
      const p = field.cellInfo(lon, lat, clock.t)?.p ?? null;
      if (p == null) return;
      city = { id: m.id, name: m.name, lon, lat };
      pt = field.point(p);
      builtKey = '';
      $('.cp-name').textContent = m.name;
      $('.cp-area').textContent = `${intBR.format(m.area)} km²`;
      $('.cp-ibge').textContent = `código IBGE ${m.id}`;
      el.hidden = false;
      el.classList.remove('cp-enter'); void el.offsetWidth; el.classList.add('cp-enter');
      update();
    },
    hide() { city = null; el.hidden = true; },
    get open() { return !!city; },
  };
}
