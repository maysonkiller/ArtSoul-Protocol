const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = require("ethers");

const { artifacts, network } = hre;

const BPS = 10_000n;
const DEPOSIT_BPS = 1_000n;
const PLATFORM_FEE_BPS = 250n;
const ARTIST_ROYALTY_BPS = 750n;
const DEFAULT_ARTIST_BPS = 8_000n;
const DEFAULT_PLATFORM_BPS = 2_000n;
const DURATION_24H = 24 * 60 * 60;
const DURATION_36H = 36 * 60 * 60;
const DURATION_48H = 48 * 60 * 60;
const SETTLEMENT_WINDOW = 24 * 60 * 60;
const ANTI_SNIPING_WINDOW = 10 * 60;
const ANTI_SNIPING_EXTENSION = 10 * 60;
const MAX_TOTAL_EXTENSION = 60 * 60;
const MIN_DEPOSIT = ethers.parseEther("0.01");
const MIN_INCREMENT_ABSOLUTE = ethers.parseEther("0.01");
const ONE_ETH = ethers.parseEther("1");
const TWO_ETH = ethers.parseEther("2");

const ERROR_SIGNATURES = {
  ActiveAuctionExists: "ActiveAuctionExists()",
  ArtworkAlreadyMinted: "ArtworkAlreadyMinted()",
  AuctionAlreadyFinalized: "AuctionAlreadyFinalized()",
  AuctionNotEnded: "AuctionNotEnded()",
  BidderCannotSelfOutbid: "BidderCannotSelfOutbid()",
  CreatorCannotBid: "CreatorCannotBid()",
  EmptyMetadataURI: "EmptyMetadataURI()",
  EnforcedPause: "EnforcedPause()",
  GenesisAlreadyMinted: "GenesisAlreadyMinted()",
  GenesisSoldOut: "GenesisSoldOut()",
  InvalidAuctionDuration: "InvalidAuctionDuration()",
  NotArtworkCreator: "NotArtworkCreator()",
  NotAuctionWinner: "NotAuctionWinner()",
  OwnableUnauthorizedAccount: "OwnableUnauthorizedAccount(address)",
  PriceBelowCanonicalFloor: "PriceBelowCanonicalFloor(uint256)",
  ProjectNFTAlreadyMinted: "ProjectNFTAlreadyMinted()",
  SettlementStillActive: "SettlementStillActive()",
  TransferFailed: "TransferFailed()",
  UnauthorizedCore: "UnauthorizedCore()",
};

let provider;

function ceilDiv(value, denominator) {
  if (value === 0n) return 0n;
  return ((value - 1n) / denominator) + 1n;
}

function expectedDeposit(bidAmount) {
  const percentageDeposit = ceilDiv(bidAmount * DEPOSIT_BPS, BPS);
  return percentageDeposit > MIN_DEPOSIT ? percentageDeposit : MIN_DEPOSIT;
}

function expectedNextBid(highestBid) {
  const percentIncrement = ceilDiv(highestBid * 250n, BPS);
  const increment =
    percentIncrement > MIN_INCREMENT_ABSOLUTE
      ? percentIncrement
      : MIN_INCREMENT_ABSOLUTE;
  return highestBid + increment;
}

function hashFor(label) {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function getProvider() {
  if (provider === undefined) {
    provider = new ethers.BrowserProvider(network.provider);
  }

  return provider;
}

async function getSigners() {
  const browserProvider = await getProvider();
  const addresses = await browserProvider.send("eth_accounts", []);
  return Promise.all(addresses.map((address) => browserProvider.getSigner(address)));
}

async function deployContract(name, signer, args = []) {
  const artifact = await artifacts.readArtifact(name);
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer
  );
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function mine(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

async function txTimestamp(txPromise) {
  const receipt = await mine(txPromise);
  const browserProvider = await getProvider();
  const block = await browserProvider.getBlock(receipt.blockNumber);
  return { receipt, timestamp: BigInt(block.timestamp) };
}

async function increaseTime(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

async function mineAt(timestamp) {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await network.provider.send("evm_mine");
}

async function latestTimestamp() {
  const block = await network.provider.send("eth_getBlockByNumber", [
    "latest",
    false,
  ]);
  return BigInt(block.timestamp);
}

async function ethBalance(address) {
  const balance = await network.provider.send("eth_getBalance", [address, "latest"]);
  return BigInt(balance);
}

function collectErrorData(value, seen = new Set()) {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") {
    return value.startsWith("0x") ? [value] : [];
  }
  if (typeof value !== "object" || seen.has(value)) return [];

  seen.add(value);

  let data = [];
  for (const key of Object.keys(value)) {
    data = data.concat(collectErrorData(value[key], seen));
  }
  return data;
}

async function expectRevert(promise, errorName) {
  try {
    const result = await promise;
    if (result !== undefined && typeof result.wait === "function") {
      await result.wait();
    }
  } catch (error) {
    if (errorName === undefined) return;

    const signature = ERROR_SIGNATURES[errorName];
    const selector = signature === undefined ? undefined : ethers.id(signature).slice(0, 10);
    const text = [
      error.message,
      error.shortMessage,
      error.revert?.name,
      error.reason,
      JSON.stringify(error.info ?? {}),
    ].join(" ");
    const data = collectErrorData(error);

    expect(
      text.includes(errorName) ||
        (selector !== undefined &&
          data.some((entry) => entry.toLowerCase().startsWith(selector)))
    ).to.equal(true, `Expected revert ${errorName}, got ${text}`);
    return;
  }

  throw new Error(`Expected revert${errorName === undefined ? "" : ` ${errorName}`}`);
}

async function findEvents(receipt, contract, eventName) {
  const address = (await contract.getAddress()).toLowerCase();
  const events = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;

    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        events.push(parsed);
      }
    } catch (_) {
      // Ignore logs from inherited interfaces that this contract cannot parse.
    }
  }

  return events;
}

async function expectEvent(receipt, contract, eventName) {
  const events = await findEvents(receipt, contract, eventName);
  expect(events.length, `Expected ${eventName}`).to.be.greaterThan(0);
  return events[0];
}

async function deployProtocol() {
  const [owner, artist, bidder, bidder2, buyer, treasury, outsider, ...rest] =
    await getSigners();

  const nft = await deployContract("ArtSoulNFT", owner);
  const projectNFT = await deployContract("ArtSoulProjectNFT", owner);
  const core = await deployContract("ArtSoulCore", owner, [
    await nft.getAddress(),
    await projectNFT.getAddress(),
    await treasury.getAddress(),
  ]);

  await mine(nft.connect(owner).setCore(await core.getAddress()));
  await mine(projectNFT.connect(owner).setCore(await core.getAddress()));

  return {
    owner,
    artist,
    bidder,
    bidder2,
    buyer,
    treasury,
    outsider,
    rest,
    nft,
    projectNFT,
    core,
  };
}

async function registerArtwork(core, artist, metadata = "ipfs://artwork-1") {
  const receipt = await mine(core.connect(artist).registerArtwork(metadata));
  const event = await expectEvent(receipt, core, "ArtworkRegistered");
  expect(event.args.artworkId).to.equal(1n);
  expect(event.args.creator).to.equal(await artist.getAddress());
  expect(event.args.metadataURI).to.equal(metadata);
  return 1n;
}

async function createAuction(
  core,
  artist,
  artworkId = 1n,
  startPrice = ONE_ETH,
  duration = DURATION_24H
) {
  const receipt = await mine(
    core.connect(artist).createAuction(artworkId, startPrice, duration)
  );
  await expectEvent(receipt, core, "AuctionCreated");
  return 1n;
}

async function createBidAndEndAuction(ctx, bidAmount = ONE_ETH) {
  const { core, artist, bidder } = ctx;
  await registerArtwork(core, artist);
  await createAuction(core, artist);

  const deposit = await core.requiredDepositForBid(bidAmount);
  await mine(core.connect(bidder).placeBid(1, bidAmount, { value: deposit }));

  await increaseTime(DURATION_24H + 1);
  const { timestamp } = await txTimestamp(core.endAuction(1));

  return { bidAmount, deposit, endedAt: timestamp };
}

async function settlePrimaryAuction(ctx, bidAmount = ONE_ETH) {
  const { core, bidder } = ctx;
  const { deposit } = await createBidAndEndAuction(ctx, bidAmount);
  const requiredPayment = bidAmount - deposit;
  const receipt = await mine(
    core.connect(bidder).settleAuction(1, { value: requiredPayment })
  );

  return { deposit, requiredPayment, receipt };
}

describe("ArtSoul V4.1 protocol", function () {
  describe("artwork registration", function () {
    it("stores creator and metadata, and starts unminted", async function () {
      const { core, artist } = await deployProtocol();

      await registerArtwork(core, artist, "ipfs://metadata");
      const artwork = await core.artworks(1);

      expect(artwork.creator).to.equal(await artist.getAddress());
      expect(artwork.metadataURI).to.equal("ipfs://metadata");
      expect(artwork.minted).to.equal(false);
      expect(artwork.canonicalFloor).to.equal(0n);
      expect(artwork.activeAuctionId).to.equal(0n);
    });

    it("rejects empty metadata", async function () {
      const { core, artist } = await deployProtocol();

      await expectRevert(
        core.connect(artist).registerArtwork(""),
        "EmptyMetadataURI"
      );
    });
  });

  describe("auction creation", function () {
    it("allows only creator and only 24h/36h/48h durations", async function () {
      const { core, artist, outsider } = await deployProtocol();

      await registerArtwork(core, artist);

      await expectRevert(
        core.connect(outsider).createAuction(1, ONE_ETH, DURATION_24H),
        "NotArtworkCreator"
      );

      await expectRevert(
        core.connect(artist).createAuction(1, ONE_ETH, 12 * 60 * 60),
        "InvalidAuctionDuration"
      );

      await createAuction(core, artist, 1, ONE_ETH, DURATION_24H);

      const durations = [DURATION_36H, DURATION_48H];
      for (const [index, duration] of durations.entries()) {
        await mine(core.connect(artist).registerArtwork(`ipfs://extra-${index}`));
        const receipt = await mine(
          core.connect(artist).createAuction(index + 2, ONE_ETH, duration)
        );
        await expectEvent(receipt, core, "AuctionCreated");
      }
    });

    it("blocks duplicate active auction and already minted artwork auction", async function () {
      const first = await deployProtocol();
      await registerArtwork(first.core, first.artist);
      await createAuction(first.core, first.artist);

      await expectRevert(
        first.core.connect(first.artist).createAuction(1, ONE_ETH, DURATION_24H),
        "ActiveAuctionExists"
      );

      const settled = await deployProtocol();
      await settlePrimaryAuction(settled);
      await expectRevert(
        settled.core
          .connect(settled.artist)
          .createAuction(1, ONE_ETH, DURATION_24H),
        "ArtworkAlreadyMinted"
      );
    });
  });

  describe("bid logic and withdrawals", function () {
    it("calculates deposit and minimum increment correctly", async function () {
      const { core, artist, bidder } = await deployProtocol();

      expect(await core.requiredDepositForBid(ethers.parseEther("0.02"))).to.equal(
        MIN_DEPOSIT
      );
      expect(await core.requiredDepositForBid(ONE_ETH)).to.equal(
        expectedDeposit(ONE_ETH)
      );

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      expect(await core.minimumBid(1)).to.equal(ONE_ETH);

      await mine(
        core
          .connect(bidder)
          .placeBid(1, ONE_ETH, { value: expectedDeposit(ONE_ETH) })
      );

      expect(await core.minimumBid(1)).to.equal(expectedNextBid(ONE_ETH));
    });

    it("blocks creator self-bid and bidder self-outbid", async function () {
      const { core, artist, bidder } = await deployProtocol();

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      await expectRevert(
        core
          .connect(artist)
          .placeBid(1, ONE_ETH, { value: expectedDeposit(ONE_ETH) }),
        "CreatorCannotBid"
      );

      await mine(
        core
          .connect(bidder)
          .placeBid(1, ONE_ETH, { value: expectedDeposit(ONE_ETH) })
      );

      const nextBid = expectedNextBid(ONE_ETH);
      await expectRevert(
        core
          .connect(bidder)
          .placeBid(1, nextBid, { value: expectedDeposit(nextBid) }),
        "BidderCannotSelfOutbid"
      );
    });

    it("moves previous bidder deposit to pull withdrawals", async function () {
      const { core, artist, bidder, bidder2 } = await deployProtocol();
      const bidderAddress = await bidder.getAddress();

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      const firstDeposit = expectedDeposit(ONE_ETH);
      await mine(core.connect(bidder).placeBid(1, ONE_ETH, { value: firstDeposit }));

      const secondBid = expectedNextBid(ONE_ETH);
      const outbidReceipt = await mine(
        core
          .connect(bidder2)
          .placeBid(1, secondBid, { value: expectedDeposit(secondBid) })
      );
      const event = await expectEvent(outbidReceipt, core, "BidDepositWithdrawn");
      expect(event.args.bidder).to.equal(bidderAddress);
      expect(event.args.amount).to.equal(firstDeposit);

      expect(await core.pendingWithdrawals(bidderAddress)).to.equal(firstDeposit);

      const coreBalanceBefore = await ethBalance(await core.getAddress());
      const bidderBalanceBefore = await ethBalance(bidderAddress);
      const receipt = await mine(core.connect(bidder).withdraw());
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const coreBalanceAfter = await ethBalance(await core.getAddress());
      const bidderBalanceAfter = await ethBalance(bidderAddress);

      expect(coreBalanceAfter).to.equal(coreBalanceBefore - firstDeposit);
      expect(bidderBalanceAfter).to.equal(
        bidderBalanceBefore + firstDeposit - gasCost
      );
      expect(await core.pendingWithdrawals(bidderAddress)).to.equal(0n);
    });

    it("keeps withdrawal protected against reentrancy", async function () {
      const { core, artist, bidder2 } = await deployProtocol();

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      const reentrant = await deployContract(
        "ReentrantWithdrawer",
        bidder2,
        [await core.getAddress()]
      );

      const firstDeposit = expectedDeposit(ONE_ETH);
      await mine(reentrant.bid(1, ONE_ETH, { value: firstDeposit }));

      const secondBid = expectedNextBid(ONE_ETH);
      await mine(
        core
          .connect(bidder2)
          .placeBid(1, secondBid, { value: expectedDeposit(secondBid) })
      );

      expect(await core.pendingWithdrawals(await reentrant.getAddress())).to.equal(
        firstDeposit
      );
      await expectRevert(reentrant.withdrawWithReentry(), "TransferFailed");
      expect(await core.pendingWithdrawals(await reentrant.getAddress())).to.equal(
        firstDeposit
      );
    });
  });

  describe("anti-sniping", function () {
    it("extends a late bid by 10 minutes and emits AuctionExtended", async function () {
      const { core, artist, bidder } = await deployProtocol();

      await registerArtwork(core, artist);
      await createAuction(core, artist);
      const before = await core.auctions(1);

      await increaseTime(DURATION_24H - ANTI_SNIPING_WINDOW + 60);

      const receipt = await mine(
        core
          .connect(bidder)
          .placeBid(1, ONE_ETH, { value: expectedDeposit(ONE_ETH) })
      );
      const event = await expectEvent(receipt, core, "AuctionExtended");

      expect(event.args.oldEndTime).to.equal(before.endTime);
      expect(event.args.newEndTime).to.equal(
        before.endTime + BigInt(ANTI_SNIPING_EXTENSION)
      );

      const after = await core.auctions(1);
      expect(after.totalExtension).to.equal(BigInt(ANTI_SNIPING_EXTENSION));
    });

    it("enforces the 60 minute maximum extension cap", async function () {
      const { core, artist, bidder, bidder2, rest } = await deployProtocol();
      const bidders = [bidder, bidder2, ...rest];

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      let bid = ONE_ETH;
      for (let i = 0; i < 6; i++) {
        const auction = await core.auctions(1);
        const targetDelta =
          Number(auction.endTime - (await latestTimestamp())) -
          ANTI_SNIPING_WINDOW +
          60;
        if (targetDelta > 0) {
          await increaseTime(targetDelta);
        }

        if (i > 0) bid = expectedNextBid(bid);
        await mine(
          core
            .connect(bidders[i])
            .placeBid(1, bid, { value: expectedDeposit(bid) })
        );
      }

      const capped = await core.auctions(1);
      expect(capped.totalExtension).to.equal(BigInt(MAX_TOTAL_EXTENSION));
      expect(capped.endTime).to.equal(
        capped.originalEndTime + BigInt(MAX_TOTAL_EXTENSION)
      );
    });
  });

  describe("auction ending and settlement", function () {
    it("creates settlement pending state and 24h deadline", async function () {
      const ctx = await deployProtocol();
      const { core } = ctx;

      const { endedAt, bidAmount } = await createBidAndEndAuction(ctx);
      const auction = await core.auctions(1);

      expect(auction.status).to.equal(2n);
      expect(auction.highestBid).to.equal(bidAmount);
      expect(auction.settlementDeadline).to.equal(
        endedAt + BigInt(SETTLEMENT_WINDOW)
      );
    });

    it("settles only by winner, lazy mints NFT, creates floor, and routes fees", async function () {
      const ctx = await deployProtocol();
      const { core, nft, artist, bidder, outsider, treasury } = ctx;
      const artistAddress = await artist.getAddress();
      const bidderAddress = await bidder.getAddress();
      const treasuryAddress = await treasury.getAddress();

      const { deposit, bidAmount } = await createBidAndEndAuction(ctx);
      const requiredPayment = bidAmount - deposit;

      await expectRevert(
        core.connect(outsider).settleAuction(1, { value: requiredPayment }),
        "NotAuctionWinner"
      );

      const receipt = await mine(
        core.connect(bidder).settleAuction(1, { value: requiredPayment })
      );
      await expectEvent(receipt, core, "SettlementCompleted");
      await expectEvent(receipt, core, "CanonicalFloorUpdated");

      expect(await nft.ownerOf(1)).to.equal(bidderAddress);
      expect(await nft.artworkToToken(1)).to.equal(1n);
      expect(await nft.tokenToArtwork(1)).to.equal(1n);
      expect(await nft.tokenCreator(1)).to.equal(artistAddress);

      const artwork = await core.artworks(1);
      expect(artwork.minted).to.equal(true);
      expect(artwork.canonicalFloor).to.equal(bidAmount);
      expect(artwork.tokenId).to.equal(1n);

      const royaltyInfo = await nft.royaltyInfo(1, ONE_ETH);
      expect(royaltyInfo[0]).to.equal(artistAddress);
      expect(royaltyInfo[1]).to.equal((ONE_ETH * ARTIST_ROYALTY_BPS) / BPS);

      expect(await core.pendingWithdrawals(artistAddress)).to.equal(
        bidAmount - (bidAmount * PLATFORM_FEE_BPS) / BPS
      );
      expect(await core.pendingWithdrawals(treasuryAddress)).to.equal(
        (bidAmount * PLATFORM_FEE_BPS) / BPS
      );
    });

    it("defaults only after deadline without minting or creating floor", async function () {
      const ctx = await deployProtocol();
      const { core, nft, artist, treasury } = ctx;
      const artistAddress = await artist.getAddress();
      const treasuryAddress = await treasury.getAddress();

      const { deposit } = await createBidAndEndAuction(ctx);

      await expectRevert(core.claimSettlementDefault(1), "SettlementStillActive");
      const pendingAuction = await core.auctions(1);
      const defaultDelta = Number(
        pendingAuction.settlementDeadline - (await latestTimestamp()) + 1n
      );
      if (defaultDelta > 0) {
        await increaseTime(defaultDelta);
      } else {
        await mineAt(pendingAuction.settlementDeadline + 1n);
      }

      const receipt = await mine(core.claimSettlementDefault(1, { gasLimit: 500000 }));
      await expectEvent(receipt, core, "SettlementDefaulted");

      const artwork = await core.artworks(1);
      expect(artwork.minted).to.equal(false);
      expect(artwork.canonicalFloor).to.equal(0n);
      expect(artwork.activeAuctionId).to.equal(0n);
      expect(await nft.totalSupply()).to.equal(0n);

      expect(await core.pendingWithdrawals(artistAddress)).to.equal(
        (deposit * DEFAULT_ARTIST_BPS) / BPS
      );
      expect(await core.pendingWithdrawals(treasuryAddress)).to.equal(
        (deposit * DEFAULT_PLATFORM_BPS) / BPS
      );

      const relaunch = await mine(
        core.connect(artist).createAuction(1, ONE_ETH, DURATION_24H)
      );
      await expectEvent(relaunch, core, "AuctionCreated");
    });
  });

  describe("resale rules", function () {
    it("rejects below-floor resale and settles above-floor resale with royalty and platform fee", async function () {
      const ctx = await deployProtocol();
      const { core, nft, artist, bidder, buyer, treasury } = ctx;
      const artistAddress = await artist.getAddress();
      const bidderAddress = await bidder.getAddress();
      const buyerAddress = await buyer.getAddress();
      const treasuryAddress = await treasury.getAddress();

      await settlePrimaryAuction(ctx);
      await mine(nft.connect(bidder).approve(await core.getAddress(), 1));

      await expectRevert(
        core.connect(bidder).listResale(1, ONE_ETH - 1n),
        "PriceBelowCanonicalFloor"
      );

      const listingReceipt = await mine(core.connect(bidder).listResale(1, TWO_ETH));
      await expectEvent(listingReceipt, core, "ResaleListed");

      const artistBefore = await core.pendingWithdrawals(artistAddress);
      const treasuryBefore = await core.pendingWithdrawals(treasuryAddress);

      const resaleReceipt = await mine(
        core.connect(buyer).buyResale(1, { value: TWO_ETH })
      );
      const resale = await expectEvent(resaleReceipt, core, "ResaleCompleted");
      expect(resale.args.seller).to.equal(bidderAddress);
      expect(resale.args.buyer).to.equal(buyerAddress);
      expect(resale.args.royaltyAmount).to.equal(
        (TWO_ETH * ARTIST_ROYALTY_BPS) / BPS
      );
      expect(resale.args.platformFee).to.equal(
        (TWO_ETH * PLATFORM_FEE_BPS) / BPS
      );

      expect(await nft.ownerOf(1)).to.equal(buyerAddress);
      expect(await core.pendingWithdrawals(artistAddress)).to.equal(
        artistBefore + (TWO_ETH * ARTIST_ROYALTY_BPS) / BPS
      );
      expect(await core.pendingWithdrawals(treasuryAddress)).to.equal(
        treasuryBefore + (TWO_ETH * PLATFORM_FEE_BPS) / BPS
      );
      expect(await core.pendingWithdrawals(bidderAddress)).to.equal(
        TWO_ETH -
          (TWO_ETH * ARTIST_ROYALTY_BPS) / BPS -
          (TWO_ETH * PLATFORM_FEE_BPS) / BPS
      );
    });
  });

  describe("ProjectNFT / Genesis", function () {
    it("mints only through Core with eligibility hash and blocks duplicates", async function () {
      const { core, projectNFT, bidder } = await deployProtocol();
      const bidderAddress = await bidder.getAddress();
      const eligibilityHash = hashFor("eligible-bidder");

      await expectRevert(
        projectNFT.connect(bidder).awardToWinner(bidderAddress, 0, eligibilityHash),
        "UnauthorizedCore"
      );

      await mine(core.recordProjectNFTEligibility(bidderAddress, eligibilityHash));

      const receipt = await mine(core.mintProjectNFT(bidderAddress, eligibilityHash));
      await expectEvent(receipt, core, "ProjectNFTMinted");
      await expectEvent(receipt, projectNFT, "GenesisNFTAwarded");

      expect(await projectNFT.ownerOf(1)).to.equal(bidderAddress);
      expect(await projectNFT.hasMintedGenesis(bidderAddress)).to.equal(true);
      expect(await projectNFT.userGenesisToken(bidderAddress)).to.equal(1n);
      expect(await projectNFT.tokenEligibilityHash(1)).to.equal(eligibilityHash);

      const history = await projectNFT.getOwnershipHistory(1);
      expect(history[0].length).to.equal(1);
      expect(history[0][0]).to.equal(bidderAddress);

      await expectRevert(
        core.mintProjectNFT(bidderAddress, eligibilityHash),
        "ProjectNFTAlreadyMinted"
      );
    });

    it("enforces max supply of 100", async function () {
      const { core, projectNFT, rest } = await deployProtocol();

      const recipients = [];
      for (const signer of rest) {
        recipients.push(await signer.getAddress());
      }
      while (recipients.length < 101) {
        recipients.push(ethers.Wallet.createRandom().address);
      }

      for (let i = 0; i < 100; i++) {
        const eligibilityHash = hashFor(`eligible-${i}`);
        await mine(core.recordProjectNFTEligibility(recipients[i], eligibilityHash));
        await mine(core.mintProjectNFT(recipients[i], eligibilityHash));
      }

      expect(await projectNFT.currentDistributed()).to.equal(100n);

      const overflowHash = hashFor("eligible-overflow");
      await mine(core.recordProjectNFTEligibility(recipients[100], overflowHash));
      await expectRevert(
        core.mintProjectNFT(recipients[100], overflowHash),
        "GenesisSoldOut"
      );
    });
  });

  describe("security and invalid transitions", function () {
    it("blocks unauthorized NFT mint and owner-only core wiring", async function () {
      const { nft, projectNFT, artist, bidder } = await deployProtocol();
      const artistAddress = await artist.getAddress();
      const bidderAddress = await bidder.getAddress();

      await expectRevert(
        nft.connect(artist).mint(artistAddress, "ipfs://bad", 1, artistAddress),
        "UnauthorizedCore"
      );

      await expectRevert(
        nft.connect(artist).setCore(bidderAddress),
        "OwnableUnauthorizedAccount"
      );

      await expectRevert(
        projectNFT.connect(artist).setCore(bidderAddress),
        "OwnableUnauthorizedAccount"
      );
    });

    it("enforces pause behavior and invalid settlement transitions", async function () {
      const { core, artist, bidder } = await deployProtocol();

      await mine(core.pause());
      await expectRevert(
        core.connect(artist).registerArtwork("ipfs://paused"),
        "EnforcedPause"
      );
      await mine(core.unpause());

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      await expectRevert(core.connect(bidder).settleAuction(1), "AuctionNotEnded");

      await increaseTime(DURATION_24H + 1);
      await mine(core.endAuction(1));

      await expectRevert(core.endAuction(1), "AuctionAlreadyFinalized");
    });

    it("keeps no-bid auctions reusable without minting", async function () {
      const { core, nft, artist } = await deployProtocol();

      await registerArtwork(core, artist);
      await createAuction(core, artist);

      await increaseTime(DURATION_24H + 1);
      await mine(core.endAuction(1));

      const artwork = await core.artworks(1);
      const auction = await core.auctions(1);
      expect(auction.status).to.equal(4n);
      expect(artwork.minted).to.equal(false);
      expect(artwork.canonicalFloor).to.equal(0n);
      expect(artwork.activeAuctionId).to.equal(0n);
      expect(await nft.totalSupply()).to.equal(0n);
    });
  });
});
