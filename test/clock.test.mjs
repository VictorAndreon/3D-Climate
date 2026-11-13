import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { createClock } from '../src/ui/clock.js';

const tNow = 0.68;
const mk = () => createClock({ tNow, tEnd72: tNow + 72, tEndAll: 167 });

test('começa em tNow, pausado, 1×, faixa 72 h', () => { const c = mk(); assert.equal(c.t, tNow); assert.equal(c.playing, false); assert.equal(c.speed, 1); assert.equal(c.range, '72h'); assert.equal(c.tMin, tNow); assert.equal(c.tMax, tNow + 72); });
test('1× avança 1 h por segundo', () => { const c = mk(); c.play(); for (let i = 0; i < 10; i++) c.tick(0.1); near(c.t, tNow + 1, 1e-9); });
test('4× e 0,5×', () => {
  const c = mk(); c.play(); c.setSpeed(4); for (let i = 0; i < 10; i++) c.tick(0.1); near(c.t, tNow + 4, 1e-9);
  c.setSpeed(0.5); for (let i = 0; i < 10; i++) c.tick(0.1); near(c.t, tNow + 4.5, 1e-9);
});
test('velocidade inválida é ignorada', () => { const c = mk(); c.setSpeed(99); assert.equal(c.speed, 1); });
test('dt gigante é limitado (aba voltou depois de 1 h)', () => { const c = mk(); c.play(); c.tick(3600); assert(c.t - tNow <= 0.1 + 1e-9); });
test('dt negativo ou NaN não anda', () => { const c = mk(); c.play(); c.tick(-5); c.tick(NaN); assert.equal(c.t, tNow); });
test('pausado não avança', () => { const c = mk(); c.tick(0.1); assert.equal(c.t, tNow); });
test('para e pausa no fim', () => { const c = mk(); c.seek(c.tMax - 0.01); c.play(); c.tick(0.1); assert.equal(c.t, c.tMax); assert.equal(c.playing, false); });
test('play no fim recomeça de agora', () => { const c = mk(); c.seek(c.tMax); c.play(); assert.equal(c.t, tNow); assert.equal(c.playing, true); });
test('seek limita nas duas pontas e ignora NaN', () => { const c = mk(); c.seek(-99); assert.equal(c.t, c.tMin); c.seek(1e9); assert.equal(c.t, c.tMax); c.seek(NaN); assert.equal(c.t, c.tMax); });
test('step vai para a hora inteira vizinha', () => { const c = mk(); c.seek(5.4); c.step(1); assert.equal(c.t, 6); c.seek(5.4); c.step(-1); assert.equal(c.t, 5); c.seek(5); c.step(1); assert.equal(c.t, 6); c.step(-1); assert.equal(c.t, 5); });
test('step não passa de tMin', () => { const c = mk(); c.step(-1); assert.equal(c.t, tNow); });
test('home volta para tNow', () => { const c = mk(); c.seek(30); c.home(); assert.equal(c.t, tNow); });
test('toggle alterna play/pause', () => { const c = mk(); c.toggle(); assert.equal(c.playing, true); c.toggle(); assert.equal(c.playing, false); });
test('setRange 72h → 7d → 72h ajusta tMax e traz t de volta', () => {
  const c = mk(); c.setRange('7d'); assert.equal(c.tMax, 167); assert.equal(c.range, '7d'); c.seek(150); assert.equal(c.t, 150);
  c.setRange('72h'); assert.equal(c.tMax, tNow + 72); assert.equal(c.t, tNow + 72);
});
test('onChange dispara em seek, tick e setRange', () => {
  const c = mk(); let n = 0; c.onChange(() => n++);
  c.seek(3); assert.equal(n, 1); c.play(); const a = n; c.tick(0.05); assert(n > a); const b = n; c.setRange('7d'); assert(n > b);
});
