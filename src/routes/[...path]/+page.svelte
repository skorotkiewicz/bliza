<script>
	import Portal from '../+page.svelte';
	let { data, form } = $props();
</script>

<Portal {data} {form} />
