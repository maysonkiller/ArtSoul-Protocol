// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract ArtSoulNFT is ERC721URIStorage, ERC2981, Ownable2Step {
    uint96 public constant CANONICAL_ROYALTY_BPS = 750; // 7.5%

    uint256 public totalSupply;

    address public core;

    mapping(uint256 => uint256) public artworkToToken;
    mapping(uint256 => uint256) public tokenToArtwork;
    mapping(uint256 => address) public tokenCreator;

    error InvalidAddress();
    error InvalidArtwork();
    error InvalidMetadata();
    error UnauthorizedCore();
    error ArtworkAlreadyMinted();

    event CoreUpdated(address indexed core);
    event CanonicalArtworkMinted(
        uint256 indexed tokenId,
        uint256 indexed artworkId,
        address indexed creator,
        address owner,
        string tokenURI
    );

    modifier onlyCore() {
        if (msg.sender != core) revert UnauthorizedCore();
        _;
    }

    constructor() ERC721("ArtSoul NFT", "ARTSOUL") Ownable(msg.sender) {
        _setDefaultRoyalty(msg.sender, CANONICAL_ROYALTY_BPS);
    }

    function setCore(address _core) external onlyOwner {
        if (_core == address(0)) revert InvalidAddress();
        core = _core;

        emit CoreUpdated(_core);
    }

    function setRoyaltyReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        _setDefaultRoyalty(receiver, CANONICAL_ROYALTY_BPS);
    }

    function mint(
        address to,
        string calldata uri,
        uint256 artworkId,
        address creator
    ) external onlyCore returns (uint256) {
        if (to == address(0)) revert InvalidAddress();
        if (creator == address(0)) revert InvalidAddress();
        if (artworkId == 0) revert InvalidArtwork();
        if (bytes(uri).length == 0) revert InvalidMetadata();
        if (artworkToToken[artworkId] != 0) revert ArtworkAlreadyMinted();

        totalSupply++;

        uint256 tokenId = totalSupply;

        _mint(to, tokenId);
        _setTokenURI(tokenId, uri);

        artworkToToken[artworkId] = tokenId;
        tokenToArtwork[tokenId] = artworkId;
        tokenCreator[tokenId] = creator;
        _setTokenRoyalty(tokenId, creator, CANONICAL_ROYALTY_BPS);

        emit CanonicalArtworkMinted(tokenId, artworkId, creator, to, uri);

        return tokenId;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
