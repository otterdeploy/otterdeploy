// Shared mock terminal — used for service shells, server SSH, and DB consoles.
// Fakes a connection + canned command responses. No real backend — UI only.

import { useEffect, useMemo, useRef, useState } from "react";

import { I } from "../icons";

export type TerminalKind = "shell" | "ssh" | "psql" | "redis";

export interface TerminalTarget {
  /** Connection target label, e.g. "web · replica 2" */
  label: string;
  /** What appears at the start of each line, e.g. "app@web-replica-2:/usr/src/app$" */
  prompt: string;
  /** Pre-populated transcript shown before user input */
  banner?: string[];
}

interface Replica { id: string; name: string }

interface Props {
  kind: TerminalKind;
  target: TerminalTarget;
  /** Optional replica picker — only meaningful for kind=shell */
  replicas?: Replica[];
  activeReplica?: string;
  onReplicaChange?: (id: string) => void;
  /** Optional onClose for modal-mounted terminals */
  onClose?: () => void;
  /** Take all height of parent. */
  fill?: boolean;
}

interface Line { kind: "cmd" | "out" | "sys"; text: string }

export function Terminal({
  kind,
  target,
  replicas,
  activeReplica,
  onReplicaChange,
  onClose,
  fill = true,
}: Props) {
  const [lines, setLines] = useState<Line[]>(() => bannerToLines(target.banner));
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset transcript when target changes (e.g. switched replica)
  useEffect(() => {
    setLines(bannerToLines(target.banner));
    setInput("");
    setHistory([]);
    setCursor(null);
    setConnected(false);
    const t = setTimeout(() => setConnected(true), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.label, target.prompt, kind]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines.length]);

  const submit = (raw: string) => {
    const cmd = raw.trim();
    setLines((p) => [...p, { kind: "cmd", text: `${target.prompt} ${raw}` }]);
    if (cmd) setHistory((h) => [...h, cmd]);
    setInput("");
    setCursor(null);
    if (!cmd) return;
    if (cmd === "clear" || cmd === "cls") {
      setLines([]);
      return;
    }
    if (cmd === "exit" || cmd === "logout" || cmd === "\\q") {
      setLines((p) => [...p, { kind: "sys", text: "[connection closed]" }]);
      setConnected(false);
      return;
    }
    const out = respond(kind, cmd);
    if (out.length === 0) return;
    setLines((p) => [...p, ...out.map((text) => ({ kind: "out" as const, text }))]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(input);
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const next = cursor == null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next);
      setInput(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      if (cursor == null) return;
      e.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) {
        setCursor(null);
        setInput("");
      } else {
        setCursor(next);
        setInput(history[next] ?? "");
      }
    } else if (e.key === "l" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      setLines((p) => [...p, { kind: "cmd", text: `${target.prompt} ${input}^C` }]);
      setInput("");
    }
  };

  const reconnect = () => {
    setLines([{ kind: "sys", text: "[reconnecting…]" }]);
    setConnected(false);
    setTimeout(() => {
      setLines(bannerToLines(target.banner));
      setConnected(true);
    }, 400);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: fill ? "100%" : undefined,
        flex: fill ? 1 : undefined,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      {/* header */}
      <div
        className="row gap-2"
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elev)",
          fontSize: 12,
        }}
      >
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: connected ? "var(--ok)" : "var(--warn)",
              boxShadow: connected ? "0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent)" : "none",
              transition: "background 200ms",
            }}
          />
          <span className="mono" style={{ color: "var(--fg-2)" }}>
            {target.label}
          </span>
          <span className="muted mono" style={{ fontSize: 11 }}>
            · {kindLabel(kind)}
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {replicas && replicas.length > 1 && (
          <select
            className="input mono"
            style={{ height: 24, padding: "0 6px", fontSize: 11, width: 160 }}
            value={activeReplica}
            onChange={(e) => onReplicaChange?.(e.target.value)}
          >
            {replicas.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}

        <button className="btn ghost icon sm" title="Clear" onClick={() => setLines([])}>
          <I.refresh width={11} height={11} />
        </button>
        <button className="btn ghost sm" onClick={reconnect}>
          Reconnect
        </button>
        {onClose && (
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={12} height={12} />
          </button>
        )}
      </div>

      {/* output */}
      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className="os-scroll mono"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "10px 14px",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--fg-2)",
          cursor: "text",
        }}
      >
        {lines.map((l, i) => (
          <LineRow key={i} line={l} />
        ))}
        {/* live input row */}
        <div className="row" style={{ alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--ok)" }}>{target.prompt}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={!connected}
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              color: "var(--fg)",
              caretColor: "var(--fg)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function LineRow({ line }: { line: Line }) {
  if (line.kind === "cmd") {
    // Render the prompt prefix in green, the rest in foreground
    const idx = line.text.indexOf(" ");
    if (idx === -1)
      return (
        <div style={{ whiteSpace: "pre-wrap", color: "var(--ok)" }}>{line.text}</div>
      );
    return (
      <div style={{ whiteSpace: "pre-wrap" }}>
        <span style={{ color: "var(--ok)" }}>{line.text.slice(0, idx)}</span>
        <span style={{ color: "var(--fg)" }}>{line.text.slice(idx)}</span>
      </div>
    );
  }
  if (line.kind === "sys") {
    return (
      <div style={{ whiteSpace: "pre-wrap", color: "var(--warn)", fontStyle: "italic" }}>{line.text}</div>
    );
  }
  return <div style={{ whiteSpace: "pre-wrap" }}>{line.text}</div>;
}

function bannerToLines(banner?: string[]): Line[] {
  if (!banner) return [];
  return banner.map((text) => ({ kind: "sys" as const, text }));
}

function kindLabel(k: TerminalKind): string {
  switch (k) {
    case "shell":
      return "/bin/sh";
    case "ssh":
      return "ssh";
    case "psql":
      return "psql";
    case "redis":
      return "redis-cli";
  }
}

// ───────── Canned responder ─────────

function respond(kind: TerminalKind, cmd: string): string[] {
  if (kind === "psql") return respondPsql(cmd);
  if (kind === "redis") return respondRedis(cmd);
  return respondShell(cmd, kind === "ssh");
}

function respondShell(cmd: string, isSsh: boolean): string[] {
  const c = cmd.trim();
  const head = c.split(/\s+/)[0] ?? "";
  if (head === "help" || head === "?")
    return [
      "Available demo commands:",
      "  ls, pwd, whoami, id, env, ps, top, df -h, free -m, uptime,",
      "  cat <file>, echo <text>, date, uname -a, history, hostname,",
      "  clear, exit",
    ];
  if (head === "ls") {
    if (c.includes("-la") || c.includes("-l"))
      return [
        "total 64",
        "drwxr-xr-x  1 app  app  4096 Mar  4 09:12 .",
        "drwxr-xr-x  1 root root 4096 Mar  4 09:12 ..",
        "-rw-r--r--  1 app  app   312 Mar  4 09:12 .env",
        "drwxr-xr-x  1 app  app  4096 Mar  4 09:12 dist",
        "drwxr-xr-x  1 app  app  4096 Mar  4 09:12 node_modules",
        "-rw-r--r--  1 app  app  2104 Mar  4 09:12 package.json",
        "-rw-r--r--  1 app  app   624 Mar  4 09:12 package-lock.json",
        "drwxr-xr-x  1 app  app  4096 Mar  4 09:12 src",
      ];
    return ["dist  node_modules  package.json  src  .env"];
  }
  if (head === "pwd") return ["/usr/src/app"];
  if (head === "whoami") return ["app"];
  if (head === "id") return ["uid=1000(app) gid=1000(app) groups=1000(app)"];
  if (head === "hostname") return [isSsh ? "helio-prod-04" : "web-replica-2.helio.internal"];
  if (head === "uname") return ["Linux web-replica-2 6.6.16-linuxkit #1 SMP x86_64 GNU/Linux"];
  if (head === "uptime")
    return ["09:42:11 up 12 days,  4:23,  load average: 0.18, 0.21, 0.19"];
  if (head === "date") return [new Date().toUTCString()];
  if (head === "df")
    return [
      "Filesystem      Size  Used Avail Use% Mounted on",
      "overlay         500G   84G  416G  17% /",
      "tmpfs            64M     0   64M   0% /dev",
      "/dev/vda1       500G   84G  416G  17% /etc/hosts",
    ];
  if (head === "free")
    return [
      "              total        used        free      shared  buff/cache   available",
      "Mem:        2048792     1238124      210320       12180      600348      724444",
      "Swap:             0           0           0",
    ];
  if (head === "ps" || head === "top")
    return [
      "  PID USER       %CPU %MEM COMMAND",
      "    1 app         0.5  3.2 node dist/server.js",
      "   12 app         1.8  4.1 node --inspect dist/worker.js",
      "   42 app         0.2  0.9 sh",
    ];
  if (head === "env")
    return [
      "NODE_ENV=production",
      "PORT=8080",
      "DATABASE_URL=postgres://helio:••••••@postgres:5432/helio",
      "REDIS_URL=redis://redis:6379",
      "JWT_SECRET=••••••••••••••••",
      "LOG_LEVEL=info",
    ];
  if (head === "echo") return [c.slice(5).replace(/^"|"$/g, "")];
  if (head === "history") return ["  1  ls", "  2  cat .env", "  3  ps aux", "  4  top"];
  if (head === "cat") {
    const file = c.split(/\s+/)[1] ?? "";
    if (file.endsWith(".env"))
      return [
        "NODE_ENV=production",
        "PORT=8080",
        "DATABASE_URL=postgres://helio:••••••@postgres:5432/helio",
        "REDIS_URL=redis://redis:6379",
      ];
    if (file === "package.json")
      return [
        "{",
        '  "name": "helio-api",',
        '  "version": "1.4.2",',
        '  "scripts": { "start": "node dist/server.js" },',
        '  "dependencies": { "fastify": "^4", "pg": "^8" }',
        "}",
      ];
    return [`cat: ${file}: No such file or directory`];
  }
  return [`${head}: command not found`];
}

function respondPsql(cmd: string): string[] {
  const c = cmd.trim();
  if (c === "\\?")
    return [
      "General",
      "  \\copyright    show PostgreSQL usage and distribution terms",
      "  \\l            list databases",
      "  \\dt           list tables",
      "  \\q            quit psql",
    ];
  if (c === "\\l")
    return [
      "                                  List of databases",
      "    Name    | Owner | Encoding | Collate | Ctype | Access privileges",
      "------------+-------+----------+---------+-------+-------------------",
      " helio      | helio | UTF8     | C.UTF-8 | C.UTF-8 |",
      " postgres   | helio | UTF8     | C.UTF-8 | C.UTF-8 |",
      "(2 rows)",
    ];
  if (c === "\\dt")
    return [
      "         List of relations",
      " Schema |   Name   | Type  | Owner",
      "--------+----------+-------+-------",
      " public | users    | table | helio",
      " public | teams    | table | helio",
      " public | charges  | table | helio",
      " public | events   | table | helio",
      "(4 rows)",
    ];
  if (/^select\s+version/i.test(c))
    return [
      "                                              version",
      "----------------------------------------------------------------------------------------------------",
      " PostgreSQL 16.2 (Debian 16.2-1.pgdg120+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14)",
      "(1 row)",
    ];
  if (/^select\s+now/i.test(c))
    return ["              now", "-------------------------------", ` ${new Date().toISOString()}`, "(1 row)"];
  if (/^select.*from\s+users/i.test(c))
    return [
      " id |       email           |  name  |       created_at      ",
      "----+-----------------------+--------+-----------------------",
      "  1 | mira@paperhouse.dev   | mira   | 2025-08-04 18:14:02+00",
      "  2 | arjun@paperhouse.dev  | arjun  | 2025-08-04 18:14:02+00",
      "  3 | lin@paperhouse.dev    | lin    | 2025-09-12 09:32:11+00",
      "(3 rows)",
    ];
  if (/^select\s+count\(\*\)/i.test(c))
    return [" count", "-------", " 12384", "(1 row)"];
  if (/^begin|commit|rollback;?$/i.test(c)) return [c.toUpperCase().replace(/;$/, "")];
  if (c.endsWith(";")) return ["ERROR:  syntax error at or near \"\"", "LINE 1: " + c];
  return ['helio=#  ', '"' + c + '" requires a trailing semicolon (try again).'];
}

function respondRedis(cmd: string): string[] {
  const c = cmd.trim();
  const head = c.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (head === "PING") return ["PONG"];
  if (head === "DBSIZE") return ["(integer) 1842"];
  if (head === "INFO") {
    return [
      "# Server",
      "redis_version:7.2.4",
      "process_id:1",
      "tcp_port:6379",
      "",
      "# Clients",
      "connected_clients:14",
      "",
      "# Memory",
      "used_memory:18923200",
      "used_memory_human:18.05M",
      "",
      "# Stats",
      "total_connections_received:31204",
      "instantaneous_ops_per_sec:982",
    ];
  }
  if (head === "KEYS") {
    return [
      '1) "session:01HF2X3J9P8KZA"',
      '2) "user:1248"',
      '3) "rl:api:5xx:2026-05-04"',
      '4) "queue:emails"',
      '5) "cache:pricing"',
    ];
  }
  if (head === "GET") return ['"<value redacted>"'];
  if (head === "SET") return ["OK"];
  if (head === "DEL") return ["(integer) 1"];
  if (head === "EXISTS") return ["(integer) 1"];
  if (head === "TTL") return ["(integer) 287"];
  if (head === "INCR" || head === "DECR") return ["(integer) " + Math.floor(Math.random() * 1000)];
  return ["(error) ERR unknown command '" + head + "'"];
}
