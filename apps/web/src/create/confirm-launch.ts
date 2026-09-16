/** Confirmation authorizes exactly the reviewed form and wallet, before any publication. */
export async function confirmLaunch(
  snapshot: () => string,
  confirm: () => Promise<boolean>,
  launch: () => Promise<void>,
): Promise<void> {
  const reviewed = snapshot();
  if (!await confirm()) return;
  if (snapshot() !== reviewed) throw new Error('Details or wallet changed. Confirm again.');
  await launch();
}
