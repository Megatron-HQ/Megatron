import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Circle, CircleAlert, FolderPlus, Info, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getFolderBasename } from '@/lib/source-name'
import { useUsageProjects } from '@/lib/use-usage-projects'
import { cn } from '@/lib/utils'
import { isSuggestableFolder } from '../../../../shared/grant-suggestions'
import { isWithinProjectPath, normalizeProjectPath } from '../../../../shared/project-path'
import type { AllowedPathRow, SkillRow, SkippedGrant } from '../../../../shared/ipc'
import { CountUp } from './CountUp'
import { StepHeading } from './StepHeading'

export const LIME_BUTTON = 'bg-accent-lime text-accent-lime-foreground hover:bg-accent-lime/90'

interface OnboardingFolderStepProps {
  folders: AllowedPathRow[]
  skills: SkillRow[]
  home: string
  onAddFolders: () => Promise<SkippedGrant[]>
}

export function OnboardingFolderStep({
  folders,
  skills,
  home,
  onAddFolders
}: OnboardingFolderStepProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const { data: catalog, resolveProjectLabel } = useUsageProjects()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [skipped, setSkipped] = useState<SkippedGrant[]>([])
  const granted = folders.length > 0

  // Every recorded location, not only ungranted ones, so a row stays put and ticks over when a
  // grant covers it. A folder nested inside another listed one (Claude Code run from a repo's
  // subfolder) folds into its parent.
  const rows = useMemo(() => {
    const candidates = (catalog?.locations ?? []).filter((location) =>
      isSuggestableFolder(location.path, home)
    )
    return candidates
      .filter(
        (location) =>
          !candidates.some(
            (other) =>
              normalizeProjectPath(other.path) !== normalizeProjectPath(location.path) &&
              isWithinProjectPath(location.path, other.path)
          )
      )
      .map((location) => ({ path: location.path, label: resolveProjectLabel(location.path) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [catalog, home, resolveProjectLabel])

  async function choose(): Promise<void> {
    if (pending) return
    setPending(true)
    setError(false)
    setSkipped([])
    try {
      setSkipped(await onAddFolders())
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <StepHeading
        title={
          rows.length > 0 ? (
            <>
              You&apos;ve used Claude Code in <CountUp value={rows.length} />{' '}
              {rows.length === 1 ? 'folder' : 'folders'}
            </>
          ) : (
            'Add your projects'
          )
        }
      >
        Project skills and project plugins live inside your repos. Megatron only reads the folders
        you choose.
      </StepHeading>

      {rows.length > 0 && (
        <ul
          aria-label="Folders Claude Code has used"
          className="-mx-2 flex max-h-[max(7.5rem,calc(100vh-23rem))] flex-col overflow-y-auto"
        >
          {rows.map((row, index) => {
            const covered = folders.some((folder) => isWithinProjectPath(row.path, folder.path))
            const skillCount = covered
              ? skills.filter(
                  (skill) => skill.project_root && isWithinProjectPath(skill.project_root, row.path)
                ).length
              : 0
            return (
              <motion.li
                key={normalizeProjectPath(row.path)}
                layout={reduceMotion ? false : 'position'}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  type: 'spring',
                  stiffness: 420,
                  damping: 36,
                  delay: reduceMotion ? 0 : Math.min(index, 8) * 0.04
                }}
                className="flex h-9 shrink-0 items-center justify-between gap-3 rounded-md px-2"
              >
                <span title={row.path} className="min-w-0 truncate text-sm font-medium">
                  {row.label}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {covered ? (
                    <>
                      {skillCount > 0 && (
                        <span className="tabular-nums">
                          {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
                        </span>
                      )}
                      <motion.span
                        initial={reduceMotion ? false : { scale: 0.3, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 20 }}
                        className="flex size-4 items-center justify-center rounded-full bg-success text-background"
                      >
                        <Check className="size-3" strokeWidth={3} aria-hidden />
                      </motion.span>
                      <span className="sr-only">Granted</span>
                    </>
                  ) : (
                    <>
                      <span>Needs access</span>
                      <Circle className="size-4" aria-hidden />
                    </>
                  )}
                </span>
              </motion.li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant={granted ? 'outline' : 'default'}
          className={cn(!granted && LIME_BUTTON)}
          disabled={pending}
          aria-busy={pending}
          onClick={() => void choose()}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <FolderPlus className="size-4" />
          )}
          {granted ? 'Choose more…' : 'Choose folders…'}
        </Button>
        {skipped.length > 0 && (
          <div role="status" className="flex gap-2 text-xs text-muted-foreground">
            <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
            <ul className="min-w-0 space-y-0.5">
              {skipped.map((entry) => (
                <li key={entry.path} className="break-words">
                  {normalizeProjectPath(entry.path) === normalizeProjectPath(entry.coveredBy)
                    ? `${getFolderBasename(entry.path)} is already in the list.`
                    : `${getFolderBasename(entry.path)} is already included in ${getFolderBasename(entry.coveredBy)}.`}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            Could not add folders. Please try again.
          </p>
        )}
      </div>
    </div>
  )
}
