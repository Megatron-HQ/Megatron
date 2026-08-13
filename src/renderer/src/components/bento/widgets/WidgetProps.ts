export interface WidgetProps {
  isExpanded: boolean
  onClick: () => void
  onClose: () => void
  className?: string
  enterDelay?: number
}
