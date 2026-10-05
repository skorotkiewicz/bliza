<script>
	import { tick, untrack } from 'svelte';
	import Icon from '#lib/Icon.svelte';
	import Avatar from '#lib/Avatar.svelte';
	import { profilePath } from '#lib/urls.js';

	let { open, user, approvalRequired, onclose, onreport } = $props();
	let items = $state([]), draft = $state(''), sending = $state(false), error = $state('');
	let connection = $state('connecting'), canWrite = $state(false), log = $state(null);
	let stream, nonce, previousBody = '', identity, forceScroll = false;
	const time = (value) => new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

	function connect() {
		stream?.close(); connection = 'connecting'; error = '';
		const account = user.id, source = new EventSource('/shoutbox'); stream = source;
		source.onmessage = async (event) => {
			if (stream !== source || user.id !== account) return;
			const next = JSON.parse(event.data);
			if (next.userId !== account) return;
			const follow = forceScroll || !items.length || (log && log.scrollHeight - log.scrollTop - log.clientHeight < 48);
			items = next.items; canWrite = next.canWrite; connection = 'live'; forceScroll = false;
			await tick(); if (follow && log) log.scrollTop = log.scrollHeight;
		};
		source.addEventListener('session', (event) => {
			if (stream !== source) return;
			source.close(); items = []; canWrite = false; connection = 'offline'; error = JSON.parse(event.data).error;
		});
		source.addEventListener('unavailable', () => { if (stream === source) connection = 'connecting'; });
		source.onerror = () => {
			if (stream !== source) return;
			connection = source.readyState === EventSource.CLOSED ? 'offline' : 'connecting';
		};
	}
	$effect(() => {
		const account = user.id, visible = open;
		return untrack(() => {
			if (identity !== account) {
				identity = account; draft = ''; items = []; error = ''; previousBody = ''; nonce = crypto.randomUUID(); sending = false;
				canWrite = !approvalRequired || Boolean(user.approved);
			}
			if (!visible) return;
			connect();
			return () => { stream?.close(); stream = null; };
		});
	});
	async function send(event) {
		event.preventDefault(); if (sending || !canWrite || !draft.trim()) return;
		const account = user.id, message = draft.trim();
		if (message !== previousBody) { previousBody = message; nonce = crypto.randomUUID(); }
		const id = nonce;
		sending = true; error = '';
		try {
			const response = await fetch('/shoutbox', { method: 'POST', body: new URLSearchParams({ body: message, id }), signal: AbortSignal.timeout(10000) });
			const result = await response.json();
			if (user.id !== account) return;
			if (!response.ok) { if (response.status === 401 || response.status === 403) canWrite = false; throw new Error(result.error); }
			draft = ''; previousBody = ''; nonce = crypto.randomUUID(); forceScroll = true;
		} catch (failure) {
			if (user.id === account) error = failure.name === 'Error' ? failure.message : 'Nie potwierdziliśmy zapisu. Spróbuj ponownie; wiadomość została w polu.';
		} finally { if (user.id === account) sending = false; }
	}
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && event.target.closest?.('#shoutbox')) onclose(); }} />
<section id="shoutbox" class="shoutbox" hidden={!open} aria-labelledby="shoutbox-title" tabindex="-1">
	<div class="container shoutbox-inner">
		<header class="shoutbox-heading">
			<div><h2 id="shoutbox-title">Shoutbox<span> · rozmowy przy wspólnym stole</span></h2><p role="status">{connection === 'live' ? 'Na żywo. Dobrze, że jesteś.' : connection === 'offline' ? 'Nie możemy połączyć czatu.' : 'Łączymy z rozmową…'}</p></div>
			{#if connection === 'offline'}<button class="shoutbox-reconnect" onclick={connect}>Połącz ponownie</button>{/if}
			<button class="dialog-close" aria-label="Zamknij shoutbox" onclick={onclose}><Icon name="close" size={18} /></button>
		</header>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex (The scrollable chat log must be reachable by keyboard.) -->
		<div class="shoutbox-log" role="log" aria-label="Wiadomości shoutboxa" aria-live="polite" aria-relevant="additions" tabindex="0" bind:this={log}>
			{#each items as item (item.id)}
				<div class="shout-message" id={`shout-${item.id}`}>
					<Avatar name={item.name} size={28} />
					<div class="shout-content"><div class="shout-meta"><a href={profilePath(item)}>{item.name}</a>{#if item.approved}<span class="approved-badge" role="img" aria-label="Konto zatwierdzone przez moderatora"><Icon name="check" size={12} /></span>{/if}<time datetime={new Date(item.created).toISOString()} title={new Date(item.created).toLocaleString('pl-PL')}>{time(item.created)}</time></div><p>{item.body}</p></div>
					<button class="report-button" aria-label={`Zgłoś wiadomość ${item.name}`} onclick={() => onreport('shout', item.id)}><Icon name="flag" size={14} /></button>
				</div>
			{:else}<p class="shoutbox-empty">{connection === 'live' ? 'Jeszcze cisza. Powiedz cześć i zacznij rozmowę. :)' : 'Tu za chwilę pojawią się wiadomości sąsiadów.'}</p>{/each}
		</div>
		{#if error}<p class="shoutbox-error" role="alert">{error}</p>{/if}
		<form class="shoutbox-form" onsubmit={send}>
			<label class="sr-only" for="shoutbox-input">Wiadomość do shoutboxa</label><input id="shoutbox-input" name="body" bind:value={draft} maxlength="500" required autocomplete="off" placeholder="Powiedz cześć. Reszta przyjdzie sama." disabled={sending || !canWrite} />
			<button class="publish-button" type="submit" aria-label="Wyślij wiadomość" disabled={sending || !canWrite || !draft.trim()}><Icon name="send" size={17} /></button>
		</form>
		<div class="shoutbox-help"><span>{!canWrite ? 'Przed pisaniem sprawdź sesję i zatwierdzenie konta w profilu.' : sending ? 'Wysyłamy…' : 'Enter wysyła. Bądźmy dla siebie dobrzy.'}</span><span>{draft.length}/500</span></div>
	</div>
</section>
