import type { Run } from "./App";
import { toolLabel } from "./labels";

export function Trace({ run }: { run: Run | undefined }) {
  return (
    <section className="pane trace" aria-labelledby="trace-title">
      <h2 id="trace-title">What the agent did</h2>
      {!run && <p className="empty">Each tool call shows up here as it runs, with its arguments and what it returned.</p>}
      {run && (
        <>
          <p className="trace-for">For: “{run.inquiry}”</p>
          <ol className="steps">
            {run.steps.map((s, i) => (
              <li key={i} className={`step${s.isError ? " is-error" : ""}${s.forced ? " is-forced" : ""}`} data-tool={s.tool}>
                <details>
                  <summary>
                    <span className="step-tool">{toolLabel(s.tool)}</span>
                    <span className="step-summary">{s.summary}</span>
                    <span className="step-meta">
                      {s.forced ? "added by the code, " : ""}
                      {s.isError ? "error, " : ""}
                      {s.durationMs} ms
                    </span>
                  </summary>
                  <h3>Arguments</h3>
                  <pre>{JSON.stringify(s.arguments, null, 2)}</pre>
                  <h3>Result</h3>
                  <pre>{typeof s.result === "string" ? s.result : JSON.stringify(s.result, null, 2)}</pre>
                </details>
              </li>
            ))}
            {run.guards.map((g, i) => (
              <li key={`g${i}`} className="step is-guard">
                <p className="step-tool">
                  <span className="status" data-status={g.repairing ? "alarm" : "handoff"} aria-hidden="true">
                    {g.repairing ? "Retry" : "Hand-off"}
                  </span>
                  {g.repairing ? "Checks failed, asking for a corrected reply" : "Checks failed again, handing off"}
                </p>
                <ul>
                  {g.violations.map((v, j) => (
                    <li key={j}>{v.message}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {!run.result && !run.error && <p className="empty">Running…</p>}
          {run.result && run.steps.length === 0 && <p className="empty">The agent answered without calling a tool.</p>}
          {run.result && run.result.usage.inputTokens + run.result.usage.outputTokens > 0 && (
            <p className="usage">
              {run.result.usage.inputTokens + run.result.usage.cacheReadTokens} tokens in ({run.result.usage.cacheReadTokens} from cache), {run.result.usage.outputTokens} out
            </p>
          )}
        </>
      )}
    </section>
  );
}
