import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { CATEGORIES } from "./data/menu";
import { CART_ID, HOME_ID, getPath } from "./agent/paths";
import { noteUserScroll, viewportBand } from "./agent/scroll";
import { cartCount, useAgentStore } from "./agent/store";
import { useAgentComponent } from "./agent/useAgentComponent";
import { CategoryNav } from "./components/CategoryNav";
import { FilterBar } from "./components/FilterBar";
import { MenuSection } from "./components/MenuSection";
import { AddConfirmSheet, CartDrawer } from "./components/Cart";
import { DebugPanel } from "./components/DebugPanel";
import { VoiceDock } from "./components/VoiceDock";

export default function App() {
  useEscapeKey();
  useScrollSync();
  return (
    <div className="app">
      <TopBar />
      <main className="menu">
        <Hero />
        {CATEGORIES.map((c) => (
          <MenuSection key={c.id} category={c} />
        ))}
        <footer className="foot">Prices in Indian rupees, inclusive of taxes. Tell us about allergies before ordering.</footer>
      </main>
      <VoiceDock />
      <CartDrawer />
      <AddConfirmSheet />
      <DebugPanel />
    </div>
  );
}

function TopBar() {
  const canGoBack = useAgentStore((s) => s.history.length > 0);
  const goBack = useAgentStore((s) => s.goBack);
  const navigate = useAgentStore((s) => s.navigate);
  const count = useAgentStore((s) => cartCount(s.cart));
  const where = useAgentStore((s) => getPath(s.activeNodeId)?.label ?? "");
  const ref = useRef<HTMLElement>(null);

  // Expose the sticky header's height so scroll targets land just below it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header className="topbar" ref={ref}>
      <div className="topbar-row">
        <button className="icon-btn" onClick={() => goBack()} disabled={!canGoBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="brand-mark" aria-hidden="true">S</span>
        <div className="brand">
          <span className="brand-name">Saffron &amp; Sage</span>
          <span className="brand-where" aria-live="polite">
            {where}
          </span>
        </div>
        <button className="cart-btn" onClick={() => navigate(CART_ID)} aria-label={`Your order, ${count} items`}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />
          </svg>
          Order{count > 0 && <span className="cart-count">{count}</span>}
        </button>
      </div>
      <CategoryNav />
      <FilterBar />
    </header>
  );
}

function Hero() {
  const { agentProps } = useAgentComponent<HTMLElement>(HOME_ID);
  return (
    <section {...agentProps} className="hero">
      <p className="hero-kicker">Tonight · Indian &amp; continental</p>
      <h1>Plates made to share.</h1>
      <p>Tap a dish for details, or tap the mic and just ask. Keep scrolling and tapping while you talk; the host follows along.</p>
    </section>
  );
}

function useEscapeKey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const s = useAgentStore.getState();
      if (s.pendingAdd) s.cancelAdd();
      else if (s.activeNodeId === CART_ID) s.goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * Hand scrolling moves the view too: once the active section or dish has left
 * the screen, the section under the reading line becomes active. That keeps
 * the chips and the model's "current screen" in step with what the guest sees,
 * so the conversation carries on naturally mid-scroll. Runs only when scrolling
 * settles, so programmatic smooth scrolls never pass through midway sections.
 */
function useScrollSync() {
  useEffect(() => {
    let timer: number | undefined;
    const settle = () => {
      const s = useAgentStore.getState();
      if (s.activeNodeId === CART_ID || s.pendingAdd) return;
      const { top, bottom } = viewportBand();
      const band = bottom - top;
      const nodeEl = (id: string) => document.querySelector<HTMLElement>(`main [data-agent-path="${CSS.escape(id)}"]`);

      // Still looking at the active node? Leave it alone.
      const active = nodeEl(s.activeNodeId);
      if (active) {
        const r = active.getBoundingClientRect();
        const shown = Math.min(r.bottom, bottom) - Math.max(r.top, top);
        if (shown > 0 && (shown >= r.height - 1 || shown >= band * 0.3)) return;
      }

      let next: string = HOME_ID;
      if (window.scrollY > 8) {
        const line = top + band * 0.3;
        const sections = [...document.querySelectorAll<HTMLElement>("main > [data-agent-path]")];
        const hit = sections.find((el) => {
          const r = el.getBoundingClientRect();
          return r.top <= line && r.bottom > line;
        });
        next = hit?.dataset.agentPath ?? s.activeNodeId;
      }
      if (next === s.activeNodeId) return;

      // Collapsing an open dish above the viewport would shift the page; keep
      // the first visible section anchored (browsers without scroll anchoring).
      const anchor = document.elementFromPoint(window.innerWidth / 2, top + 4)?.closest<HTMLElement>("[data-agent-path]");
      const before = anchor?.getBoundingClientRect().top;
      flushSync(() => s.syncFromScroll(next));
      if (anchor && before !== undefined) {
        const shift = anchor.getBoundingClientRect().top - before;
        if (Math.abs(shift) > 1) window.scrollBy(0, shift);
      }
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(settle, 140);
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) noteUserScroll();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", noteUserScroll, { passive: true });
    window.addEventListener("touchmove", noteUserScroll, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", noteUserScroll);
      window.removeEventListener("touchmove", noteUserScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
