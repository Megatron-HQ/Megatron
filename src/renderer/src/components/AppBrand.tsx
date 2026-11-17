import appIcon from '../../../../build/icon-source/icon-small.svg'

export function AppBrand(): React.JSX.Element {
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 px-4">
      <img
        src={appIcon}
        alt=""
        width={24}
        height={24}
        className="size-6 shrink-0"
        draggable={false}
      />
      <span className="text-sm font-semibold">Megatron</span>
    </div>
  )
}
