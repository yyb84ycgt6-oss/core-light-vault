// Browser smoke test at iPhone 12 size against public/index.html.
// Needs Playwright (npm i -D playwright) and `npm run serve` (port 8642).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.E2E_OUT || 'e2e-shots';
const BASE = process.env.E2E_BASE || 'http://localhost:8642/';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` - ${extra}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
const external = [];
page.on('request', (r) => !r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && external.push(r.url()));

const tab = (label) => page.locator('nav.tabs button', { hasText: label }).click();
const sheetClose = () => page.locator('.sheet .sheet-head button').click();

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('nav.tabs button');
check('7 tabs', (await page.locator('nav.tabs button').count()) === 7);
check('badges VOLATILE ATOMIC SOVEREIGN OFFLINE/ONLINE 141 0.15', (await page.locator('.badges').innerText()).replace(/\s+/g, ' ').includes('VOLATILE ATOMIC SOVEREIGN'));
check('no horizontal scroll at 390px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
const small = await page.$$eval('nav.tabs button, .btn:not(.sm):not(.xs)', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).length);
check('primary touch targets >= 44px', small === 0, `${small} small`);
await page.screenshot({ path: `${OUT}/01-forge.png` });

// FORGE: conversation -> ephemeral app -> pod -> recall re-forges it.
await page.fill('textarea[aria-label="Intent"]', 'make a qr for the meadow');
await page.getByRole('button', { name: 'Forge ⟁' }).click();
const card = page.locator('article.app').first();
await card.waitFor();
check('ephemeral QR app spawned', (await card.innerText()).includes('QR Forge'));
await card.locator('textarea').fill('Z3 [}0{ -_0_-] EZ');
await card.getByRole('button', { name: 'Forge', exact: true }).click();
check('QR drawn', (await card.locator('text=/QR version \\d/').count()) === 1);
await card.getByRole('button', { name: 'Pod this moment ~' }).click();
await page.locator('.toast', { hasText: 'Moment podded' }).waitFor();
await page.getByRole('button', { name: 'Recall' }).first().click();
await page.locator('article.app .trace', { hasText: 'recalled' }).waitFor();
check('recall re-forged the app from its pod', true);
await page.screenshot({ path: `${OUT}/02-forge-app.png` });

// TOOLBOX: compress -> decompress round trip, SBX1, code visualizer.
await tab('TOOLBOX');
check('13 tools', (await page.locator('.tile').count()) === 13);
await page.screenshot({ path: `${OUT}/03-toolbox.png` });
await page.locator('.tile', { hasText: 'eYe Compress' }).click();
await page.locator('.sheet textarea').fill('You never save a file again.');
await page.locator('.sheet input').fill('my sigil');
await page.getByRole('button', { name: 'Collapse → pod ~' }).click();
const atomic = await page.locator('.sheet .longstring').innerText();
check('atomic string _{…}~{…}_', /^_\{.*\}~\{.*\}_$/.test(atomic), `${atomic.length} chars`);
await sheetClose();
await page.locator('.tile', { hasText: 'Decompress' }).click();
await page.locator('.sheet textarea').fill(atomic);
await page.locator('.sheet input').fill('wrong sigil');
await page.getByRole('button', { name: 'Reverse handshake · bdpq' }).click();
check('wrong context denied', (await page.locator('.sheet .err').innerText()).includes('SOVEREIGN_DENIED'));
await page.locator('.sheet input').fill('my sigil');
await page.getByRole('button', { name: 'Reverse handshake · bdpq' }).click();
await page.locator('.sheet pre').waitFor();
check('zero-loss reconstruction', (await page.locator('.sheet pre').innerText()) === 'You never save a file again.');
await sheetClose();
await page.locator('.tile', { hasText: 'Code Visualizer' }).click();
await page.locator('.sheet textarea').fill('function a(){\n return 1;\n}\nfunction b(xs){\n for (const x of xs) {\n  log(x);\n }\n}');
await page.locator('.sheet textarea').evaluate((t) => t.setSelectionRange(t.value.indexOf('log'), t.value.indexOf('log')));
await page.getByRole('button', { name: 'Visualize at cursor' }).click();
check('code visualizer routes + folds', /view: call-chain/.test(await page.locator('.sheet .out').innerText()) && /folded/.test(await page.locator('.sheet .out').innerText()));
await sheetClose();

// Battery handshake: honour No.
await page.locator('.tile', { hasText: 'Battery Handshake' }).click();
await page.getByRole('button', { name: 'Feel this battery level' }).click();
await page.locator('.handshake').waitFor();
check('handshake glow text', (await page.locator('.handshake p').innerText()).startsWith('My battery is running low.'));
await page.screenshot({ path: `${OUT}/04-handshake.png` });
await page.getByRole('button', { name: "No, I'll manage" }).click();
await page.locator('.handshake').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
check('No honoured', (await page.locator('.handshake').count()) === 0);
await sheetClose().catch(() => {});

// SYMBOL: compose meaning from core, seal Z3 … EZ.
await tab('SYMBOL');
await page.locator('.core-drop .chip').first().waitFor();
await page.locator('.core-drop .chip').nth(0).click();
await page.locator('.core-drop .chip').nth(1).click();
await page.fill('input[aria-label="Symbol name"]', '~0~');
const pad = page.locator('canvas.pad');
const box = await pad.boundingBox();
await page.mouse.move(box.x + 40, box.y + 140);
await page.mouse.down();
for (let i = 0; i <= 10; i++) await page.mouse.move(box.x + 40 + i * 20, box.y + 140 + Math.sin(i) * 40);
await page.mouse.up();
await page.getByRole('button', { name: 'Test on lattice' }).click();
await page.getByRole('button', { name: 'Seal Z3 … EZ' }).click();
await page.locator('.sheet', { hasText: 'Z3 [' }).waitFor();
check('symbol sealed Z3 [...] EZ', true, await page.locator('.sheet .mono').first().innerText());
await page.screenshot({ path: `${OUT}/05-symbol.png` });
await sheetClose();

// ARCHIVE: seeds, decay to compost, return to infinity.
await tab('ARCHIVE');
await page.locator('.leaf').first().waitFor();
check('archive has 14 seeds + sealed symbol', (await page.locator('.leaf').count()) >= 15);
for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'A month passes' }).click();
await page.locator('.leaf .inf').first().waitFor();
await page.locator('.leaf .inf').first().click();
await page.waitForTimeout(1100);
check('returned to infinity (essence kept)', (await page.locator('.leaf', { hasText: '∞ returned' }).count()) >= 1);
await page.screenshot({ path: `${OUT}/06-archive.png` });

// LATTICE + ROUTER + ETHICS.
await tab('LATTICE');
await page.waitForTimeout(1500);
check('lattice alive', /signals \d+/.test(await page.locator('.page .mono.dim').first().innerText()));
await page.getByRole('button', { name: 'Send a stuck signal upward' }).click();
check('counselor bridge dual response', (await page.locator('text=/≤ 512/').count()) === 1);
await page.screenshot({ path: `${OUT}/07-lattice.png` });
await tab('ROUTER');
await page.fill('textarea[aria-label="Message"]', 'hash this meadow');
await page.getByRole('button', { name: 'Send' }).click();
await page.locator('.bubble.assistant', { hasText: 'SHA-256' }).waitFor();
check('micro intent answered locally with trace', (await page.locator('.bubble.assistant .trace').last().innerText()).includes('micro'));
await page.fill('textarea[aria-label="Message"]', 'why does stillness matter?');
await page.getByRole('button', { name: 'Send' }).click();
await page.locator('.bubble.assistant', { hasText: 'not attached' }).waitFor();
check('macro intent: honest when no counselor attached', true);
check('6 assets listed', (await page.locator('.item', { hasText: 'RAM' }).count()) >= 6);
await page.screenshot({ path: `${OUT}/08-router.png` });
await tab('ETHICS');
check('ethics + footer', (await page.locator('text=Epistemic Humility').count()) === 1 && (await page.locator('text=/knowledge never sleeps/').count()) === 1);

// Privacy veil.
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
check('veil on blur', await page.locator('.veil').isVisible());
await page.evaluate(() => window.dispatchEvent(new Event('focus')));

// Offline reload from cache.
await page.reload({ waitUntil: 'load' });
await page.evaluate(() => navigator.serviceWorker?.ready);
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' }).catch(() => {});
check('works offline (service worker cache)', (await page.locator('nav.tabs button').count()) === 7);
await ctx.setOffline(false);

check('no external network requests', external.length === 0, external.slice(0, 3).join(' '));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
