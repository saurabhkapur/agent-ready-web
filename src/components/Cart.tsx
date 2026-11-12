import { formatPrice, getItem } from "../data/menu";
import { CART_ID } from "../agent/paths";
import { cartTotal, useAgentStore } from "../agent/store";
import { useAgentComponent } from "../agent/useAgentComponent";

/** The cart drawer is open exactly when the "cart" node is active. */
export function CartDrawer() {
  const { isActive, agentProps } = useAgentComponent<HTMLElement>(CART_ID, { focus: false });
  const cart = useAgentStore((s) => s.cart);
  const setQty = useAgentStore((s) => s.setCartQty);
  const goBack = useAgentStore((s) => s.goBack);

  return (
    <>
      <div className={`scrim${isActive ? " is-open" : ""}`} onClick={() => goBack()} aria-hidden="true" />
      <aside {...agentProps} className={`drawer${isActive ? " is-open" : ""}`} aria-label="Your order" aria-hidden={!isActive}>
        <header className="drawer-head">
          <h2>Your order</h2>
          <button className="icon-btn" onClick={() => goBack()} aria-label="Close order" tabIndex={isActive ? 0 : -1}>
            ✕
          </button>
        </header>
        {cart.length === 0 ? (
          <p className="empty">Nothing yet. Tap a dish and choose “Add to order”.</p>
        ) : (
          <>
            <ul className="cart-lines">
              {cart.map((line) => {
                const item = getItem(line.itemId)!;
                return (
                  <li key={line.itemId}>
                    <span className="cart-name">{item.name}</span>
                    <Stepper value={line.qty} onChange={(q) => setQty(line.itemId, q)} min={0} tabbable={isActive} />
                    <span className="cart-price">{formatPrice(item.price * line.qty)}</span>
                  </li>
                );
              })}
            </ul>
            <div className="cart-total">
              <span>Total</span>
              <strong>{formatPrice(cartTotal(cart))}</strong>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

/** On-screen confirmation for every add. Nothing reaches the cart until Confirm is tapped. */
export function AddConfirmSheet() {
  const pending = useAgentStore((s) => s.pendingAdd);
  const setQty = useAgentStore((s) => s.setPendingQty);
  const confirm = useAgentStore((s) => s.confirmAdd);
  const cancel = useAgentStore((s) => s.cancelAdd);
  if (!pending) return null;
  const { lines } = pending;
  const single = lines.length === 1;
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = cartTotal(lines);

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="scrim is-open" onClick={cancel} />
      <div className="sheet">
        <p className="sheet-kicker">{pending.source === "voice" ? "Your host suggested" : "Add to order"}</p>
        <h2 id="confirm-title">{single ? getItem(lines[0].itemId)!.name : `${lines.length} dishes`}</h2>
        <ul className="sheet-lines">
          {lines.map((line) => {
            const item = getItem(line.itemId)!;
            return (
              <li key={line.itemId}>
                {!single && <span className="sheet-name">{item.name}</span>}
                {/* With several dishes, stepping below 1 removes that dish. */}
                <Stepper value={line.qty} onChange={(q) => setQty(line.itemId, q)} min={single ? 1 : 0} />
                <strong className="cart-price">{formatPrice(item.price * line.qty)}</strong>
              </li>
            );
          })}
        </ul>
        {!single && (
          <div className="sheet-total">
            <span>Total</span>
            <strong>{formatPrice(total)}</strong>
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn" onClick={cancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={confirm} autoFocus>
            {single ? "Confirm" : `Add ${count} items`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, min, tabbable = true }: { value: number; onChange: (n: number) => void; min: number; tabbable?: boolean }) {
  const t = tabbable ? 0 : -1;
  return (
    <span className="stepper">
      <button onClick={() => onChange(value - 1)} disabled={value <= min} aria-label="Decrease" tabIndex={t}>
        −
      </button>
      <span aria-live="polite">{value}</span>
      <button onClick={() => onChange(value + 1)} disabled={value >= 20} aria-label="Increase" tabIndex={t}>
        +
      </button>
    </span>
  );
}
