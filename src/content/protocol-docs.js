// Public documentation content shared by the page and search.
const sections = [
    {
        id: "what-is-artsoul",
        title: "What Is ArtSoul?",
        blocks: [
            {"type":"paragraph","text":"ArtSoul is a discovery-first NFT art auction protocol on Base. Creators publish artwork before minting, the community discovers it, and a primary auction establishes the First Collector and canonical floor."},
            {"type":"paragraph","text":"The NFT is created only after successful settlement. This keeps on-chain supply tied to completed collector commitment instead of speculative listings."}
        ]
    },
    {
        id: "auctions",
        title: "Discovery-First Auctions",
        blocks: [
            {"type":"paragraph","text":"A creator chooses a starting price and an auction duration of 24, 36, or 48 hours. Bids are accepted while the auction is live."},
            {"type":"formula","text":"Minimum next bid = max(current bid + 0.01 ETH, current bid + 2.5%)"},
            {"type":"paragraph","text":"A bid accepted in the final 10 minutes adds 10 minutes to the current closing time, up to one hour beyond the original closing time. For example, a bid accepted at 17:59 in an auction ending at 18:00 moves the close to 18:10."},
            {"type":"paragraph","text":"If bidding ends without bids, no NFT is minted and no floor is created. If there is a winning bid, the winner has 24 hours to pay from the transaction that closes the auction."}
        ]
    },
    {
        id: "deposits",
        title: "Deposit-Based Bidding",
        blocks: [
            {"type":"paragraph","text":"Bidders lock a deposit instead of the full bid amount."},
            {"type":"formula","text":"Required deposit = max(10% of the bid, 0.01 ETH)"},
            {"type":"paragraph","text":"Outbid deposits remain safe and can be withdrawn through the contract. The highest bidder's deposit is applied during settlement and is at risk only if settlement is not completed within the 24-hour window."},
            {"type":"paragraph","text":"On default, 80% of the locked deposit goes to the creator and 20% goes to the protocol. No NFT or floor is created."}
        ]
    },
    {
        id: "publishing",
        title: "Publishing Artwork",
        blocks: [
            {"type":"ordered-list","items":["Upload the artwork media and metadata.","Review the AI value guidance. It is guidance only and never changes contract outcomes.","Register the artwork on-chain.","Start a primary auction with a supported duration and starting price."]}
        ]
    },
    {
        id: "ai-guidance",
        title: "AI Value Guidance",
        blocks: [
            {"type":"paragraph","text":"ArtSoul uses server-side AI analysis to provide optional value guidance from artwork metadata and available market signals."},
            {"type":"paragraph","text":"AI guidance never sets price, floor, ownership, royalties, settlement status, or mint rights. The creator and collectors make their own decisions."}
        ]
    },
    {
        id: "wallets-network",
        title: "Wallets and Network",
        blocks: [
            {"type":"paragraph","text":"You can browse public artwork without a wallet. A wallet is required for publishing, bidding, withdrawing a deposit, settlement, listing, buying, and wallet-linked profile actions."},
            {"type":"paragraph","text":"The live test environment currently uses Base Sepolia. ArtSoul mainnet scope is Base only."}
        ]
    },
    {
        id: "fees",
        title: "Fees and Economics",
        blocks: [
            {"type":"table","headings":["Event","Distribution"],"rows":[["Primary sale","97.5% creator, 2.5% protocol"],["Resale","92.5% seller, 5.5% creator royalty, 1% protocol, 1% Ecosystem Pool"],["Failed settlement deposit","80% creator, 20% protocol"]]}
        ]
    },
    {
        id: "trust-community",
        title: "Trust and Community Signals",
        blocks: [
            {"type":"paragraph","text":"Likes, Would Buy, Watching, auction participation, and successful settlement help the community understand interest around an artwork."},
            {"type":"paragraph","text":"Public trust uses the highest applicable weight: Verified 1x, Genesis 1.3x, 100 or more settlements 3x, and Partner 5x. Trust is capped at 5x."},
            {"type":"paragraph","text":"Trust affects discovery only. It never changes price, floor, ownership, settlement, royalties, or treasury rules."}
        ]
    },
    {
        id: "discovery",
        title: "Discovery Ranking",
        blocks: [
            {"type":"paragraph","text":"Discovery ordering combines meaningful community signals with trust-weighted participation and public auction or settlement history."},
            {"type":"paragraph","text":"Ranking is a visibility tool, not an economic mechanism. It does not choose the highest bidder or change any contract state."}
        ]
    },
    {
        id: "collection-verification",
        title: "Collection verification",
        blocks: [
            {"type":"verification-mark","text":"Example blue check for a verified collection origin"},
            {"type":"paragraph","text":"Any artist or project team can publish an artwork or prepare a collection draft without a blue check or Partner status."},
            {"type":"paragraph","text":"Public collection covers are in development. A blue check will identify the artist or project whose connection to that collection was reviewed. Each review covers a specific blockchain and collection contract and can be revoked."},
            {"type":"paragraph","text":"Sales volume plays no part in this review. It carries no Trust weight or fee benefit and makes no claim about ownership, copyright or future value. Permission for a marketplace to transfer an NFT comes from its owner’s wallet."}
        ]
    },
    {
        id: "nft-frames",
        title: "NFT frames",
        blocks: [
            {"type":"paragraph","text":"A minted NFT can display one frame. When several apply, ArtSoul shows the first confirmed match in this order."},
            {"type":"frame-examples","caption":"Frame examples","items":[
                {"kind":"platform","name":"Platform","text":"The artwork was registered by a designated ArtSoul publisher."},
                {"kind":"genesis","name":"Genesis","text":"The work has a confirmed link to a Genesis grant on Base mainnet."},
                {"kind":"partner","name":"Partner collection","text":"The work belongs to an approved Partner Collection."}
            ]},
            {"type":"paragraph","text":"Works without a confirmed match keep their standard frame. Classic uses static outlines. Future uses a multicolor edge for Platform, gold for Genesis and cyan and blue for Partner. The Platform edge shimmers on desktop. Small screens and reduced motion keep every frame still."}
        ]
    },
    {
        id: "genesis-grants",
        title: "Genesis eligibility and grants",
        blocks: [
            { type: "paragraph", text: "Genesis is a planned series of 10,000 non-transferable art NFTs on Base mainnet. Grants will begin with a separate pilot after ordinary trading is stable. There is no sale or public claim." },
            { type: "table", headings: ["Category", "Who can receive a grant"], rows: [
                ["Founder", "Serial 0 is reserved for the founder."],
                ["Team and contributors", "Serials 1 through 200 are reserved for team members, contributors and developers."],
                ["Mainnet activity", "Participants with qualifying on-chain activity on Base mainnet. Testnet activity does not qualify."],
                ["Community", "Recipients selected through published contests and community rewards."]
            ] },
            { type: "paragraph", text: "Each grant requires multisig approval. Its public record will identify the recipient, serial, category and a hash of the reviewed decision. Genesis holders pay the same protocol fees as other participants." }
        ]
    },
    {
        id: "settlement",
        title: "Settlement and Lazy Minting",
        blocks: [
            {"type":"paragraph","text":"After an auction ends with a highest bidder, that bidder has 24 hours to pay the remaining balance. The locked deposit counts toward the final price."},
            {"type":"paragraph","text":"Successful settlement mints the NFT to the First Collector and creates the canonical floor from the paid auction price. Before that transaction succeeds, no NFT exists."},
            {"type":"paragraph","text":"If settlement is missed, no NFT is minted and no floor is created."}
        ]
    },
    {
        id: "reauctioning",
        title: "Re-Auctioning",
        blocks: [
            {"type":"paragraph","text":"A normal artwork can be offered in a new auction after a no-bid result or failed settlement reaches a re-auctionable contract state."},
            {"type":"paragraph","text":"When bidding ends without a bid, the work returns to Discovery and stays in the artist's Artworks. Viewing it requires no transaction. On the current Base Sepolia contract, anyone can record the close so the creator can start another auction. The wallet that confirms the close pays network gas."},
            {"type":"paragraph","text":"The three-attempt limit belongs only to the first auction of a Partner Collection. It does not apply to normal user artwork."}
        ]
    },
    {
        id: "provenance-resale",
        title: "Provenance and Resale",
        blocks: [
            {"type":"paragraph","text":"Minted NFT surfaces identify the Creator, First Collector, and current Owner when the Owner differs from the First Collector. Provenance comes from indexed on-chain events."},
            {"type":"paragraph","text":"Resales preserve creator royalties and update ownership. Marketplace approvals are restricted to approved marketplaces. Wallet-to-wallet transfers are non-sale events."}
        ]
    },
    {
        id: "safety",
        title: "Reports and Copyright",
        blocks: [
            {"type":"paragraph","text":"Artwork can be reported through the notice-and-takedown process. Valid copyright complaints may hide content pending review. Critical or irreversible moderation actions require multisig approval."}
        ]
    },
    {
        id: "roadmap",
        title: "ArtSoul roadmap",
        blocks: [{
            type: "faq",
            items: [
                {
                    question: "What can I try today?",
                    answer: "The marketplace is open on Base Sepolia. Artists can publish work and start an auction. Collectors can bid with test ETH, pay a winning bid to mint the NFT, and offer it for resale.",
                    link: { text: "Explore the gallery", href: "/gallery" }
                },
                {
                    question: "What is in preparation?",
                    answer: "ArtSoul is testing the new auction and NFT contracts on the way to a Base Sepolia rehearsal with artists and collectors. The rehearsal covers refunds and resale. The full independent security audit is planned for the end of the staged launch. Authors can already plan a collection and save the draft in their browser.",
                    link: { text: "Create a collection draft", href: "/collection-builder" }
                },
                {
                    question: "How will the move to Base mainnet work?",
                    answer: "Mainnet starts with an empty catalog. Creators can publish their work again on Base. Testnet activity stays separate. After launch approval, auctions and sales of individual artworks open first on Base mainnet. Genesis grants have a separate pilot that follows a period of stable trading."
                }
            ]
        }]
    },
    {
        id: "faq",
        title: "Frequently Asked Questions",
        blocks: [
            {"type":"faq","items":[{"question":"Is an NFT minted when artwork is published?","answer":"No. Publishing makes the artwork discoverable. Minting happens only after successful settlement."},{"question":"Can I get my deposit back after I am outbid?","answer":"Yes. Your withdrawable deposit remains in the contract until you claim it."},{"question":"Does the highest bid immediately create a floor?","answer":"No. The canonical floor exists only after the bid is fully settled."},{"question":"Can discovery or AI change the auction result?","answer":"No. Discovery and AI guidance do not affect contract economics or lifecycle state."},{"question":"Which network should I use now?","answer":"Use Base Sepolia for the current test environment."},{"question":"Does ArtSoul have a token or points program?","answer":"No. ArtSoul is token-free and has no points or airdrop system."}]}
        ]
    }
];

function blockText(block) {
    if (block.type === 'frame-examples') return [block.caption, ...block.items.map(item => item.name + ' ' + item.text)].join(' ');
    if (block.type === 'table') return [...block.headings, ...block.rows.flat()].join(' ');
    if (block.type === 'faq') return block.items.map(item => [item.question, item.answer, item.link?.text].filter(Boolean).join(' ')).join(' ');
    if (block.type === 'ordered-list') return block.items.join(' ');
    return block.text;
}

export const PROTOCOL_DOC_SECTIONS = sections.map(section => ({
    ...section, text: section.blocks.map(blockText).join(' ')
}));
