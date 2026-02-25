import { font } from "./fonts";

export function TerminalWindow({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl overflow-hidden border border-white/[0.08] ${className}`}
      style={{ background: "#111111" }}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.08]">
        <div className="flex gap-1.5">
          <div className="size-3 rounded-full bg-[#ff5f57]" />
          <div className="size-3 rounded-full bg-[#febc2e]" />
          <div className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="text-xs ml-2 text-[#71717a]" style={font.mono}>
          {title}
        </span>
      </div>
      <div className="p-4 lg:p-5" style={font.mono}>
        {children}
      </div>
    </div>
  );
}

export function TerminalLine({ line }: { line: { text: string; type: string } }) {
  switch (line.type) {
    case "command":
      return <span className="text-[#fafafa]">{line.text}</span>;
    case "blank":
      return <br />;
    case "brand":
      return <span className="text-[#a78bfa]">{line.text}</span>;
    case "header":
      return <span className="text-[#fafafa]">{line.text}</span>;
    case "comment":
      return <span className="text-[#71717a]">{line.text}</span>;
    case "yaml": {
      if (line.text.includes(":")) {
        const colonIdx = line.text.indexOf(":");
        return (
          <span>
            <span className="text-[#a78bfa]">{line.text.slice(0, colonIdx + 1)}</span>
            <span className="text-[#fafafa]">{line.text.slice(colonIdx + 1)}</span>
          </span>
        );
      }
      return <span className="text-[#fafafa]">{line.text}</span>;
    }
    case "success": {
      const text = line.text;
      return (
        <span>
          <span className="text-[#4ade80]">
            {text.slice(0, text.indexOf("\u2713") + 1)}
          </span>
          <span className="text-[#fafafa]">
            {text.slice(text.indexOf("\u2713") + 1).split("\u2192")[0]}
          </span>
          {text.includes("\u2192") && (
            <>
              <span className="text-[#71717a]">{"\u2192 "}</span>
              <span className="text-[#a78bfa]">
                {text.split("\u2192")[1].trim()}
              </span>
            </>
          )}
        </span>
      );
    }
    case "final":
      return <span className="text-[#4ade80] font-medium">{line.text}</span>;
    case "log":
      return <span className="text-[#a1a1aa]">{line.text}</span>;
    case "metric":
      return <span className="text-[#fafafa]">{line.text}</span>;
    default:
      return <span className="text-[#fafafa]">{line.text || "\u00a0"}</span>;
  }
}
