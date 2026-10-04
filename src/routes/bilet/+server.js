import { error, isHttpError } from '@sveltejs/kit';
import { store } from '#lib/server/db.js';

export async function POST({ request, cookies, url }) {
	if (request.headers.get('origin') !== url.origin) error(403, 'Bilet odbierzesz tylko na Blizie.');
	if (Number(request.headers.get('content-length')) > 1024)
		error(413, 'Ten formularz jest za duży.');
	let form;
	try {
		form = await request.formData();
	} catch {
		error(400, 'Niepoprawny formularz biletu.');
	}
	try {
		const user = await store.authenticated(cookies.get('bliza_session'));
		if (!user) error(401, 'Otwórz Blizę ponownie, zanim odbierzesz bilet.');
		const ticket = await store.issueTicket(user, form.get('replace') === 'yes');
		if (!ticket) error(409, 'Masz już bilet. Potwierdź unieważnienie poprzedniego pliku.');
		return new Response(ticket, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Content-Disposition': 'attachment; filename="bilet-powrotny.txt"',
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff',
				'Referrer-Policy': 'no-referrer'
			}
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		error(503, 'Nie udało się wydać biletu. Spróbuj ponownie.');
	}
}
