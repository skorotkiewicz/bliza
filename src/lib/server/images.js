import sharp from 'sharp';
import https from 'node:https';
import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
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

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(address,prefix,'ipv4');
const publicIPv6 = new BlockList(); publicIPv6.addSubnet('2000::',3,'ipv6');
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) blocked.addSubnet(address,prefix,'ipv6');
export function isPublicImageAddress(address) {
	const family=isIP(address);
	return family===4 ? !blocked.check(address,'ipv4') : family===6 && publicIPv6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
export async function downloadImage(source) {
	const signal=AbortSignal.timeout(10000);
	for(let redirects=0;redirects<=3;redirects++) {
		let url;try{url=new URL(source);}catch{throw new Problem(400,'Podaj poprawny link HTTPS do zdjęcia.');}
		if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || url.href.length>2048) throw new Problem(400,'Podaj publiczny link HTTPS do zdjęcia, bez danych logowania.');
		const result=await new Promise((resolve,reject)=>{
			const request=https.request(url,{
				method:'GET',agent:false,signal,headers:{Accept:'image/jpeg, image/png, image/gif, image/webp'},
				// Pin the validated DNS result to the connection, including every redirect.
				lookup(host,options,callback){dns.lookup(host,{all:true}).then((addresses)=>{
					if(!addresses.length || addresses.some((entry)=>!isPublicImageAddress(entry.address))) throw new Problem(400,'Zdjęcie musi pochodzić z publicznego serwera.');
					const address=addresses[0];if(options.all)callback(null,[address]);else callback(null,address.address,address.family);
				}).catch(callback);}
			},(response)=>{
				if([301,302,303,307,308].includes(response.statusCode)) {
					const location=response.headers.location;response.destroy();
					if(!location || redirects===3)return reject(new Problem(400,'Nie możemy pobrać zdjęcia: zbyt wiele przekierowań.'));
					try{resolve({redirect:new URL(location,url).href});}catch{reject(new Problem(400,'Niepoprawne przekierowanie zdjęcia.'));}return;
				}
				if(response.statusCode!==200 || Number(response.headers['content-length'])>MAX_IMAGE_SIZE){response.destroy();return reject(new Problem(400,'Nie możemy pobrać zdjęcia. Limit to 5 MB.'));}
				const chunks=[];let size=0;
				response.on('data',(chunk)=>{size+=chunk.length;if(size>MAX_IMAGE_SIZE){reject(new Problem(400,'Zdjęcie może mieć maksymalnie 5 MB.'));request.destroy();}else chunks.push(chunk);});
				response.on('error',reject);
				response.on('aborted',()=>reject(new Problem(400,'Pobieranie zdjęcia zostało przerwane.')));
				response.on('end',()=>size ? resolve({file:new File([Buffer.concat(chunks)],'zdjecie-z-linku',{type:(response.headers['content-type']||'').split(';')[0].trim()})}) : reject(new Problem(400,'Link nie zawiera zdjęcia.')));
			});
			request.on('error',reject);request.end();
		}).catch((err)=>{throw err instanceof Problem ? err : new Problem(400,'Nie możemy pobrać zdjęcia. Sprawdź link lub wybierz plik.');});
		if(result.file)return result.file;source=result.redirect;
	}
}
