import { ethers } from "ethers";
import hre from "hardhat";

const provider = new ethers.BrowserProvider(hre.network.provider as any);

export async function createMintSignature(
  approver: any,
  contract: any,
  user: string,
  saleId: number,
  endTime: number,
  maxMint: number,
  pricePerToken: bigint
) {
  // Fetch contract name dynamically
  const contractName = await contract.name();
  const network = await provider.getNetwork();
  const contractAddress = await contract.getAddress();
  
  const domain = {
    name: contractName,
    version: "1",
    chainId: Number(network.chainId),
    verifyingContract: contractAddress
  };

  const types = {
    Mint: [
      { name: "user", type: "address" },
      { name: "saleId", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "maxMint", type: "uint256" },
      { name: "pricePerToken", type: "uint256" }
    ]
  };

  const value = {
    user: user,
    saleId: Number(saleId),
    endTime: Number(endTime),
    maxMint: Number(maxMint),
    pricePerToken: pricePerToken.toString()
  };

  return await approver.signTypedData(domain, types, value);
}
