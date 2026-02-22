import Link from "next/link";
import { Github, MessageCircle, Heart } from "lucide-react";
import { font } from "./fonts";
import { CONTRIBUTOR_AVATARS } from "./constants";

export function Footer() {
  const columns = [
    {
      title: "Product",
      links: [
        { label: "Documentation", href: "/docs" },
        { label: "CLI Reference", href: "/docs" },
        { label: "API Docs", href: "/docs" },
        { label: "Changelog", href: "#" },
      ],
    },
    {
      title: "Community",
      links: [
        { label: "GitHub", href: "#" },
        { label: "Discord", href: "#" },
        { label: "Blog", href: "#" },
        { label: "Contributing", href: "#" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "#" },
        { label: "Pricing", href: "#pricing" },
        { label: "Security", href: "#" },
        { label: "License", href: "#" },
      ],
    },
  ];

  return (
    <footer className="relative z-10 px-5 py-12 border-t border-white/[0.08]">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
          <div>
            <div className="flex items-center gap-1 mb-3">
              <span className="text-[#fafafa] font-bold tracking-tight" style={font.display}>
                otterdeploy
              </span>
              <span className="size-1.5 rounded-full bg-[#7c3aed] inline-block mb-2" />
            </div>
            <p className="text-sm text-[#71717a] leading-relaxed" style={font.body}>
              Self-hosted PaaS for teams that ship. Free and open source.
            </p>
            <div className="flex items-center gap-3 mt-4">
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <Github size={16} />
              </a>
              <a href="#" className="text-[#71717a] hover:text-[#a1a1aa] transition-colors">
                <MessageCircle size={16} />
              </a>
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h5
                className="text-xs text-[#71717a] uppercase tracking-wider mb-3"
                style={font.mono}
              >
                {col.title}
              </h5>
              <div className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="text-sm text-[#a1a1aa] hover:text-[#fafafa] transition-colors"
                    style={{ ...font.body, fontWeight: 400 }}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          <div>
            <h5
              className="text-xs text-[#71717a] uppercase tracking-wider mb-3"
              style={font.mono}
            >
              Contributors
            </h5>
            <div className="flex flex-wrap gap-1 mb-3">
              {CONTRIBUTOR_AVATARS.slice(0, 6).map((c, i) => (
                <div
                  key={i}
                  className="size-6 rounded-full border border-white/[0.08] flex items-center justify-center"
                  style={{ background: `${c.color}15` }}
                >
                  <span
                    className="text-[7px] font-medium"
                    style={{ color: c.color, ...font.mono }}
                  >
                    {c.initials}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm text-[#a1a1aa]" style={font.body}>
              42 contributors
            </p>
            <a
              href="#"
              className="text-xs text-[#a78bfa] hover:text-[#7c3aed] transition-colors mt-1 inline-block"
              style={font.body}
            >
              View all contributors
            </a>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
          <span className="text-xs text-[#71717a]" style={font.mono}>
            &copy; 2026 otterdeploy &middot; MIT License
          </span>
          <span
            className="text-xs text-[#71717a] inline-flex items-center gap-1"
            style={font.mono}
          >
            built with <Heart size={10} className="text-[#7c3aed]" /> by the community
          </span>
        </div>
      </div>
    </footer>
  );
}
