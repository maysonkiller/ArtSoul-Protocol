const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');
let provider, signers, creator, treasury, start;
const ZERO = ethers.ZeroHash;
const eth = ethers.parseEther;
async function tx(promise) { return (await promise).wait(); }
async function deploy(name, args = [], signer = creator) {
  const artifact = await artifacts.readArtifact(name);
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function time(timestamp) {
  await network.provider.send('evm_setNextBlockTimestamp', [timestamp]);
  await network.provider.send('evm_mine');
}
async function fail(promise, name) {
  await assert.rejects(async () => { const result = await promise; if (result?.wait) await result.wait(); }, error => {
    if (!name) return true;
    const encoded = ethers.id(`${name}()`).slice(0, 10);
    return String(error).includes(name) || JSON.stringify(error, (_, value) => typeof value === 'bigint' ? String(value) : value).includes(encoded);
  });
}
function phase(overrides = {}) {
  return {kind: 0, start, end: start + 100, allocation: 10, walletLimit: 10, price: eth('0.01'), merkleRoot: ZERO,
    enabled: true, rollover: false, priceSource: 0, fallbackEnabled: false, fallbackPrice: 0, ...overrides};
}
async function launch(max = 30) {
  return deploy('CollectionLaunch', ['Fixture', 'FIX', 'ipfs://fixture/', max, await creator.getAddress(), await treasury.getAddress(), await creator.getAddress(), 550]);
}
async function configured(phases, max = 30) {
  const collection = await launch(max);
  for (const p of phases) await tx(collection.addPhase(p));
  await tx(collection.lockConfiguration());
  await time(start);
  return collection;
}
describe('Additive Collection Launch security and accounting', function () {
  this.timeout(90000);
  beforeEach(async () => {
    await network.provider.send('hardhat_reset');
    provider = new ethers.BrowserProvider(network.provider, undefined, {cacheTimeout: -1});
    provider.pollingInterval = 10;
    signers = await Promise.all((await provider.send('eth_accounts', [])).map(a => provider.getSigner(a)));
    [creator, treasury] = signers;
    start = Number((await network.provider.send('eth_getBlockByNumber', ['latest', false])).timestamp) + 100;
  });

  it('locks terms before funding and enforces access, allocation and chronological phases', async () => {
    const c = await launch(10);
    await fail(c.connect(signers[2]).addPhase(phase()));
    await fail(c.addPhase(phase({allocation: 11})), 'InvalidConfiguration');
    await tx(c.addPhase(phase({allocation: 5})));
    await fail(c.addPhase(phase({allocation: 5, start: start + 90})), 'InvalidConfiguration');
    await fail(c.mintPhase(0, 1, 0, [], await creator.getAddress(), {value: eth('0.01')}), 'NotLocked');
    await tx(c.lockConfiguration());
    await fail(c.addPhase(phase()), 'Locked');
    await fail(c.lockConfiguration(), 'Locked');
    await fail(c.connect(signers[2]).pause());
  });

  it('preserves primary 97.5/2.5, exact payment, wallet limit and lifetime cap', async () => {
    const c = await configured([phase({allocation: 2, walletLimit: 1})], 2);
    const buyer = signers[2], recipient = await buyer.getAddress();
    await fail(c.connect(buyer).mintPhase(0, 1, 0, [], recipient, {value: 1}), 'IncorrectPayment');
    await tx(c.connect(buyer).mintPhase(0, 1, 0, [], recipient, {value: eth('0.01')}));
    assert.equal(await c.ownerOf(1), recipient);
    assert.equal(await c.firstCollector(1), recipient);
    assert.equal(await c.credits(await treasury.getAddress()), eth('0.00025'));
    assert.equal(await c.credits(await creator.getAddress()), eth('0.00975'));
    await fail(c.connect(buyer).mintPhase(0, 1, 0, [], recipient, {value: eth('0.01')}), 'WalletLimitExceeded');
    await tx(c.connect(signers[3]).mintPhase(0, 1, 0, [], await signers[3].getAddress(), {value: eth('0.01')}));
    await fail(c.connect(signers[4]).mintPhase(0, 1, 0, [], recipient, {value: eth('0.01')}), 'SupplyExceeded');
    const royalty = await c.royaltyInfo(1, eth('1'));
    assert.equal(royalty[1], eth('0.055'));
  });

  it('rejects early, expired, disabled and paused phase entry; close remains permissionless', async () => {
    const c = await launch();
    await tx(c.addPhase(phase({enabled: false})));
    await tx(c.lockConfiguration());
    await fail(c.mintPhase(0, 1, 0, [], await creator.getAddress()), 'PhaseUnavailable');
    await time(start);
    await fail(c.mintPhase(0, 1, 0, [], await creator.getAddress()), 'PhaseUnavailable');
    await tx(c.pause());
    await time(start + 100);
    await tx(c.connect(signers[2]).closePhase(0));
    await fail(c.closePhase(0), 'PhaseUnavailable');
    assert.equal((await c.phase(0))[1].closed, true);
  });

  it('binds allowlist proofs to claimant, allowance, collection, chain and phase', async () => {
    const c = await launch();
    const buyer = signers[2], recipient = await buyer.getAddress();
    const leaf = await c.allowlistLeaf(0, recipient, 1);
    const otherPhaseLeaf = await c.allowlistLeaf(1, recipient, 1);
    assert.notEqual(leaf, otherPhaseLeaf);
    const other = await launch();
    assert.notEqual(leaf, await other.allowlistLeaf(0, recipient, 1));
    await tx(c.addPhase(phase({kind: 1, price: 0, merkleRoot: leaf, walletLimit: 1})));
    await tx(c.lockConfiguration()); await time(start);
    await fail(c.connect(signers[3]).mintPhase(0, 1, 1, [], recipient), 'InvalidProof');
    await fail(c.connect(buyer).mintPhase(0, 1, 2, [], recipient), 'InvalidProof');
    await tx(c.connect(buyer).mintPhase(0, 1, 1, [], recipient));
    await fail(c.connect(buyer).mintPhase(0, 1, 1, [], recipient), 'WalletLimitExceeded');
    await time(start + 100);
    await fail(c.connect(signers[3]).mintPhase(0, 1, 1, [], recipient), 'PhaseUnavailable');
  });

  for (const count of [0, 1, 3, 8]) it(`conserves every wei for ${count} bids against three units`, async () => {
    const c = await configured([phase({kind: 2, allocation: 3, walletLimit: 1, price: eth('0.01')})]);
    const amounts = ['0.03', '0.04', '0.02', '0.04', '0.01', '0.08', '0.07', '0.08'].slice(0, count).map(eth);
    let escrow = 0n;
    for (let i = 0; i < count; i++) { await tx(c.connect(signers[i + 2]).bid(0, {value: amounts[i]})); escrow += amounts[i]; }
    await time(start + 100);
    await tx(c.connect(signers[15]).finalizeAuction(0));
    const ranked = amounts.map((amount, index) => ({amount, index})).sort((a, b) => a.amount === b.amount ? a.index - b.index : a.amount > b.amount ? -1 : 1);
    const winning = ranked.slice(0, 3);
    const clearing = count === 0 ? 0n : count < 3 ? eth('0.01') : winning[2].amount;
    const state = (await c.phase(0))[1];
    assert.equal(state.clearingPrice, clearing);
    assert.equal(state.consumed, BigInt(winning.length));
    assert.equal(state.subscribed, count >= 3);
    for (let i = 0; i < count; i++) {
      const bidder = signers[i + 2], address = await bidder.getAddress();
      const wins = winning.some(b => b.index === i);
      assert.equal((await c.bids(0, address)).winner, wins);
      if (wins) {
        await tx(c.connect(bidder).claimAuctionRefund(0));
        const before = await c.credits(address);
        await tx(c.connect(bidder).claimAuctionRefund(0));
        assert.equal(await c.credits(address), before, 'refund cannot duplicate');
        await tx(c.connect(bidder).claimAuction(0, address));
        await fail(c.connect(bidder).claimAuction(0, address), 'AlreadyClaimed');
      } else await fail(c.connect(bidder).claimAuction(0, address), 'NotWinner');
      assert.equal(await c.credits(address), amounts[i] - (wins ? clearing : 0n));
    }
    let liabilities = 0n;
    for (const s of signers.slice(0, count + 2)) liabilities += await c.credits(await s.getAddress());
    assert.equal(liabilities, escrow);
    assert.equal(await provider.getBalance(await c.getAddress()), escrow);
    for (const s of signers.slice(0, count + 2)) {
      if (await c.credits(await s.getAddress())) await tx(c.connect(s).withdrawTo(await s.getAddress()));
    }
    assert.equal(await provider.getBalance(await c.getAddress()), 0n);
    await fail(c.finalizeAuction(0), 'PhaseUnavailable');
  });

  it('rejects duplicate/underfunded/last-block bids and preserves first equal-price bids', async () => {
    const c = await configured([phase({kind: 2, allocation: 1, walletLimit: 1})]);
    await fail(c.connect(signers[2]).bid(0, {value: 1}), 'IncorrectPayment');
    await tx(c.connect(signers[2]).bid(0, {value: eth('0.01')}));
    await fail(c.connect(signers[2]).bid(0, {value: eth('0.02')}), 'AlreadyParticipated');
    await tx(c.connect(signers[3]).bid(0, {value: eth('0.01')}));
    assert.equal((await c.bids(0, await signers[2].getAddress())).winner, true);
    assert.equal(await c.credits(await signers[3].getAddress()), eth('0.01'));
    await time(start + 100);
    await fail(c.connect(signers[4]).bid(0, {value: eth('0.03')}), 'PhaseUnavailable');
  });

  it('allows settlement, claims and withdrawals during pause without accepting new funds', async () => {
    const c = await configured([phase({kind: 2, allocation: 2, walletLimit: 1})]);
    const buyer = signers[2], addr = await buyer.getAddress();
    await tx(c.connect(buyer).bid(0, {value: eth('0.03')}));
    await tx(c.pause());
    await fail(c.connect(signers[3]).bid(0, {value: eth('0.02')}));
    await time(start + 100); await tx(c.finalizeAuction(0));
    await tx(c.connect(buyer).claimAuction(0, addr));
    assert.equal(await c.credits(addr), eth('0.02'));
    await tx(c.connect(buyer).withdrawTo(addr));
    assert.equal(await c.ownerOf(1), addr);
  });

  it('recovers from rejecting payees and blocks withdrawal reentrancy and NFT receiver failures', async () => {
    const c = await configured([phase({kind: 2, allocation: 2, walletLimit: 1})]);
    const attacker = await deploy('LaunchAdversary', [await c.getAddress()]);
    await tx(attacker.bid(0, {value: eth('0.03')}));
    await time(start + 100); await tx(c.finalizeAuction(0));
    await fail(attacker.claim(0, await attacker.getAddress()));
    assert.equal((await c.bids(0, await attacker.getAddress())).claimed, false);
    await tx(attacker.claim(0, await signers[4].getAddress()));
    await fail(attacker.withdraw(await attacker.getAddress(), false));
    assert.equal(await c.credits(await attacker.getAddress()), eth('0.02'));
    await tx(attacker.withdraw(await attacker.getAddress(), true));
    assert.equal(await attacker.reentrySucceeded(), false);
    assert.equal(await c.credits(await attacker.getAddress()), 0n);
  });

  it('rolls unused supply exactly once while reserving unclaimed auction winners', async () => {
    const c = await configured([
      phase({kind: 2, allocation: 2, walletLimit: 1, rollover: true}),
      phase({start: start + 100, end: start + 200, allocation: 3, walletLimit: 10, price: 0})
    ], 5);
    await tx(c.connect(signers[2]).bid(0, {value: eth('0.01')}));
    await time(start + 100);
    await fail(c.mintPhase(1, 1, 0, [], await creator.getAddress()), 'PreviousPhaseOpen');
    await tx(c.finalizeAuction(0));
    assert.equal((await c.phase(1))[1].capacity, 4n);
    await tx(c.mintPhase(1, 4, 0, [], await creator.getAddress()));
    await tx(c.connect(signers[2]).claimAuction(0, await signers[2].getAddress()));
    assert.equal(await c.totalMinted(), 5n);
  });

  it('locks Auction B price linkage and upfront fallback; no price from an empty round', async () => {
    const c = await configured([
      phase({kind: 2, allocation: 2, walletLimit: 1}),
      phase({start: start + 100, end: start + 200, allocation: 3, price: 0, priceSource: 1})
    ]);
    await time(start + 100); await tx(c.finalizeAuction(0));
    await fail(c.mintPrice(1), 'PriceUnavailable');
    await fail(c.mintPhase(1, 1, 0, [], await creator.getAddress()), 'PriceUnavailable');
  });

  it('crafts ten owned tokens atomically, rejects duplicates, and emits permanent ancestry', async () => {
    const c = await launch(20);
    const f = await deploy('CollectionForge', ['Forged', 'FORGE', 'ipfs://forged/', await c.getAddress(), 10, 2, ethers.id('recipe-10'), await creator.getAddress(), await creator.getAddress(), 550]);
    await tx(c.setForge(await f.getAddress()));
    await tx(c.addPhase(phase({allocation: 20, walletLimit: 20, price: 0})));
    await tx(c.lockConfiguration()); await time(start);
    const buyer = signers[2], addr = await buyer.getAddress();
    await tx(c.connect(buyer).mintPhase(0, 20, 0, [], addr));
    const ids = Array.from({length: 10}, (_, i) => i + 1);
    await fail(f.connect(buyer).craft(ids, addr), 'UnauthorizedForge');
    await tx(c.connect(buyer).setApprovalForAll(await f.getAddress(), true));
    await fail(f.connect(buyer).craft(ids.slice(1), addr), 'InvalidIngredients');
    await fail(f.connect(buyer).craft([1, 1, ...ids.slice(2)], addr), 'InvalidIngredients');
    await fail(f.connect(signers[3]).craft(ids, addr), 'NotIngredientOwner');
    const rejecting = await deploy('LaunchAdversary', [await c.getAddress()]);
    await fail(f.connect(buyer).craft(ids, await rejecting.getAddress()));
    assert.equal(await c.ownerOf(1), addr, 'failed output receiver rolls back burns');
    assert.equal(await f.totalMinted(), 0n);
    const receipt = await tx(f.connect(buyer).craft(ids, addr));
    const event = receipt.logs.map(log => { try {return f.interface.parseLog(log);} catch {return null;} }).find(e => e?.name === 'OriginCrafted');
    assert.deepEqual([...event.args.consumedTokenIds], ids.map(BigInt));
    assert.equal(await c.totalSupply(), 10n); assert.equal(await c.totalMinted(), 20n);
    assert.equal(await f.ownerOf(1), addr); assert.equal(await f.forgedBy(1), addr);
    await fail(f.connect(buyer).craft(ids, addr));
    await tx(f.connect(buyer).transferFrom(addr, await signers[3].getAddress(), 1));
    assert.equal(await f.ownerOf(1), await signers[3].getAddress());
    await tx(f.connect(buyer).craft(ids.map(id => id + 10), addr));
    await fail(f.connect(buyer).craft(ids, addr), 'SupplyExceeded');
    await fail(c.connect(buyer).mintPhase(0, 1, 0, [], addr), 'WalletLimitExceeded');
  });
});
