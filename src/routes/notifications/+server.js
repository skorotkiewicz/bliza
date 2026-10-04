import { json } from '@sveltejs/kit';
import { store, Problem } from '#lib/server/db.js';

export async function GET({ cookies }) {
	try {
		return json(await store.notifications(cookies.get('bliza_session')), { headers: { 'Cache-Control': 'private, no-store' } });
	} catch (error) {
		return json({ error: error instanceof Problem ? error.message : 'Nie możemy odświeżyć powiadomień.' }, {
			status: error instanceof Problem ? error.status : 503,
			headers: { 'Cache-Control': 'private, no-store' }
		});
	}
}
