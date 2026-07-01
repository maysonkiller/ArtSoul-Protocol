import '../../supabase-client.js';
import '../../supabase-auth.js';

let selectedFile = null;
        let uploading = false;
        let selectedAuctionDuration = null;
        let latestAIValuation = null;
        let aiValuationRequestId = 0;
        let aiValuationController = null;
        let aiValuationManualRetryCount = 0;

        const AI_ANALYSIS_TIMEOUT_MS = 20000;
        const AI_PREVIEW_MAX_DATA_URL_LENGTH = 1800000;
        const AI_MANUAL_RETRY_LIMIT = 2;

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
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.innerHTML = originalMarkup;
        }

        const PLACEHOLDER_TITLES = new Set([
            'test',
            'testing',
            'screenshot',
            'screen shot',
            'image',
            'img',
            'photo',
            'picture',
            'untitled',
            'new artwork',
            'artwork',
            'video',
            'audio'
        ]);

        function normalizeArtworkTitle(value) {
            return (value || '').trim().replace(/\s+/g, ' ');
        }

        function simplifyArtworkTitle(value) {
            return normalizeArtworkTitle(value)
                .toLowerCase()
                .replace(/\.[a-z0-9]{2,5}$/i, '')
                .replace(/[_-]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function isPlaceholderArtworkTitle(value) {
            const simplified = simplifyArtworkTitle(value);
            if (PLACEHOLDER_TITLES.has(simplified)) return true;
            return /^(screenshot|screen shot|img|image|photo|picture|untitled)\b/i.test(simplified);
        }

        function validateArtworkDetails({ title, description, price }) {
            const cleanTitle = normalizeArtworkTitle(title);
            const cleanDescription = (description || '').trim().replace(/\s+/g, ' ');

            if (Array.from(cleanTitle).length < 3) {
                return 'Use a clear artwork title with at least 3 characters.';
            }

            if (isPlaceholderArtworkTitle(cleanTitle)) {
                return 'Use a clear artwork title, not a placeholder like test, screenshot, image, or untitled.';
            }

            if (!cleanDescription || Array.from(cleanDescription).length < 12) {
                return 'Add a short meaningful description with the story, medium, or collector context.';
            }

            if (!price || parseFloat(price) <= 0) {
                return 'Price must be greater than 0.';
            }

            return '';
        }

        function describePublishError(error) {
            const code = error?.code || '';
            if (code === 'SERVICE_ROLE_KEY_NOT_SERVICE_ROLE') {
                return 'Upload service is using the wrong Supabase key. SUPABASE_SERVICE_ROLE_KEY must be the service_role key, not the anon key.';
            }
            if (code === 'MISSING_SERVICE_ROLE_KEY') {
                return 'Upload service is missing SUPABASE_SERVICE_ROLE_KEY.';
            }
            if (code === 'STORAGE_SIGNED_UPLOAD_RLS_DENIED') {
                return 'Upload storage authorization was denied. Please verify the server uses the Supabase service_role key.';
            }
            if (code === 'STORAGE_BUCKET_NOT_FOUND') {
                return 'Upload storage bucket "artworks" was not found.';
            }
            if (code === 'INVALID_UPLOAD_PAYLOAD') {
                return error.message || 'Upload an image, video, or audio file under the supported size limit.';
            }
            return getTransactionErrorMessage(error, 'The publish flow could not be completed. Please try again.');
        }

        function mapPublishError(error) {
            const code = String(error?.code || '').toUpperCase();
            const message = String(error?.shortMessage || error?.reason || error?.message || '');
            const lower = message.toLowerCase();

            if (code === 'ACTION_REJECTED' || code === '4001' || lower.includes('user rejected') || lower.includes('user denied')) {
                return { code: 'USER_REJECTED', message: 'Transaction was rejected in the wallet.' };
            }
            if (lower.includes('nonce too low')) {
                return { code: 'NONCE_TOO_LOW', message: 'Wallet nonce is out of sync. Reset the account nonce or retry after pending transactions clear.' };
            }
            if (lower.includes('insufficient funds') || lower.includes('insufficient gas') || lower.includes('not enough funds')) {
                return { code: 'INSUFFICIENT_FUNDS', message: 'The wallet does not have enough testnet ETH for gas or the transaction value.' };
            }
            if (code === 'CALL_EXCEPTION' || lower.includes('reverted') || lower.includes('execution reverted')) {
                return {
                    code: 'TRANSACTION_REVERTED',
                    message: getTransactionErrorMessage(error, 'The transaction reverted on-chain. No new artwork was created for a failed register transaction.')
                };
            }
            if (lower.includes('unsupported network') || lower.includes('wrong network')) {
                return { code: 'UNSUPPORTED_NETWORK', message: 'Please switch to Base Sepolia and try again.' };
            }
            if (lower.includes('duplicate artwork')) {
                return { code: 'DUPLICATE_ARTWORK', message: 'This file has already been published.' };
            }

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

        function createPendingArtworkDraft({ walletAddress, title, description, price, fileHash, fileUpload }) {
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
                file_type: selectedFile?.type?.split('/')[0] || 'image',
                media_type: selectedFile?.type || '',
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
        }

        function clearOriginalWorkError() {
            document.getElementById('originalWorkError').style.display = 'none';
        }

        function formatEthEstimate(value) {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return '0';
            return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 });
        }

        function updateAIValuationRetryState() {
            const retry = document.getElementById('aiValuationRetry');
            const note = document.getElementById('aiValuationRetryNote');
            const limitReached = aiValuationManualRetryCount >= AI_MANUAL_RETRY_LIMIT;

            retry.disabled = limitReached || Boolean(aiValuationController);
            retry.style.display = selectedFile ? 'inline-flex' : 'none';
            note.style.display = limitReached ? 'block' : 'none';
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
                return;
            }

            if (state === 'ready' && details.valuation) {
                const valuation = details.valuation;
                status.textContent = details.logged
                    ? 'Estimate ready.'
                    : 'Estimate ready. The guidance log is temporarily unavailable.';
                range.textContent = `${formatEthEstimate(valuation.estimated_value_min_eth)} - ${formatEthEstimate(valuation.estimated_value_max_eth)} ETH`;
                suggestion.textContent = `Suggested starting price: ${formatEthEstimate(valuation.suggested_start_price_eth)} ETH - ${valuation.confidence || 'medium'} confidence`;
                rationale.textContent = valuation.rationale || '';
                content.style.display = 'block';
                updateAIValuationRetryState();
                return;
            }

            status.textContent = details.message || 'Estimate unavailable. You can still publish normally.';
            content.style.display = 'none';
            updateAIValuationRetryState();
        }

        async function createAIImagePreview(file) {
            if (!file?.type?.startsWith('image/')) return '';

            const objectUrl = URL.createObjectURL(file);
            try {
                const image = await new Promise((resolve, reject) => {
                    const element = new Image();
                    element.onload = () => resolve(element);
                    element.onerror = reject;
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
                console.warn('[AI Guidance] Could not prepare image preview:', error);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }

            return '';
        }

        function retryAIValuation() {
            if (!selectedFile || aiValuationController) return;
            if (aiValuationManualRetryCount >= AI_MANUAL_RETRY_LIMIT) {
                updateAIValuationRetryState();
                return;
            }
            requestAIValuation(selectedFile, { manual: true });
        }

        async function requestAIValuation(file = selectedFile, options = {}) {
            if (!file) {
                setAIValuationState('unavailable', { message: 'Select an artwork file to request an estimate.' });
                return;
            }

            if (options.manual && aiValuationManualRetryCount >= AI_MANUAL_RETRY_LIMIT) {
                updateAIValuationRetryState();
                return;
            }

            const requestId = ++aiValuationRequestId;
            latestAIValuation = null;
            aiValuationController?.abort();
            const controller = new AbortController();
            aiValuationController = controller;
            const timeout = setTimeout(() => controller.abort(), AI_ANALYSIS_TIMEOUT_MS);
            setAIValuationState('loading');

            try {
                const walletAddress = window.getCurrentWalletAddress?.();
                const mediaDataUrl = await createAIImagePreview(file);
                if (requestId !== aiValuationRequestId) return;

                if (options.manual) {
                    aiValuationManualRetryCount += 1;
                }

                const result = await window.ArtSoulAIValuation.request({
                        title: normalizeArtworkTitle(document.getElementById('artTitle').value),
                        description: document.getElementById('artDescription').value.trim(),
                        creator_value: document.getElementById('artPrice').value,
                        media_type: file.type,
                        creator: walletAddress,
                        chain_id: window.getCurrentChainId?.() || 84532,
                        media_data_url: mediaDataUrl || undefined
                    }, { signal: controller.signal });
                if (requestId !== aiValuationRequestId) return;

                latestAIValuation = result.valuation;
                if (!result.logged) {
                    console.warn('[AI Guidance] Estimate returned but ai_valuations logging was unavailable.');
                }
                setAIValuationState('ready', {
                    valuation: latestAIValuation,
                    logged: result.logged
                });
            } catch (error) {
                if (requestId !== aiValuationRequestId) return;
                const message = error?.name === 'AbortError'
                    ? 'Estimate unavailable because the request took too long. You can still publish normally.'
                    : (error?.message || 'Estimate unavailable. You can still publish normally.');
                console.warn('[AI Guidance] Analysis unavailable:', error);
                setAIValuationState('unavailable', { message });
            } finally {
                clearTimeout(timeout);
                if (aiValuationController === controller) {
                    aiValuationController = null;
                    updateAIValuationRetryState();
                }
            }
        }

        function handleFileSelect(event) {
            const file = event.target.files[0];
            if (file) {
                selectedFile = file;
                document.getElementById('fileName').textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;

                // Hide upload prompt, show file info
                document.getElementById('uploadPrompt').style.display = 'none';
                document.getElementById('fileInfo').style.display = 'block';

                // Show preview
                const reader = new FileReader();
                reader.onload = function(e) {
                    const preview = document.getElementById('filePreview');
                    const previewImg = document.getElementById('previewImage');

                    if (file.type.startsWith('image/')) {
                        previewImg.src = e.target.result;
                        preview.style.display = 'block';
                    } else if (file.type.startsWith('video/')) {
                        // For video, show first frame or placeholder
                        previewImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiNmZmYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5WaWRlbzwvdGV4dD48L3N2Zz4=';
                        preview.style.display = 'block';
                    }
                };
                reader.readAsDataURL(file);
                requestAIValuation(file);
            }
        }

        async function handleUpload() {
            if (uploading) return;

            const title = normalizeArtworkTitle(document.getElementById('artTitle').value);
            const price = document.getElementById('artPrice').value;
            const description = document.getElementById('artDescription').value.trim();

            // Validation
            if (!selectedFile) {
                alert('Please select an artwork file to publish');
                return;
            }

            if (!selectedAuctionDuration) {
                document.getElementById('auctionDurationError').style.display = 'block';
                document.getElementById('auctionDurationLabel').scrollIntoView({ behavior: 'smooth', block: 'center' });
                alert('Choose a 24, 36, or 48 hour auction duration before publishing.');
                return;
            }

            if (!document.getElementById('originalWorkConfirm').checked) {
                document.getElementById('originalWorkError').style.display = 'block';
                document.getElementById('beforePublishTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
                alert('Confirm that this is your original work before publishing.');
                return;
            }

            const validationError = validateArtworkDetails({ title, description, price });
            if (validationError) {
                alert(validationError);
                return;
            }

            // Check wallet connection
            let walletAddress = window.getCurrentWalletAddress?.();
            if (!walletAddress) {
                walletAddress = await window.safeConnectWallet?.();
                if (!walletAddress) return;
            }

            uploading = true;
            const uploadBtn = document.getElementById('publishBtn');
            const originalMarkup = uploadBtn.innerHTML;
            setTransactionButtonProcessing(uploadBtn);
            let pendingArtwork = null;

            try {
                // Authentication is part of the guarded flow so a second click cannot start another SIWE/transaction sequence.
                const isAuth = await window.SupabaseAuth?.isAuthenticated();
                if (!isAuth) {
                    const authenticated = await window.ensureAuthenticated?.();
                    if (!authenticated) return;
                }

                // Step 1: Generate file hash for duplicate detection
                setTransactionButtonProcessing(uploadBtn, 'Preparing artwork fingerprint...');
                const fileHash = await window.IPFSClient.generateFileHash(selectedFile);
                console.log('📝 File hash:', fileHash);

                // Step 2: Prepare media storage
                setTransactionButtonProcessing(uploadBtn, 'Preparing media...');
                const fileUpload = await window.IPFSClient.uploadFile(selectedFile);
                pendingArtwork = createPendingArtworkDraft({
                    walletAddress,
                    title,
                    description,
                    price,
                    fileHash,
                    fileUpload
                });
                console.log('📤 File uploaded:', fileUpload.ipfsHash);

                // Step 3: Create artwork details
                setTransactionButtonProcessing(uploadBtn, 'Preparing artwork details...');
                const metadata = window.IPFSClient.createMetadata({
                    title: title,
                    description: description,
                    imageUrl: fileUpload.url,
                    mediaType: selectedFile.type,
                    creator: walletAddress,
                    creatorValue: price,
                    aiGuidance: latestAIValuation,
                    createdAt: new Date().toISOString()
                });

                // Step 4: Store artwork metadata
                const metadataUpload = await window.IPFSClient.uploadMetadata(metadata);
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
                setTransactionButtonProcessing(uploadBtn, 'Connecting wallet...');
                if (!window.ArtSoulContracts.marketplaceContract) {
                    const provider = await window.web3Modal?.getWalletProvider();
                    if (!provider) throw new Error('No wallet provider');
                    await window.ArtSoulContracts.init(provider);
                }

                // Step 6: Register artwork with the protocol
                setTransactionButtonProcessing(uploadBtn, 'Registering artwork...');
                const result = await window.ArtSoulContracts.uploadArtwork(
                    fileUpload.ipfsHash,
                    metadataUpload.url,
                    fileHash,
                    price
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
                setTransactionButtonProcessing(uploadBtn, 'Launching auction...');
                let auctionCreated = false;
                let dbSynced = false;
                try {
                    const auctionTxHash = await window.ArtSoulContracts.createAuction(
                        result.artworkId,
                        price,
                        selectedAuctionDuration
                    );
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
                        window.location.href = 'profile.html';
                        return;
                    } else if (!auctionCreated) {
                        // Blockchain creation failed - artwork stays as draft
                        await alert(`Artwork registered - auction failed.\n\n${mappedAuctionError.message}\n\nYou can retry auction from your profile.`);
                        window.location.href = 'profile.html';
                        return;
                    }
                }

                // Success - redirect to the new artwork detail page.
                const chainId = window.getCurrentChainId?.() || window.ArtSoulContracts?.chainId || 84532;
                window.location.href = `artwork.html?id=v41:${chainId}:${result.artworkId}`;

            } catch (error) {
                console.error('Publish failed:', error);
                const mapped = mapPublishError(error);
                const errorMessage = `Publish failed: ${mapped.message}`;

                console.log('Publish error shown to user:', errorMessage);
                alert(errorMessage);
            } finally {
                uploading = false;
                restoreTransactionButton(uploadBtn, originalMarkup);
            }
        }

Object.assign(window, { handleFileSelect, retryAIValuation, selectAuctionDuration, clearOriginalWorkError, handleUpload });
