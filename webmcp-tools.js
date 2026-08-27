/**
 * ArtSoul as an agent-native web application (WebMCP).
 *
 * An agent driving this site by clicking would have to guess which number on an
 * auction page is the current bid, whether the auction is still open, and what a
 * valid next bid is. Auction state changes every second and carries arithmetic,
 * so guessing is the wrong tool. WebMCP lets the page hand the agent the same
 * facts the page itself reads, as named tools with declared inputs.
 *
 * Two rules this file does not break:
 *
 * 1. The agent never signs. Reading is fully automatic. `place_bid` goes as far
 *    as a website can: it opens the person's wallet with the transaction, and
 *    the wallet asks them to approve it. That last click is theirs and cannot be
 *    delegated from here - a website cannot make a wallet approve anything, and
 *    an agent that could would be an agent that can lose someone's money on a
 *    misread instruction. Opening the wallet at all needs a permission the
 *    person grants with their own click in the page; no tool can raise it.
 * 2. No economics live here. The minimum increment, the deposit and the
 *    settlement window are contract constants. When the wallet layer is ready
 *    they are read from the chain; when it is not, this file reports what the
 *    public projection knows and says the contract decides the exact figure.
 *    Copying any of those figures in here would create a second source of truth
 *    for frozen economics, which is exactly what the canon forbids. A test
 *    asserts that none of them appear in this file.
 *
 * The file costs an ordinary visitor nothing: without a WebMCP-capable browser
 * it exits on the first line of the bootstrap and registers no handlers, makes
 * no requests and touches no DOM.
 */
(function () {
    'use strict';

    // Base Sepolia is the only product write network, so every lookup here is
    // scoped to it. Legacy Ethereum Sepolia rows stay readable in the projection
    // but are never an agent-selectable network.
    const CHAIN_ID = 84532;
    const PROTOCOL_ID = /^\d{1,78}$/;
    // The projection endpoint pages at 200; a conversational answer needs far
    // fewer, and a smaller payload keeps the agent's context useful.
    const MAX_RESULTS = 20;
    const DEFAULT_RESULTS = 8;
    // A provenance timeline is short by nature, but a work that was resold many
    // times should not flood the agent's context either.
    const MAX_TIMELINE = 25;

    // Two levels, and only two. `read` is every visitor by default; `wallet`
    // lets the agent open the wallet with a transaction the person then
    // approves themselves. There is deliberately no level above this: a level
    // that signs without the person would need a scoped session key on a smart
    // account, which is contract architecture and belongs to a canon amendment,
    // not to a switch in a JavaScript file.
    const PERMISSION_KEY = 'artsoul.agent.permission';
    const PERMISSION_READ = 'read';
    const PERMISSION_WALLET = 'wallet';

    function safeLocalStorage() {
        try {
            return window.localStorage || null;
        } catch {
            return null;
        }
    }

    function normalizeId(value) {
        const id = String(value == null ? '' : value).trim();
        return PROTOCOL_ID.test(id) ? id : '';
    }

    function text(value) {
        return String(value == null ? '' : value).trim();
    }

    function hoursUntil(isoTime, now) {
        const end = Date.parse(text(isoTime));
        if (!Number.isFinite(end)) return null;
        return (end - now) / 3600000;
    }

    /**
     * One artwork, reduced to the fields an agent can actually reason about.
     * The projection returns roughly fifty columns per card; handing all of them
     * to a model wastes its context and invites it to quote internal ids.
     */
    function summarize(card) {
        const artworkId = normalizeId(card.artwork_id);
        return {
            artwork_id: artworkId,
            title: text(card.title) || 'Untitled',
            creator: text(card.creator_name) || text(card.creator),
            status: text(card.status),
            current_bid_eth: text(card.current_bid) || '0',
            start_price_eth: text(card.start_price) || '0',
            canonical_floor_eth: text(card.canonical_floor) || null,
            auction_end_time: card.auction_end_time || null,
            minted: card.minted === true,
            url: artworkId ? `/artwork/${artworkId}` : null
        };
    }

    function matchesQuery(card, query) {
        if (!query) return true;
        const needle = query.toLowerCase();
        return [card.title, card.description, card.creator_name, card.creator]
            .some(field => text(field).toLowerCase().includes(needle));
    }

    function clampLimit(value) {
        const limit = Number(value);
        if (!Number.isFinite(limit)) return DEFAULT_RESULTS;
        return Math.min(Math.max(Math.trunc(limit), 1), MAX_RESULTS);
    }

    /**
     * Build the tool set against injected dependencies so the same definitions
     * can be exercised in tests without a browser.
     */
    function createTools(dependencies) {
        const deps = dependencies || {};
        const fetchJson = deps.fetchJson;
        const openPath = deps.openPath || function () {};
        const now = deps.now || (() => Date.now());
        // The wallet layer is optional. It is present once the page has an
        // initialized provider, and absent for a visitor who never connected.
        const readContracts = deps.readContracts || (() => null);
        // Granting the agent access to the wallet is a human act, so it goes
        // through the browser's own dialog and is remembered per browser.
        const confirmAction = deps.confirmAction ||
            ((message) => (typeof window === 'undefined' ? false : window.confirm(message)));
        const storage = deps.storage || (typeof window === 'undefined' ? null : safeLocalStorage());

        function readPermission() {
            try {
                return (storage && storage.getItem(PERMISSION_KEY)) || PERMISSION_READ;
            } catch {
                // Private windows and blocked site data throw on access. A
                // permission that cannot be read is a permission not granted.
                return PERMISSION_READ;
            }
        }

        function writePermission(level) {
            try {
                if (storage) storage.setItem(PERMISSION_KEY, level);
            } catch {
                // Losing the memory of the grant costs one extra confirmation,
                // which is the safe direction to fail in.
            }
        }

        async function listCards(view) {
            const params = new URLSearchParams({ chain_id: String(CHAIN_ID), limit: '200' });
            if (view) params.set('view', view);
            const payload = await fetchJson(`/api/public/artworks?${params.toString()}`);
            return Array.isArray(payload && payload.data) ? payload.data : [];
        }

        async function lookupCard(artworkId) {
            const payload = await fetchJson(`/api/public/artworks?id=${encodeURIComponent(artworkId)}`);
            const rows = Array.isArray(payload && payload.data) ? payload.data : [];
            return rows[0] || null;
        }

        async function auctionConstants() {
            const contracts = readContracts();
            if (!contracts || typeof contracts.getAuctionConstants !== 'function') return null;
            if (typeof contracts.isReady === 'function' && !contracts.isReady()) return null;
            try {
                return await contracts.getAuctionConstants();
            } catch {
                // A read failure must never turn into invented economics.
                return null;
            }
        }

        const searchArtworks = {
            name: 'search_artworks',
            description:
                'Search published ArtSoul artworks on Base Sepolia by free text, creator or lifecycle status. ' +
                'Returns title, creator, status, current bid and the page URL. Read-only.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Free text matched against title, description and creator.' },
                    creator: { type: 'string', description: 'Creator wallet address or public nickname.' },
                    status: {
                        type: 'string',
                        enum: ['any', 'auction', 'for_sale'],
                        description: 'Restrict to works with a live auction, works listed for resale, or any work.'
                    },
                    limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS }
                }
            },
            execute: async (input) => {
                const args = input || {};
                const status = text(args.status) || 'any';
                const view = status === 'auction' ? 'auctions' : status === 'for_sale' ? 'marketplace' : '';
                const creator = text(args.creator).toLowerCase();
                const query = text(args.query).toLowerCase();
                const cards = await listCards(view);
                const matched = cards.filter(card => {
                    if (creator) {
                        const cardCreator = `${text(card.creator)} ${text(card.creator_name)}`.toLowerCase();
                        if (!cardCreator.includes(creator)) return false;
                    }
                    return matchesQuery(card, query);
                });
                return JSON.stringify({
                    chain: 'Base Sepolia',
                    count: matched.length,
                    results: matched.slice(0, clampLimit(args.limit)).map(summarize)
                });
            }
        };

        const findActiveAuctions = {
            name: 'find_active_auctions',
            description:
                'List ArtSoul auctions that are open for bidding right now, soonest ending first. ' +
                'Use this before discussing a bid so the deadline is current. Read-only.',
            inputSchema: {
                type: 'object',
                properties: {
                    ending_within_hours: {
                        type: 'number',
                        minimum: 0,
                        description: 'Only auctions ending within this many hours.'
                    },
                    limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS }
                }
            },
            execute: async (input) => {
                const args = input || {};
                const at = now();
                const window = Number(args.ending_within_hours);
                const open = (await listCards('auctions'))
                    .map(card => ({ card, remaining: hoursUntil(card.auction_end_time, at) }))
                    .filter(entry => entry.remaining === null || entry.remaining > 0)
                    .filter(entry => !Number.isFinite(window) || entry.remaining === null || entry.remaining <= window)
                    .sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity));
                return JSON.stringify({
                    chain: 'Base Sepolia',
                    count: open.length,
                    auctions: open.slice(0, clampLimit(args.limit)).map(entry => ({
                        ...summarize(entry.card),
                        hours_remaining: entry.remaining === null ? null : Math.round(entry.remaining * 100) / 100
                    }))
                });
            }
        };

        const getAuctionState = {
            name: 'get_auction_state',
            description:
                'Return the live state of one ArtSoul auction: status, current bid, current bidder, bid history, ' +
                'end time and settlement deadline. Read-only.',
            inputSchema: {
                type: 'object',
                properties: {
                    artwork_id: { type: 'string', description: 'The artwork number shown in its page URL.' }
                },
                required: ['artwork_id']
            },
            execute: async (input) => {
                const artworkId = normalizeId((input || {}).artwork_id);
                if (!artworkId) return JSON.stringify({ error: 'artwork_id must be the artwork number from its URL.' });
                const card = await lookupCard(artworkId);
                if (!card) return JSON.stringify({ error: `No published artwork ${artworkId} on Base Sepolia.` });

                const auctionId = normalizeId(card.active_auction_id || card.auction_id);
                let live = null;
                if (auctionId) {
                    const payload = await fetchJson(
                        `/api/public/auction-live?chain_id=${CHAIN_ID}&auction_id=${encodeURIComponent(auctionId)}`
                    );
                    live = (payload && payload.auction) || null;
                }

                const state = live || summarize(card);
                return JSON.stringify({
                    artwork_id: artworkId,
                    title: text(card.title) || 'Untitled',
                    status: text(state.status || card.status),
                    current_bid_eth: text(state.current_bid || card.current_bid) || '0',
                    current_bidder: state.current_bidder || card.current_bidder || null,
                    auction_end_time: state.auction_end_time || card.auction_end_time || null,
                    settlement_deadline: state.settlement_deadline || card.settlement_deadline || null,
                    bid_count: Array.isArray(card.bids) ? card.bids.length : null,
                    url: `/artwork/${artworkId}`
                });
            }
        };

        const getArtworkProvenance = {
            name: 'get_artwork_provenance',
            description:
                'Return ArtSoul provenance for one artwork: Creator, First Collector and current Owner, plus the ' +
                'event timeline rebuilt from indexed Base events. Read-only.',
            inputSchema: {
                type: 'object',
                properties: {
                    artwork_id: { type: 'string', description: 'The artwork number shown in its page URL.' }
                },
                required: ['artwork_id']
            },
            execute: async (input) => {
                const artworkId = normalizeId((input || {}).artwork_id);
                if (!artworkId) return JSON.stringify({ error: 'artwork_id must be the artwork number from its URL.' });
                const payload = await fetchJson(
                    `/api/public/artwork-provenance?chain_id=${CHAIN_ID}&artwork_id=${encodeURIComponent(artworkId)}`
                );
                // The endpoint answers with `roles` and `events`; the raw events
                // carry block numbers and log indexes that mean nothing in a
                // conversation, so only the narratable fields are passed on.
                const roles = (payload && payload.roles) || {};
                const events = Array.isArray(payload && payload.events) ? payload.events : [];
                return JSON.stringify({
                    artwork_id: artworkId,
                    creator: roles.creator_address || null,
                    first_collector: roles.first_collector_address || null,
                    owner: roles.current_owner_address || null,
                    timeline: events.slice(0, MAX_TIMELINE).map(event => ({
                        event: text(event.type),
                        at: event.recorded_at || null,
                        amount_eth: text(event.final_price || event.winning_bid || event.price || event.start_price) || null,
                        transaction_hash: event.transaction_hash || null
                    })),
                    note: 'First Collector is the address that won and settled the primary auction. ' +
                        'It is a permanent public role, not a transferable badge.',
                    url: `/artwork/${artworkId}`
                });
            }
        };

        const explainSettlement = {
            name: 'explain_settlement',
            description:
                'Explain the ArtSoul lifecycle - publish, auction, settlement, lazy mint, floor - and, when an ' +
                'artwork is named, where that specific work currently sits in it. Read-only.',
            inputSchema: {
                type: 'object',
                properties: {
                    artwork_id: { type: 'string', description: 'Optional artwork number to place in the lifecycle.' }
                }
            },
            execute: async (input) => {
                const lifecycle = [
                    'A creator registers the artwork on-chain. No NFT exists yet.',
                    'The creator opens a primary auction. Bids are backed by a deposit.',
                    'If the auction ends with no bid, nothing is minted and the work can be auctioned again.',
                    'If the auction ends with a winner, a settlement window opens.',
                    'Successful settlement lazily mints the NFT to the First Collector and creates the canonical floor.',
                    'If the winner does not settle in time, the deposit is split between creator and protocol treasury and no NFT is minted.',
                    'Later resale preserves Creator, First Collector and current Owner, and pays the creator a royalty.'
                ];
                const payload = {
                    lifecycle,
                    floor_rule: 'The canonical floor is created only by a successful settlement. A listing price never sets it.',
                    exact_figures:
                        'Deposit size, minimum bid increment, auction durations and the settlement window are contract ' +
                        'constants on Base. The auction page and the wallet show the exact figures at signing time.'
                };
                const artworkId = normalizeId((input || {}).artwork_id);
                if (!artworkId) return JSON.stringify(payload);

                const card = await lookupCard(artworkId);
                if (!card) return JSON.stringify({ ...payload, error: `No published artwork ${artworkId} on Base Sepolia.` });
                return JSON.stringify({
                    ...payload,
                    artwork_id: artworkId,
                    title: text(card.title) || 'Untitled',
                    current_status: text(card.status),
                    minted: card.minted === true,
                    url: `/artwork/${artworkId}`
                });
            }
        };

        const prepareBid = {
            name: 'prepare_bid',
            description:
                'Prepare a bid on an ArtSoul auction: report the live state, open the auction page and hand the ' +
                'action to the person. This tool CANNOT place or sign a bid - the person reviews the amount and ' +
                'signs it in their own wallet.',
            inputSchema: {
                type: 'object',
                properties: {
                    artwork_id: { type: 'string', description: 'The artwork number shown in its page URL.' },
                    intended_bid_eth: {
                        type: 'string',
                        description: 'Optional amount in ETH the person is considering, for context only.'
                    }
                },
                required: ['artwork_id']
            },
            execute: async (input) => {
                const args = input || {};
                const artworkId = normalizeId(args.artwork_id);
                if (!artworkId) return JSON.stringify({ error: 'artwork_id must be the artwork number from its URL.' });

                const card = await lookupCard(artworkId);
                if (!card) return JSON.stringify({ error: `No published artwork ${artworkId} on Base Sepolia.` });

                const status = text(card.status);
                if (status !== 'auction') {
                    return JSON.stringify({
                        artwork_id: artworkId,
                        signed_by: 'the person, in their own wallet',
                        prepared: false,
                        reason: `Artwork ${artworkId} is "${status}", so it is not open for bidding.`,
                        url: `/artwork/${artworkId}`
                    });
                }

                const constants = await auctionConstants();
                openPath(`/artwork/${artworkId}`);
                return JSON.stringify({
                    artwork_id: artworkId,
                    title: text(card.title) || 'Untitled',
                    prepared: true,
                    signed_by: 'the person, in their own wallet',
                    current_bid_eth: text(card.current_bid) || '0',
                    start_price_eth: text(card.start_price) || '0',
                    auction_end_time: card.auction_end_time || null,
                    intended_bid_eth: text(args.intended_bid_eth) || null,
                    contract_constants: constants || null,
                    network: 'Base Sepolia (chain 84532)',
                    instruction:
                        'The auction page is now open. The exact minimum next bid and the required deposit are ' +
                        'computed by the contract and shown on the bid control. ArtSoul never signs for the ' +
                        'person: they must review the amount and approve the transaction in their wallet.',
                    url: `/artwork/${artworkId}`
                });
            }
        };

        /**
         * The one tool that reaches the chain. It does not sign: it asks the
         * wallet to ask the person. `ArtSoulContracts.placeBid` already ensures
         * Base Sepolia, computes the required deposit from the contract and
         * opens the wallet, so this tool adds exactly one thing on top - a
         * permission the person grants with their own click, in the page, never
         * through the agent.
         */
        const placeBid = {
            name: 'place_bid',
            description:
                'Open the connected wallet with a bid on an ArtSoul auction, so the person can review and approve ' +
                'it. Requires a connected wallet and a permission the person grants in the page. The agent does ' +
                'not sign: the wallet asks the person to confirm, and the transaction only exists once they do.',
            inputSchema: {
                type: 'object',
                properties: {
                    artwork_id: { type: 'string', description: 'The artwork number shown in its page URL.' },
                    bid_eth: { type: 'string', description: 'The bid amount in ETH the person wants to offer.' }
                },
                required: ['artwork_id', 'bid_eth']
            },
            execute: async (input) => {
                const args = input || {};
                const artworkId = normalizeId(args.artwork_id);
                if (!artworkId) return JSON.stringify({ error: 'artwork_id must be the artwork number from its URL.' });

                const amount = text(args.bid_eth);
                if (!(Number(amount) > 0)) {
                    return JSON.stringify({ submitted: false, reason: 'bid_eth must be a positive amount in ETH.' });
                }

                const contracts = readContracts();
                const walletReady = contracts && typeof contracts.placeBid === 'function' &&
                    (typeof contracts.isReady !== 'function' || contracts.isReady());
                if (!walletReady) {
                    return JSON.stringify({
                        submitted: false,
                        reason: 'No wallet is connected on this page. The person needs to connect a wallet on Base Sepolia first.',
                        url: `/artwork/${artworkId}`
                    });
                }

                const card = await lookupCard(artworkId);
                if (!card) return JSON.stringify({ error: `No published artwork ${artworkId} on Base Sepolia.` });
                const status = text(card.status);
                if (status !== 'auction') {
                    return JSON.stringify({
                        submitted: false,
                        reason: `Artwork ${artworkId} is "${status}", so it is not open for bidding.`,
                        url: `/artwork/${artworkId}`
                    });
                }

                // The permission is granted by a human click in the page. An
                // agent cannot grant it to itself: there is deliberately no tool
                // that raises this level.
                if (readPermission() !== PERMISSION_WALLET) {
                    const granted = confirmAction(
                        `Allow this page's AI agent to open your wallet with bids on ArtSoul?\n\n` +
                        `Next: a bid of ${amount} ETH on artwork ${artworkId}.\n\n` +
                        `Your wallet will still ask you to approve every transaction. ArtSoul never signs for you.`
                    );
                    if (!granted) {
                        return JSON.stringify({
                            submitted: false,
                            reason: 'The person did not grant the agent permission to open the wallet.',
                            url: `/artwork/${artworkId}`
                        });
                    }
                    writePermission(PERMISSION_WALLET);
                }

                try {
                    const transactionHash = await contracts.placeBid(artworkId, amount);
                    return JSON.stringify({
                        submitted: true,
                        approved_by: 'the person, in their own wallet',
                        artwork_id: artworkId,
                        bid_eth: amount,
                        transaction_hash: transactionHash || null,
                        note: 'The wallet asked the person to approve this transaction and they did. ' +
                            'The required deposit was computed by the contract, not by this page.',
                        url: `/artwork/${artworkId}`
                    });
                } catch (error) {
                    // A rejected signature is the ordinary case, not a fault.
                    return JSON.stringify({
                        submitted: false,
                        artwork_id: artworkId,
                        bid_eth: amount,
                        reason: (error && error.message) || 'The wallet did not complete the transaction.',
                        url: `/artwork/${artworkId}`
                    });
                }
            }
        };

        const prepareArtworkRegistration = {
            name: 'prepare_artwork_registration',
            description:
                'Prepare publishing a new artwork on ArtSoul: validate the details, open the publish page and hand ' +
                'the action to the person. This tool CANNOT upload a file or sign a registration - the person ' +
                'attaches the media and signs in their own wallet.',
            inputSchema: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: 'Artwork title.' },
                    description: { type: 'string', description: 'Short description of the work.' }
                },
                required: ['title']
            },
            execute: async (input) => {
                const args = input || {};
                const title = text(args.title);
                if (!title) {
                    return JSON.stringify({ prepared: false, error: 'A title is required to publish an artwork.' });
                }
                openPath('/upload');
                return JSON.stringify({
                    prepared: true,
                    signed_by: 'the person, in their own wallet',
                    title,
                    description: text(args.description) || null,
                    network: 'Base Sepolia (chain 84532)',
                    instruction:
                        'The publish page is now open. The person attaches the media file, confirms the details and ' +
                        'signs the registration in their wallet. Registration publishes the work for discovery; it ' +
                        'does not mint an NFT. An NFT exists only after a primary auction settles successfully.',
                    url: '/upload'
                });
            }
        };

        return [
            searchArtworks,
            findActiveAuctions,
            getAuctionState,
            getArtworkProvenance,
            explainSettlement,
            prepareBid,
            placeBid,
            prepareArtworkRegistration
        ];
    }

    /**
     * Register every tool against a model context. Registration is per tool, so
     * one unsupported descriptor must not cost the rest.
     */
    async function register(modelContext, tools, options) {
        if (!modelContext || typeof modelContext.registerTool !== 'function') return [];
        const registered = [];
        for (const tool of tools) {
            try {
                await modelContext.registerTool(tool, options);
                registered.push(tool.name);
            } catch (error) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(`[ArtSoul WebMCP] ${tool.name} was not registered:`, error);
                }
            }
        }
        return registered;
    }

    function modelContextOf(doc, nav) {
        // The imperative API is documented on `document`; earlier explainers and
        // some builds expose the same shape on `navigator`. Accept either rather
        // than being silently absent in one of them.
        return (doc && doc.modelContext) || (nav && nav.modelContext) || null;
    }

    // Permission accessors for a future in-page toggle. Reading and revoking
    // are exposed; granting stays where it belongs, behind the person's click
    // in the confirmation dialog.
    function permissionLevel() {
        try {
            return (safeLocalStorage() || { getItem: () => null }).getItem(PERMISSION_KEY) || PERMISSION_READ;
        } catch {
            return PERMISSION_READ;
        }
    }

    function revokePermission() {
        try {
            const store = safeLocalStorage();
            if (store) store.removeItem(PERMISSION_KEY);
        } catch {
            // Nothing to do: an unreadable store already denies the permission.
        }
    }

    window.ArtSoulWebMCP = Object.freeze({
        createTools,
        register,
        modelContextOf,
        permissionLevel,
        revokePermission,
        PERMISSION_READ,
        PERMISSION_WALLET,
        CHAIN_ID
    });

    const context = modelContextOf(
        typeof document === 'undefined' ? null : document,
        typeof navigator === 'undefined' ? null : navigator
    );
    if (!context) return;

    const bootstrap = async () => {
        const tools = createTools({
            fetchJson: async (path) => {
                const response = await fetch(path, { headers: { Accept: 'application/json' } });
                if (!response.ok) throw new Error(`ArtSoul request failed: ${response.status}`);
                return response.json();
            },
            openPath: (path) => window.location.assign(path),
            readContracts: () => window.ArtSoulContracts || null
        });
        await register(context, tools);
    };

    // Registration waits for idle time: an agent asks for tools conversationally,
    // never during first paint, and the load budget on this site is already tight.
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(bootstrap, { timeout: 3000 });
    } else {
        window.setTimeout(bootstrap, 0);
    }
})();
