import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { openStore } from './db.js';
import { uploadImage, MAX_IMAGE_SIZE } from './images.js';

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
