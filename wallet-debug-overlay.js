// ============================================
// ARTSOUL WALLET DEBUG OVERLAY
// On-screen mirror of the walletDebugLog stream for devices without a
// devtools console (mobile Safari/Chrome). Loaded ONLY when wallet debug
// is enabled (?walletdebug=1 or the persisted artsoul_wallet_debug flag) —
// see the tiny inline loader in each page <head>.
//
// Read-only diagnostics: it never calls into wallet logic and persists
// nothing. Entries logged before this script mounts are recovered from the
// walletDebugEntries buffer exposed via window.ArtSoulWalletDebug.snapshot(),
// then new entries are drained by sequence number on a short poll.
// ============================================
(function () {
    'use strict';

    if (window.__artsoulWalletDebugOverlay) return;
    window.__artsoulWalletDebugOverlay = true;

    const POLL_INTERVAL_MS = 400;
    const MAX_RENDERED_LINES = 600;
    const RENDER_DETAIL_LIMIT = 500;
    const STORAGE_FRAGMENTS = ['walletconnect', 'wc@', 'reown', 'appkit', 'wagmi'];

    const lines = [];
    let lastSeenSequence = 0;
    let root = null;
    let logElement = null;
    let countElement = null;
    let collapsed = false;

    function maskAddress(value) {
        return String(value).replace(/0x[a-fA-F0-9]{40}/g, (address) => `${address.slice(0, 6)}...${address.slice(-4)}`);
    }

    function stringifyDetail(detail) {
        if (detail === null || detail === undefined) return '';
        try {
            return maskAddress(JSON.stringify(detail));
        } catch {
            return maskAddress(String(detail));
        }
    }

    function clockTime(isoTime) {
        const match = /T(\d{2}:\d{2}:\d{2}\.\d{3})/.exec(isoTime || '');
        return match ? match[1] : (isoTime || '');
    }

    function addLine(step, detail = null, time = new Date().toISOString(), elapsedMs = null) {
        const line = { time, elapsedMs, step, detailText: stringifyDetail(detail) };
        lines.push(line);
        if (lines.length > 2000) lines.shift();
        renderLine(line);
    }

    // ---- overlay's own context lines are tagged to stand apart from the
    // walletDebugLog stream they are interleaved with ----
    function addContextLine(step, detail = null) {
        addLine(`[overlay] ${step}`, detail);
    }

    // ============================================
    // WALLET DEBUG BUFFER DRAIN
    // ============================================

    function drainWalletDebugBuffer() {
        const api = window.ArtSoulWalletDebug;
        if (!api || typeof api.snapshot !== 'function') return;
        let entries;
        try {
            entries = api.snapshot();
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry || typeof entry.sequence !== 'number' || entry.sequence <= lastSeenSequence) continue;
            lastSeenSequence = entry.sequence;
            addLine(entry.step, entry.detail, entry.time, entry.elapsedMs);
        }
    }

    // ============================================
    // PAGE-LOAD CONTEXT
    // ============================================

    function appKitScriptVersion() {
        const script = document.querySelector('script[src*="appkit-init.js"]');
        if (!script) return 'script tag not found';
        const src = script.getAttribute('src') || '';
        const match = /\?v=([\w.-]+)/.exec(src);
        return match ? `v=${match[1]}` : src;
    }

    function readLocalWalletHint() {
        try {
            const stored = localStorage.getItem('artsoul_wallet');
            return stored ? maskAddress(stored) : 'absent';
        } catch {
            return 'unreadable';
        }
    }

    function walletConnectLocalStorageSummary() {
        try {
            const keys = Object.keys(localStorage).filter((key) => (
                STORAGE_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment))
            ));
            const sessionKeys = keys.filter((key) => key.toLowerCase().includes('session'));
            let nonEmptySession = false;
            for (const key of sessionKeys) {
                const value = localStorage.getItem(key);
                if (!value) continue;
                try {
                    const parsed = JSON.parse(value);
                    if (Array.isArray(parsed) ? parsed.length > 0 : parsed && Object.keys(parsed).length > 0) {
                        nonEmptySession = true;
                    }
                } catch {
                    nonEmptySession = true;
                }
            }
            return { sdkKeyCount: keys.length, sessionKeyCount: sessionKeys.length, nonEmptySession };
        } catch {
            return { unreadable: true };
        }
    }

    // The WalletConnect SDK persists sessions in localStorage under
    // "wc@2:client:<version>//session" (a JSON array of session records).
    // This key is the authoritative storage truth for "can the session be
    // restored on the next page load" — not IndexedDB.
    function coreSessionRecordSummary() {
        try {
            const sessionKey = Object.keys(localStorage).find((key) => /^wc@2:client:.*\/\/session$/i.test(key)) || null;
            if (!sessionKey) return { sessionKey: null, recordCount: 0 };
            let recordCount = null;
            try {
                const parsed = JSON.parse(localStorage.getItem(sessionKey));
                if (Array.isArray(parsed)) recordCount = parsed.length;
                else if (parsed && typeof parsed === 'object') recordCount = Object.keys(parsed).length;
                else recordCount = 0;
            } catch {
                recordCount = 'unparsed';
            }
            return { sessionKey, recordCount };
        } catch {
            return { unreadable: true };
        }
    }

    function logPageContext() {
        addContextLine('page loaded', {
            page: window.location.pathname,
            appkitInit: appKitScriptVersion(),
            referrer: document.referrer || null
        });
        addContextLine('localStorage artsoul_wallet', { value: readLocalWalletHint() });
        addContextLine('WalletConnect localStorage keys', walletConnectLocalStorageSummary());
        addContextLine('core session record (SDK localStorage)', coreSessionRecordSummary());
        probeIndexedDbSessionRecord();
    }

    // ============================================
    // CORE SESSION INDEXEDDB PROBE
    // Enumerates existing wallet SDK databases only (indexedDB.databases()
    // never creates one) and looks for a non-empty record whose key mentions
    // "session". Strictly read-only.
    // ============================================

    function isNonEmptySessionValue(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed) && Object.keys(parsed).length > 0;
            } catch {
                return value.length > 0;
            }
        }
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
    }

    function databaseHasSessionRecord(name) {
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const timer = setTimeout(() => finish(false), 3000);
            let request;
            try {
                request = indexedDB.open(name);
            } catch {
                clearTimeout(timer);
                finish(false);
                return;
            }
            request.onerror = () => {
                clearTimeout(timer);
                finish(false);
            };
            request.onsuccess = () => {
                const db = request.result;
                const close = (value) => {
                    clearTimeout(timer);
                    try { db.close(); } catch { /* already closed */ }
                    finish(value);
                };
                try {
                    const storeNames = Array.from(db.objectStoreNames || []);
                    if (!storeNames.length) {
                        close(false);
                        return;
                    }
                    const tx = db.transaction(storeNames, 'readonly');
                    let found = false;
                    storeNames.forEach((storeName) => {
                        const cursorRequest = tx.objectStore(storeName).openCursor();
                        cursorRequest.onsuccess = () => {
                            const cursor = cursorRequest.result;
                            if (!cursor || found) return;
                            const key = typeof cursor.key === 'string' ? cursor.key.toLowerCase() : '';
                            if (key.includes('session') && isNonEmptySessionValue(cursor.value)) {
                                found = true;
                                return;
                            }
                            cursor.continue();
                        };
                    });
                    tx.oncomplete = () => close(found);
                    tx.onerror = () => close(found);
                    tx.onabort = () => close(found);
                } catch {
                    close(false);
                }
            };
        });
    }

    // Best effort only: the SDK's browser storage is localStorage, and iOS
    // can return an empty indexedDB.databases() list even when databases
    // exist. An empty result here is NOT evidence that the session is gone —
    // read "core session record (SDK localStorage)" above instead.
    async function probeIndexedDbSessionRecord() {
        if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
            addContextLine('core session in IndexedDB (best effort)', { supported: false });
            return;
        }
        try {
            const databases = (await indexedDB.databases()).filter((db) => (
                db.name && STORAGE_FRAGMENTS.some((fragment) => db.name.toLowerCase().includes(fragment))
            ));
            if (databases.length === 0) {
                addContextLine('core session in IndexedDB (best effort)', {
                    databases: [],
                    note: 'iOS may hide IndexedDB; localStorage probe is authoritative'
                });
                return;
            }
            let coreSessionRecordPresent = false;
            const probed = [];
            for (const info of databases) {
                const hasSession = await databaseHasSessionRecord(info.name);
                probed.push(`${info.name}=${hasSession ? 'session' : 'empty'}`);
                if (hasSession) coreSessionRecordPresent = true;
            }
            addContextLine('core session in IndexedDB (best effort)', { coreSessionRecordPresent, databases: probed });
        } catch (error) {
            addContextLine('core session IndexedDB probe failed', { message: error?.message || String(error) });
        }
    }

    // ============================================
    // WALLET STATE EVENTS
    // The dispatch is synchronous, so a stack captured inside the listener
    // still contains the dispatcher's frames — that is the "source" of the
    // state change without touching wallet code.
    // ============================================

    function dispatchSourceHint() {
        const stack = String(new Error().stack || '').split('\n')
            .map((frame) => frame.trim())
            .filter((frame) => frame && !frame.includes('wallet-debug-overlay'))
            .slice(1, 5)
            .map((frame) => frame.replace(/^at\s+/, '').replace(window.location.origin, ''));
        return stack.join(' | ') || null;
    }

    ['artsoul:wallet-state-changed', 'artsoul:wallet-state-settled'].forEach((eventName) => {
        window.addEventListener(eventName, (event) => {
            addContextLine(eventName.replace('artsoul:', ''), {
                ...(event.detail || {}),
                source: dispatchSourceHint()
            });
        });
    });

    // ============================================
    // UI
    // ============================================

    const PALETTE = {
        background: '#101216',
        surface: '#181b21',
        border: '#31343c',
        text: '#d9dde3',
        muted: '#8b919c',
        accent: '#7fd7c4'
    };

    function styleButton(button) {
        button.type = 'button';
        button.style.cssText = [
            'appearance:none',
            `background:${PALETTE.surface}`,
            `color:${PALETTE.text}`,
            `border:1px solid ${PALETTE.border}`,
            'border-radius:5px',
            'font:inherit',
            'padding:2px 8px',
            'cursor:pointer',
            'line-height:1.4'
        ].join(';');
    }

    function renderLine(line) {
        if (!logElement) return;
        const element = document.createElement('div');
        element.style.cssText = `padding:1px 0;border-bottom:1px solid ${PALETTE.surface};word-break:break-word`;
        const detailText = line.detailText.length > RENDER_DETAIL_LIMIT
            ? `${line.detailText.slice(0, RENDER_DETAIL_LIMIT)}…`
            : line.detailText;
        const elapsed = typeof line.elapsedMs === 'number' ? ` +${line.elapsedMs}ms` : '';
        element.textContent = `${clockTime(line.time)}${elapsed} ${line.step}${detailText ? ` ${detailText}` : ''}`;
        const stick = logElement.scrollTop + logElement.clientHeight >= logElement.scrollHeight - 40;
        logElement.appendChild(element);
        while (logElement.childElementCount > MAX_RENDERED_LINES) {
            logElement.removeChild(logElement.firstElementChild);
        }
        if (stick) logElement.scrollTop = logElement.scrollHeight;
        if (countElement) countElement.textContent = String(lines.length);
    }

    function copyLogText() {
        return lines
            .map((line) => `${line.time}${typeof line.elapsedMs === 'number' ? ` +${line.elapsedMs}ms` : ''} ${line.step}${line.detailText ? ` ${line.detailText}` : ''}`)
            .join('\n');
    }

    function copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(textarea);
            textarea.select();
            const succeeded = document.execCommand('copy');
            textarea.remove();
            succeeded ? resolve() : reject(new Error('execCommand copy failed'));
        });
    }

    function mountOverlay() {
        if (root) return;

        // The legacy full-width panel appkit-init.js renders under the same
        // flag would overlap this overlay — hide it while the overlay is up.
        const legacyPanelStyle = document.createElement('style');
        legacyPanelStyle.textContent = '#artsoul-wallet-debug{display:none !important;}';
        document.documentElement.appendChild(legacyPanelStyle);

        root = document.createElement('div');
        root.id = 'artsoul-wallet-nav-overlay';
        root.setAttribute('aria-live', 'polite');
        root.style.cssText = [
            'position:fixed',
            'left:10px',
            'bottom:10px',
            'z-index:2147483647',
            'width:min(360px,calc(100vw - 20px))',
            'font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
            `color:${PALETTE.text}`,
            `background:${PALETTE.background}`,
            `border:1px solid ${PALETTE.border}`,
            'border-radius:8px',
            'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
            'overflow:hidden'
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 8px;background:${PALETTE.surface}`;

        const title = document.createElement('span');
        title.textContent = 'WALLET DEBUG';
        title.style.cssText = `font-weight:700;color:${PALETTE.accent}`;

        countElement = document.createElement('span');
        countElement.textContent = '0';
        countElement.style.cssText = `color:${PALETTE.muted};margin-right:auto`;

        const copyButton = document.createElement('button');
        copyButton.textContent = 'Copy';
        styleButton(copyButton);
        copyButton.addEventListener('click', () => {
            copyToClipboard(copyLogText()).then(() => {
                copyButton.textContent = 'Copied ✓';
            }).catch(() => {
                copyButton.textContent = 'Copy failed';
            }).finally(() => {
                setTimeout(() => { copyButton.textContent = 'Copy'; }, 1500);
            });
        });

        logElement = document.createElement('div');
        logElement.style.cssText = [
            'max-height:34vh',
            'overflow:auto',
            'padding:6px 8px',
            'white-space:pre-wrap',
            'overscroll-behavior:contain',
            '-webkit-overflow-scrolling:touch'
        ].join(';');

        const toggleButton = document.createElement('button');
        toggleButton.textContent = '▾';
        styleButton(toggleButton);
        toggleButton.addEventListener('click', () => {
            collapsed = !collapsed;
            logElement.style.display = collapsed ? 'none' : 'block';
            toggleButton.textContent = collapsed ? '▸' : '▾';
        });

        header.appendChild(title);
        header.appendChild(countElement);
        header.appendChild(copyButton);
        header.appendChild(toggleButton);
        root.appendChild(header);
        root.appendChild(logElement);
        document.documentElement.appendChild(root);

        // Flush everything buffered before the overlay mounted.
        for (const line of lines) renderLine(line);
        // renderLine keeps the counter, but re-sync in case lines was empty.
        countElement.textContent = String(lines.length);
    }

    // ============================================
    // BOOT
    // ============================================

    function start() {
        mountOverlay();
        logPageContext();
        drainWalletDebugBuffer();
        setInterval(drainWalletDebugBuffer, POLL_INTERVAL_MS);
    }

    // Wait for the DOM so the appkit-init script tag (version string) and
    // document.body (clipboard fallback) are available; walletDebugLog
    // entries produced meanwhile stay in the appkit-init buffer.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
