// Normalização da resposta do Open-Meteo -> Series.
import { createSeries } from './series.js';

export const HOURLY = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m'];
const TARGET = { cloud_cover_low: 'low', cloud_cover_mid: 'mid', cloud_cover_high: 'high', precipitation: 'precip', weather_code: 'code', wind_speed_10m: 'windSpeed', wind_direction_10m: 'windDir' };
const COVER = new Set(['low', 'mid', 'high']);

/** Resposta de 1 ponto vem como objeto, de vários como array. Erro da API ({error:true}) lança. */
export function normalizeResponse(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') throw new Error('Open-Meteo: resposta inesperada');
  if (json.error === true) throw new Error(`Open-Meteo: ${json.reason ?? 'erro'}`);
  return [json];
}

/** Monta as séries. Os locais são mapeados para os pontos da grade PELA ORDEM (a API devolve coordenadas ajustadas). */
export function buildSeries(grid, locations) {
  if (locations.length !== grid.nP) throw new Error(`Open-Meteo: ${locations.length} locais para ${grid.nP} pontos da grade`);
  const time0 = locations[0]?.hourly?.time;
  if (!Array.isArray(time0) || time0.length === 0) throw new Error('Open-Meteo: hourly.time ausente ou vazio');
  const nT = time0.length, s = createSeries(grid.nP, nT);
  for (let h = 0; h < nT; h++) s.times[h] = time0[h];
  for (let p = 0; p < grid.nP; p++) {
    const hourly = locations[p]?.hourly, time = hourly?.time;
    if (!Array.isArray(time) || time.length !== nT || time[0] !== time0[0] || time[nT - 1] !== time0[nT - 1]) throw new Error(`Open-Meteo: time divergente no local ${p}`);
    for (const key of HOURLY) {
      const src = hourly[key], dst = s[TARGET[key]], cover = COVER.has(TARGET[key]);
      if (!Array.isArray(src) || src.length !== nT) throw new Error(`Open-Meteo: série ${key} inválida no local ${p}`);
      for (let h = 0; h < nT; h++) {
        let v = src[h];
        if (v == null || !Number.isFinite(v)) v = 0;                 // null vira 0
        if (cover) v = Math.min(100, Math.max(0, Math.round(v)));
        else if (key === 'weather_code') v = Math.min(255, Math.max(0, Math.round(v)));
        else if (v < 0) v = 0;
        dst[p * nT + h] = v;
      }
    }
  }
  return s;
}

/** Índice de "agora" pelo timestamp (nunca assumir índice 0): maior i com times[i] ≤ nowUnix. */
export function findNowIndex(times, nowUnix) {
  let i = 0;
  while (i + 1 < times.length && times[i + 1] <= nowUnix) i++;
  return i;
}
