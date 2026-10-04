import { error, isHttpError } from '@sveltejs/kit';
import { files } from 'openrails';
import { IMAGE_NAME, imageKey } from '#lib/server/images.js';
import { store } from '#lib/server/db.js';

export async function GET({ params }) {
	if (!IMAGE_NAME.test(params.name)) error(404, 'Nie znaleziono zdjęcia.');
	let image;
	try {
		if (!(await store.read('SELECT id FROM posts WHERE image=? LIMIT 1',`/media/${params.name}`)).length) error(404,'Nie znaleziono zdjęcia.');
		image = await files.get(imageKey(params.name));
	} catch (err) {
		if (isHttpError(err)) throw err;
		error(503, 'Serwer zdjęć jest chwilowo niedostępny.');
	}
	if (!image) error(404, 'Nie znaleziono zdjęcia.');
	const type = image.headers.get('content-type');
	if (type !== 'image/webp')
		error(404, 'Nie znaleziono zdjęcia.');
	return new Response(image.body, {
		headers: {
			'Content-Type': type,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox"
		}
	});
}
