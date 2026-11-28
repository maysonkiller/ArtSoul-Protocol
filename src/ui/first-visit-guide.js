import { visitPaths } from './first-visit-paths.js';

const progressKey = 'artsoul_first_visit_guide_v1';
const arrivalKey = progressKey + '_arrival';

function storage(win, area, key, value) {
    try {
        const store = win[area];
        if (value === undefined) return store.getItem(key);
        if (value === null) store.removeItem(key);
        else store.setItem(key, value);
        return true;
    } catch {
        return null;
    }
}

function artworkRoute(value, origin) {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value, origin);
        if (url.origin !== origin) return '';
        if (/^\/artwork\/[^/]+$/.test(url.pathname)) return url.pathname;
        const id = url.searchParams.get('id');
        if (url.pathname === '/artwork' && id) return '/artwork?id=' + encodeURIComponent(id);
    } catch { /* Ignore an obsolete or invalid saved link. */ }
    return '';
}

function readRecord(raw, origin) {
    if (raw === null) return null;
    try {
        const saved = JSON.parse(raw);
        if (['seen', 'skipped', 'finished'].includes(saved.status)) return { status: saved.status };
        if (saved.status === 'started') {
            if (!saved.goal) return { status: 'started' };
            const path = typeof saved.goal === 'string' && Object.hasOwn(visitPaths, saved.goal) && visitPaths[saved.goal];
            const step = Number.isInteger(saved.step) && path?.steps?.[saved.step];
            if (step) {
                if (step.route !== '/artwork') return { status: 'started', goal: saved.goal, step: saved.step };
                const work = artworkRoute(saved.work, origin);
                if (work) return { status: 'started', goal: saved.goal, step: saved.step, work };
            }
        }
    } catch { /* A damaged record still counts as a previous visit. */ }
    return { status: 'seen' };
}

export function installFirstVisitGuide(win, doc) {
    const entry = doc.querySelector('[data-visit-page]');
    if (!entry) return;
    const page = entry.dataset.visitPage;
    const origin = win.location.origin;
    const readProgress = () => readRecord(storage(win, 'sessionStorage', progressKey) ??
        storage(win, 'localStorage', progressKey) ?? win.history.state?.[progressKey] ?? null, origin);
    let progress = readProgress();
    let view = 'idle';
    let target = null;
    let lastVariant = null;
    let revealOnArrival = false;
    let opener = null;

    const panel = doc.createElement('aside');
    panel.className = 'visit-guide';
    panel.setAttribute('aria-label', 'First visit guide');
    const observer = new win.MutationObserver(() => { if (view === 'step') renderStep(); });

    function remember(record) {
        progress = record;
        const json = JSON.stringify(record);
        if (storage(win, 'localStorage', progressKey, json)) {
            storage(win, 'sessionStorage', progressKey, null);
            return true;
        }
        if (storage(win, 'sessionStorage', progressKey, json)) return true;
        // A storage-restricted tab can still resume within this history entry.
        try { win.history.replaceState({ ...win.history.state, [progressKey]: json }, ''); } catch { /* In-memory only. */ }
        return false;
    }

    function isHere(record) {
        if (!record?.goal) return false;
        const route = visitPaths[record.goal].steps[record.step].route.split('#')[0];
        if (page !== route) return false;
        if (page === '/profile') return !new URL(win.location.href).searchParams.get('address');
        if (page === '/artwork') {
            if (artworkRoute(win.location.href, origin) === record.work) return true;
            const urls = win.ArtSoulArtworkUrl;
            return urls && urls.currentArtworkId(win.location) === urls.currentArtworkId(new URL(record.work, origin));
        }
        return true;
    }

    function travel(record, linkEvent) {
        const route = record.work || visitPaths[record.goal].steps[record.step].route;
        // A one-use ticket leaves the current step intact if beforeunload cancels.
        if (storage(win, 'sessionStorage', arrivalKey, JSON.stringify(record))) {
            if (!linkEvent) win.location.assign(route);
            return;
        }
        // Carry only a resumable step when the tab cannot store a ticket.
        const url = new URL(route, origin);
        url.searchParams.set('visitGuide', record.goal + '.' + record.step);
        linkEvent?.preventDefault();
        win.location.assign(url.pathname + url.search + url.hash);
    }

    function activate(record, arriving = false) {
        remember(record);
        view = 'step';
        revealOnArrival = arriving;
        renderStep(!arriving);
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'style'] });
    }

    function go(record) {
        if (!record.goal) return choose();
        if (!isHere(record)) {
            travel(record);
            return;
        }
        activate(record);
    }

    function element(tag, text) {
        const node = doc.createElement(tag);
        node.textContent = text;
        return node;
    }

    function button(label, action, primary = false) {
        const node = element('button', label);
        node.type = 'button';
        node.className = primary ? 'btn-main' : 'btn-secondary';
        node.dataset.allowRapid = 'true';
        node.addEventListener('click', action);
        return node;
    }

    function place(slot) {
        const previous = panel.parentElement;
        if (previous !== slot) {
            if (previous) previous.hidden = true;
            slot.append(panel);
        }
        slot.hidden = false;
    }

    function highlight(control) {
        if (target === control) return;
        if (target) {
            target.removeAttribute('data-visit-highlight');
            const ids = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== 'visit-guide-hint');
            if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
            else target.removeAttribute('aria-describedby');
        }
        target = control;
        if (control) {
            control.setAttribute('data-visit-highlight', '');
            control.setAttribute('aria-describedby', [control.getAttribute('aria-describedby'), 'visit-guide-hint'].filter(Boolean).join(' '));
        }
    }

    function clearStep() {
        highlight(null);
        lastVariant = null;
        revealOnArrival = false;
        observer.disconnect();
    }

    function card(slot, title, text, buttons, focus, counter = '') {
        const hadFocus = panel.contains(doc.activeElement);
        const heading = element('h2', title);
        heading.tabIndex = -1;
        const hint = element('p', text);
        hint.id = 'visit-guide-hint';
        heading.setAttribute('aria-describedby', hint.id);
        const actions = element('div', '');
        actions.className = 'visit-guide-actions';
        actions.append(...buttons);
        panel.replaceChildren();
        if (counter) panel.append(element('small', counter));
        panel.append(heading, hint, actions);
        place(slot);
        if (focus || hadFocus) heading.focus({ preventScroll: true });
        if (focus) panel.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    }

    function idle(focus = false, slot = entry) {
        const previousTarget = target;
        clearStep();
        view = 'idle';
        if (progress?.status === 'started' && (page === '/' || isHere(progress) || focus) && page !== '/docs-protocol') {
            const resume = button('Resume guide', () => go(progress));
            panel.replaceChildren(resume);
            place(slot.isConnected ? slot : entry);
            if (focus) resume.focus({ preventScroll: true });
        } else {
            if (panel.parentElement) panel.parentElement.hidden = true;
            panel.remove();
            if (focus) {
                const destination = [opener, previousTarget, doc.querySelector('.site-primary-nav a')].find(node => node?.isConnected);
                destination?.focus({ preventScroll: true });
            }
        }
    }

    function dismiss() {
        storage(win, 'sessionStorage', arrivalKey, null);
        idle(true, panel.parentElement);
    }

    function end(status) {
        remember({ status });
        dismiss();
    }

    function choose() {
        const slot = doc.querySelector('[data-visit-slot="docs"]') || panel.parentElement || entry;
        clearStep();
        view = 'choose';
        if (progress?.status !== 'started') remember({ status: 'started' });
        const buttons = [];
        if (progress.goal) buttons.push(button('Resume guide', () => go(progress), true));
        for (const [goal, path] of Object.entries(visitPaths)) {
            buttons.push(button(path.label, () => go({ status: 'started', goal, step: 0 })));
        }
        buttons.push(button('Dismiss', dismiss), button('Skip guide', () => end('skipped')));
        card(slot, 'What would you like to do?', 'Choose a path. You can pause at any step and reopen the guide in How it works.', buttons, true);
    }

    function renderStep(explicit = false) {
        const path = visitPaths[progress.goal];
        const step = path.steps[progress.step];
        const variants = [step, ...(step.alternatives || [])];
        let control = null;
        let variant = step;
        for (const option of variants) {
            const candidate = doc.querySelector(option.selector);
            if (candidate?.getClientRects().length) {
                control = candidate;
                variant = option;
                break;
            }
        }
        const slot = (variant.slot && doc.querySelector(`[data-visit-slot="${variant.slot}"]`)) || entry;
        if (!explicit && target === control && lastVariant === variant && panel.parentElement === slot) return;
        highlight(control);
        lastVariant = variant;

        const position = progress.step;
        const recordAt = step => ({ status: 'started', goal: progress.goal, step });
        const buttons = [button('Back', () => position ? go(recordAt(position - 1)) : choose())];
        if (control) buttons.push(button('Show control', () => {
            control.scrollIntoView({ behavior: 'instant', block: 'center' });
            control.focus({ preventScroll: true });
        }));
        const next = path.steps[position + 1];
        if (next?.route === '/artwork') {
            const work = artworkRoute(control?.href, origin);
            if (work) buttons.push(button('Open artwork', () => go({ ...recordAt(position + 1), work }), true));
        } else if (next) {
            buttons.push(button(next.route === step.route ? 'Next' : 'Open builder', () => go(recordAt(position + 1)), true));
        } else {
            buttons.push(button('Finish guide', () => end('finished'), true));
        }
        buttons.push(button('Dismiss', dismiss), button('Skip guide', () => end('skipped')));
        const text = control ? variant.text : (step.unavailable || 'This control is currently unavailable. You can continue reading or resume this step later.');
        const reveal = explicit || (revealOnArrival && Boolean(control));
        if (reveal) revealOnArrival = false;
        card(slot, step.title, text, buttons, reveal, `${path.label} · ${position + 1} of ${path.steps.length}`);
    }

    doc.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const open = event.target.closest('[data-open-visit-guide]');
        if (open) {
            opener = open;
            choose();
            return;
        }
        // Following the actual product link advances just like the guide button.
        const link = event.target.closest('a[href]');
        if (view !== 'step' || !link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
        if (progress.goal === 'collection' && page === '/upload' && link === target) {
            travel({ status: 'started', goal: 'collection', step: 1 }, event);
        }
        if (progress.goal === 'browse' && page === '/gallery' && link.matches('.gallery-results-grid a.artsoul-card-link')) {
            const work = artworkRoute(link.href, origin);
            if (work) travel({ status: 'started', goal: 'browse', step: 2, work }, event);
        }
    });
    // A slow-loading target must not take focus after the visitor moves on.
    doc.addEventListener('pointerdown', () => { revealOnArrival = false; }, true);
    doc.addEventListener('keydown', event => {
        revealOnArrival = false;
        if (event.key !== 'Escape' || !panel.contains(event.target) || view === 'idle') return;
        event.preventDefault();
        event.stopPropagation();
        if (view === 'welcome') end('skipped');
        else dismiss();
    });
    function restore() {
        progress = readProgress();
        idle();
    }
    win.addEventListener('pageshow', event => {
        if (event.persisted) {
            storage(win, 'sessionStorage', arrivalKey, null);
            restore();
        }
    });
    win.addEventListener('storage', event => { if (event.key === progressKey || event.key === null) restore(); });

    // A URL hint never starts a tour or selects a destination. Consume it on
    // this page only, retaining the product's query, hash and history state.
    const url = new URL(win.location.href);
    const hint = url.searchParams.get('visitGuide');
    if (hint !== null) {
        url.searchParams.delete('visitGuide');
        try { win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash); } catch { /* History may also be restricted. */ }
        const match = /^([a-z]+)\.(\d+)$/.exec(hint);
        if (match && (!progress || progress.status === 'started')) {
            const saved = readRecord(JSON.stringify({ status: 'started', goal: match[1], step: Number(match[2]), work: url.href }), origin);
            if (isHere(saved)) remember(saved);
        }
    }
    const arrival = readRecord(storage(win, 'sessionStorage', arrivalKey), origin);
    storage(win, 'sessionStorage', arrivalKey, null);
    const navigation = win.performance?.getEntriesByType?.('navigation')?.[0]?.type;
    if (progress?.status === 'started' && isHere(arrival)) {
        if (navigation === 'navigate') activate(arrival, true);
        else {
            remember(arrival);
            idle();
        }
    } else if (!progress && remember({ status: 'seen' })) {
        view = 'welcome';
        card(entry, 'Welcome to ArtSoul', 'Would you like a short guide to exploring or creating art?', [
            button('Start', choose, true), button('Skip', () => end('skipped'))
        ], false);
    } else {
        idle();
    }
}
