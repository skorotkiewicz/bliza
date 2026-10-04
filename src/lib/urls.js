export function postPath(post) {
	const slug = (post.kind === 'question' ? post.title : post.body)
		.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replaceAll('ł', 'l')
		.replace(/[^a-z0-9]+/g, '-').slice(0, 90).replace(/^-+|-+$/g, '');
	const section = post.kind === 'question' ? 'pytanie' : 'wpis';
	return `/${section}/${encodeURIComponent(post.id)}/${slug || section}`;
}

export const profilePath = (person) => `/ludzie/${encodeURIComponent(person.name)}`;

export function feedPath(filters = {}, page = 1, profile = null) {
	const params = new URLSearchParams(filters);
	params.delete('page');
	params.delete('post');
	if (profile) params.delete('user');
	const prefix = profile ? profilePath(profile) : '';
	const path = page > 1 ? `${prefix}/strona/${page}` : prefix || '/';
	return `${path}${params.size ? `?${params}` : ''}`;
}
