import type { CSSProperties, ReactNode, SVGProps } from "react";
import { useTheme } from "@/components/theme-provider";
import { Mariadb } from "@/components/ui/svgs/mariadb";
import { MongodbIconDark } from "@/components/ui/svgs/mongodbIconDark";
import { MongodbIconLight } from "@/components/ui/svgs/mongodbIconLight";
import { MysqlIconDark } from "@/components/ui/svgs/mysqlIconDark";
import { MysqlIconLight } from "@/components/ui/svgs/mysqlIconLight";
import { Postgresql } from "@/components/ui/svgs/postgresql";
import { Redis } from "@/components/ui/svgs/redis";

type DatabaseBrand =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "mongodb"
  | "redis"
  | "clickhouse";
type SvgComponent = (props: SVGProps<SVGSVGElement>) => ReactNode;

interface Props {
  value: string;
  size?: number;
  background?: string;
  border?: string;
  color?: string;
  style?: CSSProperties;
}

const themedBrands: Record<
  Extract<DatabaseBrand, "mysql" | "mongodb">,
  { dark: SvgComponent; light: SvgComponent }
> = {
  mysql: { dark: MysqlIconDark, light: MysqlIconLight },
  mongodb: { dark: MongodbIconDark, light: MongodbIconLight },
};

const staticBrands: Record<
  Extract<DatabaseBrand, "postgresql" | "mariadb" | "redis">,
  SvgComponent
> = {
  postgresql: Postgresql,
  mariadb: Mariadb,
  redis: Redis,
};

export function DatabaseLogo({
  value,
  size = 18,
  background = "transparent",
  border = "0",
  color = "var(--fg)",
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

function renderBrand(
  brand: Exclude<DatabaseBrand, "clickhouse">,
  isDark: boolean,
  size: number,
) {
  if (brand === "mysql" || brand === "mongodb") {
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
  if (normalized.includes("mongodb") || normalized.includes("mongo"))
    return "mongodb";
  if (normalized.includes("redis")) return "redis";
  if (normalized.includes("clickhouse")) return "clickhouse";
  return null;
}

function FallbackMark({
  value,
  size,
  color,
}: {
  value: string;
  size: number;
  color: string;
}) {
  return (
    <span
      className="mono"
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
      <rect x="14" y="16" width="8" height="5" rx="1" fill="#111111" />
    </svg>
  );
}
