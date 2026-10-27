// Configurable global shortcuts. Kept dependency-free so it is unit-testable.
// Accelerator strings follow Electron's format, e.g. 'CommandOrControl+Return'.

const DEFAULTS = {
  // What should I say? — recent conversation, no screenshot.
  say: 'CommandOrControl+Return',
  // Assist — current screen + interviewer requirements (Ctrl+? remains an alias).
  assist: 'CommandOrControl+Shift+Return',
  assistAlias: 'CommandOrControl+Shift+/',
  technical: 'CommandOrControl+L',
  leetcode: 'CommandOrControl+H',
  quit: 'CommandOrControl+Shift+X',
  hide: 'CommandOrControl+Shift+H',
  listening: 'CommandOrControl+Shift+L',
  passthrough: 'CommandOrControl+Shift+I',
  screen: 'CommandOrControl+Shift+S'
};

function resolveShortcuts(overrides = {}) {
  const out = {};
  for (const [action, def] of Object.entries(DEFAULTS)) {
    const v = (overrides && overrides[action]) || def;
    out[action] = v;
  }
  return out;
}

function findConflicts(map) {
  const seen = new Map();
  const conflicts = [];
  for (const [action, accel] of Object.entries(map)) {
    if (!accel) continue;
    const key = accel.trim().toLowerCase();
    if (seen.has(key)) conflicts.push([seen.get(key), action, accel]);
    else seen.set(key, action);
  }
  return conflicts;
}

function isValid(accel) {
  if (!accel || typeof accel !== 'string') return false;
  const parts = accel.split('+').map((s) => s.trim());
  if (parts.some((p) => !p)) return false;
  const modifiers = new Set(['CommandOrControl', 'CmdOrCtrl', 'Command', 'Cmd', 'Control', 'Ctrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta']);
  const keys = parts.filter((p) => !modifiers.has(p));
  return keys.length >= 1;
}

function actionForKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === 'Enter') return e.shiftKey ? 'assist' : 'say';
  if (e.shiftKey && ['?', '/'].includes(e.key)) return 'assist';
  if (!e.shiftKey && e.key.toLowerCase() === 'h') return 'leetcode';
  if (!e.shiftKey && e.key.toLowerCase() === 'l') return 'technical';
  return null;
}
const api = { DEFAULTS, resolveShortcuts, findConflicts, isValid, actionForKey };
if (typeof module !== 'undefined') module.exports = api;
else window.CueShortcuts = api;
