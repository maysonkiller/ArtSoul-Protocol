const STORAGE_KEY = 'artsoul_unverified_donations_v1';
const LIMIT = 20;
const HASH = /^0x[0-9a-f]{64}$/i;
const KEY = /^84532:0x[0-9a-f]{40}:[1-9]\d{0,77}:0x[0-9a-f]{40}:0x[0-9a-f]{40}$/;

export function donationIdentityKey({ chainId, deployment, artworkId, creator, wallet }) {
    const key = [chainId, deployment, artworkId, creator, wallet].join(':').toLowerCase();
    return KEY.test(key) ? key : '';
}

export function createDonationOperationStore(storage) {
    const records = new Map(), listeners = new Map();
    try {
        const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
        if (Array.isArray(saved)) for (const [key, hash] of saved.slice(0, LIMIT)) {
            if (KEY.test(key) && HASH.test(hash)) records.set(key, { status: 'unverified', hash });
        }
    } catch { /* Private browsing can deny storage; current-page guards remain. */ }
    function publish(key) {
        try {
            storage?.setItem(STORAGE_KEY, JSON.stringify([...records]
                .filter(([, record]) => record.hash && record.status !== 'confirmed')
                .map(([identity, record]) => [identity, record.hash])));
        } catch { /* A storage failure must not discard an in-flight payment. */ }
        for (const listener of listeners.get(key) || []) listener(records.get(key) || null);
    }
    return {
        read: key => records.get(key) || null,
        begin(key) {
            if (!KEY.test(key) || records.has(key)) return false;
            if (records.size >= LIMIT) {
                const completed = [...records].find(([, record]) => record.status === 'confirmed');
                if (!completed) throw new Error('Check your unresolved support transactions before sending more.');
                records.delete(completed[0]);
            }
            records.set(key, { status: 'pending', hash: '' });
            publish(key);
            return true;
        },
        update(key, record) {
            if (!records.has(key) || !['pending', 'confirmed', 'unverified', 'reverted'].includes(record.status) ||
                (record.hash && !HASH.test(record.hash))) return;
            records.set(key, { ...record });
            publish(key);
        },
        clear(key) { records.delete(key); publish(key); },
        subscribe(key, listener) {
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key).add(listener);
            return () => {
                const group = listeners.get(key);
                group?.delete(listener);
                if (!group?.size) listeners.delete(key);
            };
        }
    };
}

let storage;
try { storage = globalThis.sessionStorage; } catch { /* Storage is optional. */ }
export const donationOperations = createDonationOperationStore(storage);
