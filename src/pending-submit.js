'use strict';

// One remembered key press, bound to the live draft and source generation.
class PendingSubmit {
  constructor({ timeoutMs = 5000, onReady, onChange, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    Object.assign(this, { timeoutMs, onReady, onChange, setTimer, clearTimer }); this.pending = null;
  }
  arm(snapshot, identity, mode) {
    this.cancel('replaced');
    this.pending = { questionId: snapshot?.questionId || '', identity, mode, createdAt: Date.now() };
    this.timer = this.setTimer(() => this.cancel('timeout'), this.timeoutMs);
    this.onChange?.('waiting', this.pending); return this.pending;
  }
  observe(snapshot, identity) {
    const p = this.pending; if (!p) return;
    if (identity !== p.identity) return this.cancel('source-changed');
    if (p.questionId && snapshot.questionId && snapshot.questionId !== p.questionId) return this.cancel('new-question');
    if (!p.questionId) p.questionId = snapshot.questionId;
    if (!snapshot.text || snapshot.semanticStatus !== 'answerable') return;
    this.clearTimer(this.timer); this.pending = null;
    this.onChange?.('submitted', p); this.onReady?.(snapshot, p.mode);
  }
  cancel(reason = 'canceled') {
    this.clearTimer(this.timer); const previous = this.pending; this.pending = null;
    if (previous) this.onChange?.(reason, previous);
  }
}
module.exports = { PendingSubmit };
