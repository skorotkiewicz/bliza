import { error, fail, redirect, isHttpError, isRedirect } from '@sveltejs/kit';
import { store, Problem } from '#lib/server/db.js';
import { adminEnabled, adminContext, requireAdmin, loginAdmin } from '#lib/server/auth.js';
import { db, files } from 'openrails';
import { randomUUID } from 'node:crypto';
const text=(form,key)=>typeof form.get(key)==='string'?form.get(key).trim():'';
export async function load(event) {
	if(!adminEnabled()) error(404,'Nie znaleziono strony.');
	try { const ctx=await adminContext(event); return ctx?{loggedIn:true,...await store.adminData(event.url.searchParams.get('view'),event.url.searchParams.get('page'),event.url.searchParams.get('target')||'')}:{loggedIn:false}; }
	catch { error(503,'OpenRails jest niedostępny lub wymaga aktualizacji API.'); }
}
const handlers={
	login:async(event)=>{
		const form=await event.request.formData();
		if(!await loginAdmin(event,form.get('secret'))) return fail(401,{error:'Niepoprawny klucz administratora.'});
		redirect(303,'/admin');
	},
	logout:async(event)=>{const ctx=await requireAdmin(event);await db.transaction({checks:[store.check('admin_sessions',ctx.key,ctx.record)],puts:[store.put('admin_sessions',ctx.key,{...ctx.record,revoked:true})]});event.cookies.delete('bliza_admin',{path:'/admin'});redirect(303,'/admin');},
	cleanup:async(event)=>{
		const ctx=await requireAdmin(event),form=await event.request.formData();
		if(form.get('confirmed')!=='yes') return fail(400,{error:'Potwierdź usunięcie niepowiązanych plików zaplecza.'});
		const result=await files.gc({confirm:true,dry_run:false,checks:[store.check('admin_sessions',ctx.key,ctx.record)]});
		await store.collections.audit.put(randomUUID(),{action:'cleanup',kind:'storage',target:'unreferenced-blobs',reason:`Usunięto ${result.files} niepowiązanych plików zaplecza`,created:Date.now(),actor:ctx.record.id});
		return {success:`Usunięto ${result.files} niepowiązanych plików (${result.bytes} bajtów). Powiązane zdjęcia pozostają bez zmian.`};
	},
	moderate:async(event)=>{
		const ctx=await requireAdmin(event), form=await event.request.formData(),reason=text(form,'reason'),action=text(form,'operation');
		if(reason.length<5||reason.length>500)return fail(400,{error:'Powód działania: 5–500 znaków.'});
		if(action==='approve'&&form.get('confirmed')!=='yes')return fail(400,{error:'Potwierdź ręczną weryfikację właściciela konta.'});
		await store.moderate(ctx,text(form,'kind'),text(form,'id'),action,reason,text(form,'code'));return {success:'Zapisano działanie w dzienniku moderacji.'};
	}
};
export const actions=Object.fromEntries(Object.entries(handlers).map(([key,fn])=>[key,async(event)=>{try{return await fn(event);}catch(err){if(isHttpError(err)||isRedirect(err))throw err;return fail(err instanceof Problem?err.status:503,{error:err instanceof Problem?err.message:'Nie udało się zapisać działania. Sprawdź OpenRails.'});}}]));
