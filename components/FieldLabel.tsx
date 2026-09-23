import type { ReactNode } from "react";

/** A small ⓘ marker that reveals a styled tooltip bubble on hover/focus. */
export function Tip({ text }: { text: string }) {
  return (
    <span className="tip">
      <span className="tip-icon" tabIndex={0} role="img" aria-label="ayuda">
        ⓘ
      </span>
      <span className="tip-bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

/** A form label with an ⓘ help tooltip. */
export function FieldLabel({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <label>
      {children} <Tip text={tip} />
    </label>
  );
}
