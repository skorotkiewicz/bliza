import { test, expect, spyOn } from 'bun:test';
import { db } from 'openrails';
import { randomUUID, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { openStore, digest, mentionNames } from './db.js';
import { uploadImage, MAX_IMAGE_SIZE, IMAGE_NAME, downloadImage, isPublicImageAddress } from './images.js';
import { formatTicket, parseTicket, MAX_TICKET_SIZE } from './tickets.js';
import { postPath, profilePath, feedPath } from '../urls.js';

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
	expect(saved.replies[0].body).toContain('ponownym');expect(saved.replies[0].approved).toBe(1);expect(saved.replies[0].created).toBeGreaterThan(0);
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

test('readable post and profile URLs keep identity and pagination filters',()=>{
	expect(postPath({id:'1',kind:'question',title:'Zażółć gęślą jaźń?'})).toBe('/pytanie/1/zazolc-gesla-jazn');
	expect(postPath({id:'2',kind:'blip',body:'☕ #DzieńDobry!'})).toBe('/wpis/2/dziendobry');
	expect(postPath({id:'3',kind:'blip',body:'🌲'})).toBe('/wpis/3/wpis');
	const profile={id:'author-id',name:'sąsiad'};
	expect(profilePath(profile)).toBe('/ludzie/s%C4%85siad');
	expect(feedPath({type:'question',page:'7'},2)).toBe('/strona/2?type=question');
	expect(feedPath({user:profile.id,tag:'kot',page:'7'},2,profile)).toBe('/ludzie/s%C4%85siad/strona/2?tag=kot');
	expect(feedPath({user:profile.id},1,profile)).toBe(profilePath(profile));
	expect(feedPath({},1)).toBe('/');
});


test('mentions recognise current nickname characters without matching email addresses', () => {
	expect(mentionNames('@koza hej, @łąka.jpg i (@koza) @koza. email@koza.pl')).toEqual(['koza','łąka.jpg','koza.']);
	expect(mentionNames('@' + 'x'.repeat(25) + ' @ab @@koza')).toEqual([]);
});

test.skipIf(!process.env.OPENRAILS_TOKEN)('mention notifications are atomic, private and moderation-aware', async () => {
	const previous = process.env.REQUIRE_APPROVAL; process.env.REQUIRE_APPROVAL = 'false';
	try {
		const store = openStore(`bliza_mentions_${randomUUID().replaceAll('-','')}`);
		const author = await store.visitor(), recipient = await store.visitor(), outsider = await store.visitor();
		await store.rename(author.token,'autor'); await store.rename(recipient.token,'koza'); await store.rename(outsider.token,'łąka.jpg');
		const id = randomUUID();
		const publish = () => store.addPost(author.token,'question','@koza Gdzie pogadamy?','@koza. @autor email@koza.pl @nieistniejący','Codzienność',null,Date.now(),id);
		await Promise.all([publish(), publish()]);
		const initial = await store.notifications(recipient.token);
		expect(initial.unread).toBe(1); expect(initial.items).toHaveLength(1);
		expect((await store.notifications(author.token)).items).toHaveLength(0);
		expect((await store.notifications(outsider.token)).items).toHaveLength(0);
		await expect(store.openNotification(outsider.token,initial.items[0].id)).rejects.toThrow('Nie znaleziono');
		await expect(store.notifications('not-a-session')).rejects.toThrow('Sesja');
		const reply = await store.reply(outsider.token,id,'@koza hej, jak się masz?');
		const notices = await store.notifications(recipient.token), answer = notices.items.find((item) => item.reply);
		expect(notices.unread).toBe(2); expect(answer.name).toBe('łąka.jpg'); expect(answer.href).toEndWith(`#answer-${reply}`);
		expect(await store.openNotification(recipient.token,answer.id)).toBe(answer.href);
		expect((await store.notifications(recipient.token)).unread).toBe(1);
		await store.collections.moderation.put(`reply/${reply}`,{kind:'reply',target:reply,hidden:true});
		expect((await store.notifications(recipient.token)).items).toHaveLength(1);
		await expect(store.openNotification(recipient.token,answer.id)).rejects.toThrow('nie jest już dostępna');
		await store.collections.moderation.put(`reply/${reply}`,{kind:'reply',target:reply,hidden:false});
		await store.collections.moderation.put(`post/${id}`,{kind:'post',target:id,hidden:true});
		expect((await store.notifications(recipient.token)).items).toHaveLength(0);
		await store.collections.moderation.put(`post/${id}`,{kind:'post',target:id,hidden:false});
		const policy = await store.collections.accounts.get(outsider.user.id);
		await store.collections.accounts.put(outsider.user.id,{...policy,banned:true});
		expect((await store.notifications(recipient.token)).items).toHaveLength(1);
		const before = (await store.feed(author.user.id)).total;
		await expect(store.addPost(author.token,'question','Za dużo wzmianek',Array.from({length:21},(_,i)=>`@osoba_${i}`).join(' '),'Codzienność')).rejects.toThrow('20 nicków');
		expect((await store.feed(author.user.id)).total).toBe(before);
		await store.rename(author.token,'koza.');
		await store.reply(recipient.token,id,'@koza. To dokładny nick, nie końcowa kropka.');
		expect((await store.notifications(author.token)).unread).toBe(1);
		const deepReply=await store.reply(author.token,id,'@koza Wzmianka w długiej rozmowie.');
		await db.transaction({puts:Array.from({length:101},(_,index)=>store.put('replies',randomUUID(),{post_id:id,user_id:author.user.id,body:'Odpowiedź w dużym wątku.',created:Date.now()-(index+1)*1000}))});
		expect((await store.feed(recipient.user.id,new URLSearchParams({post:id}))).posts[0].replies).toHaveLength(100);
		const deepThread=(await store.feed(recipient.user.id,new URLSearchParams({post:id,answer:deepReply}))).posts[0];
		expect(deepThread.replies.some((reply)=>reply.id===deepReply)).toBe(true);
		const recipientPolicy = await store.collections.accounts.get(recipient.user.id);
		await store.collections.accounts.put(recipient.user.id,{...recipientPolicy,banned:true});
		const notificationCount = await store.collections.notifications.query().count();
		await store.reply(author.token,id,'@koza Ta wzmianka nie powiadomi zablokowanego konta.');
		expect(await store.collections.notifications.query().count()).toBe(notificationCount);
		await expect(store.notifications(recipient.token)).rejects.toThrow('Sesja');
	} finally { if(previous === undefined) delete process.env.REQUIRE_APPROVAL; else process.env.REQUIRE_APPROVAL = previous; }
});


test.skipIf(!process.env.OPENRAILS_TOKEN)('20-message RAM chat validates, deduplicates, throttles and respects moderation and sessions', async () => {
	const previous=process.env.REQUIRE_APPROVAL;process.env.REQUIRE_APPROVAL='true';
	try {
		const namespace=`bliza_chat_${randomUUID().replaceAll('-','')}`,first=openStore(namespace),second=openStore(namespace);
		const sender=await first.visitor(),reader=await second.visitor();
		expect((await first.shoutbox(reader.token)).canWrite).toBe(false);
		await expect(first.sendShout(sender.token,'Bez zatwierdzenia',randomUUID())).rejects.toThrow('zatwierdzenie');
		for(const body of ['', '   ', 'x'.repeat(501), null])expect(()=>first.sendShout(sender.token,body,randomUUID())).toThrow('500');
		expect(()=>first.sendShout(sender.token,'Cześć','../chat')).toThrow('identyfikator');
		const admin={key:digest(randomBytes(32)),record:{id:randomUUID(),expires:Date.now()+3600000,revoked:false}};
		await first.collections.admin_sessions.put(admin.key,admin.record);await first.verification(sender.token,'Chcę rozmawiać z sąsiadami.');
		await second.moderate(admin,'user',sender.user.id,'approve','Potwierdzony kontakt z właścicielem',(await first.authenticated(sender.token)).verification.code);
		const id=randomUUID();await Promise.all([first.sendShout(sender.token,' Cześć! ',id),second.sendShout(sender.token,'Cześć!',id)]);
		const chat=await second.shoutbox(reader.token);expect(chat.items).toHaveLength(1);expect(chat.items[0].body).toBe('Cześć!');expect(chat.items[0].approved).toBe(1);
		await expect(second.sendShout(sender.token,'Inna wiadomość',id)).rejects.toThrow('zajęty');
		await first.report(reader.token,'shout',id,'Proszę sprawdzić tę wiadomość.');expect((await second.adminData('reports')).rows[0].kind).toBe('shout');
		await second.moderate(admin,'shout',id,'hide','Sprawdzamy ukrywanie wiadomości.');expect((await first.shoutbox(reader.token)).items).toHaveLength(0);
		expect((await first.adminData('shouts',1,id)).rows[0].hidden).toBe(true);
		await expect(first.report(reader.token,'shout',id,'Już ukryta treść')).rejects.toThrow('Nie znaleziono');
		await first.moderate(admin,'shout',id,'restore','Przywracamy wiadomość.');expect((await second.shoutbox(reader.token)).items).toHaveLength(1);
		await first.moderate(admin,'user',sender.user.id,'ban','Zablokowane konto w czacie.');expect((await second.shoutbox(reader.token)).items).toHaveLength(0);
		await expect(first.shoutbox(sender.token)).rejects.toThrow('Sesja');await expect(first.sendShout(sender.token,'Nie wolno',randomUUID())).rejects.toThrow('Sesja');
		process.env.REQUIRE_APPROVAL='false';expect((await second.shoutbox(reader.token)).canWrite).toBe(true);
		for(let i=0;i<20;i++)await (i%2?first:second).sendShout(reader.token,`Wiadomość ${i}`,randomUUID());
		await expect(first.sendShout(reader.token,'Limit',randomUUID())).rejects.toThrow('Za dużo');expect((await second.shoutbox(reader.token)).items).toHaveLength(20);
		expect((await first.collections.accounts.get(reader.user.id)).approved).toBe(false);
		const neighbour=await second.visitor();
		for(let i=0;i<3;i++)await first.sendShout(neighbour.token,`Nowa wiadomość ${i}`,randomUUID());
		const recent=(await second.shoutbox(reader.token)).items;expect(recent).toHaveLength(20);expect(recent[0].body).toBe('Wiadomość 3');expect(recent.at(-1).body).toBe('Nowa wiadomość 2');
		expect(await db.collection(`${namespace}_shouts`).query().count()).toBe(0);
		expect((await second.adminData('shouts',1,id)).rows).toHaveLength(0);
		await expect(first.moderate(admin,'shout',id,'hide','Wiadomość już wypadła z bufora.')).rejects.toThrow('zniknęła');
		const restarted=Bun.spawn([process.execPath,'--no-env-file','--eval',"const {openStore}=await import('./src/lib/server/db.js');const chat=await openStore(process.env.CHAT_TEST_NAMESPACE).shoutbox(process.env.CHAT_TEST_SESSION);if(chat.items.length)throw new Error('A new process must start with an empty room');"],{env:{...process.env,CHAT_TEST_NAMESPACE:namespace,CHAT_TEST_SESSION:reader.token},stdout:'ignore',stderr:'pipe'});
		expect(await restarted.exited).toBe(0);
		const remote=await second.recoverTicket(await first.issueTicket(reader.token));await first.revokeOthers(reader.token);
		await expect(second.shoutbox(remote.token)).rejects.toThrow('Sesja');await expect(first.shoutbox('bad')).rejects.toThrow('Sesja');
	} finally { if(previous===undefined)delete process.env.REQUIRE_APPROVAL;else process.env.REQUIRE_APPROVAL=previous; }
});
