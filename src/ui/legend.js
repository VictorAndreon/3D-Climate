// Legenda discreta e selo de origem dos dados.
import { statusText, isWarning } from './format.js';

const ITEMS = [
  ['nuvem', '<svg viewBox="0 0 24 16"><path d="M6 14a4 4 0 0 1-.6-7.96A6 6 0 0 1 17 5.2 4.5 4.5 0 0 1 17.5 14z" fill="#fff"/></svg>'],
  ['chuva fraca', '<svg viewBox="0 0 24 16"><path d="M12 3l-2 9" stroke="#9fd0ff" stroke-width="1.6" stroke-linecap="round"/></svg>'],
  ['chuva moderada', '<svg viewBox="0 0 24 16"><path d="M9 3l-2 9M15 3l-2 9" stroke="#9fd0ff" stroke-width="1.8" stroke-linecap="round"/></svg>'],
  ['chuva forte', '<svg viewBox="0 0 24 16"><path d="M6 2l-2.4 11M12 2l-2.4 11M18 2l-2.4 11" stroke="#cfe7ff" stroke-width="2.2" stroke-linecap="round"/></svg>'],
  ['trovoada', '<svg viewBox="0 0 24 16"><path d="M13 1l-5 8h4l-2 6 6-9h-4z" fill="#ffd84a"/></svg>'],
];

export function createLegend(legendEl, badgeEl, status) {
  legendEl.hidden = false;
  legendEl.innerHTML = ITEMS.map(([label, svg]) => `<div class="lg-item">${svg}<span>${label}</span></div>`).join('');
  badgeEl.hidden = false;
  badgeEl.textContent = statusText(status);
  badgeEl.classList.toggle('warn', isWarning(status));     // demo, fixture e desatualizado: aviso sempre visível
  badgeEl.dataset.kind = status.kind;
}
