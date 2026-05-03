import { Suspense, lazy, useEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogsScope } from "../types";
import type { TerminalHandle } from "@wterm/react";

// The Ghostty WASM is served from /public so the request never hits the SPA
// catch-all (which would return index.html and produce
// `WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f`).
// The package's exports map blocks importing the wasm via subpath, so we copy
// it from node_modules into apps/web/public/ instead.
const GHOSTTY_WASM_URL = "/ghostty-vt.wasm";

// Lazy: ~400KB Ghostty WASM core only loads when this component mounts.
// Renamed the inner @wterm/react Terminal to WTermTerminal to avoid shadowing
// the outer lazy-wrapper binding.
const Terminal = lazy(async () => {
  const [{ Terminal: WTermTerminal }, { GhosttyCore }] = await Promise.all([
    import("@wterm/react"),
    import("@wterm/ghostty"),
  ]);

  const core = await GhosttyCore.load({ wasmPath: GHOSTTY_WASM_URL });

  return {
    default: function GhosttyTerminal({
      scope,
      onReady,
    }: {
      scope: LogsScope;
      onReady: (handle: TerminalHandle) => void;
    }) {
      return (
        <WTermTerminal
          core={core}
          autoResize
          theme="dark"
          ref={(handle) => {
            if (handle) onReady(handle);
          }}
          className="h-full w-full"
          aria-label={
            scope.kind === "project"
              ? `Logs for project ${scope.projectId}`
              : `Logs for ${scope.resourceName}`
          }
        />
      );
    },
  };
});

type Props = {
  scope: LogsScope;
};

const PLACEHOLDER_BANNER = [
  "\x1b[1;33m─── otterstack logs (Plan 6 will wire real streaming) ───\x1b[0m",
  "",
  "The Ghostty terminal is mounted, sized, and ready to receive log data.",
  "When the server's WebSocket log gateway ships, this terminal will tail",
  "logs in real time, with filter, search, and time-range support.",
  "",
];

function bannerForScope(scope: LogsScope): string[] {
  if (scope.kind === "project") {
    return [
      ...PLACEHOLDER_BANNER,
      `\x1b[2mscope:\x1b[0m project=${scope.projectId} (all services)`,
      "",
    ];
  }
  return [
    ...PLACEHOLDER_BANNER,
    `\x1b[2mscope:\x1b[0m resource=${scope.resourceName} (${scope.resourceId})`,
    "",
  ];
}

export function LogsTerminal({ scope }: Props) {
  const handleRef = useRef<TerminalHandle | null>(null);

  // Re-emit the placeholder when scope changes so users see it reflect their selection.
  const lines = bannerForScope(scope).join("\r\n");
  useEffect(() => {
    handleRef.current?.write(lines + "\r\n");
  }, [lines]);

  return (
    <div className="h-full w-full bg-zinc-950">
      <Suspense fallback={<Skeleton className="h-full w-full" />}>
        <Terminal
          scope={scope}
          onReady={(handle) => {
            handleRef.current = handle;
            handle.write(lines + "\r\n");
          }}
        />
      </Suspense>
    </div>
  );
}
