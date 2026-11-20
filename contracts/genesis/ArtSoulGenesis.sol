// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IGenesisGrantAuthority {
    function getThreshold() external view returns (uint256);
}

/// @notice Non-transferable art granted on Base against published, reviewed decisions.
contract ArtSoulGenesis is ERC721, ReentrancyGuard {
    uint256 public constant BASE_MAINNET = 8453;
    uint16 public constant SUPPLY = 10_000;
    uint16 public constant RESERVED_TEAM = 200;
    // Bounds the work in one transaction; it does not set the distribution cadence.
    uint256 public constant MAX_BATCH = 32;

    enum Category { Founder, Team, MainnetActivity, Community }
    struct Grant {
        uint16 tokenId;
        Category category;
        address recipient;
        uint256 activityChainId;
        bytes32 decisionHash;
    }
    struct GrantRecord {
        Category category;
        bytes32 decisionHash;
    }

    IGenesisGrantAuthority public immutable grantAuthority;
    address public immutable founderRecipient;
    string private _metadataPrefix;
    uint256 public totalSupply;
    mapping(uint256 => GrantRecord) public grantRecord;
    mapping(bytes32 => bool) public usedDecision;

    error BaseMainnetOnly();
    error InvalidAuthority();
    error InvalidMetadataPrefix();
    error InvalidGrant();
    error InvalidBatchSize();
    error Soulbound();

    event Locked(uint256 tokenId);
    event GenesisGranted(uint256 indexed tokenId, address indexed recipient, Category indexed category, bytes32 decisionHash);

    constructor(address authority, address founder, string memory metadataPrefix) ERC721("ArtSoul Genesis", "GENESIS") {
        if (block.chainid != BASE_MAINNET) revert BaseMainnetOnly();
        if (authority.code.length == 0 || IGenesisGrantAuthority(authority).getThreshold() < 2) revert InvalidAuthority();
        if (founder == address(0)) revert InvalidGrant();
        _checkMetadataPrefix(bytes(metadataPrefix));
        grantAuthority = IGenesisGrantAuthority(authority);
        founderRecipient = founder;
        _metadataPrefix = metadataPrefix;
    }

    function grantBatch(Grant[] calldata grants) external nonReentrant {
        if (block.chainid != BASE_MAINNET) revert BaseMainnetOnly();
        if (msg.sender != address(grantAuthority) || grantAuthority.getThreshold() < 2) revert InvalidAuthority();
        if (grants.length == 0 || grants.length > MAX_BATCH) revert InvalidBatchSize();
        for (uint256 i; i < grants.length; ++i) {
            Grant calldata g = grants[i];
            if (g.tokenId >= SUPPLY || g.recipient == address(0) || g.decisionHash == bytes32(0) ||
                usedDecision[g.decisionHash] || _ownerOf(g.tokenId) != address(0)) revert InvalidGrant();
            if ((g.tokenId == 0) != (g.category == Category.Founder) ||
                (g.category == Category.Founder && g.recipient != founderRecipient) ||
                (g.tokenId > 0 && g.tokenId <= RESERVED_TEAM) != (g.category == Category.Team) ||
                g.activityChainId != (g.category == Category.MainnetActivity ? BASE_MAINNET : 0)) revert InvalidGrant();
            usedDecision[g.decisionHash] = true;
            grantRecord[g.tokenId] = GrantRecord(g.category, g.decisionHash);
            ++totalSupply;
            _safeMint(g.recipient, g.tokenId);
            emit Locked(g.tokenId);
            emit GenesisGranted(g.tokenId, g.recipient, g.category, g.decisionHash);
        }
    }

    function _baseURI() internal view override returns (string memory) { return _metadataPrefix; }

    // Root-only CIDv1 with DAG-PB and SHA2-256: 01 70 12 20 + 32 digest bytes.
    // Lowercase unpadded base32 has two zero padding bits in its last digit.
    function _checkMetadataPrefix(bytes memory prefix) private pure {
        if (prefix.length != 67 || bytes14(prefix) != bytes14("ipfs://bafybei") ||
            prefix[14] < "a" || prefix[14] > "h" || prefix[66] != "/") revert InvalidMetadataPrefix();
        for (uint256 i = 15; i < 66; ++i) {
            uint8 digit = uint8(prefix[i]);
            if (digit >= 97 && digit <= 122) digit -= 97;
            else if (digit >= 50 && digit <= 55) digit = digit - 50 + 26;
            else revert InvalidMetadataPrefix();
            if (i == 65 && (digit & 3) != 0) revert InvalidMetadataPrefix();
        }
    }

    /// @dev ERC-5192. A nonexistent token must revert.
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == this.locked.selector || super.supportsInterface(interfaceId);
    }

    function approve(address, uint256) public pure override { revert Soulbound(); }
    function setApprovalForAll(address, bool) public pure override { revert Soulbound(); }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (_ownerOf(tokenId) != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }
}
