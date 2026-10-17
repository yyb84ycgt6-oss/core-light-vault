// eYe Router hub: User -> eYe Router (traffic cop) -> micro (eYe Core tools, ~80%)
// or macro (~20%) -> Meta Jackie (balanced 0.15) / Grok (wild) / DeepSeek (scribe)
// / Local Llama. The routing table is reputation-weighted (chat.js rateRoute).
export { route, trace, COUNSELORS, RULES, footprintBytes } from '../core/eye.js';
export { reputationTable, rateRoute } from './chat.js';

export const ARCHITECTURE = [
  'User',
  'eYe Router · 20 kB traffic cop',
  'micro 80% → eYe Core tools (local, µs)',
  'macro 20% → Meta Jackie · Grok · DeepSeek · Local Llama',
];
