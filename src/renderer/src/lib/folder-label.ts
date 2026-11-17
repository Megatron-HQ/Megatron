// The form people type in a shell on each platform; Windows paths match home in any letter case.
export function folderLabel(path: string, home: string, platform: string): string {
  const windows = platform === 'win32'
  const separator = windows ? '\\' : '/'
  const key = (value: string): string => (windows ? value.toLowerCase() : value)
  const prefix = windows ? '%USERPROFILE%' : '~'
  if (key(path) === key(home)) return prefix
  return key(path).startsWith(key(home) + separator) ? prefix + path.slice(home.length) : path
}
