// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @notice Experimental additive collection launch; not the deployed 1/1 protocol.
/// @dev No upgrade mechanism. Terms and metadata are immutable once locked.
contract CollectionLaunch is ERC721, ERC2981, Ownable2Step, Pausable, ReentrancyGuard {
    enum Kind { Fixed, Merkle, UniformAuction }

    struct PhaseConfig {
        Kind kind;
        uint64 start;
        uint64 end;
        uint32 allocation;
        uint32 walletLimit;
        uint256 price;
        bytes32 merkleRoot;
        bool enabled;
        bool rollover;
        // Zero means fixed price; otherwise the earlier auction index plus one.
        uint8 priceSource;
        bool fallbackEnabled;
        uint256 fallbackPrice;
    }

    struct PhaseState {
        uint32 capacity;
        uint32 consumed;
        uint256 bids;
        uint256 clearingPrice;
        bool closed;
        bool subscribed;
    }

    struct Bid {
        uint256 amount;
        uint256 sequence;
        bool winner;
        bool claimed;
        bool refundCredited;
    }

    uint256 public constant PRIMARY_FEE_BPS = 250;
    uint256 public constant MAX_PHASES = 32;
    uint256 public constant MAX_MINT_BATCH = 20;
    uint32 public immutable maxSupply;
    address public immutable creator;
    address public immutable protocolReceiver;
    string private _metadataPrefix;
    uint256 public totalMinted;
    uint256 public totalBurned;
    uint256 public allocatedSupply;
    bool public configurationLocked;
    address public forge;
    PhaseConfig[] private _phases;
    mapping(uint256 => PhaseState) private _states;
    mapping(uint256 => mapping(address => uint256)) public phaseMints;
    mapping(uint256 => mapping(address => Bid)) public bids;
    mapping(uint256 => address[]) private _heaps;
    mapping(address => uint256) public credits;
    mapping(uint256 => address) public firstCollector;

    error InvalidConfiguration();
    error Locked();
    error NotLocked();
    error InvalidPhase();
    error PhaseUnavailable();
    error PreviousPhaseOpen();
    error SupplyExceeded();
    error WalletLimitExceeded();
    error IncorrectPayment();
    error InvalidProof();
    error AlreadyParticipated();
    error NotWinner();
    error AlreadyClaimed();
    error PriceUnavailable();
    error NothingToWithdraw();
    error TransferFailed();
    error UnauthorizedForge();

    event PhaseConfigured(uint256 indexed phaseId, PhaseConfig config);
    event ConfigurationLocked(bytes32 indexed commitment, uint256 chainId);
    event PhaseClosed(uint256 indexed phaseId, uint256 consumed, uint256 unused, bool rolled);
    event CollectionMinted(uint256 indexed phaseId, address indexed payer, address indexed recipient, uint256 firstTokenId, uint256 quantity, uint256 unitPrice);
    event BidPlaced(uint256 indexed phaseId, address indexed bidder, uint256 amount, uint256 sequence);
    event AuctionFinalized(uint256 indexed phaseId, uint256 clearingPrice, uint256 winners, bool subscribed);
    event RefundCredited(uint256 indexed phaseId, address indexed bidder, uint256 amount);
    event CreditWithdrawn(address indexed payee, address indexed recipient, uint256 amount);
    event ForgeConfigured(address indexed forge);

    constructor(
        string memory name_, string memory symbol_, string memory metadataPrefix_,
        uint32 maxSupply_, address creator_, address protocolReceiver_,
        address royaltyReceiver_, uint96 royaltyBps_
    ) ERC721(name_, symbol_) Ownable(creator_) {
        if (maxSupply_ == 0 || protocolReceiver_ == address(0) || royaltyReceiver_ == address(0)
            || bytes(metadataPrefix_).length == 0 || royaltyBps_ > 10_000) revert InvalidConfiguration();
        maxSupply = maxSupply_;
        creator = creator_;
        protocolReceiver = protocolReceiver_;
        _metadataPrefix = metadataPrefix_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    function addPhase(PhaseConfig calldata config) external onlyOwner {
        if (configurationLocked) revert Locked();
        uint256 id = _phases.length;
        if (id >= MAX_PHASES || config.start >= config.end || config.allocation == 0
            || config.walletLimit == 0 || allocatedSupply + config.allocation > maxSupply
            || (id != 0 && config.start < _phases[id - 1].end)) revert InvalidConfiguration();
        if (config.kind == Kind.UniformAuction && (config.walletLimit != 1 || config.price == 0
            || config.priceSource != 0 || config.merkleRoot != bytes32(0))) revert InvalidConfiguration();
        if (config.kind == Kind.Merkle && config.merkleRoot == bytes32(0)) revert InvalidConfiguration();
        if (config.kind == Kind.Fixed && config.merkleRoot != bytes32(0)) revert InvalidConfiguration();
        if (config.priceSource != 0 && (config.priceSource > id
            || _phases[config.priceSource - 1].kind != Kind.UniformAuction
            || config.price != 0)) revert InvalidConfiguration();
        if (config.priceSource == 0 && (config.fallbackEnabled || config.fallbackPrice != 0)) revert InvalidConfiguration();
        if (!config.fallbackEnabled && config.fallbackPrice != 0) revert InvalidConfiguration();
        _phases.push(config);
        _states[id].capacity = config.allocation;
        allocatedSupply += config.allocation;
        emit PhaseConfigured(id, config);
    }

    function setForge(address forge_) external onlyOwner {
        if (configurationLocked || forge != address(0)) revert Locked();
        if (forge_.code.length == 0) revert InvalidConfiguration();
        forge = forge_;
        emit ForgeConfigured(forge_);
    }

    function lockConfiguration() external onlyOwner {
        if (configurationLocked) revert Locked();
        if (_phases.length == 0 || _phases[0].start <= block.timestamp
            || _phases[_phases.length - 1].rollover) revert InvalidConfiguration();
        configurationLocked = true;
        emit ConfigurationLocked(keccak256(abi.encode(block.chainid, address(this), _phases, forge)), block.chainid);
    }

    function phaseCount() external view returns (uint256) { return _phases.length; }

    function phase(uint256 id) external view returns (PhaseConfig memory, PhaseState memory) {
        if (id >= _phases.length) revert InvalidPhase();
        return (_phases[id], _states[id]);
    }

    function mintPrice(uint256 id) public view returns (uint256) {
        if (id >= _phases.length) revert InvalidPhase();
        PhaseConfig storage config = _phases[id];
        if (config.priceSource == 0) return config.price;
        PhaseState storage source = _states[config.priceSource - 1];
        if (!source.closed) revert PriceUnavailable();
        if (source.subscribed) return source.clearingPrice;
        if (!config.fallbackEnabled) revert PriceUnavailable();
        return config.fallbackPrice;
    }

    function allowlistLeaf(uint256 id, address claimant, uint256 allowance) public view returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(block.chainid, address(this), id, claimant, allowance))));
    }

    function mintPhase(uint256 id, uint256 quantity, uint256 allowance, bytes32[] calldata proof, address recipient)
        external payable nonReentrant whenNotPaused
    {
        _requireLive(id);
        PhaseConfig storage config = _phases[id];
        if (config.kind == Kind.UniformAuction || quantity == 0 || quantity > MAX_MINT_BATCH
            || recipient == address(0)) revert InvalidConfiguration();
        uint256 minted = phaseMints[id][msg.sender] + quantity;
        if (minted > config.walletLimit) revert WalletLimitExceeded();
        if (config.kind == Kind.Merkle && (proof.length > 64 || minted > allowance
            || !MerkleProof.verifyCalldata(proof, config.merkleRoot, allowlistLeaf(id, msg.sender, allowance)))) revert InvalidProof();
        PhaseState storage state = _states[id];
        if (state.consumed + quantity > state.capacity) revert SupplyExceeded();
        uint256 price = mintPrice(id);
        if (msg.value != price * quantity) revert IncorrectPayment();
        state.consumed += uint32(quantity);
        phaseMints[id][msg.sender] = minted;
        _creditProceeds(msg.value);
        _mintBatch(id, msg.sender, recipient, quantity, price);
    }

    /// @notice One funded, indivisible bid per wallet; no cancellation or bid replacement.
    function bid(uint256 id) external payable nonReentrant whenNotPaused {
        _requireLive(id);
        PhaseConfig storage config = _phases[id];
        if (config.kind != Kind.UniformAuction) revert InvalidPhase();
        if (bids[id][msg.sender].sequence != 0) revert AlreadyParticipated();
        if (msg.value < config.price) revert IncorrectPayment();
        uint256 sequence = ++_states[id].bids;
        bids[id][msg.sender] = Bid(msg.value, sequence, true, false, false);
        address[] storage heap = _heaps[id];
        if (heap.length < _states[id].capacity) {
            heap.push(msg.sender);
            _siftUp(id, heap.length - 1);
        } else if (_worse(id, heap[0], msg.sender)) {
            _refundLoser(id, heap[0]);
            heap[0] = msg.sender;
            _siftDown(id, 0);
        } else {
            _refundLoser(id, msg.sender);
        }
        emit BidPlaced(id, msg.sender, msg.value, sequence);
    }

    /// @notice Constant-time settlement creates obligations, never loops over bidders.
    /// @dev Kept available during pause so administration cannot strand escrow.
    function finalizeAuction(uint256 id) external nonReentrant {
        if (id >= _phases.length || _phases[id].kind != Kind.UniformAuction) revert InvalidPhase();
        _closePhase(id);
    }

    function closePhase(uint256 id) external nonReentrant { _closePhase(id); }

    function claimAuctionRefund(uint256 id) external nonReentrant {
        _requireSettledWinner(id, msg.sender);
        _creditWinnerRefund(id, msg.sender);
    }

    /// @dev Settled entitlements, like refunds, remain claimable during entry pause.
    function claimAuction(uint256 id, address recipient) external nonReentrant {
        _requireSettledWinner(id, msg.sender);
        Bid storage entry = bids[id][msg.sender];
        if (entry.claimed) revert AlreadyClaimed();
        entry.claimed = true;
        _creditWinnerRefund(id, msg.sender);
        phaseMints[id][msg.sender] = 1;
        _mintBatch(id, msg.sender, recipient, 1, _states[id].clearingPrice);
    }

    function withdrawTo(address payable recipient) external nonReentrant {
        if (recipient == address(0)) revert InvalidConfiguration();
        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        credits[msg.sender] = 0;
        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreditWithdrawn(msg.sender, recipient, amount);
    }

    function burnForForge(address holder, uint256 tokenId) external {
        if (msg.sender != forge || !configurationLocked) revert UnauthorizedForge();
        if (ownerOf(tokenId) != holder || !_isAuthorized(holder, msg.sender, tokenId)) revert UnauthorizedForge();
        ++totalBurned;
        _burn(tokenId);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function totalSupply() external view returns (uint256) { return totalMinted - totalBurned; }

    function _requireLive(uint256 id) private view {
        if (!configurationLocked) revert NotLocked();
        if (id >= _phases.length) revert InvalidPhase();
        PhaseConfig storage config = _phases[id];
        if (!config.enabled || _states[id].closed || block.timestamp < config.start
            || block.timestamp >= config.end) revert PhaseUnavailable();
        if (id != 0 && !_states[id - 1].closed) revert PreviousPhaseOpen();
    }

    function _closePhase(uint256 id) private {
        if (!configurationLocked) revert NotLocked();
        if (id >= _phases.length) revert InvalidPhase();
        PhaseConfig storage config = _phases[id];
        PhaseState storage state = _states[id];
        if (state.closed || block.timestamp < config.end) revert PhaseUnavailable();
        if (id != 0 && !_states[id - 1].closed) revert PreviousPhaseOpen();
        state.closed = true;
        if (config.kind == Kind.UniformAuction) {
            uint256 count = _heaps[id].length;
            state.consumed = uint32(count);
            state.subscribed = count == state.capacity;
            state.clearingPrice = count == 0 ? 0 : (state.subscribed ? bids[id][_heaps[id][0]].amount : config.price);
            _creditProceeds(state.clearingPrice * count);
            emit AuctionFinalized(id, state.clearingPrice, count, state.subscribed);
        }
        uint32 unused = state.capacity - state.consumed;
        if (config.rollover) _states[id + 1].capacity += unused;
        emit PhaseClosed(id, state.consumed, unused, config.rollover);
    }

    function _requireSettledWinner(uint256 id, address bidder) private view {
        if (id >= _phases.length || _phases[id].kind != Kind.UniformAuction
            || !_states[id].closed || !bids[id][bidder].winner) revert NotWinner();
    }

    function _creditWinnerRefund(uint256 id, address bidder) private {
        Bid storage entry = bids[id][bidder];
        if (!entry.refundCredited) {
            entry.refundCredited = true;
            uint256 amount = entry.amount - _states[id].clearingPrice;
            credits[bidder] += amount;
            emit RefundCredited(id, bidder, amount);
        }
    }

    function _refundLoser(uint256 id, address bidder) private {
        Bid storage entry = bids[id][bidder];
        entry.winner = false;
        entry.refundCredited = true;
        credits[bidder] += entry.amount;
        emit RefundCredited(id, bidder, entry.amount);
    }

    function _creditProceeds(uint256 amount) private {
        // Division first avoids overflow for valid balances while preserving floor rounding.
        uint256 fee = amount / 10_000 * PRIMARY_FEE_BPS + amount % 10_000 * PRIMARY_FEE_BPS / 10_000;
        credits[protocolReceiver] += fee;
        credits[creator] += amount - fee;
    }

    function _mintBatch(uint256 id, address payer, address recipient, uint256 quantity, uint256 price) private {
        if (totalMinted + quantity > maxSupply) revert SupplyExceeded();
        uint256 firstId = totalMinted + 1;
        totalMinted += quantity;
        for (uint256 i; i < quantity; ++i) {
            firstCollector[firstId + i] = recipient;
            _safeMint(recipient, firstId + i);
        }
        emit CollectionMinted(id, payer, recipient, firstId, quantity, price);
    }

    function _worse(uint256 id, address a, address b) private view returns (bool) {
        Bid storage first = bids[id][a];
        Bid storage second = bids[id][b];
        return first.amount < second.amount || (first.amount == second.amount && first.sequence > second.sequence);
    }

    function _siftUp(uint256 id, uint256 position) private {
        address[] storage heap = _heaps[id];
        while (position != 0) {
            uint256 parent = (position - 1) / 2;
            if (!_worse(id, heap[position], heap[parent])) break;
            (heap[position], heap[parent]) = (heap[parent], heap[position]);
            position = parent;
        }
    }

    function _siftDown(uint256 id, uint256 position) private {
        address[] storage heap = _heaps[id];
        while (position * 2 + 1 < heap.length) {
            uint256 child = position * 2 + 1;
            if (child + 1 < heap.length && _worse(id, heap[child + 1], heap[child])) ++child;
            if (!_worse(id, heap[child], heap[position])) break;
            (heap[position], heap[child]) = (heap[child], heap[position]);
            position = child;
        }
    }

    function _baseURI() internal view override returns (string memory) { return _metadataPrefix; }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
