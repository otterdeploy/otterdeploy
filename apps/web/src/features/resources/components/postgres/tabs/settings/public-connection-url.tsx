/**
 * The public connection URL on the Public access card. It carries the
 * database password, so the password is masked (the user, host and database
 * stay readable) and the row offers reveal and copy.
 */
import { useTranslation } from "react-i18next";

import { SensitiveValue } from "@/shared/components/sensitive-value";

/** The password as it appears in the URL: as is, or percent-encoded. */
function passwordIn(url: string, password: string): string {
  return url.includes(password) ? password : encodeURIComponent(password);
}

export function PublicConnectionUrlRow({ url, password }: { url: string; password: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4 border-b border-border/40 px-3 py-2.5 last:border-b-0">
      <span className="w-40 shrink-0 text-[12px] text-muted-foreground">
        {t("resources.publicConnectionUrl")}
      </span>
      <SensitiveValue
        density="inline"
        className="flex-1 justify-between text-[12.5px] text-foreground"
        label="connection URL"
        value={url}
        secret={passwordIn(url, password)}
      />
    </div>
  );
}
