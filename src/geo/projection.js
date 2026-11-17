// lon/lat <-> cena. Único ponto a trocar na fase 2 (MapLibre).
// Equirretangular local por região: y para cima, norte = -z, leste = +x.
// A projeção é um objeto criado por região e passado a quem a usa; não há estado global.
const KM_PER_DEG = 111.32;

/** Projeção do RS: centro (-53,2; -30,4), 1 unidade = 10 km. */
export const RS_PROJECTION = { lon0: -53.2, lat0: -30.4, kmPerUnit: 10 };

export function makeProjection({ lon0, lat0, kmPerUnit }) {
  const unitsPerDeg = KM_PER_DEG / kmPerUnit;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  return {
    lon0, lat0, kmPerUnit,
    toScene(lon, lat) { return { x: (lon - lon0) * cos0 * unitsPerDeg, z: -(lat - lat0) * unitsPerDeg }; },
    toLonLat(x, z) { return { lon: lon0 + x / (cos0 * unitsPerDeg), lat: lat0 - z / unitsPerDeg }; },
    /** Passo de grade (em graus) em unidades de cena. */
    cell(stepDeg) { return { x: stepDeg * cos0 * unitsPerDeg, z: stepDeg * unitsPerDeg }; },
  };
}

/** Projeção que enquadra o retângulo em ~targetUnits unidades (mínimo de 3 km por unidade). */
export function fitProjection({ minLon, maxLon, minLat, maxLat }, targetUnits = 77) {
  const lon0 = (minLon + maxLon) / 2, lat0 = (minLat + maxLat) / 2;
  const widthKm = (maxLon - minLon) * Math.cos((lat0 * Math.PI) / 180) * KM_PER_DEG;
  const heightKm = (maxLat - minLat) * KM_PER_DEG;
  const kmPerUnit = Math.round(Math.max(3, Math.max(widthKm, heightKm) / targetUnits) * 10) / 10;
  return { lon0, lat0, kmPerUnit };
}
