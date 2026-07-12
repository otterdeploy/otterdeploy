// Single source of truth for the CLI version — package.json. Bun inlines
// this JSON import at compile time (`bun build --compile`), and tsc resolves
// it via resolveJsonModule, so `otterdeploy --version` always matches the
// published package.
import pkg from "../package.json" with { type: "json" };

export const CLI_VERSION: string = pkg.version;
