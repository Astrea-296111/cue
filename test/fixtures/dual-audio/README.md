# Anonymous dual-channel audio

These are synthetic English voices generated locally with FFmpeg's Flite filter.
They contain no personal history or interview recording. Reproduce with:

```sh
ffmpeg -f lavfi -i "flite=text='How do you prevent duplicate task execution?':voice=slt" -ar 16000 -ac 1 -c:a pcm_s16le interviewer.wav
ffmpeg -f lavfi -i "flite=text='I said Kafka. I meant Rabbit M Q.':voice=awb" -ar 16000 -ac 1 -c:a pcm_s16le candidate.wav
ffmpeg -f lavfi -i "flite=text='How do you handle retries after a timeout?':voice=slt" -ar 16000 -ac 1 -c:a pcm_s16le followup.wav
```

`scripts/evaluate-audio-fixture.cjs` sends the bytes through the actual production
PCM IPC, VAD, cloud ASR adapter and speech ledger. It makes two real ASR
connections. The live workflow requires trusted main and keeps credentials out
of installation steps. This verifies the software path; physical microphones,
loopback devices, echo in real calls and Windows desktop capture remain separate
acceptance checks. Recognized text is retained to distinguish transcription
accuracy from correct channel/event wiring. Flite: https://github.com/festvox/flite

## Synthetic Mandarin scenario

`zh-scenario/01-context.wav`, `02-constraint.wav` and `03-question.wav` are
synthetic Mandarin produced with Debian eSpeak NG 1.52.0 (`cmn`, speed 150),
converted to mono 16 kHz PCM16 with FFmpeg. They contain only invented interview
material, not a user's speech. The expected text is recorded in
`scripts/evaluate-chinese-audio.cjs`. To reproduce each file, synthesize the
corresponding text with `espeak-ng -v cmn -s 150 -w /tmp/voice.wav 'TEXT'` and
convert it with `ffmpeg -i /tmp/voice.wav -ar 16000 -ac 1 -c:a pcm_s16le OUT.wav`.

`complete.wav` concatenates the three recordings with 0.8 seconds of silence
between them. Run **Real Mandarin scenario audio** on trusted main. It sends the
complete recording through real ASR and the production question resolver.
The report retains each recognition and target and separately checks that the
context, constraint and question terms were recognized and retained. It does
not call the text model, assert perfect transcription, or simulate physical
microphone/loopback behavior. A failure can reflect speech synthesis, ASR, VAD
or question buffering; inspect the separate fields rather than rewriting the
expected text to make it pass.

The workflow uses `QWEN_ASR_API_KEY` when present and otherwise the existing
`QWEN_API_KEY`. The credential must authorize Alibaba's streaming ASR service;
a key for a text-only gateway does not prove ASR access. `QWEN_ASR_MODEL` and
`QWEN_ASR_WEBSOCKET_URL` can override the production ASR model and endpoint.
Absent overrides, the runner uses the production model and the endpoint derived
from `QWEN_BASE_URL` (the normal China endpoint when that URL is a chat proxy).
The report retains the requested model; the served model and token usage remain
unknown because this ASR protocol does not provide them.

The encrypted private evaluation also supports `evaluation.audioFixture: true`.
It imports the private workspace normally, selects CAE through the normal
project setting, and sends interviewer/candidate/follow-up WAV bytes through
production ASR. Each recognized interviewer target invokes the actual Ctrl+Enter
shortcut and configured text model. The fixed run has two answers per provider,
no actor calls, and retains complete recognized events and model messages only
inside the encrypted report. It verifies the software path and does not measure
physical audio devices or screen pixels. Explicit mock mode uses labelled text
replay for wiring only and never claims real ASR or semantic quality.
