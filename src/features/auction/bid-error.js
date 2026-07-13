function collectErrorValues(error, depth = 0, seen = new Set()) {
    if (!error || depth > 4 || seen.has(error)) return [];
    if (typeof error !== 'object') return [String(error)];
    seen.add(error);

    const values = [
        error.code,
        error.reason,
        error.shortMessage,
        error.message,
        error.errorName,
        error.revert?.name,
        error.data?.message
    ].filter(Boolean).map(String);

    for (const nested of [error.cause, error.error, error.info?.error, error.data]) {
        values.push(...collectErrorValues(nested, depth + 1, seen));
    }
    return values;
}

export function getBidErrorText(error) {
    return collectErrorValues(error).join(' ').toLowerCase();
}

function getRpcErrorCode(error) {
    return error?.code ?? error?.info?.error?.code ?? error?.error?.code ?? error?.cause?.code ?? null;
}

function cleanErrorReason(error) {
    const candidates = collectErrorValues(error)
        .filter((value) => !/^\s*-?\d+\s*$/.test(value))
        .map((value) => value
            .replace(/^execution reverted(?::\s*)?/i, '')
            .replace(/\s*\(action=.*$/i, '')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean)
        .filter((value) => !/missing revert data|call_exception|unknown error/i.test(value));
    return candidates[0]?.slice(0, 240) || null;
}

export function classifyBidFailure(error, context = {}) {
    const text = getBidErrorText(error);
    const rpcCode = getRpcErrorCode(error);
    const minimumEth = context.minimumBidEth || '0';
    const isCreator = Boolean(context.isCreator);
    const isHighestBidder = Boolean(context.isHighestBidder);

    if (
        context.providerSource === 'missing' ||
        /please connect|connect.*wallet|wallet.*connect|session.*missing|provider.*unavailable/.test(text)
    ) {
        return {
            category: 'wallet_session_missing',
            message: 'Your wallet session is unavailable. Reconnect your wallet and try again.',
            rpcCode
        };
    }
    if (
        rpcCode === 'BASE_SEPOLIA_REQUIRED' ||
        rpcCode === 'BASE_SEPOLIA_SWITCH_REJECTED' ||
        /base sepolia|required network|wrong network|unsupported network|chain mismatch|network changed/.test(text)
    ) {
        return {
            category: 'wrong_network',
            message: 'This bid requires Base Sepolia.',
            rpcCode
        };
    }
    if (
        rpcCode === 4001 ||
        rpcCode === '4001' ||
        String(rpcCode).toUpperCase() === 'ACTION_REJECTED' ||
        /user rejected|user denied|rejected request|action_rejected/.test(text)
    ) {
        return {
            category: 'user_rejected',
            message: 'Transaction was rejected in your wallet.',
            rpcCode
        };
    }
    if (/insufficient funds|exceeds balance|not enough.*eth|insufficient.*balance/.test(text)) {
        return {
            category: 'insufficient_funds',
            message: 'Not enough testnet ETH to cover the deposit and gas.',
            rpcCode
        };
    }
    if (/creatorcannotbid|creator cannot bid|author cannot bid|own artwork/.test(text)) {
        return {
            category: 'creator_cannot_bid',
            message: "You can't bid on your own artwork.",
            rpcCode
        };
    }
    if (/auctionnotactive|auction not active|auction ended|not active|ended|expired|closed/.test(text)) {
        return {
            category: 'auction_ended',
            message: 'This auction has ended.',
            rpcCode
        };
    }
    if (/bidtoolow|bid too low|minimum|increment|too low|below/.test(text)) {
        return {
            category: 'bid_below_minimum',
            message: `Your bid is below the minimum. The minimum next bid is ${minimumEth} ETH.`,
            rpcCode
        };
    }
    if (/biddercannotselfoutbid|highest bidder|self.?outbid|already.*highest/.test(text)) {
        return {
            category: 'already_highest_bidder',
            message: "You're already the highest bidder.",
            rpcCode
        };
    }
    if (context.auctionEnded) {
        return { category: 'auction_ended', message: 'This auction has ended.', rpcCode };
    }
    if (isCreator) {
        return { category: 'creator_cannot_bid', message: "You can't bid on your own artwork.", rpcCode };
    }
    if (context.bidBelowMinimum) {
        return {
            category: 'bid_below_minimum',
            message: `Your bid is below the minimum. The minimum next bid is ${minimumEth} ETH.`,
            rpcCode
        };
    }
    if (isHighestBidder) {
        return { category: 'already_highest_bidder', message: "You're already the highest bidder.", rpcCode };
    }

    const reason = cleanErrorReason(error);
    const punctuatedReason = reason ? reason.replace(/[.!?]+$/, '') : null;
    return {
        category: 'contract_or_rpc_failure',
        message: punctuatedReason
            ? `The bid failed: ${punctuatedReason}.`
            : 'The bid was rejected by the contract or RPC, but no reason was returned.',
        rpcCode,
        reason: punctuatedReason
    };
}
