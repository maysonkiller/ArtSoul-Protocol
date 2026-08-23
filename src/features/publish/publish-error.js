/**
 * What to tell somebody whose publish did not go through.
 *
 * A-70 replaced one untrue sentence with another. The reported failure of
 * 2026-08-21 was real: the public Base Sepolia endpoint answered `no backend is
 * currently healthy to serve traffic`, ethers surfaced that as `missing revert
 * data` on `estimateGas`, and the interface said the registration transaction
 * had failed on-chain when nothing had been sent. The fix classified every
 * `missing revert data` as an outage - but that same error is exactly what a
 * contract that refuses without a reason produces, so a genuine rejection now
 * reads "the network did not answer, nothing was sent", which is equally false
 * and sends the person to wait out an outage that is not happening.
 *
 * The error alone cannot separate the two. Three things can:
 *
 *   1. Structured ethers fields. `code`, `action`, `data`, `reason`, `event` -
 *      not a substring search over an English sentence that varies by provider.
 *      `action` in particular says whether anything was ever sent.
 *   2. The publish stage. Registration and auction fail with different
 *      consequences and need different instructions.
 *   3. Concrete transport evidence. An HTTP status the request never got past,
 *      a timeout, a JSON-RPC refusal to serve - or, when the error is genuinely
 *      ambiguous, no route to the chain answering at all.
 *
 * That last one runs in one direction only. Every route being unreachable
 * supports an outage. Some route answering `eth_chainId` does NOT support the
 * opposite: it proves one cheap call to one endpoint succeeded, possibly
 * seconds later and never through the endpoint the wallet used. It cannot
 * convict the contract.
 *
 * Where none of the three resolves it, this says so rather than picking the
 * more comfortable of two claims it cannot support.
 */

// Phrases that only a transport failure produces. Providers word these
// differently, so the list is evidence of last resort - the structured fields
// above are consulted first.
const TRANSPORT_PHRASES = [
    'no backend is currently healthy',
    'failed to fetch',
    'fetch failed',
    'network request failed',
    'load failed',
    'econnrefused',
    'econnreset',
    'etimedout',
    'enotfound',
    'socket hang up',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'too many requests',
    'rate limit',
    'connection closed',
    'did not answer'
];

// JSON-RPC error codes that describe the server refusing to serve, not the
// call failing. The list is deliberately tiny. -32000 is absent because nodes
// use it for "header not found" and for a plain execution revert alike; -32603
// is absent because "internal error" is the wrapper providers reach for around
// anything they did not model, execution failures included. Neither proves an
// outage on its own.
const TRANSPORT_RPC_CODES = new Set([-32005]);

// HTTP statuses that mean the request was never served. A 4xx other than these
// is an answer: the server was up, read the request, and rejected it.
function isUnservedStatus(status) {
    return status === 0 || status === 408 || status === 429 || status >= 500;
}

function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null) return value;
    }
    return null;
}

function toStatus(value) {
    // An absent status must stay absent. Number(null) is 0, and a 0 read as a
    // status is a failed request - the difference between "the node answered
    // nothing" and "we were never told" is the whole point of this file.
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Everything the error itself can prove, read from structured fields first.
 */
function readFailureEvidence(error) {
    const code = String(error?.code || '').toUpperCase();
    const action = String(error?.action || '');
    const event = String(error?.event || '');
    const message = String(error?.shortMessage || error?.reason || error?.message || '');
    const lower = message.toLowerCase();

    const httpStatus = toStatus(firstDefined(
        error?.status,
        error?.statusCode,
        error?.info?.responseStatus,
        error?.response?.statusCode,
        error?.response?.status,
        error?.error?.status
    ));
    const rpcErrorCode = toStatus(firstDefined(
        error?.rpcError?.code,
        error?.error?.code,
        error?.info?.error?.code
    ));

    // A revert carries data, a decoded reason, or both. ethers leaves all of it
    // null when the node returned nothing at all.
    const revertData = firstDefined(error?.data, error?.info?.error?.data, error?.error?.data);
    const hasRevertData = typeof revertData === 'string' && revertData.length > 2;
    const hasRevertReason = Boolean(error?.reason || error?.revert);

    // A receipt is the chain's own verdict, and the only one that settles a
    // transaction after it has been broadcast. status 0 is a mined failure -
    // final, not uncertain - and ethers attaches it to a CALL_EXCEPTION that
    // otherwise carries no revert data at all.
    const receipt = firstDefined(error?.receipt, error?.info?.receipt, error?.transactionReceipt);
    const receiptStatus = receipt ? toStatus(receipt.status) : null;
    const receiptProvesFailure = receiptStatus === 0;

    // The wallet says the person declined. Nothing was broadcast under that
    // instruction, whatever else is attached to the error.
    const userRejected = code === 'ACTION_REJECTED'
        || code === '4001'
        || lower.includes('user rejected')
        || lower.includes('user denied');

    // ethers reports an actual chain change as NETWORK_ERROR with event
    // 'changed'. Its other NETWORK_ERROR events describe an unreachable node.
    const chainChanged = event === 'changed'
        || /network (was )?changed/.test(lower)
        || /underlying network changed/.test(lower);

    // The node executed something and told us so. That outranks every transport
    // signal below: providers routinely wrap a revert in an "internal error"
    // envelope, and a revert wrapped in one is still a revert.
    const hasContractEvidence = hasRevertData || hasRevertReason || receiptProvesFailure;

    const transportTag = String(error?.transport || '');
    const transportFailed = Boolean(!hasContractEvidence && (
        transportTag === 'timeout'
        || transportTag === 'network'
        // base-network.js tags every non-OK response 'http'. A 400 is still an
        // answer, so the status decides, not the tag.
        || (transportTag === 'http' && httpStatus !== null && isUnservedStatus(httpStatus))
        || code === 'TIMEOUT'
        || code === 'SERVER_ERROR'
        || (code === 'NETWORK_ERROR' && !chainChanged)
        || (httpStatus !== null && isUnservedStatus(httpStatus))
        || (rpcErrorCode !== null && TRANSPORT_RPC_CODES.has(rpcErrorCode))
        || TRANSPORT_PHRASES.some(phrase => lower.includes(phrase))
    ));

    // The ambiguous shape at the centre of A-70: a CALL_EXCEPTION with neither
    // revert data nor a reason. An unreachable node produces it. So does a
    // contract that refuses with no reason string and no custom error.
    const reasonlessCallException = Boolean(
        (code === 'CALL_EXCEPTION' || lower.includes('missing revert data'))
        && !hasContractEvidence
    );

    // `estimateGas` and `call` never leave the node. Nothing can have been
    // published, whatever the cause turns out to be.
    const nothingWasSent = action === 'estimateGas' || action === 'call';

    return {
        code,
        action,
        message,
        lower,
        httpStatus,
        rpcErrorCode,
        chainChanged,
        receiptStatus,
        receiptProvesFailure,
        userRejected,
        transportFailed,
        reasonlessCallException,
        hasContractEvidence,
        hasRevertData,
        hasRevertReason,
        nothingWasSent
    };
}

function isAuctionStage(stage) {
    return stage === 'auction';
}

// Registration is a separate, final transaction that happens first. By the time
// the auction stage can fail, a real artwork exists on chain and on the person's
// profile, so any message here that says nothing was published contradicts
// something they can go and look at. Every wording that could make that claim is
// paired instead of patched.
function stageMessage(stage, pair) {
    return isAuctionStage(stage) ? pair.auction : pair.register;
}

const START_AUCTION_RECOVERY = 'Open your profile and use Start auction on this artwork to finish it.';

function userRejectedMessage(stage) {
    return stageMessage(stage, {
        register: 'The transaction was rejected in your wallet. No artwork was published.',
        auction: `The auction transaction was rejected in your wallet. The artwork is registered; its auction was not created. ${START_AUCTION_RECOVERY}`
    });
}

function insufficientFundsMessage(stage) {
    return stageMessage(stage, {
        register: 'Insufficient ETH on Base Sepolia to publish this artwork. Top up your wallet and try again.',
        auction: `Insufficient ETH on Base Sepolia to create the auction. The artwork is registered; its auction was not created. Top up your wallet, then ${START_AUCTION_RECOVERY.charAt(0).toLowerCase()}${START_AUCTION_RECOVERY.slice(1)}`
    });
}

function nonceTooLowMessage(stage) {
    return stageMessage(stage, {
        register: 'Your wallet has a pending transaction. Wait for it to finish, then try again.',
        auction: `Your wallet has a pending transaction, so the auction was not created. The artwork is registered. Wait for the pending transaction to finish, then ${START_AUCTION_RECOVERY.charAt(0).toLowerCase()}${START_AUCTION_RECOVERY.slice(1)}`
    });
}

function networkChangedMessage(stage) {
    return stageMessage(stage, {
        register: 'The wallet network changed during publishing. Switch back to Base Sepolia and try again.',
        auction: `The wallet network changed while the auction was being created. The artwork is registered; its auction was not created. Switch back to Base Sepolia, then ${START_AUCTION_RECOVERY.charAt(0).toLowerCase()}${START_AUCTION_RECOVERY.slice(1)}`
    });
}

// Only `estimateGas` and `call` prove nothing left the browser. Everything else
// - a send, a receipt wait, an action ethers did not label - may already be on
// the chain, and a message that says otherwise is the A-70 mistake again with
// the roles reversed.
function networkUnavailableMessage(stage, provenNotSent) {
    if (provenNotSent) {
        return stageMessage(stage, {
            register: 'Base Sepolia did not answer, so nothing was sent and nothing was published. This is the network, not your artwork or your wallet. Wait a moment and try again.',
            auction: `Base Sepolia did not answer, so the auction transaction was never sent. The artwork is registered; its auction was not created. ${START_AUCTION_RECOVERY}`
        });
    }
    return stageMessage(stage, {
        register: 'Base Sepolia stopped answering during publishing, so whether anything reached the chain is unknown. Open your profile and check before publishing again.',
        auction: 'Base Sepolia stopped answering while the auction was being created, so whether it reached the chain is unknown. The artwork is registered. Open your profile and check it there before starting the auction again.'
    });
}

// A hash exists, and nothing has positively settled it. What went wrong after
// the broadcast is not knowable from here - the connection, the provider, the
// parsing - so this names none of them. Claiming the network stopped answering
// when the evidence does not say so is the A-70 mistake in a third costume.
// The one thing that must be said is: do not send it again.
function confirmationUncertainMessage(stage) {
    return stageMessage(stage, {
        register: 'The transaction was submitted, but its final status could not be confirmed. It may already be on-chain. Do not submit it again. Check your profile before retrying.',
        auction: 'The auction transaction was submitted, but its final status could not be confirmed. It may already be on-chain. Do not submit it again. The artwork is registered - check your profile before retrying.'
    });
}

function revertedMessage(stage, nothingWasSent) {
    if (isAuctionStage(stage)) {
        return nothingWasSent
            ? `Base Sepolia rejected the auction before it was sent. The artwork is registered; its auction was not created. ${START_AUCTION_RECOVERY}`
            : `The artwork was registered, but the auction transaction failed on Base Sepolia. ${START_AUCTION_RECOVERY}`;
    }
    return nothingWasSent
        ? 'Base Sepolia rejected this registration before it was sent. No artwork was published.'
        : 'The artwork registration transaction failed on Base Sepolia. No artwork was published.';
}

// Neither verdict is supported. Say that, and point at the one place that will
// show the truth once the chain catches up.
function unresolvedMessage(stage) {
    return stageMessage(stage, {
        register: 'The publish could not be completed and Base Sepolia gave no reason we can read. Open your profile to check before trying again.',
        auction: 'The auction could not be created and Base Sepolia gave no reason we can read. The artwork is registered. Open your profile to check it, and use Start auction there to try again.'
    });
}

const DIRECT_MESSAGES = {
    FILE_REQUIRED: 'Select an artwork file before continuing.',
    INVALID_FILENAME: 'This file name looks auto-generated. Please rename the file to a meaningful title (for example: my-artwork.png) and try again.',
    UNSUPPORTED_FILE_TYPE: 'This file type is not supported. Choose a supported image, video, or audio file.',
    WALLET_NOT_CONNECTED: 'Connect your wallet before publishing this artwork.',
    AUTHORIZATION_REQUIRED: 'Authorize this upload with your wallet signature before publishing.',
    AI_UNAVAILABLE: 'AI value guidance is not ready. Request an estimate before publishing.',
    AUCTION_CONFIRMATION_PENDING: 'The auction transaction was submitted and is still finalizing. Check its status from your profile before trying anything again.'
};

// Outcomes that mean a transaction the wallet already broadcast is still in
// play. Their pending record must survive: deleting it is what leaves somebody
// with no trace of a transaction that may be mining right now, and a card that
// says "submitted" is the only thing standing between them and sending it
// twice.
const KEEPS_PENDING_TRANSACTION = new Set([
    'CONFIRMATION_UNCERTAIN',
    'AUCTION_CONFIRMATION_PENDING'
]);

export function keepsPendingTransaction(code) {
    return KEEPS_PENDING_TRANSACTION.has(String(code || ''));
}

/**
 * Does this error positively prove the transaction is finished and failed?
 *
 * Only three things do: a mined receipt with status 0, revert data or a decoded
 * reason from the node, and the wallet reporting that the person declined.
 * Everything else - a dropped connection, a chain switch, an envelope the
 * provider did not model, a confirmation we could not parse - leaves a
 * broadcast transaction unsettled, and treating unsettled as failed is what
 * invites a second one.
 */
export function provesFinalFailure(error) {
    const evidence = readFailureEvidence(error);
    return evidence.receiptProvesFailure || evidence.hasContractEvidence || evidence.userRejected;
}

/**
 * @param {unknown} error
 * @param {object} [context]
 * @param {string} [context.stage] the publish stage the failure happened in
 * @param {string} [context.submittedTxHash] the hash of a transaction the wallet
 *   already broadcast at this stage. Its presence is the only thing that
 *   distinguishes "we never sent it" from "we sent it and lost the answer".
 * @param {() => Promise<{reachable: boolean}>} [context.probeNetwork] bounded
 *   reachability check. Consulted only for the one genuinely ambiguous error
 *   shape, and only ever to confirm an outage - never to rule one out.
 * @param {(error: unknown) => string} [context.describeFallback] wording for
 *   failures this classifier has no opinion about
 */
export async function classifyPublishFailure(error, context = {}) {
    const { stage = 'idle', submittedTxHash = '', probeNetwork = null, describeFallback = null } = context;
    const submitted = Boolean(String(submittedTxHash || '').trim());
    const evidence = readFailureEvidence(error);
    const { code, lower } = evidence;

    // ---- Positively final outcomes, before anything else can guess ----------
    //
    // The wallet says the person declined, so nothing was broadcast under that
    // instruction. This holds even when a hash from an earlier stage is known.
    if (evidence.userRejected) {
        return { code: 'USER_REJECTED', message: userRejectedMessage(stage), evidence };
    }

    // A mined receipt with status 0 is the chain's own verdict. ethers attaches
    // it to a CALL_EXCEPTION that carries no revert data at all, so without
    // reading it a real, final, on-chain failure reads as "still finalizing" -
    // a card that tells somebody to wait for something that already ended.
    // Revert data or a decoded reason is the same kind of proof, and a revert
    // wrapped in a provider's "internal error" envelope is still a revert.
    if (evidence.hasContractEvidence) {
        return { code: 'TRANSACTION_REVERTED', message: revertedMessage(stage, evidence.nothingWasSent), evidence };
    }

    // Our own post-submission states already name what happened and already
    // preserve the pending record. Flattening them into the generic uncertain
    // message would throw away the more specific thing we do know - that the
    // indexer was given its full window and did not confirm.
    if (keepsPendingTransaction(code)) {
        return {
            code,
            message: DIRECT_MESSAGES[code] || confirmationUncertainMessage(stage),
            evidence,
            submittedTxHash
        };
    }

    // ---- Nothing above settled it, and a hash exists ------------------------
    //
    // The wallet broadcast something. Every remaining verdict is a guess about
    // a transaction that may be mining right now: a chain switch, an envelope
    // the provider did not model, a confirmation we could not parse, a dropped
    // connection. The harmful half of that guess is telling somebody to send it
    // again, so nothing after this point may be reached with a hash in hand.
    if (submitted) {
        return {
            code: 'CONFIRMATION_UNCERTAIN',
            message: confirmationUncertainMessage(stage),
            evidence,
            submittedTxHash
        };
    }

    // Before the transport branch, which used to claim every NETWORK_ERROR:
    // a wallet that moved off Base Sepolia mid-publish reports NETWORK_ERROR
    // too, and telling that person to wait out an outage leaves them waiting
    // for something that will never change on its own.
    if (evidence.chainChanged) {
        return { code: 'NETWORK_CHANGED', message: networkChangedMessage(stage), evidence };
    }

    if (lower.includes('nonce too low')) {
        return { code: 'NONCE_TOO_LOW', message: nonceTooLowMessage(stage), evidence };
    }
    if (lower.includes('insufficient funds') || lower.includes('insufficient gas') || lower.includes('not enough funds')) {
        return { code: 'INSUFFICIENT_FUNDS', message: insufficientFundsMessage(stage), evidence };
    }

    // Concrete transport evidence: a status the request never got past, a
    // timeout, a refusal to serve, or a phrase only an unreachable node emits.
    if (evidence.transportFailed) {
        return {
            code: 'NETWORK_UNAVAILABLE',
            message: networkUnavailableMessage(stage, evidence.nothingWasSent),
            evidence
        };
    }

    // The ambiguous shape. The chain is asked in one direction only: no route
    // answering supports an outage, one route answering proves nothing about
    // the endpoint the wallet used, so it can never convict the contract.
    if (evidence.reasonlessCallException) {
        if (typeof probeNetwork === 'function') {
            try {
                const probed = await probeNetwork();
                if (probed && probed.reachable === false) {
                    return {
                        code: 'NETWORK_UNAVAILABLE',
                        message: networkUnavailableMessage(stage, evidence.nothingWasSent),
                        evidence,
                        probe: probed
                    };
                }
            } catch {
                // A probe that itself failed is not evidence of anything.
            }
        }
        return { code: 'PUBLISH_UNRESOLVED', message: unresolvedMessage(stage), evidence };
    }

    if (code === 'CALL_EXCEPTION' || lower.includes('reverted') || lower.includes('execution reverted')) {
        return { code: 'TRANSACTION_REVERTED', message: revertedMessage(stage, evidence.nothingWasSent), evidence };
    }

    if (lower.includes('no wallet provider') || (lower.includes('wallet provider') && lower.includes('not available'))) {
        return { code: 'WALLET_NOT_CONNECTED', message: DIRECT_MESSAGES.WALLET_NOT_CONNECTED, evidence };
    }
    if (lower.includes('metadata upload')) {
        return { code: 'METADATA_UPLOAD_FAILED', message: 'The artwork details could not be stored. Please try again.', evidence };
    }
    if (lower.includes('storage upload') || lower.includes('upload authorization')) {
        return { code: 'MEDIA_UPLOAD_FAILED', message: 'The artwork file could not be stored. Check your connection and try again.', evidence };
    }
    if (lower.includes('confirmed artwork id') || lower.includes('register transaction did not return')) {
        return { code: 'REGISTRATION_INCOMPLETE', message: 'The wallet did not return a complete artwork registration confirmation. Check your profile before retrying.', evidence };
    }
    if (lower.includes('unsupported network') || lower.includes('wrong network')) {
        return { code: 'UNSUPPORTED_NETWORK', message: 'This artwork must be published on Base Sepolia. Switch networks and try again.', evidence };
    }
    if (lower.includes('duplicate artwork')) {
        return { code: 'DUPLICATE_ARTWORK', message: 'This file has already been published.', evidence };
    }

    if (DIRECT_MESSAGES[code]) return { code, message: DIRECT_MESSAGES[code], evidence };

    // The publish flow owns its own per-stage wording; keeping a second copy of
    // that table here is how the two drift apart.
    const fallback = typeof describeFallback === 'function'
        ? describeFallback(error)
        : 'The publish flow could not be completed. Please try again.';
    return { code: code || 'PUBLISH_FAILED', message: fallback, evidence };
}
