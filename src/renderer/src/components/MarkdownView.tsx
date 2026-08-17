import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resolveInternalLink, splitFrontmatter } from '@/lib/markdown'
import { cn } from '@/lib/utils'
import type { SkillFile } from '../../../shared/ipc'

interface MarkdownViewProps {
  content: string
  currentPath: string
  files: SkillFile[]
  onSelectFile: (relativePath: string) => void
}

function isBlockCode(className: string | undefined, children: unknown): boolean {
  if (className?.includes('language-')) return true
  const text = typeof children === 'string' ? children : ''
  return text.includes('\n')
}

export function MarkdownView({
  content,
  currentPath,
  files,
  onSelectFile
}: MarkdownViewProps): React.JSX.Element {
  const { body } = useMemo(() => splitFrontmatter(content), [content])

  const components = useMemo<Components>(
    () => ({
      h1: ({ children }) => (
        <h1 className="mt-6 mb-2 font-sans text-xl font-semibold text-foreground first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="mt-5 mb-2 font-sans text-base font-semibold text-foreground">{children}</h2>
      ),
      h3: ({ children }) => (
        <h3 className="mt-4 mb-1.5 font-sans text-sm font-semibold text-foreground">{children}</h3>
      ),
      h4: ({ children }) => (
        <h4 className="mt-4 mb-1.5 font-sans text-[13px] font-semibold text-foreground">
          {children}
        </h4>
      ),
      h5: ({ children }) => (
        <h5 className="mt-4 mb-1.5 font-sans text-[13px] font-semibold text-foreground">
          {children}
        </h5>
      ),
      h6: ({ children }) => (
        <h6 className="mt-4 mb-1.5 font-sans text-[13px] font-semibold text-foreground">
          {children}
        </h6>
      ),
      p: ({ children }) => (
        <p className="mb-3 font-sans text-[13px] leading-relaxed text-foreground">{children}</p>
      ),
      ul: ({ children }) => (
        <ul className="mb-3 list-disc space-y-1 pl-5 font-sans text-[13px] leading-relaxed text-foreground">
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol className="mb-3 list-decimal space-y-1 pl-5 font-sans text-[13px] leading-relaxed text-foreground">
          {children}
        </ol>
      ),
      blockquote: ({ children }) => (
        <blockquote className="mb-3 border-l-2 border-border pl-4 text-[13px] text-muted-foreground">
          {children}
        </blockquote>
      ),
      hr: () => <hr className="my-4 border-border" />,
      a: ({ href, children }) => {
        const internalTarget = href ? resolveInternalLink(currentPath, href, files) : null
        return (
          <a
            href={href}
            className="text-foreground underline decoration-muted-foreground underline-offset-2 hover:decoration-foreground"
            onClick={(event) => {
              event.preventDefault()
              if (internalTarget) {
                onSelectFile(internalTarget)
              } else if (href && /^https?:/i.test(href)) {
                window.api.openExternal(href)
              }
            }}
          >
            {children}
          </a>
        )
      },
      pre: ({ children }) => (
        <pre className="mb-3 overflow-x-auto rounded-md border border-border bg-muted p-3">
          {children}
        </pre>
      ),
      code: ({ className, children }) => {
        if (isBlockCode(className, children)) {
          return (
            <code className="block whitespace-pre font-mono text-xs text-foreground">
              {children}
            </code>
          )
        }
        return (
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            {children}
          </code>
        )
      },
      table: ({ children }) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse border border-border text-[13px]">
            {children}
          </table>
        </div>
      ),
      th: ({ children }) => (
        <th className="border border-border bg-muted px-2 py-1 text-left font-sans text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border border-border px-2 py-1 align-top">{children}</td>
      ),
      img: ({ alt }) => (
        <span className="mb-3 inline-block rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground">
          {alt || 'image'}
        </span>
      )
    }),
    [currentPath, files, onSelectFile]
  )

  return (
    <div className={cn('max-w-[72ch]')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </div>
  )
}
