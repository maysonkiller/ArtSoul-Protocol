import { SEARCH_CATEGORIES, canSearch, normalizeSearchQuery, createSearchState, readSearchHistory, writeSearchHistory } from './search-state.js';

const labels = { all: 'All', artworks: 'Artworks', auctions: 'Live auctions', artists: 'Artists' };
let dialog, input, results, status, tabs, returnFocus, timer, opening = false;
let deadlineTimer, deadlineUpdates = [];
let category = 'all';
let storage; try { storage = window.localStorage; } catch { /* Storage is optional. */ }
let history = readSearchHistory(storage);
const state = createSearchState({ onChange: render });
function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
}
function button(text, action, className = '') {
    const node = element('button', className, text); node.type = 'button'; node.addEventListener('click', action); return node;
}
function rememberQuery() {
    const query = normalizeSearchQuery(input.value); if (!canSearch(query)) return;
    history.queries = [query, ...history.queries.filter(v => v !== query)].slice(0, 6); writeSearchHistory(storage, history);
}
function rememberView(kind, id) {
    history.views = [{ kind, id }, ...history.views.filter(v => v.kind !== kind || v.id !== id)].slice(0, 6);
    writeSearchHistory(storage, history); rememberQuery();
}
function artworkHref(id) { return window.ArtSoulArtworkUrl.artworkPath(`v41:84532:${id}`); }
function close() { if (dialog?.open) dialog.close(); }
function chooseCategory(next) { category = next; rememberQuery(); state.search(input.value, category); }
function setQuery(query) {
    input.value = query; clearTimeout(timer); state.reset(query, category);
    if (canSearch(query)) timer = setTimeout(() => state.search(query, category), 250);
}
function createDialog() {
    dialog = element('dialog', 'artsoul-search-dialog'); dialog.id = 'artsoul-search-dialog'; dialog.setAttribute('aria-labelledby', 'artsoul-search-title');
    const header = element('div', 'artsoul-search-heading');
    const title = element('h2', '', 'Search ArtSoul'); title.id = 'artsoul-search-title';
    const dismiss = button('Close', close, 'artsoul-search-close'); dismiss.setAttribute('aria-label', 'Close search');
    header.append(title, dismiss);
    const form = element('form', 'artsoul-search-form'); form.setAttribute('role', 'search');
    const label = element('label', 'artsoul-search-label', 'Title, artist, wallet address or artwork number'); label.htmlFor = 'artsoul-search-input';
    input = element('input'); input.id = 'artsoul-search-input'; input.type = 'search'; input.maxLength = 100; input.autocomplete = 'off';
    input.placeholder = 'Search ArtSoul'; input.enterKeyHint = 'search'; input.setAttribute('autocapitalize', 'none'); input.spellcheck = false;
    input.addEventListener('input', () => setQuery(input.value));
    input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { const link = results.querySelector('a'); if (link) { event.preventDefault(); link.focus(); } } });
    const submit = element('button', 'artsoul-search-submit', 'Search'); submit.type = 'submit';
    form.append(label, input, submit);
    form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); rememberQuery(); state.search(input.value, category); });
    tabs = element('div', 'artsoul-search-categories'); tabs.setAttribute('aria-label', 'Search categories'); tabs.setAttribute('role', 'group');
    for (const key of SEARCH_CATEGORIES) { const tab = button(labels[key], () => chooseCategory(key)); tab.dataset.category = key; tabs.append(tab); }
    status = element('p', 'artsoul-search-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    results = element('div', 'artsoul-search-results');
    results.addEventListener('keydown', event => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        const links = [...results.querySelectorAll('a, button')]; const current = links.indexOf(document.activeElement);
        if (current < 0) return; event.preventDefault();
        if (current === 0 && event.key === 'ArrowUp') input.focus();
        else links[Math.max(0, Math.min(links.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
    });
    dialog.append(header, form, tabs, status, results); document.body.append(dialog);
    // Search inputs consume their first Escape to clear text in some browsers.
    // Closing the dialog must still take one press from any control.
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect();
        if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    dialog.addEventListener('close', () => { clearTimeout(timer); clearInterval(deadlineTimer); deadlineUpdates = []; state.cancel(); returnFocus?.isConnected && returnFocus.focus({ preventScroll: true }); });
    window.addEventListener('pagehide', close);
}
function addImage(link, candidate, fallback) {
    const image = element('img', 'artsoul-search-image'); image.alt = ''; image.width = 56; image.height = 56; image.loading = 'lazy'; image.decoding = 'async';
    // Reuse the shared storage policy. Unrecognised external URLs never load as thumbnails.
    const safe = candidate && window.ArtSoulSecurity?.isValidStorageUrl?.(candidate);
    image.src = safe ? (window.ArtSoulStorageImage?.sized?.(candidate, 112) || candidate) : fallback;
    image.addEventListener('error', () => { image.src = fallback; }, { once: true }); link.append(image);
}
function resultLink(item, key) {
    const link = element('a', 'artsoul-search-result');
    const text = element('span', 'artsoul-search-result-text');
    let id;
    if (key === 'artists') {
        id = String(item.wallet_address || '').toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(id)) return null;
        link.href = '/profile?address=' + encodeURIComponent(id);
        addImage(link, item.avatar_url, '/default-avatar.png');
        const name = item.username || `${id.slice(0, 6)}…${id.slice(-4)}`;
        text.append(element('strong', '', name), element('span', '', `${id.slice(0, 8)}…${id.slice(-6)}`));
        link.title = name + ' — ' + id;
    } else {
        id = String(item.artwork_id || item.blockchain_id || '');
        if (!/^[1-9][0-9]{0,77}$/.test(id) || Number(item.chain_id) !== 84532) return null;
        const card = window.ArtSoulArtworkCard; link.href = artworkHref(id);
        const media = card.mediaDescriptor(item); const image = ['image', 'gif'].includes(media.type) ? media.thumbnailUrl : media.poster;
        addImage(link, image, '/ARTSOULlogo-clean.png');
        const creator = card.creatorLabel(item), lifecycle = card.statusInfo(item).label, price = card.formatPrice(item);
        const lifecycleLabel = element('span', '', [lifecycle, price].filter(Boolean).join(' · '));
        text.append(element('strong', '', item.title || `Artwork #${id}`), element('span', '', `Creator: ${creator}`), lifecycleLabel);
        const countdown = card.countdownInfo(item);
        if (countdown) {
            const deadline = element('span', '', 'Ends ' + new Date(countdown.endTime).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }));
            text.append(deadline);
            deadlineUpdates.push(() => { if (Date.now() >= countdown.endTime) { lifecycleLabel.textContent = ['Auction ended', price].filter(Boolean).join(' · '); deadline.textContent = 'Bidding is closed.'; } });
        }
        link.title = [item.title || `Artwork #${id}`, creator, lifecycle, price].filter(Boolean).join(' — ');
    }
    link.append(text); link.addEventListener('click', () => rememberView(key === 'artists' ? 'artist' : 'artwork', id)); return link;
}
function renderRecent() {
    history = readSearchHistory(storage);
    if (!history.queries.length && !history.views.length) { status.textContent = 'Find art and artists. Search by title, name, address or #number.'; return; }
    const heading = element('div', 'artsoul-search-group-heading'); heading.append(element('h3', '', 'On this browser'), button('Clear history', () => {
        history = { queries: [], views: [] }; try { storage?.removeItem('artsoul_search_history'); } catch {} render(state.getState());
    })); results.append(heading);
    if (history.queries.length) { results.append(element('h4', '', 'Recent searches')); const list = element('div', 'artsoul-search-recents');
        for (const query of history.queries) list.append(button(query, () => { input.value = query; state.search(query, category); })); results.append(list); }
    if (history.views.length) { results.append(element('h4', '', 'Recently opened from search'));
        for (const view of history.views) { const link = element('a', 'artsoul-search-recent-link', view.kind === 'artwork' ? `Artwork #${view.id}` : `Artist ${view.id.slice(0, 8)}…${view.id.slice(-6)}`);
            link.href = view.kind === 'artwork' ? artworkHref(view.id) : '/profile?address=' + encodeURIComponent(view.id); results.append(link); }
    }
}
function render(value) {
    if (!dialog?.open) return;
    deadlineUpdates = [];
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.category === category));
    results.replaceChildren(); results.setAttribute('aria-busy', String(['loading', 'more'].includes(value.status)));
    status.textContent = '';
    if (value.status === 'idle') { if (input.value.trim()) status.textContent = canSearch(input.value) ? 'Searching…' : 'Enter at least two characters or an artwork number.'; else renderRecent(); return; }
    if (value.status === 'loading') { status.textContent = 'Searching…'; return; }
    if (value.status === 'error') { status.textContent = value.error; results.append(button('Try again', () => state.search(input.value, category))); return; }
    let count = 0;
    for (const key of SEARCH_CATEGORIES.slice(1)) {
        const group = value.groups[key]; if (!group.items.length) continue;
        const section = element('section', 'artsoul-search-group'); const heading = element('div', 'artsoul-search-group-heading');
        heading.append(element('h3', '', labels[key]));
        if (category === 'all' && group.hasMore) heading.append(button('View all', () => chooseCategory(key)));
        section.append(heading);
        for (const item of group.items) { const link = resultLink(item, key); if (link) { section.append(link); count++; } }
        results.append(section);
    }
    status.textContent = count ? `${count} ${category === 'all' ? 'matches' : labels[category].toLowerCase()} shown.` : 'No matches. Try another title, artist or artwork number.';
    if (value.nextCursor) { const more = button(value.status === 'more' ? 'Loading…' : 'Load more', () => state.search(input.value, category, true)); more.disabled = value.status === 'more'; results.append(more); }
}
async function open(query) {
    if (opening || dialog?.open || document.querySelector('dialog[open]')) return;
    returnFocus = document.activeElement; opening = true;
    try {
        if (!window.ArtSoulArtworkUrl) await import('../../ui/artwork-url.js');
        if (!window.ArtSoulArtworkCard) await import('../../ui/components/artwork-card.js');
        if (!dialog) createDialog();
        for (const control of dialog.querySelectorAll('input, form button, .artsoul-search-categories button')) control.disabled = false;
        dialog.showModal(); input.focus({ preventScroll: true });
        if (typeof query === 'string') input.value = query.slice(0, 100);
        state.reset(input.value, category);
        if (canSearch(input.value)) state.search(input.value, category);
        clearInterval(deadlineTimer); deadlineTimer = setInterval(() => deadlineUpdates.forEach(update => update()), 1000);
    } catch {
        if (!dialog) createDialog();
        if (!dialog.open) dialog.showModal();
        for (const control of dialog.querySelectorAll('input, form button, .artsoul-search-categories button')) control.disabled = true;
        status.textContent = 'Search could not load. Close this window and try again.';
    } finally { opening = false; }
}
document.addEventListener('click', event => { if (event.target.closest?.('[data-artsoul-search]')) open(); });
window.addEventListener('artsoul:open-search', event => open(event.detail?.query));
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k' &&
        !event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]')) {
        event.preventDefault(); open();
    }
});
