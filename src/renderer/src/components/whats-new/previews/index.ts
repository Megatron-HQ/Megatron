import type { ComponentType } from 'react'
import type { WhatsNewPreviewId } from '../../../../../shared/whats-new'
import { UsageSkillCostPreview } from './UsageSkillCostPreview'

// Keyed by the shared id union: an id added to WHATS_NEW_PREVIEW_IDS without a component here fails
// the web typecheck, and the catalog test rejects an id that isn't in the union.
export const WHATS_NEW_PREVIEWS: Record<WhatsNewPreviewId, ComponentType> = {
  'usage-skill-cost': UsageSkillCostPreview
}
