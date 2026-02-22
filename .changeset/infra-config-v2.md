---
"@otterdeploy/cli": minor
---

Add YAML config support, structured build/deploy sections, and improved environment inheritance

- YAML config files (`otterdeploy.yaml` / `otterdeploy.yml`) now supported alongside TypeScript
- Resource config uses nested `build` and `deploy` sections instead of flat fields
- Multi-domain support per resource (`domain: ["a.com", "b.com"]`)
- Deep merge inheritance: `exclude` resources, `excludeEnv` vars, `extraLinks`, `removeLinks`
- New deploy options: `startCommand`, `restartPolicy`, `cronSchedule`, `region`, `sleepApplication`, and more
- New builder option: `railpack`
- Removed unused `inngest` and `@orpc/contract` dependencies
