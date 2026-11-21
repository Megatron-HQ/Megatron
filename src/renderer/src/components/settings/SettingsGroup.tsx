import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle
} from '@/components/ui/field'

// DESIGN.md, Settings: a Section Header caption over one flat rule-line panel whose rows divide
// with rule-lines. A deep link focuses the caption by id; tabIndex -1 keeps it out of Tab order.
export function SettingsGroup({
  id,
  title,
  children
}: {
  id?: string
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <h3
          id={id}
          tabIndex={id ? -1 : undefined}
          className="scroll-mt-6 text-[13px] font-semibold outline-none"
        >
          {title}
        </h3>
      )}
      <div className="flex min-w-0 flex-col divide-y divide-border rounded-lg border border-border">
        {children}
      </div>
    </section>
  )
}

export function SettingRow({
  title,
  description,
  htmlFor,
  children
}: {
  title: React.ReactNode
  description?: React.ReactNode
  // Names the control the title labels, so clicking the title toggles it.
  htmlFor?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <Field orientation="horizontal" className="px-4 py-3">
      <FieldContent className="min-w-0 gap-0.5">
        {htmlFor ? (
          <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel>
        ) : (
          <FieldTitle>{title}</FieldTitle>
        )}
        {description && <FieldDescription className="text-xs">{description}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  )
}
