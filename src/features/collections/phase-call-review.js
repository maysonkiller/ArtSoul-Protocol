import { AbiCoder, Interface, ZeroAddress, ZeroHash, keccak256 } from 'ethers';
import { hasFirstWorkMint, parseDraft, parseEth, reviewConfig, scheduleTimestamp, supportsPhaseCallReview } from './launch-config.js';

const phaseTuple = 'tuple(uint8 kind,uint64 start,uint64 end,uint32 allocation,uint32 walletLimit,uint256 price,bytes32 merkleRoot,bool enabled,bool rollover,uint8 priceSource,bool fallbackEnabled,uint256 fallbackPrice)';
const launch = new Interface(['function addPhase(' + phaseTuple + ' config)', 'function lockConfiguration()']);

// These are untargeted calls for review. Constructor terms and the release address
// are verified separately. Only the two public auction-to-mint formats are represented.
export function preparePhaseCallReview(draftJson) {
    const draft = parseDraft(draftJson);
    const firstWork = hasFirstWorkMint(draft);
    if (!supportsPhaseCallReview(draft)) {
        throw new Error('Choose a Base Sepolia public auction followed by a public mint linked to its price, without a forge.');
    }
    const review = reviewConfig(draft);
    if (!review.contractCompatibility.compatible) {
        throw new Error((review.findings[0] || review.contractCompatibility.findings[0]).message);
    }
    const phases = draft.phases.map((phase, index) => {
        const config = {
            kind: index === 1 ? 0 : firstWork ? 3 : 2,
            start: scheduleTimestamp(phase.startAt) / 1000,
            end: scheduleTimestamp(phase.endAt) / 1000,
            allocation: Number(phase.allocation),
            walletLimit: Number(phase.walletLimit),
            price: index === 0 ? parseEth(phase.pricing.priceEth).toString() : '0',
            merkleRoot: ZeroHash,
            enabled: true,
            rollover: phase.unusedSupply === 'next',
            priceSource: index === 0 ? 0 : 1,
            fallbackEnabled: false,
            fallbackPrice: '0'
        };
        return { name: phase.name, config, data: launch.encodeFunctionData('addPhase', [config]) };
    });
    return { chainId: 84532, template: firstWork ? 'PartnerFirstWorkLaunch' : 'CollectionLaunch',
        collectionName: draft.name, maxSupply: Number(draft.maxSupply), metadataPrefix: draft.media.metadataBaseURI,
        phases, lock: { data: launch.encodeFunctionData('lockConfiguration') } };
}

// Mirrors the ConfigurationLocked event. Rebuild from the original draft because
// a valid retry or late close can move the live schedule after publication.
export function expectedPhaseCommitment(chainId, collectionAddress, phases) {
    return keccak256(AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'address', phaseTuple + '[]', 'address'],
        [chainId, collectionAddress, phases.map(phase => phase.config), ZeroAddress]
    ));
}
