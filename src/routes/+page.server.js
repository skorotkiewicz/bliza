import { fail } from '@sveltejs/kit';
import { store, categories } from '#lib/server/db.js';

function currentUser({ cookies, url }) {
	const oldToken = cookies.get('bliza_session');
	const { user, token } = store.visitor(oldToken);
	if (oldToken !== token)
		cookies.set('bliza_session', token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 365 * 86400
		});
	return user;
}

export function load(event) {
	const user = currentUser(event);
	const db = store.db;
	return {
		user,
		...store.feed(user.id, event.url.searchParams),
		filters: Object.fromEntries(event.url.searchParams),
		categories: categories.map(([name, icon]) => ({
			name,
			icon,
			count: db.query('SELECT COUNT(*) AS n FROM posts WHERE category=?').get(name).n
		})),
		trending: db
			.query(
				'SELECT tag, COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC, tag LIMIT 6'
			)
			.all(),
		people: db
			.query(
				`SELECT u.*, (SELECT COUNT(*) FROM posts WHERE user_id=u.id) + (SELECT COUNT(*) FROM replies WHERE user_id=u.id) AS contributions,
			EXISTS(SELECT 1 FROM follows WHERE user_id=? AND target_id=u.id) AS following FROM users u WHERE u.id != ? ORDER BY contributions DESC, u.name LIMIT 4`
			)
			.all(user.id, user.id),
		stats: db
			.query(
				`SELECT (SELECT COUNT(*) FROM posts) AS posts, (SELECT COUNT(*) FROM users) AS users,
			(SELECT COUNT(*) FROM posts WHERE user_id=?) AS mine, (SELECT COUNT(*) FROM follows WHERE user_id=?) AS following,
			(SELECT COUNT(*) FROM bookmarks WHERE user_id=?) AS saved, (SELECT COUNT(*) FROM posts WHERE kind='question' AND NOT EXISTS (SELECT 1 FROM replies WHERE post_id=posts.id)) AS unanswered`
			)
			.get(user.id, user.id, user.id)
	};
}

const text = (form, name) => (typeof form.get(name) === 'string' ? form.get(name).trim() : '');
const validPost = (id) =>
	/^\d+$/.test(id) && !!store.db.query('SELECT id FROM posts WHERE id=?').get(Number(id));

export const actions = {
	publish: async (event) => {
		const user = currentUser(event);
		const form = await event.request.formData();
		const values = Object.fromEntries(
			['kind', 'title', 'body', 'category'].map((key) => [key, text(form, key)])
		);
		const { kind, title, body, category } = values;
		if (!['question', 'blip'].includes(kind) || !categories.some(([name]) => name === category))
			return fail(400, { error: 'Wybierz typ wpisu i kategorię.', values });
		if (kind === 'question' && (title.length < 5 || title.length > 180))
			return fail(400, { error: 'Pytanie musi mieć od 5 do 180 znaków.', values });
		if (body.length > (kind === 'blip' ? 160 : 4000) || (kind === 'blip' && !body))
			return fail(400, {
				error:
					kind === 'blip'
						? 'Blip musi mieć od 1 do 160 znaków.'
						: 'Opis może mieć maksymalnie 4000 znaków.',
				values
			});
		if (
			store.db
				.query('SELECT COUNT(*) AS n FROM posts WHERE user_id=? AND created>?')
				.get(user.id, Date.now() - 60000).n >= 10
		)
			return fail(429, { error: 'Chwila oddechu! Spróbuj ponownie za minutę.', values });
		store.addPost(user.id, kind, kind === 'question' ? title : '', body, category);
		return {
			success:
				kind === 'question' ? 'Pytanie dodane. Teraz czas na odpowiedzi!' : 'Blip poszedł w świat!'
		};
	},
	reply: async (event) => {
		const user = currentUser(event);
		const form = await event.request.formData();
		const id = text(form, 'id');
		const body = text(form, 'body');
		if (!validPost(id) || !body || body.length > 2000)
			return fail(400, { error: 'Odpowiedź musi mieć od 1 do 2000 znaków.' });
		if (
			store.db
				.query('SELECT COUNT(*) AS n FROM replies WHERE user_id=? AND created>?')
				.get(user.id, Date.now() - 60000).n >= 20
		)
			return fail(429, { error: 'Za dużo odpowiedzi naraz. Spróbuj za minutę.' });
		store.db
			.query('INSERT INTO replies(post_id,user_id,body,created) VALUES (?,?,?,?)')
			.run(Number(id), user.id, body, Date.now());
		return { success: 'Odpowiedź dodana. Dzięki za rozmowę!' };
	},
	like: (event) => relation(event, 'likes'),
	save: (event) => relation(event, 'bookmarks'),
	follow: (event) => relation(event, 'follows'),
	profile: async (event) => {
		const user = currentUser(event);
		const name = text(await event.request.formData(), 'name');
		if (!/^[\p{L}\p{N}_.]{3,24}$/u.test(name))
			return fail(400, { error: 'Nick: 3–24 litery, cyfry, kropki lub podkreślenia.' });
		if (store.db.query('SELECT id FROM users WHERE name=? AND id!=?').get(name, user.id))
			return fail(400, { error: 'Ten nick jest już zajęty. Wybierz inny.' });
		store.db.query('UPDATE users SET name=? WHERE id=?').run(name, user.id);
		return { success: 'Gotowe. Miło Cię poznać!', profileSaved: true };
	}
};

async function relation(event, table) {
	const user = currentUser(event);
	const id = text(await event.request.formData(), 'id');
	if (
		table === 'follows'
			? id === user.id || !store.db.query('SELECT id FROM users WHERE id=?').get(id)
			: !validPost(id)
	)
		return fail(400, { error: 'Nie znaleziono wpisu lub użytkownika.' });
	store.toggle(table, user.id, table === 'follows' ? id : Number(id));
	return { success: null };
}
