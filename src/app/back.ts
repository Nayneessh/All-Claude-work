/** Overlays (sheets, dialogs) register here so the Android back button closes the top-most one first. */
const stack: (() => void)[] = [];
export function pushBack(fn: () => void): () => void {
  stack.push(fn);
  return () => { const i = stack.lastIndexOf(fn); if (i >= 0) stack.splice(i, 1); };
}
export function handleBack(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}
export const overlayCount = (): number => stack.length;
