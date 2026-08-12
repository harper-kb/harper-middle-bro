export async function register() {
  // Node runtime only: the check reads .clerk/ off disk, and running it once per
  // runtime would double the output.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;

  const { verifyClerkKeys } = await import("./lib/clerk-preflight");
  await verifyClerkKeys();
}
