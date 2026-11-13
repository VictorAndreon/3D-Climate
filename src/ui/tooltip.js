// Tooltip: ponteiro -> ponto no mapa -> lon/lat -> célula. Hover no desktop, toque no celular.
import { toLonLat } from '../geo/projection.js';
import { conditionText } from './format.js';

const DEG = Math.PI / 180;
/** Município de centroide mais próximo (busca bruta, longitude corrigida por cos(lat)). */
export function nearestCity(municipios, lon, lat) {
  const k = Math.cos(lat * DEG);
  let best = '', bd = Infinity;
  for (const [name, mlon, mlat] of municipios) {
    const dx = (mlon - lon) * k, dy = mlat - lat, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}
const CARD = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
/** Direção de onde o vento vem, em 8 pontos cardeais. */
export const windCardinal = (deg) => CARD[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const num = (v, d) => v.toFixed(d).replace('.', ',');

export function tooltipLines(city, c) {
  return {
    title: city,
    condition: conditionText(c.code),
    clouds: `baixa ${Math.round(c.low)}% · média ${Math.round(c.mid)}% · alta ${Math.round(c.high)}%`,
    rain: `${num(c.precip, 1)} mm/h`,
    wind: `${Math.round(c.windSpeed)} km/h ${windCardinal(c.windDir)}`,
  };
}

/** pick(clientX, clientY) devolve { x, z } na cena se o ponteiro está sobre o estado, senão null. */
export function createTooltip(el, { canvas, pick, field, clock, municipios, tapToShow = true }) {
  let last = null;                                   // última posição com tooltip aberto
  const row = (k, v) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`;
  function hide() { el.hidden = true; last = null; }
  function show(clientX, clientY) {
    const hit = pick(clientX, clientY);
    const ll = hit && toLonLat(hit.x, hit.z);
    const cell = ll && field.cellInfo(ll.lon, ll.lat, clock.t);
    if (!cell) { hide(); return; }
    last = { clientX, clientY };
    const l = tooltipLines(nearestCity(municipios, ll.lon, ll.lat), cell);
    el.innerHTML = `<div class="tt-title"></div><div class="tt-cond"></div>${row('Nuvens', l.clouds)}${row('Chuva', l.rain)}${row('Vento', l.wind)}`;
    el.querySelector('.tt-title').textContent = l.title;
    el.querySelector('.tt-cond').textContent = l.condition;
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    let x = clientX + 16, y = clientY + 16;
    if (x + w > window.innerWidth - 8) x = clientX - w - 16;
    if (y + h > window.innerHeight - 8) y = clientY - h - 16;
    el.style.left = `${Math.max(8, x)}px`; el.style.top = `${Math.max(8, y)}px`;
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, moved: false }; });
  canvas.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { down.moved = true; hide(); }   // arrastando a câmera
    if (e.pointerType === 'mouse' && !down) show(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    const tap = down && !down.moved;
    down = null;
    if (e.pointerType !== 'mouse' && tap && tapToShow) show(e.clientX, e.clientY);     // toque sem arrasto abre; toque fora do estado fecha
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  clock.onChange(() => { if (last) show(last.clientX, last.clientY); });   // acompanha a linha do tempo
  return { hide };
}
