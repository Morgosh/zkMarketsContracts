// To run use
//HARDHAT_CONFIG=hardhat.coverage.config.ts npx hardhat coverage --testfiles "test/MoodyArchives.test.ts,test/Staking.test.ts"



import { HardhatUserConfig } from "hardhat/config"
import "@nomicfoundation/hardhat-ethers"
// No zkSync plugins — solidity-coverage needs standard solc
import * as dotenv from "dotenv"
import 'solidity-coverage';

dotenv.config({ path: ".env" })

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    "hardhat": {},
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
}

export default config
