import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtLabel, fmtHM, fmtDay, fmtDate, conditionText, statusText } from '../src/ui/format.js';

test('fmtLabel', () => assert.equal(fmtLabel(1794578400), 'sex 13/11, 11:00'));          // 2026-11-13T14:00Z
test('fmtLabel vira o dia no fuso de São Paulo', () => assert.equal(fmtLabel(1794538800 - 3600), 'qui 12/11, 23:00'));
test('fmtLabel à meia-noite local é 00:00, não 24:00', () => assert.equal(fmtLabel(1794538800), 'sex 13/11, 00:00'));
test('fmtHM', () => assert.equal(fmtHM(1794580860), '11:41'));
test('fmtDay', () => assert.equal(fmtDay(1794538800), 'sex 13'));
test('fmtDate', () => assert.equal(fmtDate(1794580860), '13/11 11:41'));
test('statusText para os 6 kinds', () => {
  const at = 1794580860;
  assert.equal(statusText({ kind: 'live', fetchedAt: at }), 'dados de 11:41 · Open-Meteo');
  assert.equal(statusText({ kind: 'cache', fetchedAt: at }), 'dados de 11:41 · Open-Meteo');
  assert.equal(statusText({ kind: 'stale', fetchedAt: at }), 'dados de 11:41 (desatualizados)');
  assert.equal(statusText({ kind: 'demo', fetchedAt: at }), 'DEMO — dados sintéticos');
  assert.equal(statusText({ kind: 'demo-fallback', fetchedAt: 0 }), 'DEMO — dados sintéticos');
  assert.equal(statusText({ kind: 'fixture', fetchedAt: at }), 'FIXTURE — gravado em 13/11 11:41');
});
test('conditionText', () => {
  assert.equal(conditionText(0), 'céu limpo'); assert.equal(conditionText(3), 'nublado'); assert.equal(conditionText(48), 'nevoeiro');
  assert.equal(conditionText(53), 'garoa'); assert.equal(conditionText(63), 'chuva moderada'); assert.equal(conditionText(81), 'pancadas de chuva');
  assert.equal(conditionText(95), 'trovoada'); assert.equal(conditionText(99), 'trovoada com granizo'); assert.equal(conditionText(42), '—');
});
