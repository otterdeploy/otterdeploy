import { useMemo, useState } from "react";

import { DatabaseLogo } from "@/components/brand/database-logo";

import { SERVICES, type Service } from "../data";
import { I } from "../icons";

/* ──────────────────────────────────────────────────────────────────────────
 * Data Viewer — built-in database browser mockup.
 *
 * Visual target: Outerbase Studio (toolbar, LIMIT/OFFSET steppers, export menu,
 * SQL snippets + gutter run arrows, schema browser with PK/UQ + nullability /
 * default toggles, settings popover with the count(*) cost warning).
 *
 * otterdeploy layer: read/write capability envelope, "every query audited"
 * guarantee, staged writes (review before commit), typed-name destructive
 * confirm — see docs/designs/data-viewer.md.
 *
 * Interactive: filters, add-record, row selection, inline edit all work on
 * local state. Schema mirrors the real Kaitosec Prod database; data is synthetic.
 * ────────────────────────────────────────────────────────────────────────── */

type ColType = "text" | "integer" | "numeric" | "boolean" | "timestamp" | "jsonb" | "uuid";
interface Column {
  name: string;
  type: ColType;
  pk?: boolean;
  uq?: boolean;
  fk?: string;
  nullable?: boolean;
  def?: string;
}
type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;
interface TableDef {
  name: string;
  kind: "table" | "view";
  rows: number;
  columns: Column[];
  sample?: Row[];
}

type Menu = null | "overflow" | "settings" | "columns" | "filters";
type FilterOp = "contains" | "=" | "!=" | ">" | "<" | "is null" | "is not null";
interface Filter {
  id: string;
  col: string;
  op: FilterOp;
  value: string;
}
const NUMERIC = (t: ColType) => t === "integer" || t === "numeric";

const c = (name: string, type: ColType, o: Partial<Column> = {}): Column => ({ name, type, ...o });

// ── Catalog (mirrors Kaitosec Prod; data is synthetic) ──────────────────────
const TABLES: TableDef[] = [
  {
    name: "account",
    kind: "table",
    rows: 9,
    columns: [
      c("id", "text", { pk: true }),
      c("account_id", "text"),
      c("provider_id", "text"),
      c("user_id", "text", { fk: "user" }),
      c("access_token", "text", { nullable: true }),
      c("refresh_token", "text", { nullable: true }),
      c("id_token", "text", { nullable: true }),
      c("access_token_expires_at", "timestamp", { nullable: true }),
      c("refresh_token_expires_at", "timestamp", { nullable: true }),
      c("scope", "text", { nullable: true }),
      c("password", "text", { nullable: true }),
      c("created_at", "timestamp", { def: "now()" }),
      c("updated_at", "timestamp", { def: "now()" }),
    ],
    sample: [
      acct(
        "acct_dktji8x6tqblf5xko",
        "106446984597665054699",
        "usr_xxhvf9hlbmjyi3nrrp",
        "ya29.a0AQvPyIMhRC06GnP",
      ),
      acct(
        "acct_jz3o6gvgip26ey8a6",
        "105268262289431849536",
        "usr_pd8lkxr18hzjqeqj1l",
        "ya29.a0AT3oNZ-wxiZTPPZ",
      ),
      acct(
        "acct_k8m5bksx5wtaisz9i",
        "118039817286993657795",
        "usr_pr44rnml6vorn6jdzk",
        "ya29.a0AQvPyIPIGxqysHA",
      ),
      acct(
        "acct_lpvj7dr07bkueb5og",
        "118147148937405190881",
        "usr_lkloa847qkt5swmndy",
        "ya29.a0AQvPyIOT5RI2Yne",
      ),
      acct(
        "acct_ms6592z6gsc7h6o0d",
        "112121800424404047790",
        "usr_ii2fpih87peig1sqfz",
        "ya29.a0AT3oNZ_IiaO294f",
      ),
      acct(
        "acct_o17c9x6lgp4fgcs1s",
        "103012696670852603888",
        "usr_s1ke6e779wgovwhmee",
        "ya29.a0AQvPyIM8qZzYE2h",
      ),
      acct(
        "acct_of8f7w5d6vf4iw51v",
        "101594841653609428607",
        "usr_rzrj2gbelkk2ut6g02",
        "ya29.a0AQvPyIPEY2SSF94",
      ),
      acct(
        "acct_qp3858s70r8jr5emx",
        "113217520587000666842",
        "usr_z92p8ukntzhqz1lemf",
        "ya29.a0AT3oNZ-nj40eRb9",
      ),
      acct(
        "acct_rcqnlxnxvctjevpo7",
        "116269096396068824233",
        "usr_k3ccxejn0pibn48ndg",
        "ya29.a0AQvPyINaA17bhHF",
      ),
    ],
  },
  {
    name: "activity_log",
    kind: "table",
    rows: 48213,
    columns: [
      c("id", "text", { pk: true }),
      c("organization_id", "text", { fk: "organization" }),
      c("object_type", "text"),
      c("object_id", "text"),
      c("actor_id", "text", { fk: "user" }),
      c("action", "text"),
      c("details", "jsonb"),
      c("created_at", "timestamp", { def: "now()" }),
    ],
  },
  {
    name: "apikey",
    kind: "table",
    rows: 142,
    columns: [
      c("id", "text", { pk: true }),
      c("name", "text"),
      c("start", "text"),
      c("prefix", "text"),
      c("key", "text", { uq: true }),
      c("user_id", "text", { fk: "user" }),
      c("organization_id", "text", { fk: "organization" }),
      c("refill_interval", "integer", { nullable: true }),
      c("refill_amount", "integer", { nullable: true }),
      c("last_refill_at", "timestamp", { nullable: true }),
      c("enabled", "boolean", { def: "true" }),
      c("created_at", "timestamp", { def: "now()" }),
    ],
  },
  {
    name: "user",
    kind: "table",
    rows: 1284,
    columns: [
      c("id", "text", { pk: true }),
      c("name", "text"),
      c("email", "text", { uq: true }),
      c("email_verified", "boolean", { def: "false" }),
      c("image", "text", { nullable: true }),
      c("role", "text", { def: "'member'" }),
      c("created_at", "timestamp", { def: "now()" }),
      c("updated_at", "timestamp", { def: "now()" }),
    ],
  },
  {
    name: "organization",
    kind: "table",
    rows: 96,
    columns: [
      c("id", "text", { pk: true }),
      c("name", "text"),
      c("slug", "text", { uq: true }),
      c("logo", "text", { nullable: true }),
      c("metadata", "jsonb", { nullable: true }),
      c("created_at", "timestamp", { def: "now()" }),
    ],
  },
  {
    name: "session",
    kind: "table",
    rows: 3120,
    columns: [
      c("id", "text", { pk: true }),
      c("user_id", "text", { fk: "user" }),
      c("token", "text", { uq: true }),
      c("expires_at", "timestamp"),
      c("ip_address", "text", { nullable: true }),
      c("user_agent", "text", { nullable: true }),
      c("created_at", "timestamp", { def: "now()" }),
    ],
  },
  bcms("assessment_template", 38, [
    c("name", "text"),
    c("kind", "text"),
    c("description", "text", { nullable: true }),
    c("organization_id", "text", { fk: "organization" }),
  ]),
  bcms("assessment_template_question", 412, [
    c("template_id", "text", { fk: "assessment_template" }),
    c("prompt", "text"),
    c("weight", "numeric", { def: "1.0" }),
    c("position", "integer"),
  ]),
  bcms("assessment_result", 1843, [
    c("template_id", "text", { fk: "assessment_template" }),
    c("asset_id", "text", { fk: "asset" }),
    c("status", "text"),
    c("score", "numeric", { nullable: true }),
    c("completed_at", "timestamp", { nullable: true }),
  ]),
  bcms("assessment_answer", 22104, [
    c("result_id", "text", { fk: "assessment_result" }),
    c("question_id", "text", { fk: "assessment_template_question" }),
    c("value", "jsonb"),
    c("score", "numeric", { nullable: true }),
  ]),
  bcms("assessment_result_evidence", 5012, [
    c("result_id", "text", { fk: "assessment_result" }),
    c("url", "text"),
    c("kind", "text"),
    c("uploaded_by", "text", { fk: "user" }),
  ]),
  bcms("asset", 2940, [
    c("organization_id", "text", { fk: "organization" }),
    c("name", "text"),
    c("type", "text"),
    c("criticality", "text"),
    c("owner_id", "text", { fk: "user", nullable: true }),
  ]),
  bcms("asset_dependency", 6188, [
    c("asset_id", "text", { fk: "asset" }),
    c("depends_on", "text", { fk: "asset" }),
    c("kind", "text"),
  ]),
  bcms("asset_template", 54, [c("name", "text"), c("type", "text")]),
  bcms("asset_template_item", 318, [
    c("template_id", "text", { fk: "asset_template" }),
    c("key", "text"),
    c("value", "text"),
  ]),
  bcms("asset_type_bcms_config", 22, [
    c("asset_type", "text"),
    c("rto_minutes", "integer"),
    c("rpo_minutes", "integer"),
  ]),
  bcms("audit", 271, [
    c("organization_id", "text", { fk: "organization" }),
    c("scope", "text"),
    c("status", "text"),
    c("started_at", "timestamp"),
    c("finished_at", "timestamp", { nullable: true }),
  ]),
  bcms("audit_checklist_item", 4820, [
    c("audit_id", "text", { fk: "audit" }),
    c("label", "text"),
    c("passed", "boolean", { nullable: true }),
    c("note", "text", { nullable: true }),
  ]),
  bcms("bia_assessment", 1402, [
    c("asset_id", "text", { fk: "asset" }),
    c("mtpd_minutes", "integer"),
    c("status", "text"),
    c("created_at", "timestamp", { def: "now()" }),
  ]),
  bcms("bia_escalation_point", 902, [
    c("bia_id", "text", { fk: "bia_assessment" }),
    c("name", "text"),
    c("contact", "text"),
  ]),
  bcms("bia_impact_category", 64, [
    c("organization_id", "text", { fk: "organization" }),
    c("name", "text"),
    c("weight", "numeric"),
  ]),
  bcms("bia_peak_period", 388, [
    c("bia_id", "text", { fk: "bia_assessment" }),
    c("label", "text"),
    c("starts_at", "timestamp"),
    c("ends_at", "timestamp"),
  ]),
  bcms("bia_vital_record", 1190, [
    c("bia_id", "text", { fk: "bia_assessment" }),
    c("name", "text"),
    c("location", "text"),
  ]),
  bcms("campaign", 212, [
    c("organization_id", "text", { fk: "organization" }),
    c("name", "text"),
    c("status", "text"),
    c("due_at", "timestamp", { nullable: true }),
  ]),
  bcms("campaign_participant", 1804, [
    c("campaign_id", "text", { fk: "campaign" }),
    c("user_id", "text", { fk: "user" }),
    c("state", "text"),
  ]),
  bcms("catalog", 88, [c("name", "text"), c("kind", "text"), c("version", "text")]),
  {
    name: "active_sessions",
    kind: "view",
    rows: 642,
    columns: [
      c("user_id", "text"),
      c("email", "text"),
      c("ip_address", "text"),
      c("expires_at", "timestamp"),
    ],
  },
  {
    name: "org_usage",
    kind: "view",
    rows: 96,
    columns: [
      c("organization_id", "text"),
      c("assets", "integer"),
      c("open_audits", "integer"),
      c("last_activity", "timestamp"),
    ],
  },
];

const TYPE_COLOR: Record<ColType, string> = {
  uuid: "var(--info)",
  text: "var(--fg-3)",
  integer: "var(--ok)",
  numeric: "var(--ok)",
  boolean: "var(--warn)",
  timestamp: "var(--fg-3)",
  jsonb: "#c084fc",
};
let FID = 0;

// ── Screen ──────────────────────────────────────────────────────────────────
export function DataViewer({
  initialView = "grid",
  initialSql = false,
  initialTable = "account",
  seedDemoEdits = false,
  initialWriteMode = true,
  demoConfirm = false,
  demoMenu = null,
  demoAdd = false,
}: {
  initialView?: "grid" | "structure";
  initialSql?: boolean;
  initialTable?: string;
  seedDemoEdits?: boolean;
  initialWriteMode?: boolean;
  demoConfirm?: boolean;
  demoMenu?: Menu;
  demoAdd?: boolean;
} = {}) {
  const databases = useMemo(() => SERVICES.filter((s) => s.kind === "database"), []);
  const pg = databases.find((d) => d.image.startsWith("postgres"));
  const [db] = useState<Service | undefined>(pg ?? databases[0]);

  const [activeTable, setActiveTable] = useState(initialTable);
  const [view, setView] = useState<"grid" | "structure">(initialView);
  const [sqlOpen, setSqlOpen] = useState(initialSql);
  const [writeMode, setWriteMode] = useState(initialWriteMode);
  const [selectedRow, setSelectedRow] = useState<number | null>(0);
  const [panelOpen, setPanelOpen] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>(
    seedDemoEdits ? { "acct_k8m5bksx5wtaisz9i:provider_id": "github" } : {},
  );
  const [confirm, setConfirm] = useState<null | { kind: "drop" | "delete"; label: string }>(
    demoConfirm ? { kind: "drop", label: "public.account" } : null,
  );
  const [menu, setMenu] = useState<Menu>(demoMenu);
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showRowCount, setShowRowCount] = useState(true);
  const [flatSchemas, setFlatSchemas] = useState(false);
  const [pages, setPages] = useState(false);
  const [showNull, setShowNull] = useState(true);
  const [showDefaults, setShowDefaults] = useState(true);

  // interactive data state
  const [rowsByTable, setRowsByTable] = useState<Record<string, Row[]>>({});
  const [filters, setFilters] = useState<Filter[]>(
    demoMenu === "filters"
      ? [{ id: "seed", col: "access_token", op: "contains", value: "AT3" }]
      : [],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(demoAdd);

  const table = TABLES.find((t) => t.name === activeTable) ?? TABLES[0];
  const pkCol = table.columns.find((x) => x.pk)?.name ?? table.columns[0].name;
  const baseRows = rowsByTable[table.name] ?? getRows(table, 200);
  const filtered = useMemo(() => applyFilters(baseRows, filters), [baseRows, filters]);
  const visible = filtered.slice(offset, offset + limit);

  const editCount = Object.keys(edits).length;
  const setEdit = (rid: string, col: string, value: string) =>
    setEdits((e) => ({ ...e, [`${rid}:${col}`]: value }));

  const openTable = (n: string) => {
    setActiveTable(n);
    setSelectedRow(0);
    setView("grid");
    setOffset(0);
    setFilters([]);
    setSelected(new Set());
  };

  const addRecord = (row: Row) => {
    setRowsByTable((prev) => ({
      ...prev,
      [table.name]: [row, ...(prev[table.name] ?? getRows(table, 200))],
    }));
    setAddOpen(false);
    setOffset(0);
    setSelectedRow(0);
    setPanelOpen(true);
  };
  const deleteSelected = () => {
    if (selected.size === 0) {
      setConfirm({ kind: "delete", label: `public.${table.name}` });
      return;
    }
    setRowsByTable((prev) => ({
      ...prev,
      [table.name]: (prev[table.name] ?? getRows(table, 200)).filter(
        (r) => !selected.has(String(r[pkCol])),
      ),
    }));
    setSelected(new Set());
  };
  const toggleAll = () => {
    const ids = visible.map((r) => String(r[pkCol]));
    const all = ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
      onClick={() => menu && setMenu(null)}
    >
      <ConnectionHeader
        db={db}
        writeMode={writeMode}
        setWriteMode={setWriteMode}
        sqlOpen={sqlOpen}
        setSqlOpen={setSqlOpen}
      />

      {sqlOpen ? (
        <SqlMode
          onBack={() => setSqlOpen(false)}
          onDanger={() => setConfirm({ kind: "drop", label: "public.account" })}
          showRowCount={showRowCount}
        />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <TablesSidebar
            active={activeTable}
            onSelect={openTable}
            flat={flatSchemas}
            showCounts={showRowCount}
          />

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <GridToolbar
              table={table}
              view={view}
              setView={setView}
              total={filters.length ? filtered.length : table.rows}
              filtered={filters.length > 0}
              limit={limit}
              setLimit={setLimit}
              offset={offset}
              setOffset={setOffset}
              pages={pages}
              writeMode={writeMode}
              menu={menu}
              setMenu={setMenu}
              hidden={hidden}
              setHidden={setHidden}
              filters={filters}
              setFilters={setFilters}
              selectedCount={selected.size}
              onAdd={() => setAddOpen(true)}
              settings={{
                showRowCount,
                setShowRowCount,
                flatSchemas,
                setFlatSchemas,
                pages,
                setPages,
              }}
            />

            {view === "structure" ? (
              <StructureView
                table={table}
                showNull={showNull}
                setShowNull={setShowNull}
                showDefaults={showDefaults}
                setShowDefaults={setShowDefaults}
              />
            ) : (
              <DataGrid
                table={table}
                pkCol={pkCol}
                rows={visible}
                hidden={hidden}
                writeMode={writeMode}
                edits={edits}
                onEdit={setEdit}
                selectedRow={selectedRow}
                onSelectRow={(i) => {
                  setSelectedRow(i);
                  setPanelOpen(true);
                }}
                selected={selected}
                onToggleAll={toggleAll}
                onToggleOne={toggleOne}
                onDeleteSelected={deleteSelected}
              />
            )}
          </div>

          {view === "grid" && panelOpen && selectedRow != null && visible[selectedRow] && (
            <RowDetailPanel
              table={table}
              pkCol={pkCol}
              row={visible[selectedRow]}
              writeMode={writeMode}
              edits={edits}
              onEdit={setEdit}
              onClose={() => setPanelOpen(false)}
            />
          )}
        </div>
      )}

      {editCount > 0 && <PendingBar count={editCount} onDiscard={() => setEdits({})} />}
      {addOpen && (
        <AddRecordModal
          table={table}
          pkCol={pkCol}
          onClose={() => setAddOpen(false)}
          onSave={addRecord}
        />
      )}
      {confirm && <ConfirmModal info={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── Connection header ───────────────────────────────────────────────────────
function ConnectionHeader({
  db,
  writeMode,
  setWriteMode,
  sqlOpen,
  setSqlOpen,
}: {
  db: Service | undefined;
  writeMode: boolean;
  setWriteMode: (v: boolean) => void;
  sqlOpen: boolean;
  setSqlOpen: (v: boolean) => void;
}) {
  return (
    <div
      className="row gap-3"
      style={{
        height: 46,
        padding: "0 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-elev)",
        flexShrink: 0,
      }}
    >
      <button
        className="row gap-2"
        style={{
          padding: "4px 8px",
          border: "1px solid var(--border)",
          borderRadius: 7,
          height: 30,
        }}
        title="Switch database"
      >
        <DatabaseLogo value={`${db?.name ?? "postgres"} ${db?.image ?? "postgres"}`} size={15} />
        <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
          Kaitosec Prod
        </span>
        <I.chevDown width={12} height={12} style={{ opacity: 0.5 }} />
      </button>
      <span className="badge mono">{db?.version ?? "16.2"}</span>
      <span className="badge" style={{ gap: 5 }}>
        <I.link width={10} height={10} /> internal
      </span>
      <div style={{ flex: 1 }} />
      <span
        className="badge info"
        title="Every statement runs through the platform oRPC layer and is written to the evlog audit trail."
        style={{ gap: 5 }}
      >
        <I.eye width={11} height={11} /> audited
      </span>
      <span
        className="badge"
        style={{ gap: 5 }}
        title="Read path runs under default_transaction_read_only + statement_timeout"
      >
        <I.clock width={10} height={10} /> timeout 15s
      </span>
      <div
        className="row"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
          height: 28,
        }}
      >
        <ModePill
          active={!writeMode}
          warn={false}
          icon={<I.lock width={11} height={11} />}
          label="Read-only"
          onClick={() => setWriteMode(false)}
        />
        <div style={{ width: 1, background: "var(--border)" }} />
        <ModePill
          active={writeMode}
          warn
          icon={<I.edit width={11} height={11} />}
          label="Read-write"
          onClick={() => setWriteMode(true)}
        />
      </div>
      <button className={`btn sm ${sqlOpen ? "primary" : ""}`} onClick={() => setSqlOpen(!sqlOpen)}>
        <I.bolt width={11} height={11} /> SQL
      </button>
    </div>
  );
}
function ModePill({
  active,
  warn,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  warn: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="row gap-1"
      style={{
        padding: "0 9px",
        height: "100%",
        fontSize: 12,
        background: active ? (warn ? "var(--warn-bg)" : "var(--bg-overlay)") : "transparent",
        color: active ? (warn ? "var(--warn)" : "var(--fg)") : "var(--fg-3)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {icon} {label}
    </button>
  );
}

// ── Left: tables/views ──────────────────────────────────────────────────────
function TablesSidebar({
  active,
  onSelect,
  flat,
  showCounts,
}: {
  active: string;
  onSelect: (n: string) => void;
  flat: boolean;
  showCounts: boolean;
}) {
  const tables = TABLES.filter((t) => t.kind === "table");
  const views = TABLES.filter((t) => t.kind === "view");
  const Item = ({ t }: { t: TableDef }) => (
    <button
      onClick={() => onSelect(t.name)}
      className="os-nav-item dv-tree"
      style={{
        padding: "5px 8px",
        background: active === t.name ? "var(--bg-overlay)" : undefined,
        color: active === t.name ? "var(--fg)" : "var(--fg-2)",
        fontWeight: active === t.name ? 500 : 400,
      }}
    >
      <span style={{ width: 14, display: "grid", placeItems: "center", opacity: 0.6 }}>
        {t.kind === "view" ? <I.eye width={12} height={12} /> : <I.db width={12} height={12} />}
      </span>
      <span className="mono" style={{ fontSize: 12 }}>
        {t.name}
      </span>
      {showCounts && (
        <span className="count mono" style={{ marginLeft: "auto" }}>
          {fmt(t.rows)}
        </span>
      )}
      <I.copy
        className="dv-copy"
        width={11}
        height={11}
        style={{ marginLeft: showCounts ? 6 : "auto", opacity: 0, color: "var(--fg-3)" }}
      />
    </button>
  );
  return (
    <aside
      style={{
        width: 236,
        flexShrink: 0,
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
        <div className="os-search" style={{ width: "100%", height: 28 }}>
          <I.search width={12} height={12} />
          <span>Search tables…</span>
        </div>
      </div>
      <div className="os-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 8px 16px" }}>
        {!flat && <SchemaLabel text="public" sub="schema" />}
        <div className="col" style={{ gap: 1, marginTop: 2 }}>
          {tables.map((t) => (
            <Item key={t.name} t={t} />
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          {!flat && <SchemaLabel text="views" />}
          <div className="col" style={{ gap: 1, marginTop: 2 }}>
            {views.map((t) => (
              <Item key={t.name} t={t} />
            ))}
          </div>
        </div>
      </div>
      <div
        className="row muted gap-2"
        style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 11 }}
      >
        <span>{tables.length} tables</span>
        <span className="muted-2">·</span>
        <span>{views.length} views</span>
      </div>
    </aside>
  );
}
function SchemaLabel({ text, sub }: { text: string; sub?: string }) {
  return (
    <div
      className="row gap-2"
      style={{
        padding: "4px 8px",
        color: "var(--fg-3)",
        fontSize: 11,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      <I.db width={11} height={11} />
      <span style={{ fontWeight: 600 }}>{text}</span>
      {sub && (
        <span
          className="muted-2"
          style={{ marginLeft: "auto", textTransform: "none", letterSpacing: 0 }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Grid toolbar ─────────────────────────────────────────────────────────────
function GridToolbar({
  table,
  view,
  setView,
  total,
  filtered,
  limit,
  setLimit,
  offset,
  setOffset,
  pages,
  writeMode,
  menu,
  setMenu,
  hidden,
  setHidden,
  filters,
  setFilters,
  selectedCount,
  onAdd,
  settings,
}: {
  table: TableDef;
  view: "grid" | "structure";
  setView: (v: "grid" | "structure") => void;
  total: number;
  filtered: boolean;
  limit: number;
  setLimit: (n: number) => void;
  offset: number;
  setOffset: (n: number) => void;
  pages: boolean;
  writeMode: boolean;
  menu: Menu;
  setMenu: (m: Menu) => void;
  hidden: Set<string>;
  setHidden: (s: Set<string>) => void;
  filters: Filter[];
  setFilters: (f: Filter[]) => void;
  selectedCount: number;
  onAdd: () => void;
  settings: {
    showRowCount: boolean;
    setShowRowCount: (v: boolean) => void;
    flatSchemas: boolean;
    setFlatSchemas: (v: boolean) => void;
    pages: boolean;
    setPages: (v: boolean) => void;
  };
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className="row gap-2"
      style={{
        minHeight: 44,
        padding: "0 10px",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        flexWrap: "wrap",
      }}
    >
      <div
        className="row"
        style={{
          border: "1px solid var(--border)",
          borderRadius: 6,
          overflow: "hidden",
          height: 28,
        }}
      >
        <IconToggle active={view === "grid"} title="Data" onClick={() => setView("grid")}>
          <I.db width={13} height={13} />
        </IconToggle>
        <div style={{ width: 1, background: "var(--border)" }} />
        <IconToggle
          active={view === "structure"}
          title="Structure"
          onClick={() => setView("structure")}
        >
          <I.doc width={13} height={13} />
        </IconToggle>
      </div>
      <button className="btn icon sm ghost" title="Query history">
        <I.clock width={13} height={13} />
      </button>
      <div style={{ width: 1, height: 16, background: "var(--border)" }} />

      {/* Filters */}
      <div style={{ position: "relative" }}>
        <button
          className={`btn sm ${filters.length ? "" : "ghost"}`}
          onClick={(e) => {
            stop(e);
            setMenu(menu === "filters" ? null : "filters");
          }}
          style={filters.length ? { color: "var(--info)" } : undefined}
        >
          <I.filter width={12} height={12} /> Filters{filters.length ? ` · ${filters.length}` : ""}
        </button>
        {menu === "filters" && (
          <FilterBuilder onClick={stop} table={table} filters={filters} setFilters={setFilters} />
        )}
      </div>
      {/* active filter chips */}
      {filters.map((f) => (
        <span
          key={f.id}
          className="badge"
          style={{
            gap: 5,
            background: "var(--info-bg)",
            color: "var(--info)",
            borderColor: "transparent",
          }}
        >
          <span className="mono">
            {f.col} {f.op}
            {f.op.includes("null") ? "" : ` ${f.value}`}
          </span>
          <button onClick={() => setFilters(filters.filter((x) => x.id !== f.id))}>
            <I.x width={9} height={9} />
          </button>
        </span>
      ))}

      {/* Columns */}
      <div style={{ position: "relative" }}>
        <button
          className="btn sm ghost"
          onClick={(e) => {
            stop(e);
            setMenu(menu === "columns" ? null : "columns");
          }}
        >
          <I.metrics width={12} height={12} /> Columns
        </button>
        {menu === "columns" && (
          <Popover onClick={stop} width={210}>
            <div
              className="muted"
              style={{
                fontSize: 10,
                padding: "2px 8px 6px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Toggle columns
            </div>
            {table.columns.map((col) => {
              const on = !hidden.has(col.name);
              return (
                <button
                  key={col.name}
                  className="dv-menu-item"
                  onClick={() => {
                    const n = new Set(hidden);
                    on ? n.add(col.name) : n.delete(col.name);
                    setHidden(n);
                  }}
                >
                  <span style={{ width: 13 }}>{on && <I.check width={12} height={12} />}</span>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {col.name}
                  </span>
                  <span
                    className="mono"
                    style={{ marginLeft: "auto", fontSize: 10, color: TYPE_COLOR[col.type] }}
                  >
                    {col.type}
                  </span>
                </button>
              );
            })}
          </Popover>
        )}
      </div>
      <button
        className="btn sm"
        disabled={!writeMode}
        onClick={onAdd}
        style={{ opacity: writeMode ? 1 : 0.45 }}
      >
        <I.plus width={12} height={12} /> Add record
      </button>

      <div style={{ flex: 1 }} />

      {selectedCount > 0 && (
        <span className="badge info" style={{ gap: 4 }}>
          {selectedCount} selected
        </span>
      )}
      <span className="muted mono" style={{ fontSize: 11 }}>
        {fmt(total)} rows{filtered ? " · filtered" : ""} · 95ms
      </span>
      <button
        className="btn icon sm ghost"
        title="Previous page"
        onClick={() => setOffset(Math.max(0, offset - limit))}
        disabled={offset === 0}
      >
        <I.chev width={12} height={12} style={{ transform: "rotate(180deg)" }} />
      </button>
      <Stepper label="LIMIT" value={limit} onChange={(v) => setLimit(Math.max(1, v))} />
      <Stepper
        label={pages ? "PAGE" : "OFFSET"}
        value={offset}
        onChange={(v) => setOffset(Math.max(0, v))}
      />
      <button
        className="btn icon sm ghost"
        title="Next page"
        onClick={() => setOffset(offset + limit)}
      >
        <I.chev width={12} height={12} />
      </button>
      <button className="btn icon sm ghost" title="Refresh">
        <I.refresh width={12} height={12} />
      </button>

      <div style={{ position: "relative" }}>
        <button
          className="btn icon sm ghost"
          onClick={(e) => {
            stop(e);
            setMenu(menu === "overflow" ? null : "overflow");
          }}
        >
          <I.more width={14} height={14} />
        </button>
        {menu === "overflow" && (
          <Popover onClick={stop} width={232} right>
            <MenuItem icon={<I.refresh width={13} height={13} />} label="Refresh rows" />
            <MenuItem icon={<I.sync width={13} height={13} />} label="Refresh schema" />
            <Sep />
            <MenuItem icon={<I.download width={13} height={13} />} label="Export all to .json" />
            <MenuItem icon={<I.download width={13} height={13} />} label="Export all to .csv" />
            <MenuItem icon={<I.download width={13} height={13} />} label="Export all to .xlsx" />
            <MenuItem
              icon={<I.download width={13} height={13} />}
              label="Export selected to .json"
              disabled={selectedCount === 0}
            />
            <MenuItem
              icon={<I.download width={13} height={13} />}
              label="Export selected to .csv"
              disabled={selectedCount === 0}
            />
          </Popover>
        )}
      </div>
      <div style={{ position: "relative" }}>
        <button
          className="btn icon sm ghost"
          onClick={(e) => {
            stop(e);
            setMenu(menu === "settings" ? null : "settings");
          }}
          title="Viewer settings"
        >
          <I.settings width={13} height={13} />
        </button>
        {menu === "settings" && <SettingsPopover onClick={stop} settings={settings} />}
      </div>
    </div>
  );
}
function IconToggle({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="row"
      style={{
        padding: "0 9px",
        height: "100%",
        background: active ? "var(--bg-overlay)" : "transparent",
        color: active ? "var(--fg)" : "var(--fg-3)",
      }}
    >
      {children}
    </button>
  );
}
function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div
      className="row"
      style={{ border: "1px solid var(--border)", borderRadius: 6, height: 28, overflow: "hidden" }}
    >
      <span
        className="mono muted-2"
        style={{ fontSize: 9, padding: "0 5px", letterSpacing: "0.06em" }}
      >
        {label}
      </span>
      <input
        className="mono"
        value={value}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
        style={{
          width: 42,
          height: "100%",
          textAlign: "center",
          fontSize: 12,
          background: "var(--bg-elev)",
          border: 0,
          borderLeft: "1px solid var(--border)",
          outline: "none",
          color: "var(--fg)",
        }}
      />
    </div>
  );
}

// ── Filter builder ──────────────────────────────────────────────────────────
const OPS: FilterOp[] = ["contains", "=", "!=", ">", "<", "is null", "is not null"];
function FilterBuilder({
  onClick,
  table,
  filters,
  setFilters,
}: {
  onClick: (e: React.MouseEvent) => void;
  table: TableDef;
  filters: Filter[];
  setFilters: (f: Filter[]) => void;
}) {
  const selStyle: React.CSSProperties = {
    height: 26,
    background: "var(--bg-sunken)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    color: "var(--fg)",
    fontSize: 12,
    padding: "0 4px",
    outline: "none",
  };
  const update = (id: string, patch: Partial<Filter>) =>
    setFilters(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const add = () =>
    setFilters([
      ...filters,
      { id: `f${++FID}`, col: table.columns[0].name, op: "contains", value: "" },
    ]);
  return (
    <div
      onClick={onClick}
      className="dv-pop"
      style={{
        position: "absolute",
        top: 34,
        left: 0,
        width: 360,
        zIndex: 80,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-strong)",
        borderRadius: 9,
        boxShadow: "var(--shadow-lg)",
        padding: 10,
      }}
    >
      <div className="row" style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>Filters</span>
        <div style={{ flex: 1 }} />
        {filters.length > 0 && (
          <button className="btn sm ghost" onClick={() => setFilters([])}>
            Clear all
          </button>
        )}
      </div>
      {filters.length === 0 && (
        <div className="muted" style={{ fontSize: 12, padding: "6px 2px 10px" }}>
          No filters. Add one to narrow the rows.
        </div>
      )}
      <div className="col" style={{ gap: 6 }}>
        {filters.map((f) => {
          const col = table.columns.find((cc) => cc.name === f.col);
          const noVal = f.op === "is null" || f.op === "is not null";
          return (
            <div key={f.id} className="row gap-2">
              <select
                value={f.col}
                onChange={(e) => update(f.id, { col: e.target.value })}
                style={{ ...selStyle, width: 120 }}
                className="mono"
              >
                {table.columns.map((cc) => (
                  <option key={cc.name} value={cc.name}>
                    {cc.name}
                  </option>
                ))}
              </select>
              <select
                value={f.op}
                onChange={(e) => update(f.id, { op: e.target.value as FilterOp })}
                style={{ ...selStyle, width: 90 }}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <input
                className="input mono"
                disabled={noVal}
                value={noVal ? "" : f.value}
                placeholder={col ? col.type : ""}
                onChange={(e) => update(f.id, { value: e.target.value })}
                style={{ height: 26, flex: 1, opacity: noVal ? 0.4 : 1 }}
              />
              <button
                className="btn icon sm ghost"
                onClick={() => setFilters(filters.filter((x) => x.id !== f.id))}
              >
                <I.x width={11} height={11} />
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn sm ghost" onClick={add} style={{ marginTop: 8 }}>
        <I.plus width={11} height={11} /> Add filter
      </button>
    </div>
  );
}
function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  if (!filters.length) return rows;
  return rows.filter((r) => filters.every((f) => matchFilter(r[f.col], f)));
}
function matchFilter(v: Cell, f: Filter): boolean {
  if (f.op === "is null") return v === null || v === undefined;
  if (f.op === "is not null") return v !== null && v !== undefined;
  if (v === null || v === undefined) return false;
  const a = String(v).toLowerCase();
  const b = f.value.toLowerCase();
  switch (f.op) {
    case "contains":
      return a.includes(b);
    case "=":
      return a === b;
    case "!=":
      return a !== b;
    case ">":
      return isFinite(Number(v)) && isFinite(Number(f.value)) ? Number(v) > Number(f.value) : a > b;
    case "<":
      return isFinite(Number(v)) && isFinite(Number(f.value)) ? Number(v) < Number(f.value) : a < b;
  }
  return true;
}

// ── Popover primitives ──────────────────────────────────────────────────────
function Popover({
  children,
  onClick,
  width,
  right,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  width: number;
  right?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className="dv-pop"
      style={{
        position: "absolute",
        top: 34,
        [right ? "right" : "left"]: 0,
        width,
        zIndex: 80,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-strong)",
        borderRadius: 9,
        boxShadow: "var(--shadow-lg)",
        padding: 5,
      }}
    >
      {children}
    </div>
  );
}
function MenuItem({
  icon,
  label,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button className="dv-menu-item" disabled={disabled} style={{ opacity: disabled ? 0.4 : 1 }}>
      <span style={{ opacity: 0.7 }}>{icon}</span>
      <span style={{ fontSize: 12.5 }}>{label}</span>
    </button>
  );
}
function Sep() {
  return <div style={{ height: 1, background: "var(--border)", margin: "5px 4px" }} />;
}
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 30,
        height: 17,
        borderRadius: 999,
        background: on ? "var(--ok)" : "var(--border-strong)",
        position: "relative",
        flexShrink: 0,
        transition: "background 120ms",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 15 : 2,
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 120ms",
        }}
      />
    </button>
  );
}
function SettingsPopover({
  onClick,
  settings,
}: {
  onClick: (e: React.MouseEvent) => void;
  settings: {
    showRowCount: boolean;
    setShowRowCount: (v: boolean) => void;
    flatSchemas: boolean;
    setFlatSchemas: (v: boolean) => void;
    pages: boolean;
    setPages: (v: boolean) => void;
  };
}) {
  const Opt = ({
    title,
    desc,
    on,
    set,
  }: {
    title: string;
    desc: string;
    on: boolean;
    set: (v: boolean) => void;
  }) => (
    <div className="row gap-3" style={{ padding: "8px 8px", alignItems: "flex-start" }}>
      <div className="col" style={{ gap: 2, flex: 1 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{title}</span>
        <span className="muted" style={{ fontSize: 11, lineHeight: "15px" }}>
          {desc}
        </span>
      </div>
      <Toggle on={on} onClick={() => set(!on)} />
    </div>
  );
  return (
    <div
      onClick={onClick}
      className="dv-pop"
      style={{
        position: "absolute",
        top: 34,
        right: 0,
        width: 296,
        zIndex: 80,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-strong)",
        borderRadius: 9,
        boxShadow: "var(--shadow-lg)",
        padding: 6,
      }}
    >
      <Opt
        title="Table rows count"
        desc="Beware count(*) performs a light scan that can be slow and billed by serverless databases for row reads."
        on={settings.showRowCount}
        set={settings.setShowRowCount}
      />
      <Sep />
      <div className="col" style={{ gap: 4, padding: "6px 8px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Pagination type</span>
        <div className="row gap-3" style={{ fontSize: 12 }}>
          <button
            className="row gap-1"
            onClick={() => settings.setPages(false)}
            style={{ color: !settings.pages ? "var(--fg)" : "var(--fg-3)" }}
          >
            LIMIT OFFSET {!settings.pages && <I.check width={11} height={11} />}
          </button>
          <button
            onClick={() => settings.setPages(true)}
            style={{ color: settings.pages ? "var(--fg)" : "var(--fg-3)" }}
          >
            PAGES {settings.pages && <I.check width={11} height={11} />}
          </button>
        </div>
      </div>
      <Sep />
      <Opt
        title="Flat schemas"
        desc="Show tables without grouping by schema."
        on={settings.flatSchemas}
        set={settings.setFlatSchemas}
      />
      <Sep />
      <div className="col" style={{ gap: 6, padding: "6px 8px" }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Show bytea as</span>
        <div className="row gap-2" style={{ fontSize: 11 }}>
          <span className="badge mono" style={{ color: "var(--fg)" }}>
            HEX
          </span>
          <I.check width={11} height={11} />
          <span className="badge mono muted">UTF8</span>
        </div>
      </div>
      <Sep />
      <button className="btn sm" style={{ width: "100%", marginTop: 2 }}>
        <I.copy width={11} height={11} /> Copy database schema
      </button>
    </div>
  );
}

// ── Data grid ───────────────────────────────────────────────────────────────
function DataGrid({
  table,
  pkCol,
  rows,
  hidden,
  writeMode,
  edits,
  onEdit,
  selectedRow,
  onSelectRow,
  selected,
  onToggleAll,
  onToggleOne,
  onDeleteSelected,
}: {
  table: TableDef;
  pkCol: string;
  rows: Row[];
  hidden: Set<string>;
  writeMode: boolean;
  edits: Record<string, string>;
  onEdit: (rid: string, col: string, v: string) => void;
  selectedRow: number | null;
  onSelectRow: (i: number) => void;
  selected: Set<string>;
  onToggleAll: () => void;
  onToggleOne: (id: string) => void;
  onDeleteSelected: () => void;
}) {
  const cols = table.columns.filter((x) => !hidden.has(x.name));
  const ids = rows.map((r) => String(r[pkCol]));
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
  const someOn = ids.some((id) => selected.has(id));
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="os-scroll" style={{ flex: 1, overflow: "auto" }}>
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            width: "max-content",
            minWidth: "100%",
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr>
              <Th sticky style={{ width: 34, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOn && someOn;
                  }}
                  onChange={onToggleAll}
                  style={{ accentColor: "var(--info)" }}
                />
              </Th>
              {cols.map((col) => (
                <Th key={col.name} style={NUMERIC(col.type) ? { textAlign: "right" } : undefined}>
                  <span
                    className="row"
                    style={{
                      gap: 5,
                      alignItems: "baseline",
                      justifyContent: NUMERIC(col.type) ? "flex-end" : "space-between",
                    }}
                  >
                    <span className="row gap-1" style={{ alignItems: "baseline" }}>
                      {col.pk && <I.key width={10} height={10} style={{ color: "var(--warn)" }} />}
                      {col.uq && <span className="dv-tag">UQ</span>}
                      {col.fk && <I.link width={10} height={10} style={{ color: "var(--info)" }} />}
                      <span className="mono" style={{ fontWeight: 600, color: "var(--fg)" }}>
                        {col.name}
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: TYPE_COLOR[col.type] }}>
                        {col.type}
                      </span>
                    </span>
                    <I.chevDown width={11} height={11} style={{ color: "var(--fg-4)" }} />
                  </span>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <Td style={{ color: "var(--fg-3)" }}>
                  <span style={{ paddingLeft: 6 }}>No rows match the current filters.</span>
                </Td>
                {cols.map((cc) => (
                  <Td key={cc.name} />
                ))}
              </tr>
            )}
            {rows.map((row, i) => {
              const rid = String(row[pkCol]);
              const sel = selectedRow === i;
              const checked = selected.has(rid);
              return (
                <tr
                  key={rid + i}
                  onClick={() => onSelectRow(i)}
                  className="dv-row"
                  style={{
                    background: sel ? "var(--info-bg)" : checked ? "var(--bg-overlay)" : undefined,
                    cursor: "pointer",
                  }}
                >
                  <Td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleOne(rid)}
                      style={{ accentColor: "var(--info)" }}
                    />
                  </Td>
                  {cols.map((col) => {
                    const k = `${rid}:${col.name}`;
                    const edited = k in edits;
                    const value = edited ? edits[k] : row[col.name];
                    return (
                      <Td
                        key={col.name}
                        edited={edited}
                        style={NUMERIC(col.type) ? { textAlign: "right" } : undefined}
                      >
                        <CellValue
                          col={col}
                          value={value as Cell}
                          editable={writeMode && !col.pk}
                          onCommit={(v) => onEdit(rid, col.name, v)}
                        />
                      </Td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {writeMode && rows.length > 0 && (
          <div className="row" style={{ padding: "6px 12px" }}>
            <button
              onClick={onDeleteSelected}
              className="btn sm ghost"
              style={{ color: "var(--err)" }}
            >
              <I.trash width={11} height={11} /> Delete
              {selected.size ? ` ${selected.size}` : " selected"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function CellValue({
  col,
  value,
  editable,
  onCommit,
}: {
  col: Column;
  value: Cell;
  editable: boolean;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <input
        autoFocus
        className="input mono"
        defaultValue={value == null ? "" : String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onCommit(draft);
          setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onCommit(draft);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          height: 22,
          padding: "0 5px",
          fontSize: 12,
          textAlign: NUMERIC(col.type) ? "right" : "left",
        }}
      />
    );
  }
  return (
    <span
      onDoubleClick={(e) => {
        if (!editable) return;
        e.stopPropagation();
        setDraft(value == null ? "" : String(value));
        setEditing(true);
      }}
      className="dv-cell"
      style={{
        maxWidth: NUMERIC(col.type) ? 140 : 260,
        textAlign: NUMERIC(col.type) ? "right" : "left",
        fontVariantNumeric: NUMERIC(col.type) ? "tabular-nums" : undefined,
      }}
      title={editable ? "Double-click to edit" : undefined}
    >
      {renderValue(col, value)}
    </span>
  );
}
function renderValue(col: Column, value: Cell) {
  if (value === null)
    return <span style={{ color: "var(--fg-4)", fontStyle: "italic" }}>NULL</span>;
  if (col.type === "boolean")
    return (
      <span
        className="badge mono"
        style={{
          height: 17,
          color: value ? "var(--ok)" : "var(--fg-3)",
          background: value ? "var(--ok-bg)" : "var(--bg-overlay)",
          borderColor: "transparent",
        }}
      >
        {String(value)}
      </span>
    );
  if (col.type === "jsonb")
    return (
      <span className="mono" style={{ color: "#c084fc" }}>
        {String(value)}
      </span>
    );
  if (col.type === "timestamp")
    return (
      <span className="mono" style={{ color: "var(--fg-3)" }}>
        {String(value)}
      </span>
    );
  return (
    <span className="mono" style={{ color: "var(--fg)" }}>
      {String(value)}
    </span>
  );
}

// ── Structure view ──────────────────────────────────────────────────────────
function StructureView({
  table,
  showNull,
  setShowNull,
  showDefaults,
  setShowDefaults,
}: {
  table: TableDef;
  showNull: boolean;
  setShowNull: (v: boolean) => void;
  showDefaults: boolean;
  setShowDefaults: (v: boolean) => void;
}) {
  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 18 }}>
      <div style={{ maxWidth: 760 }}>
        <div className="row gap-3" style={{ marginBottom: 14 }}>
          <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
            {table.name}
          </span>
          <span className="badge mono">{fmt(table.rows)} rows</span>
          <span className="badge">{table.kind}</span>
          <div style={{ flex: 1 }} />
          <span className="row gap-2" style={{ fontSize: 12 }}>
            <span className="muted">Nullability</span>
            <Toggle on={showNull} onClick={() => setShowNull(!showNull)} />
          </span>
          <span className="row gap-2" style={{ fontSize: 12 }}>
            <span className="muted">Defaults</span>
            <Toggle on={showDefaults} onClick={() => setShowDefaults(!showDefaults)} />
          </span>
        </div>
        <div className="card">
          {table.columns.map((col, i) => (
            <div
              key={col.name}
              className="row gap-3"
              style={{ padding: "9px 14px", borderTop: i ? "1px solid var(--border)" : undefined }}
            >
              <span style={{ width: 16, display: "grid", placeItems: "center" }}>
                {col.pk ? (
                  <I.key width={11} height={11} style={{ color: "var(--warn)" }} />
                ) : col.fk ? (
                  <I.link width={11} height={11} style={{ color: "var(--info)" }} />
                ) : null}
              </span>
              <div className="col" style={{ gap: 1, minWidth: 170 }}>
                <span className="mono" style={{ fontWeight: 500 }}>
                  {col.name}
                </span>
                {showDefaults && col.def && (
                  <span className="mono muted-2" style={{ fontSize: 10 }}>
                    DEFAULT {col.def}
                  </span>
                )}
              </div>
              <span className="mono" style={{ color: TYPE_COLOR[col.type], minWidth: 90 }}>
                {col.type}
              </span>
              {showNull && (
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {col.nullable ? "nullable" : "not null"}
                </span>
              )}
              <div style={{ flex: 1 }} />
              {col.fk && (
                <span className="badge info" style={{ gap: 4 }}>
                  <I.link width={9} height={9} /> → {col.fk}
                </span>
              )}
              {col.uq && <span className="dv-tag">UQ</span>}
              {col.pk && <span className="badge warn">PK</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Row detail ──────────────────────────────────────────────────────────────
function RowDetailPanel({
  table,
  pkCol,
  row,
  writeMode,
  edits,
  onEdit,
  onClose,
}: {
  table: TableDef;
  pkCol: string;
  row: Row;
  writeMode: boolean;
  edits: Record<string, string>;
  onEdit: (rid: string, col: string, v: string) => void;
  onClose: () => void;
}) {
  const rid = String(row[pkCol]);
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        className="row gap-2"
        style={{
          height: 40,
          padding: "0 12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>Row detail</span>
        <span
          className="badge mono"
          style={{ marginLeft: 4, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {rid}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn icon sm ghost" onClick={onClose}>
          <I.x width={12} height={12} />
        </button>
      </div>
      <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 12 }}>
        <div className="col" style={{ gap: 10 }}>
          {table.columns.map((col) => {
            const k = `${rid}:${col.name}`;
            const edited = k in edits;
            const value = edited ? edits[k] : row[col.name];
            const ro = col.pk || !writeMode;
            return (
              <div key={col.name} className="col" style={{ gap: 4 }}>
                <div className="row gap-1" style={{ fontSize: 11 }}>
                  <span className="mono" style={{ color: "var(--fg-2)", fontWeight: 500 }}>
                    {col.name}
                  </span>
                  <span className="mono" style={{ color: TYPE_COLOR[col.type], fontSize: 10 }}>
                    {col.type}
                  </span>
                  {col.pk && <I.key width={9} height={9} style={{ color: "var(--warn)" }} />}
                  {col.fk && <I.link width={9} height={9} style={{ color: "var(--info)" }} />}
                  {edited && (
                    <span className="badge warn" style={{ height: 15, marginLeft: "auto" }}>
                      edited
                    </span>
                  )}
                </div>
                {ro ? (
                  <div
                    className="mono"
                    style={{
                      fontSize: 12,
                      padding: "5px 8px",
                      background: "var(--bg-sunken)",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      color: value == null ? "var(--fg-4)" : "var(--fg)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {value == null ? "NULL" : String(value)}
                  </div>
                ) : (
                  <input
                    className="input mono"
                    defaultValue={value == null ? "" : String(value)}
                    onChange={(e) => onEdit(rid, col.name, e.target.value)}
                    style={{ height: 28, borderColor: edited ? "var(--warn)" : undefined }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

// ── Add record ──────────────────────────────────────────────────────────────
function AddRecordModal({
  table,
  pkCol,
  onClose,
  onSave,
}: {
  table: TableDef;
  pkCol: string;
  onClose: () => void;
  onSave: (row: Row) => void;
}) {
  const editable = table.columns.filter((col) => !col.pk);
  const [vals, setVals] = useState<Record<string, string>>({});
  const save = () => {
    const row: Row = {};
    for (const col of table.columns) {
      if (col.pk) {
        row[col.name] =
          `${pkCol === "id" ? abbr(table.name) : col.name.slice(0, 4)}_${b36(table.name + Object.values(vals).join(""), table.rows + 1)}`;
        continue;
      }
      const raw = vals[col.name];
      if (raw == null || raw === "") {
        row[col.name] = col.nullable ? null : col.def ? defVal(col) : "";
        continue;
      }
      row[col.name] =
        col.type === "boolean" ? raw === "true" : NUMERIC(col.type) ? Number(raw) : raw;
    }
    onSave(row);
  };
  const inputStyle: React.CSSProperties = { height: 30 };
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: "min(560px, 94vw)",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          className="row gap-2"
          style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}
        >
          <I.plus width={14} height={14} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Add record</span>
          <span className="badge mono" style={{ marginLeft: 2 }}>
            {table.name}
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn icon sm ghost" onClick={onClose}>
            <I.x width={13} height={13} />
          </button>
        </div>
        <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 18 }}>
          <div className="col" style={{ gap: 12 }}>
            <div className="col" style={{ gap: 4 }}>
              <span className="row gap-1" style={{ fontSize: 11 }}>
                <span className="mono" style={{ color: "var(--fg-2)", fontWeight: 500 }}>
                  {pkCol}
                </span>
                <I.key width={9} height={9} style={{ color: "var(--warn)" }} />
                <span className="muted-2" style={{ marginLeft: "auto" }}>
                  auto-generated
                </span>
              </span>
              <div
                className="mono"
                style={{
                  fontSize: 12,
                  padding: "6px 8px",
                  background: "var(--bg-sunken)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  color: "var(--fg-4)",
                }}
              >
                {abbr(table.name)}_…
              </div>
            </div>
            {editable.map((col) => (
              <div key={col.name} className="col" style={{ gap: 4 }}>
                <span className="row gap-1" style={{ fontSize: 11 }}>
                  <span className="mono" style={{ color: "var(--fg-2)", fontWeight: 500 }}>
                    {col.name}
                  </span>
                  <span className="mono" style={{ color: TYPE_COLOR[col.type], fontSize: 10 }}>
                    {col.type}
                  </span>
                  {col.fk && (
                    <span className="badge info" style={{ height: 14, gap: 3 }}>
                      <I.link width={8} height={8} /> {col.fk}
                    </span>
                  )}
                  {!col.nullable && !col.def && (
                    <span className="muted-2" style={{ marginLeft: "auto" }}>
                      required
                    </span>
                  )}
                  {col.nullable && (
                    <span className="muted-2" style={{ marginLeft: "auto" }}>
                      nullable
                    </span>
                  )}
                </span>
                {col.type === "boolean" ? (
                  <select
                    value={vals[col.name] ?? "false"}
                    onChange={(e) => setVals({ ...vals, [col.name]: e.target.value })}
                    className="input mono"
                    style={inputStyle}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                ) : (
                  <input
                    className="input mono"
                    style={inputStyle}
                    placeholder={col.def ? `DEFAULT ${col.def}` : col.nullable ? "NULL" : col.type}
                    value={vals[col.name] ?? ""}
                    onChange={(e) => setVals({ ...vals, [col.name]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <div
          className="row gap-2"
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border)",
            justifyContent: "flex-end",
          }}
        >
          <span className="muted mono row gap-1" style={{ fontSize: 11, marginRight: "auto" }}>
            <I.eye width={10} height={10} /> staged as a pending INSERT — audited on save
          </span>
          <button className="btn sm ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn sm primary" onClick={save}>
            <I.check width={11} height={11} /> Add record
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SQL mode ─────────────────────────────────────────────────────────────────
const SQL_LINES: Array<Array<{ t: string; k?: string }>> = [
  [{ t: "-- Snippets are stored in browser storage, scoped to this database.", k: "cm" }],
  [{ t: "-- New snippets: click +. Playground is always available.", k: "cm" }],
  [],
  [
    { t: "SELECT", k: "kw" },
    { t: " * " },
    { t: "FROM", k: "kw" },
    { t: " account " },
    { t: "WHERE", k: "kw" },
    { t: " provider_id = " },
    { t: "'google'", k: "st" },
    { t: " " },
    { t: "LIMIT", k: "kw" },
    { t: " 50;" },
  ],
  [],
  [
    { t: "ALTER TABLE", k: "kw" },
    { t: ' "asset" ' },
    { t: "ADD COLUMN", k: "kw" },
    { t: ' "criticality" ' },
    { t: "text", k: "ty" },
    { t: ";" },
    { t: " --> statement-breakpoint", k: "cm" },
  ],
  [
    { t: "ALTER TABLE", k: "kw" },
    { t: ' "bia_assessment" ' },
    { t: "ADD COLUMN", k: "kw" },
    { t: ' "mtpd_minutes" ' },
    { t: "integer", k: "ty" },
    { t: " DEFAULT", k: "kw" },
    { t: " 0 " },
    { t: "NOT NULL", k: "kw" },
    { t: ";" },
  ],
];
const RUNNABLE = new Set([3, 5, 6]);
const SQL_RESULT = {
  cols: ["id", "provider_id", "user_id", "enabled"],
  rows: [
    ["acct_dktji8x6tqblf5xko", "google", "usr_xxhvf9hlbmjyi3nrrp", "true"],
    ["acct_jz3o6gvgip26ey8a6", "google", "usr_pd8lkxr18hzjqeqj1l", "true"],
    ["acct_k8m5bksx5wtaisz9i", "google", "usr_pr44rnml6vorn6jdzk", "true"],
    ["acct_lpvj7dr07bkueb5og", "google", "usr_lkloa847qkt5swmndy", "false"],
  ],
};
function SqlMode({
  onBack,
  onDanger,
  showRowCount,
}: {
  onBack: () => void;
  onDanger: () => void;
  showRowCount: boolean;
}) {
  const [resultView, setResultView] = useState<"grid" | "json">("grid");
  const color = (k?: string) =>
    k === "kw"
      ? "var(--info)"
      : k === "st"
        ? "var(--ok)"
        : k === "ty"
          ? "#c084fc"
          : k === "cm"
            ? "var(--fg-4)"
            : "var(--fg)";
  const tables = TABLES.filter((t) => t.kind === "table");
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <aside
        style={{
          width: 190,
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          padding: 10,
          gap: 8,
        }}
      >
        <div
          className="os-search"
          style={{ width: "100%", height: 26, justifyContent: "space-between" }}
        >
          <span>Spotlight…</span>
          <span className="os-kbd">⌘K</span>
        </div>
        <button
          className="row gap-2"
          style={{ padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 7 }}
        >
          <I.db width={13} height={13} />
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>
            Kaitosec Prod
          </span>
        </button>
        <button className="btn sm ghost" onClick={onBack} style={{ justifyContent: "flex-start" }}>
          <I.chev width={12} height={12} style={{ transform: "rotate(180deg)" }} /> Back to Tables
        </button>
        <div className="row gap-2" style={{ marginTop: 4 }}>
          <div className="os-search" style={{ flex: 1, height: 26 }}>
            <I.search width={11} height={11} />
            <span>Search…</span>
          </div>
          <button className="btn icon sm ghost">
            <I.plus width={12} height={12} />
          </button>
        </div>
        <button className="os-nav-item row gap-2" style={{ padding: "5px 8px" }}>
          <I.folder width={13} height={13} style={{ opacity: 0.6 }} />
          <span style={{ fontSize: 12 }}>Playground</span>
        </button>
        <button
          className="os-nav-item row gap-2"
          style={{
            padding: "5px 8px",
            background: "var(--bg-overlay)",
            color: "var(--fg)",
            fontWeight: 500,
          }}
        >
          <I.doc width={13} height={13} />
          <span style={{ fontSize: 12 }}>SQL scratches</span>
        </button>
      </aside>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          className="row gap-2"
          style={{
            height: 40,
            padding: "0 10px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button className="btn icon sm ghost">
            <I.doc width={12} height={12} />
          </button>
          <button className="btn sm ghost">
            <I.bolt width={11} height={11} /> Prettify{" "}
            <span className="os-kbd" style={{ marginLeft: 2 }}>
              ⇧⌥F
            </span>
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn sm"
            style={{ background: "var(--ok)", color: "#04210f", borderColor: "transparent" }}
          >
            <I.bolt width={12} height={12} /> Run{" "}
            <span
              className="os-kbd"
              style={{ marginLeft: 2, background: "transparent", borderColor: "rgba(0,0,0,.2)" }}
            >
              ⌘↵
            </span>
          </button>
          <button className="btn sm ghost" style={{ color: "var(--err)" }} onClick={onDanger}>
            <I.warning width={11} height={11} /> Run dangerous…
          </button>
        </div>
        <div
          className="mono"
          style={{
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: "21px",
            background: "var(--bg-elev)",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
          }}
        >
          <div
            className="col"
            style={{
              textAlign: "right",
              paddingRight: 10,
              userSelect: "none",
              color: "var(--fg-4)",
            }}
          >
            {SQL_LINES.map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <div className="col" style={{ paddingRight: 14, userSelect: "none" }}>
            {SQL_LINES.map((_, i) => (
              <span key={i} style={{ color: "var(--ok)" }}>
                {RUNNABLE.has(i) ? "▸" : " "}
              </span>
            ))}
          </div>
          <div className="col" style={{ minWidth: 0 }}>
            {SQL_LINES.map((line, i) => (
              <span key={i} style={{ whiteSpace: "pre", minHeight: 21 }}>
                {line.map((s, j) => (
                  <span key={j} style={{ color: color(s.k), fontWeight: s.k === "kw" ? 600 : 400 }}>
                    {s.t}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
        <div
          className="row gap-2"
          style={{ padding: "5px 12px", borderBottom: "1px solid var(--border)" }}
        >
          <button
            className="btn icon sm ghost"
            onClick={() => setResultView("grid")}
            style={{ color: resultView === "grid" ? "var(--fg)" : "var(--fg-3)" }}
          >
            <I.db width={12} height={12} />
          </button>
          <button
            className="btn icon sm ghost"
            onClick={() => setResultView("json")}
            style={{ color: resultView === "json" ? "var(--fg)" : "var(--fg-3)" }}
          >
            {"{ }"}
          </button>
          <button className="btn icon sm ghost">
            <I.download width={12} height={12} />
          </button>
          <div style={{ flex: 1 }} />
          <span className="badge ok" style={{ gap: 5 }}>
            <I.check width={10} height={10} /> SELECT {showRowCount ? "4" : "—"}
          </span>
          <span className="muted mono" style={{ fontSize: 11 }}>
            4 rows · 12 ms
          </span>
          <span className="muted mono row gap-1" style={{ fontSize: 11 }}>
            <I.eye width={10} height={10} /> database.query
          </span>
        </div>
        <div className="os-scroll" style={{ flex: 1, overflow: "auto" }}>
          {resultView === "grid" ? (
            <table
              style={{
                borderCollapse: "separate",
                borderSpacing: 0,
                width: "max-content",
                minWidth: "100%",
                fontSize: 12.5,
              }}
            >
              <thead>
                <tr>
                  <Th sticky style={{ width: 34 }} />
                  {SQL_RESULT.cols.map((x) => (
                    <Th key={x}>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--fg)" }}>
                        {x}
                      </span>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SQL_RESULT.rows.map((r, i) => (
                  <tr key={i} className="dv-row">
                    <Td style={{ textAlign: "center", color: "var(--fg-4)" }}>
                      <span className="mono" style={{ fontSize: 10 }}>
                        {i + 1}
                      </span>
                    </Td>
                    {r.map((cell, j) => (
                      <Td key={j}>
                        <span
                          className="mono"
                          style={{ color: j === 3 ? "var(--ok)" : "var(--fg)" }}
                        >
                          {cell}
                        </span>
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre
              className="mono"
              style={{ padding: 14, fontSize: 12, color: "var(--fg-2)", margin: 0 }}
            >
              {JSON.stringify(
                SQL_RESULT.rows.map((r) =>
                  Object.fromEntries(SQL_RESULT.cols.map((cc, k) => [cc, r[k]])),
                ),
                null,
                2,
              )}
            </pre>
          )}
        </div>
      </div>
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div className="row gap-2" style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
          <div className="os-search" style={{ flex: 1, height: 26 }}>
            <I.search width={11} height={11} />
            <span>Search…</span>
          </div>
          <button className="btn icon sm ghost">
            <I.settings width={12} height={12} />
          </button>
        </div>
        <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 8 }}>
          <div className="row gap-2" style={{ padding: "5px 6px" }}>
            <I.db width={12} height={12} style={{ opacity: 0.6 }} />
            <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
              account
            </span>
          </div>
          {TABLES[0].columns.slice(0, 7).map((col) => (
            <div
              key={col.name}
              className="row"
              style={{ padding: "3px 6px 3px 24px", justifyContent: "space-between" }}
            >
              <span className="row gap-1">
                <span className="mono" style={{ fontSize: 12 }}>
                  {col.name}
                </span>
                {col.pk && (
                  <span className="badge warn" style={{ height: 14 }}>
                    PK
                  </span>
                )}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--fg-4)" }}>
                {col.type}
              </span>
            </div>
          ))}
          <div style={{ height: 8 }} />
          {tables.slice(1, 18).map((t) => (
            <div
              key={t.name}
              className="os-nav-item row dv-tree gap-2"
              style={{ padding: "5px 6px" }}
            >
              <I.db width={12} height={12} style={{ opacity: 0.5 }} />
              <span className="mono" style={{ fontSize: 12.5 }}>
                {t.name}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ── Pending changes ─────────────────────────────────────────────────────────
function PendingBar({ count, onDiscard }: { count: number; onDiscard: () => void }) {
  return (
    <div
      className="row gap-3"
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: 18,
        zIndex: 60,
        padding: "8px 10px 8px 14px",
        background: "var(--bg-elev)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <span className="row gap-2">
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warn)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>
          {count} unsaved {count === 1 ? "change" : "changes"}
        </span>
      </span>
      <span className="muted mono" style={{ fontSize: 11 }}>
        staged — nothing written yet
      </span>
      <div style={{ width: 1, height: 18, background: "var(--border)" }} />
      <button className="btn sm ghost" onClick={onDiscard}>
        Discard
      </button>
      <button className="btn sm primary">
        <I.check width={11} height={11} /> Review &amp; save
      </button>
    </div>
  );
}

// ── Destructive confirm ─────────────────────────────────────────────────────
function ConfirmModal({
  info,
  onClose,
}: {
  info: { kind: "drop" | "delete"; label: string };
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const target = info.label;
  const verb = info.kind === "drop" ? "TRUNCATE" : "DELETE FROM";
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "min(460px, 92vw)", padding: 20, boxShadow: "var(--shadow-lg)" }}
      >
        <div className="row gap-2" style={{ marginBottom: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              display: "grid",
              placeItems: "center",
              background: "var(--err-bg)",
              color: "var(--err)",
            }}
          >
            <I.warning width={15} height={15} />
          </span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Destructive statement</span>
        </div>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: "18px", margin: "0 0 14px" }}>
          You are about to run{" "}
          <span className="mono" style={{ color: "var(--err)" }}>
            {verb} {target}
          </span>
          . This is irreversible and runs against live data. It will be recorded in the audit trail
          with your identity.
        </p>
        <div className="col" style={{ gap: 6, marginBottom: 16 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Type{" "}
            <span className="mono" style={{ color: "var(--fg)" }}>
              {target}
            </span>{" "}
            to confirm
          </span>
          <input
            className="input mono"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={target}
          />
        </div>
        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
          <button className="btn sm ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn sm"
            disabled={typed !== target}
            onClick={onClose}
            style={{
              background: typed === target ? "var(--err)" : "var(--bg-overlay)",
              color: typed === target ? "#fff" : "var(--fg-4)",
              borderColor: "transparent",
            }}
          >
            Run {verb}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── table cell primitives ───────────────────────────────────────────────────
function Th({
  children,
  sticky,
  style,
}: {
  children?: React.ReactNode;
  sticky?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <th
      style={{
        position: "sticky",
        top: 0,
        zIndex: sticky ? 3 : 2,
        left: sticky ? 0 : undefined,
        textAlign: "left",
        padding: "7px 12px",
        background: "var(--bg-sunken)",
        borderBottom: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        whiteSpace: "nowrap",
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  edited,
  style,
}: {
  children?: React.ReactNode;
  edited?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        whiteSpace: "nowrap",
        background: edited ? "var(--warn-bg)" : undefined,
        boxShadow: edited ? "inset 0 0 0 1px var(--warn)" : undefined,
        ...style,
      }}
    >
      {children}
    </td>
  );
}

// ── data helpers ────────────────────────────────────────────────────────────
function acct(id: string, accountId: string, userId: string, token: string): Row {
  return {
    id,
    account_id: accountId,
    provider_id: "google",
    user_id: userId,
    access_token: `${token}…`,
    refresh_token: null,
    id_token: null,
    access_token_expires_at: "2026-06-07 09:41:00+00",
    refresh_token_expires_at: null,
    scope: "openid email profile",
    password: null,
    created_at: "2025-11-02 09:14:22+00",
    updated_at: "2026-06-06 22:41:10+00",
  };
}
function bcms(name: string, rows: number, extra: Column[]): TableDef {
  return {
    name,
    kind: "table",
    rows,
    columns: [
      c("id", "text", { pk: true }),
      ...extra,
      c("created_at", "timestamp", { def: "now()" }),
    ],
  };
}
function getRows(table: TableDef, limit: number): Row[] {
  if (table.sample) return table.sample.slice(0, limit);
  const n = Math.min(limit, Math.min(table.rows, 24));
  return Array.from({ length: n }, (_, i) => {
    const row: Row = {};
    for (const col of table.columns) row[col.name] = genVal(col, table.name, i);
    return row;
  });
}
function genVal(col: Column, table: string, i: number): Cell {
  if (col.nullable && i % 5 === 3) return null;
  if (col.pk || col.name.endsWith("_id")) {
    const base = (col.name === "id" ? table : col.name.replace(/_id$/, "")).slice(0, 4);
    return `${base}_${b36(table + col.name, i)}`;
  }
  switch (col.type) {
    case "boolean":
      return (i + col.name.length) % 2 === 0;
    case "integer":
      return ((i + 1) * 37 + col.name.length * 5) % 1000;
    case "numeric":
      return Number((((i + 1) * 1.7) % 10).toFixed(1));
    case "timestamp":
      return `2026-0${(i % 6) + 1}-${pad(((i * 3) % 28) + 1)} 1${i % 9}:${pad((i * 7) % 60)}:00+00`;
    case "jsonb":
      return `{"k${i % 3}":"v${i}"}`;
    default: {
      const words = [
        "primary",
        "draft",
        "active",
        "review",
        "datacenter-a",
        "tier-1",
        "weekly",
        "passed",
        "open",
        "critical",
        "high",
        "medium",
      ];
      if (["status", "state", "kind", "criticality"].includes(col.name))
        return words[(i + col.name.length) % words.length];
      return `${col.name}_${b36(col.name, i)}`;
    }
  }
}
function defVal(col: Column): Cell {
  if (!col.def) return "";
  if (col.def === "now()") return "2026-06-07 09:41:00+00";
  if (col.def === "true") return true;
  if (col.def === "false") return false;
  return col.def.replace(/'/g, "");
}
function abbr(name: string): string {
  return name.replace(/_/g, "").slice(0, 4);
}
function b36(seed: string, i: number): string {
  let h = i + 7;
  for (let k = 0; k < seed.length; k++) h = (h * 31 + seed.charCodeAt(k)) >>> 0;
  return h.toString(36).slice(0, 8);
}
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}
