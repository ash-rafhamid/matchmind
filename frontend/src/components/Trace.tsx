import { useEffect, useState } from 'react'
import type { TraceStep, Verdict } from '../types'

/** One line of proof under every piece of AI text. */
export function VerifiedBadge({ verdict, mode }: { verdict: Verdict | null; mode?: string }) {
  if (!verdict) return null
  if (!verdict.passed)
    return (
      <span className="num text-[11px] text-signal" title={verdict.issues.join('\n')}>
        ✗ Not verified · {verdict.issues.length} issue{verdict.issues.length === 1 ? '' : 's'}
      </span>
    )
  return (
    <span className="num text-[11px] text-proof" title="Every number, name, minute, scoreline and evidence tag matches the match data">
      ✓ Fact-checked · {verdict.checked_numbers} figure{verdict.checked_numbers === 1 ? '' : 's'}, {verdict.checked_names} name
      {verdict.checked_names === 1 ? '' : 's'}
      {mode === 'template' && <span className="text-ink-3"> · template</span>}
    </span>
  )
}

const KIND = { llm: 'model', code: 'code', rules: 'rules', tool: 'tool call' } as const

export function TraceButton({ trace, title }: { trace: TraceStep[]; title: string }) {
  const [open, setOpen] = useState(false)
  if (!trace?.length) return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="link">
        Show the working ({trace.length})
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
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/35" onClick={onClose}>
      <div
        className="rise scroll-ink h-full w-full max-w-2xl overflow-y-auto border-l border-ink bg-paper px-6 py-6 sm:px-10"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Agent trace"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="label text-signal">The working</div>
            <h3 className="display mt-1 text-[26px] leading-tight font-semibold">{title}</h3>
            <p className="mt-1 text-[14px] text-ink-3 italic">
              Every step the crew took, in order{total > 0 ? ` - ${(total / 1000).toFixed(1)} s of agent time` : ''}.
            </p>
          </div>
          <button onClick={onClose} className="link" aria-label="Close">
            Close &times;
          </button>
        </div>
        <div className="double-rule mt-4" />
        <ol className="mt-2">
          {trace.map((step, i) => {
            const rejected = step.passed === false
            return (
              <li key={i} className="grid grid-cols-[36px_1fr] gap-3 border-b border-rule py-4">
                <span className="num pt-0.5 text-[12px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="label label-ink">{step.agent}</span>
                    <span className="num text-[11px] text-ink-3">{KIND[step.kind] ?? step.kind}</span>
                    {step.attempt && <span className="num text-[11px] text-ink-3">draft {step.attempt}</span>}
                    {step.passed === true && <span className="num text-[11px] text-proof">✓ passed</span>}
                    {rejected && <span className="stamp stamp-in text-[11px] text-signal">Rejected</span>}
                    {step.ms > 0 && <span className="ml-auto num text-[11px] text-ink-3">{step.ms} ms</span>}
                  </div>
                  {step.tool && (
                    <code className="mt-2 block num text-[12px] break-all text-ink-2">
                      {step.tool}({JSON.stringify(step.args ?? {})})
                    </code>
                  )}
                  {step.output && (
                    <pre className={`mt-2 num text-[12px] leading-relaxed whitespace-pre-wrap ${rejected ? 'text-signal' : 'text-ink-2'}`}>{step.output}</pre>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
