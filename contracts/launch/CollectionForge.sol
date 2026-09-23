// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IForgeIngredient {
    function ownerOf(uint256 tokenId) external view returns (address);
    function burnForForge(address holder, uint256 tokenId) external;
    function maxSupply() external view returns (uint32);
    function configurationLocked() external view returns (bool);
    function forge() external view returns (address);
    function paused() external view returns (bool);
}

/// @notice Separate output collection with immutable recipe and event ancestry.
/// @dev No Genesis promise or mint authority is created by this contract.
contract CollectionForge is ERC721, ERC2981, Ownable2Step, Pausable, ReentrancyGuard {
    IForgeIngredient public immutable ingredient;
    uint256 public immutable ingredientCount;
    uint256 public immutable maxSupply;
    bytes32 public immutable recipeId;
    uint256 public totalMinted;
    string private _metadataPrefix;
    mapping(uint256 => address) public forgedBy;

    error InvalidRecipe();
    error InvalidIngredients();
    error NotIngredientOwner();
    error SupplyExceeded();
    error LaunchUnavailable();
    event OriginCrafted(address indexed crafter, uint256 indexed forgedTokenId, uint256[] consumedTokenIds, bytes32 recipeId);

    constructor(
        string memory name_, string memory symbol_, string memory metadataPrefix_,
        address ingredient_, uint256 ingredientCount_, uint256 maxSupply_,
        bytes32 recipeId_, address owner_, address royaltyReceiver_, uint96 royaltyBps_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        if (ingredient_.code.length == 0 || ingredientCount_ < 2 || ingredientCount_ > 32
            || maxSupply_ == 0 || maxSupply_ > IForgeIngredient(ingredient_).maxSupply() / ingredientCount_
            || recipeId_ == bytes32(0) || bytes(metadataPrefix_).length == 0
            || royaltyReceiver_ == address(0) || royaltyBps_ > 10_000) revert InvalidRecipe();
        ingredient = IForgeIngredient(ingredient_);
        ingredientCount = ingredientCount_;
        maxSupply = maxSupply_;
        recipeId = recipeId_;
        _metadataPrefix = metadataPrefix_;
        _setDefaultRoyalty(royaltyReceiver_, royaltyBps_);
    }

    function craft(uint256[] calldata tokenIds, address recipient) external nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (!ingredient.configurationLocked() || ingredient.forge() != address(this) || ingredient.paused()) revert LaunchUnavailable();
        if (tokenIds.length != ingredientCount || recipient == address(0)) revert InvalidIngredients();
        if (totalMinted >= maxSupply) revert SupplyExceeded();
        for (uint256 i; i < tokenIds.length; ++i) {
            if (i != 0 && tokenIds[i] <= tokenIds[i - 1]) revert InvalidIngredients();
            if (ingredient.ownerOf(tokenIds[i]) != msg.sender) revert NotIngredientOwner();
        }
        tokenId = ++totalMinted;
        forgedBy[tokenId] = msg.sender;
        for (uint256 i; i < tokenIds.length; ++i) ingredient.burnForForge(msg.sender, tokenIds[i]);
        _safeMint(recipient, tokenId);
        emit OriginCrafted(msg.sender, tokenId, tokenIds, recipeId);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function _baseURI() internal view override returns (string memory) { return _metadataPrefix; }
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
