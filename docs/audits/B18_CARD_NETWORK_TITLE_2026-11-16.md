# B18: Network identity beside card titles

## Trigger and scope

The founder observed the Base mark overlapping Saved on Music 2 in the profile Collected tab. The old stylesheet positioned image marks at the media bottom and raised audio/video marks by 60 px (57 px on narrow cards), putting them into the action controls.

The November 16 direction supersedes the earlier B37/B38 media-overlay placement. Network identity now follows the title in the card body, with room reserved for the mark and ellipsis for long artwork titles. This applies to shared DOM and React cards, the legacy homepage profile modal renderer, and both external wallet NFT renderers. Existing wallet detail network fields remain available. Theme palettes, original brand assets, media actions, chain selection and transaction authority are unchanged. No dependencies, provider requests or database writes were added.

## Verification

- 61 focused tests pass: B37/B38 network identity, artwork controls/media/actions/prices and multichain inventory policy.
- DOM and React image/audio/video cases each expose exactly one named network mark beside the title and none over media. Unknown chains receive no guessed mark.
- Build passes for all 11 HTML routes and 172 compiled Tailwind utilities.
- Local Chrome rendering of the actual shared DOM/React components passes Classic and Future at desktop, 375 px and 320 px. Marker bounds are below media, disjoint from title/Saved/player controls, with no horizontal document overflow. Long titles retain the marker. Screenshots were reviewed.
- The local fixture uses sample media and explicitly exposes Saved controls for geometry only; it does not establish wallet, external inventory provider or physical iPhone acceptance.
- Independent review caught and corrected Ethereum backing specificity, preserving its neutral backing in wallet title rows.

## Release boundary

The four primary card pages load artwork-card.js v31 and nft-network-frames.css v2. CI and the exact production deployment are checked at release. This bounded presentation correction does not close the remaining Phase B reminder, infrastructure or physical voice acceptance gates.
