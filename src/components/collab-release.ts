/**
 * collab-release.ts — #727 / #733 review: the ONE teardown of useCollab's two GUI connections (the deck projection
 * and the approval channel). They are released together on every path — projection error, 停止, a failed start,
 * unmount — so a later start() never leaves an old channel polling the host. No React here (tests/collab-release).
 */
export interface Stoppable {
  stop(): Promise<void>;
}

/** Clear both refs FIRST (a concurrent start() sees them empty), then stop each; a failing stop is ignored. */
export async function releaseCollab(proj: { current: Stoppable | null }, chan: { current: Stoppable | null }): Promise<void> {
  const p = proj.current;
  const c = chan.current;
  proj.current = null;
  chan.current = null;
  await Promise.all([p?.stop().catch(() => {}), c?.stop().catch(() => {})]);
}
