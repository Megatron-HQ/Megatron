import { join } from 'path'
import { readAllowedFile } from '../permissions'

const HEADER_BYTES = { sha1: 24, version2: 28 }
const BLOCK_HEADER_BYTES = 4
const HEAD = Buffer.from('HEAD')
const HEADS_PREFIX = 'refs/heads/'
const TABLE_NAME = /^[a-z0-9][a-z0-9._-]*\.(?:ref|log)$/i
const TABLE_LIST_MAX_BYTES = 64 * 1024
const MAX_HEAD_SEARCH_BYTES = 32 * 1024 * 1024

// The ref blocks are sorted. Stop at HEAD or the first greater name, leaving objects and logs unread.
// Format: https://git-scm.com/docs/reftable#_ref_block_format
function headInBlock(block: Buffer, hashBytes: number): string | null | false | undefined {
  const restartCount = block.readUInt16BE(block.length - 2)
  const end = block.length - 2 - 3 * restartCount
  let position = BLOCK_HEADER_BYTES
  if (restartCount === 0 || end <= position) return null
  let previous = Buffer.alloc(0)
  let previousLength = 0
  const varint = (): number => {
    let value = 0
    for (let i = 0; i < 10 && position < end; i++) {
      const byte = block[position++]
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
      value++
    }
    return NaN
  }
  while (position < end) {
    const prefixLength = varint()
    const suffixAndType = varint()
    const suffixLength = Math.floor(suffixAndType / 8)
    const nameLength = prefixLength + suffixLength
    if (!(prefixLength <= previousLength && position + suffixLength <= end && nameLength > 0))
      return null
    // A bounded prefix is enough to compare any key with HEAD, even for very long ref names.
    const prefix = previous.subarray(0, prefixLength)
    const suffix = block.subarray(
      position,
      position + Math.min(suffixLength, HEAD.length + 1 - prefix.length)
    )
    previous = Buffer.concat([prefix, suffix])
    previousLength = nameLength
    position += suffixLength
    if (Number.isNaN(varint())) return null
    const order = previous.compare(HEAD)
    if (order > 0) return false
    const type = suffixAndType % 8
    if (type === 3) {
      const length = varint()
      if (!(length > 0 && position + length <= end)) return null
      const target = block.toString('utf8', position, position + length)
      if (order === 0)
        return target.startsWith(HEADS_PREFIX) ? target.slice(HEADS_PREFIX.length) || null : null
      position += length
    } else {
      if (type > 2 || position + type * hashBytes > end || order === 0) return null
      position += type * hashBytes
    }
  }
  return undefined
}

// undefined means this table has no HEAD. null stops the lookup for detached, deleted, or unreadable HEAD.
function headInTable(path: string, header: Buffer): string | null | undefined {
  if (header.length < HEADER_BYTES.sha1 || header.toString('ascii', 0, 4) !== 'REFT') return null
  const version = header[4]
  if (version !== 1 && version !== 2) return null
  if (version === 2 && header.length < HEADER_BYTES.version2) return null
  const hash = version === 1 ? 'sha1' : header.toString('ascii', 24, 28)
  if (hash !== 'sha1' && hash !== 's256') return null
  const alignment = header.readUIntBE(5, 3)
  const fileHeaderBytes = version === 1 ? HEADER_BYTES.sha1 : HEADER_BYTES.version2
  let offset = fileHeaderBytes
  // shortcut: cap the leading ref scan at 32 MiB; use the ref index if this ever misses a real HEAD.
  while (offset < MAX_HEAD_SEARCH_BYTES) {
    const blockHeader = readAllowedFile(path, BLOCK_HEADER_BYTES, { offset }).contents
    if (blockHeader === null || blockHeader.length < BLOCK_HEADER_BYTES) return null
    if (blockHeader[0] !== 0x72) return undefined // 'r'
    const firstBlock = offset === fileHeaderBytes
    const length = blockHeader.readUIntBE(1, 3) - (firstBlock ? fileHeaderBytes : 0)
    if (length < BLOCK_HEADER_BYTES + 5) return null
    const block = readAllowedFile(path, length + 1, { offset }).contents
    if (block === null || block.length < length) return null
    const head = headInBlock(block.subarray(0, length), hash === 'sha1' ? 20 : 32)
    if (head === false) return undefined
    if (head !== undefined) return head
    const next = (firstBlock ? 0 : offset) + alignment
    offset = block[length] === 0 && next > offset + length ? next : offset + length
  }
  return null
}

export function readReftableHead(gitdir: string): string | null {
  const directory = join(gitdir, 'reftable')
  const list = join(directory, 'tables.list')
  // Compaction can remove a table between reading the list and opening it.
  for (let attempt = 0; attempt < 2; attempt++) {
    const stack = readAllowedFile(list, TABLE_LIST_MAX_BYTES).contents
    if (stack === null) return null
    let retry = false
    for (const name of stack.toString('utf8').trim().split(/\r?\n/).reverse()) {
      if (!TABLE_NAME.test(name)) return null
      const path = join(directory, name)
      const header = readAllowedFile(path, HEADER_BYTES.version2, { offset: 0 })
      if (header.status === 'missing') {
        retry = true
        break
      }
      if (header.contents === null) return null
      const head = headInTable(path, header.contents)
      if (head !== undefined) return head
    }
    if (!retry) return null
  }
  return null
}
