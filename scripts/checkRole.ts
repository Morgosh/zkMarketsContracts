import { keccak256, toUtf8Bytes } from "ethers"

const role = keccak256(toUtf8Bytes("MINTER_ROLE"))
console.log(role) // 0xd5391393fc0a2c3b885521c2a5e143ac70c5d60cf29da88f52d5f217f73152d6
