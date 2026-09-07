/**
 * Where the stack will be reachable: one field, and what it implies.
 *
 * A stack has one address a human types. openstatus has a second (its status
 * page), and a handful of stacks have a third — but the answer is nearly
 * always "name them after the stack", so this asks once and derives the rest
 * as FLAT siblings (`stack-domains.ts` explains why flat and not nested).
 *
 * Derived rows are shown, not hidden: the operator can see every hostname the
 * deploy is about to mint before it happens, which is the thing that was
 * missing. Typing into one pins it (`custom`) and the base stops driving it.
 *
 * Services that are not exposed have no row here at all. They are not a blank
 * to fill in — they address each other as `${{stack.<svc>.HOST}}` over the
 * overlay and never needed a public name.
 */
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

import type { ComposeForm } from "./compose-wizard-shared";

import { AUTO_WRITE } from "./form-context";
import { deriveStackDomain } from "./stack-domains";

type DomainRows = ComposeForm["state"]["values"]["vars"]["domains"];

/** The service half of an `<service>:<port>` exposure key. */
const serviceOf = (key: string): string => key.split(":")[0] ?? key;

export function ComposeDomainsField({ form }: { form: ComposeForm }) {
  const { t } = useTranslation();

  /**
   * Re-derive every row the operator has not pinned.
   *
   * Takes the rows to work FROM rather than reading `form.state`, because
   * `setFieldValue` does not settle synchronously: the reset button clears
   * `custom` and re-derives in the same tick, and reading state back in
   * between saw the pre-clear rows and skipped every one of them.
   */
  const rederiveFrom = (base: string, rows: DomainRows) => {
    const front = serviceOf(rows[0]?.key ?? "");
    form.setFieldValue(
      "vars.domains",
      rows.map((row) => {
        if (row.custom) return row;
        const service = serviceOf(row.key);
        return { ...row, domain: deriveStackDomain(base, service, service === front) };
      }),
      AUTO_WRITE,
    );
  };
  const rederive = (base: string) => rederiveFrom(base, form.state.values.vars.domains);

  return (
    <form.Subscribe selector={(st) => st.values.vars.domains}>
      {(domains) =>
        domains.length === 0 ? null : (
          <div className="flex flex-col gap-3">
            <form.AppField
              name="vars.baseDomain"
              listeners={{ onChange: ({ value }) => rederive(value), onChangeDebounceMs: 120 }}
            >
              {(field) => (
                <field.TextField
                  label={t("compose.domainLabel")}
                  placeholder={t("compose.domainPlaceholder")}
                  description={t("compose.domainHelp")}
                />
              )}
            </form.AppField>

            {domains.length > 1 && (
              <DerivedRows form={form} domains={domains} rederiveFrom={rederiveFrom} />
            )}
          </div>
        )
      }
    </form.Subscribe>
  );
}

function DerivedRows({
  form,
  domains,
  rederiveFrom,
}: {
  form: ComposeForm;
  domains: DomainRows;
  rederiveFrom: (base: string, rows: DomainRows) => void;
}) {
  const { t } = useTranslation();
  // Row 0 IS the base — `file.exposed` is ordered front-door-first — so it is
  // shown by the field above rather than repeated here.
  const rest = domains.slice(1);
  const anyPinned = rest.some((r) => r.custom);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-medium tracking-[0.07em] text-muted-foreground uppercase">
          {t("compose.domainsAlsoLabel")}
        </span>
        <span className="flex-1" />
        {anyPinned && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[11px]"
            onClick={() =>
              rederiveFrom(
                form.state.values.vars.baseDomain,
                domains.map((r) => ({ ...r, custom: false })),
              )
            }
          >
            {t("compose.domainsReset")}
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-md ring-1 ring-foreground/10">
        {rest.map((row, i) => (
          <div
            key={row.key}
            className="flex items-center gap-2 border-b px-2.5 py-1.5 last:border-b-0"
          >
            <span className="w-32 shrink-0 truncate font-mono text-[11.5px] text-muted-foreground">
              {serviceOf(row.key)}
            </span>
            {/* `i + 1`: `rest` is `domains` minus the front door. */}
            <form.AppField name={`vars.domains[${i + 1}].domain`}>
              {(field) => (
                <input
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    form.setFieldValue(`vars.domains[${i + 1}].custom`, true, AUTO_WRITE);
                  }}
                  spellCheck={false}
                  aria-label={serviceOf(row.key)}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none"
                />
              )}
            </form.AppField>
            {row.custom && (
              <span className="shrink-0 font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
                {t("compose.domainsPinned")}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
