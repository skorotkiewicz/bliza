import { Database } from 'bun:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';

export const categories = [
	['Codzienność', 'coffee'],
	['Szkoła i nauka', 'book'],
	['Komputery i internet', 'monitor'],
	['Muzyka', 'music'],
	['Filmy i seriale', 'film'],
	['Relacje', 'heart'],
	['Podróże', 'compass'],
	['Pozostałe', 'grid']
];

export function openStore(path = process.env.DB_PATH || 'bliza.sqlite') {
	const db = new Database(path, { create: true });
	db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
		CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, avatar TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created INTEGER NOT NULL);
		CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('question','blip')), title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, category TEXT NOT NULL, image TEXT, created INTEGER NOT NULL);
		CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), user_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created INTEGER NOT NULL);
		CREATE TABLE IF NOT EXISTS likes (user_id TEXT NOT NULL REFERENCES users(id), post_id INTEGER NOT NULL REFERENCES posts(id), PRIMARY KEY(user_id, post_id));
		CREATE TABLE IF NOT EXISTS bookmarks (user_id TEXT NOT NULL REFERENCES users(id), post_id INTEGER NOT NULL REFERENCES posts(id), PRIMARY KEY(user_id, post_id));
		CREATE TABLE IF NOT EXISTS follows (user_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(user_id, target_id), CHECK(user_id != target_id));
		CREATE TABLE IF NOT EXISTS tags (post_id INTEGER NOT NULL REFERENCES posts(id), tag TEXT NOT NULL, PRIMARY KEY(post_id, tag));
		CREATE INDEX IF NOT EXISTS posts_created ON posts(created DESC);
		CREATE INDEX IF NOT EXISTS replies_post ON replies(post_id);
		CREATE INDEX IF NOT EXISTS tags_name ON tags(tag);`);

	function addPost(user, kind, title, body, category, image = null, created = Date.now()) {
		return db.transaction(() => {
			const { lastInsertRowid } = db
				.query(
					'INSERT INTO posts(user_id,kind,title,body,category,image,created) VALUES (?,?,?,?,?,?,?)'
				)
				.run(user, kind, title, body, category, image, created);
			const id = Number(lastInsertRowid);
			for (const tag of new Set(
				(`${title} ${body}`.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) =>
					t.slice(1).toLocaleLowerCase('pl')
				)
			)) {
				db.query('INSERT INTO tags(post_id,tag) VALUES (?,?)').run(id, tag);
			}
			return id;
		})();
	}

	if (!db.query('SELECT id FROM users LIMIT 1').get()) {
		db.transaction(() => {
			const people = [
				['kasia_po_godzinach', 'cat'],
				['pan_od_internetu', 'pixel'],
				['ola_w_drodze', 'mountain'],
				['winylowy', 'record'],
				['marta_czyta', 'flower'],
				['nocny_marek', 'moon'],
				['szymon.jpg', 'camera'],
				['herbata_z_cytryną', 'lemon']
			];
			people.forEach(([name, avatar], i) =>
				db.query('INSERT INTO users VALUES (?,?,?)').run(`seed-${i}`, name, avatar)
			);
			const now = Date.now();
			const posts = [
				[
					0,
					'question',
					'Jaka mała rzecz ostatnio poprawiła Wam dzień?',
					'U mnie pani w piekarni dorzuciła ciepłą bułkę „na dobry początek”. Niby nic, a uśmiech został na cały dzień. :) #codzienność',
					'Codzienność',
					null
				],
				[
					1,
					'blip',
					'',
					'Pamiętacie ten dźwięk, kiedy ktoś był dostępny na Gadu-Gadu? Mój mózg właśnie go odtworzył. :D #nostalgia #internet',
					'Komputery i internet',
					null
				],
				[
					2,
					'blip',
					'',
					'Uciekłam na chwilę od powiadomień. Tutaj zasięg jest słaby, ale widoki całkiem niezłe. 🌲 #podróże #małeprzyjemności',
					'Podróże',
					'/images/mountains.jpg'
				],
				[
					3,
					'question',
					'Jeden album, którego możecie słuchać bez końca?',
					'Szukam czegoś na długi wieczór. Gatunek dowolny, byle od pierwszego do ostatniego utworu. U mnie „Długość dźwięku samotności”. #muzyka',
					'Muzyka',
					null
				],
				[
					4,
					'blip',
					'',
					'Kawa, deszcz za oknem i ostatnie 30 stron książki. Proszę nie przeszkadzać. ☕ #codzienność #książki',
					'Codzienność',
					null
				],
				[
					5,
					'question',
					'Jaki film chcielibyście zobaczyć jeszcze raz po raz pierwszy?',
					'Taki, po którym siedzieliście przez chwilę w ciszy, patrząc na napisy końcowe. #filmy',
					'Filmy i seriale',
					null
				],
				[
					6,
					'question',
					'Od czego zacząć fotografię analogową?',
					'Znalazłem u dziadka starego Zenita. Co warto wiedzieć przed kupieniem pierwszej kliszy? #fotografia',
					'Pozostałe',
					null
				],
				[
					7,
					'blip',
					'',
					'Oficjalnie: herbata smakuje lepiej w tym jednym, ulubionym kubku. Nauka jeszcze tego nie wyjaśniła. #codzienność',
					'Codzienność',
					null
				],
				[
					0,
					'question',
					'Jak uczycie się języków, żeby się nie poddać po tygodniu?',
					'Chcę wrócić do hiszpańskiego. Macie jakieś sprawdzone sposoby na regularność? #nauka',
					'Szkoła i nauka',
					null
				]
			];
			posts.forEach(([user, kind, title, body, category, image], i) => {
				const id = addPost(
					`seed-${user}`,
					kind,
					title,
					body,
					category,
					image,
					now - (i * 13 + 4) * 60000
				);
				for (let j = 0; j < 8 - (i % 5); j++)
					db.query('INSERT INTO likes VALUES (?,?)').run(`seed-${j}`, id);
			});
			const replies = [
				[1, 4, 'Ktoś zostawił w bibliotece zakładkę z napisem „miłego czytania”. Nadal ją mam. ♥'],
				[
					1,
					7,
					'Pierwsze słońce po tygodniu deszczu. I pies, który cieszył się jeszcze bardziej ode mnie.'
				],
				[1, 1, 'Znalazłem pendrive z playlistą z 2012. Dzień od razu lepszy!'],
				[2, 5, 'A opis „zaraz wracam”, który wisiał przez trzy dni? Klasyka.'],
				[3, 6, 'Ten widok! Gdzie to jest?'],
				[3, 2, 'Tatry, okolice Morskiego Oka. Polecam wstać bardzo wcześnie :)'],
				[4, 5, 'Radiohead, „In Rainbows”. Nie ma słabego utworu.'],
				[4, 0, 'Myslovitz zawsze. A do tego „Korova Milky Bar”!'],
				[6, 4, 'Amelia. Za klimat i za te wszystkie małe rzeczy.'],
				[9, 7, '10 minut codziennie zamiast dwóch godzin raz w tygodniu. U mnie działa.']
			];
			replies.forEach(([post, user, body], i) =>
				db
					.query('INSERT INTO replies(post_id,user_id,body,created) VALUES (?,?,?,?)')
					.run(post, `seed-${user}`, body, now - (i + 1) * 60000)
			);
			people.forEach((_, i) => {
				for (let j = 0; j < i; j++)
					db.query('INSERT INTO follows VALUES (?,?)').run(`seed-${j}`, `seed-${i}`);
			});
		})();
	}

	function visitor(token) {
		const existing =
			typeof token === 'string' &&
			db
				.query(
					'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.created>?'
				)
				.get(token, Date.now() - 365 * 86400000);
		if (existing) return { user: existing, token };
		return db.transaction(() => {
			const id = randomUUID();
			const user = { id, name: `nowy_${id.slice(0, 6)}`, avatar: 'pixel' };
			const session = randomBytes(32).toString('hex');
			db.query('INSERT INTO users VALUES (?,?,?)').run(id, user.name, user.avatar);
			db.query('INSERT INTO sessions VALUES (?,?,?)').run(session, id, Date.now());
			return { user, token: session };
		})();
	}

	function feed(user, params = new URLSearchParams()) {
		const view = params.get('view') || 'all';
		const filters = [];
		const values = [];
		if (['question', 'blip'].includes(params.get('type'))) {
			filters.push('p.kind=?');
			values.push(params.get('type'));
		}
		for (const [param, column] of [
			['category', 'p.category'],
			['user', 'p.user_id']
		]) {
			if (params.get(param)) {
				filters.push(`${column}=?`);
				values.push(params.get(param));
			}
		}
		if (params.get('q')) {
			filters.push(
				"(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"
			);
			const q = `%${params
				.get('q')
				.slice(0, 200)
				.replace(/[\\%_]/g, '\\$&')}%`;
			values.push(q, q, q);
		}
		if (params.get('tag')) {
			filters.push('EXISTS (SELECT 1 FROM tags WHERE post_id=p.id AND tag=?)');
			values.push(params.get('tag').toLocaleLowerCase('pl'));
		}
		if (view === 'unanswered')
			filters.push("p.kind='question' AND NOT EXISTS (SELECT 1 FROM replies WHERE post_id=p.id)");
		if (view === 'saved') {
			filters.push('EXISTS (SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?)');
			values.push(user);
		}
		if (view === 'following') {
			filters.push('EXISTS (SELECT 1 FROM follows WHERE target_id=p.user_id AND user_id=?)');
			values.push(user);
		}
		const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
		const total = db
			.query(`SELECT COUNT(*) AS count FROM posts p JOIN users u ON u.id=p.user_id ${where}`)
			.get(...values).count;
		const page = Math.min(
			Math.max(1, Math.floor(Number(params.get('page')) || 1)),
			Math.max(1, Math.ceil(total / 20))
		);
		const posts = db
			.query(
				`SELECT p.*, u.name, u.avatar,
			(SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,
			(SELECT COUNT(*) FROM replies WHERE post_id=p.id) AS reply_count,
			EXISTS (SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
			EXISTS (SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) AS saved
			FROM posts p JOIN users u ON u.id=p.user_id ${where}
			ORDER BY ${view === 'popular' ? 'likes DESC,' : ''} p.created DESC, p.id DESC LIMIT 20 OFFSET ?`
			)
			.all(user, user, ...values, (page - 1) * 20);
		for (const post of posts)
			post.replies = db
				.query(
					'SELECT r.*, u.name, u.avatar FROM replies r JOIN users u ON u.id=r.user_id WHERE post_id=? ORDER BY r.created, r.id LIMIT 100'
				)
				.all(post.id);
		return { posts, total, page };
	}

	function toggle(table, user, target) {
		if (!['likes', 'bookmarks', 'follows'].includes(table)) throw new Error('Invalid relation');
		const column = table === 'follows' ? 'target_id' : 'post_id';
		return db.transaction(() => {
			const result = db
				.query(`DELETE FROM ${table} WHERE user_id=? AND ${column}=?`)
				.run(user, target);
			if (!result.changes)
				db.query(`INSERT INTO ${table}(user_id,${column}) VALUES (?,?)`).run(user, target);
			return !result.changes;
		})();
	}

	return { db, visitor, feed, addPost, toggle };
}

// ponytail: one local SQLite database; use a shared service if deploying multiple instances.
export const store = openStore();
