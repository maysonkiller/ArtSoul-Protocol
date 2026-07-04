import { React, createRoot } from './react-runtime.js';
import '../../docs-protocol.css';

const { useEffect, useState } = React;

const Chevron = ({ className = '' }) => (
    <svg className={`protocol-chevron ${className}`} width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4 6l4 4 4-4"></path>
    </svg>
);

const sections = [
    {
        id: 'what-is-artsoul',
        title: 'What Is ArtSoul?',
        content: (
            <>
                <p>ArtSoul is a discovery-first NFT art auction protocol on Base. Creators publish artwork before minting, the community discovers it, and a primary auction establishes the First Collector and canonical floor.</p>
                <p>The NFT is created only after successful settlement. This keeps on-chain supply tied to completed collector commitment instead of speculative listings.</p>
            </>
        )
    },
    {
        id: 'auctions',
        title: 'Discovery-First Auctions',
        content: (
            <>
                <p>A creator chooses a starting price and an auction duration of 24, 36, or 48 hours. Bids are accepted while the auction is live.</p>
                <div className="protocol-formula">Minimum next bid = max(current bid + 0.01 ETH, current bid + 2.5%)</div>
                <p>If the auction ends without bids, no NFT is minted and no floor is created. If it ends with a highest bidder, the 24-hour settlement window begins.</p>
            </>
        )
    },
    {
        id: 'deposits',
        title: 'Deposit-Based Bidding',
        content: (
            <>
                <p>Bidders lock a deposit instead of the full bid amount.</p>
                <div className="protocol-formula">Required deposit = max(10% of the bid, 0.01 ETH)</div>
                <p>Outbid deposits remain safe and can be withdrawn through the contract. The highest bidder's deposit is applied during settlement and is at risk only if settlement is not completed within the 24-hour window.</p>
                <p>On default, 80% of the locked deposit goes to the creator and 20% goes to the protocol. No NFT or floor is created.</p>
            </>
        )
    },
    {
        id: 'publishing',
        title: 'Publishing Artwork',
        content: (
            <ol>
                <li>Upload the artwork media and metadata.</li>
                <li>Review the AI value guidance. It is guidance only and never changes contract outcomes.</li>
                <li>Register the artwork on-chain.</li>
                <li>Start a primary auction with a supported duration and starting price.</li>
            </ol>
        )
    },
    {
        id: 'ai-guidance',
        title: 'AI Value Guidance',
        content: (
            <>
                <p>ArtSoul uses server-side AI analysis to provide optional value guidance from artwork metadata and available market signals.</p>
                <p>AI guidance never sets price, floor, ownership, royalties, settlement status, or mint rights. The creator and collectors make their own decisions.</p>
            </>
        )
    },
    {
        id: 'wallets-network',
        title: 'Wallets and Network',
        content: (
            <>
                <p>You can browse public artwork without a wallet. A wallet is required for publishing, bidding, withdrawing a deposit, settlement, listing, buying, and wallet-linked profile actions.</p>
                <p>The live test environment currently uses Base Sepolia. ArtSoul mainnet scope is Base only.</p>
            </>
        )
    },
    {
        id: 'fees',
        title: 'Fees and Economics',
        content: (
            <div className="protocol-table-wrap">
                <table>
                    <thead><tr><th>Event</th><th>Distribution</th></tr></thead>
                    <tbody>
                        <tr><td>Primary sale</td><td>97.5% creator, 2.5% protocol</td></tr>
                        <tr><td>Resale</td><td>92.5% seller, 5.5% creator royalty, 1% protocol, 1% Ecosystem Pool</td></tr>
                        <tr><td>Failed settlement deposit</td><td>80% creator, 20% protocol</td></tr>
                    </tbody>
                </table>
            </div>
        )
    },
    {
        id: 'trust-community',
        title: 'Trust and Community Signals',
        content: (
            <>
                <p>Likes, Would Buy, Watching, auction participation, and successful settlement help the community understand interest around an artwork.</p>
                <p>Public trust uses the highest applicable weight: Verified 1x, Genesis 2x, 100 or more settlements 3x, and Partner 5x. Trust is capped at 5x.</p>
                <p>Trust affects discovery only. It never changes price, floor, ownership, settlement, royalties, or treasury rules.</p>
            </>
        )
    },
    {
        id: 'discovery',
        title: 'Discovery Ranking',
        content: (
            <>
                <p>Discovery ordering combines meaningful community signals with trust-weighted participation and public auction or settlement history.</p>
                <p>Ranking is a visibility tool, not an economic mechanism. It does not choose the highest bidder or change any contract state.</p>
            </>
        )
    },
    {
        id: 'settlement',
        title: 'Settlement and Lazy Minting',
        content: (
            <>
                <p>After an auction ends with a highest bidder, that bidder has 24 hours to pay the remaining balance. The locked deposit counts toward the final price.</p>
                <p>Successful settlement mints the NFT to the First Collector and creates the canonical floor from the paid auction price. Before that transaction succeeds, no NFT exists.</p>
                <p>If settlement is missed, no NFT is minted and no floor is created.</p>
            </>
        )
    },
    {
        id: 'reauctioning',
        title: 'Re-Auctioning',
        content: (
            <>
                <p>A normal artwork can be offered in a new auction after a no-bid result or failed settlement reaches a re-auctionable contract state.</p>
                <p>The current testnet contract may require the creator to finalize an expired no-bid auction before starting the next auction. The planned mainnet contract removes that extra transaction and automatically returns the artwork to a re-auctionable state.</p>
                <p>The three-attempt limit belongs only to the first auction of a Partner Collection. It does not apply to normal user artwork.</p>
            </>
        )
    },
    {
        id: 'provenance-resale',
        title: 'Provenance and Resale',
        content: (
            <>
                <p>Minted NFT surfaces identify the Creator, First Collector, and current Owner when the Owner differs from the First Collector. Provenance comes from indexed on-chain events.</p>
                <p>Resales preserve creator royalties and update ownership. Marketplace approvals are restricted to approved marketplaces. Wallet-to-wallet transfers are non-sale events.</p>
            </>
        )
    },
    {
        id: 'safety',
        title: 'Reports and Copyright',
        content: (
            <p>Artwork can be reported through the notice-and-takedown process. Valid copyright complaints may hide content pending review. Critical or irreversible moderation actions require multisig approval.</p>
        )
    },
    {
        id: 'faq',
        title: 'Frequently Asked Questions',
        content: (
            <div className="protocol-faq">
                <h3>Is an NFT minted when artwork is published?</h3>
                <p>No. Publishing makes the artwork discoverable. Minting happens only after successful settlement.</p>
                <h3>Can I get my deposit back after I am outbid?</h3>
                <p>Yes. Your withdrawable deposit remains in the contract until you claim it.</p>
                <h3>Does the highest bid immediately create a floor?</h3>
                <p>No. The canonical floor exists only after the bid is fully settled.</p>
                <h3>Can discovery or AI change the auction result?</h3>
                <p>No. Discovery and AI guidance do not affect contract economics or lifecycle state.</p>
                <h3>Which network should I use now?</h3>
                <p>Use Base Sepolia for the current test environment.</p>
                <h3>Does ArtSoul have a token or points program?</h3>
                <p>No. ArtSoul is token-free and has no points or airdrop system.</p>
            </div>
        )
    }
];

function ProtocolSection({ section, isOpen, onToggle }) {
    return (
        <section id={section.id} className={`protocol-section${isOpen ? ' is-open' : ''}`}>
            <button className="protocol-section-trigger" type="button" onClick={onToggle} aria-expanded={isOpen} aria-controls={`${section.id}-content`}>
                <span>{section.title}</span>
                <Chevron />
            </button>
            <div id={`${section.id}-content`} className="protocol-section-body" hidden={!isOpen}>
                {section.content}
            </div>
        </section>
    );
}

function ProtocolDocsApp() {
    const [openSections, setOpenSections] = useState(() => ({ 'what-is-artsoul': true }));
    const [navOpen, setNavOpen] = useState(false);

    useEffect(() => {
        const id = window.location.hash.slice(1);
        if (!id || !sections.some(section => section.id === id)) return;
        setOpenSections(previous => ({ ...previous, [id]: true }));
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    }, []);

    const openFromNav = (id) => {
        setOpenSections(previous => ({ ...previous, [id]: true }));
        setNavOpen(false);
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    return (
        <main className="protocol-docs-shell">
            <div className="protocol-docs-intro">
                <p className="protocol-eyebrow">ArtSoul</p>
                <h1>Protocol Docs</h1>
                <p>Everything users need to publish, discover, bid, settle, collect, and resell artwork through ArtSoul.</p>
            </div>

            <button className="protocol-nav-toggle" type="button" onClick={() => setNavOpen(value => !value)} aria-expanded={navOpen} aria-controls="protocolSideNav">
                <span>On this page</span>
                <Chevron />
            </button>

            <div className="protocol-docs-layout">
                <aside id="protocolSideNav" className={`protocol-side-nav${navOpen ? ' is-open' : ''}`} aria-label="Protocol documentation sections">
                    <p>On this page</p>
                    <nav>
                        {sections.map(section => (
                            <button key={section.id} type="button" onClick={() => openFromNav(section.id)}>{section.title}</button>
                        ))}
                    </nav>
                </aside>

                <div className="protocol-content">
                    {sections.map(section => (
                        <ProtocolSection
                            key={section.id}
                            section={section}
                            isOpen={Boolean(openSections[section.id])}
                            onToggle={() => setOpenSections(previous => ({ ...previous, [section.id]: !previous[section.id] }))}
                        />
                    ))}
                </div>
            </div>
        </main>
    );
}

createRoot(document.getElementById('app')).render(<ProtocolDocsApp />);
