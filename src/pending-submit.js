'use strict';

// One remembered key press, bound to the live draft and source generation.
class PendingSubmit {
  constructor({ timeoutMs = 15000, maxWaitMs = 90000, onReady, onChange, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
    Object.assign(this, { timeoutMs, maxWaitMs, onReady, onChange, setTimer, clearTimer, now }); this.pending = null;
  }
  refresh() { this.clearTimer(this.timer); const remaining=this.maxWaitMs-(this.now()-this.pending.createdAt); this.timer=this.setTimer(()=>this.cancel('timeout'),Math.max(0,Math.min(this.timeoutMs,remaining))); }
  arm(snapshot, identity, mode) {
    this.cancel('replaced');
    this.pending = { questionId: snapshot?.questionId || '', identity, mode, createdAt: this.now(), revision:snapshot?.revision };
    this.refresh();
    this.onChange?.('waiting', this.pending); return this.pending;
  }
  observe(snapshot, identity) {
    const p = this.pending; if (!p) return;
    if (identity !== p.identity) return this.cancel('source-changed');
    if (p.questionId && snapshot.questionId && snapshot.questionId !== p.questionId) return this.cancel('new-question');
    if (!p.questionId) p.questionId = snapshot.questionId;
    if (snapshot.revision !== p.revision) { p.revision=snapshot.revision; this.refresh(); }
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
