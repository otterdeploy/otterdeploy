/**
 * Railpack's Java provider, patched where 0.35.0 gets a plain Java app wrong.
 *
 * 1. THE JDK.
 *
 * Railpack 0.35.0's Java provider (core/providers/java/jdk.go setJDKVersion)
 * installs JDK 21 unless `RAILPACK_JDK_VERSION` says otherwise (or the Gradle
 * wrapper is <= 5, which forces 8). It never reads the project's own pin, so a
 * Spring Boot app whose build.gradle declares
 * `java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }` gets
 * JDK 21 and Gradle refuses to compile: "Cannot find a Java installation on
 * your machine matching: {languageVersion=17}".
 *
 * The builder reads the pin itself and hands it to `prepare` as
 * RAILPACK_JDK_VERSION, unless the service already chose a JDK (its own
 * RAILPACK_JDK_VERSION, a `java` entry in RAILPACK_PACKAGES, or
 * `packages.java` in railpack.json).
 *
 * Two strengths of pin:
 *   - STRICT: a Gradle toolchain (`JavaLanguageVersion.of(N)`, Kotlin's
 *     `jvmToolchain(N)`). Gradle demands exactly that JDK, so it is always
 *     honoured.
 *   - SOFT: Gradle `sourceCompatibility`/`targetCompatibility`, Maven
 *     `maven.compiler.release`/`java.version`/`maven.compiler.source`. A newer
 *     javac compiles these fine, so a pin below 11 (no build from mise's
 *     default OpenJDK vendor) is left to Railpack's default; 11 and up runs
 *     the app on the JDK it declares.
 *
 * Mirrors Railpack's own choice of build tool: a `gradlew` means Gradle, else
 * Maven (core/providers/java/gradle.go usesGradle).
 *
 * 2. THE GRADLE START COMMAND. Railpack starts a Gradle app with
 * `java -jar $(ls -1 <glob> | grep -v plain)` where the glob is
 * `<any dir>/build/libs/<any>.jar`, which only matches a SUBPROJECT's jar. A single-project build (spring-petclinic, `gradle init`,
 * start.spring.io) writes `build/libs/` at the root, so `ls` finds nothing and
 * the container exits on boot printing java's usage (upstream
 * railwayapp/railpack#736). The builder passes the same command with a
 * fallback to the root's `build/libs/`; a multi-project build still resolves
 * exactly as before.
 */

import { Result } from "better-result";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";

import type { LogSink } from "./log-stream";

const JDK_VERSION_ENV = "RAILPACK_JDK_VERSION";

/** Below this a SOFT pin is not applied (see the module comment). */
const SOFT_PIN_FLOOR = 11;

export interface JavaVersionPin {
  version: string;
  /** Where it came from, for the build log, e.g. "build.gradle toolchain". */
  source: string;
  strict: boolean;
}

/** The project's build files, by name; absent files are undefined. */
export interface JavaBuildFiles {
  gradlew: boolean;
  buildGradle?: string;
  buildGradleKts?: string;
  pomXml?: string;
}

/** "1.8" → "8", "17" → "17", "17.0.2" → "17"; null when not a Java version. */
export function normalizeJavaVersion(raw: string): string | null {
  const match = /^\s*["']?(?:1\.(\d+)|(\d+))(?:\.\d+)*["']?\s*$/.exec(raw);
  const major = match?.[1] ?? match?.[2];
  if (!major) return null;
  const n = Number(major);
  return n >= 5 && n <= 99 ? String(n) : null;
}

function stripComments(text: string, style: "c" | "xml"): string {
  return style === "xml"
    ? text.replace(/<!--[\s\S]*?-->/g, "")
    : text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Gradle (Groovy or Kotlin DSL). */
function gradlePin(text: string, file: string): JavaVersionPin | null {
  const src = stripComments(text, "c");
  const strict = [
    /JavaLanguageVersion\.of\(\s*["']?(\d+)["']?\s*\)/,
    /jvmToolchain\(\s*(\d+)\s*\)/,
  ];
  for (const re of strict) {
    const version = normalizeJavaVersion(re.exec(src)?.[1] ?? "");
    if (version) return { version, source: `${file} toolchain`, strict: true };
  }
  const soft =
    /(?:source|target)Compatibility\s*(?:=|\.set\()\s*(?:JavaVersion\.VERSION_(\d+(?:_\d+)?)|["']?([\d.]+)["']?)/;
  const match = soft.exec(src);
  const raw = match?.[1]?.replace("_", ".") ?? match?.[2] ?? "";
  const version = normalizeJavaVersion(raw);
  return version ? { version, source: `${file} sourceCompatibility`, strict: false } : null;
}

/** Maven pom.xml: properties, then the compiler plugin's own config. */
function mavenPin(text: string): JavaVersionPin | null {
  const src = stripComments(text, "xml");
  const tag = (name: string): string | undefined => {
    const escaped = name.replace(/\./g, "\\.");
    return new RegExp(`<${escaped}>\\s*([^<]+?)\\s*</${escaped}>`).exec(src)?.[1];
  };
  // `<maven.compiler.release>${java.version}</…>`: resolve one level of
  // property reference.
  const resolve = (value: string | undefined): string | undefined => {
    const ref = value && /^\$\{([^}]+)\}$/.exec(value)?.[1];
    return ref ? tag(ref) : value;
  };
  for (const name of [
    "maven.compiler.release",
    "java.version",
    "maven.compiler.source",
    "release",
    "source",
  ]) {
    const version = normalizeJavaVersion(resolve(tag(name)) ?? "");
    if (version) return { version, source: `pom.xml <${name}>`, strict: false };
  }
  return null;
}

/** The project's Java pin, or null when it declares none. PURE. */
export function detectJavaVersion(files: JavaBuildFiles): JavaVersionPin | null {
  if (files.gradlew) {
    if (files.buildGradleKts !== undefined) {
      return gradlePin(files.buildGradleKts, "build.gradle.kts");
    }
    if (files.buildGradle !== undefined) return gradlePin(files.buildGradle, "build.gradle");
    return null;
  }
  return files.pomXml === undefined ? null : mavenPin(files.pomXml);
}

/** The pin the builder should apply, or null to leave Railpack's default. */
export function jdkPinToApply(pin: JavaVersionPin | null): JavaVersionPin | null {
  if (!pin) return null;
  if (pin.strict || Number(pin.version) >= SOFT_PIN_FLOOR) return pin;
  return null;
}

const railpackConfigSchema = z.looseObject({
  packages: z.looseObject({ java: z.unknown().optional() }).optional(),
  deploy: z.looseObject({ startCommand: z.unknown().optional() }).optional(),
});

/** The repo's railpack.json (the fields read here), or null when absent or
 *  unreadable: Railpack itself then reports the bad file. */
function readRailpackConfig(buildDir: string): z.infer<typeof railpackConfigSchema> | null {
  const configPath = join(buildDir, "railpack.json");
  if (!existsSync(configPath)) return null;
  const parsed = Result.try(() =>
    railpackConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8"))),
  );
  return parsed.isOk() ? parsed.value : null;
}

/** Whether the service already picked a JDK, so the builder must not. */
function serviceChoosesJdk(serviceEnv: Record<string, string>, buildDir: string): boolean {
  if (serviceEnv[JDK_VERSION_ENV]?.trim()) return true;
  if (/(?:^|\s)java@/.test(serviceEnv.RAILPACK_PACKAGES ?? "")) return true;
  return readRailpackConfig(buildDir)?.packages?.java !== undefined;
}

function readIfPresent(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const read = Result.try(() => readFileSync(path, "utf8"));
  return read.isOk() ? read.value : undefined;
}

/** Read the build files under `buildDir`. */
function readJavaBuildFiles(buildDir: string): JavaBuildFiles {
  return {
    gradlew: existsSync(join(buildDir, "gradlew")),
    buildGradle: readIfPresent(join(buildDir, "build.gradle")),
    buildGradleKts: readIfPresent(join(buildDir, "build.gradle.kts")),
    pomXml: readIfPresent(join(buildDir, "pom.xml")),
  };
}

/**
 * The `RAILPACK_JDK_VERSION` entry for the builder's env: `{}` unless the
 * project pins a JDK the service has not overridden. Logs the choice.
 */
export function jdkVersionEnv(opts: {
  buildDir: string;
  serviceEnv: Record<string, string>;
  sink: LogSink;
}): Record<string, string> {
  if (serviceChoosesJdk(opts.serviceEnv, opts.buildDir)) return {};
  const pin = jdkPinToApply(detectJavaVersion(readJavaBuildFiles(opts.buildDir)));
  if (!pin) return {};
  opts.sink.system(
    `Java ${pin.version} declared by ${pin.source}; building with ${JDK_VERSION_ENV}=${pin.version}`,
  );
  return { [JDK_VERSION_ENV]: pin.version };
}

/** Railpack's own Spring Boot test (gradle.go isUsingSpringBoot). */
function usesSpringBoot(buildGradle: string): boolean {
  return ["org.springframework.boot", "spring-boot-gradle-plugin", "org.grails:grails-"].some(
    (marker) => buildGradle.includes(marker),
  );
}

/**
 * The start command for a Gradle build, or null when Railpack would not pick
 * Gradle (no `gradlew`). PURE.
 */
export function gradleStartCommand(files: JavaBuildFiles): string | null {
  if (!files.gradlew) return null;
  const buildGradle = files.buildGradle ?? files.buildGradleKts ?? "";
  const port = usesSpringBoot(buildGradle) ? " -Dserver.port=$PORT" : "";
  const jar =
    "$(ls -1 */build/libs/*jar 2>/dev/null | grep -v plain || ls -1 build/libs/*jar | grep -v plain)";
  return `java $JAVA_OPTS -jar${port} ${jar}`;
}

/** {@link gradleStartCommand} for the build dir, unless the service names
 *  its own start command (RAILPACK_START_CMD, railpack.json
 *  deploy.startCommand), which `--start-cmd` would otherwise override. */
export function gradleStartCommandFor(opts: {
  buildDir: string;
  serviceEnv: Record<string, string>;
  sink: LogSink;
}): string | null {
  if (opts.serviceEnv.RAILPACK_START_CMD?.trim()) return null;
  if (readRailpackConfig(opts.buildDir)?.deploy?.startCommand !== undefined) return null;
  const cmd = gradleStartCommand(readJavaBuildFiles(opts.buildDir));
  if (cmd)
    opts.sink.system("Gradle build: start command also finds a single-project build/libs jar");
  return cmd;
}
