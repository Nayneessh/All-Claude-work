// Small inline icons. Stroke colour follows currentColor so they take the palette from their parent.
type P = { size?: number; className?: string };
const base = (size = 22) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const });

export const IconLock = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const IconLeaf = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14" /><path d="M5 19c3-4 6-6 10-8" /></svg>
);
export const IconDrop = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" /><path d="M9.5 14.5a2.7 2.7 0 0 0 2.5 2" /></svg>
);
export const IconSpark = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M18 17l.7 1.8L20.5 19.5l-1.8.7L18 22l-.7-1.8-1.8-.7 1.8-.7z" /></svg>
);
export const IconCamera = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const IconChat = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9.5h8M8 12.5h5" /></svg>
);
export const IconShield = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconFace = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><ellipse cx="12" cy="12" rx="6" ry="8" /><path d="M9 10.5h.01M15 10.5h.01M9.5 15c1.5 1.2 3.5 1.2 5 0" /></svg>
);
export const IconHeart = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
);
export const IconPhone = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></svg>
);
