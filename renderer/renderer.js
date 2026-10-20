/* cue renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const cue = window.cue; // exposed by preload
  const $ = (s) => document.querySelector(s);
  const isWindows = cue.platform === 'win32';
  const isMac = cue.platform === 'darwin';
  const DEFAULT_QWEN_ASR_MODEL = 'qwen-audio-3.0-asr-flash-streaming';

  // Qwen ASR used to be a fixed <select> with only two model IDs.
  // Upgrade it at runtime to a free-form text input while keeping the old
  // models as datalist suggestions. This lets users enter any compatible
  // Alibaba Model Studio / DashScope streaming ASR model ID.
  function installEditableQwenAsrModelControl() {
    const current = document.getElementById('qwen-asr-model');
    if (!current || current.tagName === 'INPUT') return;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'qwen-asr-model';
    input.className = 's-select';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = DEFAULT_QWEN_ASR_MODEL;
    input.value = String(current.value || DEFAULT_QWEN_ASR_MODEL).trim();
    input.setAttribute('list', 'qwen-asr-model-suggestions');
    input.setAttribute('aria-label', 'Qwen ASR 模型 ID');

    const suggestions = document.createElement('datalist');
    suggestions.id = 'qwen-asr-model-suggestions';
    for (const modelId of [
      'qwen-audio-3.0-asr-flash-streaming',
      'qwen-audio-3.0-asr-flash'
    ]) {
      const option = document.createElement('option');
      option.value = modelId;
      suggestions.appendChild(option);
    }

    const note = document.createElement('div');
    note.className = 's-note';
    note.textContent =
      '可输入兼容的 Qwen ASR 模型 ID。模型须支持 DashScope WebSocket 流式 ASR 协议；更改后保存设置并重新开启监听。';

    current.replaceWith(input);
    input.insertAdjacentElement('afterend', suggestions);
    suggestions.insertAdjacentElement('afterend', note);
  }

  installEditableQwenAsrModelControl();

  // ---- paint icons -------------------------------------------------------
  $('#logo-btn').innerHTML = icon('logo', { size: 18 });
  $('.tb-hide .chev').innerHTML = icon('chevron-down', { size: 14 });
  $('#stop-btn').innerHTML = icon('stop-square', { size: 15 });
  $('#quit-btn').innerHTML = icon('x', { size: 14 });
  $('#quit-btn').addEventListener('dblclick', () => cue.quit());
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#more-btn').innerHTML = icon('more-horizontal', { size: 18 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });
  const clearIC = document.querySelector('#clear-transcript-btn .ic');
  if (clearIC) clearIC.innerHTML = icon('trash-2', { size: 15 });

  // ---- state -------------------------------------------------------------
  let settings = null;
  let whisperOverview = null;
  let projectIndexState = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;
  let responseCount = 0;
  const MAX_RESPONSES = 30;

  const messages = $('#messages');

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // minimal, safe markdown: fenced code, bullets, inline code, bold, paragraphs
  function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '', inCode = false, inList = false, buf = [];
    const flushP = () => { if (buf.length) { html += '<p>' + inline(buf.join(' ')) + '</p>'; buf = []; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) { flushP(); if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      if (/^\s*[-*]\s+/.test(line)) { flushP(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue; }
      if (line.trim() === '') { flushP(); if (inList) { html += '</ul>'; inList = false; } continue; }
      buf.push(line.trim());
    }
    flushP(); if (inList) html += '</ul>'; if (inCode) html += '</code></pre>';
    return html;
  }

  function clearMessages() { messages.innerHTML = ''; aiEl = null; caretEl = null; }

  function addUserBubble(text) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
  }

  function startAi(small) {
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = t;
    // Guard: caretEl must be a child of aiEl
    if (caretEl && caretEl.parentNode === aiEl) {
      aiEl.insertBefore(span, caretEl);
    } else {
      aiEl.appendChild(span);
    }
  }

  function finalizeAi() {
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
  }

  let activeRequestId = null;
  let firstTokenRendered = false;
  let busyFailsafe = null;
  function setBusy(v) {
    busy = v;
    $('#send-btn').classList.toggle('busy', v);
    clearTimeout(busyFailsafe);
    // Main enforces 25s inactivity / 180s generation limits. Keep the UI locked
    // through reasoning-only streams; tokens refresh this final fallback.
    if (v) busyFailsafe = setTimeout(() => { busy = false; $('#send-btn').classList.toggle('busy', false); }, 190000);
  }

  // ---- transcript helpers ------------------------------------------------
  // NOTE: The old transcript-list element was renamed to ts-list.
  // These helpers are now deprecated but kept for compatibility.
  // The main sidebar uses appendTranscriptHistoryTurn() instead.
  let transcriptInterimEl = null;

  // FIX #1: Updated to use ts-list instead of non-existent transcript-list

  function clearTranscriptInterim() {
    if (transcriptInterimEl) {
      transcriptInterimEl.remove();
      transcriptInterimEl = null;
    }
  }

  // ---- toast helper ------------------------------------------------------
  // FIX #7: Toast queue system — ensures latest toast wins cleanly without stacking
  let toastTimer = null;
  let toastFadeTimer = null;
  function showToast(message, ms) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.getElementById('app').appendChild(el);
    }
    // Clear any pending timers to prevent overlap
    clearTimeout(toastTimer);
    clearTimeout(toastFadeTimer);
    // Immediately update content (no stacking)
    el.textContent = message;
    el.classList.add('show');
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, ms);
  }

  // ---- actions -----------------------------------------------------------
  let ragPrefetchTimer = null;
  let lastPrefetchKey = '';
  let lastPrefetchAt = 0;

  function scheduleProjectPrefetch(text, immediate = false, sourceKey = '') {
    const query = String(text || '').trim();
    if (query.length < 4 || typeof cue.projectPrefetch !== 'function') return;
    clearTimeout(ragPrefetchTimer);
    const key = JSON.stringify([query, immediate, sourceKey]);
    if (key === lastPrefetchKey && Date.now() - lastPrefetchAt < 2000) return;
    const send = () => {
      lastPrefetchKey = key;
      lastPrefetchAt = Date.now();
      cue.projectPrefetch({ text: query, final: immediate, sourceKey });
    };
    if (immediate) send();
    else send(); // Main applies the stable-window debounce and formal routing.
  }

  function runMode(mode, text) {
    // Manual answer shortcuts request a fresh reply, including during generation.
    // The main process aborts the previous request; other modes retain the guard.
    if (busy && mode !== 'say' && mode !== 'technical') return;

    // Never promote renderer-side interim ASR text into an explicit question.
    // The main process owns the QuestionResolver and decides whether the newest
    // speech is a complete question, a supplement, noise, or an unfinished tail.
    const requestText = typeof text === 'string' ? text : '';

    cue.ask({ mode, text: requestText });
  }

  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => runMode(btn.dataset.mode, ''));
  });

  // Global shortcut bridge from src/custom-main.js.
  cue.on('shortcut:mode', ({ mode } = {}) => {
    if (mode === 'say' || mode === 'assist' || mode === 'technical') runMode(mode, '');
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  // ========== SMART AUTO-FILL SYSTEM ==========
  // Track whether the current input text came from STT auto-fill (Them channel)
  let inputFromSTT = false;
  let sttFillTimer = null;
  let questionFinalizeTimer = null;
  let softClearTimer = null;
  let userSpeechStart = null;

  // Question history for undo (Ctrl+Z)
  const questionHistory = [];
  const MAX_QUESTION_HISTORY = 10;

  // ---- Question completeness detection ----
  function isLikelyCompleteQuestion(text) {
    const trimmed = (text || '').trim();
    
    // Must be substantial (not just filler words)
    if (trimmed.length < 12) return false;
    
    // High confidence: ends with question mark
    if (/\?$/.test(trimmed)) return true;
    
    // High confidence: behavioral interview patterns (these are complete even without ?)
    const behavioralPatterns = [
      /tell me about a time/i,
      /give me an example/i,
      /describe a (situation|time|project|challenge)/i,
      /walk me through/i,
      /can you (tell|describe|explain|share)/i,
      /what (was|were|is|are) your/i,
      /how (did|do|would) you/i,
      /why (did|do|are|should)/i,
      /what (did|do|would) you/i,
      /tell me about yourself/i,
      /tell me about your/i,
      /what.{1,30}(biggest|greatest|most|hardest|proudest)/i,
      /have you ever/i
    ];
    if (behavioralPatterns.some(p => p.test(trimmed))) return true;
    
    // Medium confidence: question starters with substantial content
    const questionStarters = /^(what|how|why|when|where|who|which|tell|describe|explain|can|could|would|should|have|did|do|is|are|was|were)/i;
    if (questionStarters.test(trimmed) && trimmed.length > 25) return true;
    
    // Medium confidence: ends with common question endings
    if (/(about that|for us|to us|with you|for you|about it|to share|you handle|you approach|your experience|your background)\s*$/i.test(trimmed)) return true;
    
    return false;
  }

  // ---- Get question confidence level ----
  function getQuestionConfidence(text) {
    const trimmed = (text || '').trim();
    if (trimmed.length < 8) return 'low';
    if (/\?$/.test(trimmed)) return 'high';
    if (isLikelyCompleteQuestion(trimmed)) return 'medium';
    if (trimmed.length > 20) return 'accumulating';
    return 'low';
  }

  // ---- Update visual state based on question readiness ----
  // FIX #8: Batch class updates to avoid flicker
  function updateQuestionReadyState() {
    const text = input.value;
    const confidence = getQuestionConfidence(text);
    
    // Batch the class changes to minimize repaints
    const shouldBeReady = confidence === 'high' || confidence === 'medium';
    const shouldBeAccumulating = confidence === 'accumulating';
    
    // Only update if state actually changed
    const isReady = composer.classList.contains('stt-ready');
    const isAccumulating = composer.classList.contains('stt-accumulating');
    
    if (shouldBeReady !== isReady || shouldBeAccumulating !== isAccumulating) {
      composer.classList.remove('stt-ready', 'stt-accumulating');
      if (shouldBeReady) {
        composer.classList.add('stt-ready');
      } else if (shouldBeAccumulating) {
        composer.classList.add('stt-accumulating');
      }
    }
    
    updateSendButtonState(); // FIX #9: Keep send button in sync
  }
  
  // FIX #9: Send button visual "ready" state
  function updateSendButtonState() {
    const sendBtn = document.getElementById('send-btn');
    if (!sendBtn) return;
    
    const hasText = input.value.trim().length > 0;
    const isReady = composer.classList.contains('stt-ready');
    
    sendBtn.classList.toggle('ready', hasText && isReady);
    sendBtn.classList.toggle('has-text', hasText);
  }

  // ---- Save question to history for undo ----
  function saveToQuestionHistory(text) {
    if (!text || text.trim().length < 5) return;
    
    // Don't save duplicates
    const last = questionHistory[questionHistory.length - 1];
    if (last && last.text === text.trim()) return;
    
    questionHistory.push({
      text: text.trim(),
      timestamp: Date.now()
    });
    
    // Keep only recent history
    while (questionHistory.length > MAX_QUESTION_HISTORY) {
      questionHistory.shift();
    }
    
    updateHistoryBadge(); // FIX #14: Update badge when history changes
  }
  
  // FIX #14: History button badge showing count
  function updateHistoryBadge() {
    const historyBtn = document.getElementById('history-btn');
    if (!historyBtn) return;
    
    // Remove existing badge if any
    let badge = historyBtn.querySelector('.history-badge');
    
    const count = questionHistory.length;
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'history-badge';
        historyBtn.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // ---- Restore last question from history (Ctrl+Z) ----
  function restoreLastQuestion() {
    const last = questionHistory.pop();
    if (last) {
      input.value = last.text;
      inputFromSTT = true;
      lastSTTValue = last.text; // FIX #8: Track restored value for edit detection
      composer.classList.add('stt-filling');
      updateQuestionReadyState();
      syncPlaceholder();
      updateHistoryBadge(); // Update badge after removing from history
      showToast('已恢复问题', 1500);
      return true;
    }
    showToast('没有可恢复的问题', 1500);
    return false;
  }

  // ---- Auto-fill the input box with transcribed speech from interviewer ----
  function autoFillInputFromSTT(text) {
    // If user has manually typed something different, don't overwrite
    if (!inputFromSTT && input.value.trim().length > 0) return;

    // Cancel any pending soft-clear (interviewer is still talking)
    clearTimeout(softClearTimer);
    composer.classList.remove('stt-dimmed');

    const current = input.value.trim();
    const newText = current ? current + ' ' + text : text;
    input.value = newText;
    inputFromSTT = true;
    lastSTTValue = newText; // FIX #6: Track the STT value for edit detection
    syncPlaceholder();

    // Show filling state
    composer.classList.add('stt-filling');
    updateQuestionReadyState();
    updateSendButtonState(); // FIX #9: Update send button state

    // Reset the idle timer — after 2s of silence, check if question is complete
    clearTimeout(questionFinalizeTimer);
    questionFinalizeTimer = setTimeout(() => {
      if (isLikelyCompleteQuestion(input.value)) {
        composer.classList.add('stt-ready');
        updateSendButtonState(); // FIX #9: Update send button when ready
        // Subtle notification that question is ready
        showToast('按 Enter 回答', 2500);
      }
    }, 1800);

    // After 8s of no new words, save to history and keep stable
    clearTimeout(sttFillTimer);
    sttFillTimer = setTimeout(() => {
      saveToQuestionHistory(input.value);
      composer.classList.remove('stt-filling');
      // Keep stt-ready if applicable
      updateQuestionReadyState();
      updateSendButtonState(); // FIX #9
    }, 8000);
  }

  // ---- Soft clear: don't immediately wipe question when user speaks ----
  function softClearSTTFill() {
    // When the user speaks (You channel), don't immediately clear
    // Instead, dim the input and wait — they might just be acknowledging
    if (!inputFromSTT) return;
    
    // FIX #3: Reset userSpeechStart at the beginning before setting new timestamp
    // This ensures we always track from fresh when a new soft-clear cycle begins
    const now = Date.now();
    if (!userSpeechStart) {
      userSpeechStart = now;
    }

    // Dim the input to show it's in "pending clear" state
    composer.classList.add('stt-dimmed');
    
    // Clear the finalization timer (user is responding)
    clearTimeout(questionFinalizeTimer);

    // Re-armed on every 'you' final, so this fires ~800ms after the user stops.
    // The 2s test below is measured from the FIRST final of this cycle, so a brief
    // acknowledgement ("mm-hm") leaves the question on screen while a sustained
    // answer clears it. Firing at 2.5s instead would make that test always true.
    clearTimeout(softClearTimer);
    softClearTimer = setTimeout(() => {
      const speechDuration = userSpeechStart ? Date.now() - userSpeechStart : 0;
      if (speechDuration > 2000) {
        // User has been speaking for a while — they're answering, clear the box
        saveToQuestionHistory(input.value);
        input.value = '';
        inputFromSTT = false;
        composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
        syncPlaceholder();
        updateSendButtonState(); // FIX #9: Update send button state
        userSpeechStart = null;
      }
    }, 800);
  }

  // ---- Hard clear (called when user explicitly clears or types) ----
  // FIX #10: Add option to show toast when clearing
  function hardClearSTTFill(showUndoHint = false) {
    const hadContent = input.value.trim().length > 0;
    saveToQuestionHistory(input.value);
    input.value = '';
    inputFromSTT = false;
    lastSTTValue = ''; // FIX #6: Clear the tracked STT value
    userSpeechStart = null;
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    clearTimeout(softClearTimer);
    clearTimeout(questionFinalizeTimer);
    clearTimeout(sttFillTimer);
    clearInputInterim(); // FIX #5: Clear interim when clearing input
    syncPlaceholder();
    updateSendButtonState(); // FIX #9
    updateHistoryBadge(); // FIX #14
    
    // FIX #10: Show undo hint when explicitly cleared
    if (showUndoHint && hadContent) {
      const undoHint = isWindows ? 'Ctrl+Z 撤销' : '⌘Z 撤销';
      showToast(`已清空 · ${undoHint}`, 2000);
    }
  }

  // ---- Reset soft-clear state (interviewer spoke again) ----
  // FIX #16: Reset userSpeechStart properly when cancelSoftClear is called
  function cancelSoftClear() {
    userSpeechStart = null; // Reset timestamp so next soft-clear starts fresh
    clearTimeout(softClearTimer);
    composer.classList.remove('stt-dimmed');
  }

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  
  // FIX #6: Track last STT value to detect substantial edits vs minor corrections
  let lastSTTValue = '';
  
  input.addEventListener('input', () => {
    const currentValue = input.value;
    
    // FIX #5: Clear interim text when user starts typing
    clearInputInterim();
    
    // FIX #6: Only detach from STT mode if edit is substantial
    // Minor corrections (typo fixes, small additions) should keep STT mode
    if (inputFromSTT && lastSTTValue) {
      const lengthDiff = Math.abs(currentValue.length - lastSTTValue.length);
      const isCleared = currentValue.trim().length === 0;
      const isSubstantialChange = lengthDiff > lastSTTValue.length * 0.3 || isCleared;
      
      if (isSubstantialChange) {
        // User made a major change — detach from STT mode
        saveToQuestionHistory(lastSTTValue);
        inputFromSTT = false;
        lastSTTValue = '';
        composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
        clearTimeout(softClearTimer);
        clearTimeout(questionFinalizeTimer);
      }
      // Minor edits: keep inputFromSTT = true, just update visual state
    } else if (!inputFromSTT) {
      // User typing from scratch — standard behavior
      composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    }
    
    syncPlaceholder();
    updateSendButtonState(); // FIX #9: Update send button on input change
  });
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { composer.classList.remove('focused'); syncPlaceholder(); });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    const wasFromSTT = inputFromSTT;
    
    // Save to history before clearing (in case user wants to redo)
    saveToQuestionHistory(text);
    
    input.value = '';
    inputFromSTT = false;
    lastSTTValue = ''; // FIX #6: Clear tracked STT value
    userSpeechStart = null;
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    clearTimeout(softClearTimer);
    clearTimeout(questionFinalizeTimer);
    clearTimeout(sttFillTimer);
    syncPlaceholder();
    updateSendButtonState(); // FIX #9
    
    // If text came from STT (interviewer question), use answerThis mode
    // Otherwise use ask mode (user typed their own question)
    runMode(wasFromSTT ? 'answerThis' : 'ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    // Ctrl+Z / Cmd+Z: restore last question if input is empty
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !input.value.trim()) {
      e.preventDefault();
      restoreLastQuestion();
      return;
    }
    // Escape: clear the input (with undo hint)
    if (e.key === 'Escape' && input.value.trim()) {
      e.preventDefault();
      hardClearSTTFill(true); // FIX #10: Show undo hint
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); }
  });
  
  // FIX #13: Global keyboard shortcut for force-answer (Ctrl+Shift+A / Cmd+Shift+A)
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      if (!e.repeat) runMode('technical', '');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) runMode(e.shiftKey ? 'assist' : 'say', '');
      return;
    }
    // Ctrl+? / Cmd+?: Assist with recent conversation + current screen.
    // Accept both '?' and '/' because keyboard layouts report this chord differently.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '?' || e.key === '/')) {
      e.preventDefault();
      runMode('assist', '');
      return;
    }

    // Ctrl+Shift+A / Cmd+Shift+A: Force answer current question immediately
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (input.value.trim()) {
        send();
      } else if (inputFromSTT || composer.classList.contains('stt-filling')) {
        // Even if question seems incomplete, force send
        send();
      } else {
        showToast('请先输入或识别到问题', 1500);
      }
    }
  });
  
  // FIX #4: Add tooltip with keyboard shortcuts to send button
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    const forceKey = isWindows ? 'Ctrl+Shift+A' : '⌘⇧A';
    sendBtn.title = `发送 · ${forceKey} 立即回答`;
  }

  // Smart toggle
  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    await cue.settingsSet({ smart: settings.smart });
  });

  // Hide / collapse
  function toggleHide() {
    const collapsed = $('#panel').classList.toggle('collapsed');
    $('#hide-btn').classList.toggle('collapsed', collapsed);
    $('.tb-hide span:last-child').textContent = collapsed ? '展开' : '收起';
    $('#live-dot').style.display = collapsed ? 'none' : '';
  }
  $('#hide-btn').addEventListener('click', toggleHide);
  cue.on('hide:toggle', toggleHide);
  $('#hide-btn').setAttribute('aria-label', `收起/展开 · ${isMac ? '⌘⇧H' : 'Ctrl+Shift+H'}`);

  // Stop = start/stop listening. Kick off system-audio capture straight from the click so
  // the user-gesture is fresh for getDisplayMedia (loopback capture needs it).
  $('#stop-btn').addEventListener('click', async () => {
    const turningOn = !$('#stop-btn').classList.contains('active');
    if (turningOn) {
      // startSystemAudio may fail (user cancels, no permission) — that's OK,
      // mic will still work and capture will toggle regardless
      try { await startSystemAudio(); } catch (_) { /* handled inside startSystemAudio */ }
    }
    const active = await cue.captureToggle();
    if (turningOn && !active) stopSystemAudio();
  });
  $('#stop-btn').setAttribute('aria-label', `开始/停止录音 · ${isMac ? '⌘R' : 'Ctrl+R'}`);

  // Transcript toggle removed — sidebar now auto-opens with listening

  // Clear transcript
  const clearTranscriptBtn = document.getElementById('clear-transcript-btn');
  if (clearTranscriptBtn) {
    clearTranscriptBtn.addEventListener('click', async () => {
      // Save current input to history before clearing (for undo)
      saveToQuestionHistory(input.value);
      
      await cue.clearTranscript();
      activeRequestId = null;
      responseCount = 0;
      setBusy(false);
      clearTimeout(ragPrefetchTimer);
      lastPrefetchKey = '';
      clearMessages();
      // Also clear the floating interim bar
      if (interimEl) { interimEl.textContent = ''; interimEl.classList.remove('show'); }
      // FIX #1: Use ts-list instead of non-existent transcript-list
      const list = document.getElementById('ts-list');
      if (list) list.innerHTML = '<div class="ts-placeholder">开始监听后，对话记录会显示在这里。</div>';
      transcriptInterimEl = null;
      clearTranscriptSidebar(); // clear the history sidebar too
      hardClearSTTFill(); // clear the input box too
      
      showToast('会话与上下文已清空；Ctrl/⌘+Z 仅恢复输入框文字。', 3500);
    });
  }

  // ---- capture: mic (renderer side) — uses AudioWorklet (modern, off-main-thread) ----
  let audioCtx = null;
let micStream = null;
let micWorklet = null;

let micStarting = false;
let micWanted = false;
  async function startMic() {
      micWanted = true;

  if (
    micStream ||
    micStarting
  ) {
    return;
  }

  micStarting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });
      if (!micWanted) {
  stream
    .getTracks()
    .forEach((track) => track.stop());

  return;
}

micStream = stream;
      // getUserMedia can resolve with a stream that has no usable audio track
      // (e.g. a virtual/placeholder device, or a device that was unplugged
      // between permission grant and capture start). Fail loudly here instead
      // of silently wiring up an AudioWorklet to nothing — that produces the
      // "cue never hears me, no error shown" symptom with no diagnostic at all.
      const [track] = micStream.getAudioTracks();
      if (!track) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
        showStatus('未获取到麦克风音轨。请在 Windows 声音设置中选择可用的默认输入设备后重试。');
        return;
      }
      cue.log('mic stream started: track=' + (track.label || '(no label — permission may be stale)') + ' muted=' + track.muted);
      audioCtx = new AudioContext({ sampleRate: 16000 });

      // Use AudioWorklet for low-latency, off-main-thread processing
      try {
        await audioCtx.audioWorklet.addModule('audio-worklet-processor.js');
        const source = audioCtx.createMediaStreamSource(micStream);
        micWorklet = new AudioWorkletNode(audioCtx, 'cue-audio-processor');
        micWorklet.port.onmessage = (e) => {
          cue.micPcm(e.data);
        };
        source.connect(micWorklet);
        // Don't connect to destination — we just capture, don't play
        cue.log('mic AudioWorklet processor attached');
      } catch (workletErr) {
        // Fallback to ScriptProcessor if AudioWorklet fails (shouldn't happen in Electron 33+)
        cue.log('AudioWorklet failed, falling back to ScriptProcessor: ' + workletErr.message);
        const micNode = audioCtx.createMediaStreamSource(micStream);
        const micProc = audioCtx.createScriptProcessor(1024, 1, 1);
        const sink = audioCtx.createGain(); sink.gain.value = 0;
        micNode.connect(micProc); micProc.connect(sink); sink.connect(audioCtx.destination);
        micProc.onaudioprocess = (e) => {
          const f = e.inputBuffer.getChannelData(0);
          const out = new Int16Array(f.length);
          for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
          cue.micPcm(out.buffer);
        };
        micWorklet = { _legacy: true, proc: micProc, node: micNode, sink };
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const name = err && err.name;
      cue.log('mic error: ' + name + ' — ' + message);
      // getUserMedia's DOMException.name is the reliable signal here — the
      // .message text varies by Chromium version and isn't meant for users.
      // Distinguishing "no device" from "denied" from "in use elsewhere"
      // turns one generic dead end into three different next actions.
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        showStatus('未找到麦克风。请连接麦克风，或在系统声音设置中选择默认输入设备后重试。');
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        showStatus(isWindows
          ? '麦克风权限被拒绝。请打开设置 → 隐私和安全性 → 麦克风，允许 Cue 访问后重试。'
          : '麦克风权限被拒绝。请打开系统设置 → 隐私与安全性 → 麦克风，允许 Cue 访问后重试。');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showStatus('麦克风启动失败，可能被其他程序独占。请关闭占用麦克风的程序后重试。');
      } else {
        showStatus('麦克风采集启动失败，请检查麦克风权限后重试。');
      }
    }
    finally {
  micStarting = false;
}
  }
  function stopMic() {
    micWanted = false;
    if (micWorklet) {
      if (micWorklet._legacy) {
        micWorklet.proc.disconnect(); micWorklet.proc.onaudioprocess = null;
        micWorklet.node.disconnect(); micWorklet.sink.disconnect();
      } else {
        micWorklet.disconnect();
      }
      micWorklet = null;
    }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  }

  // ---- capture: system/meeting audio (getDisplayMedia loopback, in cue's process) ----
  let sysStream = null, sysCtx = null, sysWorklet = null, sysStarting = false;
  async function startSystemAudio() {
    // Called both from the stop-btn click (fresh user gesture for getDisplayMedia) and from the
    // capture:state handler. getDisplayMedia is async, so `if (sysStream) return` alone loses the
    // race and can open a second loopback stream that is then orphaned.
    if (sysStream || sysStarting) return;
    sysStarting = true;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      cue.log('system audio unavailable: getDisplayMedia not supported');
      showStatus('当前系统版本不支持系统音频采集。');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

      stream.getVideoTracks().forEach((t) => t.stop()); // we only want the audio
      const tracks = stream.getAudioTracks();
      if (!tracks.length) {
        cue.log('system audio: no loopback track on this platform');
        stream.getTracks().forEach((t) => t.stop());
        showStatus(cue.platform === 'win32'
          ? '未检测到系统音频回环音轨。请确认屏幕共享对话框已勾选“共享音频”，且音频设备未被独占。'
          : '未检测到系统音频回环音轨。系统音频采集需要 macOS 14.4 或更新版本，屏幕和麦克风功能仍可使用。');
        return;
      }
      sysStream = stream;
      sysCtx = new AudioContext({ sampleRate: 16000 });

      // Use AudioWorklet for system audio too
      try {
        await sysCtx.audioWorklet.addModule('audio-worklet-processor.js');
        const source = sysCtx.createMediaStreamSource(new MediaStream(tracks));
        sysWorklet = new AudioWorkletNode(sysCtx, 'cue-audio-processor');
        sysWorklet.port.onmessage = (e) => {
          cue.systemPcm(e.data);
        };
        source.connect(sysWorklet);
        cue.log('system audio: AudioWorklet capturing loopback');
      } catch (workletErr) {
        // Fallback to ScriptProcessor
        cue.log('system audio AudioWorklet failed, using ScriptProcessor: ' + workletErr.message);
        const sysNode = sysCtx.createMediaStreamSource(new MediaStream(tracks));
        const sysProc = sysCtx.createScriptProcessor(1024, 1, 1);
        const sink = sysCtx.createGain(); sink.gain.value = 0;
        sysNode.connect(sysProc); sysProc.connect(sink); sink.connect(sysCtx.destination);
        sysProc.onaudioprocess = (e) => {
          const f = e.inputBuffer.getChannelData(0);
          const out = new Int16Array(f.length);
          for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
          cue.systemPcm(out.buffer);
        };
        sysWorklet = { _legacy: true, proc: sysProc, node: sysNode, sink };
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      cue.log('system audio error: ' + message);
      showStatus('系统音频采集启动失败，请授予 Cue 屏幕录制和音频访问权限后重试。');
    } finally {
      sysStarting = false;
    }
  }
  function stopSystemAudio() {
    if (sysWorklet) {
      if (sysWorklet._legacy) {
        sysWorklet.proc.disconnect(); sysWorklet.proc.onaudioprocess = null;
        sysWorklet.node.disconnect(); sysWorklet.sink.disconnect();
      } else {
        sysWorklet.disconnect();
      }
      sysWorklet = null;
    }
    if (sysCtx) { sysCtx.close(); sysCtx = null; }
    if (sysStream) { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
  }

  // ---- STT / VAD status helpers ------------------------------------------
  // Live dot states: 'off' | 'idle' | 'speaking' | 'transcribing'
  function setLiveDotState(dotState) {
    const dot = document.getElementById('live-dot');
    if (!dot) return;
    dot.classList.remove('off', 'idle', 'speaking', 'transcribing');
    dot.classList.add(dotState);
    const labels = {
      off:          '未监听',
      idle:         '正在监听，当前无语音',
      speaking:     '检测到语音',
      transcribing: '识别中…'
    };
    dot.title = labels[dotState] || '';
  }

  let sttState = 'disconnected';
  const sttLabels = { disconnected: '未监听', connecting: '连接中', batch: '批量识别',
    local: '本地识别', streaming: '流式识别', loading: '加载中', stopping: '停止中',
    off: '未监听', error: '识别异常' };

  function updateSttStatus({ active, streaming } = {}) {
    const label = document.getElementById('stt-status');
    if (!label) return;
    if (active === false) {
      sttState = 'disconnected';
      label.textContent = sttLabels.disconnected;
    } else if (active === true) {
      sttState = streaming ? 'connecting' : 'batch';
      label.textContent = sttLabels[sttState];
    }
    label.className = 'stt-status stt-' + sttState;
  }

  // ---- transcript history sidebar (hidden by default, manual toggle) ----
  let tsSidebarInterimEl = null;
  let sidebarOpen = false;
  // Track last committed row per channel — all chunks from same speaker go in one row
  const tsLastRow = { you: null, them: null };
  const tsRowTimer = { you: null, them: null };
  const TS_SENTENCE_GAP_MS = 10000; // 10s silence = new row

  function showSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    const historyBtn = document.getElementById('history-btn');
    if (sidebar) sidebar.classList.remove('hidden');
    if (historyBtn) historyBtn.classList.add('active');
    const panelWrap = document.getElementById('panel-wrap');
    if (panelWrap) panelWrap.classList.add('sidebar-open');
    sidebarOpen = true;
  }

  function hideSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    const historyBtn = document.getElementById('history-btn');
    if (sidebar) sidebar.classList.add('hidden');
    if (historyBtn) historyBtn.classList.remove('active');
    const panelWrap = document.getElementById('panel-wrap');
    if (panelWrap) panelWrap.classList.remove('sidebar-open');
    sidebarOpen = false;
  }

  function toggleSidebar() {
    if (sidebarOpen) {
      hideSidebar();
    } else {
      showSidebar();
      // FIX #7: Scroll to bottom when opening sidebar
      const list = document.getElementById('ts-list');
      if (list) {
        requestAnimationFrame(() => {
          list.scrollTop = list.scrollHeight;
        });
      }
    }
  }

  // History button toggle
  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) {
    historyBtn.innerHTML = icon('message-square-text', { size: 15 });
    historyBtn.addEventListener('click', toggleSidebar);
  }

  // Close sidebar button
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', hideSidebar);
  }

  function appendTranscriptHistoryTurn(channel, text, isInterim) {
    const list = document.getElementById('ts-list');
    if (!list) return;

    // Remove placeholder on first real turn
    const ph = list.querySelector('.ts-placeholder');
    if (ph) ph.remove();

    if (isInterim) {
      // Update the single floating interim row
      if (!tsSidebarInterimEl) {
        tsSidebarInterimEl = document.createElement('div');
        tsSidebarInterimEl.className = 'ts-turn ts-' + channel + ' ts-interim-row';
        const chLabel = document.createElement('span');
        chLabel.className = 'ts-channel';
        chLabel.textContent = channel === 'them' ? '面试官' : '候选人';
        const txt = document.createElement('span');
        txt.className = 'ts-text ts-interim';
        tsSidebarInterimEl.appendChild(chLabel);
        tsSidebarInterimEl.appendChild(txt);
        list.appendChild(tsSidebarInterimEl);
      }
      tsSidebarInterimEl.querySelector('.ts-text').textContent = text;
    } else {
      // Remove interim row
      if (tsSidebarInterimEl) { tsSidebarInterimEl.remove(); tsSidebarInterimEl = null; }

      const existingRow = tsLastRow[channel];
      const useExisting = existingRow && existingRow.isConnected;

      if (useExisting) {
        // Append to existing row — accumulates sentence fragments
        const txt = existingRow.querySelector('.ts-text');
        if (txt) {
          txt.textContent = txt.textContent ? txt.textContent + ' ' + text : text;
        }
      } else {
        // Start a new row (no buttons — just clean history view)
        const row = document.createElement('div');
        row.className = 'ts-turn ts-' + channel;

        const chLabel = document.createElement('span');
        chLabel.className = 'ts-channel';
        chLabel.textContent = channel === 'them' ? '面试官' : '候选人';

        const txt = document.createElement('span');
        txt.className = 'ts-text';
        txt.textContent = text;

        row.appendChild(chLabel);
        row.appendChild(txt);
        list.appendChild(row);
        tsLastRow[channel] = row;
      }

      // Reset silence timer
      clearTimeout(tsRowTimer[channel]);
      tsRowTimer[channel] = setTimeout(() => { tsLastRow[channel] = null; }, TS_SENTENCE_GAP_MS);

      // When THIS channel speaks, reset the OTHER channel's row
      const other = channel === 'you' ? 'them' : 'you';
      clearTimeout(tsRowTimer[other]);
      tsLastRow[other] = null;

      list.scrollTop = list.scrollHeight;
    }
  }

  function clearTranscriptSidebar() {
    const list = document.getElementById('ts-list');
    if (list) list.innerHTML = '<div class="ts-placeholder">开始监听后，对话记录会显示在这里。</div>';
    tsSidebarInterimEl = null;
    tsLastRow.you = null; tsLastRow.them = null;
    clearTimeout(tsRowTimer.you); clearTimeout(tsRowTimer.them);
  }

  // ---- events from main --------------------------------------------------
  cue.on('capture:state', ({ active, streaming, mode }) => {
    setLiveDotState(
      active ? 'idle' : 'off'
    );

    $('#stop-btn')
      .classList
      .toggle('active', active);

    composer
      .classList
      .toggle('listening', active);

    const historyBtn =
      document.getElementById('history-btn');

    if (historyBtn) {
      historyBtn
        .classList
        .toggle('listening', active);
    }

    if (active) {
      // Only start the microphone once.
      void startMic();
    } else {
      stopMic();
      stopSystemAudio();

      if (interimEl) {
        interimEl.textContent = '';
        interimEl.classList.remove('show');
      }
    }

    if (
      active &&
      mode === 'local'
    ) {
      sttState = 'local';

      const label =
        document.getElementById('stt-status');

      if (label) {
        label.textContent = sttLabels.local;
        label.className =
          'stt-status stt-local';
      }
    } else {
      updateSttStatus({
        active,
        streaming
      });
    }
  });

  // ---- real-time transcript display (interim + final) ----
  let interimEl = null;
  function getOrCreateInterimEl() {
    if (!interimEl) {
      interimEl = document.createElement('div');
      interimEl.className = 'interim-transcript';
      // Insert into panel-main (the left column), before the action row
      const panelMain = document.getElementById('panel-main');
      const actionRow = document.getElementById('action-row');
      if (panelMain && actionRow && actionRow.parentNode === panelMain) {
        panelMain.insertBefore(interimEl, actionRow);
      } else if (panelMain) {
        panelMain.appendChild(interimEl);
      } else {
        document.getElementById('panel').appendChild(interimEl);
      }
    }
    return interimEl;
  }
  // FIX #12: Show interim text in input box (grayed/italic) before final arrives
  let inputInterimEl = null;
  function showInterimInInput(text) {
    if (!inputInterimEl) {
      inputInterimEl = document.createElement('span');
      inputInterimEl.className = 'input-interim';
      // FIX #2: Insert into composer (not input-area) for correct positioning
      composer.appendChild(inputInterimEl);
    }
    inputInterimEl.textContent = text;
    inputInterimEl.style.display = text ? 'block' : 'none';
  }
  function clearInputInterim() {
    if (inputInterimEl) {
      inputInterimEl.textContent = '';
      inputInterimEl.style.display = 'none';
    }
  }
  
  cue.on('stt:interim', ({ channel, text, utteranceKey = '', sourceId = 'stream' }) => {
    setLiveDotState('transcribing');
    const el = getOrCreateInterimEl();
    const label = channel === 'them' ? '面试官' : '候选人';
    el.textContent = `${label}: ${text}`;
    el.classList.add('show');
    // Keep the latest words visible inside a bounded caption viewport.
    el.scrollTop = el.scrollHeight;
    appendTranscriptHistoryTurn(channel, text, true); // update sidebar interim

    // Interim text is useful for RAG prefetch only. It is deliberately NOT sent
    // as payload.text when Ctrl+Enter is pressed; answer targeting lives in main.
    if (channel === 'them' && String(text || '').trim()) {
      scheduleProjectPrefetch(String(text).trim(), false, utteranceKey ? `${sourceId}:${utteranceKey}` : '');
    }

    // Interviewer interim speech stays in transcript/history only.
    // Do not mirror STT into the manual input box.
  });
  cue.on('stt:final', ({ channel, text, utteranceKey = '', sourceId = 'stream' }) => {
    setLiveDotState('idle');
    if (channel === 'them') {
      scheduleProjectPrefetch(text, true, utteranceKey ? `${sourceId}:${utteranceKey}` : '');
    }
    // Clear interim when we get a final
    if (interimEl) { interimEl.textContent = ''; interimEl.classList.remove('show'); }
    clearTranscriptInterim();
    clearInputInterim(); // FIX #12: Clear interim text from input area
    // sidebar: the final turn is added via the 'transcript' event below
  });
  cue.on('stt:status', ({ channel, status, provider }) => {
    cue.log(`[stt] ${provider || channel || 'unknown'} ${status}`);
    if (provider === 'local') {
      const label = document.getElementById('stt-status');
      const localLabels = {
        loading: '正在加载本地模型',
        ready: '本地识别已就绪',
        transcribing: '本地识别中',
        stopping: '停止中',
        off: '未监听',
        error: '识别异常'
      };
      sttState = status === 'ready' || status === 'transcribing' ? 'local' : status;
      if (label) {
        label.textContent = localLabels[status] || status;
        label.className = 'stt-status stt-' + sttState;
      }
      if (status === 'loading') $('#stop-btn').classList.add('active');
      if (status === 'off' || status === 'error') $('#stop-btn').classList.remove('active');
      if (status === 'loading' || status === 'transcribing' || status === 'stopping') setLiveDotState('transcribing');
      if (status === 'ready') setLiveDotState('idle');
      if (status === 'off') setLiveDotState('off');
      return;
    }
    if (status === 'connected') {
      sttState = 'streaming';
      const label = document.getElementById('stt-status');
      if (label) { label.textContent = sttLabels[sttState]; label.className = 'stt-status stt-streaming'; }
    }
  });
  cue.on('vad:state', ({ channel, speaking }) => {
    setLiveDotState(speaking ? 'speaking' : 'idle');
  });
cue.on('llm:start', ({ userBubble, small, category, requestId }) => {
  if (aiEl) finalizeAi();
  activeRequestId = requestId || null;
  firstTokenRendered = false;
  responseCount++;

  // 回答区现在是倒序排列：
  // 第一个 = 最新
  // 最后一个 = 最旧
  if (responseCount > MAX_RESPONSES) {
    const groups = messages.querySelectorAll('.response-group');
    const oldest = groups[groups.length - 1];

    if (oldest) oldest.remove();

    responseCount = MAX_RESPONSES;
  }

  const group = document.createElement('div');
  group.className = 'response-group';

  const sep = document.createElement('div');
  sep.className = 'response-sep';
  sep.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  group.appendChild(sep);

  if (userBubble) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = userBubble;
    group.appendChild(b);
  }

  if (category) {
    const pill = document.createElement('div');
    pill.className = 'category-pill';
    pill.textContent = { technical: '技术问题', project: '项目深挖', behavioral: '行为面试',
      motivation: '求职动机', situational: '情景问题', experience: '个人经历',
      compensation: '薪酬与反问', general: '面试问答' }[category] || '面试问答';

    group.appendChild(pill);
  }

  aiEl = document.createElement('div');
  aiEl.className = 'ai-text' + (small ? ' small' : '');
  aiEl.dataset.raw = '';

  caretEl = document.createElement('span');
  caretEl.className = 'ai-caret';

  aiEl.appendChild(caretEl);
  group.appendChild(aiEl);

  // 核心修改：
  // 最新问答插入最上方，而不是追加到最下面
  messages.prepend(group);

  // 每次产生新回答时，把视图移动到顶部
  requestAnimationFrame(() => {
    messages.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });

  setBusy(true);
});
  const acceptsReply = requestId => !requestId || requestId === activeRequestId;
  cue.on('llm:evidence', ({ sources = [], missing = [], requestId }) => {
    if (!acceptsReply(requestId) || !aiEl) return;
    const group = aiEl.closest('.response-group');
    if (!group) return;
    group.querySelector('.answer-evidence')?.remove();
    if (!sources.length && !missing.length) return;
    const details = document.createElement('details');
    details.className = 'answer-evidence';
    const summary = document.createElement('summary');
    summary.textContent = `参考依据 ${sources.length} 项${missing.length ? ` / 资料缺口 ${missing.length} 项` : ''}`;
    const body = document.createElement('div');
    body.className = 'evidence-body';
    for (const source of sources) {
      const label = document.createElement('div');
      const type = { overview: '概览', implementation: '实现', decision: '选型理由', challenge: '困难', incident: '故障', performance: '指标', ownership: '本人职责', collaboration: '协作', environment: '环境', process: '流程', limitation: '限制', theory: '原理' }[source.docType] || '资料';
      const truth = { implemented: '已实现', test_only: '仅测试', planned: '计划', hypothetical: '假设', abandoned: '已放弃', general_knowledge: '通用知识', unverified: '待核对' }[source.truthScope] || '待核对';
      label.textContent = `${source.projectName || ''} · ${type} · ${truth} · ${source.path}:${source.startLine}–${source.endLine}${source.partial ? '（片段）' : ''}`;
      const excerpt = document.createElement('pre');
      excerpt.textContent = String(source.text || '');
      body.append(label, excerpt);
    }
    for (const item of missing) {
      const gap = document.createElement('div');
      const type = { implementation: '实现', decision: '选型理由', constraints: '约束', challenge: '困难', incident: '真实故障', performance: '测试指标', environment: '环境', ownership: '个人职责', collaboration: '协作', process: '流程', hypothetical: '假设的实际基础' }[item.type] || '相应证据';
      gap.textContent = typeof item === 'string' ? '资料缺口：' + item
        : item.message || `缺少${type}资料${item.text || item.question ? '：' + (item.text || item.question) : '，或来源未能放入本轮回答。'}`;
      body.appendChild(gap);
    }
    details.append(summary, body);
    group.appendChild(details);
  });
  cue.on('project:active', ({ label, retrieve, requestId }) => {
    if (!acceptsReply(requestId)) return;
    $('#active-project-label').textContent = retrieve ? label : '当前为通用问题';
  });
  cue.on('project:catalog', ({ projects }) => renderProjectChoices(projects));
  $('#current-project').addEventListener('change', async event => {
    try { settings = await cue.projectCurrent(event.target.value); }
    catch (error) { showStatus(error?.message || '无法切换项目。'); void refreshProjectIndexState(); }
  });
  cue.on('llm:token', ({ text, requestId }) => {
    if (!acceptsReply(requestId)) return;
    appendToken(text);
    if (!firstTokenRendered) {
      firstTokenRendered = true;
      requestAnimationFrame(() => cue.replyRendered?.(requestId));
    }
    setBusy(true);
  });
  cue.on('llm:done', ({ requestId } = {}) => {
    if (!acceptsReply(requestId)) return;
    finalizeAi(); setBusy(false); activeRequestId = null;
  });
  cue.on('llm:error', ({ message, requestId }) => {
    if (!acceptsReply(requestId)) return;
    activeRequestId = null;
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message; finalizeAi(); setBusy(false);
  });
  cue.on('transcript', ({ channel, text }) => {
    if (!text || text.trim().length < 2 || /^[?!.,;:\-…]+$/.test(text.trim())) return;
    appendTranscriptHistoryTurn(channel, text, false);
    // Keep both speakers in transcript/history only.
    // The input box is reserved for text the user types manually.
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = document.getElementById('cue-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cue-status';
      // Insert into panel-main before the action row
      const panelMain = document.getElementById('panel-main');
      const actionRow = document.getElementById('action-row');
      if (panelMain && actionRow && actionRow.parentNode === panelMain) {
        panelMain.insertBefore(el, actionRow);
      } else if (panelMain) {
        panelMain.appendChild(el);
      } else {
        document.getElementById('panel').appendChild(el);
      }
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  cue.on('status', ({ message }) => {
    cue.log('[status] ' + message);
    showStatus(message);
    if (sttState !== 'disconnected') {
      const lower = message.toLowerCase();
      if (lower.includes('error') || lower.includes(' off')) {
        sttState = 'error';
        const label = document.getElementById('stt-status');
        if (label) { label.textContent = sttLabels[sttState]; label.className = 'stt-status stt-error'; }
      }
    }
  });

  // ---- smart tooltip helpers --------------------------------------------


  // ---- AI rules: live char counter + soft cap ---------------------------
  function updateAiRulesCounter() {
    const el = document.getElementById('ai-rules');
    const counter = document.getElementById('ai-rules-count');
    if (!el || !counter) return;
    const n = el.value.length;
    const cap = 2000;
    counter.textContent = String(n);
    counter.classList.toggle('over', n >= cap);
    counter.parentElement.classList.toggle('s-counter-warn', n >= cap - 100);
  }
  const aiRulesEl = document.getElementById('ai-rules');
  if (aiRulesEl) aiRulesEl.addEventListener('input', updateAiRulesCounter);
  function updateSmartTooltip() {
    if (!settings) return;
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    const fast = m.fast || '快速模型';
    const smart = m.smart || '深度模型';
    const btn = document.getElementById('smart-toggle');
    if (btn) btn.title = '快速：' + fast + ' · 深度：' + smart + '（质量更高，通常耗时更长）';
  }

  // ---- microphone permission banner --------------------------------------
  function showMicPermissionBanner() {
    let banner = document.getElementById('mic-perm-banner');
    if (banner) { banner.classList.add('show'); return; }
    banner = document.createElement('div');
    banner.id = 'mic-perm-banner';
    banner.className = 'show';
    banner.innerHTML =
      '<div class="mic-perm-text">' +
        '<strong>🎙️ 需要麦克风权限</strong><br>' +
        'Cue 需要麦克风权限来识别语音。请在系统设置中允许访问，然后重启 Cue。' +
      '</div>' +
      '<div class="mic-perm-actions"></div>';
    const actions = banner.querySelector('.mic-perm-actions');
    if (cue.platform === 'darwin') {
      const openBtn = document.createElement('button');
      openBtn.textContent = '打开麦克风设置';
      openBtn.addEventListener('click', () => cue.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'));
      actions.appendChild(openBtn);
    }
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = '关闭提示';
    dismissBtn.className = 'dismiss';
    dismissBtn.addEventListener('click', () => banner.classList.remove('show'));
    actions.appendChild(dismissBtn);
    const panel = document.getElementById('panel');
    panel.insertBefore(banner, document.getElementById('action-row'));
  }

  // ---- settings ----------------------------------------------------------
  const scrim = $('#settings-scrim');

  async function openSettings() {
    try {
      // Settings 是全屏交互层，打开时必须关闭鼠标穿透。
      setIgnore(false);

      // renderer 的事件绑定早于 boot() 完成。
      // 如果用户启动后立刻点 Settings，这里主动等待 settings 加载。
      if (!settings) {
        settings = await cue.settingsGet();
      }

      fillSettings();

      // 显示 Settings
      scrim.classList.remove('hidden');

      // 刷新本地 Whisper 模型状态
      await refreshWhisperModels();
    } catch (error) {
      const message =
        error && error.message ? error.message : String(error);

      cue.log('open settings failed: ' + message);
      showStatus('无法打开设置：' + message);
    }
  }

  async function closeSettings() {
    if (await saveSettings()) {
      scrim.classList.add('hidden');
    }
  }

  $('#more-btn').addEventListener('click', () => {
    void openSettings();
  });

  $('#s-close').addEventListener('click', () => {
    void closeSettings();
  });

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) {
      void closeSettings();
    }
  });
  // Tab switching
  document.querySelectorAll('.s-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      if (tab.classList.contains('on')) return;
      if (!(await saveSettings())) return;
      document.querySelectorAll('.s-tab').forEach(t => t.classList.remove('on'));
      document.querySelectorAll('.s-tab-pane').forEach(p => p.classList.add('hidden'));
      tab.classList.add('on');
      const pane = document.querySelector(`.s-tab-pane[data-pane="${tab.dataset.tab}"]`);
      if (pane) pane.classList.remove('hidden');
    });
  });

  function updateCustomProviderFields() {
    $('#custom-endpoint-settings').classList.toggle('hidden', settings.provider !== 'custom');
  }


  function fillQwenAsrSettings() {
    const q = settings.qwenAsr || {};
    const model = $('#qwen-asr-model');
    const lang = $('#qwen-language');
    const resume = $('#qwen-use-resume');
    const project = $('#qwen-use-project');
    const jd = $('#qwen-use-jd');
    const vocab = $('#qwen-vocabulary');

    if (model) model.value = String(q.model || DEFAULT_QWEN_ASR_MODEL).trim() || DEFAULT_QWEN_ASR_MODEL;
    if (lang) lang.value = q.language || 'auto';
    if (resume) resume.checked = q.useResume !== false;
    if (project) project.checked = q.useProjectKnowledge !== false;
    if (jd) jd.checked = q.useJobDescription !== false;
    if (vocab) vocab.value = (q.vocabulary || []).join('\n');
  }

  function saveQwenAsrSettings() {
    settings.qwenAsr = {
      ...(settings.qwenAsr || {}),
      model: String($('#qwen-asr-model')?.value || '').trim() || DEFAULT_QWEN_ASR_MODEL,
      language: $('#qwen-language')?.value || 'auto',
      useResume: $('#qwen-use-resume')?.checked !== false,
      useProjectKnowledge: $('#qwen-use-project')?.checked !== false,
      useJobDescription: $('#qwen-use-jd')?.checked !== false,
      vocabulary: ($('#qwen-vocabulary')?.value || '')
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean)
    };
  }

  function formatProjectIndexBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n >= 10 * 1024 ? 0 : 1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderProjectIndexState(state) {
    projectIndexState = state || { ready: false };
    renderProjectChoices(projectIndexState.projects || []);
    const status = document.getElementById('project-index-status');
    const clearBtn = document.getElementById('project-index-clear');
    if (clearBtn) clearBtn.disabled = !projectIndexState.ready;
    if (!status) return;

    if (!projectIndexState.ready) {
      status.textContent = '尚未建立项目索引，请导入文件夹或 ZIP；索引仅保存在本机。';
      return;
    }

    const source = projectIndexState.sourceName || '项目';
    const size = formatProjectIndexBytes(projectIndexState.indexedBytes);
    const truncated = projectIndexState.truncatedCount
      ? ` · ${projectIndexState.truncatedCount} 项因大小限制被截断`
      : '';
    const projects = Array.isArray(projectIndexState.projects) ? projectIndexState.projects : [];
    const names = projects.length > 1 ? ` · ${projects.slice(-4).map(p => p.name).join(' / ')}${projects.length > 4 ? ' / …' : ''}` : '';
    status.textContent = `${source} · ${projectIndexState.fileCount} 个文件 · ${projectIndexState.chunkCount} 个片段 · ${size}${names}${truncated}`;
    const warnings = projectIndexState.importReport?.warnings || projectIndexState.warnings || [];
    if (warnings.length) status.textContent += ' · 导入提示：' + warnings.map(item => typeof item === 'string' ? item : item.message || item.code).slice(0, 4).join('；');
  }

  function renderProjectChoices(projects) {
    const select = $('#current-project');
    select.replaceChildren();
    for (const project of [{ id: '', name: '自动' }, ...(projects || [])]) {
      const option = document.createElement('option');
      option.value = project.id || project.projectId || '';
      option.textContent = project.name || project.projectName || project.id || project.projectId;
      select.appendChild(option);
    }
    select.value = settings?.currentProjectId || '';
  }

  function renderSemanticState(state = {}) {
    const el = $('#project-semantic-status');
    if (!el) return;
    el.textContent = state.ready ? '本地语义检索已就绪。'
      : state.error ? '本地语义检索暂不可用，继续使用基础检索：' + state.error
        : state.message || (state.modelReady ? '模型已准备，正在建立本地语义索引。' : '本地语义检索未准备，仍可使用基础检索。');
  }
  async function prepareSemantic(importLocal) {
    const controls = [$('#project-semantic-prepare'), $('#project-semantic-import')];
    controls.forEach(button => { button.disabled = true; });
    try {
      const result = await cue.projectSemanticPrepare(importLocal);
      if (!result?.canceled) renderSemanticState(result?.state);
    } catch (error) {
      $('#project-semantic-status').textContent = '准备失败，继续使用基础检索：' + (error?.message || String(error));
    } finally { controls.forEach(button => { button.disabled = false; }); }
  }
  cue.on('project:semantic-state', renderSemanticState);
  cue.on('project:semantic-progress', progress => {
    const el = $('#project-semantic-status');
    const percent = Number.isFinite(progress.percent) ? progress.percent : progress.total ? progress.received / progress.total * 100 : null;
    const phase = { resolve: '正在核对模型版本', verify: '正在校验本地模型', download: '正在下载模型', indexing: '正在建立本地语义索引', ready: '本地语义检索已就绪' }[progress.phase] || '正在准备本地语义检索';
    if (el) el.textContent = progress.message || `${phase}${progress.file ? ' · ' + progress.file : ''}${percent !== null ? `：${Math.round(percent)}%` : '…'}`;
  });

  function setProjectIndexBusy(busyState) {
    ['project-import-folder', 'project-import-zip', 'project-index-clear'].forEach((id) => {
      const button = document.getElementById(id);
      if (button) button.disabled = !!busyState || (id === 'project-index-clear' && !projectIndexState?.ready);
    });
  }

  async function refreshProjectIndexState() {
    if (!cue.projectIndexState) return;
    try {
      renderProjectIndexState(await cue.projectIndexState());
    } catch (error) {
      const status = document.getElementById('project-index-status');
      if (status) status.textContent = '无法读取本地项目索引。';
      cue.log('project index state failed: ' + (error?.message || error));
    }
  }

  async function importProjectIndex(kind) {
    if (!cue.projectImportFolder || !cue.projectImportZip) return;
    setProjectIndexBusy(true);
    showStatus('正在本地建立项目索引…大型仓库可能需要一些时间。');
    try {
      const result = kind === 'zip'
        ? await cue.projectImportZip()
        : await cue.projectImportFolder();
      if (!result || result.canceled) return;
      renderProjectIndexState(result.state);
      const state = result.state || {};
      showStatus(`项目索引已就绪：${state.fileCount || 0} 个文件，${state.chunkCount || 0} 个可检索片段。`);
    } catch (error) {
      showStatus('项目导入失败：' + (error?.message || String(error)));
    } finally {
      setProjectIndexBusy(false);
    }
  }

  async function clearProjectIndex() {
    if (!cue.projectIndexClear) return;
    setProjectIndexBusy(true);
    try {
      const result = await cue.projectIndexClear();
      renderProjectIndexState(result && result.state);
      showStatus('已清空本地项目索引。');
    } catch (error) {
      showStatus('无法清空项目索引：' + (error?.message || String(error)));
    } finally {
      setProjectIndexBusy(false);
    }
  }

  function ensureProjectIndexControls() {
    if (document.getElementById('project-index-controls')) return;
    const textarea = document.getElementById('project-knowledge');
    if (!textarea) return;

    const card = document.createElement('div');
    card.id = 'project-index-controls';
    card.className = 'whisper-card';
    card.innerHTML =
      '<label class="s-label">项目源码索引 <span class="s-hint">项目文档和源码的本地 RAG</span></label>' +
      '<div class="whisper-actions">' +
        '<button id="project-import-folder" class="s-action" type="button">导入文件夹…</button>' +
        '<button id="project-import-zip" class="s-action" type="button">导入 ZIP…</button>' +
        '<button id="project-index-clear" class="s-action danger" type="button" disabled>清空索引</button>' +
      '</div>' +
      '<div id="project-index-status" class="s-note">正在检查本地项目索引…</div>' +
      '<div class="whisper-actions"><button id="project-semantic-prepare" class="s-action" type="button">准备本地语义检索</button><button id="project-semantic-import" class="s-action" type="button">选择本地模型目录…</button></div>' +
      '<div id="project-semantic-status" class="s-note">本地语义检索未准备，仍可使用基础检索。</div>' +
      '<div class="s-note">会跳过 .env、私钥、凭据文件、node_modules、.git 和构建产物。回答时仅向所选模型发送与当前问题相关的检索片段。</div>';

    textarea.insertAdjacentElement('afterend', card);
    document.getElementById('project-import-folder')?.addEventListener('click', () => void importProjectIndex('folder'));
    document.getElementById('project-import-zip')?.addEventListener('click', () => void importProjectIndex('zip'));
    document.getElementById('project-index-clear')?.addEventListener('click', () => void clearProjectIndex());
    $('#project-semantic-prepare').addEventListener('click', () => void prepareSemantic(false));
    $('#project-semantic-import').addEventListener('click', () => void prepareSemantic(true));
    cue.projectSemanticState?.().then(renderSemanticState).catch(() => {});
  }

  function fillSettings() {
    $('#context-window-tokens').value = settings.contextWindowTokens || 16384;
    // Keys tab
    document.querySelectorAll('#provider-seg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
    $('#key-openai').value = settings.apiKeys.openai || '';
    $('#key-anthropic').value = settings.apiKeys.anthropic || '';
    $('#key-gemini').value = settings.apiKeys.gemini || '';
    $('#key-deepgram').value = settings.apiKeys.deepgram || '';
    $('#key-custom').value = settings.apiKeys.custom || '';
    $('#base-url').value = settings.baseUrl || '';
    updateCustomProviderFields();
    $('#key-ollama').value = settings.apiKeys.ollama || '';
    $('#key-groq').value = settings.apiKeys.groq || '';
    $('#key-minimax').value = settings.apiKeys.minimax || '';
    document.querySelectorAll('#minimax-region-seg button').forEach((b) => b.classList.toggle('on', b.dataset.region === (settings.minimaxRegion || 'global_en')));
    $('#key-azure').value = settings.apiKeys.azure || '';
    $('#azure-endpoint').value = settings.azureEndpoint || '';
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    fillAppLinkCallers();
    $('#s-status').textContent = statusText();
    // Transcription tab
    document.querySelectorAll('#stt-provider-seg button').forEach((button) => {
      button.classList.toggle('on', button.dataset.sttProvider === (settings.sttProvider || 'auto'));
    });
    $('#cloud-stt-language').value = settings.sttLanguage || 'auto';
    const localWhisper = settings.localWhisper || { modelId: 'small', language: 'zh', threads: 0 };
    $('#whisper-language').value = localWhisper.language || 'zh';
    $('#whisper-threads').value = Number(localWhisper.threads) || 0;
    fillQwenAsrSettings();
    // Profile tab
    $('#resume-text').value = settings.resumeText || '';
    $('#project-knowledge').value = settings.projectKnowledge || '';
    $('#job-description').value = settings.jobDescription || '';
    // Interview Prep tab
    $('#star-stories').value = settings.starStories || '';
    $('#why-company').value = settings.whyCompany || '';
    $('#why-leaving').value = settings.whyLeaving || '';
    $('#work-style').value = settings.workStyle || '';
    // Style tab
    $('#ai-rules').value = settings.aiRules || '';
    updateAiRulesCounter();
    // Q&A tab
    $('#salary-target').value = settings.salaryTarget || '';
    $('#questions-to-ask').value = settings.questionsToAsk || '';
    ensureProjectIndexControls();
    void refreshProjectIndexState();
  }

  // Whoever cue has been told it may answer questions for. Empty is the normal
  // state — nothing appears here until something has asked and been allowed.
  async function fillAppLinkCallers() {
    const host = $('#applink-callers');
    if (!host || !cue.appLinkState) return;
    let state;
    try { state = await cue.appLinkState(); } catch (_) { return; }
    const callers = Object.entries((state && state.callers) || {});
    if (!callers.length) {
      host.innerHTML = '<div class="s-caller-empty">暂无程序申请访问。</div>';
      return;
    }
    host.innerHTML = '';
    for (const [id, scopes] of callers) {
      const allowed = Object.entries(scopes)
        .filter(([, record]) => record && record.decision === 'granted')
        .map(([scope]) => (scope === 'action' ? '允许控制' : '读取状态'));
      const name = (scopes.read && scopes.read.callerName) || (scopes.action && scopes.action.callerName) || id;

      const row = document.createElement('div');
      row.className = 's-caller';
      const label = document.createElement('span');
      label.textContent = name + ' — ' + (allowed.length ? allowed.join(' + ') : '未授权');
      label.title = id;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '移除授权';
      button.addEventListener('click', async () => {
        await cue.appLinkRevoke(id);
        fillAppLinkCallers();
      });
      row.append(label, button);
      host.append(row);
    }
  }

  const uploadResumeBtn = document.getElementById('upload-resume-btn');
  if (uploadResumeBtn) uploadResumeBtn.addEventListener('click', async () => {
    const res = await cue.pickProfileDocument();
    if (!res || res.canceled) return;
    if (res.error) { showStatus('简历导入失败：' + res.error); return; }
    $('#resume-text').value = res.text || '';
    showStatus('已导入 ' + res.fileName + '；点击“完成”保存。');
  });
  const uploadJdBtn = document.getElementById('upload-jd-btn');
  if (uploadJdBtn) uploadJdBtn.addEventListener('click', async () => {
    const res = await cue.pickProfileDocument();
    if (!res || res.canceled) return;
    if (res.error) { showStatus('岗位描述导入失败：' + res.error); return; }
    $('#job-description').value = res.text || '';
    showStatus('已导入 ' + res.fileName + '；点击“完成”保存。');
  });

  function statusText() {
    const k = settings.apiKeys;
    const labels = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepgram: 'Deepgram', custom: '自定义', ollama: 'Ollama', groq: 'Groq', minimax: 'MiniMax', azure: 'Azure AI Foundry' };
    const has = Object.keys(labels).filter((p) => k[p]).map((p) => labels[p]);
    // 'auto' walks the same fallback chain src/stt.js builds; an explicit choice
    // is reported as-is so the status line matches what will actually be used.
    const selectedSttProvider = settings.sttProvider || 'auto';
    const automaticStt = k.deepgram ? 'Deepgram（流式）' : (k.openai ? 'OpenAI Realtime' : (k.groq ? 'Groq Whisper' : (k.gemini ? 'Gemini（批量）' : '未配置')));
    const stt = selectedSttProvider === 'auto' ? automaticStt
      : ({ local: '本地 Whisper', qwen: 'Qwen ASR', ...labels }[selectedSttProvider] || selectedSttProvider);
    const ready = [
      settings.resumeText ? '✓ 简历' : null,
      settings.jobDescription ? '✓ 岗位描述' : null,
      settings.starStories ? '✓ 经历' : null,
      settings.salaryTarget ? '✓ 薪资' : null
    ].filter(Boolean);
    return `${labels[settings.provider] || settings.provider} · 语音识别：${stt}` + (ready.length ? ' · ' + ready.join(' · ') : '');
  }

  document.querySelectorAll('#provider-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.provider = b.dataset.provider;
    document.querySelectorAll('#provider-seg button').forEach((x) => x.classList.toggle('on', x === b));
    updateCustomProviderFields();
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    $('#s-status').textContent = statusText();
    updateSmartTooltip();
  }));
  document.querySelectorAll('#minimax-region-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.minimaxRegion = b.dataset.region;
    document.querySelectorAll('#minimax-region-seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  document.querySelectorAll('#stt-provider-seg button').forEach((button) => button.addEventListener('click', () => {
    settings.sttProvider = button.dataset.sttProvider;
    document.querySelectorAll('#stt-provider-seg button').forEach((candidate) => {
      candidate.classList.toggle('on', candidate === button);
    });
    $('#s-status').textContent = statusText();
  }));

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** unitIndex);
    return `${value >= 10 || unitIndex < 2 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function getSelectedWhisperModel() {
    if (!whisperOverview) return null;
    return whisperOverview.models.find((model) => model.id === $('#whisper-model').value) || null;
  }

  function renderWhisperModelState() {
    const model = getSelectedWhisperModel();
    if (!model) return;
    const language = model.englishOnly ? '仅英语' : '多语言';
    const recommendation = model.recommended ? ' · 默认推荐' : '';
    const partial = model.partialBytes > 0 && !model.installed
      ? ` · 已下载 ${formatBytes(model.partialBytes)}，可继续下载`
      : '';
    const quantization = model.quantization === 'Full precision' ? '全精度' : model.quantization;
    const tier = { Lightest: '资源占用极低', Light: '资源占用较低', Balanced: '均衡', Heavy: '资源占用较高', 'Very heavy': '资源占用很高' }[model.hardwareTier] || model.hardwareTier;
    $('#whisper-model-detail').textContent = `${formatBytes(model.bytes)} · ${language} · ${quantization} · ${tier}${recommendation}${partial}`;

    const progressWrap = $('#whisper-progress-wrap');
    const progressPercent = model.bytes > 0 ? Math.floor((model.partialBytes / model.bytes) * 100) : 0;
    progressWrap.classList.toggle('hidden', !model.downloading);
    $('#whisper-progress').value = progressPercent;
    $('#whisper-progress-label').textContent = `${progressPercent}%`;
    $('#whisper-download').disabled = model.installed || model.downloading;
    $('#whisper-download').textContent = model.installed ? '已安装' : (model.partialBytes ? '继续下载' : '下载');
    $('#whisper-cancel').classList.toggle('hidden', !model.downloading);
    $('#whisper-import').disabled = model.downloading;
    $('#whisper-delete').disabled = (model.installedBytes === 0 && model.partialBytes === 0) || model.downloading;
  }

  async function refreshWhisperModels() {
    const status = $('#whisper-status');
    try {
      const previousSelection = $('#whisper-model').value || settings.localWhisper?.modelId || 'small';
      whisperOverview = await cue.whisperModels();
      const runtimeBadge = $('#whisper-runtime-status');
      runtimeBadge.classList.toggle('ready', whisperOverview.runtime.available);
      runtimeBadge.classList.toggle('error', !whisperOverview.runtime.available);
      runtimeBadge.textContent = whisperOverview.runtime.available
        ? `已就绪 · v${whisperOverview.runtime.version} · ${whisperOverview.runtime.target}`
        : '未准备';
      runtimeBadge.title = whisperOverview.runtime.message || '';

      const select = $('#whisper-model');
      select.innerHTML = '';
      for (const model of whisperOverview.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.label} — ${formatBytes(model.bytes)}${model.recommended ? '（推荐）' : ''}${model.installed ? ' ✓' : ''}`;
        select.appendChild(option);
      }
      const selectionExists = whisperOverview.models.some((model) => model.id === previousSelection);
      select.value = selectionExists ? previousSelection : 'small';
      if (!settings.localWhisper) settings.localWhisper = {};
      settings.localWhisper.modelId = select.value;
      status.textContent = whisperOverview.runtime.available
        ? '模型文件通过校验后才能加载。'
        : whisperOverview.runtime.message;
      renderWhisperModelState();
    } catch (error) {
      status.textContent = `无法加载本地模型信息：${error.message}`;
    }
  }

  $('#whisper-model').addEventListener('change', () => {
    if (!settings.localWhisper) settings.localWhisper = {};
    settings.localWhisper.modelId = $('#whisper-model').value;
    renderWhisperModelState();
  });

$('#whisper-download').addEventListener(
  'click',
  async () => {
    cue.log(
      'whisper download button clicked'
    );

    const model =
      getSelectedWhisperModel();

    if (!model) {
      cue.log(
        'whisper download aborted: no selected model'
      );

      $('#whisper-status').textContent =
        '请先选择 Whisper 模型。';

      return;
    }

    cue.log(
      'whisper download requested: ' +
      model.id
    );

    model.downloading = true;
    renderWhisperModelState();

    $('#whisper-status').textContent =
      `正在连接模型服务器，准备下载 ${model.id}…`;

    try {
      await cue.whisperModelDownload(
        model.id
      );

      $('#whisper-status').textContent =
        `${model.id} 已下载并通过校验。`;

    } catch (error) {
      const message =
        error?.message ||
        String(error);

      cue.log(
        'whisper download failed: ' +
        message
      );

      $('#whisper-status').textContent =
        (error?.name === 'AbortError' || /cancelled|已取消/.test(message))
          ? `${model.id} 下载已暂停，进度已保留。`
          : `下载失败：${message}`;

    } finally {
      await refreshWhisperModels();
    }
  }
);

  $('#whisper-cancel').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (model) await cue.whisperModelCancel(model.id);
  });

  $('#whisper-import').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model) return;
    $('#whisper-status').textContent = `正在校验导入的 ${model.id}…`;
    try {
      const result = await cue.whisperModelImport(model.id);
      $('#whisper-status').textContent = result.cancelled ? '已取消导入。' : `${model.id} 已导入并通过校验。`;
    } catch (error) {
      $('#whisper-status').textContent = `导入失败：${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  $('#whisper-delete').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model || !window.confirm(`从本机删除 ${model.id} 模型（${formatBytes(model.bytes)}）？`)) return;
    try {
      await cue.whisperModelDelete(model.id);
      $('#whisper-status').textContent = `已删除 ${model.id}。`;
    } catch (error) {
      $('#whisper-status').textContent = `删除失败：${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

cue.on(
  'whisper:download-progress',
  (progress) => {
    if (!whisperOverview) {
      return;
    }

    const model =
      whisperOverview.models.find(
        (candidate) =>
          candidate.id ===
          progress.modelId
      );

    if (!model) {
      return;
    }

    model.partialBytes =
      progress.receivedBytes;

    model.downloading = true;

    if (
      $('#whisper-model').value ===
      progress.modelId
    ) {
      $('#whisper-progress-wrap')
        .classList
        .remove('hidden');

      $('#whisper-progress').value =
        progress.percent;

      $('#whisper-progress-label')
        .textContent =
        `${progress.percent}%`;

      if (progress.retrying) {
        $('#whisper-status').textContent =
          `连接中断，正在重试下载…`;
      } else {
        $('#whisper-status').textContent =
          `正在下载 ${progress.modelId}… ${progress.percent}%`;
      }

      $('#whisper-model-detail')
        .textContent =
        `${formatBytes(progress.receivedBytes)} ` +
        `/ ${formatBytes(progress.totalBytes)}`;
    }
  }
);
  cue.on('whisper:models-changed', () => refreshWhisperModels());

  async function saveSettings() {
    // Keys
    settings.apiKeys.openai = $('#key-openai').value.trim();
    settings.apiKeys.anthropic = $('#key-anthropic').value.trim();
    settings.apiKeys.gemini = $('#key-gemini').value.trim();
    settings.apiKeys.deepgram = $('#key-deepgram').value.trim();
    settings.apiKeys.custom = $('#key-custom').value.trim();
    settings.baseUrl = $('#base-url').value.trim();
    settings.apiKeys.ollama = $('#key-ollama').value.trim();
    settings.apiKeys.groq = $('#key-groq').value.trim();
    settings.apiKeys.minimax = $('#key-minimax').value.trim();
    settings.apiKeys.azure = $('#key-azure').value.trim();
    settings.azureEndpoint = $('#azure-endpoint').value.trim();
    if (!settings.models[settings.provider]) settings.models[settings.provider] = {};
    settings.models[settings.provider].fast = $('#model-fast').value.trim();
    settings.models[settings.provider].smart = $('#model-smart').value.trim();
    settings.contextWindowTokens = Math.max(1024, Math.min(2000000, Number($('#context-window-tokens').value) || 16384));
    // Transcription
    settings.sttLanguage = $('#cloud-stt-language').value || 'auto';
    if (!settings.localWhisper) settings.localWhisper = {};
    settings.localWhisper.modelId = $('#whisper-model').value || settings.localWhisper.modelId || 'base.en';
    settings.localWhisper.language = $('#whisper-language').value || 'auto';
    settings.localWhisper.threads = Math.max(0, Math.min(64, Number.parseInt($('#whisper-threads').value, 10) || 0));
    saveQwenAsrSettings();
    // Profile
    settings.resumeText = $('#resume-text').value.trim();
    settings.projectKnowledge = $('#project-knowledge').value.trim();
    settings.jobDescription = $('#job-description').value.trim();
    // Interview Prep
    settings.starStories = $('#star-stories').value.trim();
    settings.whyCompany = $('#why-company').value.trim();
    settings.whyLeaving = $('#why-leaving').value.trim();
    settings.workStyle = $('#work-style').value.trim();
    // Style tab
    settings.aiRules = $('#ai-rules').value.trim();
    // Q&A
    settings.salaryTarget = $('#salary-target').value.trim();
    settings.questionsToAsk = $('#questions-to-ask').value.trim();
    try {
      settings = await cue.settingsSet(settings);
      $('#s-status').textContent = statusText();
      updateSmartTooltip();
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      $('#s-status').textContent = message;
      $('#base-url').focus();
      return false;
    }
  }

  // ---- first screen guidance ---------------------------------------------
  function showWelcome() {
    clearMessages();
    const ai = document.createElement('div');
    ai.className = 'ai-text';
    ai.textContent = '“如何回答”结合面试官问题组织答案；“屏幕与问题”结合当前代码与要求；“截屏”解决屏幕题；“反问”生成面试反问。';
    messages.appendChild(ai);
  }

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      !scrim.classList.contains('hidden')
    ) {
      e.preventDefault();
      void closeSettings();
    }

    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === ','
    ) {
      e.preventDefault();
      void openSettings();
    }
  });

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;

  function setIgnore(v) {
    if (v !== ignoring) {
      ignoring = v;
      cue.setIgnoreMouse(v);
    }
  }

  // Windows / macOS 支持 ignored window 的 forwarded mousemove。
  // 其他平台如果一开始就 setIgnore(true)，可能导致整个 UI 永久无法点击。
  const supportsForwardedMouseMove = isWindows || isMac;

  if (supportsForwardedMouseMove) {
    document.addEventListener('mousemove', (e) => {
      const el = document.elementFromPoint(
        e.clientX,
        e.clientY
      );

      const overUI = !!(
        el &&
        el.closest &&
        el.closest(
          '#toolbar, #panel-wrap, #transcript-sidebar, #settings-scrim, #onboard-scrim, #consent-scrim'
        )
      );

      setIgnore(!overUI);
    });

    // 默认空白区域鼠标穿透；
    // 鼠标移动到 cue UI 上时重新允许点击。
    setIgnore(true);
  } else {
    setIgnore(false);
  }
  // ---- assistant access request ------------------------------------------
  // Shown here rather than as a native dialog because cue hides its dock icon:
  // an OS panel from an accessory app never comes forward and cannot be
  // clicked. Note the scrim is registered in the click-through selector above
  // and in styles.css — without both, this window stays transparent to the
  // mouse and the buttons do nothing.
  const consentScrim = $('#consent-scrim');
  let pendingConsentId = null;

  function answerConsent(allowed) {
    if (!pendingConsentId) return;
    cue.appLinkConsentRespond(pendingConsentId, allowed);
    pendingConsentId = null;
    consentScrim.classList.add('hidden');
  }

  cue.on('applink:consent-request', (request) => {
    pendingConsentId = request.id;
    $('#cs-title').textContent = request.message;
    $('#cs-body').textContent = request.detail;
    $('#cs-allow').textContent = request.allowLabel;
    consentScrim.classList.remove('hidden');
    // Do not wait for a mousemove to turn the mouse back on: the pointer may
    // already be still, and the sheet would be unclickable until it moved.
    setIgnore(false);
    $('#cs-deny').focus();
  });

  $('#cs-allow').addEventListener('click', () => answerConsent(true));
  $('#cs-deny').addEventListener('click', () => answerConsent(false));
  // Anything other than a deliberate Allow is a no, including Escape and
  // clicking away.
  consentScrim.addEventListener('click', (e) => { if (e.target === consentScrim) answerConsent(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pendingConsentId) { e.preventDefault(); answerConsent(false); }
  });

  // ---- onboarding / first-run tutorial -----------------------------------
  const obScrim = $('#onboard-scrim');
  const permissionHelp = isWindows
    ? 'Cue 需要访问屏幕和语音。请打开 Windows 隐私和安全性设置，允许 Cue 使用<strong>麦克风</strong>与<strong>屏幕录制</strong>，然后返回这里。'
    : 'Cue 需要两项 macOS 权限。依次点击下面的按钮，在系统设置中开启 <strong>Cue</strong> 的权限，然后返回这里。';
  const permissionButtons = isWindows
    ? [
        { permission: 'microphone', label: '打开麦克风设置', action: () => cue.openPane('ms-settings:privacy-microphone') },
        { permission: 'screen', label: '打开屏幕录制设置', action: () => cue.openPane('ms-settings:privacy-screenrecorder') }
      ]
    : [
        { permission: 'microphone', label: '打开麦克风设置', action: () => cue.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone') },
        { permission: 'screen', label: '打开屏幕录制设置', action: () => cue.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') }
      ];
  const sayShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">↵</span>' : '<span class="kbd">⌘</span> <span class="kbd">↵</span>';
  const assistShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">⇧</span> <span class="kbd">↵</span>' : '<span class="kbd">⌘</span> <span class="kbd">⇧</span> <span class="kbd">↵</span>';
  const technicalShortcut = '<span class="kbd">' + (isMac ? '⌘' : 'Ctrl') + '</span> <span class="kbd">L</span>';
  const solveShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">H</span>' : '<span class="kbd">⌘</span> <span class="kbd">H</span>';
  const quitShortcut = isWindows ? '<span class="kbd">Ctrl</span><span class="kbd">⇧</span><span class="kbd">X</span>' : '<span class="kbd">⌘</span><span class="kbd">⇧</span><span class="kbd">X</span>';
  const OB_STEPS = [
    {
      icon: '👋',
      title: '欢迎使用 Cue',
      body: 'Cue 是悬浮在屏幕上的 AI 面试助手，可以<strong>读取屏幕</strong>、<strong>识别面试语音</strong>，辅助回答问题和修改代码。受系统与共享方式影响，通常可在屏幕共享中隐藏。<br><br>下面的引导将帮助你完成基本设置。'
    },
    {
      icon: '🔐',
      title: '授权屏幕与语音访问',
      body: permissionHelp + '<ul><li><strong>麦克风</strong>：识别你的语音</li><li><strong>屏幕录制</strong>：读取屏幕及系统音频</li></ul>',
      buttons: permissionButtons
    },
    {
      icon: '🔑',
      title: '配置模型服务',
      body: 'Cue 使用<strong>你自己的</strong> API 密钥。可选择 OpenAI、Anthropic、Google Gemini、Azure AI Foundry 或兼容服务，将密钥填入设置。<br><br><strong>语音识别：</strong>可选择 Qwen ASR、Deepgram、OpenAI、Gemini 或本地 Whisper；云端识别需配置相应密钥，流式服务适合实时面试。',
      buttons: [{ label: '打开 Cue 设置', action: () => { finishOnboard(); openSettings(); } }]
    },
    {
      icon: '🫥',
      title: 'Zoom 屏幕共享设置',
      body: 'Cue 通常可在 Google Meet、Teams 和 QuickTime 等屏幕共享中隐藏。<strong>Zoom 需要设置：</strong><br><br>Zoom → 设置 → 共享屏幕 → 高级 → <strong>屏幕捕获模式</strong>，选择<strong>“高级捕获（使用窗口过滤）”</strong>。英文界面对应 Advanced capture with window filtering。<br><br>不要选择“不使用窗口过滤”，该模式可能显示 Cue；共享前请检查效果。'
    },
    {
      icon: '✨',
      title: '设置完成',
      body: '使用 Cue：<ul><li>' + sayShortcut + ' 或点击<strong>如何回答</strong>，根据面试官问题和相关上下文组织口述答案</li><li>' + assistShortcut + ' 或点击<strong>屏幕与问题</strong>，根据屏幕与面试官要求修改代码或回答问题（Ctrl/Cmd+? 也可使用）</li><li>' + technicalShortcut + ' <strong>上下文解题</strong>，只根据面试官问题和相关上下文回答代码题、技术题，不截图</li><li>' + solveShortcut + ' 或点击<strong>截屏</strong>，解决屏幕上的技术题</li><li>点击<strong>反问</strong>，生成适合当前面试的反问</li><li>Ctrl/Cmd+R 或点击顶部 <strong>▢</strong> 开始/停止录音</li><li>Ctrl/Cmd+P 隐藏整个窗口（含顶部工具栏），再按一次恢复；录音和上下文保留</li><li>输入问题后按 <span class="kbd">↵</span> 发送</li></ul>点击 <strong>Cue 图标</strong>可重新打开指引。双击顶部 <strong>×</strong> 退出，或使用 ' + quitShortcut + '。'
    }
  ];
  let obIndex = 0;
  function renderOnboard() {
    const step = OB_STEPS[obIndex];
    $('#ob-icon').textContent = step.icon;
    $('#ob-title').textContent = step.title;
    $('#ob-body').innerHTML = step.body;
    const btns = $('#ob-buttons'); btns.innerHTML = '';
    (step.buttons || []).forEach((b) => { const el = document.createElement('button'); el.textContent = b.label; el.addEventListener('click', b.action); btns.appendChild(el); });
    const dots = $('#ob-dots'); dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => { const d = document.createElement('span'); if (i === obIndex) d.className = 'on'; dots.appendChild(d); });
    $('#ob-back').style.visibility = obIndex === 0 ? 'hidden' : 'visible';
    $('#ob-next').textContent = obIndex === OB_STEPS.length - 1 ? '完成' : '下一步';
    $('#ob-skip').style.visibility = obIndex === OB_STEPS.length - 1 ? 'hidden' : 'visible';
  }
  function showOnboard() { obIndex = 0; renderOnboard(); obScrim.classList.remove('hidden'); setIgnore(false); }
  async function finishOnboard() {
    obScrim.classList.add('hidden');
    if (settings && !settings.onboarded) { settings.onboarded = true; await cue.settingsSet({ onboarded: true }); }
  }
  $('#ob-next').addEventListener('click', () => { if (obIndex === OB_STEPS.length - 1) finishOnboard(); else { obIndex++; renderOnboard(); } });
  $('#ob-back').addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderOnboard(); } });
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#logo-btn').addEventListener('click', showOnboard);

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    settings = await cue.settingsGet();
    void refreshProjectIndexState();
    const platformInfo = await cue.platformInfo();

    // R4: shortcut hints
    const sayHintEl = document.getElementById('say-shortcut-hint');
    const assistHintEl = document.getElementById('assist-shortcut-hint');
    const codeHintEl = document.getElementById('code-shortcut-hint');
    if (sayHintEl) sayHintEl.textContent = isMac ? '⌘↵' : 'Ctrl+↵';
    if (assistHintEl) assistHintEl.textContent = isMac ? '⌘⇧↵' : 'Ctrl+⇧↵';
    if (codeHintEl) codeHintEl.textContent = isMac ? '⌘H' : 'Ctrl+H';

    // R6: smart tooltip
    updateSmartTooltip();
    // Fix 3: Adjust permission buttons based on actual Windows version.
    // ms-settings:privacy-screenrecorder only exists on Windows 11.
    // On Windows 10, screen capture needs no permission — so replace the button
    // with a more helpful note instead of an invalid settings link.
    if (isWindows && platformInfo.winBuild > 0 && platformInfo.winBuild < 22000) {
      // Windows 10: update the onboarding screen recording button to be more helpful
      const ob = OB_STEPS[1];
      ob.buttons = ob.buttons.filter((b) => b.permission !== 'screen');
      ob.body = 'Cue 需要麦克风权限才能识别你的语音。请点击下面的按钮打开 Windows 麦克风设置，允许 Cue 访问。<br><br><strong>Windows 10 可直接截取屏幕</strong>，无需单独授权屏幕录制。<ul><li><strong>麦克风</strong>：识别你的语音</li><li><strong>屏幕录制</strong>：Windows 10 默认可用</li></ul>';
    }

    smartBtn.classList.toggle('on', !!settings.smart);
    showWelcome();
    syncPlaceholder();
    updateHistoryBadge(); // FIX #3: Initialize badge on boot
    updateSendButtonState(); // Initialize send button state

    // Fix placeholder shortcut hint to match platform
    placeholder.innerHTML = '输入问题，或 <span class="keycap">' + (isMac ? '⌘' : 'Ctrl') + '</span><span class="keycap">⇧</span><span class="keycap">↵</span> 屏幕与问题';

    const st = await cue.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    $('#stop-btn').classList.toggle('active', st.active);
    if (!settings.onboarded) showOnboard();
  })();
})();
