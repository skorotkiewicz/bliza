<script>
	let { name = '', size = 40 } = $props();
	const backgrounds = ['#d5e7df', '#eedfca', '#c7dfe5', '#e5e8d6', '#f1e8c9', '#e1ddd2'];
	const hair = ['#424936', '#986947', '#333d3c', '#674735', '#b95020', '#73864c'];
	const skin = ['#edbd8e', '#e8b883', '#d8a171', '#c58b60', '#b47b55', '#f1d6b4'];
	const shirts = ['#447b6e', '#2d5454', '#597d81', '#b95020', '#986947', '#73864c'];
	const hairstyles = [
		['........', '..1111..', '.122221.'],
		['..1111..', '.111111.', '.122221.'],
		['...111..', '..11111.', '.112221.'],
		['..111...', '.11111..', '.122211.'],
		['........', '...11...', '.122221.']
	];
	let selected = $derived.by(() => {
		let seed = 2166136261;
		for (const character of name.normalize('NFC')) {
			seed = Math.imul(seed ^ character.codePointAt(0), 16777619) >>> 0;
		}
		return [
			backgrounds[seed % backgrounds.length],
			[
				...hairstyles[(seed >>> 12) % hairstyles.length],
				seed & (1 << 17) ? '.136631.' : '.132231.',
				'..2222..',
				seed & (1 << 18) ? '..1441..' : ['..2442..', '..2422..', '..2222..'][(seed >>> 19) % 3],
				seed & (1 << 21) ? '.556655.' : '.555555.',
				seed & (1 << 22) ? '55566555' : '55555555'
			],
			[
				hair[(seed >>> 3) % hair.length], skin[(seed >>> 6) % skin.length],
				'#293b35', '#986947', shirts[(seed >>> 9) % shirts.length], '#f8f7f3'
			]
		];
	});
</script>

<svg
	class="avatar"
	width={size}
	height={size}
	viewBox="0 0 8 8"
	shape-rendering="crispEdges"
	aria-hidden="true"
	style:background={selected[0]}
>
	{#each selected[1] as row, y}
		{#each [...row] as pixel, x}
			{#if pixel !== '.'}<rect
					{x}
					{y}
					width="1"
					height="1"
					fill={selected[2][Number(pixel) - 1]}
				/>{/if}
		{/each}
	{/each}
</svg>

<style>
	.avatar {
		flex-shrink: 0;
		border-radius: 4px;
	}
</style>
