import { error } from '@sveltejs/kit';
import { files } from 'openrails';
import { IMAGE_NAME, imageKey } from '#lib/server/images.js';

export async function GET({ params }) {
	if (!IMAGE_NAME.test(params.name)) error(404, 'Nie znaleziono zdjęcia.');
	let image;
	try {
		image = await files.get(imageKey(params.name));
	} catch {
		error(503, 'Serwer zdjęć jest chwilowo niedostępny.');
	}
	if (!image) error(404, 'Nie znaleziono zdjęcia.');
	const type = image.headers.get('content-type');
	if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type))
		error(404, 'Nie znaleziono zdjęcia.');
	return new Response(image.body, {
		headers: {
			'Content-Type': type,
			'Cache-Control': 'public, max-age=86400, immutable',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox"
		}
	});
}
