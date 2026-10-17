// Browser smoke test at iPhone 12 size. Needs Playwright (npm i -D playwright && npx playwright install chromium)
// and a running preview: npm run build && npm run preview, then npm run e2e.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.E2E_OUT || 'e2e-shots';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.E2E_BASE || 'http://localhost:4173';
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' - ' + extra : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(d.defaultValue() || 'lore') : d.accept()));

// --- mock Groq: first call 429, then a streamed SSE answer -------------------
let groqCalls = 0;
await page.route('https://api.groq.com/openai/v1/chat/completions', async (route) => {
  groqCalls++;
  const body = JSON.parse(route.request().postData());
  if (groqCalls === 1) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rate limit' } }) });
  const chunks = ['Hel', 'lo from ', 'mocked Groq', ` (${body.model})`].map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`);
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' }, body: chunks.join('') + 'data: [DONE]\n\n' });
});
// --- mock HF CDN for the Asset Store ----------------------------------------
await page.route('https://huggingface.co/**', (route) => {
  const url = route.request().url();
  const body = url.endsWith('.json') ? Buffer.from('{"model":{"type":"WordPiece","vocab":{}}}') : Buffer.alloc(300_000, 7);
  return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length), 'access-control-allow-origin': '*' }, body });
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/01-router.png` });
check('header renders', await page.getByText('Foundry Router v1').isVisible());
check('8 provider chips', (await page.locator('.pchip').count()) === 8);

// Touch targets: every visible button >= 44px tall except small chips explicitly sized (sm = 36)
const small = await page.$$eval('.nav button, .pchip, .composer .btn', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
check('primary touch targets >= 44px', small === 0, `${small} too small`);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('no horizontal page scroll at 390px', !overflow);

// --- Router: key vault + streaming with retry --------------------------------
await page.locator('details.vault summary').click();
await page.fill('#k-groq', 'gsk_test_key_123456');
await page.getByRole('button', { name: 'Save vault' }).click();
await page.locator('.pchip', { hasText: 'Llama 3.3 70B' }).click(); // cerebras pinned (no key) -> skip -> groq
await page.fill('textarea[aria-label="Message"]', 'Hello router');
await page.getByRole('button', { name: 'Send' }).click();
await page.waitForSelector('.msg.assistant .badge-line span', { timeout: 15000 });
const reply = await page.locator('.msg.assistant').last().innerText();
check('streamed reply rendered', reply.includes('Hello from mocked Groq'), reply.split('\n')[0]);
check('provider badge shown', reply.includes('Groq · llama-3.3-70b-versatile'));
check('429 retried with backoff', groqCalls === 2, `groq calls ${groqCalls}`);
await page.screenshot({ path: `${OUT}/02-chat.png` });

// --- Long string: generate, copy, restore -----------------------------------
await page.getByRole('button', { name: 'Save to Long String' }).click();
await page.getByRole('button', { name: 'Generate long string' }).click();
await page.waitForSelector('.sheet .longstring', { timeout: 20000 });
const ls = await page.locator('.sheet .longstring').innerText();
check('long string bounds _..._', ls.startsWith('_{') && ls.endsWith('}_'), `${ls.length} chars`);
check('portal ~ and qpdb/bdpq present', /\)-\{[qpdb]+\}~\{/.test(ls) && /\}-\{[qpdb]+\}-\(/.test(ls));
check('chat text not in clear', !ls.includes('Hello router'));
await page.screenshot({ path: `${OUT}/03-longstring.png` });

// wipe chat, then restore it from the string
await page.getByRole('button', { name: 'Done' }).click();
await page.getByRole('button', { name: 'Clear chat' }).click();
check('chat cleared', (await page.locator('.msg').count()) === 0);
await page.getByRole('button', { name: 'Save to Long String' }).click();
await page.fill('textarea[aria-label="Long string to restore"]', ls);
await page.waitForSelector('.sheet dl.kv >> text=messages');
await page.getByRole('button', { name: 'Restore', exact: true }).click();
await page.waitForSelector('.msg.assistant', { timeout: 15000 });
check('atomic restore brought chat back', (await page.locator('.msg').count()) === 2);
// tampered string must fail and leave the session alone
await page.getByRole('button', { name: 'Save to Long String' }).click();
const tampered = ls.replace(/~\{(.)/, (m, c) => `~{${c === 'A' ? 'B' : 'A'}`);
await page.fill('textarea[aria-label="Long string to restore"]', tampered);
await page.getByRole('button', { name: 'Restore', exact: true }).click();
await page.waitForSelector('.sheet [role=alert]');
const alert = await page.locator('.sheet [role=alert]').innerText();
check('tampered string rejected', /AUTH_FAILED|DIGEST_MISMATCH|SEGMENT_MALFORMED/.test(alert), alert.slice(0, 60));
await page.getByRole('button', { name: 'Done' }).click();
check('session intact after failed restore', (await page.locator('.msg').count()) === 2);

// --- Toolbox -------------------------------------------------------------------
await page.getByRole('button', { name: 'Toolbox' }).click();
await page.screenshot({ path: `${OUT}/04-toolbox.png` });
check('10 tool tiles', (await page.locator('.tile').count()) === 10);
const openTool = async (name) => {
  await page.locator('.tile', { hasText: name }).click();
  await page.waitForSelector('.toolhead');
};
const back = () => page.getByRole('button', { name: 'Back to toolbox' }).click();

await openTool('Scam Detector');
await page.getByRole('button', { name: 'Sample' }).click();
check('scam sample high risk', (await page.locator('text=/risk · high/').count()) === 1);
await back();

await openTool('Code Analyzer');
await page.getByRole('button', { name: 'Sample' }).click();
check('code sample graded F via AST', (await page.locator('.grade').innerText()) === 'F' && (await page.locator('text=Parsed with acorn').count()) === 1);
await back();

await openTool('Y-Axis Lab');
await page.getByRole('button', { name: 'Collapse', exact: true }).click();
await page.waitForSelector('text=retention', { timeout: 30000 });
const kv = await page.locator('.card dl.kv').innerText();
check('collapse ran in worker', /Y fingerprint/.test(kv), kv.replace(/\n/g, ' ').slice(0, 140));
await page.screenshot({ path: `${OUT}/05-collapse.png`, fullPage: false });
await back();

await openTool('Pod Manager');
await page.getByRole('button', { name: 'Create pod' }).click();
await page.locator('.item', { hasText: '/pods/vol-' }).first().waitFor({ timeout: 15000 });
check('pod sealed and mounted from /pods/', (await page.locator('.item', { hasText: '/pods/vol-' }).count()) >= 1);
await page.getByRole('button', { name: 'Stream vs burst' }).first().click();
await page.waitForSelector('text=Stream M(t) peak', { timeout: 15000 });
check('stream vs burst measured', true, await page.locator('text=Stream M(t) peak').innerText());
await page.screenshot({ path: `${OUT}/06-pods.png` });
await back();

await openTool('File System');
await page.locator('text=/Backend: (OPFS|IndexedDB)/').waitFor({ timeout: 5000 });
const backend = await page.locator('text=Backend:').innerText();
check('file system backend', /OPFS|IndexedDB/.test(backend), backend.split('·')[0]);
await page.getByRole('button', { name: '+ File' }).click(); // prompt -> notes.md
await page.waitForSelector('textarea[aria-label^="Editing"]');
await page.fill('textarea[aria-label^="Editing"]', '# Jade Atelier');
check('dot unsaved shown', (await page.locator('b.mono', { hasText: '● /' }).count()) === 1);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(300);
check('saved clears dot', (await page.locator('b.mono', { hasText: '● /' }).count()) === 0);
await back();

await openTool('Neutron Star');
await page.locator('text=/^[1-9]\\d* fps/').waitFor({ timeout: 6000 }).catch(() => {});
const fpsText = await page.locator('text=/fps/').innerText();
check('neutron star animating', /^[1-9]\d* fps/.test(fpsText), fpsText.split('·')[0]);
const canvasW = await page.$eval('canvas.star', (c) => c.width / c.getBoundingClientRect().width);
check('canvas DPR capped at 1.5', Math.abs(canvasW - 1.5) < 0.05, `ratio ${canvasW.toFixed(2)}`);
await page.screenshot({ path: `${OUT}/07-neutron.png` });
await back();

await openTool('Prism Ring');
await page.locator('.ring path').nth(1).click();
check('prism ring selects domain', (await page.locator('.card', { hasText: 'lens' }).count()) === 1);
await page.screenshot({ path: `${OUT}/08-prism.png` });
await back();

await openTool('Knowledge Matrix');
await page.locator('.heat .cell').first().waitFor();
check('24 matrix cells', (await page.locator('.heat .cell').count()) === 24);
await back();

await openTool('Battery Lab');
await page.getByRole('button', { name: /Trigger handshake/ }).click();
await page.waitForSelector('.handshake', { timeout: 5000 });
const hs = await page.locator('.handshake p').innerText();
check('conscious handshake glow shown', hs.startsWith('My battery is running low.'));
const hsH = await page.$eval('.handshake', (e) => e.getBoundingClientRect().height / window.innerHeight);
check('handshake is ~quarter screen', hsH >= 0.24 && hsH <= 0.3, hsH.toFixed(2));
await page.screenshot({ path: `${OUT}/09-handshake.png` });
await page.getByRole('button', { name: 'Yes, pod it' }).click();
await page.waitForSelector('.toast >> text=Sealed', { timeout: 10000 });
check('handshake sealed a pod', true, await page.locator('.toast').innerText());
check('header shows sovereign mode', (await page.locator('.brand >> text=sovereign').count()) === 1);
await page.getByRole('button', { name: 'Live sensors' }).click();
await back();

await openTool('Transparency');
await page.getByRole('button', { name: 'Verify chain' }).click();
await page.waitForSelector('text=/Chain intact/');
check('transparency chain verifies', true, await page.locator('text=/Chain intact/').innerText());
await back();

// --- Asset Store -----------------------------------------------------------------
await page.getByRole('button', { name: 'Asset Store' }).click();
await page.waitForSelector('.asset');
const shown = await page.locator('.asset').count();
check('asset store lists <=100 MB models by default', shown > 30 && shown < 100, `${shown} shown`);
await page.fill('input[type=search]', 'MiniLM-L6');
const card = page.locator('.asset', { hasText: 'all-MiniLM-L6-v2' });
await card.getByRole('button', { name: 'Download' }).click();
await card.locator('text=✓ on device').waitFor({ timeout: 15000 });
check('download stored on device', true);
await page.fill('input[type=search]', '');
await page.screenshot({ path: `${OUT}/10-assets.png` });

// persistence across reload (encrypted autosave)
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Router' }).click();
await page.waitForSelector('.msg.assistant', { timeout: 10000 });
check('encrypted autosave survives reload', (await page.locator('.msg').count()) >= 2);

const real = errors.filter((e) => !/Failed to load resource/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
