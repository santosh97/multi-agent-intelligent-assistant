'use client'

/**
 * components/ResultPanel.tsx
 * Displays the final API contract audit report.
 * Shows loading skeleton while the orchestrator is running.
 * Parses and renders structured OrchestratorOutput or raw Markdown from the stream.
 */
import React from 'react'
import type { OrchestratorOutput, Violation } from '@/lib/types/agents'
import { SCORE_WARN_THRESHOLD, SCORE_PASS_THRESHOLD } from '@/lib/config/constants'

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const Skeleton = React.memo(function Skeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      <div className="h-6 bg-slate-800 rounded-lg w-2/3" />
      <div className="h-3 bg-slate-800 rounded w-full" />
      <div className="h-3 bg-slate-800 rounded w-5/6" />
      <div className="h-16 bg-slate-800 rounded-xl mt-2" />
      <div className="space-y-2 mt-2">
        <div className="h-3 bg-slate-800 rounded w-full" />
        <div className="h-3 bg-slate-800 rounded w-4/5" />
        <div className="h-3 bg-slate-800 rounded w-full" />
      </div>
      <div className="h-24 bg-slate-800 rounded-xl mt-2" />
    </div>
  )
})

// ---------------------------------------------------------------------------
// Score bar
// ---------------------------------------------------------------------------

interface ScoreBarProps {
  score: number
}

const ScoreBar = React.memo(function ScoreBar({ score }: ScoreBarProps) {
  const colorClass =
    score >= SCORE_PASS_THRESHOLD
      ? 'bg-gradient-to-r from-green-500 to-emerald-400'
      : score >= SCORE_WARN_THRESHOLD
        ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
        : 'bg-gradient-to-r from-red-500 to-rose-400'

  const label =
    score >= SCORE_PASS_THRESHOLD ? { text: '✅ PASS', cls: 'text-green-400' } :
      score >= SCORE_WARN_THRESHOLD ? { text: '⚠️ WARN', cls: 'text-amber-400' } :
        { text: '❌ FAIL', cls: 'text-red-400' }

  return (
    <div className="bg-slate-800/60 rounded-2xl p-4 border border-slate-700/50">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <span className="text-3xl font-bold text-white tabular-nums">{score}</span>
          <span className="text-slate-400 text-sm ml-1">/100</span>
        </div>
        <span className={`text-sm font-bold tracking-widest ${label.cls}`}>
          {label.text}
        </span>
      </div>
      <div className="relative h-2.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${colorClass}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Compliance Score</p>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Violation card
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<Violation['severity'], { badge: string; icon: string; ring: string }> = {
  high: { badge: 'bg-red-500/20 text-red-300 border-red-500/40', icon: '🔴', ring: 'border-red-500/20' },
  medium: { badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', icon: '🟠', ring: 'border-amber-500/20' },
  low: { badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40', icon: '🟡', ring: 'border-yellow-500/20' },
}

interface ViolationCardProps {
  violation: Violation
}

const ViolationCard = React.memo(function ViolationCard({ violation }: ViolationCardProps) {
  const config = SEVERITY_CONFIG[violation.severity]
  return (
    <div className={`rounded-xl border p-3.5 bg-slate-800/40 ${config.ring}`}>
      <div className="flex items-start gap-2 mb-2">
        <span className="text-base leading-tight">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-200 leading-tight">{violation.rule}</p>
          <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${config.badge} uppercase tracking-wider`}>
            {violation.severity}
          </span>
        </div>
      </div>
      <div className="space-y-1.5 ml-6">
        <div>
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Field</p>
          <code className="text-[11px] text-slate-300 font-mono bg-slate-900/50 px-1.5 py-0.5 rounded">
            {violation.field}
          </code>
        </div>
        <div>
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Issue</p>
          <p className="text-xs text-slate-400 leading-relaxed">{violation.description}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">Fix</p>
          <p className="text-xs text-teal-400 leading-relaxed">{violation.suggestion}</p>
        </div>
      </div>
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
        <span className="text-2xl">📋</span>
      </div>
      <p className="text-sm text-slate-500 font-medium">Audit report</p>
      <p className="text-xs text-slate-600 mt-1 max-w-[200px]">
        Your compliance report will appear here after the audit completes.
      </p>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Raw text fallback (streaming before JSON is parseable)
// ---------------------------------------------------------------------------

interface RawOutputProps {
  text: string
}

const RawOutput = React.memo(function RawOutput({ text }: RawOutputProps) {
  if (!text.trim()) return null
  return (
    <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-4">
      <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2">
        Orchestrator output
      </p>
      <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
        {text}
      </pre>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main ResultPanel
// ---------------------------------------------------------------------------

interface ResultPanelProps {
  output: OrchestratorOutput | null
  rawText: string
  isLoading: boolean
}

export const ResultPanel = React.memo(function ResultPanel({
  output,
  rawText,
  isLoading,
}: ResultPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {isLoading && !output ? (
          <Skeleton />
        ) : !output && !rawText ? (
          <EmptyState />
        ) : output ? (
          <>
            {/* Score */}
            <ScoreBar score={output.evaluatorResult.score} />

            {/* Summary */}
            <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-3.5">
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-1.5">Summary</p>
              <p className="text-xs text-slate-300 leading-relaxed">{output.evaluatorResult.summary}</p>
            </div>

            {/* Endpoints */}
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 px-0.5">
                Endpoints ({output.analystResult.endpoints.length})
              </p>
              {output.analystResult.endpoints.length === 0 ? (
                <p className="text-xs text-slate-600 italic px-0.5">No endpoints detected.</p>
              ) : (
                <div className="space-y-1.5">
                  {output.analystResult.endpoints.map((ep, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 bg-slate-800/40 rounded-lg px-3 py-2 border border-slate-700/40"
                    >
                      <span className="text-[11px] font-bold font-mono text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded min-w-[48px] text-center">
                        {ep.method}
                      </span>
                      <code className="text-[11px] text-slate-300 font-mono flex-1 truncate">{ep.path}</code>
                      <span title={ep.hasAuth ? 'Auth ✓' : 'No auth'} className="text-[10px]">
                        {ep.hasAuth ? '🔐' : '⚠️'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Violations */}
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 px-0.5">
                Violations ({output.evaluatorResult.violations.length})
              </p>
              {output.evaluatorResult.violations.length === 0 ? (
                <div className="flex items-center gap-2 bg-green-500/10 rounded-xl border border-green-500/20 px-3.5 py-3">
                  <span>🎉</span>
                  <p className="text-xs text-green-300 font-medium">No violations found at the current severity threshold.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {output.evaluatorResult.violations.map((v, i) => (
                    <ViolationCard key={i} violation={v} />
                  ))}
                </div>
              )}
            </div>

            {/* Passed Rules */}
            {output.evaluatorResult.passedRules.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 px-0.5">
                  Passed Rules
                </p>
                <div className="bg-slate-800/40 rounded-xl border border-slate-700/50 p-3">
                  <ul className="space-y-1.5">
                    {output.evaluatorResult.passedRules.map((rule, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                        <span className="text-green-400 mt-0.5 flex-shrink-0">✓</span>
                        {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Unrecognized Rules */}
            {output.evaluatorResult.unrecognizedRules && output.evaluatorResult.unrecognizedRules.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-2 px-0.5">
                  Unrecognized Rules
                </p>
                <div className="bg-amber-500/10 rounded-xl border border-amber-500/20 p-3">
                  <ul className="space-y-1.5">
                    {output.evaluatorResult.unrecognizedRules.map((rule, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-amber-300">
                        <span className="mt-0.5 flex-shrink-0">⚠️</span>
                        {rule} — not matched to any built-in check
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Recommendation */}
            <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-xl border border-purple-500/20 p-3.5">
              <p className="text-[11px] font-medium text-purple-400 uppercase tracking-wider mb-1.5">
                ✨ Recommendation
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">{output.recommendation}</p>
            </div>
          </>
        ) : (
          <RawOutput text={rawText} />
        )}
      </div>
    </div>
  )
})
