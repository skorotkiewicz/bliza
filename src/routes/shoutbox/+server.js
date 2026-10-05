import { json } from '@sveltejs/kit';
import { store, Problem } from '#lib/server/db.js';

export const config = { maxDuration: 30 };
const headers = { 'Cache-Control': 'private, no-store, no-transform' };
const failure = (error) => json({ error: error instanceof Problem ? error.message : 'Shoutbox jest chwilowo niedostępny.' }, { status: error instanceof Problem ? error.status : 503, headers });

export async function GET({ cookies }) {
	const token = cookies.get('bliza_session');
	let initial;
	try { initial = await store.shoutbox(token); }
	catch (error) { return failure(error); }
	const encoder = new TextEncoder();
	let stopped = false, timer, deadline;
	const body = new ReadableStream({
		start(controller) {
			let previous = '';
			const close = () => {
				if (stopped) return;
				stopped = true; clearTimeout(timer); clearTimeout(deadline); controller.close();
			};
			const send = (snapshot) => {
				const next = JSON.stringify(snapshot);
				controller.enqueue(encoder.encode(next === previous ? ': alive\n\n' : `data: ${next}\n\n`));
				previous = next;
			};
			controller.enqueue(encoder.encode('retry: 1000\n\n')); send(initial);
			// ponytail: one storage poll/second per open viewer; upgrade to backend pub/sub when concurrency warrants it.
			const poll = async () => {
				try {
					const snapshot = await store.shoutbox(token);
					if (stopped) return;
					send(snapshot);
				} catch (error) {
					if (stopped) return;
					const session = error instanceof Problem && error.status === 401;
					controller.enqueue(encoder.encode(`event: ${session ? 'session' : 'unavailable'}\ndata: ${JSON.stringify({ error: session ? error.message : 'Połączenie przerwane. Łączymy ponownie…' })}\n\n`));
					close(); return;
				}
				timer = setTimeout(poll, 1000);
			};
			timer = setTimeout(poll, 1000);
			deadline = setTimeout(close, 20000);
		},
		cancel() { stopped = true; clearTimeout(timer); clearTimeout(deadline); }
	});
	return new Response(body, { headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' } });
}

export async function POST(event) {
	try {
		if (event.request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw new Problem(415, 'Nieprawidłowy formularz wiadomości.');
		const chunks = []; let size = 0;
		for await (const chunk of event.request.body || []) {
			size += chunk.byteLength;
			if (size > 8192) throw new Problem(413, 'Formularz wiadomości jest za duży.');
			chunks.push(chunk);
		}
		const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
		const id = await store.sendShout(event.cookies.get('bliza_session'), form.get('body'), form.get('id'));
		return json({ id }, { headers });
	} catch (error) { return failure(error); }
}
