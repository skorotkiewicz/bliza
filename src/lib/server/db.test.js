import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, store } from './db.js';

test('portal saves conversations, isolated sessions and toggles across SQLite reopen', () => {
	const path = join(mkdtempSync(join(tmpdir(), 'bliza-')), 'portal.sqlite');
	let local = openStore(path);
	const { user, token } = local.visitor();
	const other = local.visitor();
	expect(other.user.id).not.toBe(user.id);
	expect(local.visitor(user.id).user.id).not.toBe(user.id);
	expect(local.visitor(token).user.id).toBe(user.id);
	const id = local.addPost(
		user.id,
		'question',
		'Jak działa zapis danych?',
		'Sprawdzamy SQLite! #Test #test',
		'Komputery i internet'
	);
	local.db
		.query('INSERT INTO replies(post_id,user_id,body,created) VALUES (?,?,?,?)')
		.run(id, other.user.id, 'Działa po ponownym uruchomieniu.', Date.now());
	expect(local.toggle('likes', other.user.id, id)).toBe(true);
	expect(local.toggle('bookmarks', other.user.id, id)).toBe(true);
	expect(local.toggle('follows', other.user.id, user.id)).toBe(true);
	local.db.close();
	local = openStore(path);
	const query = (params) => local.feed(other.user.id, new URLSearchParams(params));
	const saved = query({ view: 'saved' }).posts[0];
	expect(saved.id).toBe(id);
	expect(saved.likes).toBe(1);
	expect(saved.saved).toBe(1);
	expect(saved.replies[0].body).toBe('Działa po ponownym uruchomieniu.');
	expect(query({ view: 'following' }).posts[0].id).toBe(id);
	expect(query({ tag: 'TEST' }).total).toBe(1);
	expect(query({ q: '%' }).total).toBe(0);
	expect(query({ q: "' OR 1=1 --" }).total).toBe(0);
	expect(query({ type: 'blip' }).posts.every((post) => post.kind === 'blip')).toBe(true);
	expect(query({ view: 'unanswered' }).posts.some((post) => post.id === id)).toBe(false);
	expect(query({ view: 'popular' }).posts[0].likes).toBeGreaterThanOrEqual(
		query({ view: 'popular' }).posts.at(-1).likes
	);
	local.toggle('likes', other.user.id, id);
	local.toggle('bookmarks', other.user.id, id);
	local.toggle('follows', other.user.id, user.id);
	expect(query({ view: 'saved' }).total).toBe(0);
	expect(query({ view: 'following' }).total).toBe(0);
	for (let i = 0; i < 22; i++) local.addPost(user.id, 'blip', '', `Strona ${i}`, 'Codzienność');
	expect(query({ user: user.id }).posts).toHaveLength(20);
	expect(query({ user: user.id, page: '2' }).posts).toHaveLength(3);
	expect(query({ page: 'Infinity' }).page).toBe(Math.ceil(query({}).total / 20));
	local.db.close();
});
