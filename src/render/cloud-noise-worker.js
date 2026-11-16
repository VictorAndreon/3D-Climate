// PROTÓTIPO (?nuvens=volume): gera um canal do ruído 3D fora da thread principal, enquanto o mapa e a previsão carregam.
import { makeNoiseChannel } from './cloud-noise.js';

self.onmessage = (e) => {
  const out = makeNoiseChannel(e.data.kind, e.data.size, e.data.seed);
  self.postMessage(out, [out.buffer]);
};
