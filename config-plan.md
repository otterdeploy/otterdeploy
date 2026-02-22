```ts
import { defaultConfig } from "@otterdeploy/config";

interface Git {
    provider: "github" | "gitlab"
    url: string
}

interface ComposeFile {
    path: string
}

interface Resource {
    kind: "database" | "service" | "application"
    slug: string;
    build: string
    source: Git | ComposeFile
}

export default defineConfig({
  project: "project-1",
  organization: "org-1",
  resources: []

  defaultEnvKeys: {
    NODE: 12,
    DATABASE_URL: 'dss'
  },

  environments: {
    production: {
        env: {

        }
    },
  },
});
```
