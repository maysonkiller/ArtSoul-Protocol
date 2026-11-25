// Fixed fiction for Visual Lab. Real campaigns have no delivery source yet.
export const sampleTime = '2030-03-01T10:00:00Z';
const terms = {
    publishedAt: '2030-02-26T09:00:00Z', startsAt: sampleTime, endsAt: '2030-03-02T10:00:00Z',
    proposedBy: 'sample-program', approvedBy: 'sample-reviewer', termsUrl: 'https://example.invalid/sample-terms'
};
export const sampleSchedule = {
    placements: [
        { ...terms, id: 'sample-partner', kind: 'free-partner', slot: 1, sponsorGroup: 'print-room',
            sponsorName: 'Print Room', relationship: 'Exhibition partner', reason: 'Community print exhibition' },
        { ...terms, id: 'sample-auction', kind: 'auction', slot: 2, opensAt: '2030-02-27T10:00:00Z',
            closesAt: '2030-02-28T10:00:00Z', reserveWei: '10000000000000000', payee: 'ProtocolTreasury' },
        { ...terms, id: 'sample-sponsor', kind: 'negotiated', slot: 3, sponsorGroup: 'night-school',
            sponsorName: 'Night School', relationship: 'Workshop sponsor', reason: 'Public print workshop',
            feeWei: '5000000000000000', inKind: 'workshop space', payee: 'ProtocolTreasury' }
    ],
    awards: [{ placementId: 'sample-auction', sponsorGroup: 'studio-nine', sponsorName: 'Studio Nine',
        relationship: 'Independent advertiser', winningBidWei: '25000000000000000',
        decidedAt: '2030-02-28T11:00:00Z', recordUrl: 'https://example.invalid/sample-award' }]
};
export const sampleCreatives = new Map([
    ['sample-partner', { sponsorGroup: 'print-room', artworkId: 13 }],
    ['sample-auction', { sponsorGroup: 'studio-nine', artworkId: 14 }],
    ['sample-sponsor', { sponsorGroup: 'night-school', artworkId: 15 }]
]);
