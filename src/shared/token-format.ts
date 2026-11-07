const TOKEN_FRACTION_DIGITS = 2
const compactTokens = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: TOKEN_FRACTION_DIGITS
})
const exactTokens = new Intl.NumberFormat('en-US')

function validateTokenCount(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid token count')
}

export function formatTokenCount(value: number): string {
  validateTokenCount(value)
  return compactTokens.format(value)
}

export function formatExactTokenCount(value: number): string {
  validateTokenCount(value)
  return exactTokens.format(value)
}
