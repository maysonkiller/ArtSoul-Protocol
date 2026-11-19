import { parseUserEthAmount } from '../auction/eth-amount.js';

// Form suggestions only. Never use the durable publication journal here.
const KEY = 'artsoul.command.publication-draft';
const MAX_AGE = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const refused = reason => ({ prepared: false, submitted: false, reason });

export function validateCommandDraft(input, { partial = false } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['title', 'description', 'start_price_eth'].includes(key) && !(partial && key === 'duration_hours'))) {
        throw new Error('Choose a publication field to edit.');
    }
    const draft = {};
    if (!partial || input.title !== undefined) {
        if (typeof input.title !== 'string' || !input.title.trim() || Array.from(input.title).length > 300) {
            throw new Error('Enter a draft title of 1 to 300 characters.');
        }
        draft.title = input.title.trim().replace(/\s+/g, ' ');
    }
    if (input.description !== undefined) {
        if (typeof input.description !== 'string' || Array.from(input.description).length > 1000) {
            throw new Error('Keep the draft description within 1000 characters.');
        }
        draft.description = input.description.trim();
    }
    if (input.start_price_eth !== undefined) draft.start_price_eth = parseUserEthAmount(input.start_price_eth).eth;
    if (input.duration_hours !== undefined) {
        if (![24, 36, 48].includes(input.duration_hours)) throw new Error('Choose 24, 36 or 48 hours.');
        draft.duration_hours = input.duration_hours;
    }
    return draft;
}

// Called only on Publish. Dictated values stay data even if they contain commands.
export function parsePublicationTurn(transcript, lang, pendingField) {
    const text = transcript.trim();
    const ru = lang === 'ru';
    const revise = (field, value) => ({ tool: 'revise_publication_draft', input: { field, value } });
    if (pendingField && /^(cancel|i.ll type it|отмена|(?:я )?сам(?:а)? (?:введу|впишу))[.!]?$/i.test(text)) {
        return { message: ru ? 'Можно заполнить поле вручную.' : 'You can type directly in the form.' };
    }
    if (pendingField) return revise(pendingField, text);
    if (/^(check (?:my |the )?title|проверь (?:мо[её] )?название)[.!?]?$/i.test(text)) {
        return { tool: 'revise_publication_draft', input: { field: 'title' } };
    }
    const edit = ru
        ? /^(?:(?:исправь|измени|запиши|поставь|продиктую)\s+)?(название|описание)(?![\p{L}\p{N}_])(?:\s+на\s+|\s*[:—–-]\s*|\s+)?(.*)$/iu.exec(text)
        : /^(?:(?:set|change|correct|dictate)\s+(?:the\s+)?)?(title|description)\b(?:\s+to\s+|\s*[:—–-]\s*|\s+)?(.*)$/i.exec(text);
    if (edit) {
        const field = /^(название|title)$/i.test(edit[1]) ? 'title' : 'description';
        if (edit[2]) return revise(field, edit[2]);
        return { nextField: field, message: ru
            ? 'Продиктуйте значение, введите его здесь или скажите «отмена».' : 'Say the wording, type it here, or say “cancel”.' };
    }
    const duration = ru ? /^(?:(?:давай|поставь|выбери|измени длительность)\s+)?(?:на\s+)?(\d+)\s*час(?:а|ов)?[.!]?$/iu.exec(text)
        : /^(?:(?:set|choose|change)\s+)?(?:duration\s+(?:to\s+)?)?(\d+)\s*hours?[.!]?$/i.exec(text);
    return duration ? revise('duration_hours', duration[1]) : null;
}

export function stageCommandDraft(input, env) {
    let draft;
    try { draft = validateCommandDraft(input); } catch (error) { return refused(error.message); }
    if (/^\/upload(?:\.html)?\/?$/.test(env.pathname)) {
        if (typeof env.showDraft !== 'function') return refused('Publish is still loading. Try again without reloading this page.');
        return env.showDraft(draft);
    }
    try {
        const id = env.randomId();
        if (!UUID.test(id)) throw new Error('Invalid draft reference');
        env.storage.setItem(KEY, JSON.stringify({ id, created: env.now(), wallet: env.wallet || '', draft }));
        env.openPath(`/upload#command-draft=${id}`);
        return { prepared: true, submitted: false, review_required: true };
    } catch {
        return refused('The draft could not be transferred. Open Publish and enter the details there.');
    }
}

export function consumeCommandDraft(env) {
    const match = /^#command-draft=(.+)$/.exec(env.hash || '');
    if (!match) return null;
    env.clearHash();
    try {
        const raw = env.storage.getItem(KEY);
        env.storage.removeItem(KEY); // Consume once, including malformed or expired records.
        if (!UUID.test(match[1]) || !raw || raw.length > 12000) return null;
        const saved = JSON.parse(raw);
        const age = env.now() - saved.created;
        if (saved.id !== match[1] || !Number.isFinite(saved.created) || age < 0 || age > MAX_AGE ||
            typeof saved.wallet !== 'string' || (saved.wallet && !/^0x[0-9a-f]{40}$/.test(saved.wallet))) return null;
        return { draft: validateCommandDraft(saved.draft), wallet: saved.wallet };
    } catch { return null; }
}
