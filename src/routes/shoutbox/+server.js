import { json } from '@sveltejs/kit';
import { store, Problem } from '#lib/server/db.js';

export const config = { maxDuration: 30 };
const headers = { 'Cache-Control': 'private, no-store, no-transform' };
const failure = (error) => json({ error: error instanceof Problem ? error.message : 'Shoutbox jest chwilowo niedostępny.' }, { status: error instanceof Problem ? error.status : 503, headers });

export async function GET({ cookies, request }) {
	const token = cookies.get('bliza_session');
	let stopped = false, pending = false, busy = false, timer, deadline;
	let refresh = () => { pending = true; };
	// Subscribe before the initial read so mutations during connection setup are not lost.
	const unsubscribe = store.subscribeShouts(() => { void refresh(); });
	const cleanup = () => {
		if (stopped) return;
		stopped = true; clearInterval(timer); clearTimeout(deadline); unsubscribe();
		request?.signal.removeEventListener('abort', abort);
	};
	let close = cleanup;
	const abort = () => close();
	request?.signal.addEventListener('abort', abort, { once: true });
	if (request?.signal.aborted) abort();
	let initial;
	try { initial = await store.shoutbox(token); }
	catch (error) { cleanup(); return failure(error); }
	if (stopped) return new Response(null, { status: 499, headers });
	const encoder = new TextEncoder();
	const body = new ReadableStream({
		start(controller) {
			let previous = '';
			close = () => { if (!stopped) { cleanup(); controller.close(); } };
			const send = (snapshot) => {
				const next = JSON.stringify(snapshot);
				controller.enqueue(encoder.encode(next === previous ? ': alive\n\n' : `data: ${next}\n\n`));
				previous = next;
			};
			refresh = async () => {
				pending = true;
				if (stopped || busy || controller.desiredSize <= 0) return;
				busy = true;
				try {
					do {
						pending = false;
						const snapshot = await store.shoutbox(token);
						if (stopped) return;
						// Coalesce bursts and skip snapshots superseded by a mutation during the read.
						if (!pending) send(snapshot);
					} while (pending && controller.desiredSize > 0);
				} catch (error) {
					if (stopped) return;
					const session = error instanceof Problem && error.status === 401;
					controller.enqueue(encoder.encode(`event: ${session ? 'session' : 'unavailable'}\ndata: ${JSON.stringify({ error: session ? error.message : 'Połączenie przerwane. Łączymy ponownie…' })}\n\n`));
					close();
				} finally { busy = false; }
			};
			controller.enqueue(encoder.encode('retry: 1000\n\n'));
			if (pending) void refresh(); else send(initial);
			// // ponytail: cross-process account changes are checked every 10s; shared events if instant remote revocation is needed.
			// timer = setInterval(refresh, 10000);
			// deadline = setTimeout(close, 20000);
			// -----------------------------------------
			// ponytail: remote account changes wait for an event/reconnect; shared events if instant remote revocation is needed.
			// timer = setInterval(() => {
			// 	if (!stopped && !busy && controller.desiredSize > 0) controller.enqueue(encoder.encode(': alive\n\n'));
			// }, 10000);
			// deadline = setTimeout(close, 20000);
		},
		pull() { if (pending) return refresh(); },
		cancel() { cleanup(); }
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
