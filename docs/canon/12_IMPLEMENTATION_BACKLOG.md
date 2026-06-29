# Implementation Backlog

Work must proceed one contained task at a time. Do not mix protocol, visual, security, and infrastructure changes in the same PR unless the task explicitly requires it.

## Current Priority Order

1. Security and public-repo readiness.
2. V4.1 projection and provenance correctness.
3. Profile lifecycle and ownership/action gating.
4. Wallet robustness and SIWE account switching.
5. Theme consistency and card unification.
6. Upload and auction UX polish.
7. Moderation/reporting MVP.
8. Persistent infrastructure and monitoring.
9. Public beta readiness.
10. Mainnet readiness.

## Future Mainnet Contract Requirements

- [ ] Replace the current testnet's manual no-bid auction finalization with an automatic on-chain transition: once an auction expires with no bids, the artwork must return to a re-auctionable state without a separate "End Expired Auction" transaction.
- This item requires a new contract version and mainnet redeploy. It must not be treated as current deployed testnet behavior or implemented as a frontend-only shortcut.

## Rules

- One backlog item equals one task.
- Contract changes require focused tests.
- Storage layout changes to deployed contracts must be flagged loudly.
- Hidden anti-sybil implementation details stay out of the public repo.
