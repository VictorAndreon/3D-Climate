// Aviso de espera do limite por minuto da API: "aguardando a API (limite por minuto)… N s", contando para baixo.
export const waitText = (until, now) => `aguardando a API (limite por minuto)… ${Math.max(0, Math.ceil((until - now) / 1000))} s`;

/**
 * Devolve onWait(w): w = { until } mostra o aviso em `el` e o atualiza a cada tique; w = null o tira.
 * Sem `hide`, `el` é um indicador que já existe (o texto original volta ao fim); com `hide`, `el` só aparece durante a espera.
 * `flag` (um elemento) ganha data-waiting enquanto espera: o CSS esconde o outro indicador.
 */
export function createWaitNotice(el, { hide = false, flag = null, now = Date.now, setTimer = (f) => setInterval(f, 250), clearTimer = clearInterval } = {}) {
  let timer = null, saved = null;
  const stop = () => { if (timer != null) clearTimer(timer); timer = null; };
  return (w) => {
    stop();
    if (!w) {
      if (saved != null) el.textContent = saved;
      saved = null;
      if (hide) el.hidden = true;
      if (flag) delete flag.dataset.waiting;
      return;
    }
    if (saved == null) saved = el.textContent;
    const paint = () => { el.textContent = waitText(w.until, now()); };
    paint();
    if (hide) el.hidden = false;
    if (flag) flag.dataset.waiting = '1';
    timer = setTimer(paint);
  };
}
