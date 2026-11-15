// Held at the preview's final size, so the card does not jump when the user's data arrives.
export function PreviewSkeleton(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col gap-1.5" data-testid="whats-new-preview-loading">
      <div className="h-3 w-28 rounded-sm bg-muted" />
      {[0.8, 0.55, 0.35].map((width) => (
        <div key={width} className="h-7 rounded-sm bg-muted" style={{ width: `${width * 100}%` }} />
      ))}
    </div>
  )
}

export function SampleLabel(): React.JSX.Element {
  return (
    <span className="rounded-full border border-border px-1.5 text-[10px] leading-4 text-muted-foreground">
      Sample
    </span>
  )
}
