// import { expect } from "chai";
// import { ethers } from "ethers";
// import { deployContract } from "../utils/utils";

// describe("Signature Malleability", function () {
//   // Group order value of Secp256k1 curve
//   // https://github.com/bmancini55/bitcoin-ecc/blob/df048235cdc89c4dd9cd253310637061ed17f5e8/lib/Secp256k1.ts#L7
//   const groupOrder = "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141";

//   it("Should test if NootLadder rejects non-canonical signatures", async function() {
//     // Deploy test contracts
//     const nootToken = await deployContract("ERC20Template", ["Test Token", "TEST"]);
//     const signerWallet = new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32)));
//     const playerWallet = new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32)));
    
//     const nootLadder = await deployContract("NootLadder", [
//       await nootToken.getAddress(),
//       await signerWallet.getAddress(),
//       100n, // minWager
//       10000n // maxWager
//     ]);
    
//     // First, deploy a test contract that can do raw ecrecover
//     const ecrecoverTester = await deployContract("ECRecoverTest", []);
    
//     // Setup test parameters
//     const gameId = 12345n;
//     const playerAddress = await playerWallet.getAddress();
//     const turnNumber = 1;
    
//     // Create message hash as the contract would
//     const messageHash = ethers.keccak256(
//       ethers.solidityPacked(
//         ["uint256", "address", "uint8"],
//         [gameId, playerAddress, turnNumber]
//       )
//     );
    
//     // Create the Ethereum signed message hash
//     const ethSignedMessageHash = ethers.hashMessage(ethers.getBytes(messageHash));
    
//     // Sign the message
//     const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
//     const sig = ethers.Signature.from(signature);
    
//     console.log("Signature details:");
//     console.log("r:", sig.r);
//     console.log("s:", sig.s);
//     console.log("v:", sig.v);
    
//     // Create non-canonical signature (high s-value)
//     const halfOrder = ethers.toBigInt(groupOrder) / 2n;
//     const canonicalS = ethers.toBigInt(sig.s);
//     const nonCanonicalS = ethers.toBigInt(groupOrder) - canonicalS;
//     const flippedV = sig.v === 27 ? 28 : 27;
    
//     console.log("\nS value comparison:");
//     console.log("Canonical s:", canonicalS.toString());
//     console.log("Non-canonical s:", nonCanonicalS.toString());
//     console.log("Half order:", halfOrder.toString());
    
//     // Verify canonical and non-canonical s values
//     expect(canonicalS < halfOrder).to.be.true; // ethers generates canonical signatures
//     expect(nonCanonicalS > halfOrder).to.be.true;
    
//     // Create the non-canonical signature bytes
//     const nonCanonicalSignature = ethers.concat([
//       ethers.zeroPadValue(sig.r, 32),
//       ethers.zeroPadValue('0x' + nonCanonicalS.toString(16), 32),
//       new Uint8Array([flippedV])
//     ]);
    
//     // If the ECRecoverTest contract is available, use it to directly show
//     // that both signatures recover to the same address
//     if (ecrecoverTester) {
//       // Get signer from canonical signature
//       const recoveredFromCanonical = await ecrecoverTester.recover(
//         ethSignedMessageHash, sig.v, sig.r, sig.s
//       );
      
//       // Get signer from non-canonical signature
//       const recoveredFromNonCanonical = await ecrecoverTester.recover(
//         ethSignedMessageHash, flippedV, sig.r, '0x' + nonCanonicalS.toString(16)
//       );
      
//       console.log("\nECRECOVER DEMONSTRATION:");
//       console.log("Signer wallet address:", await signerWallet.getAddress());
//       console.log("Recovered from canonical signature:", recoveredFromCanonical);
//       console.log("Recovered from non-canonical signature:", recoveredFromNonCanonical);
      
//       // THIS IS THE KEY POINT: Both signatures recover to the same address!
//       expect(recoveredFromCanonical).to.equal(await signerWallet.getAddress());
//       expect(recoveredFromNonCanonical).to.equal(await signerWallet.getAddress());
//       expect(recoveredFromCanonical).to.equal(recoveredFromNonCanonical);
      
//       console.log("\nTHIS DEMONSTRATES THE MALLEABILITY PROBLEM:");
//       console.log("Both the canonical and non-canonical signatures recover to the SAME address!");
//       console.log("Without s-value validation, an attacker could create alternative valid signatures");
//     } else {
//       console.log("\nECRecoverTest contract not available. Skipping direct ecrecover demonstration.");
//     }
    
//     // Verify the canonical signature works with the contract
//     const canonicalResult = await nootLadder.verifySignature(
//       gameId, playerAddress, turnNumber, signature
//     );
//     console.log("\nVerification results with NootLadder contract:");
//     console.log("Canonical signature verification:", canonicalResult);
//     expect(canonicalResult).to.be.true;
    
//     // Check if the contract accepts non-canonical signatures by flipping both s and v
//     try {
//       const nonCanonicalResult = await nootLadder.verifySignature(
//         gameId, playerAddress, turnNumber, nonCanonicalSignature
//       );
//       console.log("Non-canonical signature verification (s flipped, v flipped):", nonCanonicalResult);
      
//       // If we get here, the contract didn't properly reject the signature
//       console.log("\nWARNING: Contract accepts non-canonical signatures!");
//       console.log("This means signature malleability is possible.");
//       console.log("Recommendation: Add s-value validation in _splitSignature.");
      
//       // This should fail - the contract should reject non-canonical signatures
//       expect(nonCanonicalResult).to.be.false;
//     } catch (e: any) {
//       // This is the expected behavior! The contract should revert
//       console.log("Contract correctly rejected non-canonical signature with error:", e.message.slice(0, 100) + "...");
//       expect(e.message).to.include("NootLadder: non-canonical signature");
//       console.log("\nSUCCESS: Contract is protected against signature malleability!");
//     }
    
//     // Let's also test with only v flipped (should fail)
//     const onlyVFlippedSignature = ethers.concat([
//       ethers.zeroPadValue(sig.r, 32),
//       ethers.zeroPadValue(sig.s, 32),
//       new Uint8Array([flippedV])
//     ]);
    
//     const vFlippedResult = await nootLadder.verifySignature(
//       gameId, playerAddress, turnNumber, onlyVFlippedSignature
//     );
//     console.log("V-flipped signature verification (s same, v flipped):", vFlippedResult);
//     expect(vFlippedResult).to.be.false; // Should fail
    
//     // Now for s-flipped only (should fail)
//     const onlySFlippedSignature = ethers.concat([
//       ethers.zeroPadValue(sig.r, 32),
//       ethers.zeroPadValue('0x' + nonCanonicalS.toString(16), 32),
//       new Uint8Array([sig.v])
//     ]);
    
//     // This will revert if the contract strictly validates canonical signatures
//     try {
//       const sFlippedResult = await nootLadder.verifySignature(
//         gameId, playerAddress, turnNumber, onlySFlippedSignature
//       );
//       console.log("S-flipped signature verification (s flipped, v same):", sFlippedResult);
      
//       // If we get here, the contract accepted a non-canonical signature!
//       console.log("WARNING: Contract accepted a signature with non-canonical s-value!");
//       expect(sFlippedResult).to.be.false; // It should at least return false
//     } catch (e: any) {
//       // This is good! The contract is rejecting non-canonical signatures
//       console.log("Contract correctly rejected s-flipped signature with error:", e.message.slice(0, 100) + "...");
//       expect(e.message).to.include("NootLadder: non-canonical signature");
//     }
//   });
// }); 