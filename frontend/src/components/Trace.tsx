import { useEffect, useState } from 'react'
import type { TraceStep, Verdict } from '../types'

/** The proof line under every piece of AI text. */
export function VerifiedBadge({ verdict, mode }: { verdict: Verdict | null; mode?: string }) {
  if (!verdict) return null
  if (!verdict.passed)
    return (
      <span className="cut-both inline-flex items-center gap-1.5 bg-flare px-2.5 py-0.5 cond text-[11px] text-white" title={verdict.issues.join('\n')}>
        ✕ Not verified · {verdict.issues.length}
      </span>
    )
  return (
    <span className="cut-both inline-flex items-center gap-1.5 bg-ink px-2.5 py-0.5 cond text-[11px] text-volt" title="Every number, name, minute, scoreline and evidence tag matches the match data">
      ✓ Fact-checked · {verdict.checked_numbers} figures · {verdict.checked_names} names{mode === 'template' ? ' · template' : ''}
    </span>
  )
}

const KIND = { llm: 'Model', code: 'Code', rules: 'Rules', tool: 'Tool call' } as const

export function TraceButton({ trace, title }: { trace: TraceStep[]; title: string }) {
  const [open, setOpen] = useState(false)
  if (!trace?.length) return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="act">
        How the crew did it ({trace.length})
      </button>
      {open && <TraceSheet trace={trace} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}

function TraceSheet({ trace, title, onClose }: { trace: TraceStep[]; title: string; onClose: () => void }) {
  const total = trace.reduce((s, t) => s + (t.ms ?? 0), 0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const starts = trace.reduce<number[]>((acc, _s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + (trace[i - 1].ms ?? 0)], [])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/50" onClick={onClose}>
      <div className="wipe scroll-slim h-full w-full max-w-[620px] overflow-y-auto bg-ink text-white" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Agent trace">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-ink px-6 pt-6 pb-4">
          <div>
            <div className="cond text-volt">Rundown · how the crew did it</div>
            <h3 className="xp mt-2 text-[22px] leading-tight">{title}</h3>
            <p className="mt-2 text-[13px] text-white/55">Every step, in order{total > 0 ? ` · ${(total / 1000).toFixed(1)} s of agent time` : ''}.</p>
          </div>
          <button onClick={onClose} className="act !text-white/70 hover:!text-white" aria-label="Close">
            Close ✕
          </button>
        </div>
        <ol className="px-6 pb-8">
          {trace.map((step, i) => {
            const rejected = step.passed === false
            return (
              <li key={i} className="grid grid-cols-[64px_1fr] gap-3 border-t border-white/10 py-4">
                <span className="cond pt-1 text-[11px] text-white/40 tab-num">{(starts[i] / 1000).toFixed(1)}s</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="xp text-[14px]">{step.agent}</span>
                    <span className="cond text-[10px] text-white/45">{KIND[step.kind] ?? step.kind}</span>
                    {step.attempt && <span className="cond text-[10px] text-white/45">draft {step.attempt}</span>}
                    {step.passed === true && <span className="cut-both bg-volt px-2 cond text-[10px] text-ink">Passed</span>}
                    {rejected && <span className="cut-both bg-flare px-2 cond text-[10px] text-white">Rejected</span>}
                    {step.ms > 0 && <span className="ml-auto cond text-[10px] text-white/40 tab-num">{step.ms} ms</span>}
                  </div>
                  {step.tool && <code className="mt-2 block text-[12px] break-all text-volt/90">{step.tool}({JSON.stringify(step.args ?? {})})</code>}
                  {step.output && <p className={`mt-2 text-[13px] leading-relaxed whitespace-pre-wrap ${rejected ? 'text-flare' : 'text-white/75'}`}>{step.output}</p>}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
