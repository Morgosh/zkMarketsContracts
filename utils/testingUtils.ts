import { expect } from "chai"

export async function expectRejectedWithMessage(promise: Promise<any>, message: string, log: boolean = false) {
    try {
      if(log) console.log("running promise")
      const tx = await promise // Wait for transaction submission
      await tx.wait() // Wait for transaction confirmation
      console.log(`Expected to be rejected with message: ${message}`)
      throw new Error(`Expected to be rejected`)
    } catch (error: any) {
      if(log) console.log("promise is caught with message", error.message)
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