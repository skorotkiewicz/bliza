import { fail, error, isRedirect, isHttpError } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { store, categories, Problem, digest } from '#lib/server/db.js';
import { currentUser, actor, sessionCookie, readForm } from '#lib/server/auth.js';
import { uploadImage } from '#lib/server/images.js';
import { MAX_TICKET_SIZE } from '#lib/server/tickets.js';

export async function load(event) {
	try {
		const user=await currentUser(event);
		const [feed,counts,trending,people,stats,ticket,sessions]=await Promise.all([
			store.feed(user.id,event.url.searchParams), store.read('SELECT category,COUNT(*) AS n FROM posts GROUP BY category'),
			store.read('SELECT tag,COUNT(*) AS count FROM tags GROUP BY tag ORDER BY count DESC,tag LIMIT 6'),
			store.read(`SELECT u.*, (SELECT COUNT(*) FROM posts WHERE user_id=u.id)+(SELECT COUNT(*) FROM replies WHERE user_id=u.id) AS contributions,
			EXISTS(SELECT 1 FROM follows WHERE user_id=? AND target_id=u.id) AS following FROM users u WHERE u.id!=? AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.id=u.id AND a.banned=1) ORDER BY contributions DESC,u.name LIMIT 4`,user.id,user.id),
			store.read(`SELECT (SELECT COUNT(*) FROM posts) AS posts,(SELECT COUNT(*) FROM users) AS users,
			(SELECT COUNT(*) FROM posts WHERE user_id=?) AS mine,(SELECT COUNT(*) FROM follows WHERE user_id=?) AS following,
			(SELECT COUNT(*) FROM bookmarks WHERE user_id=?) AS saved,(SELECT COUNT(*) FROM posts WHERE kind='question' AND NOT EXISTS(SELECT 1 FROM replies WHERE post_id=posts.id)) AS unanswered`,user.id,user.id,user.id),
			store.collections.tickets.get(user.id),store.sessionList(event.cookies.get('bliza_session'))
		]);
		return {user,...feed,postNonce:randomUUID(),sessions,hasTicket:Boolean(ticket),filters:Object.fromEntries(event.url.searchParams),categories:categories.map(([name,icon])=>({name,icon,count:counts.find((r)=>r.category===name)?.n||0})),trending:[...trending],people:[...people],stats:stats[0]};
	} catch { error(503,'OpenRails jest niedostępny lub wymaga aktualizacji API transakcji. Sprawdź konfigurację serwera.'); }
}
const text=(form,name)=>typeof form.get(name)==='string'?form.get(name).trim():'';
const uuid=(id)=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id);
const handlers={
	recover:async(event)=>{
		await store.limit(`recover:${event.getClientAddress()}`,20);
		if(Number(event.request.headers.get('content-length'))>MAX_TICKET_SIZE+1024) return fail(413,{ticketError:'Bilet może mieć najwyżej 4 KB.'});
		let file;try{file=(await readForm(event)).get('ticket');}catch{return fail(400,{ticketError:'Wybierz plik z biletem.'});}
		if(!(file instanceof File)||!file.size||file.size>MAX_TICKET_SIZE) return fail(400,{ticketError:'Wybierz bilet w pliku TXT, maksymalnie 4 KB.'});
		const restored=await store.recoverTicket(await file.text(),event.request.headers.get('user-agent'));
		if(!restored) return fail(401,{ticketError:'Kasownik nie rozpoznaje biletu. Plik jest niepoprawny, konto zablokowane albo bilet został zastąpiony nowym.'});
		sessionCookie(event,restored.token);return {recovered:true,success:`Bilet sprawdzony. Cześć, ${restored.user.name}!`};
	},
	publish:async(event)=>{
		if(Number(event.request.headers.get('content-length'))>6*1024*1024)return fail(413,{error:'Zdjęcie może mieć maksymalnie 5 MB.'});
		const form=await readForm(event),values=Object.fromEntries(['kind','title','body','category'].map((k)=>[k,text(form,k)]));
		const {kind,title,body,category}=values;
		if(!['question','blip'].includes(kind)||!categories.some(([n])=>n===category))return fail(400,{error:'Wybierz typ wpisu i kategorię.',values});
		if(kind==='question'&&(title.length<5||title.length>180))return fail(400,{error:'Pytanie musi mieć od 5 do 180 znaków.',values});
		if(body.length>(kind==='blip'?160:4000)||(kind==='blip'&&!body))return fail(400,{error:kind==='blip'?'Blip musi mieć od 1 do 160 znaków.':'Opis może mieć maksymalnie 4000 znaków.',values});
		const id=text(form,'nonce'); if(!uuid(id))return fail(400,{error:'Odśwież formularz przed publikacją.',values});
		const file=form.get('image');if(file&&(!(file instanceof File)||(file.size&&kind!=='blip')))return fail(400,{error:'Zdjęcia możesz dodawać tylko do blipów.',values});
		try {
			const {user,token}=await actor(event);if(!user.approved)throw new Problem(403,'Poproś moderatora o zatwierdzenie konta w swoim profilu.');
			const attachment=await uploadImage(file);await store.addPost(token,kind,kind==='question'?title:'',body,category,attachment,Date.now(),id);
			return {success:kind==='question'?'Pytanie dodane. Teraz czas na odpowiedzi!':'Blip poszedł w świat!'};
		}catch(err){return fail(err instanceof Problem?err.status:503,{error:err instanceof Problem?err.message:'Nie udało się zapisać wpisu. Spróbuj ponownie; szkic został w formularzu.',values});}
	},
	reply:async(event)=>{const {token}=await actor(event),form=await readForm(event),id=text(form,'id'),body=text(form,'body');if(!body||body.length>2000)return fail(400,{error:'Odpowiedź musi mieć od 1 do 2000 znaków.'});await store.reply(token,id,body);return {success:'Odpowiedź dodana. Dzięki za rozmowę!'};},
	like:async(e)=>relation(e,'likes'),save:async(e)=>relation(e,'bookmarks'),follow:async(e)=>relation(e,'follows'),
	profile:async(event)=>{const {token}=await actor(event),name=text(await readForm(event),'name');if(!/^[\p{L}\p{N}_.]{3,24}$/u.test(name))return fail(400,{error:'Nick: 3–24 litery, cyfry, kropki lub podkreślenia.'});if(!await store.rename(token,name))return fail(400,{error:'Ten nick jest już zajęty. Wybierz inny.'});return {success:'Gotowe. Miło Cię poznać!',profileSaved:true};},
	verification:async(event)=>{const {token}=await actor(event),note=text(await readForm(event),'note');if(note.length<10||note.length>500)return fail(400,{error:'Napisz od 10 do 500 znaków. Nie wysyłaj danych wrażliwych.'});await store.verification(token,note);return {success:'Prośba wysłana. Kod potwierdzenia znajdziesz w swoim profilu.'};},
	report:async(event)=>{const {token}=await actor(event),form=await readForm(event),reason=text(form,'reason');if(reason.length<5||reason.length>500)return fail(400,{error:'Powód zgłoszenia: 5–500 znaków.'});await store.report(token,text(form,'kind'),text(form,'id'),reason);return {success:'Zgłoszenie dotarło do moderatora.'};},
	session:async(event)=>{const {token}=await actor(event),form=await readForm(event),id=text(form,'id'),ctx=await store.context(token);if(id===(ctx.session.id||`legacy_${digest(ctx.key)}`)&&form.get('confirmed')!=='yes')return fail(400,{error:'Zapisz bilet i potwierdź wylogowanie.'});const loggedOut=await store.revokeSession(token,id);if(loggedOut)event.cookies.delete('bliza_session',{path:'/'});return {loggedOut,success:'Sesja wylogowana.'};},
	others:async(event)=>{const {token}=await actor(event);if((await readForm(event)).get('confirmed')!=='yes')return fail(400,{error:'Potwierdź wylogowanie innych urządzeń.'});await store.revokeOthers(token);return {success:'Pozostałe urządzenia zostały wylogowane.'};},
	logout:async(event)=>{const {token}=await actor(event);if((await readForm(event)).get('confirmed')!=='yes')return fail(400,{error:'Zapisz bilet i potwierdź wylogowanie.'});const ctx=await store.context(token);await store.revokeSession(token,ctx.session.id||`legacy_${digest(ctx.key)}`);event.cookies.delete('bliza_session',{path:'/'});return {loggedOut:true,success:'Do zobaczenia! Wróć ze swoim biletem.'};}
};
async function relation(event,table){const {token}=await actor(event),id=text(await readForm(event),'id');await store.toggle(table,token,id);return {success:null};}
export const actions=Object.fromEntries(Object.entries(handlers).map(([name,fn])=>[name,async(event)=>{try{return await fn(event);}catch(err){if(isRedirect(err)||isHttpError(err))throw err;return fail(err instanceof Problem?err.status:503,{[name==='recover'?'ticketError':'error']:err instanceof Problem?err.message:'OpenRails jest chwilowo niedostępny. Spróbuj ponownie.'});}}]));
