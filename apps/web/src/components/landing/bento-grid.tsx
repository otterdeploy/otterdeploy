import { motion, useInView } from "motion/react";
import { useRef } from "react";
import {
  Terminal,
  FileCode,
  GitBranch,
  Layers,
  Zap,
  Shield,
  ArrowRight,
} from "lucide-react";
import { font, ease } from "./fonts";

export function BentoGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const helpSnippet = `$ otter --help

Usage: otter <command> [options]

Commands:
  init        Scaffold a new project
  deploy      Deploy services
  logs        Stream service logs
  env         Manage environments
  secrets     Manage secrets
  scale       Scale services
  rollback    Rollback a deploy
  dev         Start local dev`;

  const yamlSnippet = `# otterdeploy.yml
name: myapp
services:
  web:
    build: ./app
    port: 3000
    replicas: 2
  api:
    build: ./server
    port: 8080`;

  const gitSnippet = `$ git push origin main
▸ deploy triggered → #1248
✓ production live (12s)`;

  const devSnippet = `$ otter dev
✓ mirroring production
▸ web     localhost:3000
▸ api     localhost:8080
▸ postgres localhost:5432`;

  return (
    <section
      id="platform"
      ref={ref}
      className="relative z-10 py-24 px-5 border-t border-white/[0.08]"
    >
      <div className="max-w-5xl mx-auto">
        <motion.h2
          className="text-4xl font-bold text-[#fafafa] tracking-tight mb-10"
          style={font.display}
          initial={{ opacity: 0, y: 15 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={ease}
        >
          Your entire workflow, one tool
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* CLI-First — 2 cols */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.05 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Terminal size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                CLI-First
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Every operation is a command. Tab-complete everything.
              No browser required.
            </p>
            <div
              className="rounded-lg bg-[#111111] border border-white/[0.06] p-4 text-xs leading-relaxed overflow-x-auto"
              style={font.mono}
            >
              {helpSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.startsWith("$") ? (
                    <span className="text-[#fafafa]">{line}</span>
                  ) : line.startsWith("Usage") || line.startsWith("Commands") ? (
                    <span className="text-[#71717a]">{line}</span>
                  ) : line.match(/^\s{2}\w/) ? (
                    <span>
                      <span className="text-[#a78bfa]">
                        {"  "}{line.trim().split(/\s{2,}/)[0]}
                      </span>
                      <span className="text-[#71717a]">
                        {"        ".slice(line.trim().split(/\s{2,}/)[0].length)}
                        {line.trim().split(/\s{2,}/)[1] || ""}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#fafafa]">{line || "\u00a0"}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Config as Code */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.1 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <FileCode size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Config as Code
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              One YAML file, version-controlled, auditable.
            </p>
            <div
              className="rounded-lg border border-white/[0.06] bg-[#111111] p-3 text-[11px] leading-relaxed"
              style={font.mono}
            >
              {yamlSnippet.split("\n").map((line, i) => (
                <div key={i}>
                  {line.startsWith("#") ? (
                    <span className="text-[#71717a]">{line}</span>
                  ) : line.includes(":") ? (
                    <span>
                      <span className="text-[#a78bfa]">
                        {line.split(":")[0]}:
                      </span>
                      <span className="text-[#fafafa]">
                        {line.slice(line.indexOf(":") + 1)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#fafafa]">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Git Integration */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.15 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <GitBranch size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Git Integration
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Push to deploy. Every branch gets a preview.
            </p>
            <div
              className="rounded-lg bg-[#111111] border border-white/[0.06] p-3 text-[11px] leading-relaxed text-[#4ade80]"
              style={font.mono}
            >
              {gitSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Environment Management — col-span-2 */}
          <motion.div
            className="md:col-span-2 rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.2 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Layers size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Environment Management
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Inherit, override, branch. Environments that mirror your git workflow.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { name: "production", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
                { name: "staging", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
                { name: "dev", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
              ].map((env, i) => (
                <div key={env.name} className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border ${env.color}`}
                    style={font.mono}
                  >
                    {env.name}
                  </span>
                  {i < 2 && <ArrowRight size={14} className="text-[#71717a]" />}
                </div>
              ))}
              <span className="text-xs text-[#71717a] ml-1" style={font.mono}>
                inherits down
              </span>
            </div>
          </motion.div>

          {/* Hot Reload */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Hot Reload
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] mb-4 leading-relaxed"
              style={font.body}
            >
              Local dev that mirrors production.
            </p>
            <div
              className="rounded-lg bg-[#111111] border border-white/[0.06] p-3 text-[11px] leading-relaxed"
              style={font.mono}
            >
              {devSnippet.split("\n").map((line, i) => (
                <div key={i} className="whitespace-pre">
                  {line.startsWith("$") ? (
                    <span className="text-[#fafafa]">{line}</span>
                  ) : line.includes("\u2713") ? (
                    <span className="text-[#4ade80]">{line}</span>
                  ) : (
                    <span className="text-[#22d3ee]">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </motion.div>

          {/* Type-Safe Config */}
          <motion.div
            className="rounded-xl border border-white/[0.08] bg-[#18181b] p-6 hover:border-[#7c3aed]/30 transition-colors"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={inView ? { opacity: 1, scale: 1 } : {}}
            transition={{ ...ease, delay: 0.3 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Shield size={18} className="text-[#7c3aed]" />
              <h3
                className="text-base font-semibold text-[#fafafa]"
                style={font.display}
              >
                Type-Safe Config
              </h3>
            </div>
            <p
              className="text-sm text-[#a1a1aa] leading-relaxed"
              style={font.body}
            >
              Schema validation catches errors before deploy. Get instant
              feedback in your editor with JSON Schema autocomplete.
            </p>
            <div className="flex justify-center py-3">
              <div className="px-3 py-1.5 rounded-md bg-[#7c3aed]/10 border border-[#7c3aed]/20">
                <span className="text-xs text-[#a78bfa] font-medium" style={font.mono}>
                  0 errors, 0 warnings
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
