import { test, expect, spyOn } from 'bun:test';
import { randomUUID, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { openStore, digest } from './db.js';
import { uploadImage, MAX_IMAGE_SIZE, IMAGE_NAME, downloadImage, isPublicImageAddress } from './images.js';
import { formatTicket, parseTicket, MAX_TICKET_SIZE } from './tickets.js';

process.env.SEED_DEMO='false';
process.env.REQUIRE_APPROVAL='true';
test.skipIf(!process.env.OPENRAILS_TOKEN)('atomic account approval, concurrent mutations, moderation and revoked sessions',async()=>{
	const namespace=`bliza_test_${randomUUID().replaceAll('-','')}`;
	const first=openStore(namespace),second=openStore(namespace);
	const owner=await first.visitor(),other=await second.visitor();
	expect(owner.user.id).not.toBe(other.user.id);
	expect((await second.visitor(owner.token)).user.id).toBe(owner.user.id);
	expect((await first.visitor(owner.user.id)).user.id).not.toBe(owner.user.id);
	expect(await first.authenticated('not-a-token')).toBeNull();
	expect(await second.authenticated(digest(owner.token))).toBeNull();
	expect((await first.feed(owner.user.id)).total).toBe(0);
	await expect(first.addPost(owner.token,'blip','','Bez zgody','Codzienność')).rejects.toThrow('zatwierdzenie');
	const admin={key:digest(randomBytes(32)),record:{id:randomUUID(),expires:Date.now()+3600000,revoked:false}};
	await first.collections.admin_sessions.put(admin.key,admin.record);
	for(const member of [owner,other]) {
		await first.verification(member.token,'Uczestniczę w naszej testowej społeczności.');
		const code=(await first.authenticated(member.token)).verification.code;
		await expect(first.moderate(admin,'user',member.user.id,'approve','Kontakt z właścicielem','bad-code')).rejects.toThrow('kod');
		await second.moderate(admin,'user',member.user.id,'approve','Kontakt z właścicielem',code);
		expect((await first.authenticated(member.token)).approved).toBe(true);
	}
	const id=randomUUID();
	const source=new File([await sharp({create:{width:3,height:2,channels:3,background:'#dd762d'}}).png().toBuffer()],'photo.png',{type:'image/png'});
	const attachment=await uploadImage(source);
	const post=()=>first.addPost(owner.token,'blip','','Rozmowa #Test #test','Codzienność',attachment,Date.now(),id);
	expect(await post()).toBe(id);expect(await post()).toBe(id);
	await expect(first.addPost(owner.token,'blip','','Inny tekst','Codzienność',attachment,Date.now(),id)).rejects.toThrow('zajęty');
	await second.reply(other.token,id,'Działa po ponownym uruchomieniu.');
	await first.toggle('likes',other.token,id);await first.toggle('bookmarks',other.token,id);await first.toggle('follows',other.token,owner.user.id);
	await Promise.all(Array.from({length:12},(_,i)=>(i%2?first:second).toggle('likes',other.token,id)));
	const saved=(await second.feed(other.user.id,new URLSearchParams({view:'saved'}))).posts[0];
	expect(saved.likes).toBe(1);expect(saved.saved).toBe(1);expect(saved.image).toBe(`/media/${id}.webp`);
	expect(saved.replies[0].body).toContain('ponownym');
	expect((await first.feed(other.user.id,new URLSearchParams({view:'following'}))).total).toBe(1);
	expect((await first.feed(other.user.id,new URLSearchParams({tag:'TEST'}))).total).toBe(1);
	expect((await first.feed(other.user.id,new URLSearchParams({q:'%'}))).total).toBe(0);
	expect((await first.feed(other.user.id,new URLSearchParams({q:"' OR 1=1 --"}))).total).toBe(0);
	const names=await Promise.all([first.rename(owner.token,'wspólny_nick'),second.rename(other.token,'wspólny_nick')]);expect(names.filter(Boolean)).toHaveLength(1);
	expect(()=>first.toggle('follows',owner.token,'../tickets')).toThrow('identyfikator');
	await first.report(other.token,'post',id,'Proszę sprawdzić tę treść.');
	expect((await first.adminData('reports')).rows).toHaveLength(1);
	await second.moderate(admin,'post',id,'hide','Test ukrywania treści');expect((await first.feed(owner.user.id)).total).toBe(0);
	await expect(first.reply(other.token,id,'Nie wolno tutaj pisać')).rejects.toThrow('wpisu');
	await first.moderate(admin,'post',id,'restore','Test przywracania treści');expect((await second.feed(owner.user.id)).total).toBe(1);
	const ticket=await first.issueTicket(other.token),credential=parseTicket(ticket,namespace);
	expect((await first.collections.tickets.get(other.user.id)).hash).toBe(digest(credential.secret));
	expect(JSON.stringify(await first.collections.users.get(other.user.id))).not.toContain(credential.secret);
	expect(await first.collections.sessions.get(other.token)).toBeNull();
	expect(await first.issueTicket(other.token)).toBeNull();
	const restored=await second.recoverTicket(ticket,'Testowe urządzenie');
	expect(restored.user.id).toBe(other.user.id);expect(restored.token).not.toBe(credential.secret);
	const devices=await first.sessionList(other.token);expect(devices).toHaveLength(2);expect(JSON.stringify(devices)).not.toContain(restored.token);
	const device=devices.find((s)=>!s.current);
	await expect(first.revokeSession(owner.token,device.id)).rejects.toThrow('sesji');
	await first.revokeSession(other.token,device.id);expect(await second.authenticated(restored.token)).toBeNull();
	await expect(second.toggle('likes',restored.token,id)).rejects.toThrow('Sesja');
	const third=await second.recoverTicket(ticket);await first.revokeOthers(other.token);expect(await second.authenticated(third.token)).toBeNull();expect(await first.authenticated(other.token)).not.toBeNull();
	const fourth=await second.recoverTicket(ticket);const replacement=await first.issueTicket(other.token,true);
	expect(await first.recoverTicket(ticket)).toBeNull();expect(await second.authenticated(fourth.token)).toBeNull();expect(await first.authenticated(other.token)).not.toBeNull();
	expect(await second.recoverTicket(formatTicket(owner.user,namespace,credential.secret))).toBeNull();
	const latest=await second.recoverTicket(replacement);
	await first.moderate(admin,'user',other.user.id,'ban','Test blokady konta');
	expect(await second.authenticated(latest.token)).toBeNull();expect(await second.recoverTicket(replacement)).toBeNull();
	expect((await first.feed(owner.user.id)).posts[0].replies).toHaveLength(0);
	await first.moderate(admin,'user',other.user.id,'unban','Test odblokowania');
	expect(await second.authenticated(latest.token)).toBeNull();expect(await second.recoverTicket(replacement)).not.toBeNull();
	const outcomes=await Promise.allSettled([first.limit('shared-check',1),second.limit('shared-check',1)]);
	expect(outcomes.filter((x)=>x.status==='fulfilled')).toHaveLength(1);expect(outcomes.find((x)=>x.status==='rejected').reason.status).toBe(429);
	await first.collections.admin_sessions.put(admin.key,{...admin.record,revoked:true});
	await expect(second.moderate(admin,'post',id,'hide','Sesja już zamknięta')).rejects.toThrow('administratora');
	console.log(`Integration namespace: ${namespace}`);
},60000);

test.skipIf(!process.env.OPENRAILS_TOKEN)('approval can be optional without changing account status',async()=>{
	const previous=process.env.REQUIRE_APPROVAL;
	try {
		delete process.env.REQUIRE_APPROVAL;
		const store=openStore(`bliza_test_${randomUUID().replaceAll('-','')}`),guest=await store.visitor();
		await expect(store.addPost(guest.token,'blip','','Domyślnie z zatwierdzeniem','Codzienność')).rejects.toThrow('zatwierdzenie');
		process.env.REQUIRE_APPROVAL='false';
		const id=await store.addPost(guest.token,'blip','','Zatwierdzenie dobrowolne','Codzienność');
		await store.reply(guest.token,id,'Odpowiedzi też są dostępne.');
		expect((await store.authenticated(guest.token)).approved).toBe(false);
		expect((await store.feed(guest.user.id)).posts[0].replies).toHaveLength(1);
		process.env.REQUIRE_APPROVAL='true';
		await expect(store.reply(guest.token,id,'Znowu wymagamy zatwierdzenia.')).rejects.toThrow('zatwierdzenie');
	} finally {process.env.REQUIRE_APPROVAL=previous;}
},60000);

test('ticket parser rejects malformed and cross-portal credentials',()=>{
	const user={id:randomUUID(),name:'sąsiad'},ticket=formatTicket(user,'bliza_check','a'.repeat(64));
	expect(parseTicket(ticket,'bliza_check')).toEqual({id:user.id,secret:'a'.repeat(64)});expect(parseTicket(ticket.replaceAll('\n','\r\n'),'bliza_check')).not.toBeNull();
	expect(parseTicket(ticket.replace('sąsiad','someone_else'),'bliza_check')).not.toBeNull();
	for(const invalid of [null,'<script>alert(1)</script>',ticket+ticket,ticket.replace('a'.repeat(64),'not-a-key'),'x'.repeat(MAX_TICKET_SIZE+1)])expect(parseTicket(invalid,'bliza_check')).toBeNull();
	expect(parseTicket(ticket,'another_portal')).toBeNull();
});

test('raster decoding strips metadata and rejects SVG, spoofed MIME and oversized uploads',async()=>{
	expect(IMAGE_NAME.test(`${randomUUID()}.webp`)).toBe(true);
	expect(IMAGE_NAME.test(`${'a'.repeat(64)}.jpg`)).toBe(false);
	expect(await uploadImage(null)).toBeNull();expect(await uploadImage(new File([],'empty.jpg'))).toBeNull();
	await expect(uploadImage(new File(['<svg onload="alert(1)"/>'],'bad.svg',{type:'image/svg+xml'}))).rejects.toThrow('formacie');
	await expect(uploadImage(new File([new Uint8Array([255,216,255])],'fake.png',{type:'image/png'}))).rejects.toThrow('nie pasuje');
	await expect(uploadImage(new File([new Uint8Array([255,216,255])],'broken.jpg',{type:'image/jpeg'}))).rejects.toThrow('odczytać');
	await expect(uploadImage(new File([new Uint8Array(MAX_IMAGE_SIZE+1)],'huge.jpg',{type:'image/jpeg'}))).rejects.toThrow('5 MB');
	const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#e16f29'}}).withMetadata({exif:{IFD0:{Artist:'private-location'}}}).jpeg().toBuffer();
	const prepared=await uploadImage(new File([bytes],'private.jpg',{type:'image/jpeg'}));
	const meta=await sharp(Buffer.from(prepared.data,'base64')).metadata();expect(meta.format).toBe('webp');expect(meta.exif).toBeUndefined();expect(meta.width).toBe(2);
});

test('URL images pin public DNS, validate redirects and cap streamed bytes',async()=>{
	for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.2','100.100.100.200','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2002:7f00:1::','2001:db8::1'])expect(isPublicImageAddress(address)).toBe(false);
	for(const address of ['8.8.8.8','2606:4700:4700::1111'])expect(isPublicImageAddress(address)).toBe(true);
	for(const source of ['file:///etc/passwd','http://example.com/a.png','https://user:password@example.com/a.png','https://example.com:8787/a.png'])await expect(downloadImage(source)).rejects.toThrow('HTTPS');
	const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#dc712a'}}).png().toBuffer();
	const lookup=spyOn(dns,'lookup').mockImplementation(async(host)=>[{address:host==='private.test'?'127.0.0.1':'8.8.8.8',family:4}]);
	let replies=[],connections=[];
	const transport=spyOn(https,'request').mockImplementation((url,options,respond)=>{
		const request=new EventEmitter();
		request.destroy=()=>request;
		request.end=()=>queueMicrotask(()=>options.lookup(url.hostname,{},(err,address,family)=>{
			if(err){request.emit('error',err);return;}
			connections.push({address,family,headers:options.headers,agent:options.agent});
			const reply=replies.shift(),response=new PassThrough();response.statusCode=reply.status||200;response.headers=reply.headers||{'content-type':'image/png'};
			respond(response);if(!response.destroyed)response.end(reply.body||bytes);
		}));return request;
	});
	try {
		replies=[{status:302,headers:{location:'https://public.test/final.png'}},{}];
		const file=await downloadImage('https://public.test/start.png');expect((await uploadImage(file)).data).toBeTruthy();
		expect(connections.map((entry)=>entry.address)).toEqual(['8.8.8.8','8.8.8.8']);expect(connections[0].agent).toBe(false);expect(connections[0].headers.Authorization).toBeUndefined();
		connections=[];replies=[{status:302,headers:{location:'https://private.test/secret'}}];
		await expect(downloadImage('https://public.test/redirect.png')).rejects.toThrow('publicznego');expect(connections).toHaveLength(1);
		replies=[{body:Buffer.alloc(MAX_IMAGE_SIZE+1)}];await expect(downloadImage('https://public.test/large.png')).rejects.toThrow('5 MB');
		replies=[{status:302,headers:{location:'/loop'}},{status:302,headers:{location:'/loop'}},{status:302,headers:{location:'/loop'}},{status:302,headers:{location:'/loop'}}];await expect(downloadImage('https://public.test/loop')).rejects.toThrow('przekierowań');
	}finally{transport.mockRestore();lookup.mockRestore();}
});
