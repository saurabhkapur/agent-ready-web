import { useAgentStore } from "../agent/store";
import { navigateEnum } from "../agent/session";
import { useVoiceStore, type TurnLatency } from "../voice/voiceStore";

export function DebugPanel() {
  const open = useVoiceStore((s) => s.debugOpen);
  if (!open) return null;
  return (
    <aside className="debug" aria-label="Debug panel">
      <header className="debug-head">
        <strong>Debug</strong>
        <button
          className="debug-clear"
          onClick={() => useVoiceStore.setState({ tools: [], turns: [], events: [], captions: [] })}
        >
          Clear
        </button>
        <button className="debug-close" onClick={() => useVoiceStore.setState({ debugOpen: false })} aria-label="Close debug">
          ✕
        </button>
      </header>
      <NodeSection />
      <LatencySection />
      <ToolSection />
      <EventSection />
    </aside>
  );
}

function NodeSection() {
  const active = useAgentStore((s) => s.activeNodeId);
  const history = useAgentStore((s) => s.history);
  const status = useVoiceStore((s) => s.status);
  const error = useVoiceStore((s) => s.error);
  const sent = useVoiceStore((s) => s.sentNavigateEnum);
  const sentFor = useVoiceStore((s) => s.sentForNode);
  const updates = useVoiceStore((s) => s.sessionUpdates);
  const connected = status === "listening" || status === "speaking";
  const enumList = connected ? sent : navigateEnum(active);

  return (
    <section>
      <h3>State</h3>
      <dl className="kv">
        <dt>Voice</dt>
        <dd>
          {status}
          {error && <span className="err"> · {error}</span>}
        </dd>
        <dt>Node</dt>
        <dd>
          <code>{active}</code>
        </dd>
        <dt>History</dt>
        <dd>
          <code>{history.slice(-5).join(" → ") || "—"}</code>
        </dd>
        <dt>session.update</dt>
        <dd>
          {connected ? (
            <>
              {updates} sent, last for <code>{sentFor}</code>
              {sentFor !== active && <span className="err"> (stale)</span>}
            </>
          ) : (
            "not connected (showing enum that would be sent)"
          )}
        </dd>
      </dl>
      <h4>navigate enum ({enumList.length})</h4>
      <div className="enum">
        {enumList.map((id) => (
          <code key={id}>{id}</code>
        ))}
      </div>
    </section>
  );
}

const fmt = (ms?: number) => (ms === undefined ? "—" : `${ms} ms`);

function LatencySection() {
  const turns = useVoiceStore((s) => s.turns);
  const recent = turns.slice(-8).reverse();
  return (
    <section>
      <h3>Latency (end of speech →)</h3>
      {recent.length === 0 ? (
        <p className="muted">No turns yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>first tool</th>
              <th>first audio</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t: TurnLatency) => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td className={t.firstToolMs !== undefined && t.firstToolMs > 800 ? "err" : ""}>
                  {fmt(t.firstToolMs)}
                  {t.firstToolName && <span className="muted"> {t.firstToolName}</span>}
                </td>
                <td>{fmt(t.firstAudioMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ToolSection() {
  const tools = useVoiceStore((s) => s.tools);
  return (
    <section>
      <h3>Tool calls ({tools.length})</h3>
      {tools.length === 0 && <p className="muted">None yet.</p>}
      <ol className="tool-log">
        {tools
          .slice()
          .reverse()
          .map((t) => (
            <li key={t.id} className={t.ok ? "" : "is-error"}>
              <div>
                <code>
                  {t.name}({t.args || ""})
                </code>
                <span className="muted"> {new Date(t.at).toLocaleTimeString()}</span>
              </div>
              <div className="tool-out">→ {t.output}</div>
            </li>
          ))}
      </ol>
    </section>
  );
}

function EventSection() {
  const events = useVoiceStore((s) => s.events);
  return (
    <section>
      <h3>Events (latest 40)</h3>
      <ol className="event-log">
        {events
          .slice(-40)
          .reverse()
          .map((e, i) => (
            <li key={`${e.at}-${i}`} className={e.type === "error" ? "err" : ""}>
              {e.dir === "in" ? "←" : "→"} {e.type}
            </li>
          ))}
      </ol>
    </section>
  );
}
