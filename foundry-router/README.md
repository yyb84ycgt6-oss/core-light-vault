# Meta Foundry Router v1

Offline-first sovereign router for the Godzilla workstation (RTX 3090, 128 GB) that also runs on an
iPhone 12 (A14, 4 GB) in Safari. **Conversation is the save:** the whole session seals into one
atomic long string:

```
_{Data}-{AI}-(eYe)-{qpdb}~{Encrypted_compressed}-{bdpq}-(eYe)-{AI}-{Data}_
```

Vite + React. No backend. Real WebCrypto, real `fetch` streaming, real OPFS and IndexedDB, real
WebGPU inference (WebLLM), real ONNX inference (onnxruntime-web). The few things that cannot be
real in a browser are listed under [Honest gaps](#honest-gaps).

## Install

```sh
cd foundry-router
npm install
ollama pull llama3.2                      # optional: local, unlimited
OLLAMA_ORIGINS="*" ollama serve           # let the browser call it (CORS)
ngrok http 11434                          # optional: reach Ollama from the iPhone
#   or: cloudflared tunnel --url http://localhost:11434
npm run dev                               # http://localhost:5173 (and your LAN IP)
```

Then paste keys into **Router → Key vault** (or copy `.env.example` to `.env.local` for local dev
only), put the ngrok / tunnel URL in *Ollama base URL*, or tap **WebLLM Offline** for no network at all.

On the iPhone: open the dev URL over HTTPS (WebCrypto, OPFS and WebGPU need a secure context;
an ngrok/Cloudflare tunnel to port 5173 works) and *Add to Home Screen*. A production build
(`npm run build`, any static host) registers a service worker so the shell works offline.

```sh
npm test          # 54 unit tests (node:test): codec, crypto, router, eYe, toolbox, data files
npm run build
npm run preview   # then: npm i -D playwright && npm run e2e   (37 checks at 390x844)
```

## iPhone Runner companion

A separate project (built in its own session) hosts Llama 3.2 3B/1B GGUF with llama.cpp + Metal on the
iPhone and serves the OpenAI-compatible API. The Router reaches it as provider `runner` (own chip,
own base-URL field, Asset Store *Test connection*). The interface both sides build against, including
CORS, the iOS mixed-content and backgrounding traps, and memory sizing, is in
[`docs/RUNNER_CONTRACT.md`](docs/RUNNER_CONTRACT.md).

## Free AI Router Fabric (fallback chain)

OpenAI-compatible `POST {baseUrl}/chat/completions` with `stream: true`; SSE `data:` lines are
parsed incrementally (chunk-split lines, CRLF, comments, `[DONE]`). Anthropic uses its native
`/messages` stream. Generated config: [`api_forge_config.json`](api_forge_config.json).

| # | Provider | Base URL | Default model | Free tier / note |
|---|---|---|---|---|
| 1 | Groq (LPU chip company, not Grok) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | 30 req/min |
| 2 | Cerebras | `https://api.cerebras.ai/v1` | `llama-3.3-70b` (heals to live model) | 14k req/day |
| 3 | Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | 1M tok/day; 1.5-flash is retired |
| 4 | OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3.3-70b-instruct:free` | 20 req/min, sends `HTTP-Referer` + `X-Title: Foundry Router` |
| 5 | Together | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo-Free` | $5 credit |
| 6 | Fireworks | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p1-8b-instruct` | $5 credit |
| 7 | DeepInfra | `https://api.deepinfra.com/v1/openai` | `meta-llama/Meta-Llama-3.1-8B-Instruct` | $5 credit |
| 8 | xAI (Grok, not Groq) | `https://api.x.ai/v1` | `grok-3-mini` | $5 credit |
| 9 | Anthropic | `https://api.anthropic.com/v1` | `claude-haiku-5-5` | $5 credit; claude-3-5-haiku is retired |
| 10 | OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | $5 credit |
| 11 | Ollama | `http://localhost:11434/v1` | `llama3.2` | unlimited, local or tunnelled |
| 12 | iPhone Runner | `http://localhost:8080/v1` | `llama-3.2-3b-instruct` | companion llama.cpp + Metal app, keyless; see [`docs/RUNNER_CONTRACT.md`](docs/RUNNER_CONTRACT.md) |
| 13 | Hugging Face | `https://router.huggingface.co/v1` | `meta-llama/Llama-3.1-8B-Instruct` | rate-limited; replaces api-inference |
| 14 | Mistral | `https://api.mistral.ai/v1` | `mistral-small-latest` | free experiment tier |
| 15 | Cohere | `https://api.cohere.ai/compatibility/v1` | `command-r7b-12-2024` | trial key |
| – | Anyscale | `https://api.endpoints.anyscale.com/v1` | – | shut down in 2024; listed, off by default |

Routing rules (all tested in `test/router.test.js`):

* **Backoff:** 429 / 5xx retry after `min(8 s, max(500 ms × 2^n, Retry-After))`, 2 retries, then fail over.
* **Fail over** on 401/403, network/CORS errors, exhausted retries, a full local request window
  (each provider's free rpm is enforced client-side), or no key.
* **Model drift heals itself:** a "model not found" triggers `GET /models` and the closest live
  model is used (`prefs` regexes per provider/chip). Use *Check models* in the vault to see what is live.
* **Never splices answers:** once tokens have streamed, a later failure stops instead of failing over.
* **eYe gates:** battery < 15 % or thermal > 70 °C forces the on-device WebLLM engine only.
* Every attempt / retry / heal / failover / success lands in the hash-chained **Transparency** log,
  and each assistant message carries its provider badge.
* **Meta AI Direct:** Meta AI has no public chat API. Embedded in a host page, the chip posts the
  prompt to `window.parent` (addressed to the parent's origin, never `*`); standalone it copies the
  prompt and opens meta.ai. Meta's Llama models stream in-app through the Llama chips and WebLLM.

Keys live in `localStorage` on this device and are only attached to their own provider's requests.
Browser CORS varies by provider and over time; a provider that blocks browser calls simply fails
over. Ollama needs `OLLAMA_ORIGINS`.

## The long string

| Segment | What is actually in it |
|---|---|
| `_` … `_` | Atomic bounds. Missing either → `BOUND_VIOLATION`. Whitespace (messenger line-wraps) is ignored. |
| `{Data}` first | **Public projection** of LIVE_STATE: system, canvas, jacky, model ids, pod ids, *counts* of chat/files, createdAt, future-lock. Chat text and file contents are only inside the ciphertext. |
| `{AI}` first | Router snapshot: chain, pinned chip, last provider badge. Never keys. |
| `(eYe)` first | eYe descriptor: weights digest W, sizes, gates. |
| `{qpdb}` | Y-Axis Collapse fingerprint of the chat, base-4 glyphs over {q,p,d,b}. |
| `~` | Portal: copying the string fires a 20 ms haptic. |
| `{Encrypted_compressed}` | LIVE_STATE → gzip → 16 KiB records → AES-GCM-256 each. Record nonce = random 12-byte IV ⊕ counter; AAD = SHA-256(header) ‖ index ‖ final-flag. Base64 records joined by `.`. |
| `{bdpq}` | `qpdb` mirrored (reversed). Must match → else `MIRROR_MISMATCH`. |
| `(eYe)` second | Twin key descriptor: device keyId, or PBKDF2 params + salt, biometric flag, nonce, `twinOf` = SHA-256 of the first (eYe). |
| `{AI}` second | Reconstruction map: AST-style outline of the state (types and counts, no content), `twinOf` the first {AI}. |
| `{Data}` second | The Data′ promise: header digest, GCM tag-chain digest, record count, byte counts, collapse stats. |

**Keys.** *Device* mode: `crypto.subtle.generateKey({name:'AES-GCM', length:256}, false, ['encrypt','decrypt'])`,
stored as a CryptoKey in IndexedDB. Non-extractable, so the string restores only in this browser profile.
*Passphrase* mode (portable): `K = PBKDF2-SHA256(W ‖ C ‖ B, salt, 2^20)`, non-extractable result,
where W is the eYe weights digest, C your passphrase, and B the optional WebAuthn PRF secret. W is public,
so **security rests on C** (plus B when PRF is available). The UI estimates passphrase entropy and refuses
anything under ~50 bits. "2^-256 without C" holds only if C has 256 bits of entropy.

**Restore is all-or-nothing:** bounds → structure → mirror → twins → header digest → future-lock →
biometric → key → stream-decrypt every record → tag-chain digest → size promise → schema validation.
Only then is the new state swapped in with one `setState`. Truncation, reordering, a flipped byte, an
edited public segment, or hostile KDF parameters (iterations capped at 2^24) all fail with a specific
code, and the session is untouched.

**Stream vs burst.** `bdpqStreamed()` is an async generator: decode one record, decrypt it, feed it to
a `DecompressionStream`, yield plaintext, so the working set is about 3 × 16 KiB regardless of size. Pod
Manager measures both modes on the same pod. In tests, a 300 KB session streams with a ~54 KB peak while
burst holds everything.

**Volatile Pods** (`/pods/vol-*.pod` in OPFS, IndexedDB fallback; 50 MB limit): magic, small header,
an *encrypted index* (file list, sizes, dotSaved, lock date), then length-prefixed records. **Mount**
decrypts only the index, so files list without decompressing the payload. **Release** streams records
straight from disk with `Blob.slice`. The future-lock date is inside the authenticated index.

## Y-Axis Collapse

`Y_k = PCA(cosSim(E(w_i), E(w_j)))`: up to 1000 word embeddings → eigen-decomposition of the
cosine-similarity (Gram) matrix via seeded subspace iteration + Rayleigh–Ritz → k axes → 8-bit
scalar quantisation per axis. Fingerprint = `6 + 8k + n·k` bytes (1000 words, k = 2 → 2,022 B).

Measured, not assumed. With the built-in offline hashed n-gram embedder on 1000 words of English:

| k | fingerprint | ratio vs float32 E | geometry retention |
|---|---|---|---|
| 1 | 1.0 KB | 1515:1 | 0.47 |
| 2 | 2.0 KB | 760:1 | 0.63 |
| 8 | 8.1 KB | 190:1 | 0.83 |
| 32 | 32 KB | 48:1 | 0.96 |

So "≈2 KB at ≥ 0.97 retention" does **not** hold for this embedder. The lab plots the full curve and
says which k reaches 0.97. Download bge-micro-v2 or all-MiniLM-L6-v2 in the Asset Store to rerun with
real semantic embeddings (onnxruntime-web + a built-in WordPiece tokenizer, in a worker).

## eYe

Real: battery/thermal gates; the **Conscious Handshake** (quarter-screen glow, appears only after
8 s of stillness, "Yes, pod it" seals a pod); the weights digest W; the audio front-end (AudioWorklet →
16 kHz int16 ring → 40-band log-mel, the BC-ResNet input); resident budget measured at ~72 KB.
See [`public/models/eye/README.md`](public/models/eye/README.md) to drop in a trained BC-ResNet.

## Asset Store

100 models ([`public/models/manifest.json`](public/models/manifest.json), generated by
`npm run build:manifest`): 20 ultra-tiny, 20 small, 30 medium, 30 balanced. Tier comes from the real
file size: green ≤ 100 MB (40), yellow ≤ 500 MB (37), orange ≤ 1 GB (8), red > 1 GB (15). Downloads are
real `fetch()` calls to `https://huggingface.co/{id}/resolve/main/{file}`, two at a time, with streamed
progress, written straight into OPFS (IndexedDB fallback). WebLLM entries load into the on-device engine.
**Initialize Downloads** queues the core 8, about 375 MB (SmolLM2-135M on WebLLM is ~270 MB of it).

Workstation: [`model_list.txt`](model_list.txt) has one `huggingface-cli download …` line per model
(newer huggingface_hub also accepts `hf download …`). Gated repos (Llama, Gemma, MobileLLM) need
`huggingface-cli login` and an accepted licence.

Repo IDs and sizes come from knowledge, not a live check: huggingface.co was unreachable from the
build machine. A wrong path shows as a clear 404 on that card.

## iPhone 12 notes

* 390×844 layout, safe-area insets, 44 px touch targets, no hover states, 16 px inputs (no zoom),
  `100dvh`, reduced-motion honoured. Verified with the e2e test at 390×844 @3×.
* Canvas DPR is capped at 1.5; the neutron star pauses off-screen and in background tabs (≈60 fps in tests).
* WebGPU needs Safari 26+. SmolLM2 picks the f16 build when `shader-f16` exists, else f32. Keep
  WebLLM models ≤ ~300 MB on a 4 GB phone.
* Safari exposes no Battery, deviceMemory, Compute Pressure or Vibration APIs: chips show "—" until
  you simulate in Battery Lab (tagged "sim"), and haptics use the iOS 18 `<input switch>` tick.
* OPFS writes use `createWritable()` (Safari 18.4+) or a worker with `createSyncAccessHandle()`.
* "CoreML" (yellow tier) means a native conversion would serve it best; a web page cannot call CoreML.

## Honest gaps

* No trained "Hey Jackie" BC-ResNet exists, so W is a seeded placeholder and wake-word detection uses
  the Web Speech API until you add one. 0.03 mW is a hardware design target, not measurable from JS.
* Thermal °C on Chrome is an estimate mapped from Compute Pressure states; there is no web temperature API.
* Future-lock is enforced by this client and bound into the authenticated data. Someone with the key and
  a modified client can ignore it (true time-lock needs an external beacon).
* The biometric gate is cryptographic only with the WebAuthn PRF extension; otherwise it is a
  user-verification gate.
* Corrections to the brief: OpenRouter's URL is `openrouter.ai/api/v1`; Anyscale Endpoints is gone;
  HF Inference API → `router.huggingface.co`; gemini-1.5-flash and claude-3-5-haiku are retired;
  "Florence-2-small" and "OLMo-300M" don't exist (Florence-2-base used, OLMo dropped); BLOOM excluded
  Russian from pretraining (XGLM covers it); many listed sizes were far below real file sizes.

## Layout

```
foundry-router/
  index.html  vite.config.js  package.json  .env.example  api_forge_config.json  model_list.txt
  public/  sw.js  manifest.webmanifest  favicon.svg  models/manifest.json  models/eye/README.md
  src/
    App.jsx  AppContext.js  main.jsx  styles.css
    longString.js        codec, keys, pods, Y-collapse wrapper
    router.js            providers, SSE, failover, backoff, model healing, Meta bridge
    eYe.js               gates, handshake, weights W, log-mel, keyword spotter
    lib/                 collapse (PCA/SVQ), embedder (hash + ONNX/WordPiece), webllm, vault,
                         downloads, biometric (WebAuthn PRF), system sensors, haptics, autosave
    storage/             idb.js, opfs.js, opfs.worker.js
    toolbox/             10 tools: scamDetector, codeAnalyzer (acorn AST), knowledgeMatrix,
                         podManager, fileSystem, neutronStar, prismRing, yAxisLab, batteryLab,
                         transparencyLog
    workers/             webllm.worker.js, collapse.worker.js
    components/          Header, RouterTab, ToolboxTab, AssetStoreTab, LongStringSheet, Handshake, tools/*
  docs/                  RUNNER_CONTRACT.md (iPhone Runner companion interface)
  scripts/               sync-config.mjs, build-manifest.mjs, e2e-smoke.mjs
  test/                  *.test.js
```
