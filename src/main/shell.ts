const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

export function isSafeExternalUrl(raw: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(raw).protocol)
  } catch {
    return false
  }
}

export function openSafeExternal(raw: string, open: (url: string) => void): boolean {
  if (!isSafeExternalUrl(raw)) return false
  open(raw)
  return true
}
