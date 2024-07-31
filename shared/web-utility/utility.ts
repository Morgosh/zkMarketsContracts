import { ethers } from "ethers"

export function maxBigInt(...args: bigint[]): bigint {
  if (args.length === 0) {
    throw new Error("At least one argument is required")
  }
  return args.reduce((max, current) => (current > max ? current : max))
}

export function minBigInt(...args: bigint[]): bigint {
  if (args.length === 0) {
    throw new Error("At least one argument is required")
  }
  return args.reduce((min, current) => (current < min ? current : min))
}

export function customJsonStringify(obj: any) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === "bigint" ? value.toString() : value
  )
}