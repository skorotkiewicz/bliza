<script>
	import { enhance } from '$app/forms';
	let {data,form}=$props();
	const views={reports:'Zgłoszenia',users:'Konta',posts:'Wpisy',replies:'Odpowiedzi',audit:'Dziennik'};
	const operations={hide:'Ukryj treść',restore:'Przywróć treść',approve:'Zatwierdź konto',reject:'Odrzuć prośbę',unverify:'Cofnij zatwierdzenie',ban:'Zablokuj konto',unban:'Odblokuj konto',logout:'Wyloguj wszystkie urządzenia',resolve:'Zamknij zgłoszenie'};
	const date=(value)=>new Date(value).toLocaleString('pl-PL');
</script>
<svelte:head><title>Moderacja · bliza</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="admin-shell">
	<header class="admin-heading"><div><a href="/">bliza. / pokój moderatora</a><h1>Dbamy o dobry internet.</h1></div>{#if data.loggedIn}<form method="POST" action="?/logout"><button class="ticket-return">Wyloguj administratora</button></form>{/if}</header>
	{#if form?.error}<p class="dialog-error" role="alert">{form.error}</p>{/if}{#if form?.success}<p class="admin-notice" role="status">{form.success}</p>{/if}
	{#if !data.loggedIn}
		<section class="panel admin-login"><h2>Klucz do pokoju moderatora.</h2><p>Dostęp tylko dla administratora. Klucza nie wpisuj w adresie strony.</p><form method="POST" action="?/login"><label for="admin-secret">Klucz administratora</label><input id="admin-secret" name="secret" type="password" required minlength="32" maxlength="256" autocomplete="current-password" /><button class="publish-button">Wejdź do pokoju</button></form></section>
	{:else}
		<nav class="admin-tabs" aria-label="Moderacja">{#each Object.entries(views) as [key,label]}<a class:active={data.view===key} href={`/admin?view=${key}`}>{label}</a>{/each}</nav>
		<p class="field-help">Ręczna weryfikacja potwierdza zgodę moderatora i kontakt z właścicielem, nie prawną tożsamość. Ukrywanie jest odwracalne. Każde działanie wymaga powodu.</p>
		<section class="admin-list" aria-label={views[data.view]}>
			{#each data.rows as row (row.id)}
				<article class="panel admin-row" data-id={row.id}><div class="admin-row-content">
					<h2>{row.title||row.name||views[data.view]}</h2><p class="field-help">{row.id}{#if row.created} · {date(row.created)}{/if}</p>
					{#if row.body}<p>{row.body}</p>{/if}{#if row.reason}<p><strong>Powód:</strong> {row.reason}</p>{/if}
					{#if data.view==='users'}<p>{row.approved?'Zatwierdzone':'Niezatwierdzone'} · {row.banned?'Zablokowane':'Aktywne'}</p>{#if row.request}<p>{row.request.note}</p><p>Kod właściciela: <code>{row.request.code}</code></p>{/if}{/if}
					{#if row.image}<a href={row.image.startsWith('/media/')?`/admin${row.image}`:row.image} target="_blank" rel="noreferrer">Podgląd zdjęcia</a>{/if}
					{#if data.view==='reports'}<p>{row.resolved?'Zamknięte':'Otwarte'}</p><a href={`/admin?view=${row.kind==='post'?'posts':'replies'}&target=${encodeURIComponent(row.target)}`}>Przejdź do zgłoszonej treści</a>{/if}
					{#if data.view==='posts'||data.view==='replies'}<p>{row.hidden?'Ukryte przez moderatora':'Widoczne'}</p>{/if}
					{#if data.view==='audit'}<p>{operations[row.action]||row.action} · {row.kind} / {row.target}</p>{/if}
				</div>
				{#if data.view!=='audit'}<form method="POST" action={`?/moderate&view=${data.view}&page=${data.page}${data.target?`&target=${encodeURIComponent(data.target)}`:''}`} class="admin-action" use:enhance={()=>({update})=>update({navigate:false})}>
					<input type="hidden" name="kind" value={data.view==='users'?'user':data.view==='posts'?'post':data.view==='replies'?'reply':'report'} /><input type="hidden" name="id" value={row.id} />
					<label>Działanie<select name="operation">{#each (data.view==='users'?['approve','reject','unverify','ban','unban','logout']:data.view==='reports'?['resolve']:['hide','restore']) as action}<option value={action}>{operations[action]}</option>{/each}</select></label>
					<label>Powód działania<input name="reason" required minlength="5" maxlength="500" placeholder="Co sprawdzono lub dlaczego interweniujesz?" /></label>
					{#if data.view==='users'}<label>Kod właściciela<input name="code" maxlength="8" placeholder="Potrzebny przy zatwierdzaniu" /></label><label class="admin-confirm"><input type="checkbox" name="confirmed" value="yes" />Potwierdzam ręczny kontakt z właścicielem i zgodność kodu.</label>{/if}
					<button class="publish-button">Zapisz działanie</button>
				</form>{/if}
				</article>
			{:else}<p class="admin-empty">Tu jest spokojnie. Nie ma rekordów na tej stronie.</p>{/each}
		</section>
		<nav class="pagination" aria-label="Strony moderacji">{#if data.page>1}<a href={`/admin?view=${data.view}&page=${data.page-1}`}>Poprzednia</a>{/if}<span>Strona {data.page}</span>{#if data.rows.length===100}<a href={`/admin?view=${data.view}&page=${data.page+1}`}>Następna</a>{/if}</nav>
		<details class="admin-maintenance panel"><summary>Porządki w zapleczu plików</summary><p>Usuwa wyłącznie niepowiązane, wygenerowane przez serwer pliki tymczasowe i stare wersje blobów w projekcie OpenRails. Powiązane zdjęcia i wpisy zostają. To działanie jest nieodwracalne.</p><form method="POST" action="?/cleanup"><label class="admin-confirm"><input name="confirmed" value="yes" type="checkbox" required />Potwierdzam usunięcie niepowiązanych plików zaplecza.</label><button class="ticket-return">Usuń niepowiązane pliki</button></form></details>
	{/if}
</main>
