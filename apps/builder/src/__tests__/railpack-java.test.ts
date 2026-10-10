/**
 * Railpack 0.35.0's Java provider, patched by the builder.
 *
 * Railpack 0.35.0 installs JDK 21 whatever a Java project pins,
 * so a Gradle toolchain pinned to 17 (spring-petclinic) failed with "Cannot
 * find a Java installation on your machine matching: {languageVersion=17}".
 * The builder reads the pin and passes RAILPACK_JDK_VERSION to `prepare`
 * unless the service already chose a JDK.
 *
 * Railpack starts a Gradle app with a jar lookup that only
 * matches build/libs under a subproject dir, so single-project petclinic
 * exited on boot. The builder's start command falls back to the root's
 * build/libs.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LogSink } from "../log-stream";

import {
  detectJavaVersion,
  gradleStartCommand,
  gradleStartCommandFor,
  jdkPinToApply,
  jdkVersionEnv,
  normalizeJavaVersion,
} from "../railpack-java";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "railpack-jdk-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function sink(lines: string[]): LogSink {
  return {
    write: () => undefined,
    system: (line) => void lines.push(line),
    setPhase: () => undefined,
    close: async () => undefined,
  };
}

/** spring-petclinic's build.gradle (main), trimmed to the parts that matter. */
const PETCLINIC_GRADLE = `plugins {
  id 'java'
  id 'org.springframework.boot' version '3.5.0'
}

group = 'org.springframework.samples'

java {
  toolchain {
    languageVersion = JavaLanguageVersion.of(17)
  }
}
`;

const PETCLINIC_POM = `<project>
  <properties>
    <!-- Generic properties -->
    <java.version>17</java.version>
  </properties>
  <build><plugins><plugin>
    <configuration><version>\${java.version}</version></configuration>
  </plugin></plugins></build>
</project>`;

describe("normalizeJavaVersion", () => {
  test.each([
    ["17", "17"],
    ["'17'", "17"],
    ['"21"', "21"],
    ["1.8", "8"],
    ["11.0.2", "11"],
    ["${java.version}", null],
    ["latest", null],
    ["1", null],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeJavaVersion(raw)).toBe(expected);
  });
});

describe("detectJavaVersion: Gradle", () => {
  test("spring-petclinic's toolchain pins 17, strictly", () => {
    expect(detectJavaVersion({ gradlew: true, buildGradle: PETCLINIC_GRADLE })).toEqual({
      version: "17",
      source: "build.gradle toolchain",
      strict: true,
    });
  });

  test.each([
    ["languageVersion.set(JavaLanguageVersion.of(21))", "21", true],
    ['languageVersion = JavaLanguageVersion.of("17")', "17", true],
    ["kotlin { jvmToolchain(17) }", "17", true],
    ["java.sourceCompatibility = JavaVersion.VERSION_17", "17", false],
    ["sourceCompatibility = JavaVersion.VERSION_1_8", "8", false],
    ["sourceCompatibility = '11'", "11", false],
    ["sourceCompatibility = 1.8", "8", false],
  ])("build.gradle.kts `%s` → %s", (line, version, strict) => {
    expect(detectJavaVersion({ gradlew: true, buildGradleKts: `java {\n  ${line}\n}\n` })).toEqual(
      expect.objectContaining({ version, strict }),
    );
  });

  test("a commented-out toolchain is not a pin", () => {
    const text = "// languageVersion = JavaLanguageVersion.of(11)\n/* jvmToolchain(8) */\n";
    expect(detectJavaVersion({ gradlew: true, buildGradle: text })).toBeNull();
  });

  test("no gradlew means Railpack builds with Maven, so pom.xml decides", () => {
    expect(
      detectJavaVersion({ gradlew: false, buildGradle: PETCLINIC_GRADLE, pomXml: "<project/>" }),
    ).toBeNull();
  });
});

describe("detectJavaVersion: Maven", () => {
  test("spring-petclinic's pom pins <java.version>17", () => {
    expect(detectJavaVersion({ gradlew: false, pomXml: PETCLINIC_POM })).toEqual({
      version: "17",
      source: "pom.xml <java.version>",
      strict: false,
    });
  });

  test("maven.compiler.release wins, and a ${property} reference resolves", () => {
    const pom = `<project><properties>
      <jdk>21</jdk>
      <java.version>17</java.version>
      <maven.compiler.release>\${jdk}</maven.compiler.release>
    </properties></project>`;
    expect(detectJavaVersion({ gradlew: false, pomXml: pom })?.version).toBe("21");
  });

  test("a pom with no Java version is not a pin", () => {
    expect(detectJavaVersion({ gradlew: false, pomXml: "<project></project>" })).toBeNull();
  });
});

describe("jdkPinToApply", () => {
  test("a strict toolchain pin always applies, even below 11", () => {
    expect(jdkPinToApply({ version: "8", source: "x", strict: true })?.version).toBe("8");
  });

  test("a soft pin below 11 is left to Railpack's default JDK", () => {
    expect(jdkPinToApply({ version: "8", source: "x", strict: false })).toBeNull();
  });

  test("a soft pin of 11 or newer applies", () => {
    expect(jdkPinToApply({ version: "25", source: "x", strict: false })?.version).toBe("25");
  });
});

describe("jdkVersionEnv", () => {
  test("a Gradle project pinned to 17 builds with RAILPACK_JDK_VERSION=17, and says so", () => {
    const lines: string[] = [];
    const dir = repo({ gradlew: "#!/bin/sh\n", "build.gradle": PETCLINIC_GRADLE });
    expect(jdkVersionEnv({ buildDir: dir, serviceEnv: {}, sink: sink(lines) })).toEqual({
      RAILPACK_JDK_VERSION: "17",
    });
    expect(lines.join("\n")).toContain("Java 17 declared by build.gradle toolchain");
  });

  test("the service's own RAILPACK_JDK_VERSION wins", () => {
    const dir = repo({ gradlew: "", "build.gradle": PETCLINIC_GRADLE });
    expect(
      jdkVersionEnv({ buildDir: dir, serviceEnv: { RAILPACK_JDK_VERSION: "21" }, sink: sink([]) }),
    ).toEqual({});
  });

  test("a java package in RAILPACK_PACKAGES or railpack.json wins", () => {
    const gradle = { gradlew: "", "build.gradle": PETCLINIC_GRADLE };
    const env = { RAILPACK_PACKAGES: "node@22 java@21" };
    expect(jdkVersionEnv({ buildDir: repo(gradle), serviceEnv: env, sink: sink([]) })).toEqual({});
    const withConfig = repo({ ...gradle, "railpack.json": '{"packages":{"java":"21"}}' });
    expect(jdkVersionEnv({ buildDir: withConfig, serviceEnv: {}, sink: sink([]) })).toEqual({});
  });

  test("a non-Java repo gets nothing", () => {
    const dir = repo({ "package.json": "{}" });
    expect(jdkVersionEnv({ buildDir: dir, serviceEnv: {}, sink: sink([]) })).toEqual({});
  });
});

describe("gradleStartCommand", () => {
  /** Expand the command's jar lookup the way the container's shell does, in
   *  `dir`, and return the jar(s) `java -jar` would be handed. */
  function jarFor(dir: string, cmd: string): string {
    const lookup = /-jar(?: -Dserver\.port=\$PORT)? (.*)$/.exec(cmd)?.[1] ?? "";
    const out = spawnSync("sh", ["-c", `echo ${lookup}`], { cwd: dir, encoding: "utf8" });
    return out.stdout.trim();
  }

  const cmd = gradleStartCommand({ gradlew: true, buildGradle: PETCLINIC_GRADLE }) ?? "";

  test("no gradlew means Railpack builds with Maven: no override", () => {
    expect(gradleStartCommand({ gradlew: false, pomXml: PETCLINIC_POM })).toBeNull();
  });

  test("Spring Boot gets the port flag, a plain Gradle app does not", () => {
    expect(cmd).toContain("-Dserver.port=$PORT");
    const plainApp = gradleStartCommand({ gradlew: true, buildGradle: "plugins { id 'java' }" });
    expect(plainApp).not.toContain("-Dserver.port");
  });

  test("a single-project build (petclinic) starts the root build/libs boot jar", () => {
    const dir = repo({
      "build/libs/spring-petclinic-4.0.0-SNAPSHOT.jar": "",
      "build/libs/spring-petclinic-4.0.0-SNAPSHOT-plain.jar": "",
    });
    expect(jarFor(dir, cmd)).toBe("build/libs/spring-petclinic-4.0.0-SNAPSHOT.jar");
    // Railpack 0.35.0's own lookup hands java no jar at all here.
    const railpacks = "java $JAVA_OPTS -jar $(ls -1 */build/libs/*jar | grep -v plain)";
    expect(jarFor(dir, railpacks)).toBe("");
  });

  test("a multi-project build resolves to the subproject jar, as Railpack's did", () => {
    const dir = repo({ "app/build/libs/app.jar": "", "app/build/libs/app-plain.jar": "" });
    expect(jarFor(dir, cmd)).toBe("app/build/libs/app.jar");
  });

  test("the service's own start command wins: RAILPACK_START_CMD or railpack.json", () => {
    const gradle = { gradlew: "", "build.gradle": PETCLINIC_GRADLE };
    const own = { serviceEnv: {}, sink: sink([]) };
    expect(gradleStartCommandFor({ ...own, buildDir: repo(gradle) })).toContain("build/libs");
    const env = { RAILPACK_START_CMD: "java -jar app.jar" };
    expect(gradleStartCommandFor({ ...own, buildDir: repo(gradle), serviceEnv: env })).toBeNull();
    const config = '{"deploy":{"startCommand":"java -jar app.jar"}}';
    const withConfig = repo({ ...gradle, "railpack.json": config });
    expect(gradleStartCommandFor({ ...own, buildDir: withConfig })).toBeNull();
  });
});
