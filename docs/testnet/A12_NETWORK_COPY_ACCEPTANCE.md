# A12 Network Copy Production Acceptance

Accepted: 2026-07-28

Scope: canonical backlog A12 and durable backlog items A-28 and A-44.

## Accepted changes

- [PR #162](https://github.com/maysonkiller/ArtSoul-Protocol/pull/162), merge commit `a351d7da27d1f05679446f15bc2955dea61aa8f6`, removed stale active-network copy.
- Public and preview footers identify Base Sepolia as the active testnet and Base as the production chain.
- The account menu offers Base Sepolia as the only product-network switch. A wallet may still report its actual foreign network, but protected writes remain fail-closed to Base Sepolia.
- Protocol Docs use the canonical Genesis trust weight of `1.3x`; the stale `2x` public copy is absent.
- Historical Ethereum Sepolia records remain readable where migration compatibility requires them, but Ethereum Sepolia is not an active or selectable product network.
- [PR #163](https://github.com/maysonkiller/ArtSoul-Protocol/pull/163), merge commit `c1590016cdf983e82504f954c217febb97b43806`, fixed the async module-entry race discovered during acceptance. Every Vite HTML entry now relies on native deferred module semantics, and the build rejects a future async module entry.

## Production evidence

The public deployment at `https://artsoul.vercel.app` was checked after both merge commits:

1. `index.html` contained `Base Sepolia (active testnet)` and `Base (production chain)`.
2. The public footer contained neither `Ethereum Sepolia` nor `Future production networks`.
3. Desktop and a `390 x 844` mobile viewport had no horizontal document overflow.
4. `docs-protocol.html` rendered its React application with no React errors after the A-44 correction.
5. The expanded Trust and Community Signals section contained `Genesis 1.3x` and did not contain `Genesis 2x`.
6. Representative `gallery.html` and `profile.html` React routes rendered with no console errors and no horizontal document overflow.
7. PR #163 passed static checks, Ubuntu CI, Windows CI, and Vercel deployment checks.

## Operational boundary

This acceptance required no Supabase schema or data migration, no database backup, and no Hetzner restart. It changed public copy and browser module scheduling only. Mobile wallet SIWE, a real signed publish acceptance, moderation activation, and controlled-beta GO remain separate open Phase A gates.
