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
 * - Nothing on ArtSoul's side. Speech is recognised by the browser's own
 *   SpeechRecognition and spoken by its own speechSynthesis. There is no server,
 *   no key, no per-minute bill and no audio in any ArtSoul request.
 * - The browser vendor may process it. Chrome sends the audio to Google to be
 *   transcribed. The person is told that before the microphone first opens.
 * - Text commands remain available without speech recognition. Opening the
 *   panel never starts the microphone. Typed replies are silent.
 *
 * What keeps a misheard sentence from costing money:
 *
 * 1. The microphone opens only on a click, for one sentence, and closes when the
 *    tab is hidden. It never listens in the background.
 * 2. What was heard is shown before anything runs.
 * 3. A command that opens the wallet does not run when the recogniser itself
 *    reports low confidence; the person is asked to repeat it.
 * 4. Every wallet command then passes the tool layer's gate: a page dialog naming
 *    the work and the figure for anything carrying an amount, one wallet action
 *    at a time, and the wallet's own approval. Voice adds checks; it removes none.
 */
(function () {
    'use strict';

    const LANG_KEY = 'artsoul.voice.lang';
    const NOTICE_KEY = 'artsoul.voice.notice';
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
        'buy_resale_listing',
        'withdraw_pending_funds'
    ]);
    const SAVED_TOOLS = ['add_to_saved', 'remove_from_saved'];

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
        ['en', new RegExp(`^(?:please\\s+)?save\\s+${EN_WORK}${ID}(?:\\s+to\\s+(?:my\\s+)?(?:saved|favou?rites))?$`), m => ({ tool: 'add_to_saved', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`^(?:please\\s+)?add\\s+${EN_WORK}${ID}\\s+to\\s+(?:my\\s+)?(?:saved|favou?rites)$`), m => ({ tool: 'add_to_saved', input: { artwork_id: m[1] } })],
        ['en', new RegExp(`^(?:please\\s+)?remove\\s+${EN_WORK}${ID}\\s+from\\s+(?:my\\s+)?(?:saved|favou?rites)$`), m => ({ tool: 'remove_from_saved', input: { artwork_id: m[1] } })],
        ['en', /^(help|commands|what can (i|you) (say|do))\b/, () => ({ help: true })],
        ['en', /\b(stop|revoke|forget)\b.*\bwallet\b|\bdon'?t (touch|use) my wallet\b|^stop$/, () => ({ tool: 'revoke_wallet_access', input: {} })],
        ['en', new RegExp(`\\bbid\\s+(?:of\\s+)?${AMOUNT}(?:\\s*eth)?\\s+on\\s+${EN_WORK}${ID}`), m => ({ tool: 'place_bid', input: { artwork_id: m[2], bid_eth: amount(m[1]) } })],
        ['en', new RegExp(`\\bstart\\s+(?:an\\s+)?auction\\s+(?:on|for)\\s+${EN_WORK}${ID}\\s+(?:at|from|starting at)\\s+${AMOUNT}(?:\\s*eth)?\\s+for\\s+(\\d{1,3})\\s*hours?`),
            m => ({ tool: 'start_auction', input: { artwork_id: m[1], start_price_eth: amount(m[2]), duration_hours: Number(m[3]) } })],
        ['en', new RegExp(`\\b(?:list|sell)\\s+${EN_WORK}${ID}\\s+(?:for|at)\\s+${AMOUNT}`), m => ({ tool: 'list_for_resale', input: { artwork_id: m[1], price_eth: amount(m[2]) } })],
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
        ['en', /^(?:search(?: for)?|find|look for)\s+(.+)$/, m => ({ tool: 'search_artworks', input: { query: m[1].trim() } })],

        // --- Russian ---------------------------------------------------------
        ['ru', new RegExp(`^(?:пожалуйста,?\\s+)?(?:сохрани|добавь)\\s+${RU_WORK}${ID}\\s+в\\s+избранное$`), m => ({ tool: 'add_to_saved', input: { artwork_id: m[1] } })],
        ['ru', new RegExp(`^(?:пожалуйста,?\\s+)?(?:убери|удали)\\s+${RU_WORK}${ID}\\s+из\\s+избранного$`), m => ({ tool: 'remove_from_saved', input: { artwork_id: m[1] } })],
        ['ru', /^(помощь|команды|что (можно|ты умеешь))/, () => ({ help: true })],
        ['ru', /(стоп|отключи|не трогай|забудь).*кош[её]л|^стоп$/, () => ({ tool: 'revoke_wallet_access', input: {} })],
        ['ru', new RegExp(`(?:ставк[а-я]*|поставь)\\s+${AMOUNT}(?:\\s*eth|\\s*эфир[а-я]*)?\\s+на\\s+${RU_WORK}${ID}`), m => ({ tool: 'place_bid', input: { artwork_id: m[2], bid_eth: amount(m[1]) } })],
        ['ru', new RegExp(`(?:запусти|начни|создай)\\s+аукцион\\s+(?:на\\s+|для\\s+)?${RU_WORK}${ID}\\s+(?:за|от|по)\\s+${AMOUNT}(?:\\s*eth|\\s*эфир[а-я]*)?\\s+на\\s+(\\d{1,3})\\s*час(?:а|ов)?`),
            m => ({ tool: 'start_auction', input: { artwork_id: m[1], start_price_eth: amount(m[2]), duration_hours: Number(m[3]) } })],
        ['ru', new RegExp(`(?:выстав[а-я]*|продай)\\s+${RU_WORK}${ID}\\s+(?:за|по)\\s+${AMOUNT}`), m => ({ tool: 'list_for_resale', input: { artwork_id: m[1], price_eth: amount(m[2]) } })],
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
        ['ru', /^(?:найди|поиск|ищи)\s+(.+)$/, m => ({ tool: 'search_artworks', input: { query: m[1].trim() } })]
    ];

    /** A spoken sentence to one tool call, or null when nothing matched. */
    function parseCommand(transcript, lang) {
        const heard = String(transcript == null ? '' : transcript)
            .toLowerCase()
            .replace(/[?!.]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!heard || heard.length > 300) return null;
        const language = lang === 'ru' ? 'ru' : 'en';
        // A search term is data, even when it contains a wallet command.
        const search = language === 'ru' ? /^(?:найди|поиск|ищи)\s+(.+)$/.exec(heard)
            : /^(?:search(?: for)?|find|look for)\s+(.+)$/.exec(heard);
        if (search) return { tool: 'search_artworks', input: { query: search[1] } };
        for (const [ruleLang, pattern, build] of GRAMMAR) {
            if (ruleLang !== language) continue;
            const match = pattern.exec(heard);
            if (!match) continue;
            const command = build(match);
            if (SAVED_TOOLS.includes(command.tool) && (/\?/.test(transcript) || !/^[1-9][0-9]{0,77}$/.test(command.input.artwork_id) || BigInt(command.input.artwork_id) >= 2n ** 256n)) return null;
            if (isWrite(command)) {
                // Never execute a financial phrase extracted from a negation,
                // question, multiple requests, truncated number or quoted text.
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
        if (!isWrite(command) && !SAVED_TOOLS.includes(command?.tool)) return true;
        const value = Number(confidence);
        return !(Number.isFinite(value) && value > 0 && value < WRITE_CONFIDENCE);
    }

    const TEXT = {
        en: {
            title: 'ArtSoul commands',
            hint: 'Type or speak one command in English or Russian. Wallet actions still need your review and signature.',
            input: 'Your command', placeholder: 'Search moon, open artwork 31…',
            send: 'Send', microphone: 'Use microphone', stop: 'Stop listening',
            close: 'Close commands', examples: 'Examples',
            noSpeech: 'Voice is unavailable in this browser. You can type instead.',
            working: 'Working… If your wallet opens, review the request there. Closing this panel does not cancel a submitted transaction.',
            empty: 'Enter a command first.', changed: 'Wallet changed. Enter a new command for this account.',
            tooLong: 'Use one command of up to 300 characters.',
            listening: 'Listening… say one command.',
            notHeard: 'Nothing was heard. Press the microphone and try again.',
            notUnderstood: heard => `"${heard}" is not a command I know. Open Examples or type "help".`,
            unsure: heard => `I am not sure I heard "${heard}" correctly. Please repeat the action.`,
            heard: heard => `Heard: "${heard}"`,
            unavailable: 'Commands are not available on this page.',
            notice: 'Voice commands use your browser\'s speech recognition. In Chrome, the audio is sent to Google to be transcribed. ArtSoul does not record, store or receive it.\n\nTurn on voice commands?',
            micBlocked: 'The microphone is blocked for this site. Allow it in the browser settings to use voice.',
            help: 'Try: "save artwork 31", "remove artwork 31 from favorites", "what auctions are open", "tell me about artwork 31", "who owns artwork 19", "my activity", ' +
                '"bid 0.05 on artwork 31", "pay for artwork 30", "list artwork 19 for 0.002", "buy artwork 19", ' +
                '"start an auction on artwork 31 at 0.005 for 36 hours", "withdraw", "stop using my wallet".',
            submitted: 'Done. The wallet approved it and the transaction was sent.',
            refused: reason => `Not done. ${reason}`,
            noWallet: 'No wallet is connected. Connect one first.',
            error: message => `That did not work: ${message}`
        },
        ru: {
            title: 'Команды ArtSoul',
            hint: 'Напишите или произнесите одну команду по-русски или по-английски. Действия с кошельком требуют вашей проверки и подписи.',
            input: 'Ваша команда', placeholder: 'Найди луна, открой работу 31…',
            send: 'Отправить', microphone: 'Включить микрофон', stop: 'Остановить запись',
            close: 'Закрыть команды', examples: 'Примеры',
            noSpeech: 'Голос недоступен в этом браузере. Можно написать команду.',
            working: 'Выполняется… Если откроется кошелёк, проверьте запрос в нём. Закрытие этого окна не отменяет отправленную транзакцию.',
            empty: 'Сначала введите команду.', changed: 'Кошелёк изменён. Введите новую команду для этого аккаунта.',
            tooLong: 'Введите одну команду длиной до 300 символов.',
            listening: 'Слушаю… скажите одну команду.',
            notHeard: 'Ничего не услышано. Нажмите микрофон и попробуйте снова.',
            notUnderstood: heard => `«${heard}» — такой команды нет. Откройте примеры или напишите «помощь».`,
            unsure: heard => `Не уверен, что расслышал «${heard}». Повторите действие, пожалуйста.`,
            heard: heard => `Услышано: «${heard}»`,
            unavailable: 'Команды недоступны на этой странице.',
            notice: 'Голосовые команды используют распознавание речи вашего браузера. В Chrome звук отправляется в Google для распознавания. ArtSoul его не записывает, не хранит и не получает.\n\nВключить голосовые команды?',
            micBlocked: 'Микрофон для этого сайта заблокирован. Разрешите его в настройках браузера.',
            help: 'Скажите: «добавь работу 31 в избранное», «убери работу 31 из избранного», «какие аукционы открыты», «расскажи о работе 31», «кто владелец работы 19», «мой профиль», ' +
                '«ставка 0,05 на работу 31», «оплати работу 30», «выстави работу 19 за 0,002», «купи работу 19», ' +
                '«запусти аукцион на работу 31 за 0,005 на 36 часов», «выведи деньги», «стоп, не трогай кошелёк».',
            submitted: 'Готово. Кошелёк подтвердил, транзакция отправлена.',
            refused: () => 'Не выполнено. Причина показана на экране.',
            noWallet: 'Кошелёк не подключён. Сначала подключите его.',
            error: () => 'Не получилось. Подробности на экране.'
        }
    };

    function hoursText(value, lang) {
        const hours = Number(value);
        if (!Number.isFinite(hours)) return '';
        const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
        return lang === 'ru' ? `${rounded} ч` : `${rounded} hours`;
    }

    /**
     * What to say and what to show for one tool result. Spoken text stays short;
     * the panel carries the detail, so a person who cannot hear the reply still
     * gets all of it.
     */
    function describeResult(tool, result, lang) {
        const t = TEXT[lang === 'ru' ? 'ru' : 'en'];
        const ru = lang === 'ru';
        const data = result || {};
        if (data.error) return { say: t.error(data.error), show: data.error };
        if (data.connected === false) return { say: t.noWallet, show: data.reason || t.noWallet };
        if (data.submitted === true) return { say: t.submitted, show: `${t.submitted}${data.transaction_hash ? ` ${data.transaction_hash}` : ''}` };
        if (data.submitted === false || data.prepared === false || data.opened === false || data.updated === false) {
            const reason = data.reason || '';
            return { say: t.refused(reason), show: reason };
        }

        switch (tool) {
        case 'add_to_saved':
        case 'remove_from_saved': {
            if (data.updated !== true || typeof data.saved !== 'boolean') return { say: t.error('Saved could not be confirmed.'), show: 'Saved could not be confirmed. Please try again.' };
            const text = ru
                ? `Работа ${data.artwork_id} ${data.saved ? 'в избранном' : 'убрана из избранного'}.`
                : `Artwork ${data.artwork_id} ${data.saved ? 'is in Saved' : 'is removed from Saved'}.`;
            return { say: text, show: text };
        }
        case 'find_active_auctions': {
            const items = Array.isArray(data.auctions) ? data.auctions : [];
            const top = items.slice(0, 3).map(item =>
                ru ? `${item.title}, до конца ${hoursText(item.hours_remaining, lang)}` : `${item.title}, ends in ${hoursText(item.hours_remaining, lang)}`);
            const head = ru ? `Открыто аукционов: ${data.count || 0}.` : `${data.count || 0} auctions are open.`;
            const text = [head, ...top].join(' ');
            return { say: text, show: text };
        }
        case 'search_artworks': {
            const items = Array.isArray(data.results) ? data.results : [];
            const head = ru ? `Найдено: ${data.count || 0}.` : `Found ${data.count || 0}.`;
            const text = [head, items.slice(0, 3).map(item => `${item.title} (#${item.artwork_id})`).join(', ')].join(' ');
            return { say: text, show: text };
        }
        case 'get_artwork':
        case 'get_auction_state': {
            const text = ru
                ? `${data.title}. Статус: ${data.status}. Текущая ставка: ${data.current_bid_eth} ETH.`
                : `${data.title}. Status: ${data.status}. Current bid: ${data.current_bid_eth} ETH.`;
            return { say: text, show: text };
        }
        case 'get_artwork_provenance': {
            const short = value => (value ? `${String(value).slice(0, 6)}…${String(value).slice(-4)}` : '—');
            const show = `Creator ${short(data.creator)} · First Collector ${short(data.first_collector)} · Owner ${short(data.owner)}`;
            return { say: ru ? 'Создатель, первый коллекционер и владелец показаны на экране.' : 'Creator, First Collector and Owner are shown on screen.', show };
        }
        case 'get_my_activity': {
            const needs = Array.isArray(data.needs_attention) ? data.needs_attention : [];
            const total = Number(data.needs_attention_count ?? needs.length) || 0;
            const head = ru
                ? `Создано: ${data.created?.count || 0}. Во владении: ${data.owned?.count || 0}. Листингов: ${data.resale_listings?.count || 0}. Требует внимания: ${total}.`
                : `You created ${data.created?.count || 0}, own ${data.owned?.count || 0}, and have ${data.resale_listings?.count || 0} listings. ${total} things need you.`;
            const show = [head, ...needs.slice(0, 5).map(entry => `• ${entry.why} (${entry.tool}${entry.artwork_id ? ` #${entry.artwork_id}` : ''})`)].join('\n');
            return { say: head, show };
        }
        case 'open_artwork': {
            const text = ru ? `Открываю ${data.title}.` : `Opening ${data.title}.`;
            return { say: text, show: text };
        }
        case 'revoke_wallet_access': {
            const text = data.revoked
                ? (ru ? 'Доступ агента к кошельку убран.' : 'The agent can no longer open your wallet.')
                : (data.note || '');
            return { say: text, show: text };
        }
        default: {
            const text = data.instruction || data.note || JSON.stringify(data);
            return { say: ru ? 'Готово. Подробности на экране.' : 'Done. Details are on screen.', show: text };
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

    window.ArtSoulVoice = Object.freeze({
        parseCommand,
        describeResult,
        mayRun,
        isWrite,
        WRITE_TOOLS,
        WRITE_CONFIDENCE
    });

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!window.ArtSoulWebMCP || typeof document === 'undefined') return;

    function mount() {
        const launcher = document.querySelector('.artsoul-voice-button');
        if (launcher?.dataset.commandsInitialized) return;
        const agent = window.ArtSoulWebMCP;
        const tools = new Map(agent.createTools(agent.browserDependencies()).map(tool => [tool.name, tool]));

        let lang = readStored(LANG_KEY) === 'ru' ? 'ru'
            : readStored(LANG_KEY) === 'en' ? 'en'
                : (String(navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en');
        let recognition = null;
        let busy = false;
        let generation = 0;
        let audioGeneration = 0;
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
            '<button type="button" class="artsoul-voice-lang" data-lang="en">EN</button>' +
            '<button type="button" class="artsoul-voice-lang" data-lang="ru">RU</button>' +
            '<button type="button" class="artsoul-voice-close">×</button>' +
            '</div>' +
            '<p class="artsoul-voice-hint" id="artsoulVoiceHint"></p>' +
            '<form class="artsoul-voice-form">' +
            '<label for="artsoulVoiceInput"></label>' +
            '<input id="artsoulVoiceInput" type="text" maxlength="300" autocomplete="off" aria-describedby="artsoulVoiceHint">' +
            '<div class="artsoul-voice-controls"><button type="button" class="artsoul-voice-mic" aria-pressed="false"></button>' +
            '<button type="submit" class="artsoul-voice-send"></button></div>' +
            '</form>' +
            '<p class="artsoul-voice-support"></p>' +
            '<p class="artsoul-voice-heard"></p>' +
            '<p class="artsoul-voice-answer" role="status" aria-live="polite"></p>' +
            '<details class="artsoul-voice-examples"><summary></summary><p></p></details>';

        const heardEl = panel.querySelector('.artsoul-voice-heard');
        const answerEl = panel.querySelector('.artsoul-voice-answer');
        const input = panel.querySelector('input');
        const mic = panel.querySelector('.artsoul-voice-mic');
        const send = panel.querySelector('.artsoul-voice-send');
        const close = panel.querySelector('.artsoul-voice-close');

        function label() {
            const t = TEXT[lang];
            button.setAttribute('aria-label', t.title);
            panel.setAttribute('lang', lang);
            panel.querySelector('h2').textContent = t.title;
            panel.querySelector('.artsoul-voice-hint').textContent = t.hint;
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
                el.setAttribute('aria-pressed', String(el.dataset.lang === lang));
            });
            controls();
        }

        function show(heard, answer) {
            heardEl.textContent = heard || '';
            answerEl.textContent = answer || '';
        }

        function controls() {
            input.disabled = busy || Boolean(recognition);
            send.disabled = busy || Boolean(recognition);
            mic.disabled = busy || typeof Recognition !== 'function';
            panel.querySelectorAll('.artsoul-voice-lang').forEach(el => { el.disabled = busy; });
            panel.querySelector('form').setAttribute('aria-busy', String(busy));
        }

        function silence() {
            audioGeneration++;
            try { window.speechSynthesis?.cancel(); } catch { /* Text remains available. */ }
        }

        function closePanel() {
            stopListening();
            silence();
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.focus({ preventScroll: true });
        }

        function speak(textToSay) {
            try {
                if (!window.speechSynthesis || !textToSay || panel.hidden || document.visibilityState === 'hidden') return;
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(textToSay);
                utterance.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
                window.speechSynthesis.speak(utterance);
            } catch {
                // The panel already shows the answer; silence is not a failure.
            }
        }

        function setListening(on) {
            mic.setAttribute('aria-pressed', String(on));
            mic.textContent = on ? TEXT[lang].stop : TEXT[lang].microphone;
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
        }

        async function handle(transcript, confidence, spoken = false) {
            if (busy) return;
            silence();
            const t = TEXT[lang];
            const audio = audioGeneration;
            const reply = (heard, answer, say = answer) => {
                show(heard, answer);
                if (spoken && audio === audioGeneration) speak(say);
            };
            if (transcript.length > 300) { reply('', t.tooLong); return; }
            if (!transcript.trim()) { reply('', t.empty); return; }
            const command = parseCommand(transcript, lang);
            if (!command) {
                const text = t.notUnderstood(transcript);
                reply(transcript, text);
                return;
            }
            if (command.help) {
                reply(transcript, t.help);
                return;
            }
            if (!mayRun(command, confidence)) {
                const text = t.unsure(transcript);
                reply(transcript, text);
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
            try {
                const result = JSON.parse(await tool.execute(command.input));
                if (current !== generation || currentWallet !== walletIdentity()) return;
                const resultText = describeResult(command.tool, result, lang);
                reply(transcript, resultText.show, resultText.say);
            } catch (error) {
                if (current !== generation || currentWallet !== walletIdentity()) return;
                const message = (error && error.message) || String(error);
                reply(transcript, message, t.error(message));
            } finally {
                busy = false;
                controls();
            }
        }

        function start() {
            if (busy || typeof Recognition !== 'function') return;
            silence();
            if (recognition) {
                stopListening();
                return;
            }
            if (readStored(NOTICE_KEY) !== 'accepted') {
                // The browser's own dialog, like the wallet grant: a human click
                // on text that says where the audio goes.
                if (!window.confirm(TEXT[lang].notice)) return;
                writeStored(NOTICE_KEY, 'accepted');
            }

            const session = new Recognition();
            recognition = session;
            session.lang = lang === 'ru' ? 'ru-RU' : 'en-US';
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
                stopListening();
                const code = event && event.error;
                show('', code === 'not-allowed' || code === 'service-not-allowed' ? TEXT[lang].micBlocked : TEXT[lang].notHeard);
            };
            session.onend = () => {
                if (recognition !== session || panel.hidden) return;
                stopListening();
                if (!answered) show('', TEXT[lang].notHeard);
            };

            setListening(true);
            show('', TEXT[lang].listening);
            try {
                session.start();
            } catch {
                stopListening();
                show('', TEXT[lang].notHeard);
            }
        }

        button.addEventListener('click', () => {
            if (!panel.hidden) { closePanel(); return; }
            panel.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            (input.disabled ? close : input).focus({ preventScroll: true });
        });
        mic.addEventListener('click', start);
        close.addEventListener('click', closePanel);
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePanel(); }
        });
        panel.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            if (busy || recognition) return;
            void handle(input.value, 1);
        });
        panel.querySelectorAll('.artsoul-voice-lang').forEach(el => {
            el.addEventListener('click', () => {
                if (busy) return;
                stopListening();
                silence();
                lang = el.dataset.lang === 'ru' ? 'ru' : 'en';
                writeStored(LANG_KEY, lang);
                label();
                show('', '');
            });
        });
        // Never listen in a tab nobody is looking at.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') { stopListening(); silence(); }
        });
        function clearAccount() {
            generation++;
            stopListening();
            silence();
            input.value = '';
            show('', TEXT[lang].changed);
        }
        window.addEventListener('artsoul:wallet-state-changed', () => {
            const next = walletIdentity();
            if (next !== wallet) { wallet = next; clearAccount(); }
        });
        window.addEventListener('artsoul:auth-state-changed', () => { clearAccount(); show('', ''); });
        window.addEventListener('pagehide', () => {
            clearAccount();
            show('', '');
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        });

        label();
        document.body.appendChild(panel);
        if (!launcher) document.body.appendChild(button);
    }

    // The deferred script runs after the static header. Binding the existing
    // launcher immediately avoids a visible but unresponsive idle-time control.
    mount();
})();
