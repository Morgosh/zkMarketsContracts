// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SharedStorage} from "../../libraries/SharedStorage.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TransactFacet is ReentrancyGuard {
    using SafeERC20 for IERC20;

    event OrderFulfilled(bytes32 orderHash, address indexed nftReceiver, address indexed nftSeller, address indexed nftAddress, uint256 tokenId, uint8 orderType, uint256 price, uint256 platformFee);
    event OrderCanceled(bytes32 orderHash, address indexed offerer, uint8 orderType);
    event OrderCanceledAll(address indexed offerer, uint256 canceledAt);

    modifier whenNotPaused() {
        require(!SharedStorage.getStorage().paused, "Contract is paused");
        _;
    }

    struct Order {
        OrderParameters parameters;
        bytes signature;
    }

    uint256 private constant MAX_ROYALTY_PERCENTAGE = 1000;

    struct OrderParameters {
        address payable offerer;
        BasicOrderType orderType;
        Item offer;
        Item consideration;
        address payable royaltyReceiver;
        uint256 royaltyPercentageIn10000;
        uint256 startTime;
        uint256 endTime;
        uint256 createdTime; // useful for canceling all orders and can act as unique salt
    }

    enum ItemType {
        NFT,
        ERC20,
        ETH
    }

    enum BasicOrderType {
        ERC721_FOR_ETH,
        ERC20_FOR_ERC721,
        ERC20_FOR_ERC721_ANY
    }

    struct Item {
        ItemType itemType;
        address tokenAddress;
        uint256 identifier;
        uint256 amount;
    }

    string private constant _ORDER_PARAMETERS_TYPE = "OrderParameters(address offerer,uint8 orderType,Item offer,Item consideration,address royaltyReceiver,uint256 royaltyPercentageIn10000,uint256 startTime,uint256 endTime,uint256 createdTime)";
    string private constant _TEST_SUBSTRUCT_TYPE = "Item(uint8 itemType,address tokenAddress,uint256 identifier,uint256 amount)";
    bytes32 private constant _ORDER_PARAMETERS_TYPEHASH = keccak256(abi.encodePacked(_ORDER_PARAMETERS_TYPE, _TEST_SUBSTRUCT_TYPE));
    bytes32 private constant _TEST_SUBSTRUCT_TYPEHASH = keccak256(abi.encodePacked(_TEST_SUBSTRUCT_TYPE));

    // Creates a keccak256 hash of the order parameters structured according to EIP712 standards.
    function createOrderHash(OrderParameters memory orderParameters) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "\x19\x01", 
            getDomainSeparator(),
            keccak256(abi.encode(
                _ORDER_PARAMETERS_TYPEHASH,
                orderParameters.offerer,
                orderParameters.orderType,
                keccak256(abi.encode(
                    _TEST_SUBSTRUCT_TYPEHASH,
                    orderParameters.offer.itemType,
                    orderParameters.offer.tokenAddress,
                    orderParameters.offer.identifier,
                    orderParameters.offer.amount
                )),
                keccak256(abi.encode(
                    _TEST_SUBSTRUCT_TYPEHASH,
                    orderParameters.consideration.itemType,
                    orderParameters.consideration.tokenAddress,
                    orderParameters.consideration.identifier,
                    orderParameters.consideration.amount
                )),
                orderParameters.royaltyReceiver,
                orderParameters.royaltyPercentageIn10000,
                orderParameters.startTime,
                orderParameters.endTime,
                orderParameters.createdTime
            ))
        ));
    }

    // Calculates the EIP712 domain separator based on the contract's details.
    function getDomainSeparator() public view returns (bytes32) {
        //first set getStorage();
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        // Return the domain separator
        return keccak256(
            abi.encode(
                keccak256(abi.encodePacked("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
                keccak256(abi.encodePacked(ds.name)),
                keccak256(abi.encodePacked(ds.version)),
                ds.chainId,
                address(this)
            )
        );
    }

    // Returns the EIP712 domain details of the contract.
    function domain() external view returns (string memory name, string memory version, uint256 chainId, address verifyingContract) {
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        name = ds.name;
        version = ds.version;
        chainId = ds.chainId;
        verifyingContract = address(this);
    }

    // Allows an order creator to cancel their offchain order
    function cancelOrder(Order calldata order) external whenNotPaused {
        bytes32 orderHash = createOrderHash(order.parameters);
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        require(!ds.ordersClaimed[orderHash], "Order already claimed");

        require(order.parameters.offerer == msg.sender, "Only orderer can cancel order");

        ds.ordersClaimed[orderHash] = true;

        emit OrderCanceled(orderHash, order.parameters.offerer, uint8(order.parameters.orderType));
    }

    // Cancels all orders created before the current block timestamp
    function cancelAllOrders() external whenNotPaused {
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        ds.ordersCanceledAt[msg.sender] = block.timestamp;
        emit OrderCanceledAll(msg.sender, block.timestamp);
    }

    // Validates an order's signatures, timestamps, and state to ensure it can be executed.
    function validateOrder(Order memory order, bytes32 orderHash) public view returns (bool) {
        require(verifySignature(orderHash, order.signature, order.parameters.offerer), "Invalid signature or incorrect signer");
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        require(!ds.ordersClaimed[orderHash], "Order already claimed or canceled");
        require(ds.ordersCanceledAt[order.parameters.offerer] < order.parameters.createdTime, "Order is canceled");
        require(block.timestamp >= order.parameters.startTime, "Order is not started yet");
        require(block.timestamp <= order.parameters.endTime, "Order is expired");
        return true;
    }

    // Validates an order and claims it to prevent double-spending or reentrancy attacks.
    function validateOrderAndClaim(Order memory order, bytes32 orderHash, uint256 royaltyPercentageIn10000) internal returns (bool) {
        validateOrder(order, orderHash);
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        ds.ordersClaimed[orderHash] = true;
        // lets make max royalty percentage 10%
        order.parameters.royaltyPercentageIn10000 = royaltyPercentageIn10000 > MAX_ROYALTY_PERCENTAGE ? MAX_ROYALTY_PERCENTAGE : royaltyPercentageIn10000;
        return true;
    }

    
    // Accepts an order for processing and handles the necessary payments according to the order parameters.
    function acceptOrder(Order memory order, uint256 royaltyPercentageIn10000) external payable whenNotPaused nonReentrant {
        if(order.parameters.orderType == BasicOrderType.ERC721_FOR_ETH) {
            require(msg.value == order.parameters.consideration.amount, "Incorrect ETH value sent");
        }
        bytes32 orderHash = createOrderHash(order.parameters);
        validateOrderAndClaim(order, orderHash, royaltyPercentageIn10000);
        handlePayments(order.parameters, orderHash);
    }

    function batchAcceptOrder(Order[] memory orders, uint256[] memory royaltyPercentagesIn10000) external payable whenNotPaused nonReentrant {
        require(orders.length == royaltyPercentagesIn10000.length, "Orders and royalty percentages length mismatch");

        // msg.value should be total of all orders order.consideration.amount
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < orders.length; i++) {
            totalAmount += orders[i].parameters.consideration.amount;
        }
        require(msg.value == totalAmount, "Incorrect ETH value sent");

        // batch works only for ERC721_FOR_ETH orders
        for (uint256 i = 0; i < orders.length; i++) {
            require(orders[i].parameters.orderType == BasicOrderType.ERC721_FOR_ETH, "Invalid order type");
            bytes32 orderHash = createOrderHash(orders[i].parameters);
            validateOrderAndClaim(orders[i], orderHash, royaltyPercentagesIn10000[i]);
            handlePayments(orders[i].parameters, orderHash);
        }
    }

    // Similar to acceptOrder, but specifically designed to handle collection offers where the exact NFT may not initially be specified.
    function acceptCollectionOffer(Order memory order, uint256 royaltyPercentageIn10000, uint256 nftIdentifier) external whenNotPaused nonReentrant {
        bytes32 orderHash = createOrderHash(order.parameters);
        validateOrderAndClaim(order, orderHash, royaltyPercentageIn10000);
        require(order.parameters.orderType == BasicOrderType.ERC20_FOR_ERC721_ANY, "Invalid order type");

        // since we have identifier we can now replace ERC20_FOR_ERC721_ANY with ERC20_FOR_ERC721 and set the identifier
        order.parameters.orderType = BasicOrderType.ERC20_FOR_ERC721;
        order.parameters.consideration.identifier = nftIdentifier;

        handlePayments(order.parameters, orderHash);
    }

    // Handles the distribution of payments between the parties involved in a transaction including royalties and platform fees.
    function handlePayments(OrderParameters memory order, bytes32 orderHash) internal {
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        uint256 platformFeePercentageIn10000 = ds.platformFee;

        uint256 amount = order.orderType == BasicOrderType.ERC721_FOR_ETH ? order.consideration.amount : order.offer.amount;
        uint256 defaultPlatformCut;
        uint256 platformCut = defaultPlatformCut = amount * platformFeePercentageIn10000 / 10000;
        uint256 royaltyCut = amount * order.royaltyPercentageIn10000 / 10000;
        uint256 ethRemainder = amount - royaltyCut - defaultPlatformCut;

        uint256 nftIdentifier = order.orderType == BasicOrderType.ERC721_FOR_ETH ? order.offer.identifier : order.consideration.identifier;
        address nftAddress = order.orderType == BasicOrderType.ERC721_FOR_ETH ? order.offer.tokenAddress : order.consideration.tokenAddress;
        address nftSender = order.orderType == BasicOrderType.ERC721_FOR_ETH ? order.offerer : msg.sender;
        address nftReceiver = order.orderType == BasicOrderType.ERC721_FOR_ETH ?  msg.sender : order.offerer;
        uint256 takerDiscount = defaultPlatformCut * getUserPremiumDiscount(msg.sender) / 10000;
        uint256 offererDiscount = defaultPlatformCut * getUserPremiumDiscount(order.offerer) / 10000;
        
        if(order.orderType == BasicOrderType.ERC721_FOR_ETH) {
            if (defaultPlatformCut > 0 && takerDiscount > 0) {
                //seller should not be impacted by taker premium discount
                platformCut -= takerDiscount;
                (bool success,) = payable(msg.sender).call{value: takerDiscount}("");
                require(success);
            }
            if (defaultPlatformCut > 0 && offererDiscount > 0) {
                platformCut -= offererDiscount;
                ethRemainder += offererDiscount;
            }
            
            (bool successRoyalty,) = payable(order.royaltyReceiver).call{value: royaltyCut}("");
            (bool successEthRemainder,) = payable(order.offerer).call{value: ethRemainder}("");
            require(successRoyalty && successEthRemainder);
        } else if(order.orderType == BasicOrderType.ERC20_FOR_ERC721) {
            if (defaultPlatformCut > 0 && takerDiscount > 0) {
                platformCut -= takerDiscount;
                ethRemainder += takerDiscount;
            }
            if (defaultPlatformCut > 0 && offererDiscount > 0) {
                platformCut -= offererDiscount;
            }
            if (royaltyCut > 0 && order.royaltyReceiver != address(0)) {
                IERC20(order.offer.tokenAddress).safeTransferFrom(order.offerer, order.royaltyReceiver, royaltyCut);
            }
            if (platformCut > 0) {
                IERC20(order.offer.tokenAddress).safeTransferFrom(order.offerer, address(this), platformCut);
            }

            IERC20(order.offer.tokenAddress).safeTransferFrom(order.offerer, msg.sender, ethRemainder);
        } else {
            revert("Invalid order type");
        }

        IERC721(nftAddress).transferFrom(nftSender, nftReceiver, nftIdentifier);

        emit OrderFulfilled(orderHash, nftReceiver, nftSender, nftAddress, nftIdentifier, uint8(order.orderType), amount, platformCut);
    }

    // Checks if an address is a contract, which is useful for validating smart contract interactions.
    function isContract(address account) internal view returns (bool) {
        uint256 size;
        assembly { size := extcodesize(account) }
        return size > 0;
    }

    // Determines if a user holds a premium NFT, which might grant them special privileges or discounts.
    function getUserPremiumDiscount(address user) public view returns (uint256) {
        SharedStorage.Storage storage ds = SharedStorage.getStorage();
        address premiumAddress = ds.premiumAddress;
        if (premiumAddress == address(0) || IERC721(premiumAddress).balanceOf(user) == 0) {
            return 0;
        }
        return ds.premiumDiscount;
    }

    // Verifies a signature against a hash and signer, supporting both EOA and contract accounts.
    function verifySignature(bytes32 fullHash, bytes memory _signature, address signer) public view returns (bool) {
        if (isContract(signer)) {
            bytes4 magicValue = IERC1271(signer).isValidSignature(fullHash, _signature);
            return magicValue == 0x1626ba7e;
        }
        address recoveredSigner = ECDSA.recover(fullHash, _signature);
        return recoveredSigner == signer;
    }
}
