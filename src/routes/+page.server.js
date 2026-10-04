import { fail, error } from '@sveltejs/kit';
import { store, categories } from '#lib/server/db.js';
import { uploadImage } from '#lib/server/images.js';

async function currentUser({ cookies, url }) {
	const oldToken = cookies.get('bliza_session');
	const { user, token } = await store.visitor(oldToken);
	if (oldToken !== token) cookies.set('bliza_session', token, { path: '/', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 365 * 86400 });
	return user;
}

export async function load(event) {
	try {
		const user = await currentUser(event);
		const [feed, counts, trending, people, stats] = await Promise.all([
			store.feed(user.id, event.url.searchParams),
			store.read('SELECT category, COUNT(*) AS n FROM posts GROUP BY category'),
			store.read('SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag LIMIT 6'),
			store.read(`SELECT u.*, (SELECT COUNT(*) FROM posts WHERE user_id=u.id) + (SELECT COUNT(*) FROM replies WHERE user_id=u.id) AS contributions,
				EXISTS(SELECT 1 FROM follows WHERE user_id=? AND target_id=u.id) AS following FROM users u WHERE u.id != ? ORDER BY contributions DESC, u.name LIMIT 4`, user.id, user.id),
			store.read(`SELECT (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM users) AS users,
				(SELECT COUNT(*) FROM posts WHERE user_id=?) AS mine, (SELECT COUNT(*) FROM follows WHERE user_id=?) AS following,
				(SELECT COUNT(*) FROM bookmarks WHERE user_id=?) AS saved, (SELECT COUNT(*) FROM posts WHERE kind='question' AND NOT EXISTS (SELECT 1 FROM replies WHERE post_id=posts.id)) AS unanswered`, user.id, user.id, user.id)
		]);
		return { user, ...feed, filters: Object.fromEntries(event.url.searchParams),
			categories: categories.map(([name, icon]) => ({ name, icon, count: counts.find((row) => row.category === name)?.n || 0 })),
			trending: [...trending], people: [...people], stats: stats[0]
		};
	} catch { error(503, 'Nie możemy połączyć się z OpenRails. Sprawdź konfigurację serwera i spróbuj ponownie.'); }
}

const text = (form, name) => typeof form.get(name) === 'string' ? form.get(name).trim() : '';
const validPost = (id) => /^(?:[1-9]\d{0,15}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(id) && store.collections.posts.get(id);

const handlers = {
	publish: async (event) => {
		if (Number(event.request.headers.get('content-length')) > 6 * 1024 * 1024) return fail(413, { error: 'Zdjęcie może mieć maksymalnie 5 MB.' });
		const form = await event.request.formData();
		const values = Object.fromEntries(['kind', 'title', 'body', 'category'].map((key) => [key, text(form, key)]));
		const { kind, title, body, category } = values;
		if (!['question', 'blip'].includes(kind) || !categories.some(([name]) => name === category)) return fail(400, { error: 'Wybierz typ wpisu i kategorię.', values });
		if (kind === 'question' && (title.length < 5 || title.length > 180)) return fail(400, { error: 'Pytanie musi mieć od 5 do 180 znaków.', values });
		if (body.length > (kind === 'blip' ? 160 : 4000) || (kind === 'blip' && !body)) return fail(400, { error: kind === 'blip' ? 'Blip musi mieć od 1 do 160 znaków.' : 'Opis może mieć maksymalnie 4000 znaków.', values });
		const file = form.get('image');
		if (file && (!(file instanceof File) || (file.size && kind !== 'blip'))) return fail(400, { error: 'Zdjęcia możesz dodawać tylko do blipów.', values });
		try {
			const user = await currentUser(event);
			if (await store.recentCount('posts', user.id) >= 10) return fail(429, { error: 'Chwila oddechu! Spróbuj ponownie za minutę.', values });
			const image = await uploadImage(file);
			await store.addPost(user.id, kind, kind === 'question' ? title : '', body, category, image);
			return { success: kind === 'question' ? 'Pytanie dodane. Teraz czas na odpowiedzi!' : 'Blip poszedł w świat!' };
		} catch (err) {
			return fail(err instanceof TypeError ? 400 : 503, { error: err instanceof TypeError ? err.message : 'Nie udało się zapisać wpisu. Tekst został w formularzu. Spróbuj ponownie.', values });
		}
	},
	reply: async (event) => {
		const user = await currentUser(event);
		const form = await event.request.formData();
		const id = text(form, 'id'); const body = text(form, 'body');
		if (!await validPost(id) || !body || body.length > 2000) return fail(400, { error: 'Odpowiedź musi mieć od 1 do 2000 znaków.' });
		if (await store.recentCount('replies', user.id) >= 20) return fail(429, { error: 'Za dużo odpowiedzi naraz. Spróbuj za minutę.' });
		await store.reply(id, user.id, body);
		return { success: 'Odpowiedź dodana. Dzięki za rozmowę!' };
	},
	like: (event) => relation(event, 'likes'),
	save: (event) => relation(event, 'bookmarks'),
	follow: (event) => relation(event, 'follows'),
	profile: async (event) => {
		const user = await currentUser(event);
		const name = text(await event.request.formData(), 'name');
		if (!/^[\p{L}\p{N}_.]{3,24}$/u.test(name)) return fail(400, { error: 'Nick: 3–24 litery, cyfry, kropki lub podkreślenia.' });
		if (!await store.rename(user.id, name)) return fail(400, { error: 'Ten nick jest już zajęty. Wybierz inny.' });
		return { success: 'Gotowe. Miło Cię poznać!', profileSaved: true };
	}
};

async function relation(event, table) {
	const user = await currentUser(event);
	const id = text(await event.request.formData(), 'id');
	if (table === 'follows' ? (id === user.id || !/^(?:seed-\d+|[a-f0-9-]{36})$/.test(id) || !await store.collections.users.get(id)) : !await validPost(id)) return fail(400, { error: 'Nie znaleziono wpisu lub użytkownika.' });
	await store.toggle(table, user.id, id);
	return { success: null };
}

export const actions = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (event) => {
	try { return await handler(event); }
	catch { return fail(503, { error: 'OpenRails jest chwilowo niedostępny. Spróbuj ponownie; formularz nie został wyczyszczony.' }); }
}]));
