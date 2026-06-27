// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

contract ArtSoulProjectNFT is ERC721, Ownable2Step {
    uint256 public constant MAX_SUPPLY = 100;

    uint256 public currentDistributed;

    address public core;

    string public baseURI;
    string public contractMetadataURI;

    mapping(address => bool) public hasMintedGenesis;
    mapping(address => uint256) public userGenesisToken;
    mapping(uint256 => bytes32) public tokenEligibilityHash;
    mapping(uint256 => address[]) public ownershipHistory;
    mapping(uint256 => uint256[]) public ownershipTimestamps;

    error InvalidAddress();
    error UnauthorizedCore();
    error GenesisSoldOut();
    error GenesisAlreadyMinted();
    error InvalidEligibilityHash();
    error NonexistentToken();

    event CoreUpdated(address indexed core);

    event GenesisNFTAwarded(
        uint256 indexed tokenId,
        address indexed winner,
        uint256 indexed auctionId,
        bytes32 eligibilityHash
    );

    event GenesisNFTTransferred(
        uint256 indexed tokenId,
        address indexed from,
        address indexed to
    );

    modifier onlyCore() {
        if (msg.sender != core) revert UnauthorizedCore();
        _;
    }

    modifier notSoldOut() {
        if (currentDistributed >= MAX_SUPPLY) revert GenesisSoldOut();
        _;
    }

    constructor()
        ERC721("ArtSoul Genesis", "SOUL-GENESIS")
        Ownable(msg.sender)
    {}

    function setCore(address _core) external onlyOwner {
        if (_core == address(0)) revert InvalidAddress();
        core = _core;

        emit CoreUpdated(_core);
    }

    function awardToWinner(
        address winner,
        uint256 auctionId,
        bytes32 eligibilityHash
    ) external onlyCore notSoldOut returns (uint256) {
        if (winner == address(0)) revert InvalidAddress();
        if (eligibilityHash == bytes32(0)) revert InvalidEligibilityHash();
        if (hasMintedGenesis[winner]) revert GenesisAlreadyMinted();

        currentDistributed++;

        uint256 tokenId = currentDistributed;

        hasMintedGenesis[winner] = true;
        userGenesisToken[winner] = tokenId;
        tokenEligibilityHash[tokenId] = eligibilityHash;

        _mint(winner, tokenId);

        emit GenesisNFTAwarded(tokenId, winner, auctionId, eligibilityHash);

        return tokenId;
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address previousOwner = super._update(to, tokenId, auth);

        if (to != address(0) && to != previousOwner) {
            ownershipHistory[tokenId].push(to);
            ownershipTimestamps[tokenId].push(block.timestamp);

            emit GenesisNFTTransferred(tokenId, previousOwner, to);
        }

        return previousOwner;
    }

    function getOwnershipHistory(
        uint256 tokenId
    )
        external
        view
        returns (address[] memory owners, uint256[] memory timestamps)
    {
        return (
            ownershipHistory[tokenId],
            ownershipTimestamps[tokenId]
        );
    }

    function setBaseURI(string calldata _baseURI) external onlyOwner {
        baseURI = _baseURI;
    }

    function setContractURI(string calldata uri) external onlyOwner {
        contractMetadataURI = uri;
    }

    function contractURI() external view returns (string memory) {
        return contractMetadataURI;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert NonexistentToken();

        return string(
            abi.encodePacked(baseURI, _toString(tokenId), ".json")
        );
    }

    function _toString(
        uint256 value
    ) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }

        uint256 temp = value;
        uint256 digits;

        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);

        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }

        return string(buffer);
    }
}
