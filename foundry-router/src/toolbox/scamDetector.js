// Scam Detector: 10 weighted patterns (0.85-0.92), combined with noisy-OR so
// independent red flags compound without exceeding 1:
//   risk = 1 - prod(1 - w_i * s_i), s_i = min(1, 0.6 + 0.2 * (hits_i - 1))
// English and Russian cues. Offline, nothing leaves the device.

export const SCAM_PATTERNS = [
  {
    id: 'credentials',
    label: 'Asks for passwords / one-time codes',
    weight: 0.92,
    re: /\b(password|passcode|one[- ]time (?:code|password)|otp|verification code|2fa code|pin\b|seed phrase|recovery phrase|ssn|social security)\b|код из смс|код подтверждения|пароль/gi,
  },
  {
    id: 'payment-rails',
    label: 'Untraceable payment (gift cards, crypto, wire)',
    weight: 0.91,
    re: /\b(gift ?cards?|itunes card|google play card|steam card|bitcoin|btc|usdt|crypto(?:currency)? wallet|western union|moneygram|wire transfer|zelle|cash app)\b|перевод(?:ите)? на карту|криптовалют/gi,
  },
  {
    id: 'remote-access',
    label: 'Remote-access software request',
    weight: 0.9,
    re: /\b(anydesk|teamviewer|ultraviewer|quick ?support|rustdesk|install (?:this|the) app to (?:help|fix))\b/gi,
  },
  {
    id: 'advance-fee',
    label: 'Pay a fee to release money / prize',
    weight: 0.9,
    re: /\b(processing fee|release fee|customs fee|transfer fee|clearance fee|unclaimed (?:funds|inheritance)|beneficiary|inheritance)\b.*?|pay (?:a |the )?(?:small )?fee/gi,
  },
  {
    id: 'impersonation',
    label: 'Impersonates bank, government or big tech',
    weight: 0.89,
    re: /\b(irs|hmrc|fbi|social security administration|apple support|microsoft support|amazon security|paypal security|your bank|fraud department|tax office)\b|служба безопасности банка|налоговая/gi,
  },
  {
    id: 'threat',
    label: 'Threats: suspension, arrest, legal action',
    weight: 0.88,
    re: /\b(account (?:will be )?(?:suspended|locked|closed|terminated)|arrest(?:ed)?|warrant|legal action|lawsuit|police will|deported|final notice)\b|заблокирован|уголовн/gi,
  },
  {
    id: 'urgency',
    label: 'Manufactured urgency',
    weight: 0.87,
    re: /\b(act now|urgent(?:ly)?|immediately|within (?:24|48) hours|today only|last chance|expires? (?:today|soon)|right away|asap)\b|срочно|немедленно/gi,
  },
  {
    id: 'prize',
    label: 'Prize, lottery or windfall',
    weight: 0.86,
    re: /\b(you(?:'ve| have)? won|winner|lottery|jackpot|claim your (?:prize|reward)|selected to receive|free iphone)\b|вы выиграли|приз/gi,
  },
  {
    id: 'too-good',
    label: 'Guaranteed / too-good-to-be-true returns',
    weight: 0.86,
    re: /\b(guaranteed (?:returns?|profit|income)|double your (?:money|bitcoin|investment)|risk[- ]free|\d{2,3}% (?:daily|weekly|monthly) returns?|passive income guaranteed)\b/gi,
  },
  {
    id: 'links',
    label: 'Suspicious link (shortener, raw IP, punycode)',
    weight: 0.85,
    re: /\b(?:https?:\/\/)?(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|shorturl\.at)\/\S+|https?:\/\/\d{1,3}(?:\.\d{1,3}){3}\S*|xn--[a-z0-9-]+\.\S+/gi,
  },
];

export function analyzeScam(text) {
  const input = String(text || '');
  const matches = [];
  let safe = 1;
  for (const p of SCAM_PATTERNS) {
    const hits = [...input.matchAll(p.re)].map((m) => m[0].trim()).filter(Boolean);
    if (!hits.length) continue;
    const strength = Math.min(1, 0.6 + 0.2 * (hits.length - 1));
    safe *= 1 - p.weight * strength;
    matches.push({ id: p.id, label: p.label, weight: p.weight, strength, evidence: [...new Set(hits)].slice(0, 4) });
  }
  const risk = 1 - safe;
  const level = risk >= 0.85 ? 'high' : risk >= 0.5 ? 'medium' : matches.length ? 'low' : 'none';
  return { risk, level, matches: matches.sort((a, b) => b.weight - a.weight) };
}

export const SCAM_SAMPLE =
  'URGENT: Your Apple Support account will be suspended within 24 hours. To verify, reply with the verification code we sent and pay the $50 release fee in iTunes gift cards. Click bit.ly/secure-apple now.';
