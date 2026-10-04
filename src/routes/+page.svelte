<script>
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import Icon from '#lib/Icon.svelte';
	import Avatar from '#lib/Avatar.svelte';

	let { data, form } = $props();
	const initial = () => form?.values;
	let kind = $state(initial()?.kind || 'question');
	let draft = $state((initial()?.kind === 'blip' ? initial()?.body : initial()?.title) || '');
	let description = $state(initial()?.kind === 'question' ? initial().body : '');
	let showDescription = $state(initial()?.kind === 'question' && !!initial()?.body);
	let category = $state(initial()?.category || 'Codzienność');
	let pending = $state(false);
	let dismissed = $state(false);
	let profileDialog;
	let aboutDialog;
	let ticketDialog;
	let ticketFileName = $state('');
	let ticketError = $state('');
	let ticketMessage = $state('');
	let replaceTicket = $state(false);

	function openTicket() {
		replaceTicket = false;
		profileDialog?.close();
		dismissed = true;
		ticketError = '';
		ticketMessage = '';
		ticketDialog.showModal();
	}
	function selectTicket(event) {
		const file = event.currentTarget.files?.[0];
		ticketError = '';
		dismissed = true;
		ticketFileName = file?.name || '';
		if (file && (!file.size || file.size > 4096)) {
			event.currentTarget.value = '';
			ticketFileName = '';
			ticketError = 'Bilet to mały plik TXT, maksymalnie 4 KB.';
		}
	}
	async function downloadTicket(event) {
		event.preventDefault();
		pending = true;
		ticketError = '';
		ticketMessage = '';
		dismissed = true;
		const body = new URLSearchParams(new FormData(event.currentTarget));
		try {
			const response = await fetch('/bilet', { method: 'POST', body, cache: 'no-store' });
			if (!response.ok) throw new Error('Ticket download failed');
			const url = URL.createObjectURL(await response.blob());
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'bilet-powrotny.txt';
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			replaceTicket = false;
			ticketMessage = 'Bilet gotowy. Schowaj plik w bezpiecznym miejscu. Do zobaczenia!';
			await invalidateAll();
		} catch {
			ticketError =
				'Nie udało się pobrać biletu. Sprawdź połączenie i spróbuj ponownie. Jeśli został już wydany, potwierdź zastąpienie starego pliku.';
		} finally {
			pending = false;
		}
	}
	let composeField;
	let imageInput = $state(null);
	let selectedImage = $state(null);
	let imagePreview = $state('');
	let imageError = $state('');

	function clearImage() {
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		imagePreview = '';
		selectedImage = null;
		imageError = '';
		if (imageInput) imageInput.value = '';
	}
	function selectImage(event) {
		const file = event.currentTarget.files?.[0];
		if (!file) {
			clearImage();
			return;
		}
		if (
			file.size > 5 * 1024 * 1024 ||
			!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)
		) {
			clearImage();
			imageError = 'Wybierz JPG, PNG, GIF lub WebP, maksymalnie 5 MB.';
			return;
		}
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		selectedImage = file;
		imageError = '';
		imagePreview = URL.createObjectURL(file);
	}
	onDestroy(() => {
		if (imagePreview) URL.revokeObjectURL(imagePreview);
	});

	let filters = $derived(data.filters);
	let view = $derived(filters.view || 'all');
	let filtered = $derived(filters.q || filters.category || filters.tag || filters.user);
	let feedTitle = $derived(
		filters.q
			? `Wyniki dla „${filters.q}”`
			: filters.category ||
					(filters.tag
						? `#${filters.tag}`
						: filters.user
							? 'Wpisy użytkownika'
							: view === 'saved'
								? 'Twoje zapisane wpisy'
								: view === 'unanswered'
									? 'Pytania bez odpowiedzi'
									: view === 'following'
										? 'W kręgu znajomych'
										: 'Co słychać w społeczności?')
	);

	function link(changes = {}, reset = false) {
		const params = new URLSearchParams(reset ? {} : filters);
		params.delete('page');
		for (const [key, value] of Object.entries(changes))
			value === null || value === '' ? params.delete(key) : params.set(key, value);
		return params.size ? `/?${params}` : '/';
	}

	function ago(time) {
		const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
		if (minutes < 1) return 'przed chwilą';
		if (minutes < 60) return `${minutes} min temu`;
		if (minutes < 1440) return `${Math.floor(minutes / 60)} godz. temu`;
		return new Date(time).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
	}

	function parts(text) {
		return text.split(/(#[\p{L}\p{N}_]+)/gu);
	}
	function startWriting(type = 'question') {
		if (kind !== type) {
			draft = '';
			description = '';
			clearImage();
		}
		kind = type;
		document.getElementById('composer')?.scrollIntoView({
			behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
			block: 'center'
		});
		composeField?.focus({ preventScroll: true });
	}

	function submit({ formElement }) {
		pending = true;
		dismissed = false;
		return async ({ result, update }) => {
			try {
				await update({ navigate: false });
				if (result.type === 'success' && formElement.getAttribute('name') === 'publish') {
					draft = '';
					description = '';
					showDescription = false;
					clearImage();
				}
				if (result.type === 'success' && formElement.getAttribute('name') === 'profile')
					profileDialog.close();
				if (result.type === 'success' && formElement.getAttribute('name') === 'recover') {
					ticketDialog.close();
					ticketFileName = '';
					draft = '';
					description = '';
					showDescription = false;
					clearImage();
					await goto('/', { invalidateAll: true });
				}
			} finally {
				pending = false;
			}
		};
	}
</script>

<svelte:head>
	<title>bliza · pytaj, pisz, bądź blisko</title>
	<meta
		name="description"
		content="Dobre pytania i zwykłe rozmowy. Bliza to polska społeczność inspirowana internetem sprzed algorytmów. Zadaj pytanie albo napisz blipa."
	/>
	<meta name="theme-color" content="#f8f7f3" />
</svelte:head>

{#snippet brand(small = false)}
	<span class:small class="brand"
		><span class="brand-mark"><span></span><span></span></span><span
			>bliza<span class="brand-dot">.</span></span
		></span
	>
{/snippet}

{#snippet richText(text)}
	{#each parts(text) as part}
		{#if part.startsWith('#')}<a
				class="inline-tag"
				href={link({ tag: part.slice(1).toLocaleLowerCase('pl') }, true)}>{part}</a
			>{:else}{part}{/if}
	{/each}
{/snippet}

<a href="#feed" class="skip-link">Przejdź do wpisów</a>
<div class="utility-bar">
	<div class="container utility-inner">
		<span><span class="online-dot"></span> Internet jest mały. Bądźmy bliżej.</span><span
			class="utility-right">Pytania, blipy i trochę dobrego internetu <span>:) </span></span
		>
	</div>
</div>
<header class="site-header">
	<div class="container header-inner">
		<a class="logo-link" href="/" aria-label="Bliza, strona główna"
			>{@render brand()}<span class="brand-tagline">pytaj. pisz. bądź blisko.</span></a
		>
		<form method="GET" action="/" class="search-form" role="search">
			<Icon name="search" size={19} /><label class="sr-only" for="search"
				>Szukaj pytań, blipów i ludzi</label
			><input
				id="search"
				name="q"
				placeholder="Szukaj pytań, blipów, ludzi…"
				value={filters.q || ''}
				maxlength="200"
			/><button aria-label="Szukaj" type="submit"><Icon name="arrow" size={17} /></button>
		</form>
		<div class="header-actions">
			<button class="write-button" onclick={() => startWriting()}
				><Icon name="plus" size={17} /><span>Dodaj wpis</span></button
			><button
				class="account-button"
				onclick={() => profileDialog.showModal()}
				aria-label="Twój profil"
				><Avatar kind={data.user.avatar} size={32} /><Icon name="down" size={14} /></button
			>
		</div>
	</div>
	<div class="nav-border">
		<div class="container nav-inner">
			<nav aria-label="Główna nawigacja">
				<a class:active={view === 'all' && !filters.type && !filtered} href="/"
					><Icon name="home" size={17} />Strona główna</a
				><a class:active={filters.type === 'question'} href="/?type=question"
					><Icon name="question" size={17} />Pytania i odpowiedzi</a
				><a class:active={filters.type === 'blip'} href="/?type=blip"
					><Icon name="chat" size={17} />Blipowisko<span class="new-label">160 znaków</span></a
				>
			</nav>
			<span class="nav-note"><span class="online-dot"></span> Dobrze, że jesteś.</span>
		</div>
	</div>
</header>

<div class="container breadcrumb">
	<span>Jesteś u siebie</span><Icon name="chevron" size={12} /><span
		>{filtered
			? 'Odkrywaj'
			: view === 'saved'
				? 'Zapisane'
				: view === 'following'
					? 'Obserwowani'
					: filters.type === 'question'
						? 'Pytania'
						: filters.type === 'blip'
							? 'Blipowisko'
							: 'Strona główna'}</span
	><button class="ticket-entry" onclick={openTicket}
		><Icon name="ticket" size={16} />Mam bilet!</button
	>
</div>

<main class="container portal-grid">
	<aside class="left-sidebar" aria-label="Twoja przestrzeń i kategorie">
		<section class="profile-panel panel">
			<div class="profile-top">
				<Avatar kind={data.user.avatar} size={44} />
				<div>
					<span class="eyebrow">CZEŚĆ, SĄSIEDZIE!</span><button
						class="profile-name"
						onclick={() => profileDialog.showModal()}
						title="Zmień swój nick">{data.user.name}<Icon name="edit" size={12} /></button
					><span class="profile-status"><span class="online-dot"></span> Twój mały kąt</span>
				</div>
			</div>
			<div class="profile-numbers">
				<a href={link({ user: data.user.id }, true)}
					><strong>{data.stats.mine}</strong><span>wpisy</span></a
				><a href="/?view=following"
					><strong>{data.stats.following}</strong><span>obserwowani</span></a
				>
			</div>
		</section>
		<nav class="side-navigation" aria-label="Przeglądaj wpisy">
			<a class:chosen={view === 'all' && !filtered && !filters.type} href="/"
				><Icon name="globe" />Wszystkie wpisy</a
			>
			<a class:chosen={view === 'following'} href="/?view=following"
				><Icon name="users" />Obserwowani</a
			>
			<a class:chosen={view === 'popular'} href="/?view=popular"><Icon name="flame" />Popularne</a>
			<a class:chosen={view === 'unanswered'} href="/?view=unanswered"
				><Icon name="question" />Bez odpowiedzi<span class="side-count"
					>{data.stats.unanswered}</span
				></a
			>
			<a class:chosen={view === 'saved'} href="/?view=saved"
				><Icon name="bookmark" />Zapisane<span class="side-count">{data.stats.saved}</span></a
			>
		</nav>
		<section class="category-section">
			<h2 class="sidebar-heading">JEST O CZYM POGADAĆ</h2>
			<nav aria-label="Kategorie">
				{#each data.categories as item}<a
						class:category-active={filters.category === item.name}
						href={link({ category: item.name }, true)}
						><Icon name={item.icon} size={17} /><span>{item.name}</span><span class="category-count"
							>{item.count}</span
						></a
					>{/each}
			</nav>
		</section>
		<div class="little-note">
			<span class="note-doodle">✳</span>
			<p>Nie ma głupich pytań.<br />Są tylko te niezadane.</p>
			<button onclick={() => startWriting()}>No to zapytaj <Icon name="arrow" size={14} /></button>
		</div>
		<div class="sidebar-bottom">
			<button onclick={() => aboutDialog.showModal()}>O blizie</button><span>·</span><button
				onclick={() => aboutDialog.showModal()}>Zasady</button
			>
			<p>Trochę jak dawniej.<br />Tylko jesteśmy tutaj teraz.</p>
		</div>
	</aside>

	<div class="main-column">
		<div class="feed-intro">
			<div class="intro-kicker"><span class="orange-dash"></span> DOBRZE BYĆ MIĘDZY LUDŹMI</div>
			<h1>O czym dziś pogadamy<span>?</span></h1>
			<p>Zadaj pytanie. Podziel się chwilą. Znajdź swoich ludzi.</p>
		</div>
		<section id="composer" class="composer panel" aria-label="Dodaj pytanie lub blipa">
			<div class="composer-tabs">
				<button
					class:selected={kind === 'question'}
					aria-pressed={kind === 'question'}
					onclick={() => startWriting('question')}
					><Icon name="question" size={18} />Zadaj pytanie</button
				><button
					class:selected={kind === 'blip'}
					aria-pressed={kind === 'blip'}
					onclick={() => startWriting('blip')}><Icon name="chat" size={18} />Napisz blipa</button
				><span class="composer-hint"
					>{kind === 'question' ? 'Ktoś na pewno wie :)' : 'Mała chwila, wielka rozmowa.'}</span
				>
			</div>
			<form
				method="POST"
				action="?/publish"
				name="publish"
				enctype="multipart/form-data"
				use:enhance={submit}
			>
				<input type="hidden" name="kind" value={kind} />
				<div class="composer-writing">
					<Avatar kind={data.user.avatar} size={36} /><label class="sr-only" for="draft"
						>{kind === 'question' ? 'Twoje pytanie' : 'Twój blip'}</label
					><textarea
						id="draft"
						bind:this={composeField}
						bind:value={draft}
						name={kind === 'question' ? 'title' : 'body'}
						placeholder={kind === 'question'
							? 'Co Ci chodzi po głowie? Śmiało, zapytaj…'
							: 'Co u Ciebie? Masz 160 znaków dla świata…'}
						required
						minlength={kind === 'question' ? 5 : 1}
						maxlength={kind === 'question' ? 180 : 160}
						rows="2"></textarea>
				</div>
				{#if kind === 'question'}{#if showDescription}<div class="description-field">
							<label for="description">Dopowiedz coś więcej <span>(opcjonalnie)</span></label
							><textarea
								id="description"
								name="body"
								bind:value={description}
								placeholder="Trochę kontekstu zawsze pomaga… Możesz dodać #tagi."
								maxlength="4000"
								rows="3"></textarea>
						</div>{:else}<input type="hidden" name="body" value={description} />{/if}{/if}
				{#if kind === 'blip'}
					<div class="image-attachment">
						<label class="attach-image"
							><Icon name="image" size={16} />{selectedImage
								? 'Zmień zdjęcie'
								: 'Dodaj zdjęcie'}<input
								bind:this={imageInput}
								type="file"
								name="image"
								accept="image/jpeg,image/png,image/gif,image/webp"
								aria-label="Zdjęcie do blipa"
								aria-describedby="image-help"
								onchange={selectImage}
								disabled={pending}
							/></label
						>
						<span id="image-help">JPG, PNG, GIF, WebP · do 5 MB</span>
					</div>
					{#if imageError}<p class="image-error" role="alert">{imageError}</p>{/if}
					{#if selectedImage}<div class="image-preview">
							<img src={imagePreview} alt="Podgląd zdjęcia do blipa" />
							<div>
								<strong>{selectedImage.name}</strong><span
									>{Math.ceil(selectedImage.size / 1024)} KB</span
								>
							</div>
							<button
								type="button"
								disabled={pending}
								aria-label="Usuń wybrane zdjęcie"
								onclick={clearImage}><Icon name="close" size={16} /></button
							>
						</div>{/if}
				{/if}
				<div class="composer-footer">
					<div class="composer-options">
						<label class="sr-only" for="category">Kategoria wpisu</label><span
							class="category-picker"
							><Icon name="grid" size={14} /><select
								id="category"
								name="category"
								bind:value={category}
								>{#each data.categories as item}<option>{item.name}</option>{/each}</select
							><Icon name="down" size={12} /></span
						>{#if kind === 'question'}<button
								class="add-description"
								type="button"
								onclick={() => (showDescription = !showDescription)}
								>{showDescription ? 'Ukryj opis' : '+ Dodaj opis'}</button
							>{:else}<span class="character-count" class:limit={draft.length === 160}
								>{draft.length}<span> / 160</span></span
							>{/if}
					</div>
					<button class="publish-button" disabled={pending} type="submit"
						>{pending ? 'Chwileczkę…' : kind === 'question' ? 'Zapytaj' : 'Blipnij'}<Icon
							name="arrow"
							size={16}
						/></button
					>
				</div>
			</form>
		</section>
		{#if (form?.error || form?.success) && !dismissed}<div
				class="form-message"
				class:error={!!form.error}
				role={form.error ? 'alert' : 'status'}
			>
				<span>{form.error || form.success}</span><button
					aria-label="Zamknij powiadomienie"
					onclick={() => (dismissed = true)}><Icon name="close" size={16} /></button
				>
			</div>{/if}

		<section id="feed" class="feed" aria-labelledby="feed-title">
			<div class="feed-heading">
				<h2 id="feed-title">{feedTitle}</h2>
				<label class="sort-control"
					><Icon name="rss" size={13} /><span class="sr-only">Kolejność wpisów</span><select
						value={view === 'popular' ? 'popular' : 'all'}
						onchange={(e) =>
							goto(link({ view: e.currentTarget.value === 'all' ? null : 'popular' }))}
						><option value="all">Najnowsze</option><option value="popular">Popularne</option
						></select
					><Icon name="down" size={12} /></label
				>
			</div>
			<div class="feed-tabs">
				<nav aria-label="Typ wpisów">
					<a class:tab-active={!filters.type} href={link({ type: null })}>Wszystko</a><a
						class:tab-active={filters.type === 'question'}
						href={link({ type: 'question' })}>Pytania</a
					><a class:tab-active={filters.type === 'blip'} href={link({ type: 'blip' })}>Blipy</a>
				</nav>
				<span
					>{data.total}
					{data.total === 1
						? 'wpis'
						: data.total % 10 >= 2 &&
							  data.total % 10 <= 4 &&
							  (data.total % 100 < 12 || data.total % 100 > 14)
							? 'wpisy'
							: 'wpisów'}</span
				>
			</div>
			{#if filtered}<div class="filter-summary">
					<span
						><Icon name="search" size={14} />{filters.category ||
							(filters.tag ? `#${filters.tag}` : filters.q || 'Wybrany użytkownik')}</span
					><a href="/">Wyczyść filtr <Icon name="close" size={13} /></a>
				</div>{/if}
			<div class="post-list">
				{#each data.posts as post (post.id)}
					<article
						class="post"
						class:question-post={post.kind === 'question'}
						id={`post-${post.id}`}
					>
						<div class="post-header">
							<a
								href={link({ user: post.user_id }, true)}
								class="avatar-link"
								aria-label={`Wpisy ${post.name}`}><Avatar kind={post.avatar} size={40} /></a
							>
							<div class="post-byline">
								<a class="author-name" href={link({ user: post.user_id }, true)}>{post.name}</a>
								<div class="post-meta">
									<time datetime={new Date(post.created).toISOString()}>{ago(post.created)}</time
									><span>·</span><a href={link({ category: post.category }, true)}
										>{post.category}</a
									>
								</div>
							</div>
							<span class="post-kind" class:is-blip={post.kind === 'blip'}
								><Icon
									name={post.kind === 'question' ? 'question' : 'chat'}
									size={13}
								/>{post.kind === 'question' ? 'pytanie' : 'blip'}</span
							>
						</div>
						<div class="post-content">
							{#if post.title}<h3>
									<a
										href={`#replies-${post.id}`}
										onclick={() => {
											const detail = document.getElementById(`replies-${post.id}`);
											if (detail) detail.open = true;
										}}>{post.title}</a
									>
								</h3>{/if}{#if post.body}<p>{@render richText(post.body)}</p>{/if}{#if post.image}<a
									class="post-photo"
									href={post.image}
									target="_blank"
									rel="noreferrer"
									><img
										src={post.image}
										alt={post.image === '/images/mountains.jpg'
											? 'Skaliste szczyty Tatr w słońcu nad zieloną doliną'
											: `Zdjęcie do blipa użytkownika ${post.name}`}
										width="1000"
										height="560"
										loading="lazy"
									/><span
										><Icon
											name={post.image === '/images/mountains.jpg' ? 'compass' : 'image'}
											size={13}
										/>{post.image === '/images/mountains.jpg'
											? 'Gdzieś w Tatrach. Z dala od wszystkiego.'
											: `Zdjęcie od ${post.name}`}</span
									></a
								>{/if}
						</div>
						<div class="post-bottom">
							<form method="POST" action="?/like" use:enhance={submit}>
								<input type="hidden" name="id" value={post.id} /><button
									class="like-button"
									class:liked={post.liked}
									aria-pressed={!!post.liked}
									aria-label={`${post.liked ? 'Cofnij polubienie' : 'Polub wpis'}: ${post.likes} polubień`}
									disabled={pending}
									><Icon name="heart" size={16} /><span>{post.likes}</span></button
								>
							</form>
							<details class="replies" id={`replies-${post.id}`}>
								<summary
									><Icon name="chat" size={16} /><span
										>{post.kind === 'question' ? 'Odpowiedzi' : 'Komentarze'}
										<strong>{post.reply_count}</strong></span
									></summary
								>
								<div class="reply-thread">
									{#each post.replies as reply}<div class="reply">
											<Avatar kind={reply.avatar} size={28} />
											<div>
												<a class="author-name" href={link({ user: reply.user_id }, true)}
													>{reply.name}</a
												>
												<p>{@render richText(reply.body)}</p>
											</div>
										</div>{:else}<p class="first-reply">
											{post.kind === 'question'
												? 'Znasz odpowiedź? Bądź pierwszą osobą, która pomoże.'
												: 'Tu zaczyna się rozmowa. Napisz coś miłego.'}
										</p>{/each}
									<form method="POST" action="?/reply" use:enhance={submit} class="reply-form">
										<input type="hidden" name="id" value={post.id} /><label
											class="sr-only"
											for={`reply-${post.id}`}>Twoja odpowiedź</label
										><textarea
											id={`reply-${post.id}`}
											name="body"
											required
											maxlength="2000"
											rows="2"
											placeholder="Dołącz do rozmowy…"></textarea><button
											class="publish-button"
											disabled={pending}
											type="submit">Odpowiedz<Icon name="send" size={14} /></button
										>
									</form>
								</div>
							</details>
							<form class="save-form" method="POST" action="?/save" use:enhance={submit}>
								<input type="hidden" name="id" value={post.id} /><button
									class:saved={post.saved}
									aria-pressed={!!post.saved}
									aria-label={post.saved ? 'Usuń z zapisanych' : 'Zapisz na później'}
									title={post.saved ? 'Zapisany wpis' : 'Zapisz na później'}
									disabled={pending}><Icon name="bookmark" size={16} /></button
								>
							</form>
						</div>
					</article>
				{:else}<div class="empty-state">
						<Icon
							name={view === 'saved' ? 'bookmark' : view === 'following' ? 'users' : 'chat'}
							size={36}
						/>
						<h3>
							{view === 'saved'
								? 'Dobre rozmowy warto zachować.'
								: view === 'following'
									? 'Jeszcze nikogo nie obserwujesz.'
									: 'Tutaj jeszcze jest spokojnie.'}
						</h3>
						<p>
							{view === 'saved'
								? 'Kliknij zakładkę pod wpisem. Znajdziesz go tutaj.'
								: view === 'following'
									? 'Wybierz kogoś w „Warto poznać”. Jego wpisy pojawią się tutaj.'
									: 'Nie znaleźliśmy wpisów. Zmień filtr albo zacznij własną rozmowę.'}
						</p>
						<a href="/">Wróć do wszystkich wpisów<Icon name="arrow" size={16} /></a>
					</div>{/each}
			</div>
			{#if data.total > 20}<nav class="pagination" aria-label="Strony wpisów">
					{#if data.page > 1}<a href={link({ page: data.page - 1 })}>← Poprzednia</a>{/if}<span
						>Strona {data.page} z {Math.ceil(data.total / 20)}</span
					>{#if data.page * 20 < data.total}<a href={link({ page: data.page + 1 })}>Następna →</a
						>{/if}
				</nav>{:else if data.posts.length}<div class="feed-end">
					<span></span><Icon name="smile" size={18} /><span></span>
					<p>Jesteś na bieżąco. Może teraz Twoja kolej?</p>
				</div>{/if}
		</section>
	</div>

	<aside class="right-sidebar" aria-label="Społeczność">
		<section class="welcome-panel">
			<span class="welcome-eyebrow">MAŁY ZAKĄTEK INTERNETU</span>
			<h2>Dobre pytania.<br />Jeszcze lepsze<br /><span>rozmowy.</span></h2>
			<div class="welcome-art" aria-hidden="true">
				<span class="spark spark-one">✳</span><span class="speech large-speech"
					>hej<span>!</span></span
				><span class="speech small-speech">:)</span><span class="spark spark-two">+</span>
			</div>
			<p>
				Pamiętasz internet, w którym<br />po prostu się rozmawiało?<br /><strong
					>My też. Rozgość się.</strong
				>
			</p>
			<button onclick={() => startWriting('blip')}
				>Powiedz „cześć”<Icon name="arrow" size={16} /></button
			>
			<div class="welcome-bottom">
				<span class="online-dot"></span> Bez algorytmu. Po prostu ludzie.
			</div>
		</section>
		<section class="trending-panel panel">
			<div class="section-heading">
				<h2><Icon name="hash" size={18} />Na językach</h2>
				<span>TERAZ</span>
			</div>
			<div class="trending-list">
				{#each data.trending as tag, i}<a href={link({ tag: tag.tag }, true)}
						><span class="trend-number">{String(i + 1).padStart(2, '0')}</span><span
							class="trend-name">#{tag.tag}</span
						><span class="trend-count">{tag.count}<Icon name="chevron" size={12} /></span></a
					>{/each}
			</div>
		</section>
		<section class="people-panel panel">
			<div class="section-heading">
				<h2><Icon name="users" size={18} />Warto poznać</h2>
				<span class="people-heart">♡</span>
			</div>
			<div class="people-list">
				{#each data.people as person}<div class="person">
						<a href={link({ user: person.id }, true)} aria-label={`Wpisy ${person.name}`}
							><Avatar kind={person.avatar} size={36} /></a
						>
						<div class="person-info">
							<a href={link({ user: person.id }, true)}>{person.name}</a><span
								>{person.contributions}
								{person.contributions === 1 ? 'raz w rozmowie' : 'razy w rozmowach'}</span
							>
						</div>
						<form method="POST" action="?/follow" use:enhance={submit}>
							<input type="hidden" name="id" value={person.id} /><button
								class:following={person.following}
								disabled={pending}
								aria-label={`${person.following ? 'Przestań obserwować' : 'Obserwuj'} ${person.name}`}
								aria-pressed={!!person.following}
								title={person.following ? 'Obserwujesz' : 'Obserwuj'}
								><Icon name={person.following ? 'check' : 'plus'} size={16} /></button
							>
						</form>
					</div>{/each}
			</div>
		</section>
		<div class="community-note">
			<Icon name="leaf" size={22} />
			<div>
				<strong>Rośniemy dzięki Tobie.</strong>
				<p>{data.stats.posts} wpisów. Każdy od człowieka.<br />Każdy początek to małe „cześć”.</p>
			</div>
		</div>
	</aside>
</main>

<footer class="site-footer container">
	<a href="/" aria-label="Bliza">{@render brand(true)}</a><span
		>Zrobione z tęsknoty za dobrym internetem.</span
	><button onclick={() => aboutDialog.showModal()}
		>Pytaj śmiało. Pisz po swojemu. <Icon name="heart" size={13} /></button
	>
</footer>

<dialog bind:this={profileDialog} class="portal-dialog" aria-labelledby="profile-title">
	<div class="dialog-heading">
		<h2 id="profile-title">Daj się poznać.</h2>
		<button class="dialog-close" aria-label="Zamknij profil" onclick={() => profileDialog.close()}
			><Icon name="close" /></button
		>
	</div>
	<p>Wybierz nick, po którym poznają Cię sąsiedzi.</p>
	<form method="POST" action="?/profile" name="profile" use:enhance={submit}>
		<label for="nickname">Twój nick</label><input
			id="nickname"
			name="name"
			value={data.user.name}
			minlength="3"
			maxlength="24"
			required
			autocomplete="nickname"
		/><span class="field-help">3–24 znaki. Litery, cyfry, kropki i podkreślenia.</span
		>{#if form?.error && !dismissed}<p class="dialog-error" role="alert">
				{form.error}
			</p>{/if}<button class="publish-button" disabled={pending}
			>Zapisz nick<Icon name="check" size={16} /></button
		>
	</form>
	<div class="local-profile-note">
		<Icon name="ticket" size={20} />
		<div>
			<p>
				Nick nie musi mieszkać w jednej przeglądarce. Zabierz bilet powrotny w pliku TXT i wróć do
				swojego konta, kiedy chcesz.
			</p>
			<button class="ticket-profile-link" onclick={openTicket}
				>Zabierz swój nick do domu<Icon name="arrow" size={15} /></button
			>
		</div>
	</div>
</dialog>
<dialog bind:this={ticketDialog} class="portal-dialog ticket-dialog" aria-labelledby="ticket-title">
	<div class="dialog-heading">
		<h2 id="ticket-title">Bilet powrotny.</h2>
		<button class="dialog-close" aria-label="Zamknij kasownik" onclick={() => ticketDialog.close()}
			><Icon name="close" /></button
		>
	</div>
	<p>Bez hasła. Bez maila. Twój mały kawałek internetu w pliku TXT.</p>
	<section class="ticket-stub" aria-label="Twój bilet do Blizy">
		<div>
			<span class="ticket-overline">BLIZA · DOBRY INTERNET</span><strong>{data.user.name}</strong
			><span>Kierunek: Twój mały kąt <span aria-hidden="true">:)</span></span>
		</div>
		<Icon name="ticket" size={36} />
	</section>
	<form method="POST" action="/bilet" onsubmit={downloadTicket}>
		{#if data.hasTicket}<label class="ticket-replace"
				><input
					type="checkbox"
					name="replace"
					bind:checked={replaceTicket}
					value="yes"
					required
					disabled={pending}
				/>Unieważnij mój poprzedni bilet i wydaj nowy.</label
			>
			<p class="field-help">Otwarte sesje na innych urządzeniach pozostaną aktywne.</p>{/if}
		<button class="publish-button ticket-download" disabled={pending}
			>Zabierz swój nick do domu<Icon name="download" size={17} /></button
		>
	</form>
	{#if ticketMessage}<p class="ticket-message" role="status">{ticketMessage}</p>{/if}
	<div class="ticket-divider"><span>MASZ JUŻ BILET?</span></div>
	<form
		method="POST"
		action="?/recover"
		name="recover"
		enctype="multipart/form-data"
		use:enhance={submit}
	>
		<label class="ticket-slot"
			><Icon name="ticket" size={24} /><span
				><strong>Wrzuć bilet do kasownika</strong><span
					>{ticketFileName || 'albo kliknij i wybierz plik .txt'}</span
				></span
			><input
				type="file"
				name="ticket"
				accept=".txt,text/plain"
				aria-label="Bilet powrotny w pliku TXT"
				aria-describedby="ticket-safety"
				required
				disabled={pending}
				onchange={selectTicket}
			/></label
		>
		<button class="ticket-return" disabled={pending}
			>Wracam do siebie<Icon name="arrow" size={17} /></button
		>
	</form>
	{#if ticketError || (!dismissed && form?.ticketError)}<p class="dialog-error" role="alert">
			{ticketError || form.ticketError}
		</p>{/if}
	<p class="ticket-safety" id="ticket-safety">
		<Icon name="lock" size={16} /><span
			>Ten plik otwiera konto. Nie udostępniaj go. Bez pliku i ciasteczka nie odzyskasz profilu.
			Powrót zmienia konto w tej przeglądarce, bez przenoszenia wpisów ani szkiców.</span
		>
	</p>
</dialog>
<dialog bind:this={aboutDialog} class="portal-dialog" aria-labelledby="about-title">
	<div class="dialog-heading">
		<h2 id="about-title">Dobry internet zaczyna się od nas.</h2>
		<button class="dialog-close" aria-label="Zamknij informacje" onclick={() => aboutDialog.close()}
			><Icon name="close" /></button
		>
	</div>
	<p>
		Bliza łączy ducha dawnych polskich portali pytań i odpowiedzi z krótkimi rozmowami z Blipa. To
		nowy, niezależny projekt, nie oryginalne Zapytaj ani Blip.
	</p>
	<ol class="community-rules">
		<li>Pytaj śmiało. Każdy czegoś nie wie.</li>
		<li>Rozmawiaj z człowiekiem, nie z przeciwnikiem.</li>
		<li>Nie publikuj cudzych danych ani spamu.</li>
		<li>Blip to 160 znaków. Dobra rozmowa nie ma limitu.</li>
	</ol>
	<p class="field-help">
		Wersja próbna: bez moderacji. Konto odzyskasz tylko z biletem powrotnym. Nie publikuj poufnych
		informacji. Zdjęcie gór: Unsplash. Wpisy startowe są przykładowe.
	</p>
	<button class="publish-button" onclick={() => aboutDialog.close()}
		>Brzmi dobrze<Icon name="check" size={16} /></button
	>
</dialog>
