// Asset Store: micro -> macro, sized for an iPhone 12 (A14, 4 GB; Safari
// tabs get roughly 1.5 GB). Sizes are the real file sizes of the listed files.
export const ASSETS = [
  { id: 'eye-core', name: 'eYe Core', ram: '60 kB', disk: '0.1 MB', use: 'Micro orchestrator (L2-class budget)', status: 'included' },
  { id: 'eye-visualizer', name: 'eYe Visualizer', ram: '120 kB', disk: '0.5 MB', use: 'Code pathway (acorn AST)', status: 'included' },
  {
    id: 'embedding-mini',
    name: 'Embedding Mini (all-MiniLM-L6-v2 Q8)',
    ram: '~40 MB',
    disk: '23 MB',
    use: 'Semantic search for the Living Archive',
    files: [
      { repo: 'Xenova/all-MiniLM-L6-v2', file: 'onnx/model_quantized.onnx', mb: 23 },
      { repo: 'Xenova/all-MiniLM-L6-v2', file: 'tokenizer.json', mb: 0.7 },
    ],
    runtime: 'ONNX runtime not bundled in v0.1: the archive uses its built-in hashed 32-d vectors until wired.',
  },
  {
    id: 'whisper-tiny',
    name: 'Whisper Tiny (Q8)',
    ram: '~120 MB',
    disk: '40 MB',
    use: 'Voice to pod',
    files: [
      { repo: 'Xenova/whisper-tiny', file: 'onnx/encoder_model_quantized.onnx', mb: 10 },
      { repo: 'Xenova/whisper-tiny', file: 'onnx/decoder_model_merged_quantized.onnx', mb: 30 },
    ],
    runtime: 'ONNX runtime not bundled in v0.1.',
  },
  {
    id: 'llama-1b-q4',
    name: 'Llama 3.2 1B Instruct Q4_K_M',
    ram: '~1.0 GB',
    disk: '0.81 GB',
    use: 'Meta 1B offline chat, ideal for iPhone 12',
    files: [{ repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', mb: 808 }],
    runtime: 'GGUF needs llama.cpp: run it in the companion runner (or vendor a WASM build; v0.1 ships none).',
  },
  {
    id: 'llama-1b-q8',
    name: 'Llama 3.2 1B Instruct Q8_0',
    ram: '~1.5 GB',
    disk: '1.32 GB',
    use: 'Higher quality 1B; close other tabs',
    files: [{ repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q8_0.gguf', mb: 1321 }],
    runtime: 'GGUF needs llama.cpp (companion runner).',
  },
  {
    id: 'llama-3b-q4',
    name: 'Llama 3.2 3B Instruct Q4_K_M',
    ram: '~2.3 GB',
    disk: '2.02 GB',
    use: 'Macro max: too big for a Safari tab, hosted by the companion runner app',
    status: 'companion',
    runtime: 'Set the runner URL in ROUTER → Counselors (contract: foundry-router/docs/RUNNER_CONTRACT.md).',
  },
];

export const hfUrl = (repo, file) => `https://huggingface.co/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`;
