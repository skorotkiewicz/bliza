import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'bliza-ui-'));
const port = '4189';
const base = `http://127.0.0.1:${port}`;
const server = Bun.spawn([process.execPath, 'build/index.js'], {
	env: {
		...process.env,
		DB_PATH: join(directory, 'portal.sqlite'),
		PORT: port,
		HOST: '127.0.0.1',
		ORIGIN: base
	},
	stdout: 'ignore',
	stderr: 'inherit'
});
let browser;
try {
	let ready = false;
	for (let i = 0; i < 50; i++) {
		try {
			if ((await fetch(base)).ok) {
				ready = true;
				break;
			}
		} catch {}
		await Bun.sleep(100);
	}
	assert(ready, 'Production server starts');
	browser = await chromium.launch({
		executablePath: process.env.CHROMIUM_PATH || '/usr/sbin/chromium',
		headless: true,
		args: ['--no-sandbox']
	});
	const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(base);
	await page.waitForLoadState('networkidle');
	assert.equal(await page.locator('article.post').count(), 9, 'Seeded feed');
	await page.screenshot({ path: join(directory, 'desktop.png') });
	await page.getByRole('button', { name: 'Twój profil', exact: true }).click();
	await page.getByLabel('Twój nick', { exact: true }).fill('testowy_sąsiad');
	await page.getByRole('button', { name: 'Zapisz nick' }).click();
	await page.locator('dialog[open]').waitFor({ state: 'hidden' });
	assert.equal(await page.locator('.profile-name').innerText(), 'testowy_sąsiad');

	await page.getByLabel('Twoje pytanie', { exact: true }).fill('Czy SQLite pamięta nasze rozmowy?');
	await page.getByRole('button', { name: '+ Dodaj opis', exact: true }).click();
	await page
		.getByLabel('Dopowiedz coś więcej', { exact: false })
		.fill('To pytanie sprawdza trwały zapis. #sprawdzam');
	await page.getByLabel('Kategoria wpisu', { exact: true }).selectOption('Komputery i internet');
	await page.getByRole('button', { name: 'Zapytaj', exact: true }).click();
	const post = page.locator('#post-10');
	await post.waitFor();
	assert.match(await post.innerText(), /testowy_sąsiad/);
	await post.getByRole('button', { name: /Polub wpis/ }).click();
	await post.getByRole('button', { name: /Cofnij polubienie/ }).waitFor();
	await post.getByRole('button', { name: 'Zapisz na później', exact: true }).click();
	await post.getByRole('button', { name: 'Usuń z zapisanych', exact: true }).waitFor();
	await post.locator('summary').click();
	await post.getByLabel('Twoja odpowiedź', { exact: true }).fill('Tak! I odpowiedzi również.');
	await post.getByRole('button', { name: 'Odpowiedz', exact: true }).click();
	await page.getByText('Tak! I odpowiedzi również.', { exact: true }).waitFor();
	await page.reload();
	await post.getByRole('button', { name: /Cofnij polubienie/ }).waitFor();
	await post.getByRole('button', { name: 'Usuń z zapisanych', exact: true }).waitFor();
	await post.locator('summary').click();
	assert.match(await post.locator('.reply-thread').innerText(), /Tak! I odpowiedzi również/);

	await page.goto(`${base}/?view=saved`);
	assert.equal(await page.locator('article.post').count(), 1);
	assert.match(await page.locator('article.post').innerText(), /Czy SQLite/);
	await page.goto(base);
	const person = page.locator('.person').first();
	const personName = await person.locator('.person-info a').innerText();
	await person.getByRole('button', { name: /^Obserwuj / }).click();
	await person.getByRole('button', { name: /^Przestań obserwować / }).waitFor();
	await page.goto(`${base}/?view=following`);
	assert((await page.locator('article.post').count()) > 0);
	for (const name of await page.locator('article.post .post-byline .author-name').allInnerTexts())
		assert.equal(name, personName);

	await page.goto(base);
	await page.getByRole('button', { name: 'Napisz blipa', exact: true }).click();
	await page.getByLabel('Twój blip', { exact: true }).fill('Krótki blip, długa pamięć. #sprawdzam');
	await page.getByRole('button', { name: 'Blipnij', exact: true }).click();
	await page.locator('#post-11').waitFor();
	assert.match(await page.locator('#post-11 .post-kind').innerText(), /blip/);
	await page.getByLabel('Szukaj pytań, blipów i ludzi').fill('Czy SQLite');
	await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
	await page.waitForURL(/q=/);
	assert.equal(await page.locator('article.post').count(), 1);
	await page.goto(`${base}/?tag=sprawdzam`);
	assert.equal(await page.locator('article.post').count(), 2);
	await page.goto(`${base}/?type=blip`);
	assert((await page.locator('article.post').count()) > 0);
	for (const badge of await page.locator('.post-kind').allInnerTexts())
		assert.equal(badge.trim(), 'blip');
	await page.goto(`${base}/?view=unanswered`);
	for (const replies of await page.locator('article.post summary strong').allInnerTexts())
		assert.equal(replies, '0');

	const headers = { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' };
	const invalid = await page.request.post(`${base}/?/publish`, {
		headers,
		form: { kind: 'blip', body: 'x'.repeat(161), category: 'Codzienność' }
	});
	assert.equal(invalid.status(), 400, 'Server rejects oversized blips');
	const wrongCategory = await page.request.post(`${base}/?/publish`, {
		headers,
		form: { kind: 'question', title: 'Test pytania', body: '', category: 'made up' }
	});
	assert.equal(wrongCategory.status(), 400, 'Server validates category');
	const missingPost = await page.request.post(`${base}/?/like`, {
		headers,
		form: { id: '999999' }
	});
	assert.equal(missingPost.status(), 400, 'Server validates post target');
	const duplicateName = await page.request.post(`${base}/?/profile`, {
		headers,
		form: { name: 'kasia_po_godzinach' }
	});
	assert.equal(duplicateName.status(), 400, 'Cannot impersonate an existing nickname');
	const crossSite = await page.request.post(`${base}/?/publish`, {
		headers: { ...headers, origin: 'https://another-site.test' },
		form: { kind: 'blip', body: 'csrf', category: 'Codzienność' }
	});
	assert.equal(crossSite.status(), 403, 'Cross-origin writes are rejected');

	await page.goto(base);
	await page.setViewportSize({ width: 390, height: 844 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth),
		390,
		'No mobile horizontal overflow'
	);
	await page.screenshot({ path: join(directory, 'mobile.png') });
	await page.getByRole('button', { name: 'Twój profil', exact: true }).click();
	await page.keyboard.press('Escape');
	await page.locator('dialog[open]').waitFor({ state: 'hidden' });
	assert(
		await page
			.getByRole('button', { name: 'Twój profil', exact: true })
			.evaluate((node) => node === document.activeElement),
		'Dialog restores keyboard focus'
	);
	await page.setViewportSize({ width: 320, height: 700 });
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth),
		320,
		'No narrow-screen overflow'
	);
	const isolated = await browser.newContext();
	const other = await isolated.newPage();
	await other.goto(`${base}/?view=saved`);
	assert.equal(
		await other.locator('article.post').count(),
		0,
		'Saved posts are private to the browser profile'
	);
	await isolated.close();
	const noJS = await browser.newContext({ javaScriptEnabled: false });
	const plain = await noJS.newPage();
	await plain.goto(base);
	await plain
		.getByLabel('Twoje pytanie', { exact: true })
		.fill('Czy formularze działają bez JavaScript?');
	await plain.getByRole('button', { name: 'Zapytaj', exact: true }).click();
	await plain.waitForLoadState('networkidle');
	assert.match(await plain.locator('article.post').first().innerText(), /bez JavaScript/);
	await noJS.close();
	assert.deepEqual(errors, [], 'No browser runtime errors');
	console.log(
		`PASS: production UI, SQLite writes, validation, CSRF, profile isolation, keyboard and responsive checks. Screenshots: ${directory}`
	);
} finally {
	await browser?.close();
	server.kill();
	await server.exited;
}
