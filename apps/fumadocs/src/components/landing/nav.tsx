import Link from "next/link";
import { Github } from "lucide-react";
import { font } from "./fonts";

export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#09090b]/80 backdrop-blur-xl border-b border-white/[0.08]">
      <div className="max-w-7xl mx-auto flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-1">
          <span
            className="text-[#fafafa] text-lg font-bold tracking-tight"
            style={font.display}
          >
            otterdeploy
          </span>
          <span className="size-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
        </div>

        <div className="hidden md:flex items-center gap-6">
          {["Features", "Platform", "Community", "Pricing"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
              style={{ ...font.body, fontWeight: 500 }}
            >
              {item}
            </a>
          ))}
          <Link
            href="/docs"
            className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
            style={{ ...font.body, fontWeight: 500 }}
          >
            Docs
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="#"
            className="text-[#71717a] hover:text-[#a1a1aa] transition-colors hidden sm:block"
          >
            <Github size={18} />
          </a>
          <a
            href="#cta"
            className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#7c3aed] text-white hover:bg-[#6d28d9] transition-colors"
            style={font.display}
          >
            Get Started
          </a>
        </div>
      </div>
    </nav>
  );
}
