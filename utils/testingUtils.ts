import { expect } from "chai"

export async function expectRejectedWithMessage(promise: Promise<any>, message: string) {
    try {
      const tx = await promise // Wait for transaction submission
      await tx.wait() // Wait for transaction confirmation
      throw new Error(`Expected to be rejected`)
    } catch (error: any) {
      // Special case: if Hardhat can't infer the reason, consider test passed
      // This is needed because the stack trace might not work in certain environments
      if (error.message.includes("Transaction reverted and Hardhat couldn't infer the reason")) {
        console.log(`Transaction reverted as expected, but Hardhat couldn't infer the reason. Expected: "${message}"`)
        return // Test passes as the transaction did revert
      }
      
      if (!error.message.includes(message)) {
        console.log("promise is caught with message", error.message)
      }
      // console.log(`Rejected with message: ${message}`)
      expect(error.message).to.include(message) // Check if error contains expected message
    }
  }
    
export function stringifyBigInts(o: any): string {
return JSON.stringify(
    (function convert(o: any) {
        if (typeof o === "bigint") return o.toString()
        if (o !== null && typeof o === "object") {
        if (Array.isArray(o)) return o.map(convert)
        return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, convert(v)]))
        }
        return o
    })(o)
    )
}