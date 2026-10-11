'use strict';

const IGNORE = new Set([
  'ops', 'op', 'ok', 'okay', 'test', 'testing',
  '嗯', '嗯嗯', '啊', '呃', '额', '哦', '噢', '谢谢', '收到'
]);

// Do not throw away real short technical utterances. The old length<=2 rule
// incorrectly discarded terms such as Go, DP, GC and IO.
const SHORT_TECH = new Set([
  'go', 'dp', 'gc', 'io', 'ai', 'os', 'db', 'ip', 'ui', 'ux',
  'c', 'c++', 'c#', 'r', 'x', 'qf'
]);

function normalize(value = '') {
  return String(value)
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^[\s，。！？,.!?；;：:、'"“”‘’()（）\[\]{}【】<>《》-]+|[\s，。！？,.!?；;：:、'"“”‘’()（）\[\]{}【】<>《》-]+$/g, '');
}

function isSpeechNoise(text = '') {
  const t = normalize(text);
  if (!t) return true;
  if (SHORT_TECH.has(t)) return false;
  if (IGNORE.has(t)) return true;
  if (/^(?:uh+|um+|erm+|hmm+|mm+|ah+|eh+)$/i.test(t)) return true;
  if (/^[a-z]$/i.test(t) && !SHORT_TECH.has(t)) return true;
  if (/^[\u3400-\u9fff]$/.test(t) && /[嗯啊呃额哦噢诶欸]/.test(t)) return true;
  return false;
}

module.exports = { isSpeechNoise, IGNORE, SHORT_TECH };
