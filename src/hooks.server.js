import { dev } from '$app/environment';
export async function handle({event,resolve}) {
	if(!dev && event.url.protocol!=='https:' && !['localhost','127.0.0.1','[::1]'].includes(event.url.hostname)) return new Response('Configure HTTPS and rebuild with the correct ORIGIN before public deployment.',{status:503});
	const response=await resolve(event), headers=new Headers(response.headers);
	headers.set('X-Content-Type-Options','nosniff'); headers.set('Referrer-Policy','same-origin');
	headers.set('X-Frame-Options','DENY'); headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
	if(/text\/html|application\/json/.test(headers.get('content-type')||'') || event.url.pathname.startsWith('/admin')) headers.set('Cache-Control','private, no-store');
	if(event.url.pathname.startsWith('/admin')) headers.set('X-Robots-Tag','noindex, nofollow');
	if(event.url.protocol==='https:') headers.set('Strict-Transport-Security','max-age=31536000');
	return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
