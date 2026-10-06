import { readFileSync } from "node:fs"

/** The JSON chunk of a .glb (names of clips, nodes…), read without decoding any buffer. */
export function glbJson(path: string): {
  animations?: { name: string }[]
  nodes?: { name?: string }[]
} {
  const bytes = readFileSync(path)
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a glb`)
  const length = bytes.readUInt32LE(12)
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path}: first chunk is not JSON`)
  return JSON.parse(bytes.subarray(20, 20 + length).toString("utf8"))
}
