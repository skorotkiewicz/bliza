<script>
	let { name, size = 18, stroke = 1.7 } = $props();
	const paths = {
		home: 'm3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9',
		chat: 'M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 0 1-1-5 8 8 0 0 1 9-8 8 8 0 0 1 9 8ZM8 10h8M8 14h5',
		question:
			'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M21 11a9 9 0 0 1-9 9H6l-4 2 2-6a9 9 0 1 1 17-5Z',
		flame:
			'M12 3c1 5 5 5 6 9a7 7 0 0 1-13 5C2 11 7 8 8 5c0 4 2 5 3 5 1-2 2-4 1-7ZM10 15c-3 4 0 6 2 6 3 0 4-3 1-6 0 2-2 2-3 0Z',
		users:
			'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-4',
		bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
		star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
		heart:
			'M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
		coffee:
			'M4 8h13v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8ZM17 9h2a3 3 0 0 1 0 6h-2M7 2v3M11 2v3M15 2v3',
		book: 'M12 5v16M12 5C8 2 4 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-2-10 1Z',
		monitor: 'M3 3h18v14H3V3ZM8 21h8M12 17v4',
		music:
			'M9 18V5l12-2v13M9 5v5l12-2M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
		film: 'M3 3h18v18H3V3ZM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4',
		compass: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM16 8l-3 5-5 3 3-5 5-3Z',
		grid: 'M3 3h7v7H3V3ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7ZM14 14h7v7h-7v-7Z',
		search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6',
		arrow: 'M4 12h16m-6-6 6 6-6 6',
		chevron: 'm9 5 7 7-7 7',
		down: 'm6 9 6 6 6-6',
		bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
		edit: 'm16 3 5 5-13 13H3v-5L16 3ZM13 6l5 5',
		plus: 'M12 5v14M5 12h14',
		check: 'm5 12 4 4L19 6',
		close: 'm6 6 12 12M6 18 18 6',
		hash: 'M10 3 8 21M17 3l-2 18M4 8h17M3 16h17',
		globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
		smile: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM8 9h.01M16 9h.01M8 14c2 4 6 4 8 0',
		rss: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 19h.01',
		leaf: 'M20 3c1 10-1 18-9 18-6 0-8-5-6-9C8 7 15 8 20 3ZM5 21l10-10',
		send: 'm22 2-7 20-4-9-9-4L22 2ZM22 2 11 13'
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"><path d={paths[name] || paths.chat} /></svg
>
