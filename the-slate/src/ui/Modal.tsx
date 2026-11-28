import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; drawer?: boolean; dirty?: boolean }
/** Accessible dialog (Esc closes, focus is trapped and restored, background scroll locked). `dirty` asks before discarding. */
export function Modal({ title, onClose, children, footer, wide, drawer, dirty }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const tryClose = () => { if (!dirty || window.confirm('Discard your unsaved changes?')) onClose(); };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const first = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea,button.primary'); first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); tryClose(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!f.length) return; const a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  const body = (
    <div ref={ref} className={drawer ? 'drawer' : `modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-h"><h2 id={id}>{title}</h2><button className="btn ghost sm" onClick={tryClose} aria-label="Close">✕</button></div>
      <div className="modal-b">{children}</div>
      {footer && <div className="modal-f">{footer}</div>}
    </div>
  );
  return createPortal(drawer ? <div className="drawer-wrap" onMouseDown={tryClose}>{body}</div> : <div className="scrim" onMouseDown={tryClose}>{body}</div>, document.body);
}
