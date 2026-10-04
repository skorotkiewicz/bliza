import { db, data, ApiError } from 'openrails';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { formatTicket, parseTicket } from './tickets.js';

process.env.OPENRAILS_URL ||= 'http://192.168.0.124:8787';
export const categories = [['Codzienność','coffee'],['Szkoła i nauka','book'],['Komputery i internet','monitor'],['Muzyka','music'],['Filmy i seriale','film'],['Relacje','heart'],['Podróże','compass'],['Pozostałe','grid']];
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export class Problem extends Error { constructor(status, message) { super(message); this.status = status; } }
const safeId=(value)=>{ if(typeof value!=='string' || !/^(?:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|(?:seed-)?[0-9]{1,12})$/.test(value)) throw new Problem(400,'Niepoprawny identyfikator.'); };
const policyDefault = () => ({ generation: 'legacy', approved: false, banned: false });

export function openStore(namespace = process.env.OPENRAILS_NAMESPACE || 'bliza') {
	if (!/^[a-z][a-z0-9_]{0,50}$/.test(namespace)) throw new Error('Invalid OpenRails namespace');
	const fields = {
		users: ['name','avatar'], sessions: ['user_id','created','generation','revoked','id','device'],
		posts_raw: ['user_id','kind','title','body','category','image','created','tags'],
		replies_raw: ['post_id','user_id','body','created'], likes: ['user_id','post_id'], bookmarks: ['user_id','post_id'], follows: ['user_id','target_id'],
		accounts: ['approved','banned','generation','request'], moderation: ['kind','target','hidden','reason','created'], reports: ['kind','target','user_id','reason','created','resolved'], audit: ['action','kind','target','reason','created','actor']
	};
	const names = [...Object.keys(fields).map((n) => n.replace('_raw','')), 'meta','tickets','names','limits','admin_sessions'];
	const collections = Object.fromEntries(names.map((name) => [name, db.collection(`${namespace}_${name}`)]));
	const views = Object.entries(fields).map(([table, columns]) => `${table} AS (SELECT key AS ${table === 'sessions' ? 'record_key' : 'id'}, ${columns.map((n) => `json_extract(value, '$.${n}') AS ${n}`).join(', ')} FROM kv WHERE scope='' AND collection='${namespace}_${table.replace('_raw','')}')`);
	views.push("posts AS (SELECT p.* FROM posts_raw p WHERE NOT EXISTS (SELECT 1 FROM moderation m WHERE m.kind='post' AND m.target=p.id AND m.hidden=1) AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=p.user_id AND a.banned=1))");
	views.push("replies AS (SELECT r.* FROM replies_raw r JOIN posts p ON p.id=r.post_id WHERE NOT EXISTS (SELECT 1 FROM moderation m WHERE m.kind='reply' AND m.target=r.id AND m.hidden=1) AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id=r.user_id AND a.banned=1))");
	views.push('tags AS (SELECT p.id AS post_id, t.value AS tag FROM posts p, json_each(p.tags) t)');
	const read = (sql,...params) => data.runSQL(`WITH ${views.join(', ')} ${sql}`,params);
	const check = (table,key,value) => ({ collection:`${namespace}_${table}`, key:String(key), exists:value !== null, ...(value !== null ? { value } : {}) });
	const put = (table,key,value) => ({ collection:`${namespace}_${table}`,key:String(key),value });
	const remove = (table,key) => ({ collection:`${namespace}_${table}`,key:String(key) });
	async function retry(fn) {
		for (let i=0;i<16;i++) { try { return await fn(); } catch (err) { if (!(err instanceof ApiError) || err.status !== 409) throw err; } }
		throw new Problem(409,'Dane właśnie się zmieniły. Spróbuj ponownie.');
	}
	const tagList = (title,body) => [...new Set((`${title} ${body}`.match(/#[\p{L}\p{N}_]+/gu)||[]).map((t)=>t.slice(1).toLocaleLowerCase('pl')))];

	async function seed(setup) {
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
		const now=Date.now(); const puts=[];
		for (const [i,[name,avatar]] of people.entries()) { puts.push(put('users',`seed-${i}`,{name,avatar})); puts.push(put('names',digest(name),{user_id:`seed-${i}`})); }
		for (const [i,[user,kind,title,body,category,image]] of posts.entries()) {
			const id=String(i+1); puts.push(put('posts',id,{user_id:`seed-${user}`,kind,title,body,category,image,created:now-(i*13+4)*60000,tags:tagList(title,body)}));
			for (let j=0;j<8-(i%5);j++) puts.push(put('likes',`seed-${j}/${id}`,{user_id:`seed-${j}`,post_id:id}));
		}
		for (const [i,[post,user,body]] of replies.entries()) puts.push(put('replies',String(i+1),{post_id:String(post),user_id:`seed-${user}`,body,created:now-(i+1)*60000}));
		for(let i=0;i<people.length;i++) for(let j=0;j<i;j++) puts.push(put('follows',`seed-${j}/seed-${i}`,{user_id:`seed-${j}`,target_id:`seed-${i}`}));
		puts.push(put('meta','setup',{status:'ready'}));
		await db.transaction({checks:[check('meta','setup',setup)],puts});
	}
	let initialization;
	function init() { return initialization ||= (async()=>{
		// Capability probe is a no-op. Never silently fall back to local locks.
		await db.transaction({});
		const setup=await collections.meta.get('setup');
		if(setup?.status==='ready') return;
		try {
			if(process.env.SEED_DEMO==='true' && (setup?.status==='seeding' || !(await collections.users.query().count()))) await seed(setup);
			else await db.transaction({checks:[check('meta','setup',setup)],puts:[put('meta','setup',{status:'ready'})]});
		} catch(err) { if(!(err instanceof ApiError) || err.status!==409 || (await collections.meta.get('setup'))?.status!=='ready') throw err; }
	})().catch((err)=>{ initialization=undefined; throw err; }); }

	async function context(token) {
		if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) return null;
		await init();
		let key=digest(token); let session=await collections.sessions.get(key);
		if(!session) { key=token; session=await collections.sessions.get(key); }
		if(!session || session.revoked || !(session.created>Date.now()-365*86400000)) return null;
		const [user,account]=await Promise.all([collections.users.get(session.user_id),collections.accounts.get(session.user_id)]);
		const policy=account||policyDefault();
		if(!user || policy.banned || (session.generation||'legacy')!==policy.generation) return null;
		return { user:{...user,id:session.user_id,approved:policy.approved,verification:policy.request||null}, policy, account, session, key,
			checks:[check('sessions',key,session),check('accounts',session.user_id,account)] };
	}
	const authenticated = async(token) => (await context(token))?.user||null;
	function sessionRecord(id,generation,agent='') {
		const browser=/Edg\//.test(agent)?'Edge':/Firefox\//.test(agent)?'Firefox':/Chrome\//.test(agent)?'Chrome':/Safari\//.test(agent)?'Safari':'Przeglądarka';
		const system=/Android/.test(agent)?'Android':/iPhone|iPad/.test(agent)?'iOS':/Windows/.test(agent)?'Windows':/Macintosh/.test(agent)?'macOS':/Linux/.test(agent)?'Linux':'nieznane urządzenie';
		return {id:randomUUID(),user_id:id,created:Date.now(),generation,device:`${browser} · ${system}`,revoked:false};
	}
	async function visitor(token,device,address) {
		await init(); const existing=await context(token); if(existing) return {user:existing.user,token};
		if(address) await limit(`guest:${address}`,20,3600000);
		return retry(async()=>{
			const id=randomUUID(), name=`nowy_${id.slice(0,8)}`, secret=randomBytes(32).toString('hex'), policy={...policyDefault(),generation:randomUUID()};
			const registry=await collections.names.get(digest(name));
			if(registry || (await read('SELECT id FROM users WHERE name=?',name)).length) throw new ApiError(409,'Name collision');
			const user={name,avatar:'pixel'};
			await db.transaction({checks:[check('names',digest(name),null)],puts:[put('users',id,user),put('accounts',id,policy),put('names',digest(name),{user_id:id}),put('sessions',digest(secret),sessionRecord(id,policy.generation,device))]});
			return {user:{...user,id,approved:false,verification:null},token:secret};
		});
	}
	async function required(token,approved=false) {
		const ctx=await context(token);
		if(!ctx) throw new Problem(401,'Sesja wygasła lub została wylogowana. Wróć z biletem.');
		if(approved && !ctx.policy.approved) throw new Problem(403,'Przed publikacją poproś moderatora o zatwierdzenie konta w swoim profilu.');
		return ctx;
	}
	async function slot(key,maximum,window=60000) {
		key=digest(key); const old=await collections.limits.get(key); const now=Date.now();
		const value=old?.until>now ? {...old} : {count:0,until:now+window};
		if(value.count>=maximum) throw new Problem(429,'Za dużo prób. Spróbuj ponownie później.');
		value.count++; return {check:check('limits',key,old),put:put('limits',key,value)};
	}
	async function limit(key,maximum,window=60000) { await init(); return retry(async()=>{const s=await slot(key,maximum,window);await db.transaction({checks:[s.check],puts:[s.put]});return true;}); }
	function issueTicket(token,replace=false) { return retry(async()=>{
		const ctx=await required(token); const old=await collections.tickets.get(ctx.user.id); if(old&&!replace) return null;
		const secret=randomBytes(32).toString('hex');
		const puts=[put('tickets',ctx.user.id,{hash:digest(secret),created:Date.now()})];
		if(old && replace) { const generation=randomUUID(); puts.push(put('accounts',ctx.user.id,{...ctx.policy,generation}),put('sessions',ctx.key,{...ctx.session,generation})); }
		await db.transaction({checks:[...ctx.checks,check('tickets',ctx.user.id,old)],puts});
		return formatTicket(ctx.user,namespace,secret);
	}); }
	async function recoverTicket(text,device) {
		const ticket=parseTicket(text,namespace); if(!ticket) return null; await init();
		return retry(async()=>{
			const [saved,user,account]=await Promise.all([collections.tickets.get(ticket.id),collections.users.get(ticket.id),collections.accounts.get(ticket.id)]);
			const policy=account||policyDefault();
			if(!user || policy.banned || typeof saved?.hash!=='string' || !/^[a-f0-9]{64}$/.test(saved.hash) || !timingSafeEqual(Buffer.from(saved.hash,'hex'),Buffer.from(digest(ticket.secret),'hex'))) return null;
			const token=randomBytes(32).toString('hex');
			await db.transaction({checks:[check('tickets',ticket.id,saved),check('accounts',ticket.id,account)],puts:[put('sessions',digest(token),sessionRecord(ticket.id,policy.generation,device))]});
			return {user:{...user,id:ticket.id,approved:policy.approved},token};
		});
	}
	function rename(token,name) { return retry(async()=>{
		const ctx=await required(token); const desired=await collections.names.get(digest(name));
		if(desired && desired.user_id!==ctx.user.id || (await read('SELECT id FROM users WHERE name=? AND id!=?',name,ctx.user.id)).length) return false;
		const old=await collections.users.get(ctx.user.id); const oldRegistry=await collections.names.get(digest(old.name));
		const checks=[...ctx.checks,check('users',ctx.user.id,old),check('names',digest(name),desired)];
		const deletes=old.name!==name && oldRegistry?.user_id===ctx.user.id ? [remove('names',digest(old.name))] : [];
		if(deletes.length) checks.push(check('names',digest(old.name),oldRegistry));
		await db.transaction({checks,puts:[put('users',ctx.user.id,{...old,name}),put('names',digest(name),{user_id:ctx.user.id})],deletes}); return true;
	}); }
	function addPost(token,kind,title,body,category,attachment=null,created=Date.now(),id=randomUUID()) { return retry(async()=>{
		const ctx=await required(token,true); id=String(id); safeId(id);
		const fingerprint=digest(JSON.stringify([kind,title,body,category,attachment?.digest||null]));
		const existing=await collections.posts.get(id);
		if(existing) { if(existing.user_id===ctx.user.id && existing.fingerprint===fingerprint) return id; throw new Problem(409,'Ten identyfikator wpisu jest już zajęty. Odśwież formularz.'); }
		const quota=await slot(`publish:${ctx.user.id}`,10);
		const image=attachment ? `/media/${id}.webp` : null;
		const post={user_id:ctx.user.id,kind,title,body,category,image,created,tags:tagList(title,body),fingerprint};
		await db.transaction({checks:[...ctx.checks,check('posts',id,null),quota.check],puts:[put('posts',id,post),quota.put],...(attachment ? {attachment:{name:`${namespace}/images/${id}.webp`,content_type:'image/webp',data:attachment.data}} : {})}); return id;
	}); }
	function reply(token,post,body) { safeId(post); const id=randomUUID(); return retry(async()=>{
		const ctx=await required(token,true); const visible=(await read('SELECT id FROM posts WHERE id=?',post))[0]; if(!visible) throw new Problem(404,'Nie znaleziono wpisu.');
		const mod=await collections.moderation.get(`post/${post}`); if(mod?.hidden) throw new Problem(404,'Nie znaleziono wpisu.'); const quota=await slot(`reply:${ctx.user.id}`,20);
		await db.transaction({checks:[...ctx.checks,check('moderation',`post/${post}`,mod),quota.check],puts:[put('replies',id,{post_id:String(post),user_id:ctx.user.id,body,created:Date.now()}),quota.put]});return id;
	}); }
	function toggle(table,token,target) { safeId(target); if(!['likes','bookmarks','follows'].includes(table)) throw new Problem(400,'Niepoprawna relacja.'); return retry(async()=>{
		const ctx=await required(token); const key=`${ctx.user.id}/${target}`, old=await collections[table].get(key);
		if(table==='follows' ? target===ctx.user.id || !await collections.users.get(target) : !(await read('SELECT id FROM posts WHERE id=?',target)).length) throw new Problem(404,'Nie znaleziono celu.');
		await db.transaction({checks:[...ctx.checks,check(table,key,old)],puts:old?[]:[put(table,key,{user_id:ctx.user.id,[table==='follows'?'target_id':'post_id']:String(target)})],deletes:old?[remove(table,key)]:[]}); return !old;
	}); }

	async function sessionList(token) {
		const ctx=await required(token); const rows=await read('SELECT * FROM sessions WHERE user_id=? AND created>? AND COALESCE(revoked,0)=0 AND COALESCE(generation,\'legacy\')=? ORDER BY created DESC LIMIT 100',ctx.user.id,Date.now()-365*86400000,ctx.policy.generation);
		return [...rows].map((s)=>({id:s.id||`legacy_${digest(s.record_key)}`,device:s.device||'Starsza sesja',created:s.created,current:s.record_key===ctx.key}));
	}
	function revokeSession(token,id) { return retry(async()=>{
		const ctx=await required(token); let selected;
		if(/^legacy_[a-f0-9]{64}$/.test(id)) {
			for(let page=1;!selected;page++) { const rows=await collections.sessions.where('user_id','eq',ctx.user.id).page(page,1000); selected=rows.find((r)=>!r.value.id && `legacy_${digest(r.key)}`===id); if(rows.length<1000) break; }
		} else { safeId(id); const row=(await read('SELECT record_key FROM sessions WHERE user_id=? AND id=? LIMIT 1',ctx.user.id,id))[0]; if(row) selected={key:row.record_key,value:await collections.sessions.get(row.record_key)}; }
		if(!selected?.value || selected.value.user_id!==ctx.user.id) throw new Problem(404,'Nie znaleziono sesji.');
		await db.transaction({checks:[...ctx.checks,check('sessions',selected.key,selected.value)],puts:[put('sessions',selected.key,{...selected.value,revoked:true})]}); return selected.key===ctx.key;
	}); }
	function revokeOthers(token) { return retry(async()=>{
		const ctx=await required(token), generation=randomUUID();
		await db.transaction({checks:ctx.checks,puts:[put('accounts',ctx.user.id,{...ctx.policy,generation}),put('sessions',ctx.key,{...ctx.session,generation})]});
	}); }
	function verification(token,note) { return retry(async()=>{
		const ctx=await required(token); if(ctx.policy.approved || ctx.policy.request) return;
		const quota=await slot(`verification:${ctx.user.id}`,3,86400000);
		await db.transaction({checks:[...ctx.checks,quota.check],puts:[put('accounts',ctx.user.id,{...ctx.policy,request:{note,code:randomBytes(4).toString('hex'),created:Date.now()}}),quota.put]});
	}); }
	function report(token,kind,target,reason) { return retry(async()=>{
		const ctx=await required(token); safeId(target); if(!['post','reply'].includes(kind)) throw new Problem(400,'Niepoprawny typ zgłoszenia.');
		if(!(await read(`SELECT id FROM ${kind==='post'?'posts':'replies'} WHERE id=?`,target)).length) throw new Problem(404,'Nie znaleziono treści.');
		const quota=await slot(`report:${ctx.user.id}`,10,3600000);
		await db.transaction({checks:[...ctx.checks,quota.check],puts:[put('reports',randomUUID(),{kind,target,user_id:ctx.user.id,reason,created:Date.now(),resolved:false}),quota.put]});
	}); }
	function moderate(admin,kind,target,action,reason,code='') { return retry(async()=>{
		safeId(target);
		const currentAdmin=await collections.admin_sessions.get(admin.key);
		if(!currentAdmin || currentAdmin.revoked || currentAdmin.expires<=Date.now()) throw new Problem(401,'Sesja administratora wygasła.');
		const checks=[check('admin_sessions',admin.key,admin.record)],puts=[];
		if(kind==='user') {
			if(!await collections.users.get(target)) throw new Problem(404,'Nie znaleziono konta.');
			const old=await collections.accounts.get(target), value={...(old||policyDefault())}; checks.push(check('accounts',target,old));
			if(action==='approve') { if(!value.request || value.request.code!==code) throw new Problem(400,'Potwierdź kod właściciela konta.'); value.approved=true; value.request=null; }
			else if(action==='unverify') value.approved=false;
			else if(action==='reject') { value.approved=false; value.request=null; }
			else if(action==='logout') value.generation=randomUUID();
			else if(action==='ban'||action==='unban') { value.banned=action==='ban'; value.generation=randomUUID(); }
			else throw new Problem(400,'Niepoprawne działanie.');
			puts.push(put('accounts',target,{...value,reason,updated:Date.now()}));
		} else if(kind==='report' && action==='resolve') {
			const old=await collections.reports.get(target); if(!old) throw new Problem(404,'Nie znaleziono zgłoszenia.'); checks.push(check('reports',target,old)); puts.push(put('reports',target,{...old,resolved:true}));
		} else if(['post','reply'].includes(kind) && ['hide','restore'].includes(action)) {
			if(!await collections[kind==='post'?'posts':'replies'].get(target)) throw new Problem(404,'Nie znaleziono treści.');
			const key=`${kind}/${target}`,old=await collections.moderation.get(key); checks.push(check('moderation',key,old)); puts.push(put('moderation',key,{kind,target,hidden:action==='hide',reason,created:Date.now()}));
		} else throw new Problem(400,'Niepoprawne działanie.');
		puts.push(put('audit',randomUUID(),{action,kind,target,reason,created:Date.now(),actor:admin.record.id})); await db.transaction({checks,puts});
	}); }
	async function adminData(view='reports',page=1,target='') {
		const queries={
			reports:'SELECT r.*,u.name FROM reports r LEFT JOIN users u ON u.id=r.user_id ORDER BY resolved,created DESC',
			users:'SELECT u.*,a.approved,a.banned,a.request FROM users u LEFT JOIN accounts a ON a.id=u.id ORDER BY a.request IS NOT NULL DESC,u.name',
			posts:"SELECT p.*,u.name,COALESCE(m.hidden,0) AS hidden FROM posts_raw p JOIN users u ON u.id=p.user_id LEFT JOIN moderation m ON m.kind='post' AND m.target=p.id ORDER BY p.created DESC",
			replies:"SELECT r.*,u.name,COALESCE(m.hidden,0) AS hidden FROM replies_raw r JOIN users u ON u.id=r.user_id LEFT JOIN moderation m ON m.kind='reply' AND m.target=r.id ORDER BY r.created DESC",
			audit:'SELECT * FROM audit ORDER BY created DESC'
		};
		if(!queries[view]) view='reports'; page=Math.max(1,Math.min(10000,Math.floor(Number(page)||1)));
		const alias={users:'u.id',posts:'p.id',replies:'r.id',reports:'r.id',audit:'id'}[view];
		const sql=target ? queries[view].replace(' ORDER BY',` WHERE ${alias}=? ORDER BY`) : queries[view];
		const rows=await read(`${sql} LIMIT 100 OFFSET ?`,...(target?[target]:[]),(page-1)*100);
		return {view,page,target,rows:[...rows].map((r)=>({...r,...(r.request ? {request:JSON.parse(r.request)} : {})}))};
	}
	async function feed(user,params=new URLSearchParams()) {
		const view=params.get('view')||'all',filters=[],values=[];
		if(['question','blip'].includes(params.get('type'))) {filters.push('p.kind=?');values.push(params.get('type'));}
		for(const [param,column] of [['category','p.category'],['user','p.user_id']]) if(params.get(param)){filters.push(`${column}=?`);values.push(params.get(param));}
		if(params.get('q')) {filters.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')");const q=`%${params.get('q').slice(0,200).replace(/[\\%_]/g,'\\$&')}%`; values.push(q,q,q);}
		if(params.get('tag')){filters.push('EXISTS(SELECT 1 FROM tags WHERE post_id=p.id AND tag=?)');values.push(params.get('tag').toLocaleLowerCase('pl'));}
		if(view==='unanswered')filters.push("p.kind='question' AND NOT EXISTS(SELECT 1 FROM replies WHERE post_id=p.id)");
		if(view==='saved'){filters.push('EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?)');values.push(user);}
		if(view==='following'){filters.push('EXISTS(SELECT 1 FROM follows WHERE target_id=p.user_id AND user_id=?)');values.push(user);}
		const where=filters.length?`WHERE ${filters.join(' AND ')}`:'';
		const [{count:total}]=await read(`SELECT COUNT(*) AS count FROM posts p JOIN users u ON u.id=p.user_id ${where}`,...values);
		const page=Math.min(Math.max(1,Math.floor(Number(params.get('page'))||1)),Math.max(1,Math.ceil(total/20)));
		const posts=await read(`SELECT p.id,p.user_id,p.kind,p.title,p.body,p.category,p.image,p.created,u.name,u.avatar,
			(SELECT approved FROM accounts WHERE id=u.id) AS approved,(SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,
			(SELECT COUNT(*) FROM replies WHERE post_id=p.id) AS reply_count,
			EXISTS(SELECT 1 FROM likes WHERE post_id=p.id AND user_id=?) AS liked,
			EXISTS(SELECT 1 FROM bookmarks WHERE post_id=p.id AND user_id=?) AS saved
			FROM posts p JOIN users u ON u.id=p.user_id ${where} ORDER BY ${view==='popular'?'likes DESC,':''}p.created DESC,p.id DESC LIMIT 20 OFFSET ?`,user,user,...values,(page-1)*20);
		await Promise.all(posts.map(async(p)=>{p.replies=[...await read('SELECT r.*,u.name,u.avatar FROM replies r JOIN users u ON u.id=r.user_id WHERE post_id=? ORDER BY r.created,r.id LIMIT 100',p.id)];}));
		return {posts:[...posts],total,page};
	}
	return {namespace,collections,init,read,check,put,context,authenticated,visitor,issueTicket,recoverTicket,rename,addPost,reply,toggle,sessionList,revokeSession,revokeOthers,verification,report,moderate,adminData,feed,limit};
}
export const store=openStore();
