// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev The paired auction engine constructs its NFT and supplies its own settlement records.
interface ISettledArtworkSource {
    struct Record {
        bool settled;
        uint256 artworkId;
        address creator;
        address firstCollector;
        string metadataURI;
    }

    function nftSettlement(uint256 auctionId) external view returns (Record memory);
    function isMarketplaceAllowed(address operator) external view returns (bool);
    function marketplaceApprovalGeneration(address operator) external view returns (uint256);
}

/// @notice Ordinary artworks issued by a single auction engine after settlement.
contract SettledArtworkNFT is ERC721, IERC2981 {
    uint96 public constant CANONICAL_ROYALTY_BPS = 550;
    ISettledArtworkSource public immutable core;
    uint256 public totalSupply;
    mapping(uint256 => uint256) public artworkToToken;
    mapping(uint256 => uint256) public auctionToToken;
    mapping(uint256 => uint256) public tokenToArtwork;
    mapping(uint256 => address) public tokenCreator;
    mapping(uint256 => address) public firstCollector;
    mapping(uint256 => uint256) public transferEpoch;
    mapping(uint256 => string) private _metadataURIs;
    mapping(uint256 => uint256) private _coreTokenRevocations;
    mapping(address => uint256) private _coreOperatorRevocations;
    // Generation one is stored as zero so a first-generation grant needs no extra nonzero storage slot.
    mapping(uint256 => uint256) private _tokenGrantGenerationMinusOne;
    mapping(address => mapping(address => uint256)) private _operatorGrantGenerationMinusOne;

    error UnauthorizedCore();
    error InvalidSettlement();
    error AlreadyIssued();
    error MarketplaceNotAllowed(address operator);

    event SettledArtworkIssued(uint256 indexed auctionId, uint256 indexed artworkId, uint256 indexed tokenId,
        address creator, address firstCollector);

    constructor() ERC721("ArtSoul NFT", "ARTSOUL") {
        core = ISettledArtworkSource(msg.sender);
    }

    function mintSettled(uint256 auctionId) external returns (uint256 tokenId) {
        if (msg.sender != address(core)) revert UnauthorizedCore();
        if (auctionId == 0) revert InvalidSettlement();
        if (auctionToToken[auctionId] != 0) revert AlreadyIssued();
        ISettledArtworkSource.Record memory record = core.nftSettlement(auctionId);
        if (!record.settled || record.artworkId == 0 || record.creator == address(0) ||
            record.firstCollector == address(0) || bytes(record.metadataURI).length == 0) revert InvalidSettlement();
        if (artworkToToken[record.artworkId] != 0) revert AlreadyIssued();

        tokenId = ++totalSupply;
        artworkToToken[record.artworkId] = tokenId;
        auctionToToken[auctionId] = tokenId;
        tokenToArtwork[tokenId] = record.artworkId;
        tokenCreator[tokenId] = record.creator;
        firstCollector[tokenId] = record.firstCollector;
        _metadataURIs[tokenId] = record.metadataURI;
        emit SettledArtworkIssued(auctionId, record.artworkId, tokenId, record.creator, record.firstCollector);
        _safeMint(record.firstCollector, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _metadataURIs[tokenId];
    }

    function royaltyInfo(uint256 tokenId, uint256 salePrice) external view returns (address, uint256) {
        address creator = tokenCreator[tokenId];
        if (creator == address(0)) return (address(0), 0);
        return (creator, Math.mulDiv(salePrice, CANONICAL_ROYALTY_BPS, 10_000));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }

    function _activeGrantGeneration(address operator) private view returns (uint256) {
        uint256 generation = core.marketplaceApprovalGeneration(operator);
        if (generation == 0) revert MarketplaceNotAllowed(operator);
        return generation - 1;
    }

    function setApprovalForAll(address operator, bool approved) public override {
        if (approved) _operatorGrantGenerationMinusOne[msg.sender][operator] = _activeGrantGeneration(operator);
        super.setApprovalForAll(operator, approved);
        if (operator == address(core) && !approved) ++_coreOperatorRevocations[msg.sender];
    }

    /// @notice Identifies the current owner's uninterrupted permission for a Core sale.
    function resaleAuthorization(uint256 tokenId, address seller) external view returns (bytes32) {
        address engine = address(core);
        if (seller == address(0) || _ownerOf(tokenId) != seller) return bytes32(0);
        if (_getApproved(tokenId) != engine && !isApprovedForAll(seller, engine)) return bytes32(0);
        return keccak256(abi.encode(seller, transferEpoch[tokenId], _coreTokenRevocations[tokenId], _coreOperatorRevocations[seller]));
    }

    function _approve(address to, uint256 tokenId, address auth, bool emitEvent) internal override {
        if (to != address(0)) _tokenGrantGenerationMinusOne[tokenId] = _activeGrantGeneration(to);
        // ERC-721 also clears token approval during transfers, including a self-transfer.
        if (to != address(core) && (super._getApproved(tokenId) == address(core) || (emitEvent && to == address(0)))) {
            ++_coreTokenRevocations[tokenId];
        }
        super._approve(to, tokenId, auth, emitEvent);
    }

    function isApprovedForAll(address owner, address operator) public view override returns (bool) {
        return super.isApprovedForAll(owner, operator) &&
            core.marketplaceApprovalGeneration(operator) == _operatorGrantGenerationMinusOne[owner][operator] + 1;
    }

    function _getApproved(uint256 tokenId) internal view override returns (address) {
        address operator = super._getApproved(tokenId);
        if (operator == address(0) || core.marketplaceApprovalGeneration(operator) != _tokenGrantGenerationMinusOne[tokenId] + 1) {
            return address(0);
        }
        return operator;
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && from != to) ++transferEpoch[tokenId];
    }
}
