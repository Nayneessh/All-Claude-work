import type { Metadata } from 'next';
import { CameraSelfTest } from '../../../../../components/CameraSelfTest';

export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'Camera self-test' };

export default function Page() {
  return (
    <section className="section">
      <div className="container narrow">
        <h1>Camera self-test</h1>
        <hr className="gold-rule" />
        <CameraSelfTest />
      </div>
    </section>
  );
}
