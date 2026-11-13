import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nearestCity, windCardinal, tooltipLines } from '../src/ui/tooltip.js';

const geo = JSON.parse(readFileSync('assets/rs.json', 'utf8'));
test('centro de Porto Alegre', () => assert.equal(nearestCity(geo.municipios, -51.2, -30.05), 'Porto Alegre'));
test('Santa Maria', () => assert.equal(nearestCity(geo.municipios, -53.8, -29.7), 'Santa Maria'));
test('ponto no mar ainda devolve o mais próximo', () => assert.equal(typeof nearestCity(geo.municipios, -49, -31), 'string'));
test('windCardinal: 8 pontos, de onde o vento vem', () => {
  assert.deepEqual([0, 45, 90, 135, 180, 225, 270, 315, 350, 22, 23].map(windCardinal), ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO', 'N', 'N', 'NE']);
});
test('tooltipLines: município, condição, nuvens por camada, mm/h e vento', () => {
  const l = tooltipLines('Santa Maria', { low: 80, mid: 40, high: 5, precip: 2.345, code: 63, windSpeed: 18.4, windDir: 225 });
  assert.equal(l.title, 'Santa Maria'); assert.equal(l.condition, 'chuva moderada');
  assert.equal(l.clouds, 'baixa 80% · média 40% · alta 5%'); assert.equal(l.rain, '2,3 mm/h'); assert.equal(l.wind, '18 km/h SO');
});
test('tooltipLines: seco mostra 0,0 mm/h', () => assert.equal(tooltipLines('X', { low: 0, mid: 0, high: 0, precip: 0, code: 0, windSpeed: 0, windDir: 0 }).rain, '0,0 mm/h'));
