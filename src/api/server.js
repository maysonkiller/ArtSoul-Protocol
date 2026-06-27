import express from 'express';
import PostgreSQLDatabase from '../indexer/postgresql-database.js';
import ModerationService from '../features/moderation/moderation-service.js';
import RBACService from '../features/moderation/rbac-service.js';
import CryptographicAuditLog from '../features/moderation/cryptographic-audit-log.js';
import createModerationAPI from '../features/moderation/moderation-api.js';
import createIndexerAPI from '../indexer/indexer-api.js';
import ArtSoulIndexer from '../indexer/index.js';
import cors from 'cors';
import dotenv from 'dotenv';
import { verifyMessage } from 'ethers';
import crypto from 'crypto';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import { resolveIndexerChainConfigs } from '../indexer/chain-config.js';

dotenv.config();

function readEnv(names) {
    for (const name of names) {
        const value = process.env[name];
        if (value && value.trim()) return value.trim();
    }
    return '';
}

function requireEnv(names, label) {
    const value = readEnv(names);
    if (!value) {
        throw new Error(`${label} is required. Configure one of: ${names.join(', ')}`);
    }
    return value;
}

function resolveApiIndexerConfig() {
    const chains = resolveIndexerChainConfigs();
    if (chains.length > 1) {
        throw new Error(
            `Multiple API indexer chains configured (${chains.map(chain => chain.slug).join(', ')}). ` +
            'Run one API/indexer process per chain until API aggregation is enabled.'
        );
    }

    const chain = chains[0];

    return {
        rpcUrl: chain.rpcUrl,
        contractAddress: chain.coreAddress,
        chainId: chain.chainId,
        startBlock: chain.startBlock
    };
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    credentials: true,
    origin: true
}));
app.use(express.json());

const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(session({
    secret: requireEnv(['SESSION_SECRET'], 'SESSION_SECRET'),
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true }
}));

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: 'Too many authentication attempts', code: 'AUTH_RATE_LIMIT_EXCEEDED' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Nonces for SIWE are now handled in the DB (siwe_nonces table)

// Initialize database
const database = new PostgreSQLDatabase({
    connectionString: requireEnv(['DATABASE_URL'], 'DATABASE_URL')
});

// Initialize services
const rbacService = new RBACService(database);
const auditLog = new CryptographicAuditLog(database);
await auditLog.initialize();

const moderationService = new ModerationService(database, rbacService, auditLog);

// Initialize indexer (read-only mode for API)
const apiIndexerConfig = resolveApiIndexerConfig();
const indexer = new ArtSoulIndexer({
    database: database,
    rpcUrl: apiIndexerConfig.rpcUrl,
    contractAddress: apiIndexerConfig.contractAddress,
    chainId: apiIndexerConfig.chainId,
    startBlock: apiIndexerConfig.startBlock
});

// --- AUTH LAYER (EIP-4361 / SIWE) ---
app.get('/auth/nonce', authLimiter, async (req, res) => {
    const wallet = normalizeWalletAddress(req.query.wallet);
    if (!wallet) {
        return res.status(400).json({ error: 'INVALID_WALLET' });
    }

    try {
        const nonce = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes expiry

        await database.query(
            `INSERT INTO siwe_nonces (nonce, wallet, expires_at) VALUES ($1, $2, $3)`,
            [nonce, wallet, expiresAt]
        );

        res.json({ nonce });
    } catch (error) {
        console.error('[Auth] Nonce generation failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/auth/verify', authLimiter, async (req, res) => {
    try {
        const { message, signature, address, nonce } = req.body;
        if (!message || !signature || !address || !nonce) {
            return res.status(400).json({ error: 'Missing message, signature, address, or nonce' });
        }

        const walletAddr = normalizeWalletAddress(address);
        if (!walletAddr) {
            return res.status(400).json({ error: 'INVALID_WALLET' });
        }

        // 1. Cryptographic verification
        const recovered = verifyMessage(message, signature);
        if (recovered.toLowerCase() !== walletAddr) {
            return res.status(401).json({ error: 'INVALID_SIGNATURE' });
        }

        // 2. SIWE Nonce verification
        if (!message.includes(nonce)) {
            return res.status(401).json({ error: 'NONCE_NOT_IN_MESSAGE' });
        }

        const nonceResult = await database.query(
            `SELECT * FROM siwe_nonces WHERE nonce = $1 AND wallet = $2 AND used = false AND expires_at > now()`,
            [nonce, walletAddr]
        );

        if (!nonceResult || nonceResult.length === 0) {
            return res.status(401).json({ error: 'INVALID_OR_EXPIRED_NONCE' });
        }

        // 3. Mark nonce as used (prevent replay)
        await database.query(
            `UPDATE siwe_nonces SET used = true WHERE nonce = $1`,
            [nonce]
        );

        req.session.wallet = walletAddr;
        res.json({ success: true, wallet: walletAddr });
    } catch (error) {
        console.error('[Auth] Verification failed:', error);
        res.status(500).json({ error: 'Verification failed', details: error.message });
    }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('[Auth] Logout failed:', err);
            return res.status(500).json({ error: 'Internal server error during logout' });
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

app.get('/auth/session', (req, res) => {
    res.json({
        authenticated: Boolean(req.session.wallet),
        wallet: req.session.wallet || null
    });
});

const authenticateWallet = (req, res, next) => {
    if (!req.session.wallet) {
        return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in with Ethereum' });
    }
    next();
};

const sessionGuard = (req, res, next) => {
    const providedWallet = req.headers['x-wallet-address']?.toLowerCase();

    if (providedWallet && req.session.wallet && providedWallet !== req.session.wallet) {
        req.session.destroy((err) => {
            if (err) console.error('[Auth] Session destruction failed:', err);
            res.clearCookie('connect.sid');
            return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Wallet context mismatch. Session invalidated.' });
        });
        return;
    }
    next();
};

const authorizeRole = (requiredRole) => async (req, res, next) => {
    const wallet = req.session.wallet;
    if (!wallet) {
        return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    try {
        const admins = await database.query(
            `SELECT role FROM admin_users WHERE wallet_address = $1`,
            [wallet]
        );

        if (!admins || admins.length === 0) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'Administrative access required' });
        }

        const userRole = admins[0].role;
        const roleHierarchy = {
            'superadmin': 3,
            'moderator': 2,
            'operator': 1
        };

        if ((roleHierarchy[userRole] || 0) < (roleHierarchy[requiredRole] || 0)) {
            return res.status(403).json({
                error: 'INSUFFICIENT_PERMISSIONS',
                message: `This action requires ${requiredRole} privileges`
            });
        }

        next();
    } catch (error) {
        console.error('[Auth] Role authorization failed:', error);
        res.status(500).json({ error: 'Authorization check failed' });
    }
};

const authMiddleware = {
    authenticate: authenticateWallet,
    requireModerator: authorizeRole('moderator'),
    requireOperator: authorizeRole('operator'),
    requireSuperadmin: authorizeRole('superadmin')
};

// --- ACTION LAYER (Symmetric Truth Verification) ---

app.use('/api', globalApiLimiter, sessionGuard);

function isValidWalletAddress(value) {
    return /^0x[a-fA-F0-9]{40}$/.test(value || '');
}

function normalizeWalletAddress(value) {
    return isValidWalletAddress(value) ? value.toLowerCase() : '';
}

function validateArtworkId(value) {
    const text = String(value || '').trim();
    return /^[a-zA-Z0-9:_-]{1,128}$/.test(text) ? text : '';
}

function normalizeApiChainId(value) {
    const parsed = Number(value || 84532);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 84532;
}

function cleanProfilePayload(body = {}) {
    const allowedFields = ['username', 'bio', 'twitter_handle', 'discord_username', 'avatar_url'];
    return allowedFields.reduce((profile, field) => {
        if (body[field] !== undefined) {
            profile[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
        }
        return profile;
    }, {});
}

app.put('/api/profile', authenticateWallet, async (req, res) => {
    try {
        const wallet = normalizeWalletAddress(req.session.wallet);
        const profile = cleanProfilePayload(req.body);

        if (!wallet) {
            return res.status(401).json({ error: 'UNAUTHENTICATED' });
        }

        if (profile.username) {
            const existing = await database.query(
                `SELECT wallet_address FROM profiles WHERE username = $1 LIMIT 1`,
                [profile.username]
            );
            const owner = existing?.[0]?.wallet_address?.toLowerCase();
            if (owner && owner !== wallet) {
                return res.status(409).json({ error: 'USERNAME_TAKEN', message: 'Username already taken' });
            }
        }

        const rows = await database.query(
            `INSERT INTO profiles (
                wallet_address, username, bio, avatar_url, twitter_handle, discord_username, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, now())
            ON CONFLICT (wallet_address) DO UPDATE SET
                username = EXCLUDED.username,
                bio = EXCLUDED.bio,
                avatar_url = EXCLUDED.avatar_url,
                twitter_handle = EXCLUDED.twitter_handle,
                discord_username = EXCLUDED.discord_username,
                updated_at = now()
            RETURNING *`,
            [
                wallet,
                profile.username || null,
                profile.bio || null,
                profile.avatar_url || null,
                profile.twitter_handle || null,
                profile.discord_username || null
            ]
        );

        res.json({ success: true, profile: rows[0] });
    } catch (error) {
        console.error('[ProfileAPI] Profile upsert failed:', error);
        res.status(500).json({ error: 'PROFILE_SAVE_FAILED' });
    }
});

app.post('/api/discovery/like', authenticateWallet, async (req, res) => {
    try {
        const wallet = normalizeWalletAddress(req.session.wallet);
        const artworkId = validateArtworkId(req.body?.artwork_id);
        const chainId = normalizeApiChainId(req.body?.chain_id);

        if (!wallet) {
            return res.status(401).json({ error: 'UNAUTHENTICATED' });
        }
        if (!artworkId) {
            return res.status(400).json({ error: 'INVALID_ARTWORK_ID' });
        }

        const existing = await database.query(
            `SELECT * FROM votes WHERE artwork_id = $1 AND lower(voter_address) = $2 LIMIT 1`,
            [artworkId, wallet]
        );
        if (existing && existing.length > 0) {
            return res.json({ success: true, alreadyRecorded: true, chain_id: chainId });
        }

        const rows = await database.query(
            `INSERT INTO votes (artwork_id, voter_address, vote_type, created_at)
             VALUES ($1, $2, $3, now())
             RETURNING *`,
            [artworkId, wallet, 'like']
        );

        res.json({ success: true, alreadyRecorded: false, chain_id: chainId, vote: rows[0] });
    } catch (error) {
        console.error('[DiscoveryAPI] Like failed:', error);
        res.status(500).json({ error: 'LIKE_SAVE_FAILED' });
    }
});

app.post('/api/discovery/signal', authenticateWallet, async (req, res) => {
    try {
        const allowedSignals = new Set(['would_buy', 'watching']);
        const wallet = normalizeWalletAddress(req.session.wallet);
        const artworkId = validateArtworkId(req.body?.artwork_id);
        const chainId = normalizeApiChainId(req.body?.chain_id);
        const signalType = String(req.body?.signal_type || '').trim();

        if (!wallet) {
            return res.status(401).json({ error: 'UNAUTHENTICATED' });
        }
        if (!artworkId) {
            return res.status(400).json({ error: 'INVALID_ARTWORK_ID' });
        }
        if (!allowedSignals.has(signalType)) {
            return res.status(400).json({ error: 'INVALID_SIGNAL_TYPE' });
        }

        const rows = await database.query(
            `INSERT INTO artwork_social_signals (
                chain_id, artwork_id, wallet_address, signal_type, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, now(), now())
            ON CONFLICT (chain_id, artwork_id, wallet_address, signal_type) DO UPDATE SET
                updated_at = now()
            RETURNING *`,
            [chainId, artworkId, wallet, signalType]
        );

        res.json({ success: true, signal: rows[0] });
    } catch (error) {
        console.error('[DiscoveryAPI] Signal failed:', error);
        res.status(500).json({ error: 'SIGNAL_SAVE_FAILED' });
    }
});

app.post('/api/bid', authenticateWallet, async (req, res) => {
    try {
        const { auctionId, amount } = req.body;
        const wallet = req.session.wallet;
        const txId = crypto.randomUUID();

        // Create intent record in state machine
        await database.query(
            `INSERT INTO tx_states (tx_id, wallet, type, status) VALUES ($1, $2, $3, $4)`,
            [txId, wallet, 'bid', 'pending']
        );

        res.json({
            success: true,
            txId,
            message: 'Bid intent recorded. Please confirm transaction in wallet.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/settle', authenticateWallet, async (req, res) => {
    try {
        const { auctionId } = req.body;
        const wallet = req.session.wallet;

        // Verify this wallet is actually the winner in the DB
        const auctions = await database.query(
            `SELECT highest_bidder FROM auctions WHERE auction_id = $1`,
            [auctionId]
        );

        if (!auctions || auctions.length === 0 || auctions[0].highest_bidder.toLowerCase() !== wallet) {
            return res.status(403).json({ error: 'Only the winning bidder can settle this auction' });
        }

        const txId = crypto.randomUUID();
        await database.query(
            `INSERT INTO tx_states (tx_id, wallet, type, status) VALUES ($1, $2, $3, $4)`,
            [txId, wallet, 'settle', 'pending']
        );

        res.json({
            success: true,
            txId,
            message: 'Settlement authorized. Please execute on-chain.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/list', authenticateWallet, async (req, res) => {
    try {
        const { nftId, price } = req.body;
        const wallet = req.session.wallet;

        // TRUTH CHECK: Does this session wallet actually own the NFT?
        const ownerships = await database.query(
            `SELECT current_owner FROM nft_ownership WHERE token_id = $1`,
            [nftId]
        );

        if (!ownerships || ownerships.length === 0 || ownerships[0].current_owner.toLowerCase() !== wallet) {
            return res.status(403).json({ error: 'You do not own this NFT' });
        }

        const txId = crypto.randomUUID();
        await database.query(
            `INSERT INTO tx_states (tx_id, wallet, type, status) VALUES ($1, $2, $3, $4)`,
            [txId, wallet, 'list', 'pending']
        );

        res.json({
            success: true,
            txId,
            message: 'Listing authorized. Please confirm on-chain.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/buy', authenticateWallet, async (req, res) => {
    try {
        const { nftId, price } = req.body;
        const wallet = req.session.wallet;

        // NO OPTIMISTIC DB WRITES.
        // We do not set status = 'sold'. We only verify the NFT is available.
        const listings = await database.query(
            `SELECT status FROM secondary_sales WHERE token_id = $1 AND status = 'active' LIMIT 1`,
            [nftId]
        );

        if (!listings || listings.length === 0) {
            return res.status(404).json({ error: 'NFT not available for sale' });
        }

        const txId = crypto.randomUUID();
        await database.query(
            `INSERT INTO tx_states (tx_id, wallet, type, status) VALUES ($1, $2, $3, $4)`,
            [txId, wallet, 'buy', 'pending']
        );

        res.json({
            success: true,
            txId,
            message: 'Purchase authorized. Please execute on-chain.'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mount APIs
app.use('/api/moderation', createModerationAPI(moderationService, authMiddleware));
app.use('/api/indexer', createIndexerAPI(indexer, moderationService, authMiddleware));

// --- DASHBOARD API (OBSERVABILITY LAYER) ---
app.get('/api/dashboard/overview', authenticateWallet, authorizeRole('operator'), async (req, res) => {
    try {
        // 1. System Health
        const health = await database.query(
            `SELECT * FROM system_health LIMIT 1`
        );

        // 2. Queue Health
        const queue = await database.query(
            `SELECT * FROM queue_health`
        );

        // 3. AI Activity
        const ai = await database.query(
            `SELECT * FROM ai_activity_stream`
        );

        res.json({
            success: true,
            data: {
                health: health[0] || null,
                queue: queue[0] || null,
                ai: ai || []
            }
        });
    } catch (error) {
        console.error('[DashboardAPI] Overview failed:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard overview' });
    }
});

// Health check
app.get('/health', async (req, res) => {
// ... (rest of the file)
    try {
        const dbHealth = await database.healthCheck();
        const indexerHealth = await indexer.getIndexerHealth();

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbHlth,
            indexer: indexerHealth
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[API] Error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`[API] Server listening on port ${PORT}`);
    console.log(`[API] Health check: http://localhost:${PORT}/health`);
    console.log(`[API] Indexer API: http://localhost:${PORT}/api/indexer`);
    console.log(`[API] Moderation API: http://localhost:${PORT}/api/moderation`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[API] SIGTERM received, shutting down gracefully...');
    await database.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[API] SIGINT received, shutting down gracefully...');
    await database.close();
    process.exit(0);
});
