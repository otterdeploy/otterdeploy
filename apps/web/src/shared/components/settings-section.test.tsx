/**
 * A settings row labels its control: an axe check found every Switch
 * on Instance announced as an unnamed toggle and every Input as an
 * unlabelled field, because the row's title was a bare span. The row is a
 * Base UI field now: its title is the control's <label>. (On the client Base
 * UI also points the switch's aria-labelledby at that label; the server
 * markup checked here carries the label association itself.)
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { SettingsRow } from "./settings-section";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

/** The text of the <label> whose `for` is the id of the element `control` matches. */
function labelOf(html: string, control: RegExp): string {
  const id = /id="([^"]+)"/.exec(control.exec(html)?.[0] ?? "")?.[1] ?? "<none>";
  return new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? "";
}

describe("SettingsRow", () => {
  it("labels a switch with the row title", () => {
    const html = renderToStaticMarkup(
      <SettingsRow title="Passkeys" description="Sign in with a passkey" control={<Switch />} />,
    );
    expect(labelOf(html, /<input[^>]*type="checkbox"[^>]*>/)).toBe("Passkeys");
  });

  it("labels an input with the row title", () => {
    const html = renderToStaticMarkup(
      <SettingsRow title="Public IPv4" control={<Input defaultValue="" />} stacked />,
    );
    expect(labelOf(html, /<input[^>]*data-slot="input"[^>]*>/)).toBe("Public IPv4");
  });

  it("describes the control with the row description", () => {
    const html = renderToStaticMarkup(
      <SettingsRow title="Passkeys" description="Sign in with a passkey" control={<Switch />} />,
    );
    expect(html).toMatch(/<p id="[^"]+"[^>]*>Sign in with a passkey<\/p>/);
  });
});
