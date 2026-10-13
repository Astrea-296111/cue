// What Iris is allowed to know about cue.
//
// Split out from applink.js so it can be tested without Electron, and because
// it is the file where a privacy mistake would actually happen. Everything
// else in the link is plumbing; this decides what leaves the process.
//
// The rule: **counts, never content.**
//
//   • The transcript is a recording of a conversation other people are part of
//     and did not agree to share. A turn count and a timestamp let Iris tell
//     "transcription is working" from "transcription is silently dead", which
//     is all it needs. The words never leave.
//   • The résumé is the user's own history, and its presence is the only
//     diagnostic fact about it.
//   • Whether an API key is set is a diagnosis. The key is a liability.

function describeState({ state, transcript, settings, sttDisabled, shortcuts, windowAlive }) {
  const keys = (settings && settings.apiKeys) || {};
  const turns = transcript || [];
  return {
    capturing: state.capturing,
    busy: state.busy,
    transcribing: { you: state.transcribing.you, them: state.transcribing.them },

    // The single most useful field here. When this is true cue looks alive and
    // silently is not, and until now nothing outside the process could see it.
    transcriptionDisabled: !!sttDisabled,

    transcriptTurns: turns.length,
    lastTurnAt: turns.length ? new Date(turns[turns.length - 1].ts).toISOString() : null,

    provider: settings.provider,
    smart: !!settings.smart,
    models: (settings.models && settings.models[settings.provider]) || null,
    hasKey: Object.fromEntries(Object.keys(keys).map((name) => [name, !!keys[name]])),
    hasResumeContext: !!(settings.resumeContext && settings.resumeContext.length),

    // A global shortcut another app registered first is a classic silent break:
    // the user presses the key, nothing happens, and cue never knew.
    shortcuts: shortcuts || {},

    windowAlive: !!windowAlive,
  };
}

/**
 * Word a consent sheet from what can be proven, not from what was claimed.
 *
 * On the Node transport cue cannot read the peer's credentials, so the caller's
 * name is a claim. A sheet that presents a claim as a fact is worse than no
 * sheet at all, so this returns the hedged wording unless the peer's code
 * signature was actually verified.
 */
function consentCopy(request) {
  const trusted = request.verification === 'code-signature';
  const who = trusted ? request.callerName : `一个自称“${request.callerName}”的程序`;
  const action = request.scope === 'action';

  return {
    trusted,
    message: action ? `${who}申请控制 Cue。` : `${who}申请读取 Cue 的运行状态。`,
    detail:
      (action
        ? '授权后，该程序可以开始或停止监听。'
        : '授权后，该程序可以读取 Cue 的状态、近期警告和错误；无法读取转写内容、简历或 API 密钥。') +
      (trusted
        ? '该程序的代码签名已验证。'
        : 'Cue 无法确认该程序的真实身份，同一账户下的其他程序也可能使用这个名称。') +
      '\n\n可随时在 Cue 设置中更改授权。',
    allowLabel: action ? '允许控制' : '允许读取',
  };
}

module.exports = { describeState, consentCopy };
