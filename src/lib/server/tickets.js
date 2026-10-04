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
Nowy bilet uniewaznia poprzedni plik i wylogowuje inne urzadzenia.
Bez biletu i ciasteczka nie odzyskasz konta.

bliza-ticket-v1:${namespace}:${user.id}:${secret}
`;
}

export function parseTicket(text, namespace) {
	if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_TICKET_SIZE) return null;
	const entries = [
		...text.matchAll(
			/^bliza-ticket-v1:([a-z][a-z0-9_]{0,50}):([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):([a-f0-9]{64})\r?$/gm
		)
	];
	if (entries.length !== 1 || entries[0][1] !== namespace) return null;
	return { id: entries[0][2], secret: entries[0][3] };
}

