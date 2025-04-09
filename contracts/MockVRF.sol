// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Interface for consumers to implement
interface VRFConsumer {
    function fulfillRandomness(bytes32 requestId, uint256 randomness) external;
}

contract MockVRF {
    event RandomnessRequested(bytes32 indexed requestId, address indexed requester);
    event RandomnessFulfilled(bytes32 indexed requestId, uint256 randomness);
    
    // Request randomness and immediately fulfill it
    function requestRandomness(address consumer) external returns (bytes32, uint256) {
        bytes32 requestId = keccak256(abi.encodePacked(
            consumer,
            block.timestamp,
            block.prevrandao,
            blockhash(block.number - 1)
        ));
        
        uint256 randomness = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            blockhash(block.number - 1),
            requestId
        )));
        
        emit RandomnessRequested(requestId, consumer);
        
        // Immediately fulfill
        VRFConsumer(consumer).fulfillRandomness(requestId, randomness);
        
        emit RandomnessFulfilled(requestId, randomness);
        
        return (requestId, randomness);
    }
    
    // Generate randomness (mock implementation)
    function generateRandomNumber(uint256 max) external view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            blockhash(block.number - 1)
        ))) % max;
    }
    
    // Generate randomness with provided seed (mock implementation)
    function generateRandomNumberWithSeed(uint256 max, uint256 seed) external view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            msg.sender,
            blockhash(block.number - 1),
            seed
        ))) % max;
    }
} 