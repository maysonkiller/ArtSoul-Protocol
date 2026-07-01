import { React, createRoot } from './react-runtime.js';

const { useEffect, useState } = React;

function DocSection({ section, isOpen, toggle }) {
    let formattedContent = section.content.replace(/\\n/g, '<br>');
    formattedContent = formattedContent.replace(
        /(https?:\/\/[^\\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; opacity: 1;">$1</a>'
    );

    return (
        <div
            id={section.id}
            className={`doc-section ${isOpen ? 'open' : ''} animate-fadeIn`}
            onClick={toggle}
        >
            <h2 className="heading-3">
                <span>{section.title}</span>
                <span className="toggle-icon">{'▾'}</span>
            </h2>
            <div className="content">
                {section.link ? (
                    <div>
                        <p className="body-text opacity-80 leading-relaxed" dangerouslySetInnerHTML={{ __html: formattedContent }}></p>
                        <div className="mt-4">
                            <a href={section.link} className="btn-main inline-block">
                                {section.linkText || 'Learn More →'}
                            </a>
                        </div>
                    </div>
                ) : (
                    <p className="body-text opacity-80 leading-relaxed" dangerouslySetInnerHTML={{ __html: formattedContent }}></p>
                )}
            </div>
        </div>
    );
}

function DocsApp() {
    const [isClassic, setIsClassic] = useState(true);
    const [openSections, setOpenSections] = useState({});

    useEffect(() => {
        const savedTheme = window.ThemeSync?.getTheme() || 'classic';
        setIsClassic(savedTheme === 'classic');
    }, []);

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const toggleSection = (title) => {
        setOpenSections(prev => ({
            ...prev,
            [title]: !prev[title]
        }));
    };

    const sections = [
        {
            title: 'What is ArtSoul?',
            content: 'ArtSoul is a discovery-first auction protocol for digital art. Artists can publish work without minting immediately, collectors can discover and support pieces before they become NFTs, and the final token is created only after a successful auction settlement.\n\nThe result is a cleaner market: fewer empty mints, stronger price discovery, protected resale floors, and a platform built around real collector intent instead of raw listing volume.',
            category: 'general'
        },
        {
            title: 'Auction-First Model',
            content: 'ArtSoul starts with the artwork, not the token. A creator publishes an artwork, chooses a supported test network, sets a starting price, and launches a 24, 36, or 48 hour auction. Bidders place a deposit-backed bid, and the highest bidder receives a 24 hour settlement window after the auction ends.\n\nIf settlement succeeds, the NFT is minted and transferred to the winner. If settlement fails, the NFT is not minted and no resale floor is created. This keeps the market honest: the floor is based on completed payment, not speculation.',
            link: 'auction-system.html',
            linkText: 'View Auction Protocol',
            category: 'general'
        },
        {
            title: 'Deposit-Based Bidding',
            content: 'Bids are backed by a deposit instead of requiring the full bid upfront. The required deposit is the greater of 10% of the bid or 0.01 ETH. To move the auction forward, the next bid must exceed the current highest bid by at least 0.01 ETH or 2.5%, whichever is higher.\n\nOutbid collectors do not lose their deposits. They can withdraw safely through the contract. The winning deposit only becomes at risk if the winner fails to complete settlement within the settlement window.',
            category: 'general'
        },
        {
            title: 'Delayed Mint Lifecycle',
            content: 'An artwork can be discovered, liked, watched, and auctioned before it is minted. The NFT is born only after the winning bidder pays the remaining balance during settlement.\n\nThis matters because it keeps blockchain supply tied to real collector commitment. Artists can build demand before minting, and collectors receive an NFT only when the sale actually completes.',
            category: 'general'
        },
        {
            title: 'Discovery Signals',
            content: 'ArtSoul discovery uses more than likes. The product direction combines Likes, Would Buy signals, Watching, auction activity, settlement history, creator momentum, Genesis status, and trust-weighted engagement.\n\nThese signals influence visibility only. They do not decide auction winners, set floor prices, change royalties, create mint rights, or alter contract economics.',
            category: 'general'
        },
        {
            title: 'Getting Started',
            content: 'Anyone can explore as a guest. Connect a wallet when you want to bid, settle, list, buy, publish artwork, update your profile, or save wallet-linked discovery signals. A profile helps collectors understand the creator behind the work, and it supports future Genesis eligibility.',
            category: 'guide'
        },
        {
            title: 'Publishing Artwork',
            content: 'Creators publish artwork metadata and media first. Publishing is not automatically minting an NFT. From there, the creator can prepare an auction with a supported duration and starting price. This separation keeps the creative catalog open while minting remains tied to successful collector settlement.',
            category: 'guide'
        },
        {
            title: 'Resale and Floor Protection',
            content: 'A resale floor exists only after a successful auction settlement. Once the NFT is minted, the owner can list it for resale, but the resale price must be at or above the completed auction price. Failed settlement does not create a floor.\n\nThis protects collectors and creators from artificial floors while preserving room for future value growth.',
            category: 'guide'
        },
        {
            title: 'Platform Fees',
            content: 'Platform fee: 2.5% on completed sales.\nCreator royalty: 7.5% on resale.\nBid deposit: max(10% of bid, 0.01 ETH).\n\nIf a winner defaults, the locked deposit is split 80% to the artist and 20% to the platform. The NFT is not minted, and the artwork can be relaunched or handled through a future supported sale path.',
            category: 'guide'
        },
        {
            title: 'Trust Without Auto-Bans',
            content: 'ArtSoul uses trust as a discovery signal, not a blunt punishment system. Low-trust users can still explore, interact, and participate when contract rules allow, but suspicious or low-quality engagement should carry less influence in ranking.\n\nSuccessful settlement is the strongest trust signal because it proves real collector commitment.',
            category: 'tech'
        },
        {
            title: 'Supported Networks',
            content: 'ArtSoul launches on Base. The prepared testnet path uses Base Sepolia and Ethereum Sepolia. Network switching is available from the wallet menu after a wallet is connected.',
            category: 'tech'
        },
        {
            title: 'Genesis Status',
            content: 'Genesis is the status NFT for the first 100 eligible ecosystem participants. Eligibility is based on real activity such as profile creation, artwork publishing, auction participation, successful settlement, and artwork interactions.\n\nGenesis is designed as a status and discovery layer, not a pay-to-win governance token.',
            category: 'tech'
        }
    ];

    const midpoint = Math.ceil(sections.length / 2);
    const leftSections = sections.slice(0, midpoint);
    const rightSections = sections.slice(midpoint);

    return (
        <main className="container mx-auto px-4 pt-8 md:pt-10 pb-12">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-6xl mx-auto">
                <div className="space-y-4">
                    {leftSections.map((section) => (
                        <DocSection
                            key={section.title}
                            section={section}
                            isOpen={openSections[section.title]}
                            toggle={() => toggleSection(section.title)}
                            isClassic={isClassic}
                        />
                    ))}
                </div>
                <div className="space-y-4">
                    {rightSections.map((section) => (
                        <DocSection
                            key={section.title}
                            section={section}
                            isOpen={openSections[section.title]}
                            toggle={() => toggleSection(section.title)}
                            isClassic={isClassic}
                        />
                    ))}
                </div>
            </div>

            <div className="max-w-5xl mx-auto mt-16 animate-fadeIn">
                <h2 className="text-3xl font-light text-center mb-8">Platform Direction</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[
                        {
                            title: 'Discovery First',
                            content: 'The homepage is a curated showcase. The gallery is the discovery hub. Rankings should reflect meaningful collector interest, not raw likes alone.'
                        },
                        {
                            title: 'Auction-Led Value',
                            content: 'Primary auctions establish commitment. Settlement creates the NFT and the protected resale floor only after the final price is actually paid.'
                        },
                        {
                            title: 'Creator Ownership',
                            content: 'Creators keep attribution and resale royalties while collectors receive clear lifecycle states: artwork, auction, settlement, NFT, and resale.'
                        },
                        {
                            title: 'Curated Expansion',
                            content: 'Collections and drops are separated from normal user artwork feeds, keeping partner launches and Genesis-style drops distinct from open discovery.'
                        }
                    ].map((item) => (
                        <div className={`doc-section open roadmap-card ${isClassic ? '' : 'future-roadmap-card'}`} key={item.title}>
                            <h2 className="heading-3">
                                <span className="roadmap-title">
                                    <span className="roadmap-marker"></span>
                                    <span>{item.title}</span>
                                </span>
                            </h2>
                            <div className="content">
                                <p className="body-text opacity-80 leading-relaxed">{item.content}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="text-center mt-16">
                <a href="index.html" className="inline-flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all hover:scale-110 close-button">
                    <span style={{ fontSize: '24px', lineHeight: '1' }}>&times;</span>
                </a>
            </div>
        </main>
    );
}

createRoot(document.getElementById('app')).render(<DocsApp />);
