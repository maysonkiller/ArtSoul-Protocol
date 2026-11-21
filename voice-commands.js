/**
 * ArtSoul text and voice commands (B-09 / B-21).
 *
 * The founder's decision, 2026-09-15: voice works the same way the agent tools
 * do, and extends with them. So this file adds no abilities of its own. It turns
 * a spoken sentence into one of the tools `webmcp-tools.js` already declares,
 * runs that tool, and says the answer. Anything the agent cannot do, voice cannot
 * do; anything the agent refuses, voice refuses the same way, through the same
 * gate.
 *
 * What it costs and where the audio goes:
 *
 * - SpeechRecognition transcribes through the browser. Fixed replies use
 *   reviewed static recordings; other replies use native speechSynthesis.
 *   Recording generation is an offline operation, not a user request. Playback
 *   makes no AI API call and exposes no key or user content to an AI provider.
 * - The browser may use an online recognition service for each spoken turn.
 *   The person is told that before the microphone first opens.
 * - Text commands remain available without speech recognition. Opening the
 *   panel never starts the microphone. Typed replies are silent unless the
 *   person presses Listen to answer.
 *
 * What keeps a misheard sentence from costing money:
 *
 * 1. A click starts one sentence or a voice chat. In voice chat the next turn
 *    begins after playback ends. Hiding the tab ends either mode.
 * 2. What was heard is shown before anything runs.
 * 3. A command that opens the wallet does not run when the recogniser itself
 *    reports low confidence; the person is asked to repeat it.
 * 4. Every wallet command then passes the tool layer's gate: a page dialog naming
 *    the work and the figure for anything carrying an amount, one wallet action
 *    at a time, and the wallet's own approval. Voice adds checks; it removes none.
 */
(function () {
    'use strict';

    // Existing language preferences select command recognition only.
    const LANG_KEY = 'artsoul.voice.lang';
    // Older clients could persist consent before an asynchronous dialog resolved.
    const NOTICE_KEY = 'artsoul.voice.notice.v2';
    const NAVIGATION_KEY = 'artsoul.voice.next-page';
    const NAVIGATION_TTL = 30000;
    // SpeechRecognition reports 0..1. Below this a wallet command is not run.
    // Some engines report 0 when they do not measure it at all; that is treated
    // as unknown, and the tool gate still applies.
    const WRITE_CONFIDENCE = 0.6;

    const WRITE_TOOLS = Object.freeze([
        'place_bid',
        'end_expired_auction',
        'complete_settlement',
        'close_expired_settlement',
        'start_auction',
        'list_for_resale',
        'change_resale_price',
        'cancel_resale_listing',
        'buy_resale_listing',
        'withdraw_pending_funds'
    ]);
    const SAVED_TOOLS = ['add_to_saved', 'remove_from_saved'];
    const REVIEW_TOOLS = ['prepare_donation', 'prepare_artwork_report'];
    const DRAFT_TOOL = 'prepare_artwork_registration';
    // A new tool requires a deliberate Send until its voice-chat effects are reviewed.
    const CHAT_TOOLS = new Set(['search_catalog', 'find_active_auctions', 'get_auction_state',
        'get_artwork_provenance', 'get_artwork', 'get_my_activity', 'open_artwork', 'open_page',
        'explain_settlement', 'prepare_bid', DRAFT_TOOL, 'revise_publication_draft']);

    // Recognisers write numbers as digits: "31", "0.05", and in Russian "0,05".
    const AMOUNT = '(\\d+(?:[.,]\\d{1,18})?)';
    const ID = '#?\\s*(\\d{1,78})';
    const EN_WORK = '(?:artwork|work|number|no\\.?)?\\s*';
    const RU_WORK = '(?:работ[а-я]*|артворк[а-я]*|номер)?\\s*';

    const amount = value => String(value).replace(',', '.');

    /**
     * Ordered: the most specific sentence wins. Wallet commands come before the
     * reads they could be mistaken for, and every wallet command must name its
     * work, so "buy" alone never guesses which one.
     */
    const GRAMMAR = [
        // --- English ---------------------------------------------------------
        ['en', /^let['’]?s create (?:art|(?:an )?artwork)$/, () => ({ tool: 'open_page', input: { page: 'create' } })],
        ['en', new RegExp(`^(?:please\\s+)?(?:donate\\s+to|open\\s+donate\\s+for)\\s+${EN_WORK}${ID}$`), m => ({ tool: 'prepare_donation', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`^(?:please\\s+)?(?:report|open\\s+report\\s+for)\\s+${EN_WORK}${ID}$`), m => ({ tool: 'prepare_artwork_report', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`^(?:please\\s+)?save\\s+${EN_WORK}${ID}(?:\\s+to\\s+(?:my\\s+)?(?:saved|favou?rites))?$`), m => ({ tool: 'add_to_saved', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`^(?:please\\s+)?add\\s+${EN_WORK}${ID}\\s+to\\s+(?:my\\s+)?(?:saved|favou?rites)$`), m => ({ tool: 'add_to_saved', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`^(?:please\\s+)?remove\\s+${EN_WORK}${ID}\\s+from\\s+(?:my\\s+)?(?:saved|favou?rites)$`), m => ({ tool: 'remove_from_saved', input: { artwork_id: m[1] } })],
        ['en', /^(help|commands|what can (i|you) (say|do))\b/, () => ({ help: true })],
        ['en', /\b(stop|revoke|forget)\b.*\bwallet\b|\bdon'?t (touch|use) my wallet\b|^stop$/, () => ({ tool: 'revoke_wallet_access', input: {} })],
        ['en', new RegExp(`\\bbid\\s+(?:of\\s+)?${AMOUNT}(?:\\s*eth)?\\s+on\\s+${EN_WORK}${ID}`), m => ({ tool: 'place_bid', input: { artwork_id: m[2], bid_eth: amount(m[1]) } })],
        ['en', new RegExp(`\\bstart\\s+(?:an\\s+)?auction\\s+(?:on|for)\\s+${EN_WORK}${ID}\\s+(?:at|from|starting at)\\s+${AMOUNT}(?:\\s*eth)?\\s+for\\s+(\\d{1,3})\\s*hours?`),
            m => ({ tool: 'start_auction', input: { artwork_id: m[1], start_price_eth: amount(m[2]), duration_hours: Number(m[3]) } })],
        ['en', new RegExp(`\\b(?:list|sell)\\s+${EN_WORK}${ID}\\s+(?:for|at)\\s+${AMOUNT}`), m => ({ tool: 'list_for_resale', input: { artwork_id: m[1], price_eth: amount(m[2]) } })],
        ['en', new RegExp(`\\bchange\\s+(?:the\\s+)?price\\s+(?:of|for)\\s+${EN_WORK}${ID}\\s+to\\s+${AMOUNT}(?:\\s*eth)?`), m => ({ tool: 'change_resale_price', input: { artwork_id: m[1], price_eth: amount(m[2]) } })],
        ['en', new RegExp(`\\bremove\\s+${EN_WORK}${ID}\\s+from\\s+sale`), m => ({ tool: 'cancel_resale_listing', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`\\bbuy\\s+${EN_WORK}${ID}(?:\\s+for\\s+${AMOUNT})?`),
            m => ({ tool: 'buy_resale_listing', input: m[2] ? { artwork_id: m[1], expected_price_eth: amount(m[2]) } : { artwork_id: m[1] } })],
        ['en', new RegExp(`\\bclose\\s+(?:the\\s+)?(?:expired\\s+)?settlement\\s+(?:on\\s+|for\\s+)?${EN_WORK}${ID}`), m => ({ tool: 'close_expired_settlement', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`\\b(?:pay|settle)\\s+(?:for\\s+)?${EN_WORK}${ID}`), m => ({ tool: 'complete_settlement', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`\\b(?:end|finali[sz]e)\\s+(?:the\\s+)?(?:expired\\s+)?auction\\s+(?:on\\s+|for\\s+)?${EN_WORK}${ID}`), m => ({ tool: 'end_expired_auction', input: { artwork_id: m[1] } })],
        ['en', /\bwithdraw(?: my (?:money|funds))?/, () => ({ tool: 'withdraw_pending_funds', input: {} })],
        ['en', /\b(my (activity|profile|account|works|nfts)|what do i (have|own)|what needs me)\b/, () => ({ tool: 'get_my_activity', input: {} })],
        ['en', new RegExp(`\\b(?:who (?:owns|created|collected)|provenance|first collector|owner)\\b.*?${ID}`), m => ({ tool: 'get_artwork_provenance', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`\\b(?:status|state|current bid)\\b.*?${ID}`), m => ({ tool: 'get_auction_state', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`\\b(?:open|show)\\s+(?:me\\s+)?${EN_WORK}${ID}`), m => ({ tool: 'open_artwork', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`\\b(?:tell me about|about|details|info)\\b.*?${ID}`), m => ({ tool: 'get_artwork', input: { artwork_id: m[1] } })],
        ['en', /\bauctions?\b/, () => ({ tool: 'find_active_auctions', input: {} })],

        // --- Russian ---------------------------------------------------------
        ['ru', /^давай создадим (?:искусство|работу|произведение)$/, () => ({ tool: 'open_page', input: { page: 'create' } })],
        ['ru', new RegExp(`^(?:пожалуйста,?\\s+)?(?:донат\\s+автору|открой\\s+донат\\s+для)\\s+${RU_WORK}${ID}$`), m => ({ tool: 'prepare_donation', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`^(?:пожалуйста,?\\s+)?(?:пожаловаться\\s+на|открой\\s+жалобу\\s+на)\\s+${RU_WORK}${ID}$`), m => ({ tool: 'prepare_artwork_report', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`^(?:пожалуйста,?\\s+)?(?:сохрани|добавь)\\s+${RU_WORK}${ID}\\s+в\\s+избранное$`), m => ({ tool: 'add_to_saved', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`^(?:пожалуйста,?\\s+)?(?:убери|удали)\\s+${RU_WORK}${ID}\\s+из\\s+избранного$`), m => ({ tool: 'remove_from_saved', input: { artwork_id: m[1] } })],
        ['ru', /^(помощь|команды|что (можно|ты умеешь))/, () => ({ help: true })],
        ['ru', /(стоп|отключи|не трогай|забудь).*кош[её]л|^стоп$/, () => ({ tool: 'revoke_wallet_access', input: {} })],
        ['ru', new RegExp(`(?:ставк[а-я]*|поставь)\\s+${AMOUNT}(?:\\s*eth|\\s*эфир[а-я]*)?\\s+на\\s+${RU_WORK}${ID}`), m => ({ tool: 'place_bid', input: { artwork_id: m[2], bid_eth: amount(m[1]) } })],
        ['ru', new RegExp(`(?:запусти|начни|создай)\\s+аукцион\\s+(?:на\\s+|для\\s+)?${RU_WORK}${ID}\\s+(?:за|от|по)\\s+${AMOUNT}(?:\\s*eth|\\s*эфир[а-я]*)?\\s+на\\s+(\\d{1,3})\\s*час(?:а|ов)?`),
            m => ({ tool: 'start_auction', input: { artwork_id: m[1], start_price_eth: amount(m[2]), duration_hours: Number(m[3]) } })],
        ['ru', new RegExp(`(?:выстав[а-я]*|продай)\\s+${RU_WORK}${ID}\\s+(?:на\\s+продажу\\s+)?(?:за|по)\\s+${AMOUNT}`), m => ({ tool: 'list_for_resale', input: { artwork_id: m[1], price_eth: amount(m[2]) } })],
        ['ru', new RegExp(`(?:измени|поменяй)\\s+цену\\s+${RU_WORK}${ID}\\s+на\\s+${AMOUNT}(?:\\s*(?:eth|эфира?))?`), m => ({ tool: 'change_resale_price', input: { artwork_id: m[1], price_eth: amount(m[2]) } })],
        ['ru', new RegExp(`(?:сними|убери)\\s+${RU_WORK}${ID}\\s+с\\s+продажи`), m => ({ tool: 'cancel_resale_listing', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:купи|купить)\\s+${RU_WORK}${ID}(?:\\s+за\\s+${AMOUNT})?`),
            m => ({ tool: 'buy_resale_listing', input: m[2] ? { artwork_id: m[1], expected_price_eth: amount(m[2]) } : { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:закрой|закрыть)\\s+(?:расч[её]т|сделку)\\s+(?:по\\s+|за\\s+)?${RU_WORK}${ID}`), m => ({ tool: 'close_expired_settlement', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:оплати|оплатить|заплати)\\s+(?:за\\s+)?${RU_WORK}${ID}`), m => ({ tool: 'complete_settlement', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:заверши|завершить|закончи)\\s+аукцион\\s+(?:по\\s+|на\\s+)?${RU_WORK}${ID}`), m => ({ tool: 'end_expired_auction', input: { artwork_id: m[1] } })],
        ['ru', /(выведи|вывести|вывод)\s*(деньги|средства)?/, () => ({ tool: 'withdraw_pending_funds', input: {} })],
        ['ru', /(мой профиль|мои (работы|nft|нфт)|что у меня|моя активность|мой аккаунт)/, () => ({ tool: 'get_my_activity', input: {} })],
        ['ru', new RegExp(`(?:кто (?:владе|созда)|провенанс|первый коллекционер|владел)[а-я]*.*?${ID}`), m => ({ tool: 'get_artwork_provenance', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:статус|состояние|текущая ставка).*?${ID}`), m => ({ tool: 'get_auction_state', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:открой|покажи)\\s+${RU_WORK}${ID}`), m => ({ tool: 'open_artwork', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`(?:расскажи|инфо|подробн)[а-я]*.*?${ID}`), m => ({ tool: 'get_artwork', input: { artwork_id: m[1] } })],
        ['ru', /аукцион/, () => ({ tool: 'find_active_auctions', input: {} })],
    ];

    const NAVIGATION_PAGES = [
        ['nfts', /^(?:nft (?:gallery|catalog)|(?:gallery|catalog) of nfts|(?:галере[яиюе]|каталог) nft|nft (?:в галерее|галерея)|все nft|all nfts)$/u],
        ['marketplace', /^(?:(?:nft )?(?:marketplace|market|маркетплейс[еа]?|рынок)|(?:маркетплейс[еа]?|рынок) nft|nfts? (?:for sale|на (?:продажу|маркетплейсе)))$/u],
        ['walletNfts', /^(?:(?:my )?wallet nfts?|nfts? (?:in|from) (?:my |the )?wallet|(?:мои )?nft (?:из|в) (?:моего |моем )?кошельк[ае]|nft (?:моего )?кошелька|(?:мои )?сторонние nft)$/u],
        ['collected', /^(?:(?:my (?:nft )?|collected (?:artsoul )?)collection|(?:my )?collected(?: (?:artsoul )?nfts?)?|(?:мою|моя|моей) коллекци[яию](?: (?:nft|artsoul))?|мои nft (?:artsoul|в профиле)|my (?:artsoul|profile) nfts?)$/u],
        ['collections', /^(?:collections|коллекции|коллекциях)$/u],
        ['auctions', /^(?:auctions|аукционы|аукционам|аукционах)$/u],
        ['gallery', /^(?:(?:(?:мою|моя) )?галере[яиюе]|(?:my )?(?:gallery|explore)|discovery)$/u],
        ['home', /^(?:главн(?:ая|ую)(?: страниц[ау])?|домой|home(?: ?page)?)$/u],
        ['profile', /^(?:(?:(?:мой|моему) )?профил[ьюе]|(?:my )?profile)$/u],
        ['create', /^(?:создание(?: работы| искусства)?|публикаци[юя](?: работы)?|загрузк[ау](?: работы)?|(?:create|publish|upload)(?: (?:an? )?artwork| page)?)$/u],
        ['guide', /^(?:руководств[оу]|документаци[юия]|инструкци[июя]|справк[ау]|guide|docs|documentation|how it works)$/u]
    ];

    function parseNavigationTurn(transcript, lang, pendingNft = false) {
        if (typeof transcript !== 'string' || transcript.length > 300) return null;
        const ru = lang === 'ru';
        const text = transcript.toLowerCase().trim().replace(/ё/g, 'е')
            .replace(/[?!.]+$/u, '').replace(/\s+/gu, ' ')
            .replace(/(?:н[ -]?ф[ -]?т|эн[ -]?эф[ -]?ти|н[ -]?эф[ -]?ти|n[ .-]+f[ .-]+t)(?![\p{L}\p{N}_])/gu, 'nft')
            .replace(/^(?:пожалуйста|please)[ ,]+|[, ]+(?:пожалуйста|please)$/gu, '').trim();
        const words = pendingNft ? text.replace(/^(?:нет|точнее|лучше|no|actually|rather)[, ]+/u, '') : text;
        const request = ru
            ? /^(?:(?:давай(?:те)?|можешь|можете) )?(?:откроем|открой(?:те)?|открыть|покажи(?:те)?|показать|перейди(?:те)?|перейдем|переключись|перейти|(?:я )?хочу (?:открыть|посмотреть|перейти)|(?:я )?хочу(?= (?:в|на) )|можно (?:открыть|посмотреть))[, ]+(?:мне[, ]+)?(?:пожалуйста[, ]+)?/u
            : /^(?:(?:(?:can|could|would) you|let['’]?s|i (?:want|would like) to) )?(?:open|show(?: me)?|go to|take me to|switch to|browse|view) (?:please )?/u;
        const prefix = request.exec(words);
        if (!prefix && !pendingNft) return null;
        const target = words.slice(prefix?.[0].length || 0)
            .replace(/^(?:on|to|in|from|в|на|из|к) /u, '')
            .replace(/^(?:the|a|an) /u, '')
            .replace(/^(?:вкладк[ауе]|раздел|страниц[ауе]|tab) /u, '')
            .replace(/ (?:tab|вкладку)$/u, '');
        const open = page => ({ tool: 'open_page', input: { page } });
        if (pendingNft && /^(?:нет|отмена|не надо|отмени|no|cancel|never mind|nevermind)$/u.test(text)) {
            return { message: 'Okay. What would you like to open?' };
        }
        if (pendingNft && /^(?:да|ага|хочу|yes|yeah|sure)$/u.test(text)) {
            return { nftPrompt: true, message: 'Which section or artwork number?' };
        }
        const id = /^(?:(?:nfts?|artwork|work|работ[ауеы]|артворк)\s*)?(?:(?:номер|number|no\.?|№|#)\s*)?([1-9]\d{0,77})$/u.exec(target);
        if (id && BigInt(id[1]) < 2n ** 256n) return { tool: 'open_artwork', input: { artwork_id: id[1] } };

        if (pendingNft && /^(?:gallery|галере[яюе]|каталог|все|all)$/u.test(target)) return open('nfts');
        if (pendingNft && /^(?:(?:my )?wallet|(?:мой |моем |моего )?кошел(?:ек|ьк[ае]))$/u.test(target)) return open('walletNfts');
        if (pendingNft && /^(?:mine|my profile|profile|(?:my )?collection|мои|(?:моем |мой )?профил[ье]|(?:моей |мою )?коллекци[июя])$/u.test(target)) return open('collected');
        if (/^nfts? (?:в (?:моем )?профиле|in (?:my |the )?profile)$/u.test(target)) return open('collected');
        if (/^(?:(?:мои |мой |какой-нибудь |любой |my |any )?nfts?)$/u.test(target)) {
            return { nftPrompt: true, message: 'Where should I open NFTs — the gallery, marketplace, your collection or your wallet? You can also say an ArtSoul artwork number.' };
        }
        const page = NAVIGATION_PAGES.find(([, names]) => names.test(target));
        if (page) return open(page[0]);

        // A compound NFT navigation request must never pass a trailing action to
        // a different command. Unrelated turns still reach the usual parser.
        if (prefix && /^(?:мои |мой |my )?(?:nfts?|marketplace|маркетплейс)(?![\p{L}\p{N}_])/u.test(target)) {
            return { message: 'Name one section or one ArtSoul artwork number.' };
        }
        return null;
    }

    /** A spoken sentence to one tool call, or null when nothing matched. */
    function parseCommand(transcript, lang, pendingNft = false) {
        const normalized = String(transcript == null ? '' : transcript).replace(/\s+/g, ' ').trim();
        const heard = normalized
            .toLowerCase()
            .replace(/[?!.]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!heard || heard.length > 300) return null;
        const language = lang === 'ru' ? 'ru' : 'en';
        // A search term is data, even when it contains a wallet command.
        const search = language === 'ru' ? /^(?:найди|поиск|ищи)(?:\s+(.*))?$/i.exec(normalized)
            : /^(?:search(?: for)?|find|look for)(?:\s+(.*))?$/i.exec(normalized);
        if (search) {
            if (!search[1]) return { searchPrompt: true };
            const scoped = language === 'ru' ? /^(?:(?:в|по)\s+)?(автора|художника|профили|работы|аукционы|документацию|документации|документация|документы|страницу|страницы|страницах)\s+(.+)$/i.exec(search[1])
                : /^(?:in\s+)?(artists|profiles|artworks|auctions|docs|documentation|pages|page)\s+(.+)$/i.exec(search[1]);
            if (!scoped) return { tool: 'search_catalog', input: { query: search[1] } };
            const kind = scoped[1].toLowerCase();
            const category = ['artworks', 'работы'].includes(kind) ? 'artworks' : ['auctions', 'аукционы'].includes(kind) ? 'auctions'
                : ['docs', 'documentation', 'документацию', 'документации', 'документация', 'документы'].includes(kind) ? 'docs'
                : ['pages', 'page', 'страницу', 'страницы', 'страницах'].includes(kind) ? 'pages' : 'artists';
            return { tool: 'search_catalog', input: { query: scoped[2], category } };
        }
        // Everything after the explicit title delimiter is artwork text, not a
        // second command. Preserve its case just as global search preserves data.
        const draft = language === 'ru' ? /^подготовь работу с названием\s+(.+)$/i.exec(normalized)
            : /^prepare artwork titled\s+(.+)$/i.exec(normalized);
        if (draft) return { tool: DRAFT_TOOL, input: { title: draft[1] } };
        if (language === 'ru' ? /^(?:подготовь работу|подготовь публикацию)$/i.test(normalized)
            : /^(?:prepare artwork|prepare publication)$/i.test(normalized)) return { publicationPrompt: true };
        const navigation = parseNavigationTurn(normalized, language, pendingNft);
        if (navigation) return navigation;
        // Well-formed NFT navigation was consumed above. Do not extract a
        // separate tool from a quoted, negated or compound NFT request.
        if (/(?:nfts?|н[ -]?ф[ -]?т|эн[ -]?эф[ -]?ти|маркетплейс|marketplace)/u.test(heard) &&
            /(?:откр|покаж|переключ|перей|\b(?:open|show|switch|browse|go to|take me to)\b)/u.test(heard)) return null;
        // Do not fall back to a different action extracted from a malformed or
        // combined donation/report request. Search terms above remain data.
        const reviewIntent = language === 'ru' ? /донат|пожертв|жалоб|пожаловаться/.test(heard) : /\b(?:donat\w*|report\w*|complaint\w*)\b/.test(heard);
        // A malformed page request must not fall through to an action in its tail.
        const pageIntent = language === 'ru'
            ? /(?:давай создадим|(?:открой|открыть|открывай|покажи|перейди в|перейди на)\s+(?:(?:мой|мою)\s+)?(?:галерею|коллекцию|главную|профиль|создание|публикацию|загрузку|руководство|документацию|инструкцию))(?![\p{L}\p{N}_])/u.test(heard)
            : /\b(?:let['’]?s create|(?:open|show|go to)\s+(?:the\s+|my\s+)?(?:gallery|explore|(?:nft\s+)?collection|home|homepage|profile|create|upload|publish|guide|docs|documentation|how it works))\b/.test(heard);
        for (const [ruleLang, pattern, build] of GRAMMAR) {
            if (ruleLang !== language) continue;
            const match = pattern.exec(heard);
            if (!match) continue;
            const command = build(match);
            if (command.tool === 'open_artwork' && (match.index !== 0 || match[0].length !== heard.length)) continue;
            if (pageIntent && command.tool !== 'open_page') continue;
            if (reviewIntent && !REVIEW_TOOLS.includes(command.tool)) continue;
            if ([...SAVED_TOOLS, ...REVIEW_TOOLS].includes(command.tool) && (/\?/.test(transcript) || !/^[1-9][0-9]{0,77}$/.test(command.input.artwork_id) || BigInt(command.input.artwork_id) >= 2n ** 256n)) return null;
            if (isWrite(command)) {
                // Never execute a financial phrase extracted from a negation,
                // question, multiple requests, truncated number or quoted text.
                if (/\?/.test(normalized)) return null;
                const prefix = heard.slice(0, match.index).trim();
                const allowedPrefix = language === 'ru' ? /^(?:пожалуйста,?\s*)?(?:поставь\s*)?$/
                    : /^(?:please\s*)?(?:place a\s*)?$/;
                if (!allowedPrefix.test(prefix) || match.index + match[0].length !== heard.length) return null;
            }
            return command;
        }
        return null;
    }

    function isWrite(command) {
        return Boolean(command && command.tool && WRITE_TOOLS.includes(command.tool));
    }

    /** Whether a heard command may run, given the recogniser's own confidence. */
    function mayRun(command, confidence) {
        if (!isWrite(command) && !SAVED_TOOLS.includes(command?.tool) && !REVIEW_TOOLS.includes(command?.tool) && command?.tool !== DRAFT_TOOL) return true;
        const value = Number(confidence);
        return !(Number.isFinite(value) && value > 0 && value < WRITE_CONFIDENCE);
    }

    const TEXT = {
        title: 'ArtSoul commands',
        hint: 'Choose the language you speak. Verified recordings are in English and Russian; other answers remain text. Wallet actions need your review and signature.',
        input: 'Your command', placeholder: 'Open gallery, search moon…',
        send: 'Send', microphone: 'Use microphone', stop: 'Stop listening',
        conversation: 'Start voice chat', endConversation: 'End voice chat',
        conversationHint: 'Voice chat continues after each answer and on pages you ask me to open in this tab. Your browser may send each turn to its speech service.',
        resumeMic: 'Page opened. Tap Start voice chat to continue, or type your next request.',
        arrival: 'Page opened. Listening for your next request.',
        navigationWait: 'Navigation is taking longer than expected. Voice chat is paused.',
        reviewCommand: 'Voice chat paused. Check the command and press Send to review this action.',
        listenReply: 'Listen to answer', stopReply: 'Stop audio',
        audioUnavailable: 'Audio could not play in this browser. The answer is available as text.',
        audioBlocked: 'Tap Listen to answer to play the audio.',
        audioNotice: 'AI-generated voice.',
        helpSpeech: 'You can open the gallery, find artwork, or ask about your activity. The examples below show the available commands. Wallet actions always need your review and signature.',
        close: 'Close commands', examples: 'Examples',
        noSpeech: 'Voice is unavailable in this browser. You can type instead.',
        working: 'Working… If your wallet opens, review the request there. Closing this panel does not cancel a submitted transaction.',
        empty: 'Enter a command first.', changed: 'Wallet changed. Enter a new command for this account.',
        searchPrompt: 'What would you like to find? Try "search moon", "find artists Vera" or "search docs fees".',
        publicationPrompt: 'What is the title? Try "prepare artwork titled Moonlight". You will review the draft on Publish; nothing is uploaded or signed.',
        tooLong: 'Use one command of up to 300 characters.',
        listening: 'Listening… say one command.',
        notHeard: 'Nothing was heard. Press the microphone and try again.',
        options: 'You can open the gallery, find artwork, or ask about your activity.',
        askSearch: 'What would you like to find?', askTitle: 'What is the title?',
        otherRequest: 'Try “open NFTs”, “search moon”, or “my activity”.',
        unsure: heard => `I am not sure I heard "${heard}" correctly. Please repeat the action.`,
        heard: heard => `Heard: "${heard}"`,
        unavailable: 'Commands are not available on this page.',
        notice: 'Your browser may send microphone audio to its speech service for transcription. ArtSoul receives no microphone audio.\n\nTurn on the microphone?',
        micBlocked: 'The microphone is blocked for this site. Allow it in the browser settings to use voice.',
        help: 'Try: "open gallery", "open NFTs", "open home", "open my profile", "open create", "open guide", "search moon", "find artists Vera", "find auctions moon", "search docs fees", "find pages gallery", "save artwork 31", "remove artwork 31 from favorites", "what auctions are open", "tell me about artwork 31", "who owns artwork 19", "my activity", ' +
            '"prepare artwork titled Moonlight", "donate to artwork 31", "report artwork 31" (opens a review form; sends nothing), ' +
            '"bid 0.05 on artwork 31", "pay for artwork 30", "list artwork 19 for 0.002", "buy artwork 19", ' +
            '"change price of artwork 19 to 0.003", "remove artwork 19 from sale", ' +
            '"start an auction on artwork 31 at 0.005 for 36 hours", "withdraw", "stop using my wallet".',
        submitted: 'Done. The wallet approved it and the transaction was sent.',
        settled: 'Settlement confirmed. The NFT is yours. Artwork details are updating.',
        next: 'What would you like to do next?',
        refused: reason => `Not done. ${reason}`,
        noWallet: 'No wallet is connected. Connect one first.',
        error: message => `That did not work: ${message}`
    };

    // Previously recorded with the same API voice as the English responses.
    const RU_FIXED = Object.freeze({
      "helpSpeech": "Можно открыть галерею, найти работу или узнать о своей активности. Доступные команды показаны в примерах ниже. Действия с кошельком всегда требуют вашей проверки и подписи.",
      "searchPrompt": "Что найти? Например: «найди луна», «найди автора Vera» или «найди в документации fees».",
      "publicationPrompt": "Как назвать работу? Например: «подготовь работу с названием Лунный свет». На Publish вы проверите черновик; файл не загружается, подпись не запрашивается.",
      "tooLong": "Введите одну команду длиной до 300 символов.",
      "empty": "Сначала введите команду.",
      "unavailable": "Команды недоступны на этой странице.",
      "noWallet": "Кошелёк не подключён. Сначала подключите его.",
      "submitted": "Готово. Кошелёк подтвердил, транзакция отправлена.",
      "settled": "Расчёт подтверждён. NFT теперь ваша. Данные работы обновляются."
    });
    // Russian interface for the RU microphone; missing marin WAVs remain text-only.
    const RU_UI = Object.freeze({
        title:'Команды ArtSoul',
        hint:'RU — распознавание русской речи. Голос marin доступен только для записанных фраз; остальные ответы показываются текстом. Кошелёк требует личного подтверждения.',
        input:'Ваша команда',placeholder:'Открой NFT, покажи аукционы…',
        send:'Отправить',microphone:'Микрофон',stop:'Остановить',
        conversation:'Начать голосовой диалог',endConversation:'Завершить диалог',
        conversationHint:'Если озвучка ответа ещё не записана, прочитайте текст и нажмите микрофон снова.',
        resumeMic:'Страница открыта. Нажмите «Начать голосовой диалог», чтобы продолжить.',
        arrival:'Страница открыта. Слушаю следующий запрос.',
        navigationWait:'Переход затянулся. Голосовой диалог приостановлен.',
        reviewCommand:'Проверьте действие и нажмите «Отправить».',
        listenReply:'Прослушать ответ',stopReply:'Остановить звук',
        audioUnavailable:'Ответ доступен текстом: отдельной записи marin для этой фразы пока нет.',
        audioBlocked:'Браузер заблокировал воспроизведение. Нажмите «Прослушать ответ».',
        audioNotice:'Записанный голос marin.',
        close:'Закрыть команды',examples:'Примеры',
        noSpeech:'Микрофон недоступен. Используйте текстовое поле.',
        working:'Выполняю запрос… Проверьте любые действия с кошельком самостоятельно.',
        empty:'Сначала введите команду.',changed:'Кошелёк изменился. Введите новую команду.',
        tooLong:'Введите одну команду длиной до 300 символов.',
        listening:'Слушаю… произнесите одну команду.',
        notHeard:'Речь не распознана. Проверьте микрофон и попробуйте ещё раз.',
        options:'Можно открыть NFT, найти работу или посмотреть аукционы.',
        askSearch:'Что найти?',askTitle:'Как назвать работу?',
        otherRequest:'Попробуйте «открой NFT», «найди луна» или «моя активность».',
        unavailable:'Команды недоступны на этой странице.',
        micBlocked:'Разрешите использование микрофона в настройках браузера.',
        notice:'Браузер может отправлять звук микрофона в службу распознавания речи. ArtSoul не получает исходный звук.\n\nРазрешить микрофон?',
        help:'Попробуйте: «открой NFT», «открой мои NFT», «открой NFT в кошельке», «открой маркетплейс», «покажи аукционы», «найди луна», «расскажи про работу 31», «моя активность», «помощь».'
    });
    const RU_HELP = 'Могу найти работы, показать открытые аукционы и сведения о владельцах. Действия с кошельком вы проверяете и подписываете сами.';
    function localizeResult(tool, data, answer) {
        if (data?.submitted === true) {
            const said = tool === 'complete_settlement' && data.confirmed === true ? RU_FIXED.settled : RU_FIXED.submitted;
            return {...answer, say:said, show:said};
        }
        if (data?.opened === false && data.code === 'wallet_required') return {...answer, say:RU_FIXED.noWallet, show:RU_FIXED.noWallet};
        if (data?.connected === false) return {...answer, say:RU_FIXED.noWallet};
        if (data?.error) return {...answer, say:'Не удалось получить данные ArtSoul. Подробности на экране.'};
        if (data?.submitted === false || data?.prepared === false || data?.opened === false)
            return {...answer, say:'Действие не выполнено. Проверьте подробности на экране.'};
        if (tool === 'find_active_auctions' && Array.isArray(data.auctions) && Number.isSafeInteger(data.count)) {
            const names = data.auctions.slice(0,3).flatMap(a=>typeof a.title==='string'?[a.title]:[]);
            const text = 'Открытых аукционов: ' + data.count + '. ' + names.join('; ');
            return {...answer, say:text, show:text};
        }
        if (tool === 'get_artwork_provenance') return {...answer, say:'Автор, первый коллекционер и владелец показаны на экране.'};
        if (tool === 'search_catalog') return {...answer, say:'Результаты поиска показаны на экране.'};
        if (tool === 'get_my_activity') return {...answer, say:'Сведения о вашей активности показаны на экране.'};
        if (tool === 'open_artwork'||tool === 'open_page') return {...answer, say:'Открываю страницу ArtSoul.'};
        return {...answer, say:'Подробности из ArtSoul показаны на экране.'};
    }

    // Pre-recorded generic cues never include private, changing or unverified data.
    const SPOKEN_CUES = Object.freeze({
      "r2AuctionResults": {
        "en": "The current auction results are shown on screen.",
        "ru": "Текущие данные об аукционах показаны на экране."
      },
      "r2ArtworkResults": {
        "en": "The verified artwork details are shown on screen.",
        "ru": "Проверенные сведения о работе показаны на экране."
      },
      "r2ProvenanceResults": {
        "en": "Creator, First Collector, and Owner are shown on screen.",
        "ru": "Автор, первый коллекционер и текущий владелец показаны на экране."
      },
      "r2SearchResults": {
        "en": "The ArtSoul search results are shown on screen.",
        "ru": "Результаты поиска ArtSoul показаны на экране."
      },
      "r2ActivityResults": {
        "en": "Your ArtSoul activity is shown on screen.",
        "ru": "Сведения о вашей активности в ArtSoul показаны на экране."
      },
      "r2BidPreparedResult": {
        "en": "Your bid preview is ready for review. Nothing has been signed.",
        "ru": "Предварительный просмотр ставки готов. Ничего не подписано."
      },
      "r2ReviewResult": {
        "en": "You must review this action and approve it in your own wallet.",
        "ru": "Вы должны сами проверить действие и подтвердить его в своём кошельке."
      },
      "r2InfoResults": {
        "en": "Verified ArtSoul details are shown on screen.",
        "ru": "Проверенные сведения ArtSoul показаны на экране."
      },
      "r2ActionNotCompleted": {
        "en": "The action was not completed. Check the reason on screen.",
        "ru": "Действие не выполнено. Проверьте причину на экране."
      },
      "r2ToolError": {
        "en": "ArtSoul could not complete this request. Check the details on screen.",
        "ru": "ArtSoul не смог выполнить запрос. Подробности показаны на экране."
      },
      "r2NoMatches": {
        "en": "No matching items were returned. Try another title or number.",
        "ru": "Совпадений не найдено. Попробуйте другое название или номер."
      },
      "r2NoAuctions": {
        "en": "No open auctions were returned by ArtSoul.",
        "ru": "ArtSoul не вернул открытых аукционов."
      },
      "r2LifecycleResults": {
        "en": "The ArtSoul auction and settlement stages are explained on screen.",
        "ru": "Этапы аукциона и расчёта ArtSoul объяснены на экране."
      },
      "r2PageNavigation": {
        "en": "Opening the requested ArtSoul page.",
        "ru": "Открываю выбранную страницу ArtSoul."
      }
    });
    function safeToolCue(tool,data,lang) {
        const choose = id => SPOKEN_CUES[id]?.[lang] || '';
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) return choose('r2ToolError');
        if (data.submitted === false || data.prepared === false || data.opened === false || data.updated === false)
            return choose('r2ActionNotCompleted');
        if (tool === 'find_active_auctions') {
            if (!Array.isArray(data.auctions) || !Number.isSafeInteger(data.count) || data.count < 0)
                return choose('r2ToolError');
            return choose(data.count === 0 ? 'r2NoAuctions' : 'r2AuctionResults');
        }
        if (tool === 'search_catalog') {
            const groups = data.groups;
            if (!groups || typeof groups !== 'object') return choose('r2ToolError');
            const lengths = ['artworks','auctions','artists','pages','docs']
                .map(key => groups[key]?.items)
                .filter(value => Array.isArray(value)).map(value => value.length);
            if (!lengths.length) return choose('r2ToolError');
            return choose(lengths.some(Boolean) ? 'r2SearchResults' : 'r2NoMatches');
        }
        if (tool === 'get_artwork') return choose('r2ArtworkResults');
        if (tool === 'get_auction_state') return choose('r2AuctionResults');
        if (tool === 'get_artwork_provenance') return choose('r2ProvenanceResults');
        if (tool === 'get_my_activity') return choose('r2ActivityResults');
        if (tool === 'explain_settlement') return choose('r2LifecycleResults');
        if (tool === 'prepare_bid' && data.prepared === true) return choose('r2BidPreparedResult');
        if ((tool === 'open_page' || tool === 'open_artwork') && data.opened === true)
            return choose('r2PageNavigation');
        return '';
    }

    // Only reviewed, fixed public copy has a prerecorded voice. Exact matching
    // keeps dynamic amounts and refused/submitted/confirmed states distinct.
    const replyClips = Object.freeze(
        ['helpSpeech', 'searchPrompt', 'publicationPrompt', 'tooLong', 'empty', 'unavailable', 'noWallet', 'submitted', 'settled']
            .map(id => Object.freeze({lang: 'en', id, text: TEXT[id], url: `/audio/assistant/v1/en-${id}.wav`}))
            .concat(['helpSpeech','searchPrompt','publicationPrompt','tooLong','empty','unavailable','noWallet','submitted','settled']
                .map(id=>Object.freeze({lang:'ru',id,text:RU_FIXED[id],url:`/audio/assistant/v1/ru-${id}.wav`})))
    );

    function getReplyAudio(text) {
        const phrase = ['options', 'askSearch', 'askTitle'].find(id => TEXT[id] === text);
        if (phrase) return `/audio/assistant/v1/phrases/en-${phrase}.wav`;
        const fixed = replyClips.find(clip => clip.text === text)?.url;
        if (fixed) return fixed;
        // Generated offline, never a runtime call to any API or browser voice.
        const extra = window.ArtSoulVoiceAudioBank?.lookup?.(text);
        return typeof extra === 'string' &&
            /^\/audio\/assistant\/v1\/phrases\/(?:ru|en)-r2[A-Za-z0-9]+\.wav$/.test(extra) ? extra : '';
    }

    function hoursText(value) {
        const hours = Number(value);
        if (!Number.isFinite(hours)) return '';
        const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
        return `${rounded} hours`;
    }

    /**
     * What to say and what to show for one tool result. Spoken text stays short;
     * the panel carries the detail, so a person who cannot hear the reply still
     * gets all of it.
     */
    function describeResult(tool, result) {
        const t = TEXT;
        const data = result || {};
        if (data.error) return { say: t.error(data.error), show: data.error };
        if (data.opened === false && data.code === 'wallet_required') return { say: t.noWallet, show: t.noWallet };
        if (data.opened === false && data.code === 'wallet_nfts_unavailable') {
            const message = 'Wallet NFTs are currently unavailable.';
            return { say: message, show: message };
        }
        if (data.connected === false) return { say: t.noWallet, show: data.reason || t.noWallet };
        if (data.submitted === true) {
            const message = tool === 'complete_settlement' && data.confirmed === true ? t.settled : t.submitted;
            const links = [{url: data.url || '/profile', label: data.url ? 'View artwork' : 'View profile'}];
            if (/^0x[0-9a-f]{64}$/i.test(data.transaction_hash || '')) {
                links.push({url: `https://sepolia.basescan.org/tx/${data.transaction_hash}`, label: 'View transaction'});
            }
            return { say: message, show: `${message}\n${t.next}`, links };
        }
        if ((data.submitted === false && !(tool === DRAFT_TOOL && data.prepared === true)) || data.prepared === false || data.opened === false || data.updated === false) {
            const reason = data.reason || '';
            return { say: t.refused(reason), show: reason };
        }

        switch (tool) {
        case 'revise_publication_draft': {
            const name = ({ title: 'Title', description: 'Description', duration_hours: 'Hours' })[data.field];
            if (!name || (!data.checked && !data.review_required)) return { say: t.unavailable, show: t.unavailable };
            const message = data.checked ? (data.pending
                ? 'Suggested title' : 'Title in the form')
                : 'Review this suggestion and choose Use these details.';
            const line = data.checked ? `${message}: ${data.value}` : `${name}: ${data.value}\n${message}`;
            return { say: line, show: line };
        }
        case 'prepare_artwork_registration':
        case 'prepare_donation':
        case 'prepare_artwork_report': {
            const message = data.instruction;
            return { say: message, show: message };
        }
        case 'search_catalog': {
            const labels = { artworks: 'Artworks', auctions: 'Auctions', artists: 'Artists', pages: 'Pages', docs: 'Documentation' };
            const lines = [], links = [];
            let more = false;
            for (const key of ['artworks', 'auctions', 'artists', 'pages', 'docs']) {
                const group = data.groups?.[key];
                if (group === undefined && ['pages', 'docs'].includes(key)) continue;
                if (!Array.isArray(group?.items)) return { say: t.error('Invalid search response.'), show: 'Search could not be completed. Please try again.' };
                const items = group.items.slice(0, data.category === 'all' ? 5 : 20);
                if (items.length) lines.push(`${labels[key]}: ${items.length}`);
                more ||= group.hasMore === true;
                for (const item of items) {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
                    links.push({ url: item.url, label: ['pages', 'docs'].includes(key)
                        ? `${labels[key]} · ${typeof item.title === 'string' ? item.title : labels[key]}`
                        : key === 'artists' ? `${labels[key]} · ${item.name} · ${item.wallet_address}`
                        : `${labels[key]} · ${item.title} (#${item.artwork_id}) · ${item.creator}` });
                }
            }
            const head = lines.length ? `Shown: ${lines.join(' · ')}.`
                : 'No matches. Try another title, artist or artwork number.';
            const tail = more ? 'More matches are available. Open Search ArtSoul and choose a category.' : '';
            const warning = typeof data.warning === 'string' && data.warning.trim()
                ? 'Artwork, auction and artist results are unavailable. Only matching pages and documentation are shown.' : '';
            return { say: [head, warning, tail].filter(Boolean).join(' '), show: [head, warning, tail].filter(Boolean).join('\n'), links };
        }
        case 'add_to_saved':
        case 'remove_from_saved': {
            if (data.updated !== true || typeof data.saved !== 'boolean') return { say: t.error('The change to Favorites could not be confirmed.'), show: 'The change to Favorites could not be confirmed. Please try again.' };
            const text = `Artwork ${data.artwork_id} ${data.saved ? 'is in Favorites' : 'was removed from Favorites'}.`;
            return { say: text, show: text };
        }
        case 'find_active_auctions': {
            const items = Array.isArray(data.auctions) ? data.auctions : [];
            const top = items.slice(0, 3).map(item =>
                `${item.title}, ends in ${hoursText(item.hours_remaining)}`);
            const head = `${data.count || 0} auctions are open.`;
            const text = [head, ...top].join(' ');
            return { say: text, show: text };
        }
        case 'search_artworks': {
            const items = Array.isArray(data.results) ? data.results : [];
            const head = `Found ${data.count || 0}.`;
            const text = [head, items.slice(0, 3).map(item => `${item.title} (#${item.artwork_id})`).join(', ')].join(' ');
            return { say: text, show: text };
        }
        case 'get_artwork':
        case 'get_auction_state': {
            const text = `${data.title}. Status: ${data.status}. Current bid: ${data.current_bid_eth} ETH.`;
            return { say: text, show: text };
        }
        case 'get_artwork_provenance': {
            const short = value => (value ? `${String(value).slice(0, 6)}…${String(value).slice(-4)}` : '—');
            const show = `Creator ${short(data.creator)} · First Collector ${short(data.first_collector)} · Owner ${short(data.owner)}`;
            return { say: 'Creator, First Collector and Owner are shown on screen.', show };
        }
        case 'get_my_activity': {
            const needs = Array.isArray(data.needs_attention) ? data.needs_attention : [];
            const total = Number(data.needs_attention_count ?? needs.length) || 0;
            const head = `You created ${data.created?.count || 0}, own ${data.owned?.count || 0}, and have ${data.resale_listings?.count || 0} listings. ${total} available actions.`;
            const labels = {
                complete_settlement: 'Complete payment before the deadline to receive your NFT.',
                end_expired_auction: 'Confirm the auction end to record its result.',
                close_expired_settlement: 'Close the unpaid settlement to allow a new auction.',
                start_auction: 'You can start an auction when you are ready.',
                withdraw_pending_funds: 'Funds are available to withdraw to your wallet.'
            };
            const items = needs.slice(0, 5);
            const show = [head, ...items.map(entry => `• ${entry.artwork_id ? `Artwork #${entry.artwork_id}: ` : ''}${labels[entry.tool] || entry.why}`)].join('\n');
            return { say: head, show, links: items.filter(entry => entry.artwork_id).map(entry => ({
                url: `/artwork/${entry.artwork_id}`, label: `View artwork #${entry.artwork_id}`
            })) };
        }
        case 'open_page': {
            const text = data.opened ? `Opening ${data.title}.` : 'Page was not opened.';
            return { say: text, show: text };
        }
        case 'open_artwork': {
            const text = `Opening ${data.title}.`;
            return { say: text, show: text };
        }
        case 'explain_settlement': {
            const steps = Array.isArray(data.lifecycle) ? data.lifecycle.filter(x => typeof x === 'string').slice(0,7) : [];
            const explanation = steps.length ? steps.join(' ') : t.unavailable;
            return {say:explanation,show:[explanation,data.floor_rule,data.exact_figures].filter(Boolean).join('\n')};
        }
        case 'prepare_bid': {
            const message = typeof data.instruction === 'string' ? data.instruction : t.unavailable;
            return {say:message,show:message};
        }
        case 'revoke_wallet_access': {
            const text = data.revoked
                ? 'The agent can no longer open your wallet.'
                : (data.note || '');
            return { say: text, show: text };
        }
        default: {
            const text = data.instruction || data.note || JSON.stringify(data);
            return { say: 'Done. Details are on screen.', show: text };
        }
        }
    }

    function safeStorage() {
        try {
            return window.localStorage || null;
        } catch {
            return null;
        }
    }

    function readStored(key) {
        try {
            const store = safeStorage();
            return store ? store.getItem(key) : null;
        } catch {
            return null;
        }
    }

    function writeStored(key, value) {
        try {
            const store = safeStorage();
            if (store) store.setItem(key, value);
        } catch {
            // A forgotten preference costs one more notice, the safe direction.
        }
    }

    // Consume on first entry, including a wrong destination or a reload.
    // The old document only writes this ticket when it actually leaves.
    function takeNavigation() {
        try {
            const saved = window.sessionStorage.getItem(NAVIGATION_KEY);
            if (!saved) return null;
            window.sessionStorage.removeItem(NAVIGATION_KEY);
            const nav = JSON.parse(saved);
            const age = Date.now() - nav.at;
            const previous = new URL(document.referrer);
            if (!Number.isFinite(age) || age < 0 || age >= NAVIGATION_TTL ||
                window.performance.getEntriesByType('navigation')[0]?.type !== 'navigate' ||
                nav.to !== window.location.href || previous.origin !== window.location.origin || nav.from !== previous.pathname ||
                typeof nav.wallet !== 'string' || !/^(?:0x[0-9a-f]{40})?$/.test(nav.wallet)) return null;
            return nav;
        } catch { return null; }
    }


    // UI-only voice intents. No wallet connection, signatures or transfers:
    // these helpers may display an existing menu or set a presentation theme.
    function safeVoiceUiAction(intent, { win = window, doc = typeof document === 'undefined' ? null : document, lang = 'en' } = {}) {
        const result=(ru,en)=>({show:lang==='ru'?ru:en,say:lang==='ru'?ru:en});
        const unavailable=()=>result('Эта функция сейчас недоступна на странице. Попробуйте кнопку в шапке сайта.',
            'This control is unavailable here. Please use the corresponding header button.');
        if (!intent || intent.kind !== 'ui' || !doc || doc.visibilityState === 'hidden') return unavailable();
        if (intent.action === 'walletMenu') {
            const button = doc.querySelector('.avatar-button[aria-label="ArtSoul account menu"]');
            if (!button || button.disabled || typeof button.click !== 'function') return unavailable();
            try {
                if (button.getAttribute('aria-expanded') !== 'true') button.click();
            } catch { return unavailable(); }
            return result('Открыла меню аккаунта. Для подключения выберите кошелёк и подтвердите действие сами. Ничего не подписано.',
                'Account menu opened. Select a wallet and approve the connection yourself. Nothing was signed.');
        }
        if (intent.action === 'notifications') {
            const button = doc.querySelector('[data-notification-preview]');
            if (!button || button.disabled || typeof button.click !== 'function') return unavailable();
            try { button.click(); } catch { return unavailable(); }
            return result('Открываю панель уведомлений. Если кошелёк не подключён, появится подсказка.',
                'Opening notifications. If no wallet is connected, the panel will show a connection prompt.');
        }
        if (intent.action === 'theme') {
            if (!['classic','future'].includes(intent.theme) ||
                typeof win.ThemeManager?.setTheme !== 'function') return unavailable();
            try { win.ThemeManager.setTheme(intent.theme); } catch { return unavailable(); }
            return intent.theme === 'classic'
                ? result('Включила классический вид ArtSoul.', 'ArtSoul Classic appearance is enabled.')
                : result('Включила оформление Future.', 'ArtSoul Future appearance is enabled.');
        }
        if (intent.action === 'networkStatus') {
            if (win.artsoulWalletStateSettled !== true)
                return result('Состояние кошелька ещё загружается. Проверьте сеть в меню кошелька.',
                    'Wallet state is still loading. Check the network in your wallet menu.');
            const state=win.artsoulSettledWalletState;
            if (!state?.isConnected || !/^0x[0-9a-f]{40}$/i.test(String(state.address||'')))
                return result('Кошелёк не подключён. Сеть кошелька сейчас неизвестна.',
                    'No wallet is connected. Its selected network is unknown.');
            const raw = state.chainId ?? state.network?.chainId;
            const chain = typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw)
                ? Number.parseInt(raw.slice(2),16) : Number(raw);
            if (Number.isSafeInteger(chain) && chain > 0) {
                const label=({84532:'Base Sepolia',8453:'Base Mainnet',1:'Ethereum Mainnet',11155111:'Ethereum Sepolia'})[chain];
                return result('Кошелёк подключён. Выбранная сеть: '+(label||'ID '+chain)+'.',
                    'Wallet connected. Selected network: '+(label||'ID '+chain)+'.');
            }
            return result('Кошелёк подключён, но сеть не подтверждена доступными данными. Проверьте её в кошельке.',
                'Wallet connected, but the network is not verified by available state. Check it in your wallet.');
        }
        return unavailable();
    }

    window.ArtSoulVoice = Object.freeze({
        parseCommand,
        parseNavigationTurn,
        describeResult,
        replyClips,
        getReplyAudio,
        safeToolCue,
        mayRun,
        isWrite,
        WRITE_TOOLS,
        WRITE_CONFIDENCE,
        safeVoiceUiAction
    });

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.ArtSoulWebMCP || typeof document === 'undefined') return;

    function mount() {
        const launcher = document.querySelector('.artsoul-voice-button');
        if (launcher?.dataset.commandsInitialized) return;
        const agent = window.ArtSoulWebMCP;
        const tools = new Map(agent.createTools(agent.browserDependencies()).map(tool => [tool.name, tool]));
        const dialogue = window.ArtSoulVoiceConversation?.createDialogue?.();
        const DIALOGUE_KEY = 'artsoul.voice.dialogue.r2';

        let inputLanguage = readStored(LANG_KEY) === 'ru' ? 'ru' : 'en';
        let recognition = null;
        let handsFree = false;
        let leavingFor = null;
        let arrivingFrom = takeNavigation();
        if (arrivingFrom && dialogue) {
            try {
                const saved = window.sessionStorage.getItem(DIALOGUE_KEY);
                if (saved && saved.length < 1500) dialogue.restore(JSON.parse(saved));
                window.sessionStorage.removeItem(DIALOGUE_KEY);
            } catch { dialogue.clear(); }
        }
        let pendingDraftField = null;
        let pendingPrompt = null;
        let voiceConsent = readStored(NOTICE_KEY) === 'accepted';
        let nextTurnTimer = null;
        let noticePending = false;
        let busy = false;
        let generation = 0;
        let audioGeneration = 0;
        let answerToRead = '';
        let utterance = null;
        let speaking = false;
        let clipAudio = null;
        let clipAttempt = null;
        let clipTimer = null;
        const walletIdentity = () => {
            const state = window.artsoulSettledWalletState;
            return state?.isConnected ? String(state.address || '').toLowerCase() : '';
        };
        let wallet = walletIdentity();

        const button = launcher || document.createElement('button');
        button.dataset.commandsInitialized = 'true';
        button.type = 'button';
        button.className = 'artsoul-voice-button';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'artsoulVoicePanel');
        button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg>';

        const panel = document.createElement('div');
        panel.id = 'artsoulVoicePanel';
        panel.className = 'artsoul-voice-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-labelledby', 'artsoulVoiceTitle');
        panel.hidden = true;
        panel.innerHTML =
            '<div class="artsoul-voice-panel-head">' +
            '<h2 id="artsoulVoiceTitle"></h2>' +
            '<button type="button" class="artsoul-voice-lang" data-lang="en" aria-label="Recognize English commands" title="Recognize English commands">EN</button>' +
            '<button type="button" class="artsoul-voice-lang" data-lang="ru" aria-label="Recognize Russian commands" title="Recognize Russian commands">RU</button>' +
            '<button type="button" class="artsoul-voice-close">×</button>' +
            '</div>' +
            '<p class="artsoul-voice-hint" id="artsoulVoiceHint"></p>' +
            '<form class="artsoul-voice-form">' +
            '<label for="artsoulVoiceInput"></label>' +
            '<input id="artsoulVoiceInput" type="text" maxlength="300" autocomplete="off" aria-describedby="artsoulVoiceHint">' +
            '<div class="artsoul-voice-controls"><button type="button" class="artsoul-voice-mic" aria-pressed="false"></button>' +
            '<button type="button" class="artsoul-voice-chat" aria-pressed="false"></button>' +
            '<button type="submit" class="artsoul-voice-send"></button></div>' +
            '</form>' +
            '<p class="artsoul-voice-support"></p>' +
            '<p class="artsoul-voice-heard"></p>' +
            '<p class="artsoul-voice-answer" role="status" aria-live="polite"></p>' +
            '<div class="artsoul-voice-controls"><button type="button" class="artsoul-voice-replay" aria-pressed="false"></button></div>' +
            '<p class="artsoul-voice-support artsoul-voice-audio-notice" hidden></p>' +
            '<p class="artsoul-voice-audio-status" role="status" hidden></p>' +
            '<div class="artsoul-voice-results"></div>' +
            '<details class="artsoul-voice-examples"><summary></summary><p></p></details>';

        const heardEl = panel.querySelector('.artsoul-voice-heard');
        const answerEl = panel.querySelector('.artsoul-voice-answer');
        const resultsEl = panel.querySelector('.artsoul-voice-results');
        const input = panel.querySelector('input');
        const mic = panel.querySelector('.artsoul-voice-mic');
        const chat = panel.querySelector('.artsoul-voice-chat');
        const send = panel.querySelector('.artsoul-voice-send');
        const replay = panel.querySelector('.artsoul-voice-replay');
        const audioStatus = panel.querySelector('.artsoul-voice-audio-status');
        const audioNotice = panel.querySelector('.artsoul-voice-audio-notice');
        // The global capture guard disables submit buttons before their native
        // form action. This panel already owns the pending-command lock.
        send.dataset.allowRapid = 'true';
        chat.dataset.allowRapid = 'true';
        const close = panel.querySelector('.artsoul-voice-close');

        function label() {
            const t = inputLanguage === 'ru' ? {...TEXT,...RU_UI} : TEXT;
            button.setAttribute('aria-label', t.title);
            panel.setAttribute('lang', inputLanguage);
            panel.querySelector('h2').textContent = t.title;
            panel.querySelector('.artsoul-voice-hint').textContent = typeof Recognition === 'function'
                ? t.hint + ' ' + t.conversationHint : t.hint;
            if (/^\/upload(?:\.html)?\/?$/.test(window.location?.pathname || '')) {
                panel.querySelector('.artsoul-voice-hint').textContent += inputLanguage === 'ru' ? ' Для черновика назовите заголовок или длительность аукциона.' : ' For a draft, say “title” and dictate it, or say “choose 48 hours”.';
            }
            panel.querySelector('label').textContent = t.input;
            input.placeholder = t.placeholder;
            close.setAttribute('aria-label', t.close);
            send.textContent = t.send;
            mic.textContent = recognition ? t.stop : t.microphone;
            const support = panel.querySelector('.artsoul-voice-support');
            support.hidden = typeof Recognition === 'function';
            support.textContent = t.noSpeech;
            panel.querySelector('summary').textContent = t.examples;
            panel.querySelector('.artsoul-voice-examples p').textContent = t.help;
            panel.querySelectorAll('.artsoul-voice-lang').forEach(el => {
                el.setAttribute('aria-pressed', String(el.dataset.lang === inputLanguage));
            });
            controls();
        }

        function show(heard, answer, links = [], say = answer) {
            heardEl.textContent = heard || '';
            answerEl.textContent = answer || '';
            answerToRead = say || '';
            audioStatus.hidden = true;
            controls();
            resultsEl.replaceChildren();
            for (const item of links) {
                // Results are untrusted text; links are only canonical public
                // identities and public pages, never arbitrary metadata URLs.
                const id = /^\/artwork\/([1-9][0-9]{0,77})$/.exec(item.url || '');
                const receipt = /^https:\/\/sepolia\.basescan\.org\/tx\/0x[0-9a-f]{64}$/i.test(item.url || '');
                const page = ['/', '/gallery', '/upload', '/profile', '/docs-protocol'].includes(item.url)
                    || /^\/docs-protocol#[a-z][a-z0-9-]*$/.test(item.url || '');
                if (!(id && BigInt(id[1]) < 2n ** 256n) && !/^\/profile\?address=0x[0-9a-f]{40}$/.test(item.url || '') && !page && !receipt) continue;
                const link = document.createElement('a'); link.href = item.url; link.textContent = item.label;
                if (receipt) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
                link.addEventListener('click', event => {
                    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
                    // Leave native navigation and same-page hash listeners intact.
                    if (!panel.hidden) closePanel();
                });
                resultsEl.appendChild(link);
            }
        }

        function controls() {
            input.disabled = busy || noticePending || (Boolean(recognition) && !handsFree);
            send.disabled = busy || noticePending || Boolean(recognition) || !input.value.trim();
            mic.disabled = busy || noticePending || typeof Recognition !== 'function';
            mic.hidden = handsFree;
            chat.hidden = typeof Recognition !== 'function';
            chat.disabled = !handsFree && (busy || noticePending || Boolean(recognition));
            const ui = inputLanguage === 'ru' ? {...TEXT,...RU_UI} : TEXT;
            chat.textContent = handsFree ? ui.endConversation : ui.conversation;
            chat.title = ui.conversationHint;
            chat.setAttribute('aria-pressed', String(handsFree));
            chat.dataset.listening = String(handsFree && Boolean(recognition));
            const hasClip = Boolean(getReplyAudio(answerToRead)) && typeof window.Audio === 'function';
            const supportsAudio = hasClip;
            audioNotice.textContent = ui.audioNotice;
            audioNotice.hidden = !hasClip;
            replay.hidden = !answerToRead;
            replay.disabled = busy || noticePending || Boolean(recognition) || !supportsAudio;
            replay.textContent = speaking ? ui.stopReply : ui.listenReply;
            replay.setAttribute('aria-pressed', String(speaking));
            if (answerToRead && !supportsAudio) {
                audioStatus.textContent = ui.audioUnavailable;
                audioStatus.hidden = false;
            }
            panel.querySelectorAll('.artsoul-voice-lang').forEach(el => { el.disabled = busy || noticePending; });
            panel.querySelector('form').setAttribute('aria-busy', String(busy || noticePending));
        }

        function silence() {
            audioGeneration++;
            window.clearTimeout?.(nextTurnTimer);
            nextTurnTimer = null;
            clipAttempt = null;
            window.clearTimeout?.(clipTimer);
            clipTimer = null;
            if (clipAudio) {
                clipAudio.onplaying = clipAudio.onended = clipAudio.onerror = null;
                try {
                    clipAudio.pause();
                    clipAudio.removeAttribute('src');
                    clipAudio.load();
                } catch { /* Already stopped; text remains available. */ }
            }
            if (utterance) utterance.onstart = utterance.onend = utterance.onerror = null;
            utterance = null;
            speaking = false;
            try { window.speechSynthesis?.cancel(); } catch { /* Text remains available. */ }
            controls();
        }

        function stopVoice({ keepDraft = false } = {}) {
            leavingFor = arrivingFrom = null;
            if (!keepDraft) {
                pendingDraftField = null;
                pendingPrompt = null;
                dialogue?.clear();
            }
            handsFree = false;
            stopListening();
            silence();
        }

        function closePanel() {
            stopVoice();
            dialogue?.clear();
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.focus({ preventScroll: true });
        }

        function afterPlayback(failed) {
            if (handsFree && !failed) {
                const turn = audioGeneration;
                nextTurnTimer = window.setTimeout(() => {
                    if (handsFree && turn === audioGeneration) void start({ resume: true });
                }, 300);
            } else if (failed) {
                handsFree = false;
            }
            controls();
        }

        function speak(textToSay) {
            try {
                if (!textToSay || panel.hidden || document.visibilityState === 'hidden') return;
                silence();
                audioStatus.hidden = true;
                const clip = getReplyAudio(textToSay);
                if (clip && typeof window.Audio === 'function') {
                    if (!clipAudio) {
                        clipAudio = new window.Audio();
                        clipAudio.preload = 'none';
                    }
                    const attempt = {};
                    clipAttempt = attempt;
                    const finish = error => {
                        if (clipAttempt !== attempt) return;
                        clipAttempt = null;
                        window.clearTimeout?.(clipTimer);
                        clipTimer = null;
                        clipAudio.onplaying = clipAudio.onended = clipAudio.onerror = null;
                        clipAudio.pause();
                        speaking = false;
                        if (error) {
                            audioStatus.textContent = error.name === 'NotAllowedError' ? TEXT.audioBlocked : TEXT.audioUnavailable;
                            audioStatus.hidden = false;
                        }
                        afterPlayback(Boolean(error));
                    };
                    clipAudio.onplaying = () => {
                        if (clipAttempt !== attempt) return;
                        clipAudio.onplaying = null;
                        window.clearTimeout?.(clipTimer);
                        // A stalled clip can emit playing and never emit ended.
                        clipTimer = handsFree ? window.setTimeout(() => finish({name: 'TimeoutError'}), 60000) : null;
                    };
                    clipAudio.onended = () => finish();
                    clipAudio.onerror = () => finish({name: 'MediaError'});
                    clipAudio.src = clip;
                    speaking = true;
                    controls();
                    clipTimer = window.setTimeout(() => finish({name: 'TimeoutError'}), 15000);
                    // Keep play() in the trusted click stack. Fetch/canplay awaits
                    // would lose the iPhone gesture. Automatic replies may be blocked.
                    const playback = clipAudio.play();
                    playback?.catch(error => finish(error || {name: 'MediaError'}));
                    return;
                }
                // A missing matching clip must never switch to an arbitrary browser/male voice.
                // Unrecorded responses remain available as text until a verified unified TTS is available.
                speaking = false;
                audioStatus.textContent = inputLanguage === 'ru'
                    ? 'Ответ доступен текстом. Эта фраза ещё не записана женским голосом.'
                    : TEXT.audioUnavailable;
                audioStatus.hidden = false;
                afterPlayback(true);
                return;
            } catch {
                stopVoice();
                audioStatus.textContent = TEXT.audioUnavailable;
                audioStatus.hidden = false;
            }
        }

        function setListening(on) {
            mic.setAttribute('aria-pressed', String(on));
            const ui = inputLanguage === 'ru' ? {...TEXT,...RU_UI} : TEXT;
            mic.textContent = on ? ui.stop : ui.microphone;
            button.classList.toggle('is-listening', on);
            controls();
        }

        function stopListening() {
            const session = recognition;
            recognition = null;
            if (session) {
                // Ignore callbacks from an aborted or superseded microphone.
                session.onresult = session.onerror = session.onend = null;
                try {
                    session.abort();
                } catch {
                    // Already stopped.
                }
            }
            setListening(false);
            if (answerEl.textContent === TEXT.listening || answerEl.textContent === RU_UI.listening) show('', '');
        }

        async function handle(transcript, confidence, spoken = false) {
            if (busy || noticePending) return;
            silence();
            const replyLang = /[а-яё]/iu.test(transcript) ? 'ru' : /[a-z]/iu.test(transcript) ? 'en' : inputLanguage;
            const t = replyLang === 'ru' ? {...TEXT,...RU_UI, ...RU_FIXED, help:RU_HELP, otherRequest:'Уточните название или номер работы.', unsure: heard => 'Я не уверена, что услышала правильно: ' + heard, error: msg => 'Ошибка ArtSoul: ' + msg} : TEXT;
            const audio = audioGeneration;
            const reply = (heard, answer, say = answer, links = []) => {
                show(heard, answer, links, say);
                if (spoken && audio === audioGeneration) speak(say);
            };
            if (transcript.length > 300) { reply('', t.tooLong); return; }
            if (!transcript.trim()) { reply('', t.empty); return; }
            if (!pendingDraftField && /^(?:stop(?: voice chat)?|end voice chat|no[,]? thanks|that['’]s all|стоп|заверши(?:ть)? диалог|ничего не (?:надо|нужно)|хватит|спасибо[,]? пока|на этом вс[её])[.!]?$/i.test(transcript.trim())) {
                stopVoice();
                show(transcript, '', [], '');
                return;
            }
            const previousPrompt = pendingPrompt;
            pendingPrompt = null;
            const isValue = previousPrompt === 'search' || previousPrompt === 'title';
            if (isValue && /^(?:cancel|never mind|отмена|отмени)[.!]?$/i.test(transcript.trim())) {
                reply(transcript, t.next);
                return;
            }
            const draftTurn = !isValue && window.ArtSoulPublicationDraft?.parseTurn?.(transcript, replyLang, pendingDraftField);
            pendingDraftField = draftTurn?.nextField || null;
            if (draftTurn?.message) {
                reply(transcript, draftTurn.message, pendingDraftField === 'title' ? t.askTitle : draftTurn.message);
                return;
            }
            const contextual = !draftTurn && !isValue && dialogue?.route(transcript, {
                lang:replyLang, spoken, confidence
            });
            let command = draftTurn || (contextual?.kind === 'tool'
                ? {tool:contextual.tool,input:contextual.input}
                : parseCommand(transcript, replyLang, previousPrompt === 'nft'));
            if (contextual?.kind === 'stop') { stopVoice(); show(transcript,'',[], ''); return; }
            if (contextual?.kind === 'reply') { reply(transcript,contextual.text); return; }
            if (contextual?.kind === 'ui') {
                const outcome = safeVoiceUiAction(contextual,{win:window,doc:document,lang:replyLang});
                reply(transcript,outcome.show,outcome.say);
                return;
            }
            // The answer to a search/title question is data, even when it sounds like a wallet command.
            if (previousPrompt === 'search' && command?.tool !== 'search_catalog' && !command?.searchPrompt && !command?.help) {
                command = { tool: 'search_catalog', input: { query: transcript.trim() } };
            } else if (previousPrompt === 'title' && command?.tool !== DRAFT_TOOL && !command?.publicationPrompt) {
                command = { tool: DRAFT_TOOL, input: { title: transcript.trim() } };
            }
            if (!command) {
                reply(transcript, t.otherRequest, t.options);
                return;
            }
            if (command.message) {
                if (command.nftPrompt) pendingPrompt = 'nft';
                reply(transcript, command.message);
                return;
            }
            if (command.help) {
                reply(transcript, t.help, t.helpSpeech);
                return;
            }
            if (command.searchPrompt || command.publicationPrompt) {
                pendingPrompt = command.searchPrompt ? 'search' : 'title';
                const hint = command.searchPrompt ? t.searchPrompt : t.publicationPrompt;
                reply(transcript, hint, handsFree ? (command.searchPrompt ? t.askSearch : t.askTitle) : hint);
                return;
            }
            if (!mayRun(command, confidence)) {
                const text = t.unsure(transcript);
                reply(transcript, text);
                return;
            }
            if (handsFree && !CHAT_TOOLS.has(command.tool)) {
                handsFree = false;
                reply(transcript, t.reviewCommand);
                return;
            }
            const tool = tools.get(command.tool);
            if (!tool) {
                reply(transcript, t.unavailable);
                return;
            }
            show(transcript, t.working);
            busy = true;
            controls();
            const current = generation;
            const currentWallet = walletIdentity();
            const sourcePage = window.location?.href;
            try {
                const result = JSON.parse(await tool.execute(command.input));
                if (current !== generation || currentWallet !== walletIdentity()) return;
                dialogue?.observe(command.tool,result);
                if (!result.error && (result.submitted === true || result.updated === true || result.revoked === true)) {
                    // A finished action must not remain armed in the composer.
                    // Declines/errors retain the draft for a deliberate retry.
                    input.value = '';
                    input.placeholder = t.next;
                }
                let resultText = describeResult(command.tool, result);
                if (replyLang === 'ru') resultText = localizeResult(command.tool, result, resultText);
                // Only speak a generic cue when the corresponding verified WAV exists.
                // Changing names, balances, prices, owner addresses stay on screen.
                const cue = safeToolCue(command.tool,result,replyLang);
                if (cue && getReplyAudio(cue)) resultText = {...resultText,say:cue};
                if (spoken && handsFree && audio === audioGeneration && result.opened === true && sourcePage &&
                    (command.tool === 'open_page' || command.tool === 'open_artwork')) {
                    const from = new URL(sourcePage);
                    const to = new URL(result.url, from);
                    // A hash tab keeps this document. It needs no unload ticket
                    // or successful audio autoplay to accept the next turn.
                    if (to.origin === from.origin && to.hash && from.pathname === to.pathname && from.search === to.search) {
                        show(transcript, window.location.href === to.href ? t.arrival : resultText.show, [], '');
                        afterPlayback(false);
                        return;
                    }
                    if (to.origin === from.origin) {
                        leavingFor = { from: from.pathname, to: to.href, wallet: currentWallet, at: Date.now() };
                        show(transcript, resultText.show, [], '');
                        nextTurnTimer = window.setTimeout(() => {
                            if (!leavingFor) return;
                            stopVoice();
                            show('', t.navigationWait);
                        }, NAVIGATION_TTL);
                        return;
                    }
                }
                reply(transcript, resultText.show, resultText.say, resultText.links);
            } catch (error) {
                if (current !== generation || currentWallet !== walletIdentity()) return;
                const message = (error && error.message) || String(error);
                reply(transcript, message, t.error(message));
            } finally {
                busy = false;
                controls();
                // Disabling the focused Send button moves focus to body in
                // browsers. Return it to the composer so Escape/retry work.
                if (!panel.hidden && document.activeElement === document.body) input.focus({ preventScroll: true });
            }
        }

        async function start({ resume = false, arrival = false } = {}) {
            if (busy || noticePending || panel.hidden || document.visibilityState === 'hidden' || typeof Recognition !== 'function') return;
            if (!resume) arrivingFrom = null;
            silence();
            if (recognition) {
                stopListening();
                return;
            }
            if (!voiceConsent) {
                const audio = audioGeneration, current = generation, account = walletIdentity();
                noticePending = true;
                controls();
                let approved = false;
                try {
                    approved = await window.confirm(inputLanguage === 'ru' ? RU_UI.notice : TEXT.notice);
                } catch {
                    // A failed or dismissed consent dialog never starts audio.
                } finally {
                    noticePending = false;
                    controls();
                }
                if (approved !== true || audio !== audioGeneration || current !== generation || account !== walletIdentity() ||
                    busy || panel.hidden || document.visibilityState === 'hidden') {
                    handsFree = false;
                    controls();
                    return;
                }
                voiceConsent = true;
                writeStored(NOTICE_KEY, 'accepted');
            }

            let session;
            try {
                session = new Recognition();
            } catch {
                handsFree = false;
                show('', TEXT.notHeard);
                return;
            }
            recognition = session;
            session.lang = inputLanguage === 'ru' ? 'ru-RU' : 'en-US';
            session.continuous = false;
            session.interimResults = false;
            session.maxAlternatives = 1;

            let answered = false;
            session.onresult = event => {
                if (recognition !== session || panel.hidden) return;
                const alternative = event.results && event.results[0] && event.results[0][0];
                if (!alternative) return;
                answered = true;
                stopListening();
                const transcript = String(alternative.transcript || '');
                input.value = transcript.slice(0, 300);
                void handle(transcript, alternative.confidence, true);
            };
            session.onerror = event => {
                if (recognition !== session || panel.hidden) return;
                answered = true;
                handsFree = false;
                stopListening();
                const code = event && event.error;
                show('', code === 'not-allowed' || code === 'service-not-allowed'
                    ? (arrival ? TEXT.resumeMic : TEXT.micBlocked) : TEXT.notHeard);
            };
            session.onend = () => {
                if (recognition !== session || panel.hidden) return;
                handsFree = false;
                stopListening();
                if (!answered) show('', TEXT.notHeard);
            };

            setListening(true);
            if (!resume) show('', TEXT.listening);
            try {
                session.start();
            } catch {
                handsFree = false;
                stopListening();
                show('', arrival ? TEXT.resumeMic : TEXT.notHeard);
            }
        }

        button.addEventListener('click', () => {
            if (!panel.hidden) { closePanel(); return; }
            panel.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            (input.disabled ? close : input).focus({ preventScroll: true });
        });
        mic.addEventListener('click', start);
        chat.addEventListener('click', () => {
            if (handsFree) { stopVoice(); return; }
            if (chat.disabled || chat.hidden || panel.hidden || document.visibilityState === 'hidden') return;
            arrivingFrom = null;
            handsFree = true;
            void start();
        });
        replay.addEventListener('click', () => {
            if (replay.disabled || panel.hidden) return;
            arrivingFrom = null;
            handsFree = false;
            if (speaking) silence();
            else speak(answerToRead);
        });
        input.addEventListener('input', () => {
            if (handsFree || arrivingFrom) stopVoice({ keepDraft: true });
            controls();
        });
        close.addEventListener('click', closePanel);
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); }
        });
        panel.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            if (busy || recognition) return;
            if (handsFree || arrivingFrom) stopVoice({ keepDraft: true });
            void handle(input.value, 1);
        });
        panel.querySelectorAll('.artsoul-voice-lang').forEach(el => {
            el.addEventListener('click', () => {
                if (busy) return;
                stopVoice();
                inputLanguage = el.dataset.lang === 'ru' ? 'ru' : 'en';
                writeStored(LANG_KEY, inputLanguage);
                label();
                show('', '');
            });
        });
        // Never listen in a tab nobody is looking at.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {stopVoice();dialogue?.clear();}
        });
        function clearAccount() {
            dialogue?.clear();
            generation++;
            stopVoice();
            input.value = '';
            show('', TEXT.changed);
        }
        function resumeOnArrival() {
            if (!arrivingFrom) return;
            // A connected wallet is hydrated asynchronously on the new page.
            if (!window.artsoulSettledWalletState && (arrivingFrom.wallet || readStored('artsoul_wallet'))) return;
            const nav = arrivingFrom;
            arrivingFrom = null;
            if (nav.wallet !== walletIdentity()) {
                // Do not resurrect prior-account conversational references.
                dialogue?.clear();
                return;
            }
            if (Date.now() - nav.at >= NAVIGATION_TTL ||
                !voiceConsent || typeof Recognition !== 'function' || document.visibilityState !== 'visible' || panel.hidden) return;
            handsFree = true;
            show('', TEXT.arrival, [], '');
            void start({ resume: true, arrival: true });
        }
        window.addEventListener('artsoul:wallet-state-changed', () => {
            const next = walletIdentity();
            if (arrivingFrom) { wallet = next; resumeOnArrival(); return; }
            if (next !== wallet) { wallet = next; clearAccount(); }
        });
        window.addEventListener('artsoul:auth-state-changed', () => { clearAccount(); show('', ''); });
        window.addEventListener('pagehide', () => {
            if (leavingFor && Date.now() - leavingFor.at < NAVIGATION_TTL) {
                try {
                    if (dialogue) window.sessionStorage.setItem(DIALOGUE_KEY,JSON.stringify(dialogue.snapshot()));
                    window.sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify(leavingFor));
                }
                catch { /* Browsing still works when tab storage is unavailable. */ }
            }
            clearAccount();
            show('', '');
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        });

        label();
        document.body.appendChild(panel);
        if (!launcher) document.body.appendChild(button);
        if (arrivingFrom && voiceConsent && document.visibilityState === 'visible' && typeof Recognition === 'function') {
            panel.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            show('', TEXT.resumeMic);
            resumeOnArrival();
        } else arrivingFrom = null;
    }

    // The deferred script runs after the static header. Binding the existing
    // launcher immediately avoids a visible but unresponsive idle-time control.
    mount();
})();
