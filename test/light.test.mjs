import test from 'node:test';
import assert from 'node:assert/strict';
import { near } from './helpers.mjs';
import { skyState, localHour } from '../src/render/light.js';

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
test('meio-dia: sol alto, night 0', () => { const s = skyState(12); assert(s.sunDir[1] > 0.8); assert.equal(s.night, 0); });
test('meia-noite: night 1 e nuvens legíveis', () => { const s = skyState(0); assert.equal(s.night, 1); assert(lum(s.ambient) >= 0.25); assert(lum(s.cloudLit) >= 0.4); });
test('entardecer é quente', () => { const s = skyState(18); assert(s.sun[0] > s.sun[2] * 1.3); });
test('amanhecer é quente', () => { const s = skyState(6); assert(s.sun[0] > s.sun[2] * 1.3); });
test('contínua, inclusive na virada 24→0', () => {
  for (let h = 0; h < 24; h += 0.05) {
    const a = skyState(h), b = skyState((h + 0.05) % 24);
    for (const k of ['sun', 'ambient', 'bgTop', 'bgBottom', 'cloudLit', 'cloudShade', 'sunDir']) for (let i = 0; i < 3; i++) assert(Math.abs(a[k][i] - b[k][i]) < 0.05, `${k}[${i}] em h=${h}`);
    assert(Math.abs(a.night - b.night) < 0.1);
  }
});
test('sunDir é unitário e nunca aponta para baixo', () => { for (let h = 0; h < 24; h += 0.5) { const d = skyState(h).sunDir; near(Math.hypot(...d), 1, 1e-6); assert(d[1] > 0.1); } });
test('cores dentro de [0, 1]', () => { for (let h = 0; h < 24; h += 0.5) { const s = skyState(h); for (const k of ['sun', 'ambient', 'bgTop', 'bgBottom', 'cloudLit', 'cloudShade']) for (const v of s[k]) assert(v >= 0 && v <= 1); } });
test('localHour: unix -> hora local do RS (UTC-3)', () => { near(localHour(1794578400), 11); near(localHour(1794578400 + 13.5 * 3600), 0.5); });
