export const MAX_TICKET_SIZE = 4096;

export function formatTicket(user, namespace, secret) {
	return `+----------------------------------------+
| bliza.          BILET POWROTNY          |
| Kierunek: Twoj maly kat internetu :)    |
+----------------------------------------+

Nick w dniu wydania: ${user.name}

Na Blizie kliknij "Mam bilet!" i wybierz ten plik.
Bilet dziala wielokrotnie, takze po zmianie nicka.
Nie udostepniaj go: otwiera Twoje konto.
Nowy bilet uniewaznia poprzedni plik, nie otwarte sesje.
Bez biletu i ciasteczka nie odzyskasz konta.

bliza-ticket-v1:${namespace}:${user.id}:${secret}
`;
}

export function parseTicket(text, namespace) {
	if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_TICKET_SIZE) return null;
	const entries = [...text.matchAll(/^bliza-ticket-v1:([a-z][a-z0-9_]{0,50}):([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):([a-f0-9]{64})\r?$/gm)];
	if (entries.length !== 1 || entries[0][1] !== namespace) return null;
	return { id: entries[0][2], secret: entries[0][3] };
}

// ponytail: bounded, process-local recovery throttle; use a shared limiter if the app scales out.
const attempts = new Map();
export function allowRecovery(address, now = Date.now()) {
	let window = attempts.get(address);
	if (!window || now - window.start >= 60000) {
		window = { start: now, count: 0 };
		attempts.delete(address);
		attempts.set(address, window);
		if (attempts.size > 1024) attempts.delete(attempts.keys().next().value);
	}
	return ++window.count <= 20;
}
