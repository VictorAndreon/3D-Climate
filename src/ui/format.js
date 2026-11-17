// Textos: datas no fuso da região via Intl, a partir de unix; condição (WMO) e status da fonte.
const DEFAULT_TZ = 'America/Sao_Paulo';
const cache = new Map();

/** Formatadores de data de um fuso (IANA): rótulo, hora, dia, data e hora local (0–23,99). */
export function makeFormat(tz = DEFAULT_TZ) {
  if (cache.has(tz)) return cache.get(tz);
  const dtf = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (unix) => {
    const o = {};
    for (const p of dtf.formatToParts(new Date(unix * 1000))) o[p.type] = p.value;
    o.weekday = o.weekday.replace('.', '').toLowerCase();
    return o;
  };
  const fmt = {
    fmtLabel: (unix) => { const p = parts(unix); return `${p.weekday} ${p.day}/${p.month}, ${p.hour}:${p.minute}`; },
    fmtHM: (unix) => { const p = parts(unix); return `${p.hour}:${p.minute}`; },
    fmtDay: (unix) => { const p = parts(unix); return `${p.weekday} ${p.day}`; },
    fmtDate: (unix) => { const p = parts(unix); return `${p.day}/${p.month} ${p.hour}:${p.minute}`; },
    localHourOf: (unix) => { const p = parts(unix); return Number(p.hour) + Number(p.minute) / 60; },
  };
  cache.set(tz, fmt);
  return fmt;
}

export function conditionText(code) {
  if (code === 0) return 'céu limpo';
  if (code === 1) return 'quase limpo';
  if (code === 2) return 'parcialmente nublado';
  if (code === 3) return 'nublado';
  if (code === 45 || code === 48) return 'nevoeiro';
  if (code >= 51 && code <= 57) return 'garoa';
  if (code === 61) return 'chuva fraca';
  if (code === 63) return 'chuva moderada';
  if (code === 65) return 'chuva forte';
  if (code === 66 || code === 67) return 'chuva congelante';
  if (code >= 71 && code <= 77) return 'neve';
  if (code >= 80 && code <= 82) return 'pancadas de chuva';
  if (code === 85 || code === 86) return 'pancadas de neve';
  if (code === 95) return 'trovoada';
  if (code === 96 || code === 99) return 'trovoada com granizo';
  return '—';
}

/** fmt: formatadores da região (padrão: São Paulo). */
export function statusText(status, fmt = makeFormat()) {
  const { fmtHM, fmtDate } = fmt;
  switch (status.kind) {
    case 'live': case 'cache': return `dados de ${fmtHM(status.fetchedAt)} · Open-Meteo`;
    case 'stale': return `dados de ${fmtHM(status.fetchedAt)} (desatualizados)`;
    case 'fixture': return `FIXTURE — gravado em ${fmtDate(status.fetchedAt)}`;
    default: return 'DEMO — dados sintéticos';
  }
}
/** Status que exige aviso visível (não é dado ao vivo em dia). */
export const isWarning = (status) => status.kind !== 'live' && status.kind !== 'cache';
