import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 'bliza-ui-'));
const port = '4189';
const base = `http://127.0.0.1:${port}`;
assert(
	process.env.OPENRAILS_TOKEN,
	'Set the server-side OPENRAILS_TOKEN before running the UI check'
);
const adminKey=randomBytes(32).toString('hex');
const namespace = `bliza_ui_${randomUUID().replaceAll('-', '')}`;
const server = Bun.spawn([process.execPath, '--no-env-file', 'build/index.js'], {
	env: {
		...process.env,
		OPENRAILS_URL: process.env.OPENRAILS_URL || 'http://192.168.0.124:8787',
		OPENRAILS_NAMESPACE: namespace,
		BODY_SIZE_LIMIT: '6M',
		ADMIN:adminKey,SEED_DEMO:'true',REQUIRE_APPROVAL:'true',
		PORT: port,
		HOST: '127.0.0.1',
		ORIGIN: base
	},
	stdout: 'ignore',
	stderr: 'inherit'
});
let browser;let disabledServer;let secondServer;
try {
	let ready = false;
	for (let i = 0; i < 100; i++) {
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
	page.on('console',(message)=>{if(/hydration/i.test(message.text()))errors.push(message.text());});
	await page.goto(base);
	await page.waitForLoadState('networkidle');
	assert.equal(await page.locator('article.post').count(), 9, 'Seeded feed');
	const contrast = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d');
		const style = getComputedStyle(document.documentElement);
		const luminance = (token) => {
			context.fillStyle = style.getPropertyValue(token).trim();
			context.fillRect(0, 0, 1, 1);
			const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
				v /= 255;
				return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			});
			return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
		};
		return [
			['--ink', '--sheet'],
			['--ink-caption', '--paper'],
			['--ink-muted', '--sheet'],
			['--blip-orange', '--sheet'],
			['--blip-orange', '--blip-paper'],
			['--blip-orange', '--hello-paper'],
			['--link', '--sheet'],
			['--green', '--green-paper']
		].map(([text, background]) => {
			const a = luminance(text);
			const b = luminance(background);
			return { text, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
		});
	});
	for (const pair of contrast)
		assert(pair.ratio >= 4.5, `AA text contrast: ${pair.text} on ${pair.background}`);
	await page.screenshot({ path: join(directory, 'desktop.png') });
	for (const id of [1, 2]) {
		const entry = page.locator(`#post-${id}`);
		for (const width of [1440, 390, 320]) {
			await page.setViewportSize({ width, height: 1080 });
			await entry.scrollIntoViewIfNeeded();
			const before = await entry.locator('summary').boundingBox();
			await entry.locator('summary').click();
			const layout = await entry.evaluate((node) => {
				const rect = (selector) => node.querySelector(selector).getBoundingClientRect().toJSON();
				return {
					row: rect('.post-bottom'),
					like: rect('.like-button'),
					summary: rect('summary'),
					save: rect('.save-form button'),
					thread: rect('.reply-thread'),
					field: rect('.reply-form textarea'),
					submit: rect('.reply-form button')
				};
			});
			assert(
				Math.abs(layout.summary.x - before.x) < 1 && Math.abs(layout.summary.y - layout.like.y) < 1,
				`Stable action row: post ${id} at ${width}px`
			);
			assert(Math.abs(layout.save.y - layout.like.y) < 1, 'Save stays on the action row');
			assert(layout.thread.top >= layout.summary.bottom + 7, 'Replies open below the action row');
			assert(
				Math.abs(layout.thread.width - layout.row.width) < 1,
				'Reply thread fills the available width'
			);
			assert(
				Math.abs(layout.field.width - layout.thread.width) < 1,
				'Reply textarea is full width'
			);
			assert(layout.submit.top >= layout.field.bottom + 7, 'Submit sits below the textarea');
			assert(Math.abs(layout.submit.right - layout.field.right) < 1, 'Submit aligns right');
			assert.equal(
				await page.evaluate(() => document.documentElement.scrollWidth),
				width,
				'Expanded replies do not overflow'
			);
			if (width !== 320)
				await entry.screenshot({ path: join(directory, `replies-${id}-${width}.png`) });
			await entry.locator('summary').focus();
			await page.keyboard.press('Space');
			assert.equal(
				await entry.locator('details').getAttribute('open'),
				null,
				'Keyboard collapses replies'
			);
		}
	}
	await page.setViewportSize({ width: 1440, height: 1080 });
	await page.getByRole('button', { name: 'Twój profil', exact: true }).click();
	await page.getByLabel('Twój nick', { exact: true }).fill('testowy_sąsiad');
	await page.getByRole('button', { name: 'Zapisz nick' }).click();
	await page.locator('dialog[open]').waitFor({ state: 'hidden' });
	assert.equal(await page.locator('.profile-name').innerText(), 'testowy_sąsiad');

	assert(await page.getByRole('button',{name:'Zapytaj',exact:true}).isDisabled(),'Guests need moderator approval before publishing');
	const ownerId=new URL(await page.locator('.profile-numbers a').first().getAttribute('href'),base).searchParams.get('user');
	await page.getByRole('button',{name:'Twój profil',exact:true}).click();
	await page.getByLabel('Kilka słów do moderatora').fill('Testuję portal z moderatorami naszej społeczności.');
	await page.getByRole('button',{name:'Poproś o zatwierdzenie konta'}).click();
	await page.locator('.verification-code').waitFor();
	const approvalCode=await page.locator('.verification-code').innerText();
	await page.screenshot({path:join(directory,'profile-verification.png')});
	await page.keyboard.press('Escape');
	const adminBrowser=await browser.newContext({viewport:{width:1440,height:1080}});
	const moderator=await adminBrowser.newPage();moderator.on('pageerror',(error)=>errors.push(error.message));
	await moderator.goto(`${base}/admin`);
	assert.equal((await page.request.post(`${base}/admin?/moderate`,{headers:{origin:base,accept:'application/json','x-sveltekit-action':'true'},form:{kind:'user',id:ownerId,operation:'approve',reason:'Bez uprawnień'}})).status(),401,'Ordinary accounts cannot moderate');
	await moderator.getByLabel('Klucz administratora').fill(adminKey);
	await moderator.getByRole('button',{name:'Wejdź do pokoju'}).click();
	await moderator.getByRole('link',{name:'Konta',exact:true}).waitFor();
	await moderator.goto(`${base}/admin?view=users&target=${ownerId}`);
	const accountRow=moderator.locator(`article[data-id="${ownerId}"]`);
	await accountRow.getByLabel('Powód działania').fill('Kontakt i kod potwierdzone w testach.');
	await accountRow.getByLabel('Kod właściciela',{exact:true}).fill(approvalCode);
	await accountRow.getByLabel('Potwierdzam ręczny kontakt z właścicielem i zgodność kodu.').check();
	await accountRow.getByRole('button',{name:'Zapisz działanie'}).click();
	await moderator.getByRole('status').waitFor();
	await page.reload();
	assert(!(await page.getByRole('button',{name:'Zapytaj',exact:true}).isDisabled()),'Approval unlocks publishing');
	await page
		.getByLabel('Twoje pytanie', { exact: true })
		.fill('Czy OpenRails pamięta nasze rozmowy?');
	await page.getByRole('button', { name: '+ Dodaj opis', exact: true }).click();
	await page
		.getByLabel('Dopowiedz coś więcej', { exact: false })
		.fill('To pytanie sprawdza trwały zapis. #sprawdzam');
	await page.getByLabel('Kategoria wpisu', { exact: true }).selectOption('Komputery i internet');
	await page.getByRole('button', { name: 'Zapytaj', exact: true }).click();
	const post = page
		.locator('article.post')
		.filter({ hasText: 'Czy OpenRails pamięta nasze rozmowy?' });
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
	assert.match(await page.locator('article.post').innerText(), /Czy OpenRails/);
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
	const picker = page.getByLabel('Zdjęcie do blipa', { exact: true });
	await picker.setInputFiles('static/images/mountains.jpg');
	await page.locator('.image-preview').waitFor();
	await page.getByRole('button', { name: 'Usuń wybrane zdjęcie', exact: true }).click();
	assert.equal(await page.locator('.image-preview').count(), 0, 'Selected image can be removed');
	await picker.setInputFiles('static/images/mountains.jpg');
	await page.screenshot({ path: join(directory, 'upload-preview.png') });
	await page.getByRole('button', { name: 'Blipnij', exact: true }).click();
	const blip = page
		.locator('article.post')
		.filter({ hasText: 'Krótki blip, długa pamięć. #sprawdzam' });
	await blip.waitFor();
	assert.match(await blip.locator('.post-kind').innerText(), /blip/);
	const imagePath = await blip.locator('.post-photo img').getAttribute('src');
	assert.match(imagePath, /^\/media\/[a-f0-9-]{36}\.webp$/);
	const image = await page.request.get(`${base}${imagePath}`);
	assert.equal(image.status(), 200, 'Uploaded image streams through the portal');
	assert.equal(image.headers()['content-type'], 'image/webp');
	assert.equal(image.headers()['cache-control'],'private, no-store');
	assert.equal(image.headers()['x-content-type-options'], 'nosniff');
	assert.equal((await image.body()).subarray(0,4).toString(),'RIFF','Uploads are decoded and re-encoded without metadata');
	assert.equal(
		await page.locator('.image-preview').count(),
		0,
		'Successful submission clears the preview'
	);
	await page.reload();
	assert.equal(
		await blip.locator('.post-photo img').getAttribute('src'),
		imagePath,
		'Image reference survives reload'
	);
	await blip.getByRole('button',{name:'Zgłoś wpis',exact:true}).click();
	await page.getByLabel('Dlaczego zgłaszasz tę treść?').fill('Sprawdźmy, czy zgłoszenie trafia do moderatora.');
	await page.getByRole('button',{name:'Wyślij zgłoszenie'}).click();
	await page.getByRole('dialog',{name:'Coś tu nie gra?'}).waitFor({state:'hidden'});
	await moderator.goto(`${base}/admin?view=reports`);
	await moderator.getByText('Sprawdźmy, czy zgłoszenie trafia do moderatora.',{exact:false}).waitFor();
	await moderator.getByRole('link',{name:'Przejdź do zgłoszonej treści'}).click();
	const blipId=imagePath.match(/([a-f0-9-]{36})\.webp$/)[1];
	const imageRow=moderator.locator(`article[data-id="${blipId}"]`);
	await imageRow.getByLabel('Powód działania').fill('Ukrywanie i kontrola dostępu do zdjęcia.');
	const hideResponse=moderator.waitForResponse((r)=>new URL(r.url()).pathname==='/admin' && new URL(r.url()).searchParams.has('/moderate') && r.request().method()==='POST');
	await imageRow.getByRole('button',{name:'Zapisz działanie'}).click();
	const hideResult=await hideResponse;assert.equal(hideResult.status(),200,await hideResult.text());
	await moderator.getByText('Ukryte przez moderatora',{exact:true}).waitFor();
	assert.equal((await page.request.get(`${base}${imagePath}`)).status(),404,'Hidden image is not publicly accessible');
	const privatePreview=await imageRow.getByRole('link',{name:'Podgląd zdjęcia'}).getAttribute('href');
	assert.equal((await adminBrowser.request.get(`${base}${privatePreview}`)).status(),200,'Moderator retains authorized preview');
	assert.equal((await page.request.get(`${base}${privatePreview}`)).status(),401,'Ordinary profiles cannot preview hidden media');
	await page.reload();assert.equal(await blip.count(),0,'Hidden post leaves the public feed');
	await imageRow.getByLabel('Działanie').selectOption('restore');
	await imageRow.getByLabel('Powód działania').fill('Przywracamy treść po zakończeniu kontroli.');
	await imageRow.getByRole('button',{name:'Zapisz działanie'}).click();
	await moderator.getByText('Widoczne',{exact:true}).waitFor();
	assert.equal((await page.request.get(`${base}${imagePath}`)).status(),200,'Restored image is accessible again');
	await page.reload();
	await page.getByLabel('Szukaj pytań, blipów i ludzi').fill('Czy OpenRails');
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
	assert.equal(missingPost.status(), 404, 'Server validates post target');
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
	const spoofedImage = await page.request.post(`${base}/?/publish`, {
		headers,
		multipart: {
			kind: 'blip',
			body: 'bad image',nonce:randomUUID(),
			category: 'Codzienność',
			image: {
				name: 'fake.png',
				mimeType: 'image/png',
				buffer: Buffer.from('<svg onload="alert(1)"/>')
			}
		}
	});
	assert.equal(spoofedImage.status(), 400, 'Server checks actual image bytes');
	const hugeImage = await page.request.post(`${base}/?/publish`, {
		headers,
		multipart: {
			kind: 'blip',
			body: 'too big',nonce:randomUUID(),
			category: 'Codzienność',
			image: { name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }
		}
	});
	assert.equal(hugeImage.status(), 400, 'Server enforces the 5 MB image limit');
	const questionImage = await page.request.post(`${base}/?/publish`, {
		headers,
		multipart: {
			kind: 'question',
			title: 'Zdjęcie do pytania?',nonce:randomUUID(),
			category: 'Codzienność',
			image: {
				name: 'photo.jpg',
				mimeType: 'image/jpeg',
				buffer: Buffer.from(await Bun.file('static/images/mountains.jpg').arrayBuffer())
			}
		}
	});
	assert.equal(questionImage.status(), 400, 'Attachments are only accepted on blips');
	assert.equal(
		(await page.request.get(`${base}/media/secret.txt`)).status(),
		404,
		'Media route cannot read arbitrary service files'
	);
	await page.goto(`${base}/?q=bad%20image`);
	assert.equal(
		await page.locator('article.post').count(),
		0,
		'Rejected upload does not create a post'
	);

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
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Mam bilet!', exact: true }).click();
	const machine = page.getByRole('dialog', { name: 'Bilet powrotny.', exact: true });
	await machine.waitFor();
	await page.screenshot({ path: join(directory, 'ticket-mobile.png'), animations: 'disabled' });
	await page.setViewportSize({ width: 1440, height: 1080 });
	await page.screenshot({ path: join(directory, 'ticket-desktop.png'), animations: 'disabled' });
	await page.setViewportSize({ width: 320, height: 700 });
	assert(
		await machine.evaluate((node) => node.scrollWidth <= node.clientWidth),
		'Ticket machine fits a 320px screen'
	);
	await machine.getByLabel('Bilet powrotny w pliku TXT', { exact: true }).focus();
	assert(
		await machine
			.getByLabel('Bilet powrotny w pliku TXT', { exact: true })
			.evaluate((node) => node === document.activeElement),
		'Native ticket picker is keyboard reachable'
	);
	await page.setViewportSize({ width: 390, height: 844 });
	assert(
		await machine.evaluate((node) => node.scrollWidth <= node.clientWidth),
		'Ticket machine fits the mobile screen'
	);
	const downloadEvent = page.waitForEvent('download');
	const issueResponse = page.waitForResponse(
		(response) => response.url() === `${base}/bilet` && response.request().method() === 'POST'
	);
	await machine.getByRole('button', { name: 'Zabierz swój nick do domu', exact: true }).click();
	const download = await downloadEvent;
	assert.equal(download.suggestedFilename(), 'bilet-powrotny.txt');
	const ticketPath = join(directory, 'bilet-powrotny.txt');
	await download.saveAs(ticketPath);
	const ticketText = await Bun.file(ticketPath).text();
	const credential = ticketText.match(/^bliza-ticket-v1:([^:]+):([^:]+):([a-f0-9]{64})$/m);
	assert(credential, 'Download contains a versioned random recovery key');
	const issue = await issueResponse;
	assert.equal(
		issue.headers()['cache-control'],
		'no-store',
		'Credential download cannot be cached'
	);
	assert.match(issue.headers()['content-disposition'], /attachment/);
	assert(
		!ticketText.includes(process.env.OPENRAILS_TOKEN),
		'Ticket never contains the service key'
	);
	await machine
		.getByLabel('Unieważnij mój poprzedni bilet, wyloguj inne urządzenia i wydaj nowy.', { exact: true })
		.waitFor();
	assert(
		!(await page.content()).includes(credential[3]),
		'Recovery key is not serialized in page HTML'
	);
	assert.equal(
		(await page.request.post(`${base}/bilet`, { headers: { origin: base }, form: {} })).status(),
		409,
		'A ticket cannot be replaced without explicit consent'
	);
	assert.equal(
		(
			await page.request.post(`${base}/bilet`, {
				headers: { origin: 'https://another-site.test' },
				form: { replace: 'yes' }
			})
		).status(),
		403,
		'Ticket issuance is CSRF-protected'
	);
	assert.equal(
		(await page.request.get(`${base}/bilet`)).status(),
		405,
		'GET cannot issue credentials'
	);
	await machine.getByRole('button', { name: 'Zamknij kasownik', exact: true }).click();
	await page.getByRole('button', { name: 'Twój profil', exact: true }).click();
	await page.getByLabel('Twój nick', { exact: true }).fill('sąsiad_z_biletem');
	await page.getByRole('button', { name: 'Zapisz nick', exact: true }).click();
	await page.locator('dialog[open]').waitFor({ state: 'hidden' });

	const isolated = await browser.newContext({ viewport: { width: 390, height: 844 } });
	assert.equal(
		(
			await isolated.request.post(`${base}/bilet`, { headers: { origin: base }, form: {} })
		).status(),
		401,
		'Issuance requires an existing authenticated cookie'
	);
	const other = await isolated.newPage();
	other.on('pageerror', (error) => errors.push(error.message));
	await other.goto(`${base}/?view=saved`);
	assert.equal(
		await other.locator('article.post').count(),
		0,
		'Saved posts are private to the browser profile'
	);
	const guestCookie = (await isolated.cookies()).find(
		(cookie) => cookie.name === 'bliza_session'
	).value;
	await other.goto(base);
	await other.locator('#post-1 summary').click();
	await other
		.locator('#post-1')
		.getByLabel('Twoja odpowiedź', { exact: true })
		.fill('Szkic poprzedniego profilu.');
	await other.getByRole('button', { name: 'Mam bilet!', exact: true }).click();
	const returnMachine = other.getByRole('dialog', { name: 'Bilet powrotny.', exact: true });
	const ticketPicker = returnMachine.getByLabel('Bilet powrotny w pliku TXT', { exact: true });
	await ticketPicker.setInputFiles({
		name: 'wrong.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from(ticketText.replace(credential[3], '0'.repeat(64)))
	});
	await returnMachine.getByRole('button', { name: 'Wracam do siebie', exact: true }).click();
	await returnMachine.getByRole('alert').waitFor();
	assert.match(await returnMachine.getByRole('alert').innerText(), /nie rozpoznaje/);
	assert.equal(
		(await isolated.cookies()).find((cookie) => cookie.name === 'bliza_session').value,
		guestCookie,
		'Rejected ticket leaves the original session unchanged'
	);
	assert.equal(
		await other.locator('#post-1').getByLabel('Twoja odpowiedź', { exact: true }).inputValue(),
		'Szkic poprzedniego profilu.',
		'Failed recovery keeps existing drafts'
	);
	const dropTarget = await ticketPicker.boundingBox();
	const drag = await isolated.newCDPSession(other);
	for (const type of ['dragEnter', 'dragOver', 'drop'])
		await drag.send('Input.dispatchDragEvent', {
			type,
			x: dropTarget.x + dropTarget.width / 2,
			y: dropTarget.y + dropTarget.height / 2,
			data: { items: [], files: [ticketPath], dragOperationsMask: 1 }
		});
	await drag.detach();
	assert.equal(
		await ticketPicker.evaluate((node) => node.files[0]?.name),
		'bilet-powrotny.txt',
		'Native file drop enters the ticket machine'
	);
	await returnMachine.getByRole('button', { name: 'Wracam do siebie', exact: true }).click();
	await returnMachine.waitFor({ state: 'hidden' });
	await other.waitForURL(base + '/');
	await other.getByRole('button', { name: 'Twój profil', exact: true }).click();
	assert.equal(
		await other.getByLabel('Twój nick', { exact: true }).inputValue(),
		'sąsiad_z_biletem',
		'Ticket restores the same identity after a nickname change'
	);
	await other.keyboard.press('Escape');
	const restoredCookie = (await isolated.cookies()).find(
		(cookie) => cookie.name === 'bliza_session'
	);
	assert.notEqual(restoredCookie.value, guestCookie);
	assert.notEqual(
		restoredCookie.value,
		credential[3],
		'Recovery creates a fresh session rather than using the recovery key as a cookie'
	);
	assert.equal(
		await other.locator('#post-1').getByLabel('Twoja odpowiedź', { exact: true }).inputValue(),
		'',
		'Account switching clears the previous profile reply draft'
	);
	assert.equal(restoredCookie.httpOnly, true);
	assert.equal(restoredCookie.sameSite, 'Lax');
	await other.goto(`${base}/?view=saved`);
	assert.equal(
		await other.locator('article.post').count(),
		1,
		'Account bookmarks return on another browser'
	);
	await other
		.locator('article.post')
		.getByRole('button', { name: /Cofnij polubienie/ })
		.waitFor();
	await other.locator('article.post summary').click();
	assert.match(await other.locator('.reply-thread').innerText(), /Tak! I odpowiedzi również/);
	await other.goto(`${base}/?view=following`);
	assert((await other.locator('article.post').count()) > 0, 'Account follows return');
	for (const name of await other.locator('article.post .post-byline .author-name').allInnerTexts())
		assert.equal(name, personName);

	await page.getByRole('button', { name: 'Mam bilet!', exact: true }).click();
	await machine.getByLabel('Unieważnij mój poprzedni bilet, wyloguj inne urządzenia i wydaj nowy.', { exact: true }).check();
	const replacementEvent = page.waitForEvent('download');
	await machine.getByRole('button', { name: 'Zabierz swój nick do domu', exact: true }).click();
	const replacement = await replacementEvent;
	const replacementPath = join(directory, 'bilet-nowy.txt');
	await replacement.saveAs(replacementPath);
	await page.waitForFunction(() => !document.querySelector('[name="replace"]').checked);
	assert.notEqual(await Bun.file(replacementPath).text(), ticketText);
	await other.getByRole('button', { name: 'Mam bilet!', exact: true }).click();
	await ticketPicker.setInputFiles(ticketPath);
	await returnMachine.getByRole('button', { name: 'Wracam do siebie', exact: true }).click();
	await returnMachine.getByRole('alert').waitFor();
	assert.match(await returnMachine.getByRole('alert').innerText(), /zastąpiony/);
	await ticketPicker.setInputFiles(replacementPath);
	await returnMachine.getByRole('button', { name: 'Wracam do siebie', exact: true }).click();
	await returnMachine.waitFor({ state: 'hidden' });
	await other.waitForURL(base + '/');
	assert.equal(
		(
			await other.request.post(`${base}/?/recover`, { headers, form: { ticket: 'not a file' } })
		).status(),
		400,
		'Recovery requires a file, not arbitrary form text'
	);
	assert.equal(
		(
			await other.request.post(`${base}/?/recover`, {
				headers,
				multipart: {
					ticket: { name: 'large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(4097) }
				}
			})
		).status(),
		400,
		'Server enforces the 4 KB ticket limit'
	);
	assert.equal(
		(
			await other.request.post(`${base}/?/recover`, {
				headers: { ...headers, origin: 'https://another-site.test' },
				multipart: {
					ticket: {
						name: 'bilet.txt',
						mimeType: 'text/plain',
						buffer: Buffer.from(await Bun.file(replacementPath).text())
					}
				}
			})
		).status(),
		403,
		'Returning with a ticket is CSRF-protected'
	);
	await other.reload();
	await other.getByRole('button', { name: 'Twój profil', exact: true }).click();
	assert.equal(
		await other.getByLabel('Twój nick', { exact: true }).inputValue(),
		'sąsiad_z_biletem',
		'Restored account survives reload'
	);
	await page.keyboard.press('Escape');
	await other.keyboard.press('Escape');
	secondServer=Bun.spawn([process.execPath,'--no-env-file','build/index.js'],{env:{...process.env,OPENRAILS_NAMESPACE:namespace,ADMIN:adminKey,SEED_DEMO:'true',REQUIRE_APPROVAL:'true',BODY_SIZE_LIMIT:'6M',HOST:'127.0.0.1',PORT:'4191',ORIGIN:base},stdout:'ignore',stderr:'inherit'});
	let siblingReady=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4191/healthz')).ok){siblingReady=true;break;}}catch{}await Bun.sleep(100);}
	assert(siblingReady,'Second application instance starts against the same backend');
	assert.equal((await isolated.request.post('http://127.0.0.1:4191/?/like',{headers,form:{id:blipId}})).status(),200,'Recovered session works on a second process before revocation');
	await page.getByRole('button',{name:'Twój profil',exact:true}).click();
	const remoteSession=page.locator('.account-sessions form[name="session"]').first();
	await remoteSession.getByRole('button',{name:/Wyloguj sesję/}).click();
	await remoteSession.waitFor({state:'hidden'});
	const revokeCheck=await isolated.request.post('http://127.0.0.1:4191/?/like',{headers,form:{id:blipId}});
	assert.equal(revokeCheck.status(),401,'Remote revocation is enforced by an independent application process');
	await page.keyboard.press('Escape');
	await moderator.goto(`${base}/admin?view=users&target=${ownerId}`);
	await accountRow.getByLabel('Działanie').selectOption('ban');await accountRow.getByLabel('Powód działania').fill('Kontrola blokady i wylogowania wszystkich urządzeń.');await accountRow.getByRole('button',{name:'Zapisz działanie'}).click();
	await moderator.getByText(/Zablokowane/).waitFor();
	assert.equal((await page.request.post(`${base}/?/like`,{headers,form:{id:blipId}})).status(),401,'Banned account cannot mutate');
	assert.equal((await page.request.get(`${base}${imagePath}`)).status(),404,'Banned author images are inaccessible');
	assert.equal((await page.request.post(`${base}/?/recover`,{headers,multipart:{ticket:{name:'return.txt',mimeType:'text/plain',buffer:Buffer.from(await Bun.file(replacementPath).text())}}})).status(),401,'Banned account cannot recover');
	await accountRow.getByLabel('Działanie').selectOption('unban');await accountRow.getByLabel('Powód działania').fill('Kończymy test blokady konta.');await accountRow.getByRole('button',{name:'Zapisz działanie'}).click();
	await moderator.getByText(/Aktywne/).waitFor();
	assert.equal((await page.request.post(`${base}/?/like`,{headers,form:{id:blipId}})).status(),401,'Unbanning does not resurrect revoked sessions');
	assert.equal((await page.request.post(`${base}/?/recover`,{headers,multipart:{ticket:{name:'return.txt',mimeType:'text/plain',buffer:Buffer.from(await Bun.file(replacementPath).text())}}})).status(),200,'Ticket can restore an unbanned account');
	await page.reload();
	assert.equal((await page.request.post(`${base}/admin?/cleanup`,{headers,form:{confirmed:'yes'}})).status(),401,'Cleanup requires administrator authentication');
	assert.equal((await adminBrowser.request.post(`${base}/admin?/cleanup`,{headers,form:{}})).status(),400,'Cleanup requires explicit confirmation');
	disabledServer=Bun.spawn([process.execPath,'--no-env-file','build/index.js'],{env:{...process.env,OPENRAILS_NAMESPACE:namespace,ADMIN:'',REQUIRE_APPROVAL:'false',BODY_SIZE_LIMIT:'6M',HOST:'127.0.0.1',PORT:'4190',ORIGIN:base},stdout:'ignore',stderr:'inherit'});
	let disabledReady=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4190/admin')).status===404){disabledReady=true;break;}}catch{}await Bun.sleep(100);}
	assert(disabledReady,'Blank ADMIN disables the admin page');
	assert.equal((await adminBrowser.request.post('http://127.0.0.1:4190/admin?/moderate',{headers,form:{kind:'user',id:ownerId,operation:'ban',reason:'Nie powinno działać'}})).status(),404,'Blank ADMIN disables mutations despite an existing administrator cookie');
	const optionalContext=await browser.newContext({javaScriptEnabled:false}),optionalPage=await optionalContext.newPage();
	const optionalBase='http://127.0.0.1:4190';await optionalPage.goto(optionalBase);
	assert.equal(await optionalPage.locator('.verification-notice').count(),0,'Optional approval hides the publishing notice');
	assert(!(await optionalPage.getByRole('button',{name:'Zapytaj',exact:true}).isDisabled()),'Unapproved visitor can use the composer when approval is optional');
	const optionalPublish=await optionalContext.request.post(`${optionalBase}/?/publish`,{headers,form:{kind:'question',title:'Czy zatwierdzenie może być dobrowolne?',body:'Sprawdzamy opcję serwera.',category:'Codzienność',nonce:await optionalPage.locator('input[name="nonce"]').inputValue()}});
	assert.equal(optionalPublish.status(),200,'Server allows unapproved publication with REQUIRE_APPROVAL=false');
	await optionalPage.reload();const optionalPost=optionalPage.locator('article.post').filter({hasText:'Czy zatwierdzenie może być dobrowolne?'});
	await optionalPost.locator('summary').click();
	assert(!(await optionalPost.getByRole('button',{name:'Odpowiedz',exact:true}).isDisabled()),'Optional approval enables reply controls');
	assert.equal((await optionalContext.request.post(`${optionalBase}/?/reply`,{headers,form:{id:await optionalPost.locator('.reply-form input[name="id"]').inputValue(),body:'Tak, ustawieniem środowiska.'}})).status(),200,'Server allows unapproved replies');
	await optionalContext.close();
	for(const width of [1440,390,320]) {
		await moderator.setViewportSize({width,height:844});await moderator.goto(`${base}/admin?view=posts`);
		assert.equal(await moderator.evaluate(()=>document.documentElement.scrollWidth),width,'Admin layout does not overflow');
		await moderator.screenshot({path:join(directory,`admin-${width}.png`),animations:'disabled'});
	}
	await moderator.goto(`${base}/admin?view=audit`);await moderator.getByText('Kontrola blokady i wylogowania wszystkich urządzeń.',{exact:false}).waitFor();
	assert(!(await page.content()).includes(adminKey),'ADMIN secret is never serialized in portal markup');
	let limited;
	for (let i = 0; i < 21; i++) {
		limited = await other.request.post(`${base}/?/recover`, { headers, form: { ticket: 'bad' } });
		if (limited.status() === 429) break;
	}
	assert.equal(limited.status(), 429, 'Repeated return attempts are throttled');
	await isolated.close();
	const noJS = await browser.newContext({ javaScriptEnabled: false });
	await noJS.addCookies(await context.cookies());
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
		`PASS: production UI, OpenRails writes/uploads, ticket download/recovery/rotation, validation, CSRF, profile isolation, keyboard and responsive checks. Namespace: ${namespace}. Screenshots: ${directory}`
	);
} finally {
	await browser?.close();
	server.kill();
	await server.exited;
	for(const child of [disabledServer,secondServer])if(child){child.kill();await child.exited;}
}
