# Migration Scaffolding: Infisical-First Secrets

This folder contains phased SQL scaffolding for the Infisical-first redesign.

Execution order:

1. `0005_infisical_additive.sql`
2. `0006_infisical_backfill_dual_write.sql`
3. `0007_infisical_cutover_cleanup.sql`

Notes:

- These scripts are templates and may need adaptation to production data volume.
- Run additive schema first, then backfill and dual-write verification, then cutover.
- Do not run cutover until reference integrity checks are green.
