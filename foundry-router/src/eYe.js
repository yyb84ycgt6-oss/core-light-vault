// eYe - the micro-orchestrator.
//
// Real parts: the battery/thermal gates, the stillness-aware Conscious
// Handshake, the weights digest W used in the twin key, and an audio front-end
// (AudioWorklet -> 16 kHz -> 40-band log-mel, the exact input a BC-ResNet KWS
// expects).
//
// Noted gap: there is no public, trained "Hey Jackie" BC-ResNet. If you train
// one (e.g. BC-ResNet-1, ~17 KB int8) and drop it at
// public/models/eye/bc-resnet-heyjackie.onnx (+ .json labels), it is used.
// Otherwise wake-word detection falls back to the Web Speech API, and the
// weights blob W is a deterministic seeded placeholder (marked as such).
import { mulberry32 } from './lib/collapse.js';
import { sha256Hex } from './longString.js';

export const EYE = Object.freeze({
  name: 'eYe',
  version: 1,
  kws: 'BC-ResNet-1 · "Hey Jackie"',
  designPower_mW: 0.03, // design target for a hardware KWS core, not measurable from a browser
  gates: { batteryPct: 15, thermalC: 70 },
  stillnessMs: 8000,
});

export const HANDSHAKE_TEXT =
  "My battery is running low. Before I rest, shall I compress your current session into a safe pod? Nothing will be lost - I'll hold the key until you return.";

export const KWS_MODEL_URL = '/models/eye/bc-resnet-heyjackie.onnx';
export const KWS_META_URL = '/models/eye/bc-resnet-heyjackie.json';
export const SAMPLE_RATE = 16000;
export const MEL = { nMels: 40, nFft: 512, win: 480, hop: 160 }; // 30 ms window, 10 ms hop -> 98 frames per second

/**
 * Gate evaluation. forceOffline routes to on-device WebLLM only; handshake
 * waits for stillness (no input for stillnessMs) so it never interrupts typing.
 */
export function evaluateGates(system = {}, { now = Date.now(), lastActivity = 0, dismissedUntil = 0, stillnessMs = EYE.stillnessMs } = {}) {
  const reasons = [];
  const lowBattery = typeof system.battery === 'number' && system.battery < EYE.gates.batteryPct && !system.charging;
  const hot = typeof system.thermal === 'number' && system.thermal > EYE.gates.thermalC;
  if (lowBattery) reasons.push(`battery ${system.battery}% < ${EYE.gates.batteryPct}%`);
  if (hot) reasons.push(`thermal ${system.thermal}°C > ${EYE.gates.thermalC}°C`);
  const still = now - lastActivity >= stillnessMs;
  return {
    forceOffline: lowBattery || hot,
    handshake: lowBattery && still && now >= dismissedUntil,
    waitingForStillness: lowBattery && !still,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Weights W (part of the twin key material)
// ---------------------------------------------------------------------------

function seededWeights() {
  const out = new Uint8Array(17 * 1024);
  out.set(new TextEncoder().encode('EYEW1\0\0\0'));
  const rand = mulberry32(0xe7e5ead1);
  for (let i = 8; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

let weightsPromise = null;

/** Load the orchestrator binary W: trained ONNX if present, else the seeded placeholder. */
export function loadMicroOrchestrator() {
  if (!weightsPromise) {
    weightsPromise = (async () => {
      let bytes = null;
      let source = 'seeded-placeholder';
      try {
        const res = await fetch(KWS_MODEL_URL, { cache: 'no-cache' });
        const type = res.headers.get('content-type') || '';
        if (res.ok && !type.includes('text/html')) {
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.length > 0) {
            bytes = buf;
            source = 'onnx';
          }
        }
      } catch {
        /* offline or not present */
      }
      if (!bytes) bytes = seededWeights();
      return { bytes, source, sizeKB: +(bytes.length / 1024).toFixed(1), digest: await sha256Hex(bytes) };
    })();
  }
  return weightsPromise;
}

/** Resident working set of the spotter: weights + int16 1 s ring + mel tile + FFT scratch. */
export function residentKB(weightsBytes) {
  const ring = SAMPLE_RATE * 2;
  const frames = 1 + Math.floor((SAMPLE_RATE - MEL.win) / MEL.hop);
  const mel = frames * MEL.nMels * 4;
  const fft = MEL.nFft * 2 * 8;
  return +((weightsBytes + ring + mel + fft) / 1024).toFixed(1);
}

/** The (eYe) first segment of the long string. */
export function eyeDescriptor(w) {
  return {
    name: EYE.name,
    version: EYE.version,
    kws: EYE.kws,
    weightsSource: w.source,
    sizeKB: w.sizeKB,
    residentKB: residentKB(w.bytes.length),
    weightsDigest: w.digest,
    gates: EYE.gates,
    designPower_mW: EYE.designPower_mW,
  };
}

// ---------------------------------------------------------------------------
// DSP: log-mel spectrogram (BC-ResNet input)
// ---------------------------------------------------------------------------

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const hzToMel = (f) => 2595 * Math.log10(1 + f / 700);
const melToHz = (m) => 700 * (10 ** (m / 2595) - 1);

export function melFilterbank(nMels = MEL.nMels, nFft = MEL.nFft, sr = SAMPLE_RATE, fMin = 20, fMax = sr / 2) {
  const bins = nFft / 2 + 1;
  const mMin = hzToMel(fMin);
  const mMax = hzToMel(fMax);
  const pts = Array.from({ length: nMels + 2 }, (_, i) => melToHz(mMin + ((mMax - mMin) * i) / (nMels + 1)));
  const binHz = sr / nFft;
  const fb = Array.from({ length: nMels }, () => new Float32Array(bins));
  for (let m = 0; m < nMels; m++) {
    const [l, c, r] = [pts[m], pts[m + 1], pts[m + 2]];
    for (let k = 0; k < bins; k++) {
      const f = k * binHz;
      if (f > l && f < r) fb[m][k] = f <= c ? (f - l) / (c - l) : (r - f) / (r - c);
    }
  }
  return fb;
}

let cachedFb = null;
let cachedWindow = null;

/** Returns Float32Array [frames * nMels] of log-mel energies, row = frame. */
export function logMelSpectrogram(samples, { nMels = MEL.nMels, nFft = MEL.nFft, win = MEL.win, hop = MEL.hop } = {}) {
  if (!cachedFb || cachedFb.length !== nMels) cachedFb = melFilterbank(nMels, nFft);
  if (!cachedWindow || cachedWindow.length !== win)
    cachedWindow = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1)));
  const frames = samples.length < win ? 0 : 1 + Math.floor((samples.length - win) / hop);
  const out = new Float32Array(frames * nMels);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const bins = nFft / 2 + 1;
  for (let f = 0; f < frames; f++) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win; i++) re[i] = samples[f * hop + i] * cachedWindow[i];
    fftInPlace(re, im);
    for (let m = 0; m < nMels; m++) {
      const w = cachedFb[m];
      let e = 0;
      for (let k = 0; k < bins; k++) if (w[k]) e += w[k] * (re[k] * re[k] + im[k] * im[k]);
      out[f * nMels + m] = Math.log(e + 1e-6);
    }
  }
  return { data: out, frames, nMels };
}

// ---------------------------------------------------------------------------
// Keyword spotter ("Hey Jackie")
// ---------------------------------------------------------------------------

const WAKE_RE = /\bhey,?\s*(jackie|jacky|jacqui|jackey|jakey|jaki)\b/i;

const TAP_WORKLET = `
class EyeTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('eye-tap', EyeTap);
`;

export class KeywordSpotter {
  constructor({ onWake = () => {}, onLevel = () => {}, onStatus = () => {}, threshold = 0.85 } = {}) {
    Object.assign(this, { onWake, onLevel, onStatus, threshold });
    this.mode = 'off';
    this.running = false;
    this.ring = new Int16Array(SAMPLE_RATE);
    this.ringPos = 0;
    this.lastWake = 0;
  }

  async start() {
    if (this.running) return this.mode;
    this.running = true;
    if (await this.#tryOnnx()) return this.mode;
    if (this.#tryWebSpeech()) return this.mode;
    await this.#openMic(null);
    this.#setMode('vad-only');
    return this.mode;
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.recognition?.abort?.();
    this.recognition = null;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.ctx = this.node = this.stream = null;
    this.#setMode('off');
  }

  #setMode(mode, detail = '') {
    this.mode = mode;
    this.onStatus({ mode, detail });
  }

  #wake(source, score) {
    const now = Date.now();
    if (now - this.lastWake < 2000) return;
    this.lastWake = now;
    this.onWake({ source, score, at: now });
  }

  async #tryOnnx() {
    try {
      const head = await fetch(KWS_META_URL, { cache: 'no-cache' });
      if (!head.ok || (head.headers.get('content-type') || '').includes('text/html')) return false;
      const meta = await head.json();
      const w = await loadMicroOrchestrator();
      if (w.source !== 'onnx') return false;
      const { loadOrt } = await import('./lib/embedder.js');
      const ort = await loadOrt();
      this.session = await ort.InferenceSession.create(w.bytes, { executionProviders: ['wasm'] });
      this.ort = ort;
      this.meta = { labels: meta.labels || ['_background_', 'hey_jackie'], wake: meta.wakeLabel || 'hey_jackie', layout: meta.layout || 'NCHW_mel_time' };
      await this.#openMic(() => this.#inferOnnx());
      this.#setMode('onnx-kws', `${w.sizeKB} KB BC-ResNet`);
      return true;
    } catch {
      return false;
    }
  }

  #tryWebSpeech() {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!SR) return false;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (WAKE_RE.test(text)) this.#wake('web-speech', e.results[i][0].confidence || 1);
      }
    };
    rec.onerror = (e) => this.#setMode('web-speech', `error: ${e.error}`);
    rec.onend = () => {
      if (this.running && this.recognition === rec) {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      return false;
    }
    this.#setMode('web-speech', 'platform speech service (may leave the device)');
    return true;
  }

  async #openMic(onTick) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new AC();
    const url = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'eye-tap');
    const ratio = this.ctx.sampleRate / SAMPLE_RATE;
    let phase = 0;
    this.node.port.onmessage = ({ data }) => {
      let sum = 0;
      let n = 0;
      // Linear-interpolating decimation to 16 kHz into the int16 ring.
      for (; phase < data.length - 1; phase += ratio, n++) {
        const i = Math.floor(phase);
        const v = data[i] + (data[i + 1] - data[i]) * (phase - i);
        this.ring[this.ringPos] = Math.max(-32768, Math.min(32767, v * 32767));
        this.ringPos = (this.ringPos + 1) % this.ring.length;
        sum += v * v;
      }
      phase = Math.max(0, phase - data.length);
      this.onLevel(Math.sqrt(sum / Math.max(1, n)));
    };
    src.connect(this.node);
    if (onTick) this.timer = setInterval(onTick, 250);
  }

  #window() {
    const out = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < SAMPLE_RATE; i++) out[i] = this.ring[(this.ringPos + i) % SAMPLE_RATE] / 32768;
    return out;
  }

  async #inferOnnx() {
    if (this.busy || !this.session) return;
    this.busy = true;
    try {
      const { data, frames, nMels } = logMelSpectrogram(this.#window());
      // Model expects [1, 1, mel, time].
      const t = new Float32Array(nMels * frames);
      for (let f = 0; f < frames; f++) for (let m = 0; m < nMels; m++) t[m * frames + f] = data[f * nMels + m];
      const input = new this.ort.Tensor('float32', t, [1, 1, nMels, frames]);
      const out = await this.session.run({ [this.session.inputNames[0]]: input });
      const logits = Array.from(out[this.session.outputNames[0]].data);
      const max = Math.max(...logits);
      const exps = logits.map((l) => Math.exp(l - max));
      const sum = exps.reduce((a, b) => a + b, 0);
      const p = exps[this.meta.labels.indexOf(this.meta.wake)] / sum;
      if (p >= this.threshold) this.#wake('onnx-kws', p);
    } finally {
      this.busy = false;
    }
  }
}
