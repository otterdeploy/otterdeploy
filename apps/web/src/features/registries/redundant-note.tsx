/**
 * Marks a stored credential for a host the install already reaches without
 * one — GHCR via the workspace's GitHub App, which the derived card above
 * describes as "authorized per request, nothing to rotate".
 *
 * Such a row is not broken, so it shows no error; it is simply a second,
 * weaker credential (a long-lived PAT to rotate and to leak) that nothing
 * ever reaches. Without this note it reads as merely `unused`, which is the
 * same thing a misconfigured registry says.
 */
export function RedundantNote() {
  return (
    <>
      <span aria-hidden>·</span>
      <span className="text-amber-600 dark:text-amber-500">
        already covered by GitHub — safe to delete
      </span>
    </>
  );
}
