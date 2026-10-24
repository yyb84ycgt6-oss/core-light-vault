# iPhone Runner ⇄ Foundry Router contract

Two projects, built by two sessions:

| | Owns | Status |
|---|---|---|
| **Foundry Router** (session 1) | `foundry-router/` (this PR) | Router side done: provider `runner`, chip *Llama 3.2 3B · iPhone Runner*, base-URL field in the Key vault, Asset Store *Companion runner* card with a live **Test connection**. |
| **iPhone Runner** (session 2) | its own project (`/llama-3b-iphone12-runner/`) | SwiftUI + llama.cpp + Metal, serves the API below. |

Neither side edits the other's files. If the runner needs something from the Router, change this
document and ask session 1.

## 1. HTTP API (base URL ends in `/v1`, default `http://localhost:8080/v1`)

**`GET /v1/models`** → `200`
```json
{ "object": "list", "data": [{ "id": "llama-3.2-3b-instruct", "object": "model" }] }
```
Return the id of whatever is actually loaded. The Router shows it under *Check models* and *Test connection*.

**`POST /v1/chat/completions`**. The Router always sends:
```json
{ "model": "llama-3.2-3b-instruct", "stream": true, "temperature": 0.7, "max_tokens": 1024,
  "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "…" }] }
```
* `model` may be ignored (serve the loaded model).
* Respond `200`, `Content-Type: text/event-stream`, one OpenAI chunk per event, then `[DONE]`:
  ```
  data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}

  data: {"object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

  data: [DONE]

  ```
* Flush after every token (no response buffering). A non-streamed `application/json` completion is also accepted.
* Errors are JSON `{"error":{"message":"…"}}`:
  * `503` + `Retry-After: <s>` while the model is loading or busy: the Router retries (500 ms·2^n, twice), then fails over.
  * `400`/`404` whose message mentions the model: the Router re-reads `/v1/models` and retries with the listed id.
  * Mid-stream failure: emit `data: {"error":{"message":"…"}}` and close. Once tokens have streamed, the Router stops; it never splices another provider's answer onto yours.

`llama-server` from llama.cpp (`--host 0.0.0.0 --port 8080`) already speaks this. A custom Swift
server around the llama.cpp library must match it.

## 2. CORS (required: the Router is a web page)

On every response, errors included, and on `OPTIONS` preflights (reply `204`):
```
Access-Control-Allow-Origin: <the Router's origin, or *>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, ngrok-skip-browser-warning
Access-Control-Allow-Private-Network: true
Access-Control-Max-Age: 600
```
Without these the browser blocks the call and the Router silently fails over to the next provider.

## 3. Reachability: pick one (this is the hard part on iOS)

The Router needs a **secure context** (https or localhost) for WebCrypto, OPFS and WebGPU, and an
https page **cannot** fetch `http://192.168.x.x` (mixed content; the Router warns when you set such a URL).

1. **Recommended: the runner hosts the Router.** Bundle `foundry-router/dist`, serve it from the same
   local server, and show it in a `WKWebView` at `http://localhost:8080/`. That gives one origin (no CORS),
   localhost is a secure context, and one app runs both halves so iOS never suspends the server under the UI.
   Set the Router's base URL to `http://localhost:8080/v1`.
2. **Router in Safari on the same iPhone, runner in the background.** `http://localhost:8080/v1` passes
   the mixed-content rule, but iOS suspends a backgrounded app within seconds and the server dies. Only
   viable with real background execution; don't rely on it.
3. **Router on the workstation, runner on the iPhone.** Open the Router at `http://localhost:5173`
   (a secure context) and set the base URL to `http://<iphone-ip>:8080/v1`. Needs the CORS headers above.
4. **Runner serves HTTPS** with a certificate the browser trusts (mkcert root installed as a profile):
   `https://<iphone-ip>:8443/v1` works from any https Router.

While serving, keep the screen awake (`UIApplication.shared.isIdleTimerDisabled = true`).

## 4. Memory on iPhone 12 (A14, 4 GB)

| Model | GGUF | KV cache (f16) | Fit |
|---|---|---|---|
| Llama 3.2 3B Instruct Q4_K_M | 2.02 GB (`bartowski/Llama-3.2-3B-Instruct-GGUF`) | 112 KB/token → 224 MB @ 2k ctx | tight |
| Llama 3.2 1B Instruct Q4_K_M | 0.81 GB (`bartowski/Llama-3.2-1B-Instruct-GGUF`) | 32 KB/token → 64 MB @ 2k ctx | comfortable |

(3B: 28 layers × 8 KV heads × 128 dims × K+V × 2 bytes. 1B: 16 × 8 × 64 × 2 × 2.)
The 3B needs the `com.apple.developer.kernel.increased-memory-limit` entitlement, `mmap`ed weights,
`n_ctx` ≈ 2048, all layers on Metal, and a fallback to the 1B on a memory warning. The brief's
"~1.6 GB" for 3B Q4_K_M is low; the file is about 2.0 GB.

## 5. Acceptance checks (run from the workstation on the same LAN)

```sh
curl -s  http://<iphone-ip>:8080/v1/models
curl -N  http://<iphone-ip>:8080/v1/chat/completions -H 'Content-Type: application/json' \
     -d '{"model":"x","stream":true,"messages":[{"role":"user","content":"hi"}]}'
curl -si -X OPTIONS http://<iphone-ip>:8080/v1/chat/completions \
     -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: content-type'      # expect 204 + the CORS headers
```
Then in the Router: **Key vault → iPhone Runner base URL → Check models**, **Asset Store →
Companion runner → Test connection**, and chat on the **Llama 3.2 3B · iPhone Runner** chip.
The router side of this contract is covered by `test/router.test.js` (*iPhone Runner companion*).
