'use client'

/**
 * components/AgentThoughtStream.tsx
 * Live "thought process" panel showing every step the agents take.
 * Uses React.memo to prevent re-rendering the full list on each new step.
 *
 * Color legend:
 *   orchestrator → purple
 *   analyst      → blue
 *   evaluator    → teal
 *
 *   tool-call    → amber
 *   tool-result  → green
 *   text         → slate
 *   handoff      → indigo
 */
import React, { useEffect, useRef, useState } from 'react'
import type { AgentStep } from '@/lib/types/agents'

// ---------------------------------------------------------------------------
// Sub-components (memoized individually)
// ---------------------------------------------------------------------------

const AGENT_STYLES: Record<AgentStep['agentName'], { badge: string; dot: string; border: string }> = {
  orchestrator: {
    badge: 'bg-purple-500/20 text-purple-300 border border-purple-500/30',
    dot: 'bg-purple-400',
    border: 'border-l-purple-500/50',
  },
  analyst: {
    badge: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    dot: 'bg-blue-400',
    border: 'border-l-blue-500/50',
  },
  evaluator: {
    badge: 'bg-teal-500/20 text-teal-300 border border-teal-500/30',
    dot: 'bg-teal-400',
    border: 'border-l-teal-500/50',
  },
}

const STEP_TYPE_STYLES: Record<AgentStep['stepType'], string> = {
  'tool-call': 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  'tool-result': 'bg-green-500/20 text-green-300 border border-green-500/30',
  text: 'bg-slate-500/20 text-slate-300 border border-slate-500/30',
  handoff: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
}

const STEP_TYPE_ICONS: Record<AgentStep['stepType'], string> = {
  'tool-call': '⚡',
  'tool-result': '✓',
  text: '💬',
  handoff: '→',
}

interface StepCardProps {
  step: AgentStep
  isLatest: boolean
  isLoading: boolean
}

const StepCard = React.memo(function StepCard({ step, isLatest, isLoading }: StepCardProps) {
  const [expanded, setExpanded] = useState(false)
  const agentStyle = AGENT_STYLES[step.agentName]
  const stepStyle = STEP_TYPE_STYLES[step.stepType]
  const icon = STEP_TYPE_ICONS[step.stepType]

  const truncated = step.content.length > 120 && !expanded
  const displayContent = truncated ? step.content.slice(0, 120) + '…' : step.content

  return (
    <div
      className={`relative pl-4 border-l-2 ${agentStyle.border} py-2 group`}
    >
      {/* Pulsing dot on latest step while loading */}
      {isLatest && isLoading && (
        <span className="absolute -left-[5px] top-3 flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${agentStyle.dot} opacity-75`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${agentStyle.dot}`} />
        </span>
      )}
      {!isLatest && (
        <span className={`absolute -left-[5px] top-3 inline-flex rounded-full h-2 w-2 ${agentStyle.dot} opacity-40`} />
      )}

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${agentStyle.badge}`}>
          {step.agentName}
        </span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${stepStyle}`}>
          {icon} {step.stepType}
        </span>
        {step.toolName && (
          <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
            {step.toolName}
          </span>
        )}
        <span className="text-[10px] text-slate-600 ml-auto">
          {new Date(step.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Content */}
      <p className="text-xs text-slate-300 leading-relaxed break-words">
        {displayContent}
        {step.content.length > 120 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? 'Show less content' : 'Show more content'}
            aria-expanded={expanded}
            className="ml-1 text-[10px] text-slate-500 hover:text-slate-300 underline underline-offset-2 transition-colors"
          >
            {expanded ? 'show less' : 'show more'}
          </button>
        )}
      </p>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const EmptyState = React.memo(function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-12">
      <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mb-3 border border-slate-700">
        <span className="text-2xl">🤖</span>
      </div>
      <p className="text-sm text-slate-500 font-medium">Agent thought stream</p>
      <p className="text-xs text-slate-600 mt-1 max-w-[200px]">
        Submit a schema to watch the agents reason step-by-step in real time.
      </p>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AgentThoughtStreamProps {
  steps: AgentStep[]
  isLoading: boolean
}

export const AgentThoughtStream = React.memo(function AgentThoughtStream({
  steps,
  isLoading,
}: AgentThoughtStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom whenever a new step arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length])

  return (
    <div className="flex flex-col h-full">
      {/* Steps list — aria-live announces new steps to screen readers */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent"
        role="log"
        aria-live="polite"
        aria-label="Agent thought stream — live execution steps"
        aria-atomic="false"
      >
        {steps.length === 0 ? (
          <EmptyState />
        ) : (
          steps.map((step, i) => (
            <StepCard
              key={`${step.id}-${i}`}
              step={step}
              isLatest={i === steps.length - 1}
              isLoading={isLoading}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-slate-800 flex-shrink-0">
        <div className="flex flex-wrap gap-3">
          {(Object.entries(AGENT_STYLES) as [AgentStep['agentName'], typeof AGENT_STYLES[AgentStep['agentName']]][]).map(
            ([name, style]) => (
              <span key={name} className="flex items-center gap-1 text-[10px] text-slate-500">
                <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                {name}
              </span>
            )
          )}
        </div>
      </div>
    </div>
  )
})
