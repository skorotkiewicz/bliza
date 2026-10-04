import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { store, Problem } from './db.js';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const IMAGE_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$/;
export const imageKey = (name) => `${store.namespace}/images/${name}`;

export async function uploadImage(file) {
	if (!(file instanceof File) || !file.size) return null;
	if (file.size > MAX_IMAGE_SIZE) throw new Problem(400,'Zdjęcie może mieć maksymalnie 5 MB.');
	const bytes = new Uint8Array(await file.arrayBuffer());
	let type;
	if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
		type = 'image/jpeg';
	} else if (
		bytes.length >= 8 &&
		[137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
	) {
		type = 'image/png';
	} else if (
		bytes.length >= 6 &&
		['GIF87a', 'GIF89a'].includes(Buffer.from(bytes.subarray(0, 6)).toString('ascii'))
	) {
		type = 'image/gif';
	} else if (
		bytes.length >= 12 &&
		Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
		Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
	) {
		type = 'image/webp';
	} else throw new Problem(400,'Wybierz zdjęcie w formacie JPG, PNG, GIF lub WebP.');
	if (file.type && file.type !== type)
		throw new Problem(400,'Zawartość zdjęcia nie pasuje do jego formatu.');
	let output;
	try {
		const image = sharp(bytes, { limitInputPixels: 16777216, animated: true });
		const metadata = await image.metadata();
		if (!metadata.pages || metadata.pages === 1) image.rotate();
		output = await image.resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
	} catch { throw new Problem(400,'Nie możemy odczytać zdjęcia. Limit to 16 mln pikseli.'); }
	if(output.length>MAX_IMAGE_SIZE) throw new Problem(400,'Przetworzone zdjęcie przekracza 5 MB. Wybierz mniejszy plik.');
	return { data: output.toString('base64'), digest: createHash('sha256').update(output).digest('hex') };
}
