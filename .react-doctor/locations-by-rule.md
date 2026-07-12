# React Doctor — locations by rule


## Bugs · complexity (31)
- src/features/projects/components/new-resource/compose-wizard-shared.ts:107
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-model.ts:84
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1369
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1461
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1785
- src/shared/components/data-grid/data-grid-cell-variants.tsx:456
- src/shared/components/data-grid/data-grid-cell-variants.tsx:537
- src/shared/components/data-grid/data-grid-cell-variants.tsx:584
- src/shared/components/data-grid/data-grid-cell-variants.tsx:92
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:15
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:87
- src/shared/components/data-grid/data-grid-column-header.tsx:28
- src/shared/components/data-grid/data-grid-row.tsx:223
- src/shared/components/data-grid/data-grid-row.tsx:41
- src/shared/components/data-grid/hooks/use-data-grid.ts:1111
- src/shared/components/data-grid/hooks/use-data-grid.ts:1286
- src/shared/components/data-grid/hooks/use-data-grid.ts:1597
- src/shared/components/data-grid/hooks/use-data-grid.ts:2129
- src/shared/components/data-grid/hooks/use-data-grid.ts:2235
- src/shared/components/data-grid/hooks/use-data-grid.ts:2792
- src/shared/components/data-grid/hooks/use-data-grid.ts:3018
- src/shared/components/data-grid/hooks/use-data-grid.ts:341
- src/shared/components/data-grid/hooks/use-data-grid.ts:514
- src/shared/components/data-grid/hooks/use-data-grid.ts:662
- src/shared/components/data-grid/lib/data-grid.ts:135
- src/shared/components/data-grid/lib/data-grid.ts:189
- src/shared/components/data-grid/lib/data-grid.ts:255
- src/shared/components/data-grid/lib/data-grid.ts:494
- src/shared/components/ui/chart.tsx:138
- src/shared/components/ui/chart.tsx:179
- src/shared/components/ui/markdown.tsx:121

## Performance · refs (30)
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1013
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1016
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1017
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1021
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1022
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1280
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1281
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1404
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1418
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1419
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1429
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1430
- src/shared/components/data-grid/data-grid-cell-variants.tsx:243
- src/shared/components/data-grid/data-grid-cell-variants.tsx:246
- src/shared/components/data-grid/data-grid-cell-variants.tsx:247
- src/shared/components/data-grid/data-grid-cell-variants.tsx:438
- src/shared/components/data-grid/data-grid-cell-variants.tsx:439
- src/shared/components/data-grid/data-grid-cell-variants.tsx:557
- src/shared/components/data-grid/data-grid-cell-variants.tsx:558
- src/shared/components/data-grid/data-grid-cell-variants.tsx:560
- src/shared/components/data-grid/data-grid-cell-variants.tsx:561
- src/shared/components/data-grid/data-grid-cell-variants.tsx:69
- src/shared/components/data-grid/data-grid-cell-variants.tsx:70
- src/shared/components/data-grid/data-grid-cell-variants.tsx:72
- src/shared/components/data-grid/data-grid-cell-variants.tsx:73
- src/shared/components/data-grid/data-grid-cell-variants.tsx:759
- src/shared/components/data-grid/data-grid-cell-variants.tsx:760
- src/shared/components/data-grid/data-grid-cell-variants.tsx:874
- src/shared/components/data-grid/data-grid-cell-variants.tsx:875
- src/shared/components/data-grid/data-grid.tsx:230

## Performance · set-state-in-effect (20)
- src/features/logs/components/logs-histogram.tsx:49
- src/features/logs/data/use-log-stream.ts:61
- src/features/projects/components/networking/caddyfile-viewer.tsx:47
- src/features/projects/components/networking/custom-config-editor.tsx:40
- src/features/projects/components/new-resource/overlay-provider.tsx:50
- src/features/projects/components/new-resource/overlay-provider.tsx:67
- src/features/projects/components/settings/source-section.tsx:47
- src/features/projects/components/settings/state.ts:52
- src/features/projects/components/stack/use-stack-state.ts:43
- src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx:146
- src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx:40
- src/features/resources/components/postgres/tabs/data/studio-results.tsx:53
- src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts:74
- src/features/resources/components/service/tabs/settings/source-card.tsx:161
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx:76
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx:83
- src/routes/_app/$orgSlug/_shell/$projectSlug/deployments.tsx:71
- src/shared/components/data-grid/data-grid-search.tsx:90
- src/shared/components/ui/carousel.tsx:99
- src/shared/hooks/use-mobile.ts:14

## Bugs · no-ref-current-in-render (19)
- src/features/logs/components/use-logs-table.ts:94
- src/features/resources/components/postgres/tabs/data/components/sql-editor.tsx:135
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx:217
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx:227
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx:253
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1017
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1022
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1281
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1419
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1430
- src/shared/components/data-grid/data-grid-cell-variants.tsx:247
- src/shared/components/data-grid/data-grid-cell-variants.tsx:439
- src/shared/components/data-grid/data-grid-cell-variants.tsx:558
- src/shared/components/data-grid/data-grid-cell-variants.tsx:70
- src/shared/components/data-grid/data-grid-cell-variants.tsx:760
- src/shared/components/data-grid/data-grid-cell-variants.tsx:875
- src/shared/components/data-grid/hooks/use-data-grid.ts:2061
- src/shared/components/data-grid/hooks/use-data-grid.ts:2103
- src/shared/components/data-grid/hooks/use-lazy-ref.ts:6

## Bugs · max-lines-per-function (15)
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1369
- src/shared/components/data-grid/data-grid-cell-variants.tsx:225
- src/shared/components/data-grid/data-grid-cell-variants.tsx:49
- src/shared/components/data-grid/data-grid-cell-variants.tsx:537
- src/shared/components/data-grid/data-grid-cell-variants.tsx:979
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:15
- src/shared/components/data-grid/data-grid-column-header.tsx:28
- src/shared/components/data-grid/data-grid-search.tsx:58
- src/shared/components/data-grid/data-grid.tsx:34
- src/shared/components/data-grid/hooks/use-data-grid.ts:1111
- src/shared/components/data-grid/hooks/use-data-grid.ts:137
- src/shared/components/data-grid/hooks/use-data-grid.ts:2235
- src/shared/components/data-grid/hooks/use-data-grid.ts:2985
- src/shared/components/data-grid/hooks/use-data-grid.ts:662
- src/shared/components/ui/calendar.tsx:11

## Performance · todo (12)
- src/features/api-keys/scope-picker.tsx:28
- src/features/logs/data/use-log-stream.ts:78
- src/features/projects/hooks/use-project-events.ts:66
- src/features/resources/components/postgres/tabs/settings/danger-zone.tsx:28
- src/features/resources/components/service/tabs/settings/danger-zone.tsx:34
- src/features/volumes/remove-volume-dialog.tsx:55
- src/features/webhooks/secret-reveal.tsx:34
- src/routes/_app/$orgSlug/_shell/terminal.tsx:64
- src/routes/_app/$orgSlug/settings/workspace/notifications.tsx:59
- src/routes/terminal.tsx:93
- src/shared/components/ui/calendar.tsx:31
- src/shared/components/ui/calendar.tsx:32

## Bugs · max-lines (8)
- src/features/onboarding/steps.tsx:357
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId/deployment/-components/deployment-detail.tsx:445
- src/shared/components/data-grid/data-grid-cell-variants.tsx:2018
- src/shared/components/data-grid/hooks/use-data-grid.ts:3302
- src/shared/components/data-grid/lib/data-grid.ts:506
- src/shared/components/ui/chart.tsx:339
- src/shared/components/ui/combobox.tsx:273
- src/shared/components/ui/sidebar.tsx:697

## Bugs · effect-needs-cleanup (5)
- src/features/terminal/components/terminal-session.tsx:120
- src/features/terminal/components/terminal-session.tsx:125
- src/shared/components/data-grid/hooks/use-data-grid.ts:2985
- src/shared/components/ui/carousel.tsx:97
- src/shared/components/ui/tabs.tsx:175

## Bugs · no-impure-state-updater (5)
- src/routes/_app/$orgSlug/_shell/terminal.tsx:57
- src/routes/terminal.tsx:86
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1030
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1049
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1110

## Performance · incompatible-library (2)
- src/features/logs/components/use-logs-table.ts:71
- src/shared/components/data-grid/hooks/use-data-grid.ts:2058

## Security · artifact-secret-leak (1)
- dist/assets/certificates--l7hZQWq.js:3

## Performance · use-memo (1)
- src/shared/components/data-grid/lib/compose-refs.ts:63

## Performance · no-layout-property-animation (1)
- src/shared/components/ui/tabs.tsx:239

## Maintainability · react-compiler-no-manual-memoization (154)
- src/features/databases/databases-page.tsx:41
- src/features/databases/databases-page.tsx:45
- src/features/databases/databases-page.tsx:51
- src/features/edge-logs/components/edge-events-view.tsx:56
- src/features/edge-logs/components/edge-logs-view-parts.tsx:23
- src/features/edge-logs/components/edge-logs-view.tsx:58
- src/features/edge-logs/components/edge-logs-view.tsx:65
- src/features/edge-logs/components/edge-logs-view.tsx:72
- src/features/edge-logs/data/use-edge-bans.ts:19
- src/features/firewall/components/flagged-panel.tsx:38
- src/features/git-providers/connect-dialog.tsx:71
- src/features/logs/components/log-details-panel.tsx:43
- src/features/logs/components/log-viewer.tsx:125
- src/features/logs/components/log-viewer.tsx:137
- src/features/logs/components/log-viewer.tsx:143
- src/features/logs/components/log-viewer.tsx:144
- src/features/logs/components/log-viewer.tsx:148
- src/features/logs/data/use-project-log-stream.ts:156
- src/features/projects/components/new-resource/steps/resources-placement.tsx:40
- src/features/projects/components/new-resource/steps/resources-placement.tsx:50
- src/features/projects/components/new-resource/wizard-form.ts:151
- src/features/projects/components/new-resource/wizard-form.ts:158
- src/features/projects/components/new-resource/wizard-form.ts:171
- src/features/projects/components/new-resource/wizard-provisioner.ts:124
- src/features/projects/components/new-resource/wizard-provisioner.ts:91
- src/features/projects/components/new-resource/wizard-provisioner.ts:99
- src/features/projects/components/new-resource/wizard.tsx:107
- src/features/projects/components/stack/traffic-panel.tsx:40
- src/features/projects/components/stack/use-panel-state.ts:101
- src/features/projects/components/stack/use-panel-state.ts:89
- src/features/projects/components/stack/use-panel-state.ts:90
- src/features/projects/components/stack/use-panel-state.ts:92
- src/features/projects/components/stack/yaml-editor.tsx:25
- src/features/projects/components/stack/yaml-view.tsx:83
- src/features/projects/components/variables/reference-picker.tsx:114
- src/features/projects/components/variables/reference-picker.tsx:99
- src/features/resources/components/_shared/metrics/use-project-metrics.ts:200
- src/features/resources/components/_shared/metrics/use-project-metrics.ts:96
- src/features/resources/components/_shared/metrics/use-resource-metrics.ts:94
- src/features/resources/components/_shared/resource-terminal.tsx:50
- src/features/resources/components/_shared/variables-editor/bulk-edit-dialog.tsx:45
- src/features/resources/components/_shared/variables-editor/bulk-edit-dialog.tsx:51
- src/features/resources/components/_shared/variables-editor/bulk-edit-dialog.tsx:52
- src/features/resources/components/_shared/variables-editor/use-editor-state.ts:140
- src/features/resources/components/_shared/variables-editor/use-editor-state.ts:71
- src/features/resources/components/postgres/tabs/data/components/dice-grid-columns.tsx:36
- src/features/resources/components/postgres/tabs/data/components/results-panel.tsx:99
- src/features/resources/components/postgres/tabs/data/components/sql-editor.tsx:137
- src/features/resources/components/postgres/tabs/data/data/query-history.ts:63
- src/features/resources/components/postgres/tabs/data/data/query-history.ts:74
- src/features/resources/components/postgres/tabs/data/data/use-database.ts:161
- src/features/resources/components/postgres/tabs/data/data/use-database.ts:172
- src/features/resources/components/postgres/tabs/data/data/use-database.ts:181
- src/features/resources/components/postgres/tabs/data/data/use-database.ts:224
- src/features/resources/components/postgres/tabs/data/data/use-database.ts:75
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:118
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:128
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:141
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:150
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:164
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:180
- src/features/resources/components/postgres/tabs/data/data/use-sql-snippets.ts:192
- src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts:144
- src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts:205
- src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts:222
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:147
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:74
- src/features/resources/components/postgres/tabs/variables/index.tsx:152
- src/features/resources/components/postgres/tabs/variables/index.tsx:45
- src/features/resources/components/postgres/tabs/variables/index.tsx:46
- src/features/resources/components/redis/tabs/data/index.tsx:100
- src/features/resources/components/service/tabs/logs.tsx:113
- src/features/resources/components/service/tabs/logs.tsx:116
- src/features/ssh-keys/import-dialog.tsx:167
- src/features/templates/components/template-detail-dialog.tsx:75
- src/features/templates/components/templates-gallery.tsx:48
- src/features/templates/components/templates-gallery.tsx:49
- src/features/terminal/components/open-terminal-dialog.tsx:58
- src/features/terminal/components/open-terminal-dialog.tsx:82
- src/features/terminal/components/open-terminal-dialog.tsx:98
- src/features/terminal/components/terminal-session.tsx:108
- src/routes/_app/$orgSlug/-components/audit-filters.tsx:250
- src/routes/_app/$orgSlug/-components/audit-filters.tsx:70
- src/routes/_app/$orgSlug/-components/audit-filters.tsx:77
- src/routes/_app/$orgSlug/-components/audit-filters.tsx:85
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/networking-routes-tab.tsx:48
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-overview.tsx:44
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-model.ts:174
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-model.ts:184
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-model.ts:207
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-model.ts:250
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-model.ts:261
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx:170
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx:209
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/layout.tsx:264
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:124
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:43
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:63
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:74
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:81
- src/routes/_app/$orgSlug/_shell/$projectSlug/networking.tsx:71
- src/routes/_app/$orgSlug/_shell/$projectSlug/variables.tsx:60
- src/routes/_app/$orgSlug/_shell/$projectSlug/variables.tsx:70
- src/routes/_app/$orgSlug/_shell/audit.tsx:56
- src/routes/_app/$orgSlug/_shell/audit.tsx:70
- src/routes/_app/$orgSlug/_shell/audit.tsx:71
- src/routes/_app/$orgSlug/_shell/backups.tsx:66
- src/routes/_app/$orgSlug/_shell/backups.tsx:73
- src/routes/_app/$orgSlug/_shell/backups.tsx:80
- src/routes/_app/$orgSlug/_shell/docker.tsx:106
- src/routes/_app/$orgSlug/_shell/docker.tsx:122
- src/routes/_app/$orgSlug/_shell/docker.tsx:76
- src/routes/_app/$orgSlug/_shell/docker.tsx:77
- src/routes/_app/$orgSlug/_shell/docker.tsx:86
- src/routes/_app/$orgSlug/_shell/servers.tsx:58
- src/routes/_app/$orgSlug/_shell/servers.tsx:64
- src/routes/_app/$orgSlug/_shell/servers.tsx:74
- src/routes/_app/$orgSlug/_shell/servers.tsx:81
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:131
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:140
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:146
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:35
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:52
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:67
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:76
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:86
- src/shared/components/data-grid/data-grid-column-header.tsx:236
- src/shared/components/data-grid/data-grid-column-header.tsx:51
- src/shared/components/data-grid/data-grid-column-header.tsx:72
- src/shared/components/data-grid/data-grid-column-header.tsx:76
- src/shared/components/data-grid/data-grid-column-header.tsx:80
- src/shared/components/data-grid/data-grid-column-header.tsx:84
- src/shared/components/data-grid/data-grid-column-header.tsx:88
- src/shared/components/data-grid/data-grid-context-menu.tsx:113
- src/shared/components/data-grid/data-grid-context-menu.tsx:131
- src/shared/components/data-grid/data-grid-context-menu.tsx:135
- src/shared/components/data-grid/data-grid-context-menu.tsx:139
- src/shared/components/data-grid/data-grid-context-menu.tsx:174
- src/shared/components/data-grid/data-grid-paste-dialog.tsx:65
- src/shared/components/data-grid/data-grid-paste-dialog.tsx:72
- src/shared/components/data-grid/data-grid-paste-dialog.tsx:76
- src/shared/components/data-grid/data-grid-row.tsx:170
- src/shared/components/data-grid/data-grid-row.tsx:191
- src/shared/components/data-grid/hooks/use-badge-overflow.ts:116
- src/shared/components/data-grid/hooks/use-callback-ref.ts:19
- src/shared/components/data-grid/hooks/use-data-grid.ts:99
- src/shared/components/data-grid/hooks/use-debounced-callback.ts:17
- src/shared/components/ui/chart.tsx:138
- src/shared/components/ui/dialog.tsx:39
- src/shared/components/ui/field.tsx:175
- src/shared/components/ui/json-view.tsx:74
- src/shared/components/ui/sidebar.tsx:111
- src/shared/components/ui/sidebar.tsx:74
- src/shared/components/ui/sidebar.tsx:90

## Bugs · exhaustive-deps (49)
- src/features/edge-logs/components/edge-logs-view.tsx:60
- src/features/edge-logs/components/edge-logs-view.tsx:70
- src/features/firewall/components/flagged-panel.tsx:44
- src/features/logs/data/use-log-stream.ts:59
- src/features/notifications/delivery-history-dialog.tsx:47
- src/features/projects/components/new-resource/overlay-provider.tsx:52
- src/features/projects/components/new-resource/overlay-provider.tsx:75
- src/features/projects/components/new-resource/steps/source-pickers.tsx:113
- src/features/projects/components/new-resource/steps/variables.tsx:52
- src/features/resources/components/_shared/metrics/use-project-metrics.ts:128
- src/features/resources/components/_shared/metrics/use-resource-metrics.ts:143
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:148
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:149
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:185
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:189
- src/routes/_app/$orgSlug/_shell/$projectSlug/deployments.tsx:75
- src/routes/_app/$orgSlug/_shell/audit.tsx:57
- src/routes/_app/$orgSlug/_shell/audit.tsx:58
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1414
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1585
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1631
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1663
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:47
- src/shared/components/data-grid/data-grid-row.tsx:181
- src/shared/components/data-grid/data-grid-row.tsx:193
- src/shared/components/data-grid/hooks/use-data-grid.ts:2073
- src/shared/components/data-grid/hooks/use-data-grid.ts:2092
- src/shared/components/data-grid/hooks/use-data-grid.ts:3273
- src/shared/components/data-grid/lib/compose-refs.ts:63
- src/shared/components/ui/sidebar.tsx:121
- src/shared/components/ui/sidebar.tsx:86

## Maintainability · only-export-components (47)
- src/features/backups/backup-now-parts.tsx:22
- src/features/backups/destination-fields.tsx:15
- src/features/backups/destination-fields.tsx:67
- src/features/backups/destination-fields.tsx:80
- src/features/command-palette/components/nav-items.tsx:46
- src/features/command-palette/components/nav-items.tsx:96
- src/features/edge-logs/components/edge-events-view-parts.tsx:16
- src/features/edge-logs/components/edge-events-view-parts.tsx:17
- src/features/edge-logs/components/edge-events-view-parts.tsx:21
- src/features/edge-logs/components/edge-events-view-parts.tsx:27
- src/features/edge-logs/components/edge-logs-shared.tsx:4
- src/features/edge-logs/components/edge-logs-shared.tsx:8
- src/features/edge-logs/components/edge-logs-view-parts.tsx:170
- src/features/logs/components/ansi.tsx:24
- src/features/logs/components/log-toolbar.tsx:24
- src/features/notifications/channel-fields.tsx:13
- src/features/projects/components/networking/route-access-shared.tsx:27
- src/features/projects/components/networking/route-access-shared.tsx:51
- src/features/projects/components/networking/route-access-shared.tsx:55
- src/features/projects/components/networking/route-access-shared.tsx:59
- src/features/projects/components/networking/route-access-shared.tsx:65
- src/features/projects/components/new-resource/form-fields/variables-field-parts.tsx:26
- src/features/projects/components/new-resource/form-fields/variables-field-parts.tsx:45
- src/features/projects/components/new-resource/steps/source-pickers.tsx:83
- src/features/projects/components/new-resource/wizard-chrome.tsx:33
- src/features/resources/components/compose/panel-parts.tsx:50
- src/features/resources/components/compose/panel-parts.tsx:69
- src/features/resources/components/postgres/tabs/data/components/type-label.tsx:9
- src/features/resources/components/redis/tabs/data/studio-atoms.tsx:64
- src/features/resources/components/redis/tabs/data/studio-atoms.tsx:70
- src/features/resources/components/redis/tabs/data/studio-atoms.tsx:78
- src/features/resources/components/redis/tabs/data/studio-atoms.tsx:89
- src/features/resources/components/service/tabs/overview-parts.tsx:46
- src/features/resources/components/service/tabs/settings/build-card-shared.tsx:113
- src/features/resources/components/service/tabs/settings/build-card-shared.tsx:20
- src/features/resources/components/service/tabs/settings/build-card-shared.tsx:53
- src/features/resources/components/service/tabs/settings/build-card-shared.tsx:97
- src/features/shell/components/nav/two-factor-panels.tsx:9
- src/features/templates/components/template-arch-diagram.tsx:35
- src/features/terminal/components/open-terminal-tabs.tsx:12
- src/routes/_app/$orgSlug/-components/servers-health-pool.tsx:15
- src/routes/_app/$orgSlug/-components/servers-swarm-actions.tsx:20
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/$resourceId/deployment/-components/deployment-tabs.tsx:24
- src/shared/components/ui/button-group.tsx:81
- src/shared/components/ui/button.tsx:58
- src/shared/components/ui/navigation-menu.tsx:162
- src/shared/components/ui/tabs.tsx:250

## Maintainability · unused-file (34)
- src/features/auth/components/auth-shell.tsx:0
- src/features/auth/components/create-organization-form.tsx:0
- src/features/git-providers/installation-actions.tsx:0
- src/features/onboarding/steps.tsx:0
- src/features/projects/components/settings/registry-section.tsx:0
- src/features/projects/components/settings/source-section.tsx:0
- src/features/projects/components/settings/state.ts:0
- src/features/resources/components/_shared/task-logs-tail.tsx:0
- src/features/shell/components/placeholder.tsx:0
- src/shared/components/brand/brand-wordmark.tsx:0
- src/shared/components/ui/accordion.tsx:0
- src/shared/components/ui/aspect-ratio.tsx:0
- src/shared/components/ui/breadcrumb.tsx:0
- src/shared/components/ui/button-group.tsx:0
- src/shared/components/ui/carousel.tsx:0
- src/shared/components/ui/collapsible.tsx:0
- src/shared/components/ui/context-menu.tsx:0
- src/shared/components/ui/direction.tsx:0
- src/shared/components/ui/drawer.tsx:0
- src/shared/components/ui/hover-card.tsx:0
- src/shared/components/ui/input-otp.tsx:0
- src/shared/components/ui/item.tsx:0
- src/shared/components/ui/menubar.tsx:0
- src/shared/components/ui/navigation-menu.tsx:0
- src/shared/components/ui/slider.tsx:0
- src/shared/components/ui/svgs/aws.tsx:0
- src/shared/components/ui/svgs/github-wordmark-dark.tsx:0
- src/shared/components/ui/svgs/github-wordmark-light.tsx:0
- src/shared/components/ui/svgs/mysql-wordmark-dark.tsx:0
- src/shared/components/ui/svgs/mysql-wordmark-light.tsx:0
- src/shared/components/ui/svgs/postgresql-wordmark-dark.tsx:0
- src/shared/components/ui/svgs/postgresql-wordmark-light.tsx:0
- src/shared/components/ui/svgs/slack-wordmark.tsx:0
- src/shared/lib/where.ts:0

## Performance · js-combine-iterations (26)
- src/features/certificates/data/certificates.ts:49
- src/features/edge-logs/components/edge-logs-view.tsx:67
- src/features/edge-logs/data/use-edge-bans.ts:22
- src/features/firewall/components/flagged-panel.tsx:40
- src/features/projects/components/new-resource/compose-wizard.tsx:68
- src/features/projects/components/new-resource/to-manifest.ts:88
- src/features/projects/components/new-resource/wizard-chrome.tsx:125
- src/features/projects/components/pending-changes-bar.tsx:79
- src/features/projects/components/pending-changes-groups.ts:116
- src/features/resources/components/_shared/variables-editor/index.tsx:81
- src/features/resources/components/_shared/variables-editor/index.tsx:84
- src/features/resources/components/_shared/variables-editor/use-editor-state.ts:106
- src/features/resources/components/_shared/variables-editor/use-editor-state.ts:127
- src/features/resources/components/compose/exposed-editor.tsx:39
- src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx:168
- src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx:89
- src/features/resources/components/postgres/tabs/data/data/filters.ts:116
- src/features/team/data/use-team.ts:136
- src/features/templates/components/template-arch-diagram.tsx:79
- src/features/templates/components/template-detail-sections.tsx:32
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/networking-routes-tab.tsx:57
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:65
- src/shared/components/data-grid/hooks/use-data-grid.ts:2113
- src/shared/components/data-grid/lib/data-grid.ts:352
- src/shared/components/ui/chart.tsx:177
- src/shared/components/ui/chart.tsx:276

## Bugs · no-array-index-as-key (25)
- src/features/certificates/cas-table.tsx:121
- src/features/certificates/custom-table.tsx:98
- src/features/logs/components/logs-histogram.tsx:132
- src/features/projects/components/networking/caddyfile-viewer.tsx:125
- src/features/projects/components/new-resource/compose-extra-files.tsx:42
- src/features/projects/components/new-resource/compose-preview.tsx:110
- src/features/projects/components/new-resource/form-fields/number-field.tsx:32
- src/features/projects/components/new-resource/form-fields/ports-field.tsx:53
- src/features/projects/components/new-resource/form-fields/select-field.tsx:47
- src/features/projects/components/new-resource/form-fields/switch-field.tsx:24
- src/features/projects/components/new-resource/form-fields/text-field.tsx:37
- src/features/projects/components/new-resource/form-fields/variables-field.tsx:82
- src/features/projects/components/pending-changes-bar.tsx:178
- src/features/projects/components/stack/yaml-view.tsx:89
- src/features/resources/components/mariadb/tabs/data/table-browser.tsx:184
- src/features/resources/components/mongo/tabs/data/index.tsx:226
- src/features/resources/components/redis/tabs/data/studio-parts.tsx:226
- src/features/ssh-keys/key-card.tsx:207
- src/features/volumes/create-volume-dialog.tsx:219
- src/routes/_app/$orgSlug/-components/docker-dialogs.tsx:196
- src/routes/_app/$orgSlug/-components/docker-panel.tsx:174
- src/routes/_app/$orgSlug/_shell/$projectSlug/graph/-components/graph-skeleton.tsx:33
- src/shared/components/ui/chart.tsx:186
- src/shared/components/ui/chart.tsx:284
- src/shared/components/ui/field.tsx:192

## Bugs · no-unused-vars (19)
- src/features/git-providers/connect-dialog.tsx:33
- src/features/logs/components/log-viewer.tsx:14
- src/features/logs/components/log-viewer.tsx:15
- src/features/logs/components/log-viewer.tsx:16
- src/features/logs/components/log-viewer.tsx:17
- src/features/logs/components/log-viewer.tsx:19
- src/features/projects/components/new-resource/compose-wizard-fields.tsx:7
- src/features/projects/hooks/use-manifest-stage.ts:126
- src/features/resources/components/_shared/task-logs-tail.tsx:23
- src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx:36
- src/features/resources/data/resource.ts:100
- src/shared/components/data-grid/direction.tsx:11
- src/shared/components/data-grid/hooks/use-badge-overflow.ts:174
- src/shared/components/ui/alert.tsx:38
- src/shared/components/ui/alert.tsx:64
- src/shared/components/ui/card.tsx:59
- src/shared/components/ui/card.tsx:79
- src/shared/components/ui/native-select.tsx:49
- src/shared/components/ui/toggle.tsx:30

## Maintainability · no-many-boolean-props (16)
- src/features/projects/components/new-resource/compose-wizard-body.tsx:124
- src/features/projects/components/new-resource/wizard-chrome.tsx:133
- src/features/resources/components/mariadb/tabs/data/table-browser.tsx:96
- src/features/resources/components/mongo/tabs/data/index.tsx:138
- src/features/resources/components/postgres/tabs/data/components/results-panel.tsx:69
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1262
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1369
- src/shared/components/data-grid/data-grid-cell-variants.tsx:225
- src/shared/components/data-grid/data-grid-cell-variants.tsx:411
- src/shared/components/data-grid/data-grid-cell-variants.tsx:49
- src/shared/components/data-grid/data-grid-cell-variants.tsx:537
- src/shared/components/data-grid/data-grid-cell-variants.tsx:742
- src/shared/components/data-grid/data-grid-cell-variants.tsx:847
- src/shared/components/data-grid/data-grid-cell-variants.tsx:979
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:15
- src/shared/components/data-grid/data-grid-cell.tsx:45

## Accessibility · label-has-associated-control (13)
- src/features/projects/components/new-resource/steps/source-pickers.tsx:52
- src/features/projects/components/new-resource/steps/source.tsx:141
- src/features/projects/components/new-resource/steps/source.tsx:153
- src/features/resources/components/postgres/tabs/data/studio-sql-toolbar.tsx:112
- src/routes/_app/$orgSlug/-components/settings-cloudflare.tsx:205
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:103
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:117
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:132
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:148
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:163
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:21
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:45
- src/routes/_app/$orgSlug/-components/settings-email-fields.tsx:64

## Maintainability · prefer-module-scope-pure-function (10)
- src/features/auth/components/social-sign-in.tsx:33
- src/features/git-providers/installation-actions.tsx:27
- src/features/projects/components/networking/route-access-guests.tsx:100
- src/features/ssh-keys/key-card.tsx:50
- src/routes/_app/$orgSlug/-components/docker-table-containers.tsx:40
- src/routes/_app/$orgSlug/-components/servers-live-cell.tsx:15
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:129
- src/routes/_app/$orgSlug/_shell/platform.tsx:76
- src/routes/_app/$orgSlug/settings/workspace/certificates.tsx:59
- src/routes/_app/$orgSlug/settings/workspace/notifications.tsx:119

## Maintainability · unused-export (9)
- src/features/databases/shared.tsx:59
- src/features/projects/components/new-resource/form-context.ts:40
- src/features/resources/components/_shared/staged-panel.tsx:109
- src/features/resources/data/service-domains.ts:44
- src/features/shell/components/sidebar/index.tsx:22
- src/features/terminal/components/session-tab.tsx:37
- src/features/terminal/components/session-tab.tsx:71
- src/features/volumes/data/volumes.ts:32
- src/features/webhooks/shared.ts:23

## Bugs · prefer-vite-plus-imports (8)
- src/features/account/data/use-account.test.ts:1
- src/features/firewall/duration.test.ts:1
- src/features/logs/components/log-severity.test.ts:1
- src/features/notifications/shared.test.ts:1
- src/features/resources/components/postgres/tabs/data/data/destructive-sql.test.ts:1
- src/features/resources/components/postgres/tabs/data/data/filters.test.ts:1
- src/features/resources/components/postgres/tabs/data/data/insert.test.ts:1
- src/features/resources/components/postgres/tabs/data/data/query-history.test.ts:1

## Performance · rendering-svg-precision (8)
- src/shared/components/ui/svgs/excalidraw.tsx:9
- src/shared/components/ui/svgs/minio.tsx:9
- src/shared/components/ui/svgs/n8n.tsx:9
- src/shared/components/ui/svgs/nocodb.tsx:9
- src/shared/components/ui/svgs/nuxt.tsx:6
- src/shared/components/ui/svgs/plausible.tsx:9
- src/shared/components/ui/svgs/rust.tsx:6
- src/shared/components/ui/svgs/vaultwarden.tsx:9

## Maintainability · circular-dependency (7)
- src/features/projects/components/new-resource/form-context.ts:0

## Performance · js-tosorted-immutable (6)
- src/features/account/sessions-card.tsx:29
- src/features/logs/data/use-project-log-stream.ts:116
- src/features/resources/components/_shared/variables-editor/dotenv-parse.ts:48
- src/features/templates/catalog/filter.ts:39
- src/features/templates/catalog/filter.ts:40
- src/routes/_app/$orgSlug/-components/servers-managers-card.tsx:34

## Performance · js-set-map-lookups (6)
- src/features/api-keys/scope-picker.tsx:57
- src/features/backups/multi-combobox.tsx:114
- src/features/edge-logs/components/host-filter.tsx:74
- src/features/resources/components/compose/exposed-editor.tsx:154
- src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx:183
- src/routes/_app/$orgSlug/_shell/servers.tsx:85

## Accessibility · control-has-associated-label (6)
- src/features/logs/components/logs-histogram.tsx:195
- src/features/projects/components/networking/caddy-code-editor.tsx:134
- src/features/projects/components/stack/yaml-editor.tsx:52
- src/features/resources/components/compose/exposed-editor.tsx:147
- src/features/resources/components/postgres/tabs/data/components/snippet-tree-rows.tsx:65
- src/shared/components/data-grid/data-grid-cell-variants.tsx:519

## Performance · prefer-dynamic-import (6)
- src/features/projects/components/new-resource/compose-wizard-editor.ts:10
- src/features/resources/components/_shared/metrics/metric-area-chart.tsx:11
- src/features/resources/components/compose/panel-tabs.tsx:9
- src/features/resources/components/postgres/tabs/data/components/sql-editor.tsx:15
- src/features/resources/components/postgres/tabs/data/components/sql-editor.tsx:16
- src/shared/components/ui/chart.tsx:5

## Bugs · no-chain-state-updates (4)
- src/features/logs/components/use-logs-table.ts:108
- src/features/projects/components/networking/caddyfile-viewer.tsx:47
- src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx:40
- src/features/resources/components/postgres/tabs/data/use-data-studio.ts:187

## Performance · async-await-in-loop (4)
- src/features/resources/components/postgres/tabs/data/components/dice-grid.tsx:186
- src/features/resources/components/postgres/tabs/data/use-data-studio-helpers.ts:163
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx:32
- src/shared/components/data-grid/hooks/use-data-grid.ts:711

## Performance · rerender-lazy-state-init (4)
- src/features/resources/components/service/tabs/settings/build-card-forms.tsx:192
- src/features/resources/components/service/tabs/settings/deploy-hooks-card.tsx:92
- src/features/resources/components/service/tabs/settings/deploy-hooks-card.tsx:93
- src/routes/_app/$orgSlug/_shell/$projectSlug/-components/variables-bulk-edit.tsx:81

## Accessibility · prefer-tag-over-role (4)
- src/shared/components/data-grid/data-grid-cell-wrapper.tsx:154
- src/shared/components/data-grid/data-grid-search.tsx:161
- src/shared/components/ui/breadcrumb.tsx:59
- src/shared/components/ui/item.tsx:14

## Performance · js-flatmap-filter (3)
- src/features/resources/components/service/tabs/settings/deploy-hooks-card.tsx:34
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1129
- src/shared/components/data-grid/hooks/use-data-grid.ts:823

## Bugs · no-base-to-string (3)
- src/routes/_app/$orgSlug/-components/audit-helpers.ts:79
- src/shared/components/data-grid/hooks/use-data-grid.ts:1448
- src/shared/components/data-grid/hooks/use-data-grid.ts:577

## Bugs · no-deprecated (3)
- src/shared/components/data-grid/data-grid-cell-variants.tsx:302
- src/shared/components/data-grid/data-grid-cell-variants.tsx:578
- src/shared/components/data-grid/data-grid-cell-variants.tsx:86

## Bugs · restrict-template-expressions (3)
- src/shared/components/ui/chart.tsx:144
- src/shared/components/ui/chart.tsx:180
- src/shared/components/ui/chart.tsx:279

## Bugs · no-new-array (2)
- src/features/logs/components/log-severity.ts:67
- src/shared/components/data-grid/hooks/use-data-grid.ts:380

## Bugs · prefer-use-effect-event (2)
- src/features/logs/components/logs-histogram.tsx:78
- src/routes/_app/$orgSlug/_shell/$projectSlug/logs.tsx:98

## Maintainability · no-multi-comp (2)
- src/routes/_app/$orgSlug/_shell/platform.tsx:162
- src/routes/_app/$orgSlug/_shell/platform.tsx:74

## Bugs · unbound-method (2)
- src/routes/_app/$orgSlug/layout.tsx:32
- src/shared/server/orpc.ts:38

## Accessibility · role-supports-aria-props (2)
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1876
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1877

## Accessibility · click-events-have-key-events (1)
- src/features/backups/multi-combobox.tsx:78

## Bugs · no-effect-chain (1)
- src/features/projects/components/networking/caddyfile-viewer.tsx:51

## Bugs · no-redundant-type-constituents (1)
- src/features/projects/components/new-resource/steps/kind.tsx:15

## Bugs · no-adjust-state-on-prop-change (1)
- src/features/projects/components/settings/state.ts:52

## Accessibility · no-autofocus (1)
- src/features/projects/components/variables/reference-picker.tsx:150

## Bugs · no-event-handler (1)
- src/features/resources/components/postgres/tabs/data/components/filter-popover.tsx:38

## Bugs · no-unused-expressions (1)
- src/features/resources/components/postgres/tabs/data/components/snippet-tree.tsx:69

## Performance · js-hoist-intl (1)
- src/features/resources/components/postgres/tabs/data/studio-table-view.tsx:117

## Bugs · no-pass-data-to-parent (1)
- src/features/resources/components/postgres/tabs/data/use-data-studio-sql.ts:63

## Bugs · no-fetch-in-effect (1)
- src/features/updates/components/update-progress.tsx:21

## Bugs · no-rest-destructuring (1)
- src/routes/_app/$orgSlug/_shell/docker.tsx:88

## Bugs · query-destructure-result (1)
- src/routes/_app/$orgSlug/_shell/docker.tsx:88

## Bugs · no-unstable-deps (1)
- src/routes/_app/$orgSlug/_shell/docker.tsx:89

## Bugs · no-floating-promises (1)
- src/routes/_app/$orgSlug/_shell/docker.tsx:100

## Maintainability · no-giant-component (1)
- src/shared/components/data-grid/data-grid-cell-variants.tsx:1369

## Performance · js-index-maps (1)
- src/shared/components/data-grid/hooks/use-data-grid.ts:1807

## Performance · rerender-memo-before-early-return (1)
- src/shared/components/ui/chart.tsx:138

## Maintainability · no-inline-exhaustive-style (1)
- src/shared/components/ui/svgs/postgresql.tsx:6

## Performance · use-lazy-motion (1)
- src/shared/components/ui/tabs.tsx:6

## Bugs · no-console (1)
- src/shared/db/sqlite-persistence.ts:45
