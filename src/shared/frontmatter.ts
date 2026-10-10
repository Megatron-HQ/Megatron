import { isAlias, isCollection, isPair, parseDocument } from 'yaml'

const MAX_FRONTMATTER_BYTES = 256 * 1024
const MAX_FRONTMATTER_NODES = 10_000
const MAX_FRONTMATTER_DEPTH = 32
const MAX_ALIAS_COUNT = 100
const MAX_METADATA_BYTES = 256 * 1024
const encoder = new TextEncoder()

export class FrontmatterLimitError extends Error {}

function byteLength(text: string): number {
  return encoder.encode(text).length
}

export function parseBoundedFrontmatter(block: string): unknown {
  if (block.length > MAX_FRONTMATTER_BYTES || byteLength(block) > MAX_FRONTMATTER_BYTES)
    throw new FrontmatterLimitError('Frontmatter exceeds the size limit')
  const document = parseDocument(block)
  if (document.errors.length > 0) throw document.errors[0]
  const pending: { node: unknown; depth: number }[] = [{ node: document.contents, depth: 0 }]
  let nodes = 0
  let aliases = 0
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!
    if (++nodes > MAX_FRONTMATTER_NODES || depth > MAX_FRONTMATTER_DEPTH)
      throw new FrontmatterLimitError('Frontmatter exceeds the structure limit')
    if (isAlias(node) && ++aliases > MAX_ALIAS_COUNT)
      throw new FrontmatterLimitError('Frontmatter contains too many aliases')
    if (isCollection(node)) {
      if (node.items.length + pending.length > MAX_FRONTMATTER_NODES)
        throw new FrontmatterLimitError('Frontmatter exceeds the structure limit')
      for (const item of node.items) pending.push({ node: item, depth: depth + 1 })
    } else if (isPair(node)) {
      pending.push({ node: node.key, depth: depth + 1 }, { node: node.value, depth: depth + 1 })
    }
  }
  return document.toJS({ maxAliasCount: MAX_ALIAS_COUNT })
}

export function stringifyBoundedMetadata(value: unknown): string {
  let bytes = 0
  let nodes = 0
  const ancestors = new Set<object>()
  const consume = (amount: number): void => {
    bytes += amount
    if (bytes > MAX_METADATA_BYTES)
      throw new FrontmatterLimitError('Expanded metadata exceeds the size limit')
  }
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > MAX_FRONTMATTER_NODES || depth > MAX_FRONTMATTER_DEPTH)
      throw new FrontmatterLimitError('Expanded metadata exceeds the structure limit')
    if (item === null || typeof item !== 'object') {
      const encoded = JSON.stringify(item)
      if (encoded !== undefined) consume(byteLength(encoded))
      return
    }
    if (ancestors.has(item)) throw new TypeError('Metadata contains a cyclic alias')
    ancestors.add(item)
    consume(2)
    const entries = Object.entries(item)
    for (const [key, child] of entries) {
      consume(1)
      if (!Array.isArray(item)) consume(byteLength(JSON.stringify(key)) + 1)
      visit(child, depth + 1)
    }
    ancestors.delete(item)
  }
  visit(value, 0)
  return JSON.stringify(value)
}
