# ArtSoul Resource-Gated Work Plan

Updated: 2026-09-30

This document records work that remains required but cannot be activated or completed safely until its external resources are available. It is an operational plan subordinate to the [Canon Bible](canon/ARTSOUL_CANON_BIBLE_FULL.md) and the [durable backlog](BACKLOG.md); it does not amend architecture, economics, roles, or lifecycle rules.

## Operating Rule

ArtSoul may continue Phase A and Phase B work on the existing Base Sepolia, Vercel, Supabase, and indexer setup without adding new paid services. A missing budget does not delete or waive a requirement. Resource-gated work remains recorded with an explicit activation condition.

No agent or operator may reduce cost by:

- promoting the current testnet prototype contracts to mainnet;
- skipping the independent contract security review;
- combining ProtocolTreasury, EcosystemTreasury, deployer, keeper, or daily moderation authority into one hot wallet;
- enabling production passkey recovery before its final RP ID and Safe recovery path are verified;
- weakening RLS, write guards, moderation audit records, or multisig requirements;
- treating a grant application, expected reward, or uncommitted funding as available money.

Before any paid commitment, refresh the exact purchase, renewal, gas, audit, legal, and operating quotes. Roadmap estimates are not spending authorization.

## Resource-Gated Register

| ID | Required outcome | Canonical phase | Current state | Safe interim path | Activation/completion condition |
| --- | --- | --- | --- | --- | --- |
| RG-01 | Permanent DNS domain and redirect policy | C0 / C14 | The apex and permanent `www` redirect are live. Phase A accepted desktop/iPhone wallet sessions and provider returns. [Device and OAuth evidence](testnet/RG01_APEX_ORIGIN_ACCEPTANCE_2026-09-04.md) and [Phase A exit](testnet/CONTROLLED_BETA_ENTRY.md). | Keep the existing bounded rollback origin until a reviewed change retires it. | Testnet apex acceptance is complete. Recheck production domain and origin bindings for the final release. |
| RG-02 | Project email for general, security, and copyright operations | C14 | The founder confirmed project-mail receipt for the actual complaint flow. Mainnet operations still need an owner, reply coverage and a retention procedure. [Mail acceptance](audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md) and [contact scope](testnet/CONTROLLED_BETA_ENTRY.md). | Use the existing project mailbox and monitoring channels. | Verify the operating procedure for all three contact purposes before mainnet. |
| RG-03 | Production activation of A8a moderation step-up | A8 | Testnet moderation on the apex passed the October 8 paired-wallet authority policy, passkey sign-in, replacement and queue acceptance. [October 15 acceptance](audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md). | Retain the working testnet setup. Keep final contract custody and role assignment in C0/C8/C13. | Phase A access acceptance is complete. Final Safe assignments and handover require separate evidence. |
| RG-04 | Moderator onboarding and device step-up | A8 / C8 | Phase A tested role-checked staff access and a native passkey under the paired-wallet policy. The approved verified session has a fixed 24-hour maximum. Enrollment permission lasts 15 minutes. [Approved policy](canon/07_ADMIN_MODERATION_CANON.md#october-11-verified-session-duration-amendment). | Keep individual enrollment, revocation and role records private. | Onboard each future moderator with their own role, factor and audit record. C8 covers the final deployment. |
| RG-05 | Base Sepolia Admin/Security Safe rehearsal | C0 / C13 | Threshold and signer-loss gates satisfied on 2026-08-16 and independently verified on chain 2026-08-19. A 2-of-3 Safe v1.4.1 with three independently held signers executed all three signer pairs, including the pair that excludes the founder, and a `swapOwner` replacement removed an owner **without that owner's signature**, after which the original composition was restored. Live reads confirm 3 owners, threshold 2, nonce 5. Grant and revoke runbooks are not exercised. Evidence: [`testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md`](testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md) | Continue non-critical testnet engineering without claiming final admin topology; the rehearsal Safe carries no protocol role and is not a mainnet Safe candidate | Pass role grant and revoke runbooks on Base Sepolia once the A8 role data model is migrated. Signer addresses and role assignments stay out of public source per RG-04 |
| RG-06 | Mainnet Safes and separated operational keys | C0 / D3 | All three Base mainnet Safes were created and the two retired signers were removed from each on November 19. Each account has the same intended owners and requires two of three signatures. | Recheck before binding the new Core and verify its three getters after deployment. | Private backup recovery, role handover and release authorization remain open. Fund the deployer and any keeper only as needed. |
| RG-07 | Independent contract security review | C12 | Resource-gated and mandatory | Complete architecture, threat model, invariants, storage-layout review, and internal tests before requesting quotes | Review is funded and completed; every launch-blocking finding is resolved and re-verified |
| RG-08 | Final contract rehearsal and Base mainnet deployment gas | C13 / D3 | Deferred until final contracts and review are ready | Use Base Sepolia faucets and rehearsal deployments | A signed launch budget covers rehearsal, deployment, role handover, verification, smoke tests, and contingency; audited artifacts are the only deployable artifacts |
| RG-09 | Legal and privacy readiness | C14 | Resource-gated; exact entity and jurisdiction remain undecided | Keep the public testnet controlled and avoid claiming mainnet legal readiness | Founder/counsel approve the entity path, Terms, Privacy/GDPR, IP assignment, moderation contacts, and operating obligations |
| RG-10 | Sustainable production operations | C14 / D3 | Not yet funded as a mainnet service envelope | Continue measuring the existing testnet infrastructure and minimizing usage safely | A reviewed budget covers domain renewal, database/storage, indexer hosting, RPC fallback, monitoring, backups, incident response, and a defined operating runway |
| RG-11 | Project Basename or other optional brand protection | C0 | Optional project custody of the existing name | Keep the current registration while assessing a dedicated project identity. | Verify the recipient's ability to manage the name and check its address records before any separately approved transfer. [Basename transfer guide](https://docs.cdp.coinbase.com/coinbase-wallet/basenames/basename-transfer) |

## A8a Decisions Preserved

**2026-10-03 scheduling update:** the founder authorizes real passkey setup and
the associated operator recovery ceremony now, superseding the September 29
deferral. RG-03 retains its activation criteria; authorization to prepare is not
a passed ceremony or authorization bypass. See
[`the amendment`](canon/CHANGELOG_2026-10-03_PHASE_A_ACTIVATION.md).

**2026-10-08 policy supersession for RG-03/RG-04:** canon 07 now requires the
current two designated wallets together for application role/setup/recovery
approval, using gasless signatures. A staff member chooses one passkey or
authenticator app within the shared 15-minute permission. Recovery repeats the
two-wallet approval and invalidates earlier sign-in access. This replaces the
older independent two-passkey/bootstrap/Safe-only criteria in the July
decisions below; it does not alter contract custody or accept a software fixture as
a real ceremony. A8e/A8f/A8g, initial policy, native/app setup and the complete
report/review/notification flow remain activation gates. The project complaint
mail worker and actual inbox transport were verified October 8; that alone is
not RG-03 acceptance. Follow the current paired-authority procedure in
`security/MIGRATION_RUNBOOK.md` and `audits/STABILIZATION_CHECKPOINT.md`.

**2026-10-11 evidence update:** RG-03 / A-39 access acceptance is recorded under
the replacement policy: real paired setup, reset/replacement, native passkey
entry, expiry/reverification and protected queue, with real guest/nonstaff
denials. Report, decision, mail and recipient notification journeys passed;
Donate's existing-message hide/restore path also passed and is enabled. See
[audited results and remaining A8 edges](audits/PHASE_A_MODERATION_ACCEPTANCE_2026-10-11.md).
This acceptance supersedes the former disabled/unenrolled state. The separate
device/OAuth and A10 decision records are linked in the register.

**2026-10-11 founder scope and session amendment:** Android portions of Phase A
device acceptance are **OWNER-WAIVED / NOT TESTED** and no longer block that
close-out; no Android PASS or compatibility claim is recorded. Desktop, iOS and
OAuth evidence remain separate. For RG-04, the verified moderation session now
has an approved fixed maximum of 24 hours, with factor verification required
again in another browser/device or after a trusted client-IP change. This
supersedes the historical 15-minute verified session in the July
decisions below, not the unchanged 15-minute factor setup permission. Both-wallet
authority, setup/recovery, role checks and contract custody remain unchanged.
See [canon 07](canon/07_ADMIN_MODERATION_CANON.md#october-11-verified-session-duration-amendment).
This records the policy change; deployment and real-context acceptance require
their own evidence.

The founder approved the following implementation constraints on 2026-07-20:

- moderation step-up sessions last 15 minutes;
- the founder enrols two independent passkeys;
- initial authority uses one one-time, auditable bootstrap grant;
- founder recovery is authorized only through the configured Safe path;
- A8a is developed behind a disabled feature flag until the final production domain is connected.

These constraints harden access to moderation. They do not make X or Discord handles authentication factors, do not grant irreversible authority to an individual moderator, and do not replace multisig approval for critical actions.

## Checking the three contract custody roles

### Creating the accounts for the first time

1. Prepare the owner wallets and verify their independent recovery arrangements. For a 2-of-3 policy, any two owners can authorize a transaction or replace the third. Three addresses derived from one recovery phrase share a single point of loss. Record the selected owners and threshold privately before creation.
2. In the official Safe app, select Base mainnet (8453) for real custody or Base Sepolia (84532) for a rehearsal. Create a separate account for each purpose: ArtSoul Protocol Treasury, ArtSoul Ecosystem Treasury, and ArtSoul Admin Security. Each account has its own address. The same owner set can serve several accounts if explicitly chosen. Compromise of that quorum then affects all of them. [Safe account creation](https://help.safe.global/articles/7267202833-creating-a-safe-on-a-web-browser)
3. Read the owner addresses, threshold and network back from the creation screen before signing. A mainnet deployment can charge network gas. Record and verify each deployed Safe address before assigning it a contract role or sending funds. [Safe transaction fees](https://help.safe.global/articles/1896549699-transaction-fees)

Each row below is one separate smart account. Use the three approved signer wallets and a threshold of two for each account in this setup.

| Safe account name | Purpose in the new ordinary-artwork contracts |
| --- | --- |
| ArtSoul Protocol Treasury | Receives the protocol share of primary sales, secondary sales and defaulted winning deposits. |
| ArtSoul Ecosystem Treasury | Receives the 1% ecosystem allocation from secondary sales. |
| ArtSoul Admin Security | Controls the entry pause and external marketplace admission for the new ordinary pair. It can schedule an operator with 48 hours of notice, cancel a pending admission or immediately disable an active operator. Existing settlement and withdrawal paths remain available. |

Repeat **Create new account** for each remaining row. Select **Base** (chain ID 8453), enter the row's name, replace the prefilled signer if it is only the deployment gas payer, and add the other intended owners. On **Review**, check the three full signer addresses, **2 out of 3**, and the network. Choose **Pay now** for an on-chain deployment. Sponsorship, when displayed, applies to that creation. Otherwise the connected payer reviews the quoted gas. The signers can approve subsequent Safe operations off-chain without pre-funding each address. Save the distinct Safe address and successful creation receipt for each row in the private register. [Safe setup](https://help.safe.global/articles/7267202833-creating-a-safe-on-a-web-browser) and [fees](https://help.safe.global/articles/1896549699-transaction-fees).

### Signing devices and the completed recovery rehearsal

Three software keys that can sign in one unlocked browser share that computer as a point of failure. A paper recovery copy helps restore a key. Removing an address in the wallet changes local access. The Safe's on-chain owner list changes only through an executed Safe transaction. [Rabby key storage](https://github.com/RabbyHub/Rabby#backgroundjs) and [Safe owner replacement](https://docs.safe.global/reference-smart-account/owners/swapOwner).

The August 16 [Base Sepolia rehearsal](testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md#2-executed-transaction-ledger) already exercised all three signer pairs, replacement by the two remaining signers and restoration of the original owners. This satisfies the signer-loss rehearsal. The keeper uses a dedicated gas account. Its setup involves no Safe owner changes.

For a desktop, phone and hardware signing setup, retain one desktop owner. Create a fresh wallet on the phone. Use a key generated on the hardware wallet whose recovery words have always stayed offline. An existing independently secured hardware wallet can provide a signing address without a reset. Verify its full address on the device, then pair it with Rabby through **Hardware Wallet**. Each signer needs independently recoverable backup material. Importing an old desktop phrase onto another device preserves the original exposure. [Trezor and Rabby setup](https://trezor.io/guides/third-party-wallet-apps/ethereum-evm-apps/connect-rabby-wallet-to-your-trezor).

The founder completed the November 19 signer rotation on all three Base mainnet accounts. Fourteen executed transactions were checked against receipts from two RPC providers. The final owner sets match the three intended addresses, with two required confirmations on each account. The last Protocol Treasury and Admin Security transactions include signatures from all three current addresses across the two transactions. Device and backup custody remain the operator's responsibility.

For a future rotation that preserves the Safe addresses and two-confirmation thresholds, use the following procedure.

1. Identify the desktop signer to retain. Confirm each full new address on its own device and verify that the signer is usable. One option before changing owners is a unique plain-text message naming ArtSoul and a fresh nonce. Recover the address offline using EIP-191 message verification. The message should describe only this device check. Keep the proof private. [Message verification](https://docs.ethers.org/v6/api/hashing/#verifyMessage).
2. In each Safe on Base mainnet, use **Replace owner** to exchange the same retiring desktop signer for the phone signer. Review the Safe address, the full old and new addresses and the two required confirmations before approval. Each replacement takes effect when the authorized Safe transaction executes. [Safe owner replacement](https://docs.safe.global/reference-smart-account/owners/swapOwner).
3. After each execution, put the expected new owner set for just that Safe into a private working copy of the register. Run the [existing verification](#verifying-a-deployed-account) with both RPC endpoints. Confirm that the reported finalized block includes the execution and all three Safes match their expected owners and thresholds. Retain the receipt and verified register before proceeding. An unexecuted proposal will still show the previous owners.
4. After the phone signer is installed in all three Safes, use it and the retained desktop signer to approve the second replacement in each Safe, exchanging the other retiring signer for the hardware signer. Repeat the readback after every execution. The six replacements end with the same three independently held owners on each Safe. Check other accounts and recovery backups before removing obsolete software-wallet entries. [Safe signer guidance](https://help.safe.global/articles/1038062742-what-safe-setup-should-i-use).

### Developing and signing the new contracts

Run `npm.cmd run test:contracts:new` in PowerShell from the project root. This uses a local Hardhat chain, disposable test signers and a configuration that does not load a wallet environment file. It exercises the new ordinary-artwork pair, resale and treasury bindings.

For a future public deployment, prepare the reviewed contract creation bytecode, constructor arguments in role order, target chain, value and expected addresses as an unsigned transaction. Rehearse the exact release on Base Sepolia before the mainnet decision. An external deployment wallet signs the reviewed transaction; the three Safe addresses are public constructor inputs. Their signers approve only actions belonging to their Safe. Keep recovery phrases and private keys inside their signing devices. Masked PowerShell input still gives the receiving process access to the secret. The concrete [OrdinaryMarket](../contracts/replacement/OrdinaryMarket.sol) binds the three two-of-three Safes at creation. Its last two constructor arguments fix the independently reviewed refund batch limit and per-transfer gas for that deployment. The launch review must select and benchmark both values for the target network.

One gas payer can deploy the ordinary artwork pair. The [Core constructor](../contracts/replacement/OrdinaryArtAuctions.sol) creates its own NFT, and the [NFT](../contracts/replacement/SettledArtworkNFT.sol) fixes that Core as its mint authority. The [treasury binding](../contracts/replacement/TreasuryBoundOrdinaryArt.sol) assigns the entry pause and external marketplace admission to the security Safe. An uncompromised, retired software signer can sign this deployment after removal from all three owner lists. If it shares recovery material with a current owner, prefer a fresh deployment wallet with its own key. Fund the payer for the reviewed fee and verify the published bytecode, paired addresses and treasury assignments before use.

A second independently seeded, retired address can stay in reserve. Compromise of the gas payer gives access to its own assets and can invalidate a pending deployment plan by consuming its nonce. Before making a deployment official, compare the actual code and role bindings with the reviewed release. A defect shared by several deployments or a permission shared by several contracts can affect each of them even when different wallets paid for deployment. The [cross-deployment test](../test/TreasuryBoundOrdinaryArt.test.cjs) checks separate NFT ownership, pause permissions and treasury credits when the same wallet creates two pairs.

### Preparing the unsigned ordinary deployment

Run the [offline preparation command](../scripts/prepare-ordinary-deployment.mjs) against the final Hardhat artifact, the independent release review and the private custody register for that network.

```sh
node scripts/prepare-ordinary-deployment.mjs <core-artifact.json> <review.json> <custody.json>
```

The review records numeric `chainId`, checksummed `payer`, integer `nonce`, the fully qualified `contract` (`sourceName:contractName`), ABI-ordered `constructorArgs`, `initCodeHash`, `expectedCore` and `expectedNFT`. In the argument list use the literal strings `$protocolTreasury`, `$ecosystemTreasury` and `$adminSecurity` to resolve the three public addresses from the custody register. Put every additional reviewed constructor value in its ABI position. Encode large integers as decimal strings.

Obtain `initCodeHash` from an independent review of the complete creation bytecode **with ABI-encoded arguments**. The command compares that Keccak-256 digest, verifies the two expected CREATE addresses and prints the zero-value request. A direct creation uses the payer's transaction nonce. The paired NFT is the Core constructor's first creation at nonce one. The review file is the trust anchor and stays separate from the candidate artifact. [CREATE address calculation](https://docs.ethers.org/v6/api/address/#getCreateAddress)

The command checks the linked Core runtime against the 24,576-byte limit and the complete creation request against the 49,152-byte limit, including constructor arguments. Rehearse the final artifact so the nested NFT creation is covered too. [Contract code size](https://eips.ethereum.org/EIPS/eip-170) · [Initcode size](https://eips.ethereum.org/EIPS/eip-3860)

Before signing in the external wallet, repeat the finalized Safe preflight, check the payer's current pending nonce, network, fee quote and the exact creation data. A changed nonce needs a fresh address calculation and review. The offline command reads local JSON and never requests a key or submits a transaction.

### Verifying a deployed account

RG-06 requires private assignments for the protocol treasury, ecosystem treasury and admin/security authority on the target chain. On November 19 two public Base Sepolia RPC providers returned three owners, threshold two, nonce five and Safe version 1.4.1 for the existing RG-05 rehearsal wallet at block 60,885,416 (`0xe5b7871d6127b396eca72fa0266112d9bb8a3dc69c8a96368939f234b21e24e7`). Its testnet purpose is recorded in the [rehearsal ledger](testnet/RG05_SAFE_MULTISIG_REHEARSAL_2026-08-16.md). This read covered the account configuration only.

Use the [read-only preflight](../scripts/verify-treasury-safes.mjs) before binding the three addresses and again after deployment. Keep the JSON register outside the repository. Use the addresses and owner approvals recorded by the intended custodians. Derive proxy and singleton **deployed runtime** Keccak-256 hashes from the independently reviewed release artifacts. Compare the singleton address with the listed deployment on the selected chain. A hash copied from the candidate account itself cannot establish its identity. [Safe deployment registry](https://github.com/safe-global/safe-deployments) and [Safe contract releases](https://github.com/safe-global/safe-smart-account/releases).

| JSON field | Required value |
| --- | --- |
| `chainId` | Numeric `84532` for rehearsal or `8453` for Base mainnet |
| `protocolTreasury`, `ecosystemTreasury`, `adminSecurity` | Three separate objects with the fields below, one per role |
| Per-role `address`, `owners`, `threshold` | Safe proxy address, array of its intended owner addresses and the approved signature count |
| Per-role `proxyCodeHash`, `singleton`, `singletonCodeHash` | Reviewed proxy runtime hash, implementation address and reviewed implementation runtime hash |
| Per-role `modules`, `guard`, `moduleGuard`, `fallbackHandler` | Approved module address array and the three expected addresses. Use an empty array or the zero address for an absent component. Review the authority of each enabled extension |
| Optional `core` | After deployment, supply an object with the Core `address` and reviewed deployed runtime `codeHash` including its immutable values. The script then checks each on-chain getter against its assigned Safe |
| `nft` for an ordinary pair | Supply the paired NFT `address` and its independently reviewed deployed runtime `codeHash`, including the immutable Core address. Record both contracts in the same register. The verifier checks both hashes, the three Safe bindings, `Core.nft()` and `NFT.core()` |

Provide `ARTSOUL_CUSTODY_RPC_URL` privately. Set `ARTSOUL_CUSTODY_RPC_CHECK_URL` to a separate provider. With two providers the command selects the highest block both have finalized, checks their hashes and reads each role independently on both. A newly created Safe can appear in a receipt before that common block reaches its creation height. If the command reports no code, compare those heights before repeating the read. Its report contains the block hash, owner count, threshold per role, provider count and whether it checked the deployed Core bindings.

```sh
node scripts/verify-treasury-safes.mjs /private/path/to/approved-custody.json
```

For a deployed ordinary pair, collect the release evidence with the command below. In the register's `core` entry, put the independently reviewed fourth and fifth constructor values in `refundBatchLimit` and `refundTransferGas`, respectively. The first is a count of refunds per call and the second is gas per transfer. Use exact positive decimal strings for values above JavaScript's safe integer range. Copy the values from the deployment review before checking the chain.

The release check requires two independent RPC endpoints. Both must confirm the same finalized block, the three two-of-three Safes, both directions of the Core/NFT binding and both refund settings. Archive `refundLimits`, `nftPairChecked: true` and `rpcReadings: 2` with the reviewed build and register. Existing custody-only registers remain usable for routine checks. The independent contract review and public rehearsal retain separate acceptance.

```sh
node scripts/verify-treasury-safes.mjs /private/path/to/approved-custody.json --require-pair
```

File the result with the private handover journal. Owner addresses and thresholds establish on-chain configuration. Independent human custody and the ability to recover a lost signer require separate ceremony evidence. Recheck after owner, threshold, extension or implementation changes. [Safe owner read](https://docs.safe.global/reference-smart-account/owners/getOwners), [threshold read](https://docs.safe.global/reference-smart-account/owners/getThreshold) and [enabled modules](https://docs.safe.global/reference-smart-account/modules/getModulesPaginated).

## Funding Evidence Rule

Funding is available only when it is received and usable, not when an application is submitted. Grants, rewards, sponsorships, credits, revenue, and explicit founder allocations may unlock rows above, but each unlocked row still requires its technical and security acceptance evidence.

The [`BASE_ECOSYSTEM_FUND_READINESS.md`](BASE_ECOSYSTEM_FUND_READINESS.md) plan records one potential founder-owned investment path. Its current status is `researched`, not submitted or funded. Preparation must not displace Phase A work, alter protocol scope, or represent testnet activity as mainnet traction.

Phase A engineering is complete. Since November 18, local Phase C engineering
continues under the existing resource limits. Cohort recruitment and coverage
are scheduled with the final-contract testnet rehearsal in C13. See the
[phase handoff](PHASE_B_STATUS_2026-11-02.md).
