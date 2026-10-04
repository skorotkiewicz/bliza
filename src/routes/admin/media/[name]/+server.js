import { error } from '@sveltejs/kit';
import { files } from 'openrails';
import { requireAdmin } from '#lib/server/auth.js';
import { IMAGE_NAME, imageKey } from '#lib/server/images.js';
export async function GET(event) {
	await requireAdmin(event);
	if(!IMAGE_NAME.test(event.params.name)) error(404,'Nie znaleziono zdjęcia.');
	const image=await files.get(imageKey(event.params.name));
	if(!image || image.headers.get('content-type')!=='image/webp') error(404,'Nie znaleziono zdjęcia.');
	return new Response(image.body,{headers:{'Content-Type':image.headers.get('content-type'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
