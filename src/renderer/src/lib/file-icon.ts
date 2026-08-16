import {
  File,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileText,
  type LucideIcon
} from 'lucide-react'

const EXTENSION_ICON: Record<string, LucideIcon> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  mjs: FileCode,
  css: FileCode,
  py: FileCode,
  sh: FileCode,
  json: FileJson,
  md: FileText,
  mdx: FileText,
  txt: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  svg: FileImage,
  webp: FileImage,
  gif: FileImage,
  toml: FileCog,
  yaml: FileCog,
  yml: FileCog,
  env: FileCog,
  config: FileCog
}

const FILENAME_ICON: Record<string, LucideIcon> = {
  dockerfile: FileCog,
  makefile: FileCog,
  '.env': FileCog,
  '.gitignore': FileCog
}

export function resolveFileIcon(label: string): LucideIcon {
  const normalized = label.toLowerCase()

  if (FILENAME_ICON[normalized]) {
    return FILENAME_ICON[normalized]
  }

  const segments = normalized.split('.')
  if (segments.length > 2) {
    const compound = segments.slice(-2).join('.')
    if (EXTENSION_ICON[compound]) {
      return EXTENSION_ICON[compound]
    }
  }

  const extension = segments.length > 1 ? segments[segments.length - 1] : ''
  return EXTENSION_ICON[extension] ?? File
}
