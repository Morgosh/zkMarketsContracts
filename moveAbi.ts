import fs from "fs"
import path from "path"

const contractsRootDir = path.join(__dirname, "./artifacts-zk/contracts")
const abiOutputDir = path.join(__dirname, "./abis")

if (!fs.existsSync(abiOutputDir)) {
  fs.mkdirSync(abiOutputDir)
}

// Detect diamond directory correctly
function isDiamondDirectory(dir: string): boolean {
  return path.basename(dir) === "diamond"
}

function extractAbisFromDir(dir: string, isDiamond: boolean, localAbis: any[] = []): void {
  fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
    if (err) {
      console.error(`Error reading contracts directory (${dir}):`, err)
      return
    }

    entries.forEach((entry) => {
      const entryPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Pass isDiamond as true if the current or any parent directory is diamond
        extractAbisFromDir(entryPath, isDiamond || isDiamondDirectory(entryPath), isDiamond ? localAbis : undefined)
      }
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        const contractJson = JSON.parse(fs.readFileSync(entryPath, "utf-8"))
        const abi = contractJson.abi

        if (!abi) {
          console.log(`ABI not found in ${entry.name}, skipping...`, "isDiamond", isDiamond)
          return
        }
        else {
          console.log(`ABI found in ${entry.name}`, "isDiamond", isDiamond)
        }

        if (isDiamond) {
          localAbis.push(abi)
        }
        // else if (!isDiamond && (localAbis === undefined || localAbis.length === 0)) {
        const abiFileName = entry.name.split(".")[0] + ".abi.json"
        const abiOutputPath = path.join(abiOutputDir, abiFileName)
        fs.writeFileSync(abiOutputPath, JSON.stringify(abi, null, 2), "utf-8")
        console.log(`ABI extracted: ${abiFileName}`)
        // }
      }
    })

    // Write the concatenated ABIs if in diamond directory
    if (isDiamond && localAbis.length > 0) {
      const concatenatedAbis = localAbis.flat()
      const diamondAbiFileName = "diamond.abi.json"
      const diamondAbiOutputPath = path.join(abiOutputDir, diamondAbiFileName)
      fs.writeFileSync(diamondAbiOutputPath, JSON.stringify(concatenatedAbis, null, 2), "utf-8")
      console.log(`Concatenated ABI for diamond contract saved: ${diamondAbiFileName}`)
    }
  })
}

// Start processing from the root directory
extractAbisFromDir(contractsRootDir, isDiamondDirectory(contractsRootDir))
