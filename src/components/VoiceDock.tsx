import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVoiceStore, type Caption, type VoiceStatus } from "../voice/voiceStore";
import { voiceController } from "../voice/webrtc";

const LABELS: Record<VoiceStatus, string> = {
  idle: "Ask the host",
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Host speaking",
  error: "Try again",
};

const HINT = "Try “show me desserts” or “something veg, not spicy, under 400”.";

/**
 * Bottom dock: the conversation + mic. It floats above the menu, the order
 * drawer and the confirm sheet, so the conversation stays on screen (and the
 * mic stays reachable) wherever the guest navigates. Voice is optional;
 * everything also works by touch.
 */
export function VoiceDock() {
  const status = useVoiceStore((s) => s.status);
  const userSpeaking = useVoiceStore((s) => s.userSpeaking);
  const error = useVoiceStore((s) => s.error);
  const debugOpen = useVoiceStore((s) => s.debugOpen);
  const hasCaptions = useVoiceStore((s) => s.captions.some((c) => c.text));
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const live = status === "listening" || status === "speaking";
  const label = status === "listening" && userSpeaking ? "Hearing you…" : LABELS[status];

  // Expose the dock's height so scroll targets and sheets clear it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--dock-h", `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showConversation = live || (expanded && hasCaptions);

  return (
    <div className={`dock dock-${status}`} ref={ref}>
      <div className="dock-inner">
        {showConversation && (
          <div className={`convo${expanded ? " is-expanded" : ""}`}>
            {expanded ? <Transcript /> : <LatestCaptions live={live} />}
            {hasCaptions && (
              <button className="convo-toggle" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
                {expanded ? "Hide conversation" : "Show conversation"}
              </button>
            )}
          </div>
        )}
        {status === "error" && error && <p className="cap-error">{error}</p>}

        <div className="dock-bar">
          <button
            className={`dbg-toggle${debugOpen ? " is-on" : ""}`}
            onClick={() => useVoiceStore.setState({ debugOpen: !debugOpen })}
            aria-pressed={debugOpen}
            aria-label="Toggle debug panel"
          >
            {"</>"}
          </button>
          <div className="dock-status" aria-live="polite">
            <span className={`dot dot-${status}`} aria-hidden="true" />
            <span>{live ? (userSpeaking ? "Hearing you" : status === "speaking" ? "Host is talking" : "Host is listening") : status === "connecting" ? "Connecting to your host" : "Voice host"}</span>
          </div>
          <button
            className={`mic mic-${status}${userSpeaking ? " user-speaking" : ""}`}
            onClick={() => voiceController.toggle()}
            aria-label={live || status === "connecting" ? "Stop voice" : "Start voice"}
            aria-pressed={live}
          >
            <MicIcon status={status} />
            <span className="mic-label">{label}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function LatestCaptions({ live }: { live: boolean }) {
  const captions = useVoiceStore((s) => s.captions);
  const recent = captions.filter((c) => c.text || !c.final).slice(-2);
  if (!recent.length) return live ? <p className="cap-hint">{HINT}</p> : null;
  return (
    <div className="captions" aria-live="polite">
      {recent.map((c) => (
        <Bubble key={c.id} c={c} clamp />
      ))}
    </div>
  );
}

/** The whole conversation so far, stuck to the newest line unless the guest scrolls up. */
function Transcript() {
  const captions = useVoiceStore((s) => s.captions);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lines = captions.filter((c) => c.text || !c.final);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [captions]);

  return (
    <div
      className="transcript"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {lines.length ? lines.map((c) => <Bubble key={c.id} c={c} />) : <p className="cap-hint">{HINT}</p>}
    </div>
  );
}

function Bubble({ c, clamp }: { c: Caption; clamp?: boolean }) {
  return (
    <p className={`cap cap-${c.role}${c.final ? "" : " is-partial"}${clamp ? " is-clamped" : ""}`}>
      <span>{c.text || "…"}</span>
    </p>
  );
}

function MicIcon({ status }: { status: VoiceStatus }) {
  if (status === "speaking") {
    return (
      <span className="bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
    );
  }
  if (status === "connecting") return <span className="spinner" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
