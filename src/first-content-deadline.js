'use strict';
// Independent of heartbeat/reasoning/inactivity. Call only at actual dispatch.
function createFirstContentDeadline({ ms = 6000, onTimeout, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null, settled = false, started = false;
  return {
    dispatch() { if (started || settled) return; started = true; timer = setTimer(() => { if (!settled) { settled = true; onTimeout(); } }, Math.max(1, ms)); },
    content(text) { if (!String(text || '').trim() || settled) return false; settled = true; clearTimer(timer); return true; },
    dispose() { settled = true; clearTimer(timer); }
  };
}
module.exports = { createFirstContentDeadline };
