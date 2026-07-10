import type { CSSProperties, ReactNode, SVGProps } from "react";

import { useTheme } from "@/shared/components/theme-provider";
import { MariadbDark } from "@/shared/components/ui/svgs/mariadb-dark";
import { MariadbLight } from "@/shared/components/ui/svgs/mariadb-light";
import { MongodbDark } from "@/shared/components/ui/svgs/mongodb-dark";
import { MongodbLight } from "@/shared/components/ui/svgs/mongodb-light";
import { MysqlDark } from "@/shared/components/ui/svgs/mysql-dark";
import { MysqlLight } from "@/shared/components/ui/svgs/mysql-light";
import { Postgresql } from "@/shared/components/ui/svgs/postgresql";
import { Redis } from "@/shared/components/ui/svgs/redis";

type DatabaseBrand = "postgresql" | "mysql" | "mariadb" | "mongodb" | "redis" | "clickhouse";
type SvgComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

interface Props {
  value: string;
  size?: number;
  background?: string;
  border?: string;
  color?: string;
  style?: CSSProperties;
}

/**
 * Engines whose brand ink flips between themes (MySQL teal, MongoDB ink,
 * MariaDB navy all vanish on the dark canvas). Selected via the app theme
 * hook — `resolvedTheme` also tracks the OS when theme="system".
 */
const themedBrands: Record<
  Extract<DatabaseBrand, "mysql" | "mongodb" | "mariadb">,
  { dark: SvgComponent; light: SvgComponent }
> = {
  mysql: { dark: MysqlDark, light: MysqlLight },
  mongodb: { dark: MongodbDark, light: MongodbLight },
  mariadb: { dark: MariadbDark, light: MariadbLight },
};

const staticBrands: Record<Extract<DatabaseBrand, "postgresql" | "redis">, SvgComponent> = {
  postgresql: Postgresql,
  redis: Redis,
};

export function DatabaseLogo({
  value,
  size = 18,
  background = "transparent",
  border = "0",
  color = "var(--foreground)",
  style,
}: Props) {
  const { resolvedTheme, theme } = useTheme();
  const isDark = (resolvedTheme ?? theme) === "dark";
  const brand = resolveDatabaseBrand(value);

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        display: "inline-grid",
        placeItems: "center",
        overflow: "hidden",
        flexShrink: 0,
        borderRadius: 8,
        background,
        border,
        color,
        ...style,
      }}
    >
      {brand === "clickhouse" ? (
        <ClickHouseMark size={Math.round(size * 0.82)} />
      ) : brand ? (
        renderBrand(brand, isDark, Math.round(size * 0.82))
      ) : (
        <FallbackMark value={value} size={size} color={color} />
      )}
    </span>
  );
}

function renderBrand(brand: Exclude<DatabaseBrand, "clickhouse">, isDark: boolean, size: number) {
  if (brand === "mysql" || brand === "mongodb" || brand === "mariadb") {
    const Icon = isDark ? themedBrands[brand].dark : themedBrands[brand].light;
    return <Icon width={size} height={size} />;
  }

  const Icon = staticBrands[brand];
  return <Icon width={size} height={size} />;
}

function resolveDatabaseBrand(value: string): DatabaseBrand | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("postgres")) return "postgresql";
  if (normalized.includes("mariadb")) return "mariadb";
  if (normalized.includes("mysql")) return "mysql";
  if (normalized.includes("mongodb") || normalized.includes("mongo")) return "mongodb";
  if (normalized.includes("redis")) return "redis";
  if (normalized.includes("clickhouse")) return "clickhouse";
  return null;
}

function FallbackMark({ value, size, color }: { value: string; size: number; color: string }) {
  return (
    <span
      className="font-mono"
      style={{
        color,
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        letterSpacing: "-0.02em",
      }}
    >
      {value.slice(0, 2).toUpperCase()}
    </span>
  );
}

function ClickHouseMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="3" width="4" height="18" rx="1" fill="#FFCC01" />
      <rect x="8" y="3" width="4" height="18" rx="1" fill="#FFCC01" />
      <rect x="14" y="3" width="4" height="11" rx="1" fill="#FFCC01" />
      {/* currentColor, not #111 — the dark cap must stay visible on the dark canvas */}
      <rect x="14" y="16" width="8" height="5" rx="1" fill="currentColor" />
    </svg>
  );
}
