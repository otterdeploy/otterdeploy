import "react-i18next";

import type { resources } from "./config";

declare module "react-i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: (typeof resources)["en"];
  }
}
