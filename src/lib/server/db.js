import { db, data } from 'openrails';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { formatTicket, parseTicket } from './tickets.js';

process.env.OPENRAILS_URL ||= 'http://192.168.0.124:8787';

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

export function openStore(namespace = process.env.OPENRAILS_NAMESPACE || 'bliza') {
	if (!/^[a-z][a-z0-9_]{0,50}$/.test(namespace)) throw new Error('Invalid OpenRails namespace');
	const fields = {
		users: ['name', 'avatar'],
		sessions: ['user_id', 'created'],
		posts: ['user_id', 'kind', 'title', 'body', 'category', 'image', 'created', 'tags'],
		replies: ['post_id', 'user_id', 'body', 'created'],
		likes: ['user_id', 'post_id'],
		bookmarks: ['user_id', 'post_id'],
		follows: ['user_id', 'target_id']
	};
	const collections = Object.fromEntries(
		[...Object.keys(fields), 'meta', 'tickets'].map((name) => [
			name,
			db.collection(`${namespace}_${name}`)
		])
	);
	const views = Object.entries(fields).map(
		([table, columns]) =>
			`${table} AS (SELECT key AS ${table === 'sessions' ? 'token' : 'id'}, ${columns.map((name) => `json_extract(value, '$.${name}') AS ${name}`).join(', ')} FROM kv WHERE scope='' AND collection='${namespace}_${table}')`
	);
	views.push('tags AS (SELECT p.id AS post_id, t.value AS tag FROM posts p, json_each(p.tags) t)');
	const read = (sql, ...params) => data.runSQL(`WITH ${views.join(', ')} ${sql}`, params);

	// ponytail: OpenRails 0.1 has no transactions/CAS; serialize mutations in this app.
	// Keep one app instance until the backend supports atomic conditional writes.
	let writes = Promise.resolve();
	function exclusive(task) {
		const result = writes.then(task);
		writes = result.catch(() => {});
		return result;
	}

	async function addPost(
		user,
		kind,
		title,
		body,
		category,
		image = null,
		created = Date.now(),
		id = randomUUID()
	) {
		id = String(id);
		const tags = [
			...new Set(
				(`${title} ${body}`.match(/#[\p{L}\p{N}_]+/gu) || []).map((tag) =>
					tag.slice(1).toLocaleLowerCase('pl')
				)
			)
		];
		await collections.posts.put(id, {
			user_id: user,
			kind,
			title,
			body,
			category,
			image,
			created,
			tags
		});
		return id;
	}

	async function seed() {
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
		const now = Date.now();
		for (const [i, [name, avatar]] of people.entries())
			await collections.users.put(`seed-${i}`, { name, avatar });
		for (const [i, [user, kind, title, body, category, image]] of posts.entries()) {
			const id = await addPost(
				`seed-${user}`,
				kind,
				title,
				body,
				category,
				image,
				now - (i * 13 + 4) * 60000,
				i + 1
			);
			for (let j = 0; j < 8 - (i % 5); j++)
				await collections.likes.put(`seed-${j}/${id}`, { user_id: `seed-${j}`, post_id: id });
		}
		for (const [i, [post, user, body]] of replies.entries())
			await collections.replies.put(String(i + 1), {
				post_id: String(post),
				user_id: `seed-${user}`,
				body,
				created: now - (i + 1) * 60000
			});
		for (let i = 0; i < people.length; i++)
			for (let j = 0; j < i; j++)
				await collections.follows.put(`seed-${j}/seed-${i}`, {
					user_id: `seed-${j}`,
					target_id: `seed-${i}`
				});
	}

	let initialization;
	function init() {
		return (initialization ||= (async () => {
			const setup = await collections.meta.get('setup');
			if (setup?.status === 'ready') return;
			if (setup?.status === 'importing')
				throw new Error('Finish the OpenRails migration before starting the portal');
			if (setup?.status === 'seeding' || !(await collections.users.query().count())) {
				await collections.meta.put('setup', { status: 'seeding' });
				await seed();
			}
			await collections.meta.put('setup', { status: 'ready' });
		})().catch((error) => {
			initialization = undefined;
			throw error;
		}));
	}

	async function authenticated(token) {
		if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
		await init();
		const session = await collections.sessions.get(token);
		if (!(session?.created > Date.now() - 365 * 86400000)) return null;
		const user = await collections.users.get(session.user_id);
		return user ? { ...user, id: session.user_id } : null;
	}

	async function newSession(user) {
		const token = randomBytes(32).toString('hex');
		await collections.sessions.put(token, { user_id: user.id, created: Date.now() });
		return { user, token };
	}

	async function visitor(token) {
		await init();
		const existing = await authenticated(token);
		if (existing) return { user: existing, token };
		return exclusive(async () => {
			const id = randomUUID();
			let name = `nowy_${id.slice(0, 6)}`;
			while ((await read('SELECT id FROM users WHERE name=?', name)).length)
				name = `nowy_${randomBytes(4).toString('hex')}`;
			const user = { name, avatar: 'pixel' };
			await collections.users.put(id, user);
			return newSession({ ...user, id });
		});
	}

	function issueTicket(user, replace = false) {
		return exclusive(async () => {
			if ((await collections.tickets.get(user.id)) && !replace) return null;
			const secret = randomBytes(32).toString('hex');
			await collections.tickets.put(user.id, {
				hash: createHash('sha256').update(secret).digest('hex'),
				created: Date.now()
			});
			return formatTicket(user, namespace, secret);
		});
	}

	function recoverTicket(text) {
		const ticket = parseTicket(text, namespace);
		if (!ticket) return Promise.resolve(null);
		return exclusive(async () => {
			const saved = await collections.tickets.get(ticket.id);
			if (typeof saved?.hash !== 'string' || !/^[a-f0-9]{64}$/.test(saved.hash)) return null;
			if (
				!timingSafeEqual(
					Buffer.from(saved.hash, 'hex'),
					createHash('sha256').update(ticket.secret).digest()
				)
			)
				return null;
			const user = await collections.users.get(ticket.id);
			return user ? newSession({ ...user, id: ticket.id }) : null;
		});
	}

	async function feed(user, params = new URLSearchParams()) {
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
		const [{ count: total }] = await read(
			`SELECT COUNT(*) AS count FROM posts p JOIN users u ON u.id=p.user_id ${where}`,
			...values
		);
		const page = Math.min(
			Math.max(1, Math.floor(Number(params.get('page')) || 1)),
			Math.max(1, Math.ceil(total / 20))
		);
		const posts = await read(
			`SELECT p.id, p.user_id, p.kind, p.title, p.body, p.category, p.image, p.created, u.name, u.avatar,
			(SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,
			(SELECT COUNT(*) FROM replies WHERE post_id=p.id) AS reply_count,
			EXISTS (SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
			EXISTS (SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) AS saved
			FROM posts p JOIN users u ON u.id=p.user_id ${where}
			ORDER BY ${view === 'popular' ? 'likes DESC,' : ''} p.created DESC, p.id DESC LIMIT 20 OFFSET ?`,
			user,
			user,
			...values,
			(page - 1) * 20
		);
		await Promise.all(
			posts.map(async (post) => {
				post.replies = [
					...(await read(
						'SELECT r.*, u.name, u.avatar FROM replies r JOIN users u ON u.id=r.user_id WHERE post_id=? ORDER BY r.created, r.id LIMIT 100',
						post.id
					))
				];
			})
		);
		return { posts: [...posts], total, page };
	}

	function toggle(table, user, target) {
		if (!['likes', 'bookmarks', 'follows'].includes(table)) throw new Error('Invalid relation');
		return exclusive(async () => {
			const collection = collections[table];
			const key = `${user}/${target}`;
			if (await collection.get(key)) {
				await collection.delete(key);
				return false;
			}
			await collection.put(key, {
				user_id: user,
				[table === 'follows' ? 'target_id' : 'post_id']: String(target)
			});
			return true;
		});
	}

	function rename(user, name) {
		return exclusive(async () => {
			if ((await read('SELECT id FROM users WHERE name=? AND id!=?', name, user)).length)
				return false;
			await collections.users.put(user, { ...(await collections.users.get(user)), name });
			return true;
		});
	}

	async function reply(post, user, body) {
		const id = randomUUID();
		await collections.replies.put(id, {
			post_id: String(post),
			user_id: user,
			body,
			created: Date.now()
		});
		return id;
	}
	const recentCount = async (table, user) => {
		if (!['posts', 'replies'].includes(table)) throw new Error('Invalid rate-limit table');
		return (
			await read(
				`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=? AND created>?`,
				user,
				Date.now() - 60000
			)
		)[0].n;
	};
	return {
		namespace,
		collections,
		init,
		read,
		visitor,
		authenticated,
		issueTicket,
		recoverTicket,
		feed,
		addPost,
		toggle,
		rename,
		reply,
		recentCount
	};
}

export const store = openStore();
