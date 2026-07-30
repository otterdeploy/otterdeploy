/**
 * The "Compose file" field, with the auto-detection its placeholder has always
 * promised.
 *
 * The field used to be a bare input reading `placeholder="auto-detect"`. No
 * detection ran: blank simply meant "the builder will guess, later, on the
 * server". When it guessed right you learned nothing; when the repo had no
 * compose file at all you found out minutes into a failed build. The listing
 * needed to answer the question was already one RPC away — `git.inspectRepo`
 * returns `entries`, and the Builder step has used it for framework detection
 * all along (see steps/builder.tsx `DetectionBanner`).
 *
 * Blank still means auto-detect, and the server-side resolution is untouched.
 * What changes is that the placeholder now names the file that resolution will
 * actually land on, so the wizard tells the truth before you commit to it.
 */

import { detectComposeFilenames } from "@otterdeploy/shared/compose";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";

import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";
import { cn } from "@/shared/lib/utils";

import type { ComposeForm } from "./compose-wizard-shared";

import {
  joinRepoPath,
  listingPathIssue,
  splitRepoPath,
  staticPathIssue,
} from "./compose-detect-path";

/** What the listing says about the configured repo + subdirectory. */
type Detection =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; names: string[] }
  | { kind: "empty" };

function useComposeDetection(form: ComposeForm): Detection {
  const gitRepoId = useStore(form.store, (s) => s.values.gitRepoId);
  const subdir = useStore(form.store, (s) => s.values.sourceSubdir);

  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: gitRepoId ? { gitRepoId, path: subdir.trim().replace(/^\/+|\/+$/g, "") } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });

  if (!gitRepoId) return { kind: "idle" };
  if (inspect.isLoading) return { kind: "loading" };

  const files = (inspect.data?.entries ?? []).filter((e) => e.type === "file").map((e) => e.name);
  const names = detectComposeFilenames(files);
  return names.length > 0 ? { kind: "found", names } : { kind: "empty" };
}

/** One-line status under the input. Mirrors DetectionBanner's vocabulary so the
 *  two auto-detects in this wizard read as the same feature. */
function DetectionHint({
  detection,
  subdir,
  onPick,
}: {
  detection: Detection;
  subdir: string;
  onPick: (name: string) => void;
}) {
  const where = subdir.trim() ? ` in /${subdir.trim().replace(/^\/+|\/+$/g, "")}` : "";

  if (detection.kind === "idle" || detection.kind === "loading") {
    return (
      <span className="text-[11px] text-muted-foreground">
        {detection.kind === "loading" ? "Looking for a compose file…" : "Select a repository above."}
      </span>
    );
  }

  if (detection.kind === "empty") {
    // Stated plainly rather than styled as an error: a stack can legitimately
    // keep its compose file somewhere non-conventional, and the operator can
    // still type that path. It just must not be a surprise at build time.
    return (
      <span className="text-[11px] text-warning">
        No compose file found{where}. Enter its path, or check the root directory.
      </span>
    );
  }

  const [first, ...rest] = detection.names;
  return (
    <span className="text-[11px] text-muted-foreground">
      Detected <span className="font-mono text-success">{first}</span>
      {rest.length > 0 ? (
        <>
          {" · also "}
          {rest.map((name, i) => (
            <span key={name}>
              {i > 0 ? ", " : ""}
              <button
                type="button"
                onClick={() => onPick(name)}
                className="font-mono underline underline-offset-2 hover:text-foreground"
              >
                {name}
              </button>
            </span>
          ))}
        </>
      ) : null}
    </span>
  );
}

/**
 * Verify a typed path against the repository, for TanStack Form's
 * `onChangeAsync` — same mechanism the `content` field uses for its debounced
 * parse (see compose-wizard-parse.ts), so both halves of this wizard report
 * their problems through the form rather than through a side channel.
 *
 * Returns a message to fail the field, or undefined to pass. A listing we
 * cannot fetch passes: the operator may be offline or the token may have
 * lapsed, and neither is evidence their path is wrong. The server still
 * resolves the file at build time, exactly as before.
 */
async function validateComposePath(args: {
  value: string;
  gitRepoId: string;
  sourceSubdir: string;
}): Promise<string | undefined> {
  const typed = args.value.trim();
  // Blank is the auto-detect case and always valid — that is the whole point
  // of the field being optional.
  if (!typed || !args.gitRepoId) return undefined;

  const staticIssue = staticPathIssue(typed);
  if (staticIssue) return staticIssue;

  const { dir, base } = splitRepoPath(typed);
  const listing = await orpc.git.inspectRepo
    .call({ gitRepoId: args.gitRepoId, path: joinRepoPath(args.sourceSubdir, dir) })
    .catch(() => null);
  if (!listing) return undefined;

  return listingPathIssue(base, listing.entries);
}

export function ComposeFileField({ form }: { form: ComposeForm }) {
  const detection = useComposeDetection(form);
  const subdir = useStore(form.store, (s) => s.values.sourceSubdir);
  const gitRepoId = useStore(form.store, (s) => s.values.gitRepoId);
  const detected = detection.kind === "found" ? detection.names[0] : null;

  return (
    <form.Field
      name="composePath"
      validators={{
        onChangeAsyncDebounceMs: 400,
        onChangeAsync: ({ value }) =>
          validateComposePath({ value, gitRepoId, sourceSubdir: subdir }),
      }}
    >
      {(field) => {
        // A path the operator typed and got wrong outranks anything we
        // detected: the detection describes a file they didn't ask for.
        const error = field.state.meta.errors[0];
        const invalid = typeof error === "string" && error.length > 0;
        return (
          // The hint sits OUTSIDE the label: it carries buttons for picking an
          // alternate file, and a control nested in a label steals its own
          // clicks to focus the input instead.
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">
                Compose file <span className="text-muted-foreground/60">(optional)</span>
              </span>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                // The detected name IS the placeholder. Leaving the field blank
                // resolves to exactly this on the server, so showing anything
                // else (a generic "auto-detect") hides an answer we already have.
                placeholder={detected ?? "auto-detect"}
                aria-invalid={invalid}
                className={cn(
                  "font-mono",
                  invalid && "border-destructive/60",
                  !invalid && detection.kind === "empty" && "border-warning/50",
                )}
              />
            </label>
            {invalid ? (
              <span className="text-[11px] text-destructive">{error}</span>
            ) : (
              <DetectionHint
                detection={detection}
                subdir={subdir}
                onPick={(name) => field.handleChange(name)}
              />
            )}
          </div>
        );
      }}
    </form.Field>
  );
}
