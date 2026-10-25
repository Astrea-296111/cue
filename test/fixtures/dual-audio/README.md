# Anonymous dual-channel audio

These are synthetic English voices generated locally with FFmpeg's Flite filter.
They contain no personal history or interview recording. Reproduce with:

```sh
ffmpeg -f lavfi -i "flite=text='How do you prevent duplicate task execution?':voice=slt" -ar 16000 -ac 1 -c:a pcm_s16le interviewer.wav
ffmpeg -f lavfi -i "flite=text='I said Kafka. I meant Rabbit M Q.':voice=awb" -ar 16000 -ac 1 -c:a pcm_s16le candidate.wav
```

`scripts/evaluate-audio-fixture.cjs` sends the bytes through the actual production
PCM IPC, VAD, cloud ASR adapter and speech ledger. It makes two real ASR
connections. The live workflow requires trusted main and keeps credentials out
of installation steps. This verifies the software path; physical microphones,
loopback devices, echo in real calls and Windows desktop capture remain separate
acceptance checks. Recognized text is retained to distinguish transcription
accuracy from correct channel/event wiring. Flite: https://github.com/festvox/flite

The workflow uses `QWEN_ASR_API_KEY` when present and otherwise the existing
`QWEN_API_KEY`. The credential must authorize Alibaba's streaming ASR service;
a key for a text-only gateway does not prove ASR access. `QWEN_ASR_MODEL` and
`QWEN_ASR_WEBSOCKET_URL` can override the production ASR model and endpoint.
Absent overrides, the runner uses the production model and the endpoint derived
from `QWEN_BASE_URL` (the normal China endpoint when that URL is a chat proxy).
The report retains the requested model; the served model and token usage remain
unknown because this ASR protocol does not provide them.
