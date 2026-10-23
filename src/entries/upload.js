import '../../supabase-client.js';
import '../../supabase-auth.js';
import { readAIValuation, formatAIPrice } from '../features/artwork/ai-valuation-values.js';
import { parseUserEthAmount } from '../features/auction/eth-amount.js';
import { prepareBrowserPublication } from '../features/artwork/publication-preparation.js';
import {
    ALLOWED_ARTWORK_MIME_TYPES,
    MAX_ARTWORK_UPLOAD_BYTES,
    MAX_ARTWORK_UPLOAD_MB
} from '../config/upload-policy.js';

let selectedFile = null;
        let uploading = false;
        let selectedAuctionDuration = null;
        let latestAIValuation = null;
        let latestAIValuationFormKey = '';
        let aiValuationRequestId = 0;
        let aiValuationController = null;
        let aiValuationAttemptCount = 0;
        let authorizationInProgress = false;
        let authorizedWalletAddress = '';
        let publishNavigationLocked = false;
        let currentPublishStage = 'idle';
        // registerArtwork reports the hash before it waits for the receipt, so
        // from this point on a failure means the transaction is in flight rather
        // than never sent. That difference decides what a person is told and
        // whether the pending record survives, and mapPublishError cannot see
        // the publish handler's local state.
        let submittedRegisterTxHash = '';

        const AI_ANALYSIS_TIMEOUT_MS = 20000;
        const AI_PREVIEW_MAX_DATA_URL_LENGTH = 1800000;
        const AI_TOTAL_ATTEMPT_LIMIT = 3;
        const BASE_SEPOLIA_CHAIN_ID = 84532;
        const AUCTION_CONFIRMATION_TIMEOUT_MS = 30000;
        const AUCTION_CONFIRMATION_POLL_MS = 1500;
        const SUPPORTED_FILE_TYPES = new Set(ALLOWED_ARTWORK_MIME_TYPES);

        function getTransactionErrorMessage(error, fallback) {
            return window.ArtSoulTransactionErrors?.message?.(error, fallback) ||
                error?.shortMessage ||
                error?.reason ||
                error?.message ||
                fallback;
        }

        function setTransactionButtonProcessing(button, label = 'Processing...') {
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
            button.innerHTML = `<span class="inline-flex items-center justify-center gap-2"><span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>${label}</span>`;
        }

        function restoreTransactionButton(button, originalMarkup) {
            button.removeAttribute('aria-busy');
            button.innerHTML = originalMarkup;
            updatePublishReadiness();
        }

        function normalizeArtworkTitle(value) {
            return (value || '').trim().replace(/\s+/g, ' ');
        }

        // Long enough for real collector context, short enough that the artwork
        // page stays readable without the description dominating it.
        const MAX_ARTWORK_DESCRIPTION_LENGTH = 1000;

        function validateArtworkDetails({ title, description, price }) {
            const cleanTitle = normalizeArtworkTitle(title);
            const cleanDescription = (description || '').trim().replace(/\s+/g, ' ');

            if (!cleanTitle) {
                return { fieldId: 'artTitle', message: 'Enter a title for your artwork.' };
            }

            if (!cleanDescription || Array.from(cleanDescription).length < 12) {
                return { fieldId: 'artDescription', message: 'Add a description with at least 12 characters.' };
            }

            if (Array.from(cleanDescription).length > MAX_ARTWORK_DESCRIPTION_LENGTH) {
                return { fieldId: 'artDescription', message: `Keep the description within ${MAX_ARTWORK_DESCRIPTION_LENGTH} characters.` };
            }

            try {
                parseUserEthAmount(price);
            } catch (error) {
                return { fieldId: 'artPrice', message: error.message };
            }

            return null;
        }

        function createUploadError(code, message) {
            const error = new Error(message);
            error.code = code;
            return error;
        }

        function isProjectedAuctionReady(projection, artworkId) {
            if (!projection) return false;
            const projectedArtworkId = String(projection.artwork_id ?? projection.blockchain_id ?? '').trim();
            const expectedArtworkId = String(artworkId ?? '').trim();
            if (projectedArtworkId && expectedArtworkId && projectedArtworkId !== expectedArtworkId) return false;
            return Boolean(String(projection.active_auction_id ?? projection.auction_id ?? '').trim());
        }

        function waitForDelay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function waitForAuctionConfirmation({
            transactionPromise,
            chainId,
            artworkId,
            txHash,
            timeoutMs = AUCTION_CONFIRMATION_TIMEOUT_MS,
            pollIntervalMs = AUCTION_CONFIRMATION_POLL_MS,
            readProjection = async () => window.ArtSoulDB?.getPublicProjectionArtwork?.(
                `v41:${chainId}:${artworkId}`
            ),
            now = () => Date.now(),
            sleep = waitForDelay
        }) {
            let transactionOutcome = null;
            Promise.resolve(transactionPromise).then(
                hash => { transactionOutcome = { ok: true, hash }; },
                error => { transactionOutcome = { ok: false, error }; }
            );

            const deadline = now() + timeoutMs;
            while (now() <= deadline) {
                if (transactionOutcome?.ok) {
                    return transactionOutcome.hash || txHash;
                }

                try {
                    const projection = await readProjection();
                    if (isProjectedAuctionReady(projection, artworkId)) {
                        return txHash;
                    }
                } catch (error) {
                    console.warn('Auction projection confirmation is not available yet:', error?.message || error);
                }

                const remaining = deadline - now();
                if (remaining <= 0) break;
                await sleep(Math.min(pollIntervalMs, remaining));
            }

            const pendingError = createUploadError(
                'AUCTION_CONFIRMATION_PENDING',
                'The auction transaction was submitted and is still finalizing. Check its status from your profile before trying anything again.'
            );
            pendingError.txHash = txHash;
            pendingError.cause = transactionOutcome?.error || null;
            throw pendingError;
        }

        // The artwork page cannot otherwise know it is being opened straight
        // out of a publish, so its first frame was the generic page skeleton
        // even though the only thing being waited for is the indexer catching
        // up. This says so, and the page shows the ArtSoul mark instead. It
        // survives a reload, because that wait can outlast one.
        function navigateAfterPublish(path) {
            publishNavigationLocked = false;
            const target = path.includes('?')
                ? `${path}&published=1`
                : `${path}?published=1`;
            if (typeof window.location?.assign === 'function') {
                window.location.assign(target);
            } else {
                window.location.href = target;
            }
        }

        function validateArtworkFile(file) {
            if (!file) {
                return { code: 'FILE_REQUIRED', message: 'Select an artwork file before continuing.' };
            }
            if (!SUPPORTED_FILE_TYPES.has(String(file.type || '').toLowerCase())) {
                return {
                    code: 'UNSUPPORTED_FILE_TYPE',
                    message: 'This file type is not supported. Upload a JPG, PNG, WebP, GIF, MP4, WebM, MOV, MP3, WAV, OGG, AAC, or M4A file.'
                };
            }
            if (!Number.isFinite(file.size) || file.size <= 0) {
                return { code: 'EMPTY_FILE', message: 'This file is empty. Choose a valid artwork file and try again.' };
            }
            if (file.size > MAX_ARTWORK_UPLOAD_BYTES) {
                return { code: 'FILE_TOO_LARGE', message: `This file is too large. The maximum size is ${MAX_ARTWORK_UPLOAD_MB} MB.` };
            }
            return null;
        }

        function describeAIValuationError(error) {
            const status = Number(error?.status || error?.statusCode || 0);
            const message = String(error?.message || '').toLowerCase();
            if (error?.name === 'AbortError') {
                return 'AI value guidance took too long to respond. Please try again.';
            }
            if (error?.code === 'GEMINI_RESPONSE_INVALID') {
                return 'AI returned an invalid estimate. Guidance is unavailable; please try again.';
            }
            if (status === 429 || message.includes('high demand') || message.includes('rate limit') || message.includes('limit reached')) {
                return 'AI value guidance is temporarily busy because of high demand. Please try again shortly.';
            }
            if (message.includes('wallet') || message.includes('creator')) {
                return 'Connect your wallet to request AI value guidance.';
            }
            return 'AI value guidance is temporarily unavailable. Please try again.';
        }

        function describePublishError(error) {
            const code = error?.code || '';
            if (code === 'SERVICE_ROLE_KEY_NOT_SERVICE_ROLE') {
                return 'Artwork storage is temporarily unavailable. Please try again later.';
            }
            if (code === 'MISSING_SERVICE_ROLE_KEY') {
                return 'Artwork storage is temporarily unavailable. Please try again later.';
            }
            if (code === 'STORAGE_SIGNED_UPLOAD_RLS_DENIED') {
                return 'Artwork storage could not authorize this upload. Please reconnect your wallet and try again.';
            }
            if (code === 'STORAGE_BUCKET_NOT_FOUND') {
                return 'Artwork storage is temporarily unavailable. Please try again later.';
            }
            if (code === 'INVALID_UPLOAD_PAYLOAD') {
                const reason = String(error?.reason || '').toUpperCase();
                if (reason.includes('EMPTY')) return 'This file is empty. Choose a valid artwork file and try again.';
                if (reason.includes('SIZE')) return `This file is too large. The maximum size is ${MAX_ARTWORK_UPLOAD_MB} MB.`;
                if (reason.includes('TYPE')) return 'This file type is not supported. Choose a supported image, video, or audio file.';
                return 'The selected file is not valid. Check its type and size, then try again.';
            }
            const stageMessages = {
                fingerprint: 'The selected file could not be read. Choose the file again and retry.',
                media_upload: 'The artwork file could not be stored. Check your connection and try again.',
                metadata_upload: 'The artwork details could not be stored. Please try again.',
                wallet_init: 'The connected wallet could not be prepared for publishing. Reconnect it and try again.',
                register: 'The artwork could not be registered on Base Sepolia. Please try again.',
                auction: 'The artwork was registered, but its auction could not be created. Open the artwork from your profile, then select Create New Auction on its page.'
            };
            return stageMessages[currentPublishStage] || 'The publish flow could not be completed. Please try again.';
        }

        function mapPublishError(error) {
            const code = String(error?.code || '').toUpperCase();
            const nodes = [error], seen = new Set(), codes = [], messages = [], methods = [];
            for (let i = 0; i < nodes.length && seen.size < 12; i += 1) {
                const item = nodes[i];
                if (!item || typeof item !== 'object' || seen.has(item)) continue;
                seen.add(item);
                codes.push(String(item.code || '').toUpperCase());
                messages.push(...[item.shortMessage, item.reason, item.message].filter(value => typeof value === 'string'));
                methods.push(item.payload?.method, item.info?.payload?.method);
                nodes.push(item.cause, item.error, item.info?.error, item.data, item.originalError);
            }
            const lower = messages.join(' | ').toLowerCase();
            const method = methods.find(value => typeof value === 'string' && /^[a-zA-Z_]{1,64}$/.test(value)) || '';
            const walletSubmission = method === 'eth_sendTransaction' || method === 'eth_signTransaction';

            if (codes.includes('ACTION_REJECTED') || codes.includes('4001') || lower.includes('user rejected') || lower.includes('user denied')) {
                return { code: 'USER_REJECTED', message: currentPublishStage === 'auction'
                    ? 'The auction request was rejected in your wallet. Your artwork is already registered; open it from your profile to start its auction.'
                    : 'The transaction was rejected in your wallet. No artwork was published.' };
            }
            if (lower.includes('nonce too low')) {
                return { code: 'NONCE_TOO_LOW', message: 'Your wallet has a pending transaction. Wait for it to finish, then try again.' };
            }
            if (lower.includes('insufficient funds') || lower.includes('insufficient gas') || lower.includes('not enough funds') || lower.includes('outoffunds')) {
                return { code: 'INSUFFICIENT_FUNDS', message: 'Insufficient ETH on Base Sepolia to publish this artwork. Top up your wallet and try again.' };
            }
            const explicitRevert = lower.includes('execution reverted') || error?.revert || (error?.reason && code === 'CALL_EXCEPTION');
            const networkChanged = lower.includes('network was changed') || lower.includes('network changed') || codes.includes('4901');
            const sessionUnavailable = codes.some(value => ['CORE_METHOD_NOT_APPROVED', 'CORE_METHOD_RUNTIME_MISMATCH', 'CORE_SIGN_CLIENT_UNAVAILABLE', '4100'].includes(value));
            if (!explicitRevert && currentPublishStage === 'register' && submittedRegisterTxHash &&
                (networkChanged || sessionUnavailable || lower.includes('wallet changed'))) {
                return { code: 'REGISTRATION_UNCONFIRMED', message: 'The registration was submitted before the wallet connection changed. It may still complete. Check this artwork in your profile before publishing it again.' };
            }
            if (sessionUnavailable) {
                return { code: 'WALLET_SESSION_REQUIRED', message: 'This wallet connection cannot authorize the transaction. Disconnect and reconnect your wallet, select Base Sepolia, then try again.' };
            }
            if (lower.includes('wallet changed')) {
                return { code: 'AUTHORIZATION_WALLET_CHANGED', message: 'The wallet changed during publishing. Authorize the selected wallet again before publishing.' };
            }
            if (networkChanged) {
                return { code: 'NETWORK_CHANGED', message: 'The wallet network changed during publishing. Switch back to Base Sepolia and try again.' };
            }
            // A revert carries a reason. This one carries none, and it comes
            // from estimateGas, which means the node never executed anything:
            // ethers reports an RPC that will not answer as `missing revert
            // data` with a null reason and null data. Reported on 2026-08-21,
            // when the public Base Sepolia endpoint returned `no backend is
            // currently healthy to serve traffic` - the same call estimated
            // successfully against another endpoint at the same moment. Calling
            // that a failed transaction told the person their artwork had been
            // rejected on-chain, which had not happened and was not true.
            const networkWentQuiet = !explicitRevert && (lower.includes('missing revert data')
                || lower.includes('no backend is currently healthy')
                || code === 'NETWORK_ERROR'
                || code === 'SERVER_ERROR'
                || code === 'TIMEOUT');
            // The same ethers errors mean opposite things on either side of the
            // broadcast. Before it, the node never took the transaction and
            // nothing exists. After it, the registration is on its way and will
            // be permanent once mined - and registration is the first of two
            // transactions, so telling someone nothing was published sends them
            // to publish the same artwork a second time.
            if ((networkWentQuiet || lower.includes('could not coalesce error')) && currentPublishStage === 'register' && submittedRegisterTxHash) {
                return {
                    code: 'REGISTRATION_UNCONFIRMED',
                    message: 'The registration was submitted to Base Sepolia and its confirmation has not come back yet. It may still complete. Open your profile and check for this artwork before publishing it again.'
                };
            }
            // A generic ethers wrapper is not proof of an RPC outage. A failed
            // wallet response can also leave submission uncertain without a hash.
            if (!explicitRevert && (walletSubmission || lower.includes('could not coalesce error'))) {
                const detailCode = codes.find(value => /^-?\d+$/.test(value)) || code;
                const details = [currentPublishStage, method, /^[A-Z_0-9-]{1,64}$/.test(detailCode) ? detailCode : '']
                    .filter(Boolean).join(' / ');
                return { code: 'WALLET_REQUEST_FAILED', message: `The wallet could not complete the publication request. Check its activity and your ArtSoul profile before trying again. If no transaction appears, reconnect your wallet and retry. Details: ${details}.` };
            }
            if (networkWentQuiet) {
                return {
                    code: 'NETWORK_UNAVAILABLE',
                    message: currentPublishStage === 'auction'
                        ? 'Your artwork is already registered, but the auction request could not be prepared. Open the artwork from your profile to start its auction.'
                        : 'The publication could not be prepared on Base Sepolia; nothing was sent and nothing was published. Wait a moment and try again.'
                };
            }
            if (code === 'CALL_EXCEPTION' || lower.includes('reverted') || lower.includes('execution reverted')) {
                return {
                    code: 'TRANSACTION_REVERTED',
                    message: currentPublishStage === 'auction'
                        ? 'The artwork was registered, but the auction transaction failed on Base Sepolia. Open the artwork from your profile, then select Create New Auction on its page.'
                        : 'The artwork registration transaction failed on Base Sepolia. No artwork was published.'
                };
            }
            if (lower.includes('no wallet provider') || (lower.includes('wallet provider') && lower.includes('not available'))) {
                return { code: 'WALLET_NOT_CONNECTED', message: 'Connect your wallet before publishing this artwork.' };
            }
            if (lower.includes('metadata upload')) {
                return { code: 'METADATA_UPLOAD_FAILED', message: 'The artwork details could not be stored. Please try again.' };
            }
            if (lower.includes('storage upload') || lower.includes('upload authorization')) {
                return { code: 'MEDIA_UPLOAD_FAILED', message: 'The artwork file could not be stored. Check your connection and try again.' };
            }
            if (lower.includes('confirmed artwork id') || lower.includes('register transaction did not return')) {
                return { code: 'REGISTRATION_INCOMPLETE', message: 'The wallet did not return a complete artwork registration confirmation. Check your profile before retrying.' };
            }
            if (lower.includes('unsupported network') || lower.includes('wrong network')) {
                return { code: 'UNSUPPORTED_NETWORK', message: 'This artwork must be published on Base Sepolia. Switch networks and try again.' };
            }
            if (lower.includes('duplicate artwork')) {
                return { code: 'DUPLICATE_ARTWORK', message: 'This file has already been published.' };
            }

            const directMessages = {
                FILE_REQUIRED: 'Select an artwork file before continuing.',
                FILE_TOO_LARGE: `This file is too large. The maximum size is ${MAX_ARTWORK_UPLOAD_MB} MB.`,
                UNSUPPORTED_FILE_TYPE: 'This file type is not supported. Choose a supported image, video, or audio file.',
                WALLET_NOT_CONNECTED: 'Connect your wallet before publishing this artwork.',
                AUTHORIZATION_REQUIRED: 'Authorize this upload with your wallet signature before publishing.',
                AUTHORIZATION_WALLET_CHANGED: 'The wallet changed during authorization. Tap Authorize and analyze again for the selected wallet.',
                UNSUPPORTED_NETWORK: 'This artwork must be published on Base Sepolia. Switch networks and try again.',
                BASE_SEPOLIA_REQUIRED: 'Base Sepolia could not be confirmed. Open your wallet, select Base Sepolia, then try again.',
                BASE_SEPOLIA_SWITCH_REJECTED: 'The network switch was declined. Select Base Sepolia in your wallet, then try again.',
                AI_UNAVAILABLE: 'AI value guidance is not ready. Request an estimate before publishing.',
                PUBLICATION_DETAILS_LOCKED: 'This file already has a saved publication attempt with different details. Restore its original details before continuing; do not create another attempt.',
                PUBLICATION_STORAGE_UNAVAILABLE: 'This browser could not safely save the publication attempt. Allow site storage and try again; no wallet request was started.',
                PUBLICATION_DRAFT_INVALID: 'The saved publication attempt could not be read safely. Do not clear it or publish the file again; contact support.',
                PUBLICATION_PREPARED_ONLY: 'Your artwork preparation is saved. Registration is not enabled for this preparation yet; no wallet request was started.',
                PUBLICATION_CONFLICT: 'This file has conflicting publication records. Your saved attempt is retained; another registration was not sent.',
                RATE_LIMITED: 'Please wait one minute before checking this publication again. Your saved attempt is retained.',
                PUBLICATION_ATTEMPT_PENDING: 'This artwork already has a registration attempt. Check your profile and wallet activity; do not publish the file again.',
                DUPLICATE_MEDIA: 'This file already has a publication or a pending attempt. Renaming it does not create a different artwork.',
                SESSION_WALLET_MISMATCH: 'Another tab changed your signed-in wallet. Sign in with this artwork creator wallet before continuing.',
                PUBLICATION_FORM_CHANGED: 'The artwork details changed during preparation. Review them and request updated AI value guidance before continuing.',
                MEDIA_PREPARATION_UNAVAILABLE: 'Publication preparation is temporarily unavailable. Your saved attempt is retained; please try again later.',
                MEDIA_PREPARATION_MISMATCH: 'The saved file or publication details do not match this attempt. Do not publish it again; contact support.',
                AUCTION_CONFIRMATION_PENDING: 'The auction transaction was submitted and is still finalizing. Check its status from your profile before trying anything again.'
            };
            if (directMessages[code]) return { code, message: directMessages[code] };

            return { code: code || 'PUBLISH_FAILED', message: describePublishError(error) };
        }

        const PENDING_ARTWORKS_KEY = 'artsoul_pending_indexer_artworks';

        function readPendingArtworks() {
            try {
                const parsed = JSON.parse(localStorage.getItem(PENDING_ARTWORKS_KEY) || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }

        function savePendingArtwork(record) {
            if (!record?.temp_id) return record;
            const now = new Date().toISOString();
            const nextRecord = {
                ...record,
                source: 'pending_indexer',
                status: 'pending_indexer',
                updated_at: now
            };
            const existing = readPendingArtworks()
                .filter(item => item?.temp_id !== nextRecord.temp_id)
                .filter(item => item?.register_tx_hash !== nextRecord.register_tx_hash || !nextRecord.register_tx_hash);
            localStorage.setItem(PENDING_ARTWORKS_KEY, JSON.stringify([nextRecord, ...existing].slice(0, 20)));
            return nextRecord;
        }

        function removePendingArtwork(tempId) {
            if (!tempId) return;
            const kept = readPendingArtworks().filter((item) => item?.temp_id !== tempId);
            localStorage.setItem(PENDING_ARTWORKS_KEY, JSON.stringify(kept));
        }

        function hasRegisterTx(record) {
            return Boolean(String(record?.register_tx_hash || '').trim());
        }

        function isBadPendingArtwork(record) {
            if (hasRegisterTx(record)) return false;
            const state = [
                record?.status,
                record?.stage,
                record?.error_code,
                record?.error_message
            ].join(' ').toLowerCase();
            return !hasRegisterTx(record) ||
                state.includes('fail') ||
                state.includes('error') ||
                state.includes('reject') ||
                state.includes('revert') ||
                state.includes('nonce');
        }

        function cleanupBadPendingCards() {
            const current = readPendingArtworks();
            const kept = current.filter(record => !isBadPendingArtwork(record));
            localStorage.setItem(PENDING_ARTWORKS_KEY, JSON.stringify(kept));
            const result = { removed: current.length - kept.length, kept: kept.length };
            console.info('ArtSoul pending-card cleanup complete:', result);
            return result;
        }

        window.ArtSoulCleanupBadPendingCards = cleanupBadPendingCards;

        function createPendingArtworkDraft({ walletAddress, title, description, price, fileHash, fileUpload, file = selectedFile }) {
            const now = new Date().toISOString();
            return {
                temp_id: crypto.randomUUID?.() || `pending-${Date.now()}`,
                id: `pending:${Date.now()}`,
                chain_id: window.ArtSoulContracts?.currentNetwork?.chainId || 84532,
                network: window.ArtSoulContracts?.currentNetwork?.key || 'baseSepolia',
                wallet_address: walletAddress.toLowerCase(),
                creator: walletAddress,
                creator_id: walletAddress,
                title,
                description,
                creator_value: price,
                file_hash: fileHash,
                file_url: fileUpload.url,
                media_url: fileUpload.url,
                file_type: file?.type?.split('/')[0] || 'image',
                media_type: file?.type || '',
                storage_path: fileUpload.path || fileUpload.storagePath || '',
                upload_hash: fileUpload.ipfsHash || '',
                stage: 'media_uploaded',
                created_at: now,
                updated_at: now
            };
        }

        function selectAuctionDuration(hours) {
            selectedAuctionDuration = [24, 36, 48].includes(Number(hours)) ? Number(hours) : null;
            document.querySelectorAll('.duration-option').forEach(button => {
                button.setAttribute('aria-pressed', String(Number(button.dataset.duration) === selectedAuctionDuration));
            });
            document.getElementById('auctionDurationError').style.display = 'none';
            updatePublishReadiness();
        }

        function clearOriginalWorkError() {
            document.getElementById('originalWorkError').style.display = 'none';
            updatePublishReadiness();
        }

        function getUploadFormValues() {
            let price = document.getElementById('artPrice')?.value || '';
            try { price = parseUserEthAmount(price).eth; } catch { /* Validation identifies the price field. */ }
            return {
                title: normalizeArtworkTitle(document.getElementById('artTitle')?.value),
                description: document.getElementById('artDescription')?.value.trim() || '',
                price,
                duration: selectedAuctionDuration,
                originalConfirmed: Boolean(document.getElementById('originalWorkConfirm')?.checked)
            };
        }

        function getAIValuationFormKey() {
            const values = getUploadFormValues();
            return JSON.stringify({
                file: selectedFile ? [selectedFile.name, selectedFile.size, selectedFile.lastModified] : null,
                wallet: String(window.getCurrentWalletAddress?.() || '').toLowerCase(),
                chain: window.getCurrentChainId?.() || BASE_SEPOLIA_CHAIN_ID,
                title: values.title,
                description: values.description,
                price: values.price,
                duration: values.duration,
                originalConfirmed: values.originalConfirmed
            });
        }

        function getFormCompletionError() {
            const fileError = validateArtworkFile(selectedFile);
            if (fileError) return fileError.message;

            const values = getUploadFormValues();
            const detailsError = validateArtworkDetails(values);
            if (detailsError) return detailsError.message;
            if (!values.duration) return 'Choose a 24, 36, or 48 hour auction duration.';
            if (!values.originalConfirmed) return 'Confirm that this is your original work.';
            return '';
        }

        function setFileValidationError(message = '') {
            const error = document.getElementById('fileValidationError');
            if (!error) return;
            error.textContent = message;
            error.style.display = message ? 'block' : 'none';
        }

        function updatePrePublishAction() {
            const action = document.getElementById('prePublishAction');
            if (!action) return;
            const formError = getFormCompletionError();
            const currentKey = getAIValuationFormKey();
            const estimateCurrent = Boolean(latestAIValuation && latestAIValuationFormKey === currentKey);
            const canStart = !formError && !estimateCurrent && !aiValuationController && !authorizationInProgress && aiValuationAttemptCount === 0;
            action.style.display = canStart ? 'inline-flex' : 'none';
            action.disabled = !canStart;
            const label = window.getCurrentWalletAddress?.()
                ? 'Authorize and analyze'
                : 'Connect, authorize, and analyze';
            // Field blur can run between touch-down and click. Replacing an
            // unchanged button text node makes WebKit discard that first tap.
            if (action.textContent !== label) action.textContent = label;
        }

        function updatePublishReadiness(message = '') {
            const button = document.getElementById('publishBtn');
            const hint = document.getElementById('publishReadinessHint');
            if (!button || !hint) return false;

            const formError = getFormCompletionError();
            const currentKey = getAIValuationFormKey();
            const walletAddress = String(window.getCurrentWalletAddress?.() || '').toLowerCase();
            const estimateCurrent = Boolean(latestAIValuation && latestAIValuationFormKey === currentKey);
            const authorizationCurrent = Boolean(walletAddress && authorizedWalletAddress === walletAddress);
            const ready = !uploading && !formError && authorizationCurrent && estimateCurrent && !aiValuationController && !authorizationInProgress;

            // Only a running upload disables Publish. Disabling it for an
            // incomplete form swallows the click and leaves the person with no
            // explanation of what is missing.
            button.disabled = uploading;
            button.setAttribute('aria-disabled', String(!ready));
            if (message) hint.textContent = message;
            else if (formError) hint.textContent = formError;
            else if (authorizationInProgress) hint.textContent = 'Waiting for wallet authorization.';
            else if (!authorizationCurrent) hint.textContent = 'Authorize the upload with your wallet, then request AI value guidance.';
            else if (aiValuationController) hint.textContent = 'Waiting for AI value guidance.';
            else if (!estimateCurrent) hint.textContent = 'AI value guidance is required before publishing.';
            else hint.textContent = 'Ready to publish.';

            updatePrePublishAction();
            return ready;
        }

        /**
         * Send the person to the step that is blocking publication.
         *
         * Scrolls the blocking control into view, moves focus to it and states
         * the reason next to it. It never activates the control: requesting AI
         * guidance costs a wallet signature, so that stays an explicit choice.
         */
        function revealBlockingStep(message, preferredTargetId = '') {
            clearBlockingStep();
            const fieldError = document.getElementById(`${preferredTargetId}Error`);
            if (fieldError) {
                fieldError.textContent = message;
                fieldError.style.display = 'block';
                document.getElementById(preferredTargetId)?.setAttribute('aria-invalid', 'true');
            }
            // The reason goes where the click happened. It used to be written
            // only into publishBlockedNote, which sits beside the AI panel near
            // the top of the form, while the page scrolled to the field that was
            // wrong - so someone standing at the Publish button saw a field
            // highlight itself and no explanation anywhere near them.
            const hint = document.getElementById('publishReadinessHint');
            if (hint) {
                hint.textContent = message;
                hint.dataset.blocked = 'true';
            }

            const note = document.getElementById('publishBlockedNote');
            if (note) {
                note.textContent = message;
                note.style.display = 'block';
            }

            const candidates = [preferredTargetId, 'prePublishAction', 'aiValuationRetry', 'artTitle'].filter(Boolean);
            let target = null;
            for (const id of candidates) {
                const element = document.getElementById(id);
                if (element && element.offsetParent !== null && !element.disabled) {
                    target = element;
                    break;
                }
            }

            const scrollTo = target || document.getElementById('aiValuationPanel');
            scrollTo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (target) {
                target.classList.add('publish-step-wanted');
                window.setTimeout(() => target.classList.remove('publish-step-wanted'), 2400);
                target.focus({ preventScroll: true });
            }
        }

        function bindDescriptionCounter() {
            const field = document.getElementById('artDescription');
            const counter = document.getElementById('artDescriptionCount');
            if (!field || !counter) return;
            const render = () => {
                const used = Array.from(field.value || '').length;
                counter.textContent = `${used} / ${MAX_ARTWORK_DESCRIPTION_LENGTH}`;
            };
            field.addEventListener('input', render);
            render();
        }

        function clearBlockingStep() {
            for (const id of ['artTitle', 'artDescription', 'artPrice']) {
                document.getElementById(id)?.removeAttribute('aria-invalid');
                document.getElementById(id)?.classList.remove('publish-step-wanted');
                const error = document.getElementById(`${id}Error`);
                if (error) { error.textContent = ''; error.style.display = 'none'; }
            }
            const note = document.getElementById('publishBlockedNote');
            if (note) {
                note.textContent = '';
                note.style.display = 'none';
            }
            // The hint returns to being a hint; updatePublishReadiness owns its
            // text from here.
            const hint = document.getElementById('publishReadinessHint');
            if (hint) delete hint.dataset.blocked;
        }

        async function ensureUploadAuthorization() {
            let walletAddress = window.getCurrentWalletAddress?.();
            if (!walletAddress) {
                // Waits for boot-time session restore, then opens the branded
                // wallet modal and resolves with the connected address.
                walletAddress = await window.ensureWalletConnected?.();
            }
            if (!walletAddress) {
                throw createUploadError('WALLET_NOT_CONNECTED', 'Connect your wallet to continue.');
            }

            // Reuse the provider-confirmed write guard, including its mobile
            // wallet handoff. A connected profile can still be on another chain.
            const networkReady = await window.ensureArtSoulWriteNetwork?.();
            if (networkReady !== true) {
                throw createUploadError('UNSUPPORTED_NETWORK', 'This artwork must be published on Base Sepolia. Switch networks and try again.');
            }

            const alreadyAuthenticated = await (
                window.SupabaseAuth?.isAuthenticatedForWallet?.(walletAddress) ||
                window.SupabaseAuth?.isAuthenticated?.(walletAddress)
            );
            if (!alreadyAuthenticated) {
                const authenticated = await window.ensureAuthenticated?.();
                if (!authenticated) {
                    throw createUploadError(
                        'AUTHORIZATION_REQUIRED',
                        'Wallet authorization was not completed. Tap the authorization button again when your wallet is ready.'
                    );
                }
            }

            if (window.getCurrentWalletAddress?.()?.toLowerCase() !== walletAddress.toLowerCase()) {
                throw createUploadError('AUTHORIZATION_WALLET_CHANGED', 'The wallet changed during authorization.');
            }
            if (Number(window.getCurrentChainId?.()) !== BASE_SEPOLIA_CHAIN_ID) {
                throw createUploadError('UNSUPPORTED_NETWORK', 'The wallet network changed during authorization.');
            }
            authorizedWalletAddress = walletAddress.toLowerCase();
            return walletAddress;
        }

        async function beginPrePublishFlow() {
            if (authorizationInProgress || aiValuationController) return;
            const formError = getFormCompletionError();
            if (formError) {
                updatePublishReadiness(formError);
                return;
            }

            authorizationInProgress = true;
            let authorizationError = '';
            updatePublishReadiness('Preparing Base Sepolia and wallet authorization.');
            setAIValuationState('unavailable', { message: 'Confirm Base Sepolia and the gas-free authorization in your wallet to continue.' });

            try {
                await ensureUploadAuthorization();
                await requestAIValuation(selectedFile);
            } catch (error) {
                const mapped = mapPublishError(error);
                const authorizationCodes = ['WALLET_NOT_CONNECTED', 'AUTHORIZATION_REQUIRED',
                    'AUTHORIZATION_WALLET_CHANGED', 'UNSUPPORTED_NETWORK',
                    'BASE_SEPOLIA_REQUIRED', 'BASE_SEPOLIA_SWITCH_REJECTED'];
                authorizationError = authorizationCodes.includes(mapped.code) ? mapped.message
                    : mapped.code === 'USER_REJECTED' ? 'Wallet authorization was declined. Tap Authorize and analyze to try again.'
                    : 'Wallet authorization could not be completed. Check your wallet connection and try again.';
                setAIValuationState('unavailable', { message: authorizationError });
            } finally {
                authorizationInProgress = false;
                updateAIValuationRetryState();
                updatePublishReadiness(authorizationError);
            }
        }

        function formatEthEstimate(value) {
            return formatAIPrice(value);
        }

        function updateAIValuationRetryState() {
            const retry = document.getElementById('aiValuationRetry');
            const note = document.getElementById('aiValuationRetryNote');
            const attemptsLeft = Math.max(0, AI_TOTAL_ATTEMPT_LIMIT - aiValuationAttemptCount);
            const limitReached = aiValuationAttemptCount >= AI_TOTAL_ATTEMPT_LIMIT;
            const canRetry = Boolean(
                selectedFile &&
                aiValuationAttemptCount > 0 &&
                attemptsLeft > 0 &&
                !aiValuationController &&
                !authorizationInProgress &&
                !getFormCompletionError()
            );

            retry.disabled = !canRetry;
            retry.style.display = canRetry ? 'inline-flex' : 'none';
            const label = `Retry (${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left)`;
            if (retry.textContent !== label) retry.textContent = label;
            note.style.display = limitReached ? 'block' : 'none';
            note.textContent = 'AI value guidance limit reached for this upload session.';
        }

        function setAIValuationState(state, details = {}) {
            const status = document.getElementById('aiValuationStatus');
            const content = document.getElementById('aiValuationContent');
            const retry = document.getElementById('aiValuationRetry');
            const range = document.getElementById('aiValuationRange');
            const suggestion = document.getElementById('aiValuationSuggestion');
            const rationale = document.getElementById('aiValuationRationale');

            if (state === 'loading') {
                status.textContent = 'Analyzing the artwork...';
                content.style.display = 'none';
                retry.style.display = 'none';
                retry.disabled = true;
                updatePublishReadiness('Waiting for AI value guidance.');
                return;
            }

            const valuation = readAIValuation(details.valuation);
            if (state === 'ready' && valuation) {
                const attemptsLeft = Math.max(0, AI_TOTAL_ATTEMPT_LIMIT - aiValuationAttemptCount);
                status.textContent = `AI value guidance is ready. Review the estimate below. You have ${attemptsLeft} ${attemptsLeft === 1 ? 'attempt' : 'attempts'} left to run it again.`;
                if (!details.logged) {
                    status.textContent += ' The estimate is ready, but its activity log is temporarily unavailable.';
                }
                if (valuation.used_media === false) {
                    status.textContent += ' This estimate used text metadata only; the artwork image was not analyzed.';
                }
                range.textContent = `${formatEthEstimate(valuation.estimated_value_min_eth)} - ${formatEthEstimate(valuation.estimated_value_max_eth)} ETH`;
                suggestion.textContent = `Suggested starting price: ${formatEthEstimate(valuation.suggested_start_price_eth)} ETH - ${valuation.confidence || 'medium'} confidence`;
                rationale.textContent = valuation.rationale || '';
                content.style.display = 'block';
                updateAIValuationRetryState();
                updatePublishReadiness();
                return;
            }

            status.textContent = details.message || 'AI value guidance is temporarily unavailable. Please try again.';
            content.style.display = 'none';
            updateAIValuationRetryState();
            updatePublishReadiness();
        }

        async function createAIImagePreview(file, signal) {
            signal?.throwIfAborted();
            if (!file?.type?.startsWith('image/')) return '';

            const objectUrl = URL.createObjectURL(file);
            try {
                const image = await new Promise((resolve, reject) => {
                    const element = new Image();
                    const cleanup = () => {
                        element.onload = null;
                        element.onerror = null;
                        signal?.removeEventListener('abort', abort);
                    };
                    const abort = () => {
                        cleanup();
                        element.src = '';
                        reject(signal.reason || new DOMException('Aborted', 'AbortError'));
                    };
                    element.onload = () => { cleanup(); resolve(element); };
                    element.onerror = error => { cleanup(); reject(error); };
                    signal?.addEventListener('abort', abort, { once: true });
                    if (signal?.aborted) { abort(); return; }
                    element.src = objectUrl;
                });

                let maxDimension = 1024;
                for (let attempt = 0; attempt < 3; attempt += 1) {
                    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/webp', 0.78);
                    if (dataUrl.length <= AI_PREVIEW_MAX_DATA_URL_LENGTH) return dataUrl;
                    maxDimension = Math.round(maxDimension * 0.7);
                }
            } catch (error) {
                if (signal?.aborted) throw error;
                console.warn('[AI Guidance] Could not prepare image preview:', error);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }

            return '';
        }

        function retryAIValuation() {
            if (!selectedFile || aiValuationController) return;
            if (aiValuationAttemptCount >= AI_TOTAL_ATTEMPT_LIMIT) {
                updateAIValuationRetryState();
                return;
            }
            beginPrePublishFlow();
        }

        async function requestAIValuation(file = selectedFile) {
            if (!file) {
                setAIValuationState('unavailable', { message: 'Select an artwork file before requesting AI value guidance.' });
                return;
            }

            const formError = getFormCompletionError();
            if (formError) {
                setAIValuationState('unavailable', { message: formError });
                return;
            }

            if (aiValuationAttemptCount >= AI_TOTAL_ATTEMPT_LIMIT) {
                updateAIValuationRetryState();
                return;
            }

            const requestId = ++aiValuationRequestId;
            const requestFormKey = getAIValuationFormKey();
            const requestValues = getUploadFormValues();
            latestAIValuation = null;
            aiValuationController?.abort();
            const controller = new AbortController();
            aiValuationController = controller;
            const timeout = setTimeout(() => controller.abort(), AI_ANALYSIS_TIMEOUT_MS);
            aiValuationAttemptCount += 1;
            setAIValuationState('loading');

            try {
                const walletAddress = window.getCurrentWalletAddress?.();
                const mediaDataUrl = await createAIImagePreview(file, controller.signal);
                if (requestId !== aiValuationRequestId) return;
                controller.signal.throwIfAborted();

                const result = await window.ArtSoulAIValuation.request({
                        title: requestValues.title,
                        description: requestValues.description,
                        creator_value: requestValues.price,
                        media_type: file.type,
                        creator: walletAddress,
                        chain_id: window.getCurrentChainId?.() || 84532,
                        media_data_url: mediaDataUrl || undefined
                    }, { signal: controller.signal });
                if (requestId !== aiValuationRequestId) return;
                if (requestFormKey !== getAIValuationFormKey()) {
                    setAIValuationState('unavailable', {
                        message: 'Artwork details changed during analysis. Request updated AI value guidance.'
                    });
                    return;
                }

                latestAIValuation = readAIValuation(result.valuation);
                if (!latestAIValuation) {
                    throw createUploadError('GEMINI_RESPONSE_INVALID', 'AI returned an invalid estimate.');
                }
                latestAIValuationFormKey = requestFormKey;
                if (!result.logged) {
                    console.warn('[AI Guidance] Estimate returned but ai_valuations logging was unavailable.');
                }
                setAIValuationState('ready', {
                    valuation: latestAIValuation,
                    logged: result.logged
                });
            } catch (error) {
                if (requestId !== aiValuationRequestId) return;
                const message = describeAIValuationError(error);
                console.warn('[AI Guidance] Analysis unavailable:', error);
                setAIValuationState('unavailable', { message });
            } finally {
                clearTimeout(timeout);
                if (aiValuationController === controller) {
                    aiValuationController = null;
                    updateAIValuationRetryState();
                    updatePublishReadiness();
                }
            }
        }

        function cancelAIValuation() {
            aiValuationRequestId += 1;
            aiValuationController?.abort();
            aiValuationController = null;
            latestAIValuation = null;
            latestAIValuationFormKey = '';
        }

        function handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;

            cancelAIValuation();
            aiValuationAttemptCount = 0;
            authorizedWalletAddress = '';
            document.getElementById('filePreview').style.display = 'none';

            const fileError = validateArtworkFile(file);
            if (fileError) {
                selectedFile = null;
                event.target.value = '';
                setFileValidationError(fileError.message);
                document.getElementById('uploadPrompt').style.display = 'block';
                document.getElementById('fileInfo').style.display = 'none';
                setAIValuationState('unavailable', {
                    message: 'Choose a valid artwork file before requesting AI value guidance.'
                });
                updatePublishReadiness(fileError.message);
                alert(fileError.message);
                return;
            }

            selectedFile = file;
            setFileValidationError('');
            document.getElementById('fileName').textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;

            // Hide upload prompt, show file info
            document.getElementById('uploadPrompt').style.display = 'none';
            document.getElementById('fileInfo').style.display = 'block';

            // Show preview
            const reader = new FileReader();
            reader.onload = function(e) {
                if (selectedFile !== file) return;
                const preview = document.getElementById('filePreview');
                const previewImg = document.getElementById('previewImage');

                if (file.type.startsWith('image/')) {
                    previewImg.src = e.target.result;
                    preview.style.display = 'block';
                } else if (file.type.startsWith('video/')) {
                    // For video, show first frame or placeholder
                    previewImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5WaWRlbzwvdGV4dD48L3N2Zz4=';
                    preview.style.display = 'block';
                } else {
                    preview.style.display = 'none';
                }
            };
            reader.readAsDataURL(file);
            setAIValuationState('unavailable', {
                message: 'Complete every required field, then authorize the upload to request AI value guidance.'
            });
            updatePublishReadiness();
        }

        async function handleUpload() {
            if (uploading) return;

            const { title, price, description } = getUploadFormValues();

            const fileError = validateArtworkFile(selectedFile);
            if (fileError) {
                setFileValidationError(fileError.message);
                revealBlockingStep(fileError.message, 'artFile');
                return;
            }

            if (!selectedAuctionDuration) {
                document.getElementById('auctionDurationError').style.display = 'block';
                revealBlockingStep('Choose a 24, 36, or 48 hour auction duration before publishing.', 'auctionDurationLabel');
                return;
            }

            if (!document.getElementById('originalWorkConfirm').checked) {
                document.getElementById('originalWorkError').style.display = 'block';
                revealBlockingStep('Confirm that this is your original work before publishing.', 'originalWorkConfirm');
                return;
            }

            const validationError = validateArtworkDetails({ title, description, price });
            if (validationError) {
                revealBlockingStep(validationError.message, validationError.fieldId);
                return;
            }

            if (!updatePublishReadiness()) {
                revealBlockingStep(
                    document.getElementById('publishReadinessHint')?.textContent
                    || 'Complete every required step before publishing.'
                );
                return;
            }

            clearBlockingStep();

            const file = selectedFile;
            const duration = selectedAuctionDuration;
            const guidance = latestAIValuation;
            const formKey = getAIValuationFormKey();
            const walletAddress = window.getCurrentWalletAddress?.() || await window.ensureWalletConnected?.();
            if (!walletAddress) return;
            const chainId = Number(window.getCurrentChainId?.() || window.ArtSoulContracts?.currentNetwork?.chainId || 0);
            if (chainId && chainId !== BASE_SEPOLIA_CHAIN_ID) {
                alert('This artwork must be published on Base Sepolia. Switch networks and try again.');
                return;
            }

            uploading = true;
            publishNavigationLocked = true;
            const uploadBtn = document.getElementById('publishBtn');
            const originalMarkup = uploadBtn.innerHTML;
            setTransactionButtonProcessing(uploadBtn);
            let pendingArtwork = null;
            const assertCurrent = () => {
                if (String(window.getCurrentWalletAddress?.() || '').toLowerCase() !== walletAddress.toLowerCase()) {
                    throw createUploadError('AUTHORIZATION_WALLET_CHANGED', 'The wallet changed during preparation.');
                }
                if (Number(window.getCurrentChainId?.()) !== BASE_SEPOLIA_CHAIN_ID) {
                    throw createUploadError('BASE_SEPOLIA_REQUIRED', 'Base Sepolia is required.');
                }
                if (file !== selectedFile || formKey !== getAIValuationFormKey()) {
                    throw createUploadError('PUBLICATION_FORM_CHANGED', 'Artwork details changed during preparation.');
                }
            };

            try {
                // Authorization and AI guidance are completed before Publish is enabled.
                const isAuth = await (
                    window.SupabaseAuth?.isAuthenticatedForWallet?.(walletAddress) ||
                    window.SupabaseAuth?.isAuthenticated?.(walletAddress)
                );
                if (!isAuth || authorizedWalletAddress !== walletAddress.toLowerCase()) {
                    throw createUploadError('AUTHORIZATION_REQUIRED', 'Authorize this upload with your wallet signature before publishing.');
                }
                if (!latestAIValuation || latestAIValuationFormKey !== getAIValuationFormKey()) {
                    throw createUploadError('AI_UNAVAILABLE', 'AI value guidance is not ready. Request an estimate before publishing.');
                }

                // Step 1: Generate file hash for duplicate detection
                currentPublishStage = 'fingerprint';
                setTransactionButtonProcessing(uploadBtn, 'Preparing artwork fingerprint...');
                const fileHash = await window.IPFSClient.generateFileHash(file);
                assertCurrent();
                console.log('📝 File hash:', fileHash);

                const preparation = await prepareBrowserPublication({ file, fileHash, wallet: walletAddress,
                    details: { title, description, creatorValue: price, aiGuidance: guidance, duration }, assertCurrent });
                if (preparation) {
                    if (preparation.recovery?.state === 'registered') {
                        assertCurrent();
                        window.location.href = `/artwork/${preparation.recovery.registered_artwork_id}`;
                        return;
                    }
                    if (preparation.recovery?.state === 'conflict' || preparation.claim_status === 'conflict') {
                        throw createUploadError('PUBLICATION_CONFLICT', 'Publication conflict retained.');
                    }
                    // This rollout slice never begins an attempt or initializes
                    // contracts. An error cannot fall back to legacy publishing.
                    throw createUploadError(preparation.submission_started_at || preparation.claim_status !== 'claimed'
                        ? 'PUBLICATION_ATTEMPT_PENDING' : 'PUBLICATION_PREPARED_ONLY', 'Publication preparation retained.');
                }

                // Step 2: Prepare media storage
                currentPublishStage = 'media_upload';
                setTransactionButtonProcessing(uploadBtn, 'Preparing media...');
                const fileUpload = await window.IPFSClient.uploadFile(file);
                assertCurrent();
                pendingArtwork = createPendingArtworkDraft({
                    walletAddress,
                    title,
                    description,
                    price,
                    fileHash,
                    fileUpload,
                    file
                });
                console.log('📤 File uploaded:', fileUpload.ipfsHash);

                // Step 3: Create artwork details
                setTransactionButtonProcessing(uploadBtn, 'Preparing artwork details...');
                const metadata = window.IPFSClient.createMetadata({
                    title: title,
                    description: description,
                    imageUrl: fileUpload.url,
                    mediaType: file.type,
                    creator: walletAddress,
                    creatorValue: price,
                    aiGuidance: guidance,
                    createdAt: new Date().toISOString()
                });

                // Step 4: Store artwork metadata
                currentPublishStage = 'metadata_upload';
                const metadataUpload = await window.IPFSClient.uploadMetadata(metadata);
                assertCurrent();
                if (!metadataUpload?.url) {
                    throw new Error('Metadata upload failed before on-chain registration.');
                }
                if (metadataUpload.debug_mock) {
                    console.warn('Debug mock metadata URI enabled for this upload.');
                }
                pendingArtwork = {
                    ...pendingArtwork,
                    stage: 'metadata_prepared',
                    metadata_uri: metadataUpload.url,
                    metadata_hash: metadataUpload.ipfsHash || '',
                    metadata_path: metadataUpload.path || ''
                };
                console.log('📤 Metadata uploaded:', metadataUpload.ipfsHash);

                // Step 5: Initialize contracts
                currentPublishStage = 'wallet_init';
                setTransactionButtonProcessing(uploadBtn, 'Connecting wallet...');
                if (!window.ArtSoulContracts.marketplaceContract) {
                    const provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) throw new Error('No wallet provider');
                    await window.ArtSoulContracts.init(provider);
                }

                // Step 6: Register artwork with the protocol
                assertCurrent();
                currentPublishStage = 'register';
                setTransactionButtonProcessing(uploadBtn, 'Registering artwork...');
                const result = await window.ArtSoulContracts.uploadArtwork(
                    fileUpload.ipfsHash,
                    metadataUpload.url,
                    fileHash,
                    price,
                    {
                        expectedWallet: walletAddress,
                        expectedChainId: BASE_SEPOLIA_CHAIN_ID,
                        onSubmitted: (registerTxHash) => {
                            submittedRegisterTxHash = registerTxHash || '';
                            pendingArtwork = savePendingArtwork({
                                ...pendingArtwork,
                                register_tx_hash: registerTxHash || '',
                                stage: 'register_submitted',
                                lifecycle_label: 'Finalizing...',
                                lifecycle_message: 'Registration was submitted. Waiting for blockchain confirmation.'
                            });
                        }
                    }
                );

                console.log(' Artwork created! ID:', result.artworkId);
                if (!result?.txHash || !result?.artworkId) {
                    throw new Error('Register transaction did not return a confirmed artwork id.');
                }
                pendingArtwork = savePendingArtwork({
                    ...pendingArtwork,
                    id: `pending:${result.artworkId || pendingArtwork.temp_id}`,
                    artwork_id: result.artworkId ? String(result.artworkId) : '',
                    blockchain_id: result.artworkId ? String(result.artworkId) : '',
                    register_tx_hash: result.txHash || '',
                    register_receipt_status: 1,
                    stage: 'registered',
                    lifecycle_label: 'Finalizing...',
                    lifecycle_message: 'Register transaction confirmed. Waiting for the public artwork page to update.'
                });

                // Step 8: Indexer projection replaces legacy browser writes.
                setTransactionButtonProcessing(uploadBtn, 'Finalizing...');
                console.log('Legacy artwork DB write skipped; v41 indexer will project registration.', {
                    artworkId: result.artworkId,
                    txHash: result.txHash,
                    network: window.ArtSoulContracts.currentNetwork
                });

                // Step 7: Create the initial auction using the required creator-selected duration.
                currentPublishStage = 'auction';
                setTransactionButtonProcessing(uploadBtn, 'Launching auction...');
                let auctionCreated = false;
                let dbSynced = false;
                try {
                    let resolveAuctionSubmission;
                    const auctionSubmission = new Promise(resolve => {
                        resolveAuctionSubmission = resolve;
                    });
                    const auctionConfirmation = window.ArtSoulContracts.createAuction(
                        result.artworkId,
                        price,
                        duration,
                        {
                            expectedWallet: walletAddress,
                            expectedChainId: BASE_SEPOLIA_CHAIN_ID,
                            onSubmitted: (submittedAuctionTxHash) => {
                                resolveAuctionSubmission(submittedAuctionTxHash || '');
                                pendingArtwork = savePendingArtwork({
                                    ...pendingArtwork,
                                    auction_tx_hash: submittedAuctionTxHash || '',
                                    stage: 'auction_submitted',
                                    lifecycle_label: 'Finalizing...',
                                    lifecycle_message: 'Registration is confirmed and the auction was submitted. Waiting for blockchain confirmation.'
                                });
                            }
                        }
                    );
                    const firstAuctionOutcome = await Promise.race([
                        auctionConfirmation.then(
                            hash => ({ type: 'confirmed', hash }),
                            error => ({ type: 'failed', error })
                        ),
                        auctionSubmission.then(hash => ({ type: 'submitted', hash }))
                    ]);

                    let auctionTxHash = firstAuctionOutcome.hash || '';
                    if (firstAuctionOutcome.type === 'failed') {
                        throw firstAuctionOutcome.error;
                    }
                    if (firstAuctionOutcome.type === 'submitted') {
                        auctionTxHash = await waitForAuctionConfirmation({
                            transactionPromise: auctionConfirmation,
                            chainId: BASE_SEPOLIA_CHAIN_ID,
                            artworkId: result.artworkId,
                            txHash: firstAuctionOutcome.hash
                        });
                    }
                    auctionCreated = true;
                    pendingArtwork = savePendingArtwork({
                        ...pendingArtwork,
                        auction_tx_hash: auctionTxHash || '',
                        auction_receipt_status: 1,
                        stage: 'auction_created',
                        lifecycle_label: 'Finalizing...',
                        lifecycle_message: 'Register and auction transactions confirmed. Waiting for the public artwork page to update.'
                    });
                    console.log(' Auction created on blockchain');

                    dbSynced = true;
                    console.log('Legacy auction DB sync skipped; v41 indexer will project auction state.');
                } catch (auctionError) {
                    console.error(' Auction creation error:', auctionError);
                    const mappedAuctionError = mapPublishError(auctionError);
                    console.log('Auction creation error shown to user:', mappedAuctionError.message);
                    if (mappedAuctionError.code === 'AUCTION_CONFIRMATION_PENDING' && pendingArtwork?.auction_tx_hash) {
                        pendingArtwork = savePendingArtwork({
                            ...pendingArtwork,
                            stage: 'auction_submitted',
                            lifecycle_label: 'Finalizing...',
                            lifecycle_message: 'The auction transaction was submitted and is still finalizing. Check this status before trying anything again.',
                            auction_error_code: '',
                            auction_error_message: ''
                        });
                        await alert(`${mappedAuctionError.message}\n\nYou will now return to your profile. Do not submit the auction again while it is finalizing.`);
                        navigateAfterPublish('/profile');
                        return;
                    }
                    pendingArtwork = savePendingArtwork({
                        ...pendingArtwork,
                        stage: 'auction_failed',
                        lifecycle_label: 'Artwork registered - auction failed',
                        lifecycle_message: 'The artwork is registered on-chain, but auction creation failed. You can retry auction from your profile.',
                        auction_error_code: mappedAuctionError.code,
                        auction_error_message: mappedAuctionError.message
                    });

                    if (auctionCreated && !dbSynced) {
                        // Blockchain succeeded but database failed after retries
                        await alert('Auction created on blockchain but database sync failed.\n\nYour artwork is live on the blockchain!\nPlease go to your profile and the status will sync automatically.');
                        navigateAfterPublish('/profile');
                        return;
                    } else if (!auctionCreated) {
                        // Blockchain creation failed - artwork stays as draft
                        await alert(`Artwork registered - auction failed.\n\n${mappedAuctionError.message}\n\nYou can retry auction from your profile.`);
                        navigateAfterPublish('/profile');
                        return;
                    }
                }

                // Success - redirect to the new artwork detail page.
                const chainId = window.getCurrentChainId?.() || window.ArtSoulContracts?.chainId || 84532;
                navigateAfterPublish(window.ArtSoulArtworkUrl.artworkPath(`v41:${chainId}:${result.artworkId}`));

            } catch (error) {
                console.error('Publish failed:', error);
                const mapped = mapPublishError(error);
                const errorMessage = `Publish failed: ${mapped.message}`;

                // A submitted register with no artwork id yet is exactly the
                // state this record exists to hold: the indexer will project the
                // real artwork once the transaction mines, and until then the
                // profile has nothing else to show. Removing it here threw away
                // the only trace that a transaction was in flight.
                if (pendingArtwork?.register_tx_hash
                    && !pendingArtwork?.artwork_id
                    && mapped.code !== 'REGISTRATION_UNCONFIRMED'
                    && error?.receipt?.status === 0) {
                    removePendingArtwork(pendingArtwork.temp_id);
                }

                console.log('Publish error shown to user:', errorMessage);
                alert(errorMessage);
            } finally {
                publishNavigationLocked = false;
                uploading = false;
                currentPublishStage = 'idle';
                submittedRegisterTxHash = '';
                restoreTransactionButton(uploadBtn, originalMarkup);
            }
        }

        function handleUploadFormChange() {
            if (aiValuationController || (latestAIValuation && latestAIValuationFormKey !== getAIValuationFormKey())) {
                cancelAIValuation();
                setAIValuationState('unavailable', {
                    message: 'Artwork details changed. Request updated AI value guidance before publishing.'
                });
            }
            updateAIValuationRetryState();
            updatePublishReadiness();
        }

        function bindUploadFlow() {
            bindDescriptionCounter();
            ['artTitle', 'artDescription', 'artPrice'].forEach((id) => {
                const field = document.getElementById(id);
                field?.addEventListener('input', () => { clearBlockingStep(); updatePublishReadiness(); });
                field?.addEventListener('change', handleUploadFormChange);
            });
            document.getElementById('originalWorkConfirm')?.addEventListener('change', handleUploadFormChange);
            window.addEventListener('artsoul:wallet-state-changed', (event) => {
                const nextAddress = String(event?.detail?.address || '').toLowerCase();
                if (!event?.detail?.isConnected || (authorizedWalletAddress && nextAddress !== authorizedWalletAddress)) {
                    authorizedWalletAddress = '';
                    cancelAIValuation();
                    setAIValuationState('unavailable', { message: 'Wallet changed. Authorize this wallet and request updated AI value guidance.' });
                }
                updatePublishReadiness();
            });
            window.addEventListener('beforeunload', (event) => {
                if (!publishNavigationLocked) return;
                event.preventDefault();
                event.returnValue = '';
            });
            updateAIValuationRetryState();
            updatePublishReadiness();
        }

        bindUploadFlow();

Object.assign(window, {
    handleFileSelect,
    retryAIValuation,
    beginPrePublishFlow,
    selectAuctionDuration,
    clearOriginalWorkError,
    handleUpload
});
