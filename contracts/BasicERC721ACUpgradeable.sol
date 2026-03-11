// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "erc721a-upgradeable/contracts/ERC721AUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/common/ERC2981Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @notice Minimal ICreatorToken interface for marketplace compatibility
interface ICreatorToken {
    event TransferValidatorUpdated(address oldValidator, address newValidator);
    function getTransferValidator() external view returns (address validator);
    function setTransferValidator(address validator) external;
    function getTransferValidationFunction() external view returns (bytes4 functionSignature, bool isViewFunction);
}

/// @notice Minimal ITransferValidator interface to call the external validator
interface ITransferValidator {
    function validateTransfer(address caller, address from, address to, uint256 tokenId) external view;
}

/// @title BasicERC721AC
/// @notice Upgradeable ERC721A with ERC2981 royalties and ICreatorToken transfer validation.
/// @dev UUPS proxy pattern. No limitbreak dependency — implements ICreatorToken directly.
contract BasicERC721ACUpgradeable is ERC721AUpgradeable, OwnableUpgradeable, ERC2981Upgradeable, UUPSUpgradeable, ICreatorToken {
    using SafeERC20 for IERC20;

    // ------------------------------
    // Storage (append-only for upgrades)
    // ------------------------------
    string private _baseTokenURI;
    string private _contractURI;
    mapping(address => bool) public authorizedMinters;
    address private _transferValidator;

    // ------------------------------
    // Events
    // ------------------------------
    event AuthorizedMinterUpdated(address indexed minter, bool allowed);

    // ------------------------------
    // Initializer (replaces constructor)
    // ------------------------------
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address royaltyReceiver_,
        uint96 royaltyFeeNumerator_,
        string memory name_,
        string memory symbol_,
        string memory baseTokenURI_
    ) external initializerERC721A initializer {
        __ERC721A_init(name_, symbol_);
        __Ownable_init();
        __ERC2981_init();
        __UUPSUpgradeable_init();

        _setDefaultRoyalty(royaltyReceiver_, royaltyFeeNumerator_);
        _baseTokenURI = baseTokenURI_;
        _contractURI = "";
    }

    // ------------------------------
    // UUPS
    // ------------------------------
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ------------------------------
    // ICreatorToken
    // ------------------------------
    function getTransferValidator() external view override returns (address) {
        return _transferValidator;
    }

    function setTransferValidator(address validator) external override onlyOwner {
        address oldValidator = _transferValidator;
        _transferValidator = validator;
        emit TransferValidatorUpdated(oldValidator, validator);
    }

    function getTransferValidationFunction() external pure override returns (bytes4 functionSignature, bool isViewFunction) {
        functionSignature = bytes4(keccak256("validateTransfer(address,address,address,uint256)"));
        isViewFunction = true;
    }

    // ------------------------------
    // Transfer validation hook
    // ------------------------------
    function _beforeTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal virtual override {
        if (_transferValidator != address(0) && from != address(0)) {
            for (uint256 i = 0; i < quantity;) {
                ITransferValidator(_transferValidator).validateTransfer(msg.sender, from, to, startTokenId + i);
                unchecked { ++i; }
            }
        }
    }

    // ------------------------------
    // supportsInterface
    // ------------------------------
    function supportsInterface(bytes4 interfaceId)
        public view virtual override(ERC721AUpgradeable, ERC2981Upgradeable)
        returns (bool)
    {
        return
            interfaceId == type(ICreatorToken).interfaceId ||
            ERC721AUpgradeable.supportsInterface(interfaceId) ||
            ERC2981Upgradeable.supportsInterface(interfaceId);
    }

    // ------------------------------
    // Royalties
    // ------------------------------
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) public onlyOwner {
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) public onlyOwner {
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    // ------------------------------
    // Metadata
    // ------------------------------
    function _baseURI() internal view virtual override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string memory baseTokenURI_) public onlyOwner {
        _baseTokenURI = baseTokenURI_;
    }

    function contractURI() public view returns (string memory) {
        return _contractURI;
    }

    function setContractURI(string memory contractURI_) public onlyOwner {
        _contractURI = contractURI_;
    }

    // ------------------------------
    // Minting
    // ------------------------------
    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "Arrays length mismatch");
        require(recipients.length > 0, "Empty arrays");

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Cannot mint to zero address");
            require(amounts[i] > 0, "Amount must be greater than 0");
            _mint(recipients[i], amounts[i]);
        }
    }

    /// @notice Mint tokens from an authorized contract (e.g. TokenClaim)
    /// @param _to The receiver of the tokens
    /// @param _tokenId Ignored for ERC721A (sequential IDs), kept for interface compatibility
    /// @param _quantity Number of tokens to mint
    function authorizedMint(address _to, uint256 _tokenId, uint256 _quantity) external {
        require(authorizedMinters[msg.sender], "Not authorized minter");
        // _tokenId is unused — ERC721A assigns sequential IDs
        _mint(_to, _quantity);
    }

    /// @notice Add or remove an authorized minter
    /// @param minter The minter address
    /// @param allowed Whether the minter is allowed
    function setAuthorizedMinter(address minter, bool allowed) external onlyOwner {
        require(minter != address(0), "Invalid minter");
        authorizedMinters[minter] = allowed;
        emit AuthorizedMinterUpdated(minter, allowed);
    }

    // ------------------------------
    // Withdrawals
    // ------------------------------
    function withdraw() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        (bool success, ) = payable(owner()).call{value: balance}("");
        require(success, "ETH withdrawal failed");
    }

    function withdrawERC20(address token) external onlyOwner {
        require(token != address(0), "Invalid token address");

        IERC20 erc20Token = IERC20(token);
        uint256 balance = erc20Token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        erc20Token.safeTransfer(owner(), balance);
    }

    function withdrawERC721(address token, uint256 tokenId) external onlyOwner {
        require(token != address(0), "Invalid token address");
        IERC721(token).safeTransferFrom(address(this), owner(), tokenId);
    }

    /// @notice Allow contract to receive ETH
    receive() external payable {}
}
