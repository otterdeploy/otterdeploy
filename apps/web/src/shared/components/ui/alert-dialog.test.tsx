/**
 * A confirm button keeps the variant its caller gave it. AlertDialogAction
 * used to wrap a caller's `render={<Button variant="destructive" />}` in a
 * second, default-variant Button; both sets of classes landed on one element
 * and the default's Signal Blue fill won, so every destructive confirm
 * (delete an SSH key, an API key, a certificate…) rendered as a primary
 * "do this" button.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { AlertDialogAction } from "./alert-dialog";
import { Button } from "./button";

const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1]?.split(/\s+/) ?? [];

describe("AlertDialogAction", () => {
  it("renders a caller's destructive Button without the default variant", () => {
    const html = renderToStaticMarkup(
      <AlertDialogAction render={<Button variant="destructive" size="sm" />}>
        Delete
      </AlertDialogAction>,
    );
    const classes = classOf(html);
    expect(classes).toContain("text-destructive");
    expect(classes).not.toContain("bg-primary");
    expect(classes).not.toContain("text-primary-foreground");
  });

  it("keeps a caller's own classes on a rendered Button", () => {
    const html = renderToStaticMarkup(
      <AlertDialogAction
        render={<Button variant="ghost" className="bg-destructive/10 text-destructive" />}
      >
        Remove
      </AlertDialogAction>,
    );
    const classes = classOf(html);
    expect(classes).toContain("bg-destructive/10");
    expect(classes).not.toContain("bg-primary");
  });

  it("is a default Button, or the variant it's given, without a render element", () => {
    expect(classOf(renderToStaticMarkup(<AlertDialogAction>Go</AlertDialogAction>))).toContain(
      "bg-primary",
    );
    const destructive = classOf(
      renderToStaticMarkup(<AlertDialogAction variant="destructive">Delete</AlertDialogAction>),
    );
    expect(destructive).toContain("text-destructive");
    expect(destructive).not.toContain("bg-primary");
  });
});
