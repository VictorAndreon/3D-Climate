import assert from 'node:assert/strict';
export const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b} (eps ${eps})`);
