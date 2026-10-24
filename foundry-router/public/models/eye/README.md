# eYe wake-word model drop-in

No trained "Hey Jackie" BC-ResNet ships with Foundry Router (none exists publicly).
Train one and drop two files here; the eYe picks them up on next load.

| File | Contents |
|---|---|
| `bc-resnet-heyjackie.onnx` | BC-ResNet (e.g. BC-ResNet-1, ~17 KB int8). Input `[1, 1, 40, 98]` float32 log-mel (40 bands, 30 ms Hann window, 10 ms hop, 16 kHz, 1 s). Output: logits `[1, numLabels]`. |
| `bc-resnet-heyjackie.json` | `{ "labels": ["_background_", "hey_jackie"], "wakeLabel": "hey_jackie" }` |

The front-end that feeds it is `logMelSpectrogram()` in `src/eYe.js`. Train on features
computed the same way (40 mel, `log(energy + 1e-6)`, HTK mel scale, 20 Hz to 8 kHz).

The `.onnx` bytes also become **W** in the twin key `K = PBKDF2(W || C || B, 2^20)`.
Long strings record the digest of W they were sealed with, so adding a model later
does not orphan earlier passphrase-mode strings.

Without these files, wake-word detection falls back to the Web Speech API (which can
use the platform's speech service), and W is a deterministic 17 KB seeded placeholder.
