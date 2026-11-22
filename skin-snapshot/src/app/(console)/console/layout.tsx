import type { Metadata, Viewport } from 'next';
import '@fontsource/cormorant-garamond/latin-600.css';
import '@fontsource-variable/manrope/index.css';
import '../../globals.css';
import { ConsoleShell } from '../../../components/ConsoleShell';

export const metadata: Metadata = { title: 'Console', robots: { index: false, follow: false, nocache: true } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConsoleShell>{children}</ConsoleShell>
      </body>
    </html>
  );
}
