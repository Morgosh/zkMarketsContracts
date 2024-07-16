import { MerkleTree } from "merkletreejs"
import keccak256 from "keccak256"
// import { saveOrUpdate } from "../../dapp/backend/functions"
// import { MerkleProof } from "../../dapp/backend/src/entity"

export function getRootHash(merkleTree: MerkleTree) {
  const rootHashStringified = "0x" + merkleTree.getRoot().toString("hex")
  return rootHashStringified
}
export function getLeafNodes(addresses: string[]) {
  return addresses.map(address => keccak256(address.toLowerCase()))
}

export function getProof(address: string, merkleTree: MerkleTree) {
  const hashedAddress = keccak256(address.toLowerCase())
  const proof = merkleTree.getHexProof(hashedAddress)
  return proof
}

export function verifyMerkleProof(addresses: string[], address: string, proof: string[]): boolean {
  const hashedAddress = keccak256(address.toLowerCase())
  const leafNodes = getLeafNodes(addresses)
  const merkleTree = new MerkleTree(leafNodes, keccak256, { sortPairs: true })
  const root = merkleTree.getRoot()
  const isValid = merkleTree.verify(proof, hashedAddress, root)

  return isValid
}

// export async function uploadMerkleProofs(appDataSource: any, collectionAddress: string, tier: number, merkleTree: MerkleTree, addresses: string[]): Promise<void> {
//   const lowerCaseAddresses = addresses.map(address => address.toLowerCase())
//   console.log("address length", addresses.length)
//   for (const address of lowerCaseAddresses) {
//     const proof = getProof(address, merkleTree)
//     const isValid = verifyMerkleProof(lowerCaseAddresses, address, proof)
//     console.log(`Merkle proof for address ${address} in tier ${tier} is ${isValid ? "valid" : "invalid"}`)

//     // console.log("proof", proof)
//     const proofStringified = JSON.stringify(proof)
//     // console.log("proofStringified", proofStringified)

//     const data = {
//       userAddress: address,
//       proof: proofStringified,
//       tier,
//       collectionAddress,
//     }

//     try {
//       // db.collection("merkleProofs").doc(collectionAddress).collection("proofs").doc(address).set(proofData);
//       saveOrUpdate(
//         appDataSource,
//         MerkleProof,
//         { userAddress: address, collectionAddress, tier },
//         data,
//       )
//       // appDataSource.getRepository("MerkleProof").save(proofData)
//       await new Promise(r => setTimeout(r, 100))
//       console.log(`Uploaded proof for address: ${address} in tier ${tier}`)// , proofData
//     }
//     catch (error) {
//       console.error(`Failed to upload proof for address: ${address} in tier ${tier}`, error)
//     }
//   }
// }
