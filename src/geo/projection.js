// lon/lat <-> cena. Único ponto a trocar na fase 2 (MapLibre).
// Equirretangular local: y para cima, norte = -z, leste = +x, 1 unidade = 10 km.
export const LON0 = -53.2;
export const LAT0 = -30.4;
export const KM_PER_UNIT = 10;
const UNITS_PER_DEG = 111.32 / KM_PER_UNIT;
const COS0 = Math.cos((LAT0 * Math.PI) / 180);

export function toScene(lon, lat) {
  return { x: (lon - LON0) * COS0 * UNITS_PER_DEG, z: -(lat - LAT0) * UNITS_PER_DEG };
}
export function toLonLat(x, z) {
  return { lon: LON0 + x / (COS0 * UNITS_PER_DEG), lat: LAT0 - z / UNITS_PER_DEG };
}
/** 0,25° em unidades de cena. */
export const CELL_X = 0.25 * COS0 * UNITS_PER_DEG;
export const CELL_Z = 0.25 * UNITS_PER_DEG;
