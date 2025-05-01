// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract ECRecoverTest {
    // Recover the signer address from a signature
    function recover(bytes32 hash, uint8 v, bytes32 r, bytes32 s) public pure returns (address) {
        // Direct call to ecrecover
        return ecrecover(hash, v, r, s);
    }
    
    // Directly use a signature in bytes format
    function recoverFromSignature(bytes32 hash, bytes memory signature) public pure returns (address) {
        if (signature.length != 65) {
            revert("Invalid signature length");
        }
        
        bytes32 r;
        bytes32 s;
        uint8 v;
        
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        
        return ecrecover(hash, v, r, s);
    }
} 