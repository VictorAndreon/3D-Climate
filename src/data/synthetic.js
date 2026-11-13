// Série sintética: amostra o campo analítico em cada nó da grade, no mesmo formato das séries reais.
import { analyticField } from './analytic.js';
import { createSeries } from './series.js';

export function syntheticSeries(grid, startUnix, hours = 168) {
  const a = analyticField({ startUnix, hours }), s = createSeries(grid.nP, hours, startUnix), o = {};
  for (let p = 0; p < grid.nP; p++) {
    const lon = grid.lons[p], lat = grid.lats[p];
    for (let h = 0; h < hours; h++) {
      const i = p * hours + h, tm = Math.max(0, h - 0.5);            // precip[h] = acumulado de (h-1, h]
      a.sample(lon, lat, h, o);
      const r = a.rain(lon, lat, tm);
      s.low[i] = Math.round(o.low); s.mid[i] = Math.round(o.mid); s.high[i] = Math.round(o.high);
      s.precip[i] = r;
      s.windSpeed[i] = o.speed;
      s.windDir[i] = ((Math.atan2(-o.u, -o.v) * 180) / Math.PI + 360) % 360;
      const cover = Math.max(o.low, o.mid, o.high);
      s.code[i] = a.storm(lon, lat, tm) ? 95 : r >= 10 ? 65 : r >= 2.5 ? 63 : r > 0 ? 61 : cover > 80 ? 3 : cover > 50 ? 2 : cover > 20 ? 1 : 0;
    }
  }
  return s;
}

const r1 = (v) => Math.round(v * 10) / 10;
/** Series -> array de locais no formato exato da resposta do Open-Meteo. */
export function seriesToApiJson(grid, s) {
  const out = [];
  for (let p = 0; p < s.nP; p++) {
    const sl = (arr, fn = (v) => v) => Array.from(arr.subarray(p * s.nT, (p + 1) * s.nT), fn);
    out.push({
      latitude: grid.lats[p], longitude: grid.lons[p],
      hourly: {
        time: Array.from(s.times),
        cloud_cover_low: sl(s.low), cloud_cover_mid: sl(s.mid), cloud_cover_high: sl(s.high),
        precipitation: sl(s.precip, r1), weather_code: sl(s.code),
        wind_speed_10m: sl(s.windSpeed, r1), wind_direction_10m: sl(s.windDir, Math.round),
      },
    });
  }
  return out;
}
