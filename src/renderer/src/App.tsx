import { useState } from 'react'
import { BentoGrid } from './components/bento/BentoGrid'
import { HeartbeatWidget } from './components/bento/widgets/HeartbeatWidget'
import { HeroWidget } from './components/bento/widgets/HeroWidget'
import { LinterWidget } from './components/bento/widgets/LinterWidget'
import { MCPWidget } from './components/bento/widgets/MCPWidget'
import { PartnersBar } from './components/bento/widgets/PartnersBar'
import { RolesWidget } from './components/bento/widgets/RolesWidget'
import { SkillsWidget } from './components/bento/widgets/SkillsWidget'
import { SourceMixWidget } from './components/bento/widgets/SourceMixWidget'
import { StoriesBar } from './components/bento/widgets/StoriesBar'
import { TopologyWidget } from './components/bento/widgets/TopologyWidget'
import { WordmarkWidget } from './components/bento/widgets/WordmarkWidget'

function App(): React.JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const expand = (id: string) => () => setExpandedId(id)
  const close = (): void => setExpandedId(null)

  return (
    <div className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-canvas p-4 text-white md:p-5">
      <div className="grain pointer-events-none fixed inset-0 z-30 opacity-[0.045] mix-blend-overlay" />
      <BentoGrid className="min-h-0 flex-1">
        <HeroWidget
          className="area-hero"
          enterDelay={0}
          isExpanded={expandedId === 'hero'}
          onClick={expand('hero')}
          onClose={close}
        />
        <StoriesBar className="area-stories" />
        <WordmarkWidget
          className="area-wordmark"
          enterDelay={0.05}
          isExpanded={expandedId === 'wordmark'}
          onClick={expand('wordmark')}
          onClose={close}
        />
        <LinterWidget
          className="area-linter"
          enterDelay={0.07}
          isExpanded={expandedId === 'linter'}
          onClick={expand('linter')}
          onClose={close}
        />
        <MCPWidget
          className="area-mcp"
          enterDelay={0.08}
          isExpanded={expandedId === 'mcp'}
          onClick={expand('mcp')}
          onClose={close}
        />
        <RolesWidget
          className="area-agents"
          enterDelay={0.1}
          isExpanded={expandedId === 'roles'}
          onClick={expand('roles')}
          onClose={close}
        />
        <HeartbeatWidget
          className="area-pulse"
          enterDelay={0.12}
          isExpanded={expandedId === 'heartbeat'}
          onClick={expand('heartbeat')}
          onClose={close}
        />
        <SourceMixWidget
          className="area-sources"
          enterDelay={0.13}
          isExpanded={expandedId === 'sources'}
          onClick={expand('sources')}
          onClose={close}
        />
        <TopologyWidget
          className="area-topology"
          enterDelay={0.14}
          isExpanded={expandedId === 'topology'}
          onClick={expand('topology')}
          onClose={close}
        />
        <SkillsWidget
          className="area-skills"
          enterDelay={0.16}
          isExpanded={expandedId === 'skills'}
          onClick={expand('skills')}
          onClose={close}
        />
        <PartnersBar
          className="area-partners"
          enterDelay={0.18}
          isExpanded={expandedId === 'partners'}
          onClick={expand('partners')}
          onClose={close}
        />
      </BentoGrid>
    </div>
  )
}

export default App
