import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { openStore } from './db.js';
import { uploadImage, MAX_IMAGE_SIZE } from './images.js';
import { formatTicket, parseTicket, allowRecovery, MAX_TICKET_SIZE } from './tickets.js';
import { createHash } from 'node:crypto';

test.skipIf(!process.env.OPENRAILS_TOKEN)(
	'OpenRails persists conversations, isolated sessions and relations across store recreation',
	async () => {
		const namespace = `bliza_test_${randomUUID().replaceAll('-', '')}`;
		let local = openStore(namespace);
		const { user, token } = await local.visitor();
		const other = await local.visitor();
		expect(other.user.id).not.toBe(user.id);
		expect((await local.visitor(user.id)).user.id).not.toBe(user.id);
		expect((await local.visitor(token)).user.id).toBe(user.id);
		const id = await local.addPost(
			user.id,
			'question',
			'Jak działa zapis danych?',
			'Sprawdzamy OpenRails! #Test #test',
			'Komputery i internet'
		);
		await local.reply(id, other.user.id, 'Działa po ponownym uruchomieniu.');
		expect(await local.toggle('likes', other.user.id, id)).toBe(true);
		expect(await local.toggle('bookmarks', other.user.id, id)).toBe(true);
		expect(await local.toggle('follows', other.user.id, user.id)).toBe(true);
		local = openStore(namespace);
		const query = (params) => local.feed(other.user.id, new URLSearchParams(params));
		const saved = (await query({ view: 'saved' })).posts[0];
		expect(saved.id).toBe(id);
		expect(saved.likes).toBe(1);
		expect(saved.saved).toBe(1);
		expect(saved.replies[0].body).toBe('Działa po ponownym uruchomieniu.');
		expect((await query({ view: 'following' })).posts[0].id).toBe(id);
		const ticket = await local.issueTicket(other.user);
		const credential = parseTicket(ticket, namespace);
		expect((await local.collections.tickets.get(other.user.id)).hash).toBe(
			createHash('sha256').update(credential.secret).digest('hex')
		);
		expect(JSON.stringify(await local.collections.users.get(other.user.id))).not.toContain(
			credential.secret
		);
		expect(await local.issueTicket(other.user)).toBeNull();
		await local.rename(other.user.id, 'wracający_sąsiad');
		await local.collections.sessions.put(other.token, {
			user_id: other.user.id,
			created: Date.now() - 366 * 86400000
		});
		expect(await local.authenticated(other.token)).toBeNull();
		local = openStore(namespace);
		const restored = await local.recoverTicket(ticket);
		expect(restored.user.id).toBe(other.user.id);
		expect(restored.user.name).toBe('wracający_sąsiad');
		expect(restored.token).not.toBe(other.token);
		expect(restored.token).not.toBe(credential.secret);
		expect((await local.visitor(restored.token)).user.id).toBe(other.user.id);
		expect(
			(await local.feed(restored.user.id, new URLSearchParams({ view: 'saved' }))).posts[0].id
		).toBe(id);
		expect((await local.recoverTicket(ticket)).token).not.toBe(restored.token);
		expect(await local.recoverTicket(formatTicket(user, namespace, credential.secret))).toBeNull();
		expect(
			await local.recoverTicket(formatTicket(other.user, namespace, '0'.repeat(64)))
		).toBeNull();
		const replacement = await local.issueTicket(restored.user, true);
		expect(await local.recoverTicket(ticket)).toBeNull();
		expect((await local.recoverTicket(replacement)).user.id).toBe(other.user.id);
		expect((await local.authenticated(restored.token)).id).toBe(other.user.id);
		expect((await query({ tag: 'TEST' })).total).toBe(1);
		expect((await query({ q: '%' })).total).toBe(0);
		expect((await query({ q: "' OR 1=1 --" })).total).toBe(0);
		expect((await query({ type: 'blip' })).posts.every((post) => post.kind === 'blip')).toBe(true);
		expect((await query({ view: 'unanswered' })).posts.some((post) => post.id === id)).toBe(false);
		const popular = (await query({ view: 'popular' })).posts;
		expect(popular[0].likes).toBeGreaterThanOrEqual(popular.at(-1).likes);
		await Promise.all([
			local.toggle('likes', other.user.id, id),
			local.toggle('bookmarks', other.user.id, id),
			local.toggle('follows', other.user.id, user.id)
		]);
		expect((await query({ view: 'saved' })).total).toBe(0);
		expect((await query({ view: 'following' })).total).toBe(0);
		for (let i = 0; i < 22; i++)
			await local.addPost(user.id, 'blip', '', `Strona ${i}`, 'Codzienność');
		expect((await query({ user: user.id })).posts).toHaveLength(20);
		expect((await query({ user: user.id, page: '2' })).posts).toHaveLength(3);
		expect((await query({ page: 'Infinity' })).page).toBe(Math.ceil((await query({})).total / 20));
		const names = await Promise.all([
			local.rename(user.id, 'ten_sam_nick'),
			local.rename(other.user.id, 'ten_sam_nick')
		]);
		expect(names.filter(Boolean)).toHaveLength(1);
		console.log(`Integration check namespace: ${namespace}`);
	},
	30000
);

test('return ticket parser and bounded retry window reject malformed credentials', () => {
	const user = { id: randomUUID(), name: 'sąsiad' };
	const ticket = formatTicket(user, 'bliza_check', 'a'.repeat(64));
	expect(parseTicket(ticket, 'bliza_check')).toEqual({ id: user.id, secret: 'a'.repeat(64) });
	expect(parseTicket(ticket.replaceAll('\n', '\r\n'), 'bliza_check')).not.toBeNull();
	expect(parseTicket(ticket.replace('sąsiad', 'someone_else'), 'bliza_check')).not.toBeNull();
	for (const invalid of [
		null,
		'<script>alert(1)</script>',
		ticket + ticket,
		ticket.replace('a'.repeat(64), 'not-a-key'),
		'x'.repeat(MAX_TICKET_SIZE + 1)
	])
		expect(parseTicket(invalid, 'bliza_check')).toBeNull();
	expect(parseTicket(ticket, 'another_portal')).toBeNull();
	for (let i = 0; i < 20; i++) expect(allowRecovery('unit-address', 1000)).toBe(true);
	expect(allowRecovery('unit-address', 1001)).toBe(false);
	expect(allowRecovery('different-address', 1001)).toBe(true);
	expect(allowRecovery('unit-address', 61000)).toBe(true);
});

test('image trust boundary rejects SVG, spoofed MIME and oversized uploads', async () => {
	expect(await uploadImage(null)).toBeNull();
	expect(await uploadImage(new File([], 'empty.jpg'))).toBeNull();
	await expect(
		uploadImage(new File(['<svg onload="alert(1)"/>'], 'bad.svg', { type: 'image/svg+xml' }))
	).rejects.toThrow('formacie');
	await expect(
		uploadImage(new File([new Uint8Array([255, 216, 255])], 'fake.png', { type: 'image/png' }))
	).rejects.toThrow('nie pasuje');
	await expect(
		uploadImage(new File([new Uint8Array(MAX_IMAGE_SIZE + 1)], 'huge.jpg', { type: 'image/jpeg' }))
	).rejects.toThrow('5 MB');
});
