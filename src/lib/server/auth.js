import { error } from '@sveltejs/kit';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { store, digest, Problem } from './db.js';

export async function readForm(event) { try { return await event.request.formData(); } catch { throw new Problem(400,'Nieprawidłowy formularz.'); } }
export function sessionCookie(event, token) {
	event.cookies.set('bliza_session', token, { path:'/', httpOnly:true, sameSite:'lax', secure:event.url.protocol==='https:', maxAge:365*86400 });
}
export async function currentUser(event) {
	const old=event.cookies.get('bliza_session');
	const {user,token}=await store.visitor(old,event.request.headers.get('user-agent'),event.getClientAddress());
	if(old!==token) sessionCookie(event,token);
	return user;
}
export async function actor(event) {
	const token=event.cookies.get('bliza_session');
	const user=await store.authenticated(token);
	if(!user) throw new Problem(401,'Sesja została wylogowana. Wróć z biletem.');
	return {user,token};
}
export const adminEnabled=()=>typeof process.env.ADMIN==='string' && /^[\x21-\x7e]{32,256}$/.test(process.env.ADMIN);
export function adminSecretMatches(input) {
	return adminEnabled() && typeof input==='string' && input.length<=256 && timingSafeEqual(Buffer.from(digest(input),'hex'),Buffer.from(digest(process.env.ADMIN),'hex'));
}
export async function adminContext(event) {
	if(!adminEnabled()) return null;
	const token=event.cookies.get('bliza_admin'); if(!/^[a-f0-9]{64}$/.test(token||'')) return null;
	const key=digest(token), record=await store.collections.admin_sessions.get(key);
	return record && !record.revoked && record.expires>Date.now() && record.config===digest(process.env.ADMIN) ? {key,record} : null;
}
export async function requireAdmin(event) {
	if(!adminEnabled()) error(404,'Nie znaleziono strony.');
	const ctx=await adminContext(event); if(!ctx) error(401,'Zaloguj się jako administrator.'); return ctx;
}
export async function loginAdmin(event,input) {
	if(!adminEnabled()) error(404,'Nie znaleziono strony.');
	await store.limit(`admin-login:${event.getClientAddress()}`,5);
	if(!adminSecretMatches(input)) return false;
	const token=randomBytes(32).toString('hex');
	await store.collections.admin_sessions.put(digest(token), {id:randomUUID(),config:digest(process.env.ADMIN),expires:Date.now()+8*3600000,revoked:false});
	event.cookies.set('bliza_admin',token,{path:'/admin',httpOnly:true,sameSite:'strict',secure:event.url.protocol==='https:',maxAge:8*3600});
	return true;
}
