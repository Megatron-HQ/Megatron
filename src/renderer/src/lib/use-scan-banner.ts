import { useEffect, useRef, useState } from 'react'
import type { ScanActivity, ScanSummary } from '../../../shared/ipc'
import {
  SCAN_BANNER_REVEAL_MS,
  preferScanSummary,
  resolveScanBanner,
  type ScanBannerState
} from '../../../shared/scan-banner'

export function useScanBanner(input: {
  skillsLoaded: boolean
  pluginsLoaded: boolean
  skillCount: number
  pluginCount: number
  reportedSummary: ScanSummary | undefined
  reportedActivity: ScanActivity | null | undefined
}): { banner: ScanBannerState; summary: ScanSummary | undefined } {
  const [scanRun, setScanRun] = useState<ScanActivity | null>(null)
  const [lock, setLock] = useState<{ id: number; message: string } | null>(null)
  const [finishedSummary, setFinishedSummary] = useState<ScanSummary | null>(null)
  const [now, setNow] = useState(0)
  const closedIds = useRef(new Set<number>())
  const activeId = useRef<number | null>(null)

  const reportedId = useRef<number | null>(null)

  function beginRun(activity: ScanActivity): void {
    if (closedIds.current.has(activity.id) || activeId.current === activity.id) return
    activeId.current = activity.id
    setFinishedSummary(null)
    setNow(Date.now())
    setScanRun(activity)
  }

  useEffect(
    () =>
      window.api.onScanStarted((activity) => {
        // A listSkills snapshot already names the run on screen. Ignore a different
        // start so a stale event cannot replace it before that snapshot updates.
        if (
          reportedId.current !== null &&
          activity.id !== reportedId.current &&
          activeId.current === reportedId.current
        ) {
          return
        }
        beginRun(activity)
      }),
    []
  )

  useEffect(
    () =>
      window.api.onScanComplete((finished) => {
        closedIds.current.add(finished.id)
        const finishingCurrent = activeId.current === finished.id
        if (finishingCurrent) activeId.current = null
        setScanRun((current) => (current?.id === finished.id ? null : current))
        if (activeId.current === null) setFinishedSummary(finished.summary)
      }),
    []
  )

  useEffect(() => {
    const activity = input.reportedActivity
    if (activity) reportedId.current = activity.id
    if (!activity) return
    const timer = window.setTimeout(() => beginRun(activity), 0)
    return () => window.clearTimeout(timer)
  }, [input.reportedActivity])

  useEffect(() => {
    if (!scanRun) return
    const delay = scanRun.startedAt + SCAN_BANNER_REVEAL_MS - Date.now()
    if (delay <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), delay)
    return () => window.clearTimeout(timer)
  }, [scanRun])

  const applicableLock = scanRun && lock?.id === scanRun.id ? lock.message : null
  const summary = scanRun
    ? input.reportedSummary
    : preferScanSummary(finishedSummary, input.reportedSummary)
  const decision = resolveScanBanner({
    scanning: scanRun !== null,
    elapsedMs: scanRun === null || now === 0 ? 0 : now - scanRun.startedAt,
    skillsLoaded: input.skillsLoaded,
    pluginsLoaded: input.pluginsLoaded,
    skillCount: input.skillCount,
    pluginCount: input.pluginCount,
    lockedMessage: applicableLock,
    hasPriorWarning: summary !== undefined && summary.outcome !== 'complete'
  })

  if (scanRun && decision.lockedMessage && decision.lockedMessage !== applicableLock) {
    setLock({ id: scanRun.id, message: decision.lockedMessage })
  } else if (!scanRun && lock !== null) {
    setLock(null)
  }

  return { banner: decision.state, summary }
}
