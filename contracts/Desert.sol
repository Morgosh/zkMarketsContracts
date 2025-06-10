// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Strings.sol";

contract Desert {
    using Strings for uint256;

    string public areaName = "Desert";
    string public creator = "Desert Nomad";
    uint256 public totalSupply = 750;

    mapping(address => mapping(uint256 => uint256)) private spiceBalances;

    function action1() external {}
    function action2() external {}
    function action3() external {}

    function sendCaravan(uint256 caravanId, uint256 destination) external {}

    function claimOasis(uint256 oasisId) external payable {}

    function harvestSpices(uint256 spiceType, uint256 quantity) external {
        spiceBalances[msg.sender][spiceType] += quantity;
    }

    function getSpiceBalance(address player, uint256 spiceType) external view returns (uint256) {
        return spiceBalances[player][spiceType];
    }

    function exploreLocation(uint256[] calldata coordinates)
        external
        view
        returns (bool discovered, uint256 treasureFound)
    {
        uint256 hash = uint256(keccak256(abi.encodePacked(coordinates, msg.sender, block.timestamp)));
        discovered = (hash % 2 == 0);
        treasureFound = (hash % 100) + 1;
    }

    function calculateTravelCost(uint256 distance)
        external
        view
        returns (uint256 waterCost, uint256 goldCost)
    {
        uint256 randomness = uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 10;
        waterCost = distance * (10 + randomness);
        goldCost = distance * (5 + (randomness / 2));
    }

    function playerLevel() public view returns (uint256) {
        return (uint256(keccak256(abi.encodePacked(block.timestamp, msg.sender))) % 500) + 1;
    }

    function getInfo() external view returns (
        string memory name,
        string memory creatorName,
        uint256 supply,
        uint256 level
    ) {
        return (areaName, creator, totalSupply, playerLevel());
    }

    function descriptionHTML() external view returns (string memory) {
        uint256 level = playerLevel();

        return string(
            abi.encodePacked(
                "<div>",
                "<h1>Golden Dunes Collection</h1>",
                "<p><strong>Creator:</strong> ", creator, "</p>",
                "<p><strong>Total Supply:</strong> ", totalSupply.toString(), "</p>",
                "<p><strong>Area Level:</strong> ", level.toString(), "</p>",
                "<p>An endless expanse collection featuring golden sand dunes and ancient ruins. ",
                "These NFTs contain the mysteries of hidden oases and dancing mirages.</p>",
                "</div>"
            )
        );
    }
}
