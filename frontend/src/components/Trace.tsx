import { AlertTriangle, Bot, CheckCircle2, Code2, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import type { TraceStep, Verdict } from '../types'

export function VerifiedBadge({ verdict, mode }: { verdict: Verdict | null; mode?: string }) {
  if (!verdict) return null
  const label = verdict.passed
    ? `Verified · ${verdict.checked_numbers} numbers, ${verdict.checked_names} names`
    : `Unverified: ${verdict.issues.length} issue${verdict.issues.length === 1 ? '' : 's'}`
  return (
    <span
      title={verdict.passed ? 'Every number, name, minute and evidence tag matches the match data' : verdict.issues.join('\n')}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        verdict.passed ? 'bg-mint-500/15 text-mint-400' : 'bg-rose-400/15 text-rose-400'
      }`}
    >
      {verdict.passed ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
      {label}
      {mode === 'template' && <span className="ml-1 text-ink-400">· template</span>}
    </span>
  )
}

const KIND_ICON = { llm: Bot, code: Code2, rules: Code2, tool: Wrench }
const KIND_LABEL = { llm: 'LLM agent', code: 'Deterministic code', rules: 'Rules', tool: 'MCP / tool call' }

export function TraceButton({ trace, title }: { trace: TraceStep[]; title: string }) {
  const [open, setOpen] = useState(false)
  if (!trace?.length) return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-[11px] text-sky-400 hover:underline">
        Agent trace ({trace.length} steps)
      </button>
      {open && <TraceModal trace={trace} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}

function TraceModal({ trace, title, onClose }: { trace: TraceStep[]; title: string; onClose: () => void }) {
  const total = trace.reduce((s, t) => s + (t.ms ?? 0), 0)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel max-h-[85vh] w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Agent trace">
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <div>
            <div className="text-xs tracking-wider text-ink-400 uppercase">Agent trace</div>
            <div className="font-semibold">{title}</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-400">
            {total > 0 && <span>{(total / 1000).toFixed(1)} s of agent time</span>}
            <button onClick={onClose} className="rounded-lg p-1 hover:bg-ink-700" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <ol className="scroll-thin max-h-[70vh] space-y-3 overflow-y-auto p-5">
          {trace.map((step, i) => {
            const Icon = KIND_ICON[step.kind] ?? Bot
            const failed = step.passed === false
            return (
              <li key={i} className={`rounded-xl border p-3 ${failed ? 'border-rose-400/50 bg-rose-400/5' : 'border-ink-700 bg-ink-900/60'}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-700 text-[11px] font-bold">{i + 1}</span>
                  <Icon size={15} className="text-sky-400" />
                  <span className="font-semibold">{step.agent}</span>
                  <span className="rounded-full bg-ink-700 px-2 py-0.5 text-[10px] text-ink-300">{KIND_LABEL[step.kind] ?? step.kind}</span>
                  {step.tool && <code className="rounded bg-ink-800 px-1.5 text-[11px] text-amber-400">{step.tool}({JSON.stringify(step.args ?? {})})</code>}
                  {step.attempt && <span className="text-[11px] text-ink-400">draft {step.attempt}</span>}
                  {step.passed === true && <span className="text-[11px] text-mint-400">passed</span>}
                  {failed && <span className="text-[11px] text-rose-400">rejected</span>}
                  {step.ms > 0 && <span className="ml-auto text-[11px] text-ink-400">{step.ms} ms</span>}
                </div>
                {step.output && <pre className="mt-2 font-sans text-[13px] whitespace-pre-wrap text-ink-300">{step.output}</pre>}
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
