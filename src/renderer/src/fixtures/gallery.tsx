// The page the fixture runner (scripts/fixtures/) drives, and a person can open with
// `npm run fixtures -- serve`. With `?id=` it mounts that one fixture; without, it lists them all.

// Must stay the first import. App modules read window.api while they load (OnboardingDialog reads
// window.api.platform at module scope), so the fake has to exist before any of them is evaluated.
import { unfaked } from './fake-api'
import '../assets/main.css'

import { StrictMode, type CSSProperties, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createProjectLabelResolver } from '@/lib/project-tree'
import { ProjectLabelContext } from '@/lib/use-project-label'
import { WINDOW_SIZE } from '../../../shared/window-size'
import App from '../App'
import type { Fixture, FixtureUser, Frame, Target } from './define'

type InputStep =
  | { action: 'click' | 'hover'; target: unknown }
  | { action: 'until'; target: unknown; message: string }
  | { action: 'press'; key: string }
  | { action: 'type'; text: string }

interface FixtureIndex {
  sizes: typeof WINDOW_SIZE
  list: { id: string; platform?: string }[]
  // Fixture files that failed to load, so one broken file does not hide the rest.
  failed: { file: string; message: string }[]
}

declare global {
  interface Window {
    mount: (id: string) => Promise<void>
    unmount: () => void
    // Set when the page mounted a fixture from its URL; resolves once it has rendered and its
    // interact steps have finished.
    mounted?: Promise<void>
    fixtures?: Promise<FixtureIndex>
    fixtureErrors: string[]
    // Provided by the runner: performs one step with real browser input.
    fixtureInput?: (step: InputStep) => Promise<void>
  }
}

const WAIT_MS = 5_000
const modules = import.meta.glob<Record<string, Fixture>>('../**/*.fixture.tsx')
const host = document.getElementById('root')!
let root: Root | null = null

window.fixtureErrors = []

const theme = window.api.getInitialTheme()
document.documentElement.classList.toggle(
  'dark',
  theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
)

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function waitFor<T>(read: () => T | null | undefined, message: string): Promise<T> {
  const deadline = performance.now() + WAIT_MS
  for (;;) {
    const value = read()
    if (value) return value
    if (performance.now() > deadline) throw new Error(message)
    await new Promise(requestAnimationFrame)
  }
}

// A failed query retries three times with a growing delay, which would hold an error state back
// for seven seconds. The retries still happen; they just do not wait.
function queryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
}

interface Place {
  // Class names of the slot's ancestors, outermost first.
  ancestors: string[]
  slotClass: string
  style: CSSProperties
}

// Mounts the real app once, reads where it puts the slot, and unmounts it. The fixture is then
// rendered at that rectangle, inside boxless copies of the slot's ancestors so the CSS variables
// and inherited styles those ancestors set (the frame's own neutrals, for one) still apply.
async function measure(frame: Exclude<Frame, 'window'>): Promise<Place> {
  const readSection = window.api.getInitialSection
  window.api.getInitialSection = () => frame.section
  const measuring = createRoot(host)
  try {
    measuring.render(
      <QueryClientProvider client={queryClient()}>
        <App />
      </QueryClientProvider>
    )
    const slot = await waitFor(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-screen]')].find(
          (element) => (element.closest('main') !== null) === (frame.slot === 'sheet')
        ),
      `The app rendered no ${frame.slot} slot for the ${frame.section} section.`
    )
    const rect = slot.getBoundingClientRect()
    const ancestors: string[] = []
    let background = ''
    for (let element = slot.parentElement; element; element = element.parentElement) {
      const color = getComputedStyle(element).backgroundColor
      if (background === '' && color !== 'rgba(0, 0, 0, 0)') background = color
      if (host.contains(element) && element !== host) ancestors.unshift(element.className)
    }
    return {
      ancestors,
      slotClass: slot.className,
      style: {
        position: 'fixed',
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        background
      }
    }
  } finally {
    measuring.unmount()
    window.api.getInitialSection = readSection
    // The measuring mount called the default fake, not the fixture's.
    unfaked.length = 0
  }
}

function framed(place: Place, body: ReactNode): ReactNode {
  const slot = (
    <div data-fixture-frame className={place.slotClass} style={place.style}>
      {body}
    </div>
  )
  const boxless = place.ancestors.reduceRight<ReactNode>(
    (child, className) => (
      <div className={className} style={{ display: 'contents' }}>
        {child}
      </div>
    ),
    slot
  )
  return (
    <TooltipProvider>
      <ProjectLabelContext.Provider value={createProjectLabelResolver(new Map())}>
        {boxless}
      </ProjectLabelContext.Provider>
    </TooltipProvider>
  )
}

// A RegExp does not survive the trip to the runner, so it travels as its source and flags.
function encode(target: Target): unknown {
  return Object.fromEntries(
    Object.entries(target).map(([key, value]) => [
      key,
      value instanceof RegExp ? { source: value.source, flags: value.flags } : value
    ])
  )
}

function user(input: NonNullable<Window['fixtureInput']>): FixtureUser {
  return {
    click: (target) => input({ action: 'click', target: encode(target) }),
    hover: (target) => input({ action: 'hover', target: encode(target) }),
    press: (key) => input({ action: 'press', key }),
    type: (text) => input({ action: 'type', text }),
    async until(condition, message) {
      if (typeof condition !== 'function') {
        return input({ action: 'until', target: encode(condition), message })
      }
      await waitFor(condition, message)
    }
  }
}

async function load(id: string): Promise<Fixture> {
  const cut = id.lastIndexOf('/')
  const module = await modules[`../${id.slice(0, cut)}.fixture.tsx`]?.()
  const found = module?.[id.slice(cut + 1)]
  if (!found) throw new Error(`There is no fixture "${id}".`)
  return found
}

window.unmount = () => {
  root?.unmount()
  root = null
}

window.mount = async (id) => {
  window.unmount()
  window.fixtureErrors.length = 0
  try {
    const fixture = await load(id)
    const place = fixture.frame === 'window' ? null : await measure(fixture.frame)
    Object.assign(window.api, fixture.api)
    const Body = fixture.render
    root = createRoot(host)
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient()}>
          {place ? framed(place, <Body />) : <Body />}
        </QueryClientProvider>
      </StrictMode>
    )
    await new Promise(requestAnimationFrame)
    // Only the runner can supply real input; a browser opened by hand shows the state before it.
    if (fixture.interact && window.fixtureInput) await fixture.interact(user(window.fixtureInput))
  } catch (error) {
    window.fixtureErrors.push(describe(error))
  }
  for (const name of new Set(unfaked)) {
    window.fixtureErrors.push(
      `window.api.${name} was called but this fixture gives it no data. Add it to the fixture's api.`
    )
  }
}

async function index(): Promise<FixtureIndex> {
  const result: FixtureIndex = { sizes: WINDOW_SIZE, list: [], failed: [] }
  for (const [path, importModule] of Object.entries(modules)) {
    const file = path.slice('../'.length, -'.fixture.tsx'.length)
    try {
      for (const [name, fixture] of Object.entries(await importModule())) {
        result.list.push({ id: `${file}/${name}`, platform: fixture.platform })
      }
    } catch (error) {
      result.failed.push({ file: `${file}.fixture.tsx`, message: describe(error) })
    }
  }
  result.list.sort((first, second) => first.id.localeCompare(second.id))
  return result
}

const id = new URLSearchParams(location.search).get('id')
if (id) {
  window.mounted = window.mount(id)
} else {
  window.fixtures = index()
  void window.fixtures.then(({ list, failed }) => {
    createRoot(host).render(
      <main className="h-screen overflow-auto bg-background p-6 text-sm">
        <h1 className="mb-1 font-semibold">Fixtures · {list.length}</h1>
        <p className="mb-4 text-muted-foreground">
          Add <code>&amp;theme=dark</code> or <code>&amp;platform=win32</code> to a link. Steps that
          need input (hover, click) run only under <code>npm run fixtures -- shot</code>.
        </p>
        {failed.map(({ file, message }) => (
          <p key={file} className="text-destructive">
            {file}: {message}
          </p>
        ))}
        <ul className="space-y-1 font-mono text-xs">
          {list.map((entry) => (
            <li key={entry.id}>
              <a
                className="underline underline-offset-2"
                href={`?id=${encodeURIComponent(entry.id)}`}
              >
                {entry.id}
              </a>
            </li>
          ))}
        </ul>
      </main>
    )
  })
}
