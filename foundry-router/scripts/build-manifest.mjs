// Builds public/models/manifest.json and model_list.txt (100 models) from the
// table below. Run: npm run build:manifest
//
// Sizes are approximate sizes of the listed file(s), not parameter counts.
// iPhone tier is derived from size: green <= 100 MB (native WebGPU/WASM),
// yellow <= 500 MB (CoreML-class / careful), orange <= 1 GB (macro: Wi-Fi,
// thermal throttle), red > 1 GB (Godzilla workstation: RTX 3090 / 128 GB).
import { writeFileSync } from 'node:fs';

const T = 'tokenizer.json';
const Q = 'onnx/model_quantized.onnx';
const DEC = 'onnx/decoder_model_merged_quantized.onnx';

// [group, id, name, repo, file, extra, sizeMB, quant, category, use, runtime, more]
const ROWS = [
  // --- Ultra-tiny (20) -------------------------------------------------------
  ['ultra-tiny', 'bc-resnet-kws', 'BC-ResNet-1 "Hey Jackie"', 'local/eye', 'bc-resnet-heyjackie.onnx', [], 0.017, 'INT8', 'Audio · KWS', 'eYe wake word, 20 KB orchestrator (train + drop into public/models/eye/)', 'onnx-web', { local: true }],
  ['ultra-tiny', 'tinystories-1m', 'TinyStories-1M', 'roneneldan/TinyStories-1M', 'pytorch_model.bin', [], 15, 'FP32', 'Text · Gen', 'NPC lore one-liners', 'pytorch'],
  ['ultra-tiny', 'tinystories-3m', 'TinyStories-3M', 'roneneldan/TinyStories-3M', 'pytorch_model.bin', [], 33, 'FP32', 'Text · Gen', 'NPC lore paragraphs', 'pytorch'],
  ['ultra-tiny', 'bert-tiny', 'bert-tiny', 'prajjwal1/bert-tiny', 'pytorch_model.bin', [], 17.7, 'FP32', 'Text · Encoder', 'Scam classifier backbone', 'pytorch'],
  ['ultra-tiny', 'bert-l2-h128', 'BERT L-2 H-128', 'google/bert_uncased_L-2_H-128_A-2', 'pytorch_model.bin', [], 17.6, 'FP32', 'Text · Encoder', 'Intent routing for the eYe', 'pytorch'],
  ['ultra-tiny', 'albert-base-v2', 'ALBERT base v2', 'Xenova/albert-base-v2', Q, [T], 12, 'Q8', 'Text · Encoder', 'Shared-weight tiny encoder', 'onnx-web'],
  ['ultra-tiny', 'mobilenet-v2', 'MobileNetV2 1.0 224', 'Xenova/mobilenet_v2_1.0_224', Q, [], 3.6, 'Q8', 'Vision · Classify', 'Asset thumbnails', 'onnx-web'],
  ['ultra-tiny', 'vit-tiny', 'ViT-Tiny 16/224', 'WinKawaks/vit-tiny-patch16-224', 'model.safetensors', [], 23, 'FP32', 'Vision · Classify', 'Jade scan', 'pytorch'],
  ['ultra-tiny', 'efficientnet-b0', 'EfficientNet-B0', 'google/efficientnet-b0', 'pytorch_model.bin', [], 21, 'FP32', 'Vision · Classify', 'Asset quality scoring', 'pytorch'],
  ['ultra-tiny', 'bge-micro-v2', 'bge-micro-v2', 'TaylorAI/bge-micro-v2', Q, [T], 17, 'Q8', 'Text · Embedding', 'Core memory fabric embedder (Y-Axis Lab)', 'onnx-web', { embedder: true }],
  ['ultra-tiny', 'minilm-l3', 'paraphrase-MiniLM-L3-v2', 'Xenova/paraphrase-MiniLM-L3-v2', Q, [T], 17.5, 'Q8', 'Text · Embedding', 'RAG paraphraser', 'onnx-web', { embedder: true }],
  ['ultra-tiny', 'bert-mini', 'bert-mini', 'prajjwal1/bert-mini', 'pytorch_model.bin', [], 44.7, 'FP32', 'Text · Encoder', 'Small classifier', 'pytorch'],
  ['ultra-tiny', 'bert-small', 'bert-small', 'prajjwal1/bert-small', 'pytorch_model.bin', [], 116, 'FP32', 'Text · Encoder', 'Small classifier (wider)', 'pytorch'],
  ['ultra-tiny', 'bge-small', 'bge-small-en-v1.5', 'Xenova/bge-small-en-v1.5', Q, [T], 34, 'Q8', 'Text · Embedding', 'Retrieval', 'onnx-web', { embedder: true }],
  ['ultra-tiny', 'gte-small', 'gte-small', 'Xenova/gte-small', Q, [T], 34, 'Q8', 'Text · Embedding', 'Knowledge Condenser', 'onnx-web', { embedder: true }],
  ['ultra-tiny', 'e5-small', 'e5-small-v2', 'Xenova/e5-small-v2', Q, [T], 34, 'Q8', 'Text · Embedding', 'Gold-tier retrieval', 'onnx-web', { embedder: true }],
  ['ultra-tiny', 'ecapa', 'spkrec-ecapa-voxceleb', 'speechbrain/spkrec-ecapa-voxceleb', 'embedding_model.ckpt', [], 83, 'FP32', 'Audio · Speaker', 'Voice ID, positivity wave', 'pytorch'],
  ['ultra-tiny', 'tinybert', 'TinyBERT 4L-312D', 'huawei-noah/TinyBERT_General_4L_312D', 'pytorch_model.bin', [], 62, 'FP32', 'Text · Encoder', 'eYe router distillation base', 'pytorch'],
  ['ultra-tiny', 'whisper-tiny', 'Whisper tiny', 'Xenova/whisper-tiny', 'onnx/encoder_model_quantized.onnx', [DEC, T], 40, 'Q8', 'Audio · ASR', 'Offline voice', 'onnx-web'],
  ['ultra-tiny', 'distilbert-sst2', 'DistilBERT SST-2', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english', Q, [T], 67, 'Q8', 'Text · Classify', 'Scam encoder / tone', 'onnx-web'],

  // --- Small (20) --------------------------------------------------------------
  ['small', 'minilm-l6', 'all-MiniLM-L6-v2', 'Xenova/all-MiniLM-L6-v2', Q, [T], 23, 'Q8', 'Text · Embedding', 'Main embedding', 'onnx-web', { embedder: true }],
  ['small', 'multi-qa-minilm', 'multi-qa-MiniLM-L6', 'Xenova/multi-qa-MiniLM-L6-cos-v1', Q, [T], 23, 'Q8', 'Text · Embedding', 'SAS log search', 'onnx-web', { embedder: true }],
  ['small', 'yolov5n', 'YOLOv5n', 'fcakyon/yolov5n-v7.0', 'yolov5n.pt', [], 4, 'FP16', 'Vision · Detect', 'Fast scene detection', 'pytorch'],
  ['small', 'yolov8n', 'YOLOv8n', 'Ultralytics/YOLOv8', 'yolov8n.pt', [], 6.5, 'FP16', 'Vision · Detect', 'Game editor object picking', 'pytorch'],
  ['small', 'resnet-18', 'ResNet-18', 'microsoft/resnet-18', 'model.safetensors', [], 46.8, 'FP32', 'Vision · Classify', 'Jade rarity', 'pytorch'],
  ['small', 'depth-anything-small', 'Depth Anything V2 Small', 'onnx-community/depth-anything-v2-small', Q, [], 27, 'Q8', 'Vision · Depth', '3D asset depth', 'onnx-web'],
  ['small', 'convnext-tiny', 'ConvNeXt-Tiny', 'Xenova/convnext-tiny-224', Q, [], 29, 'Q8', 'Vision · Classify', 'Dragon Veil avatars', 'onnx-web'],
  ['small', 'tiny-sd', 'tiny-sd', 'segmind/tiny-sd', 'unet/diffusion_pytorch_model.safetensors', [], 1030, 'FP32', 'Vision · Generate', 'Icon generation (workstation)', 'pytorch'],
  ['small', 'yolos-small', 'YOLOS-small', 'Xenova/yolos-small', Q, [], 31, 'Q8', 'Vision · Detect', 'Transformer detector', 'onnx-web'],
  ['small', 'cerebras-111m', 'Cerebras-GPT-111M', 'cerebras/Cerebras-GPT-111M', 'pytorch_model.bin', [], 467, 'FP32', 'Code · Gen', 'Tiny code completion', 'pytorch'],
  ['small', 'mobilellm-125m', 'MobileLLM-125M', 'facebook/MobileLLM-125M', 'pytorch_model.bin', [], 499, 'FP32', 'Text · Gen', 'Main NPC brain (Meta)', 'pytorch', { meta: true }],
  ['small', 'smollm2-135m', 'SmolLM2-135M-Instruct (WebLLM)', 'mlc-ai/SmolLM2-135M-Instruct-q0f16-MLC', 'mlc-chat-config.json', [], 270, 'Q0F16', 'Text · Chat', 'Jacky offline core (WebLLM Offline chip)', 'webllm', { webllm: 'SmolLM2-135M-Instruct-q0f16-MLC' }],
  ['small', 'mamba-130m', 'Mamba-130M', 'state-spaces/mamba-130m-hf', 'model.safetensors', [], 517, 'FP32', 'Text · State-space', 'Orchestration state-space', 'pytorch'],
  ['small', 'distilgpt2', 'DistilGPT-2', 'Xenova/distilgpt2', DEC, [T], 84, 'Q8', 'Text · Gen', 'Quest text', 'onnx-web'],
  ['small', 'pythia-70m', 'Pythia-70M', 'EleutherAI/pythia-70m', 'model.safetensors', [], 166, 'FP16', 'Text · Gen', 'Interpretability toy', 'pytorch'],
  ['small', 'gpt2', 'GPT-2', 'Xenova/gpt2', DEC, [T], 126, 'Q8', 'Text · Gen', 'Classic generator', 'onnx-web'],
  ['small', 'pythia-160m', 'Pythia-160M', 'EleutherAI/pythia-160m', 'model.safetensors', [], 375, 'FP16', 'Text · Gen', 'Small generator', 'pytorch'],
  ['small', 'table-det', 'Table Transformer (detection)', 'microsoft/table-transformer-detection', 'model.safetensors', [], 115, 'FP32', 'Docs · Layout', 'Find tables in docs', 'pytorch'],
  ['small', 'table-struct', 'Table Transformer (structure)', 'microsoft/table-transformer-structure-recognition', 'model.safetensors', [], 116, 'FP32', 'Docs · Layout', 'Table structure', 'pytorch'],
  ['small', 'dinov2-small', 'DINOv2 small', 'facebook/dinov2-small', 'model.safetensors', [], 88, 'FP32', 'Vision · Features', 'Asset tagging (Meta)', 'pytorch', { meta: true }],

  // --- Medium (30) -------------------------------------------------------------
  ['medium', 'opt-125m', 'OPT-125M', 'Xenova/opt-125m', DEC, [T], 126, 'Q8', 'Text · Gen', 'Story (Meta)', 'onnx-web', { meta: true }],
  ['medium', 'mobilellm-350m', 'MobileLLM-350M', 'facebook/MobileLLM-350M', 'pytorch_model.bin', [], 1380, 'FP32', 'Text · Gen', 'NPC mid-tier (Meta)', 'pytorch', { meta: true }],
  ['medium', 'smollm2-360m', 'SmolLM2-360M-Instruct (WebLLM)', 'mlc-ai/SmolLM2-360M-Instruct-q4f16_1-MLC', 'mlc-chat-config.json', [], 210, 'Q4F16', 'Text · Chat', 'Flagship coding savant · Russian phonk positivity', 'webllm', { webllm: 'SmolLM2-360M-Instruct-q4f16_1-MLC' }],
  ['medium', 'gpt-neo-125m', 'GPT-Neo-125M', 'Xenova/gpt-neo-125M', DEC, [T], 126, 'Q8', 'Text · Gen', 'Lore drafts', 'onnx-web'],
  ['medium', 'codegen-350m', 'CodeGen-350M-mono', 'Xenova/codegen-350M-mono', DEC, [T], 360, 'Q8', 'Code · Gen', 'Godzilla workstation codegen', 'onnx-web'],
  ['medium', 'codeparrot-small', 'CodeParrot-small', 'codeparrot/codeparrot-small', 'pytorch_model.bin', [], 457, 'FP32', 'Code · Gen', 'Python completion', 'pytorch'],
  ['medium', 'codet5-small', 'CodeT5-small', 'Salesforce/codet5-small', 'pytorch_model.bin', [], 242, 'FP32', 'Code · Summarise', 'Code summary', 'pytorch'],
  ['medium', 'tiny-starcoder', 'tiny_starcoder_py', 'Xenova/tiny_starcoder_py', DEC, [T], 165, 'Q8', 'Code · Gen', 'Python snippets', 'onnx-web'],
  ['medium', 'whisper-base', 'Whisper base', 'Xenova/whisper-base', 'onnx/encoder_model_quantized.onnx', [DEC, T], 75, 'Q8', 'Audio · ASR', 'Better offline voice', 'onnx-web'],
  ['medium', 'wav2vec2-base', 'wav2vec2-base-960h', 'Xenova/wav2vec2-base-960h', Q, [], 95, 'Q8', 'Audio · ASR', 'CTC speech', 'onnx-web', { meta: true }],
  ['medium', 'hubert-base', 'HuBERT base', 'facebook/hubert-base-ls960', 'pytorch_model.bin', [], 377, 'FP32', 'Audio · Features', 'Speech representations (Meta)', 'pytorch', { meta: true }],
  ['medium', 'unispeech-sat', 'UniSpeech-SAT base', 'microsoft/unispeech-sat-base', 'pytorch_model.bin', [], 377, 'FP32', 'Audio · Speaker', 'Speaker features', 'pytorch'],
  ['medium', 'clap-htsat', 'CLAP HTSAT unfused', 'Xenova/clap-htsat-unfused', Q, [T], 155, 'Q8', 'Audio · Zero-shot', 'Phonk classification · Имп3рия', 'onnx-web'],
  ['medium', 'vit-base', 'ViT-base 16/224', 'Xenova/vit-base-patch16-224', Q, [], 88, 'Q8', 'Vision · Classify', 'Asset tagging', 'onnx-web'],
  ['medium', 'sam-vit-base', 'SAM ViT-base', 'Xenova/sam-vit-base', 'onnx/vision_encoder_quantized.onnx', ['onnx/prompt_encoder_mask_decoder_quantized.onnx'], 94, 'Q8', 'Vision · Segment', 'Cutouts (Meta SAM)', 'onnx-web', { meta: true }],
  ['medium', 'mobilesam', 'MobileSAM', 'dhkim2810/MobileSAM', 'mobile_sam.pt', [], 40, 'FP32', 'Vision · Segment', 'Jade Atelier cutout', 'pytorch', { meta: true }],
  ['medium', 'dpt-beit-base', 'DPT BEiT-base 384', 'Intel/dpt-beit-base-384', 'pytorch_model.bin', [], 450, 'FP32', 'Vision · Depth', 'Level depth maps', 'pytorch'],
  ['medium', 'resnet-50', 'ResNet-50', 'Xenova/resnet-50', Q, [], 25, 'Q8', 'Vision · Classify', 'General classifier', 'onnx-web'],
  ['medium', 'clip-vit-base', 'CLIP ViT-B/32', 'Xenova/clip-vit-base-patch32', 'onnx/vision_model_quantized.onnx', ['onnx/text_model_quantized.onnx', T], 152, 'Q8', 'Vision · Text', 'Text-to-asset search', 'onnx-web'],
  ['medium', 'siglip-base', 'SigLIP base 16/224', 'Xenova/siglip-base-patch16-224', 'onnx/vision_model_quantized.onnx', ['onnx/text_model_quantized.onnx'], 205, 'Q8', 'Vision · Text', 'Asset search', 'onnx-web'],
  ['medium', 'florence-2-base', 'Florence-2-base (no "small" exists)', 'onnx-community/Florence-2-base-ft', 'onnx/vision_encoder_quantized.onnx', ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx', 'onnx/embed_tokens_quantized.onnx'], 270, 'Q8', 'Vision · Language', 'UI understanding', 'onnx-web'],
  ['medium', 't5-small', 'T5-small', 'Xenova/t5-small', 'onnx/encoder_model_quantized.onnx', [DEC, T], 95, 'Q8', 'Text · Seq2Seq', 'Summaries', 'onnx-web'],
  ['medium', 'flan-t5-small', 'Flan-T5-small', 'Xenova/flan-t5-small', 'onnx/encoder_model_quantized.onnx', [DEC, T], 110, 'Q8', 'Text · Seq2Seq', 'Instruction following', 'onnx-web'],
  ['medium', 'opus-en-ru', 'OPUS-MT en→ru', 'Xenova/opus-mt-en-ru', 'onnx/encoder_model_quantized.onnx', [DEC], 75, 'Q8', 'Text · Translate', 'Lyrics to Russian', 'onnx-web'],
  ['medium', 'opus-ru-en', 'OPUS-MT ru→en', 'Xenova/opus-mt-ru-en', 'onnx/encoder_model_quantized.onnx', [DEC], 75, 'Q8', 'Text · Translate', 'Russian to English', 'onnx-web'],
  ['medium', 'bert-multi-sentiment', 'BERT multilingual sentiment', 'Xenova/bert-base-multilingual-uncased-sentiment', Q, [T], 170, 'Q8', 'Text · Classify', 'Positivity wave (multilingual)', 'onnx-web'],
  ['medium', 'detr-resnet-50', 'DETR ResNet-50', 'Xenova/detr-resnet-50', Q, [], 43, 'Q8', 'Vision · Detect', 'Object detection (Meta)', 'onnx-web', { meta: true }],
  ['medium', 'yolos-tiny', 'YOLOS-tiny', 'Xenova/yolos-tiny', Q, [], 7, 'Q8', 'Vision · Detect', 'Tiny detector', 'onnx-web'],
  ['medium', 'vit-gpt2-caption', 'ViT-GPT2 captioning', 'Xenova/vit-gpt2-image-captioning', 'onnx/encoder_model_quantized.onnx', [DEC, T], 240, 'Q8', 'Vision · Caption', 'Lineage captions', 'onnx-web'],
  ['medium', 'llama-3.2-1b', 'Llama 3.2 1B Instruct (WebLLM)', 'mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC', 'mlc-chat-config.json', [], 700, 'Q4F16', 'Text · Chat', 'Meta Llama on-device (needs ~880 MB VRAM)', 'webllm', { meta: true, webllm: 'Llama-3.2-1B-Instruct-q4f16_1-MLC' }],

  // --- Balanced (30) -----------------------------------------------------------
  ['balanced', 'bge-base', 'bge-base-en-v1.5', 'Xenova/bge-base-en-v1.5', Q, [T], 110, 'Q8', 'Text · Embedding', 'RAG base', 'onnx-web', { embedder: true }],
  ['balanced', 'e5-base', 'e5-base-v2', 'Xenova/e5-base-v2', Q, [T], 110, 'Q8', 'Text · Embedding', 'Retrieval', 'onnx-web', { embedder: true }],
  ['balanced', 'gte-base', 'gte-base', 'Xenova/gte-base', Q, [T], 110, 'Q8', 'Text · Embedding', 'Retrieval', 'onnx-web', { embedder: true }],
  ['balanced', 'nomic-embed', 'nomic-embed-text-v1.5', 'nomic-ai/nomic-embed-text-v1.5', Q, [T], 138, 'Q8', 'Text · Embedding', '8k-context memory', 'onnx-web'],
  ['balanced', 'mxbai-large', 'mxbai-embed-large-v1', 'mixedbread-ai/mxbai-embed-large-v1', Q, [T], 337, 'Q8', 'Text · Embedding', 'High-recall retrieval', 'onnx-web', { embedder: true }],
  ['balanced', 'jina-v2-base', 'jina-embeddings-v2-base-en', 'Xenova/jina-embeddings-v2-base-en', Q, [T], 162, 'Q8', 'Text · Embedding', '8k historical transparency logs', 'onnx-web'],
  ['balanced', 'distil-whisper', 'distil-whisper small.en', 'distil-whisper/distil-small.en', 'onnx/encoder_model_quantized.onnx', [DEC, T], 170, 'Q8', 'Audio · ASR', 'Fast English ASR', 'onnx-web'],
  ['balanced', 'whisper-small', 'Whisper small', 'Xenova/whisper-small', 'onnx/encoder_model_quantized.onnx', [DEC, T], 250, 'Q8', 'Audio · ASR', 'Multilingual ASR', 'onnx-web'],
  ['balanced', 'musicgen-small', 'MusicGen small (AudioCraft)', 'Xenova/musicgen-small', 'onnx/decoder_model_merged_quantized.onnx', ['onnx/text_encoder_quantized.onnx', 'onnx/encodec_decode_quantized.onnx', T], 470, 'Q8', 'Audio · Generate', 'Phonk loops (Meta AudioCraft)', 'onnx-web', { meta: true }],
  ['balanced', 'sd-turbo', 'SD-Turbo', 'stabilityai/sd-turbo', 'unet/diffusion_pytorch_model.fp16.safetensors', [], 1730, 'FP16', 'Vision · Generate', 'Turbo textures (workstation)', 'pytorch'],
  ['balanced', 'ssd-1b', 'SSD-1B', 'segmind/SSD-1B', 'unet/diffusion_pytorch_model.fp16.safetensors', [], 2600, 'FP16', 'Vision · Generate', 'SDXL-class art (workstation)', 'pytorch'],
  ['balanced', 'controlnet-depth', 'ControlNet depth (SD1.5)', 'lllyasviel/sd-controlnet-depth', 'diffusion_pytorch_model.safetensors', [], 1450, 'FP32', 'Vision · Generate', 'Level depth conditioning', 'pytorch'],
  ['balanced', 'blip-base', 'BLIP captioning base', 'Salesforce/blip-image-captioning-base', 'model.safetensors', [], 990, 'FP32', 'Vision · Caption', 'Caption lineage history', 'pytorch'],
  ['balanced', 'donut-docvqa', 'Donut DocVQA', 'Xenova/donut-base-finetuned-docvqa', 'onnx/encoder_model_quantized.onnx', [DEC, T], 220, 'Q8', 'Docs · QA', 'Lore document Q&A', 'onnx-web'],
  ['balanced', 'layoutlmv3', 'LayoutLMv3 base', 'microsoft/layoutlmv3-base', 'pytorch_model.bin', [], 501, 'FP32', 'Docs · Layout', 'Design docs', 'pytorch'],
  ['balanced', 'granite-2b', 'Granite 3.0 2B Instruct', 'ibm-granite/granite-3.0-2b-instruct', 'model-00001-of-00002.safetensors', ['model-00002-of-00002.safetensors'], 5070, 'BF16', 'Text · Chat', 'Reasoning (workstation)', 'pytorch'],
  ['balanced', 'qwen2.5-0.5b', 'Qwen2.5-0.5B-Instruct (WebLLM)', 'mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC', 'mlc-chat-config.json', [], 280, 'Q4F16', 'Text · Chat', 'NPC instruct', 'webllm', { webllm: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' }],
  ['balanced', 'danube3-500m', 'H2O-Danube3-500M chat', 'h2oai/h2o-danube3-500m-chat', 'model.safetensors', [], 1030, 'BF16', 'Text · Chat', 'Offline Jackie chat (workstation)', 'pytorch'],
  ['balanced', 'stablelm-1.6b', 'StableLM 2 Zephyr 1.6B', 'stabilityai/stablelm-2-zephyr-1_6b', 'model.safetensors', [], 3290, 'BF16', 'Text · Chat', 'Lore', 'pytorch'],
  ['balanced', 'bloomz-560m', 'BLOOMZ-560M', 'Xenova/bloomz-560m', DEC, [T], 560, 'Q8', 'Text · Gen', 'Rap lyrics (BLOOM skipped Russian in pretraining)', 'onnx-web'],
  ['balanced', 'xglm-564m', 'XGLM-564M', 'facebook/xglm-564M', 'pytorch_model.bin', [], 2260, 'FP32', 'Text · Gen', 'Dragon Veil social, multilingual incl. Russian (Meta)', 'pytorch', { meta: true }],
  ['balanced', 'mamba-370m', 'Mamba-370M', 'state-spaces/mamba-370m-hf', 'model.safetensors', [], 1490, 'FP32', 'Text · State-space', 'Long memory fabric', 'pytorch'],
  ['balanced', 'rwkv-169m', 'RWKV-4 169M', 'RWKV/rwkv-4-169m-pile', 'pytorch_model.bin', [], 678, 'FP32', 'Text · RNN', 'Infinite-context dialogue', 'pytorch'],
  ['balanced', 'mobilellm-600m', 'MobileLLM-600M', 'facebook/MobileLLM-600M', 'pytorch_model.bin', [], 2400, 'FP32', 'Text · Gen', 'Flagship offline (Meta, workstation weights)', 'pytorch', { meta: true }],
  ['balanced', 'pythia-410m', 'Pythia-410M', 'EleutherAI/pythia-410m', 'model.safetensors', [], 911, 'FP16', 'Text · Gen', 'Code reasoning experiments', 'pytorch'],
  ['balanced', 'phi-2', 'Phi-2 (WebLLM)', 'mlc-ai/phi-2-q4f16_1-MLC', 'mlc-chat-config.json', [], 1600, 'Q4F16', 'Text · Chat', 'Puzzle logic', 'webllm', { webllm: 'phi-2-q4f16_1-MLC' }],
  ['balanced', 'deepseek-r1-1.5b', 'DeepSeek-R1-Distill-Qwen-1.5B', 'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX', 'onnx/model_q4f16.onnx', [T], 1300, 'Q4F16', 'Text · Reasoning', 'Reasoning', 'onnx-web'],
  ['balanced', 'qwen2.5-coder-1.5b', 'Qwen2.5-Coder-1.5B-Instruct', 'onnx-community/Qwen2.5-Coder-1.5B-Instruct', 'onnx/model_q4f16.onnx', [T], 1100, 'Q4F16', 'Code · Chat', 'Coder', 'onnx-web'],
  ['balanced', 'smollm2-1.7b', 'SmolLM2-1.7B-Instruct (WebLLM)', 'mlc-ai/SmolLM2-1.7B-Instruct-q4f16_1-MLC', 'mlc-chat-config.json', [], 960, 'Q4F16', 'Text · Chat', 'INT4 flagship', 'webllm', { webllm: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC' }],
  ['balanced', 'gemma-2-2b', 'Gemma 2 2B it (WebLLM)', 'mlc-ai/gemma-2-2b-it-q4f16_1-MLC', 'mlc-chat-config.json', [], 1500, 'Q4F16', 'Text · Chat', 'Positivity wave', 'webllm', { webllm: 'gemma-2-2b-it-q4f16_1-MLC' }],
];

export function tierFor(sizeMB) {
  if (sizeMB <= 100) return 'green';
  if (sizeMB <= 500) return 'yellow';
  if (sizeMB <= 1000) return 'orange';
  return 'red';
}

const TIERS = {
  green: { label: 'iPhone 12 native', range: '<= 100 MB', note: 'Q4/Q8, WebGPU (WebLLM) or WASM (onnxruntime-web)' },
  yellow: { label: 'iPhone 12 careful', range: '100-500 MB', note: 'CoreML-class: needs a native conversion for best speed; works in-browser with memory headroom' },
  orange: { label: 'Somewhat macro', range: '500 MB-1 GB', note: 'Wi-Fi download, expect thermal throttle on A14' },
  red: { label: 'Godzilla workstation', range: '> 1 GB', note: 'RTX 3090 / 128 GB. Not for a 4 GB iPhone' },
};

const CORE = ['bge-micro-v2', 'tinystories-1m', 'smollm2-135m', 'whisper-tiny', 'bc-resnet-kws', 'mobilenet-v2', 'yolov8n', 'minilm-l6'];

const models = ROWS.map(([group, id, name, repo, file, extra, sizeMB, quant, category, use, runtime, more = {}]) => ({
  id,
  name,
  group,
  repo,
  file,
  extra,
  sizeMB,
  quant,
  category,
  use,
  runtime,
  tier: tierFor(sizeMB),
  iphone: sizeMB <= 100 || (runtime === 'webllm' && sizeMB <= 300),
  url: more.local ? null : `https://huggingface.co/${repo}/resolve/main/${file}`,
  ...more,
}));

const ids = new Set(models.map((m) => m.id));
if (models.length !== 100 || ids.size !== 100) throw new Error(`expected 100 unique models, got ${models.length}/${ids.size}`);
for (const c of CORE) if (!ids.has(c)) throw new Error(`core model ${c} missing`);
const groups = models.reduce((a, m) => ({ ...a, [m.group]: (a[m.group] || 0) + 1 }), {});

const manifest = {
  version: 1,
  name: 'Foundry Router - Asset Store',
  cdn: 'https://huggingface.co/{id}/resolve/main/{file}',
  note: 'Sizes are approximate file sizes. Repo IDs were not verified from the build machine (huggingface.co unreachable there); a wrong path shows up as a clear 404 in the store.',
  tiers: TIERS,
  groups,
  core: CORE,
  coreTotalMB: +CORE.reduce((s, id) => s + models.find((m) => m.id === id).sizeMB, 0).toFixed(1),
  metaAssets: {
    cloud: [
      { name: 'Llama 3.2 1B / 3B', via: 'Groq (llama-3.2 preview IDs heal to live Llama models)' },
      { name: 'Llama 3.3 70B', via: 'Groq llama-3.3-70b-versatile / Cerebras' },
    ],
    onDevice: models.filter((m) => m.meta).map((m) => m.id),
    runtime: { name: 'PyTorch Mobile → ExecuTorch', note: 'Native iOS/Android runtime for the pytorch entries; not usable from a web page' },
  },
  // Served by the separate iPhone Runner companion app (llama.cpp + Metal), reached as
  // provider 'runner'. Not counted in the 100: the browser never loads these GGUFs.
  companion: {
    name: 'iPhone Runner (llama.cpp + Metal companion app)',
    contract: 'docs/RUNNER_CONTRACT.md',
    defaultBaseUrl: 'http://localhost:8080/v1',
    models: [
      { name: 'Llama 3.2 3B Instruct Q4_K_M', repo: 'bartowski/Llama-3.2-3B-Instruct-GGUF', file: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf', sizeMB: 2020, meta: true, note: 'Tight on a 4 GB iPhone 12: increased-memory-limit entitlement + ~2k context' },
      { name: 'Llama 3.2 1B Instruct Q4_K_M', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', file: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf', sizeMB: 808, meta: true, note: 'Comfortable fallback on iPhone 12' },
    ],
  },
  models,
};

const root = new URL('../', import.meta.url);
writeFileSync(new URL('public/models/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');

// WebLLM (MLC) entries are sharded weight repos: fetch the whole repo for those.
const lines = models.map((m) =>
  m.local
    ? `# ${m.id}: no public weights - train BC-ResNet-1 for "Hey Jackie" and save as public/models/eye/${m.file}`
    : m.runtime === 'webllm'
      ? `huggingface-cli download ${m.repo} --local-dir models/${m.repo}`
      : `huggingface-cli download ${m.repo} ${[m.file, ...m.extra].join(' ')} --local-dir models/${m.repo}`,
);
writeFileSync(new URL('model_list.txt', root), lines.join('\n') + '\n');
console.log(`wrote manifest.json (${models.length} models, ${JSON.stringify(groups)}) and model_list.txt; core ${manifest.coreTotalMB} MB`);
