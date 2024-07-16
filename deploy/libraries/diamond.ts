import { ethers } from "ethers"
import { Contract, ethers as ethers6 } from "ethers"

// Define an enum for FacetCut actions
enum FacetCutAction {
  Add = 0,
  Replace = 1,
  Remove = 2,
}

// Interface for a contract with an ethers interface
interface ContractWithInterface {
  interface: ethers.Interface
}

// Define the type for function selectors
type Selectors = {
  contract: ContractWithInterface
  remove: (functionNames: string[]) => Selectors
  get: (functionNames: string[]) => Selectors
} & string[]

// Get function selectors from ABI
// function getSelectors(contract: ContractWithInterface): Selectors {
//   const signatures = Object.keys(contract.interface.functions);
//   const selectors = signatures.reduce((acc: string[], val) => {
//     if (val !== 'init(bytes)') {
//       acc.push(contract.interface.getSighash(val));
//     }
//     return acc;
//   }, [] as string[]);

//   const extendedSelectors: Selectors = selectors as Selectors;
//   extendedSelectors.contract = contract;
//   extendedSelectors.remove = remove;
//   extendedSelectors.get = get;
//   return extendedSelectors;
// }

function getSelectors(contract: Contract): string[] {
  // Assuming the interface and fragments are directly accessible as shown
  const iface = contract.interface

  // Calculate selectors from the function fragments
  const selectors = iface.fragments
    .filter(frag => frag.type === "function") // Ensure only function fragments are processed
    .map((fragment) => {
      const signature = fragment.format()
      const hash = ethers6.keccak256(ethers6.toUtf8Bytes(signature))
      const selector = ethers.dataSlice(hash, 0, 4)
      return {
        selector: selector,
      }
    })

  // Return only the selectors
  return selectors.map(v => v.selector)
}

// Get function selector from function signature
function getSelector(func: string): string {
  const abiInterface = new ethers.Interface([func])
  return abiInterface.getFunction(func)!.selector
}

// Used with getSelectors to remove selectors from an array of selectors
function remove(this: Selectors, functionNames: string[]): Selectors {
  const selectors = this.filter((v) => {
    for (const functionName of functionNames) {
      if (v === this.contract.interface.getFunction(functionName)?.selector) {
        return false
      }
    }
    return true
  })

  const extendedSelectors: Selectors = selectors as Selectors
  extendedSelectors.contract = this.contract
  extendedSelectors.remove = this.remove
  extendedSelectors.get = this.get
  return extendedSelectors
}

// Used with getSelectors to get selectors from an array of selectors
// function get(this: Selectors, functionNames: string[]): Selectors {
//   const selectors = this.filter((v) => {
//     for (const functionName of functionNames) {
//       if (v === this.contract.interface.getFunction(functionName)!.selector) {
//         return true;
//       }
//     }
//     return false;
//   });

//   const extendedSelectors: Selectors = selectors as Selectors;
//   extendedSelectors.contract = this.contract;
//   extendedSelectors.remove = this.remove;
//   extendedSelectors.get = this.get;
//   return extendedSelectors;
// }

// Remove selectors using an array of signatures
function removeSelectors(selectors: string[], signatures: string[]): string[] {
  const iface = new ethers.Interface(signatures.map(v => "function " + v))
  const removeSelectors = signatures.map(v => iface.getFunction(v)?.selector)
  return selectors.filter(v => !removeSelectors.includes(v))
}

// Find a particular address position in the return value of diamondLoupeFacet.facets()
function findAddressPositionInFacets(facetAddress: string, facets: { facetAddress: string }[]): number | undefined {
  for (let i = 0; i < facets.length; i++) {
    if (facets[i].facetAddress === facetAddress) {
      return i
    }
  }
}

export {
  getSelectors,
  getSelector,
  FacetCutAction,
  remove,
  removeSelectors,
  findAddressPositionInFacets,
}
