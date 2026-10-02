const assert = require('node:assert/strict');
const { artifacts, network } = require('hardhat');
const { ethers } = require('ethers');

const AMOUNT = 17n;
let provider, signers, controller, artist, donor, treasury, admin, nft, core, donations;

async function tx(promise) { return (await promise).wait(); }
async function deploy(name, args = [], signer = controller) {
  const artifact = await artifacts.readArtifact(name);
  const contract = await new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function balance(address) {
  return BigInt(await network.provider.send('eth_getBalance', [address, 'latest']));
}
async function fail(promise, signature) {
  await assert.rejects(async () => {
    const result = await promise;
    if (result?.wait) await result.wait();
  }, error => {
    if (!signature) return true;
    const selector = ethers.id(signature).slice(0, 10);
    const text = JSON.stringify(error, (_, value) => typeof value === 'bigint' ? String(value) : value);
    assert.ok(text.includes(selector) || String(error).includes(signature.split('(')[0]),
      `Expected ${signature}; received ${String(error)}`);
    return true;
  });
}
async function adminCall(method, args = [], owner = admin) {
  return tx(owner.execute(await donations.getAddress(), donations.interface.encodeFunctionData(method, args)));
}
function events(receipt, contract, name) {
  return receipt.logs.filter(log => log.address.toLowerCase() === contract.target.toLowerCase())
    .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .filter(event => event?.name === name);
}
async function register(signer = artist) {
  await tx(core.connect(signer).registerArtwork('ipfs://donation-fixture'));
  return core.artworkCounter();
}
async function rawMessage(creator, artworkId, bytes, value = AMOUNT) {
  const selector = donations.interface.getFunction('donate').selector;
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes', 'bool'], [creator, artworkId, bytes, false]
  );
  return donor.sendTransaction({to: await donations.getAddress(), data: selector + encoded.slice(2), value});
}

describe('Creator support isolation and security', function () {
  this.timeout(90000);
  beforeEach(async () => {
    await network.provider.send('hardhat_reset');
    provider = new ethers.BrowserProvider(network.provider, undefined, {cacheTimeout: -1});
    provider.pollingInterval = 10;
    signers = await Promise.all((await provider.send('eth_accounts', [])).map(address => provider.getSigner(address)));
    [controller, artist, donor, treasury] = signers;
    admin = await deploy('DonationTestAdmin', [await controller.getAddress()]);
    nft = await deploy('ArtSoulNFT');
    const project = await deploy('ArtSoulProjectNFT');
    core = await deploy('ArtSoulCore', [await nft.getAddress(), await project.getAddress(), await treasury.getAddress()]);
    await tx(nft.setCore(await core.getAddress()));
    await tx(project.setCore(await core.getAddress()));
    donations = await deploy('ArtSoulDonations', [await core.getAddress(), await admin.getAddress()]);
  });

  it('requires an explicit contract resolver and contract administration without amount-policy parameters', async () => {
    const coreAddress = await core.getAddress(), adminAddress = await admin.getAddress();
    assert.equal(await donations.core(), coreAddress);
    assert.equal(await donations.owner(), adminAddress);
    assert.equal(donations.interface.deploy.inputs.length, 2);
    assert.equal(await donations.MAX_MESSAGE_BYTES(), 560n);
    assert.equal(await donations.paused(), false);
    for (const invalid of [ethers.ZeroAddress, await artist.getAddress()]) {
      await fail(deploy('ArtSoulDonations', [invalid, adminAddress]), 'InvalidCore()');
    }
    await fail(deploy('ArtSoulDonations', [coreAddress, await controller.getAddress()]), 'InvalidAdministrationOwner()');
    await fail(deploy('ArtSoulDonations', [coreAddress, ethers.ZeroAddress]), 'OwnableInvalidOwner(address)');
  });

  it('forwards every wei for pre-mint work and emits the real donor without altering Core or NFT', async () => {
    const artworkId = await register(), creator = await artist.getAddress();
    const beforeArtwork = await core.artworks(artworkId), beforeCreator = await balance(creator);
    const beforeCore = await balance(await core.getAddress()), beforeTreasury = await balance(await treasury.getAddress());
    const receipt = await tx(donations.connect(donor).donate(creator, artworkId, 'Thank you', true, {value: AMOUNT}));
    const donationEvents = events(receipt, donations, 'Donation');
    assert.equal(donationEvents.length, 1);
    assert.deepEqual(Array.from(donationEvents[0].args), [await donor.getAddress(), creator, artworkId, AMOUNT, 'Thank you', true]);
    assert.equal(await balance(creator) - beforeCreator, AMOUNT);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal(await balance(await core.getAddress()), beforeCore);
    assert.equal(await balance(await treasury.getAddress()), beforeTreasury);
    assert.deepEqual(Array.from(await core.artworks(artworkId)), Array.from(beforeArtwork));
    assert.equal(await core.successfulSettlements(), 0n);
    assert.equal(await core.pendingWithdrawals(creator), 0n);
    await fail(nft.ownerOf(1), 'ERC721NonexistentToken(uint256)');
  });

  it('routes minted work to its creator after NFT ownership changes and preserves floor and royalties', async () => {
    const artworkId = await register(), creator = await artist.getAddress();
    const bid = ethers.parseEther('0.02'), deposit = ethers.parseEther('0.01');
    await tx(core.connect(artist).createAuction(artworkId, bid, 86400));
    await tx(core.connect(donor).placeBid(1, bid, {value: deposit}));
    const auction = await core.auctions(1);
    await network.provider.send('evm_setNextBlockTimestamp', [Number(auction.endTime) + 1]);
    await network.provider.send('evm_mine');
    await tx(core.endAuction(1));
    await tx(core.connect(donor).settleAuction(1, {value: bid - deposit}));
    await tx(nft.connect(donor).transferFrom(await donor.getAddress(), await signers[4].getAddress(), 1));
    const artworkBefore = await core.artworks(artworkId);
    const auctionBefore = await core.auctions(1);
    const royaltyBefore = await nft.royaltyInfo(1, ethers.parseEther('1'));
    const artistCredit = await core.pendingWithdrawals(creator), beforeArtist = await balance(creator);
    const ownerAddress = await nft.ownerOf(1), beforeOwner = await balance(ownerAddress);
    const receipt = await tx(donations.connect(donor).donate(creator, artworkId, '', false, {value: 17}));
    assert.equal(events(receipt, donations, 'Donation').length, 1);
    assert.equal(await balance(creator) - beforeArtist, 17n);
    assert.equal(await balance(ownerAddress), beforeOwner);
    assert.equal(await nft.ownerOf(1), ownerAddress);
    assert.deepEqual(Array.from(await core.artworks(artworkId)), Array.from(artworkBefore));
    assert.deepEqual(Array.from(await core.auctions(1)), Array.from(auctionBefore));
    assert.deepEqual(Array.from(await nft.royaltyInfo(1, ethers.parseEther('1'))), Array.from(royaltyBefore));
    assert.equal(await core.pendingWithdrawals(creator), artistCredit);
    assert.equal(await core.successfulSettlements(), 1n);
    assert.equal(await balance(await donations.getAddress()), 0n);
  });

  it('rejects zero value, missing work and caller-supplied fake recipients without moving value', async () => {
    const artworkId = await register(), creator = await artist.getAddress();
    const fake = await signers[4].getAddress(), beforeCreator = await balance(creator), beforeFake = await balance(fake);
    await fail(donations.connect(donor).donate(creator, artworkId, '', false), 'ZeroDonation()');
    for (const id of [0, 999]) await fail(donations.connect(donor).donate(creator, id, '', false, {value: 1}), 'ArtworkNotFound()');
    for (const recipient of [ethers.ZeroAddress, fake, await treasury.getAddress()]) {
      await fail(donations.connect(donor).donate(recipient, artworkId, '', false, {value: 1}), 'CreatorMismatch()');
    }
    assert.equal(await balance(creator), beforeCreator);
    assert.equal(await balance(fake), beforeFake);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal((await donations.queryFilter(donations.filters.Donation())).length, 0);
  });

  it('forwards any nonzero amount in full with or without a message and without a message fee', async () => {
    const artworkId = await register(), creator = await artist.getAddress(), before = await balance(creator);
    const beforeTreasury = await balance(await treasury.getAddress());
    const cases = [['', 1n], [' ', 1n], ['Visible', 1n], ['Thank you', 17n], ['A larger gift', ethers.parseEther('0.001')]];
    let total = 0n;
    for (const [message, amount] of cases) {
      const receipt = await tx(donations.connect(donor).donate(creator, artworkId, message, false, {value: amount}));
      const emitted = events(receipt, donations, 'Donation');
      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].args.amount, amount);
      assert.equal(emitted[0].args.message, message);
      total += amount;
    }
    assert.equal(await balance(creator) - before, total);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal(await balance(await treasury.getAddress()), beforeTreasury);
    for (const message of ['', 'Visible']) {
      await fail(donations.connect(donor).donate(creator, artworkId, message, false, {value: 0}), 'ZeroDonation()');
    }
  });

  it('bounds bytes separately from display characters and accepts valid UTF8 at all scalar-width boundaries', async () => {
    const artworkId = await register(), creator = await artist.getAddress();
    const valid = ['a'.repeat(560), '🌍'.repeat(140), '\u0000\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}', 'e\u0301', '👩‍🎨'];
    for (const message of valid) {
      const receipt = await tx(donations.connect(donor).donate(creator, artworkId, message, false, {value: AMOUNT}));
      assert.equal(events(receipt, donations, 'Donation')[0].args.message, message);
    }
    // 560 ASCII scalars fit on-chain; the public projection must separately reject more than 140 graphemes.
    await fail(donations.connect(donor).donate(creator, artworkId, 'a'.repeat(561), false, {value: AMOUNT}), 'MessageTooLong()');
    await fail(donations.connect(donor).donate(creator, artworkId, '🌍'.repeat(141), false, {value: AMOUNT}), 'MessageTooLong()');
  });

  it('rejects malformed, overlong, surrogate and out-of-range UTF8 supplied directly through calldata', async () => {
    const artworkId = await register(), creator = await artist.getAddress(), before = await balance(creator);
    const malformed = ['80', 'bf', 'c0af', 'c180', 'c2', 'df', 'c220', 'e0a0', 'e08080', 'eda080', 'edbfbf',
      'e228a1', 'e2a128', 'f09080', 'f0808080', 'f4908080', 'f5808080', 'ff', 'fe', 'f0288cbc'];
    for (const hex of malformed) await fail(rawMessage(creator, artworkId, `0x${hex}`), 'InvalidMessageEncoding()');
    await fail(rawMessage(creator, artworkId, '0x' + '80'.repeat(561)), 'MessageTooLong()');
    assert.equal(await balance(creator), before);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal((await donations.queryFilter(donations.filters.Donation())).length, 0);
  });

  it('reverts the mined transaction and emits no donation when the creator rejects ETH', async () => {
    const recipient = await deploy('DonationAdversary');
    await tx(recipient.register(await core.getAddress()));
    await tx(recipient.configure(await donations.getAddress(), 1));
    await fail(donations.connect(donor).donate(await recipient.getAddress(), await recipient.artworkId(), 'Support', false,
      {value: AMOUNT, gasLimit: 500000}), 'TransferFailed()');
    assert.equal(await balance(await recipient.getAddress()), 0n);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal(await recipient.receives(), 0n);
    assert.equal((await donations.queryFilter(donations.filters.Donation())).length, 0);
  });

  it('blocks caught creator reentry while forwarding the full amount once with one event', async () => {
    const recipient = await deploy('DonationAdversary');
    await tx(recipient.register(await core.getAddress()));
    await tx(recipient.configure(await donations.getAddress(), 2));
    const receipt = await tx(donations.connect(donor).donate(await recipient.getAddress(), await recipient.artworkId(), '', false, {value: AMOUNT}));
    assert.equal(await recipient.reentryBlocked(), true);
    assert.equal(await recipient.reentryError(), ethers.id('ReentrancyGuardReentrantCall()').slice(0, 10));
    assert.equal(await recipient.receives(), 1n);
    assert.equal(await recipient.received(), AMOUNT);
    assert.equal(await balance(await recipient.getAddress()), AMOUNT);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal(events(receipt, donations, 'Donation').length, 1);
  });

  it('atomically rolls back when the creator requires reentry to succeed', async () => {
    const recipient = await deploy('DonationAdversary');
    await tx(recipient.register(await core.getAddress()));
    await tx(recipient.configure(await donations.getAddress(), 3));
    await fail(donations.connect(donor).donate(await recipient.getAddress(), await recipient.artworkId(), '', false,
      {value: AMOUNT, gasLimit: 500000}), 'TransferFailed()');
    assert.equal(await recipient.receives(), 0n);
    assert.equal(await recipient.received(), 0n);
    assert.equal(await balance(await recipient.getAddress()), 0n);
    assert.equal(await balance(await donations.getAddress()), 0n);
    assert.equal((await donations.queryFilter(donations.filters.Donation())).length, 0);
  });

  it('restricts pause authority to the configured contract owner and resumes any nonzero donation after pause', async () => {
    const artworkId = await register(), creator = await artist.getAddress();
    for (const account of [controller, artist, donor]) {
      await fail(donations.connect(account).pause(), 'OwnableUnauthorizedAccount(address)');
      await fail(donations.connect(account).unpause(), 'OwnableUnauthorizedAccount(address)');
    }
    await tx(donations.connect(donor).donate(creator, artworkId, 'Message', false, {value: 1}));
    await adminCall('pause');
    await fail(donations.connect(donor).donate(creator, artworkId, '', false, {value: 1}), 'EnforcedPause()');
    assert.equal(await donations.paused(), true);
    await adminCall('unpause');
    await tx(donations.connect(donor).donate(creator, artworkId, 'Message', false, {value: 1}));
    assert.equal(await donations.paused(), false);
  });

  it('preserves two-step administration, blocks EOA successors and permits cancellation without granting pending-owner authority', async () => {
    const nextAdmin = await deploy('DonationTestAdmin', [await signers[5].getAddress()]);
    await fail(adminCall('transferOwnership', [await controller.getAddress()]), 'InvalidAdministrationOwner()');
    await adminCall('transferOwnership', [await nextAdmin.getAddress()]);
    assert.equal(await donations.owner(), await admin.getAddress());
    assert.equal(await donations.pendingOwner(), await nextAdmin.getAddress());
    await fail(tx(nextAdmin.connect(signers[5]).execute(await donations.getAddress(), donations.interface.encodeFunctionData('pause'))),
      'OwnableUnauthorizedAccount(address)');
    await fail(donations.connect(donor).acceptOwnership(), 'OwnableUnauthorizedAccount(address)');
    await adminCall('transferOwnership', [ethers.ZeroAddress]);
    assert.equal(await donations.pendingOwner(), ethers.ZeroAddress);
    await adminCall('transferOwnership', [await nextAdmin.getAddress()]);
    await tx(nextAdmin.connect(signers[5]).execute(await donations.getAddress(), donations.interface.encodeFunctionData('acceptOwnership')));
    assert.equal(await donations.owner(), await nextAdmin.getAddress());
    assert.equal(await donations.pendingOwner(), ethers.ZeroAddress);
    await fail(adminCall('pause'), 'OwnableUnauthorizedAccount(address)');
    await tx(nextAdmin.connect(signers[5]).execute(await donations.getAddress(), donations.interface.encodeFunctionData('pause')));
    assert.equal(await donations.paused(), true);
  });

  it('rejects bare native transfers and exposes no history, withdrawal, recipient override or upgrade interface', async () => {
    await fail(donor.sendTransaction({to: await donations.getAddress(), value: AMOUNT}));
    assert.equal(await balance(await donations.getAddress()), 0n);
    for (const method of ['withdraw', 'withdrawTo', 'setCreator', 'setCore', 'upgradeToAndCall', 'donationCount', 'messageMinimum', 'setMessageMinimum']) {
      assert.equal(donations.interface.getFunction(method), null);
    }
    assert.equal(donations.interface.getEvent('MessageMinimumUpdated'), null);
    assert.equal(donations.interface.getError('InvalidMessageMinimum'), null);
    assert.equal(donations.interface.getError('MessageBelowMinimum'), null);
  });
});
