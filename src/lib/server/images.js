import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { store } from './db.js';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const IMAGE_NAME = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(jpg|png|gif|webp)$/;
export const imageKey = (name) => `${store.namespace}/images/${name}`;

export async function uploadImage(file) {
	if (!(file instanceof File) || !file.size) return null;
	if (file.size > MAX_IMAGE_SIZE) throw new TypeError('Zdjęcie może mieć maksymalnie 5 MB.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	let extension;
	let type;
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
		extension = 'jpg';
		type = 'image/jpeg';
	} else if (
		bytes.length >= 8 &&
		[137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
	) {
		extension = 'png';
		type = 'image/png';
	} else if (
		bytes.length >= 6 &&
		['GIF87a', 'GIF89a'].includes(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))
	) {
		extension = 'gif';
		type = 'image/gif';
	} else if (
		bytes.length >= 12 &&
		Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
		Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
	) {
		extension = 'webp';
		type = 'image/webp';
	} else throw new TypeError('Wybierz zdjęcie w formacie JPG, PNG, GIF lub WebP.');
	if (file.type && file.type !== type)
		throw new TypeError('Zawartość zdjęcia nie pasuje do jego formatu.');
	let output;
	try {
		const image = sharp(bytes, { limitInputPixels: 16777216, animated: true });
		const metadata = await image.metadata();
		if (!metadata.pages || metadata.pages === 1) image.rotate();
		output = await image.resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
	} catch { throw new TypeError('Nie możemy odczytać zdjęcia. Limit to 16 mln pikseli.'); }
	return { data: output.toString('base64'), digest: createHash('sha256').update(output).digest('hex') };
}
