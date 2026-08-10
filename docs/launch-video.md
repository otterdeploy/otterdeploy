# Launch video pipeline, working notes

Record real product flows, cut them automatically, render a launch film. This
file is the memory between attempts. **Read it before starting another take.**

Working tree: `.launch-video/` (gitignored, build artifacts only, never docs).

---

## Pipeline

```
driver/drive.mjs   Playwright drives real Chrome through real flows,
                   emits timeline-<flow>.json (timestamp + label + on-screen box)
        |
Cap CLI            records the Chrome WINDOW at 60fps -> .cap -> mp4
        |
ffmpeg crop        strip browser chrome -> app-only 1920x1080
        |
Remotion           auto-cut, zoom-to-click, captions, SFX   <- NOT BUILT YET
```

One command per take:

```bash
cd .launch-video/driver
OTD_EMAIL=... OTD_PASSWORD=... node drive.mjs --flow=create --cursor=synthetic --cap
```

Flags: `--flow=tour|create|backup|delete|all`, `--cursor=real|synthetic|none`,
`--cap` (Cap recording), `--capture` (CDP screencast fallback), `--name=<svc>`
(lets a later run clean up an earlier take's service).

---

## Capture

**Cap CLI lives at `/Applications/Cap.app/Contents/MacOS/cap-cli`**, the `cap`
shim is not on PATH. Working invocation:

```bash
cap-cli record windows --json                     # find the Chrome window id
cap-cli record start --window <id> --fps 60 --detach --path take.cap
cap-cli record stop
cap-cli export take.cap out.mp4 --fps 60 --quality maximum
```

- **Always `--window`, never `--screen`.** A screen capture recorded the whole
  desktop including the editor and an in-progress conversation. That take was deleted.
- Pick the Chrome window by `ownerName` and widest `bounds.width`; a stray picker
  panel will otherwise win.
- **The collaborative-browser preview recorder is a dead end for motion**: it
  yields 2920x1642 but only ~9fps. Fine for stills, unusable for interaction.
- CDP screencast (`--capture`) is a decent permission-free fallback: 2880x1560
  frames, ~36fps, viewport only. Frames arrive **on repaint**, so they must be
  resampled to constant fps (`driver/assemble.mjs`) or timing is wrong.

### macOS permissions

| Need | Grant to |
| --- | --- |
| Screen recording | **Cap AND the parent app** (T3 Code): a spawned CLI is attributed to its parent |
| Accessibility | The parent app (T3 Code): required by `cliclick` |

Permission dialogs **float above the Chrome window and get recorded**. One
"Accessibility Access" prompt ruined an entire take. Dismiss all dialogs first.

---

## Cursor

Playwright's CDP clicks **do not move the macOS pointer**, so a recording shows
menus opening with nothing touching them.

- `--cursor=synthetic` (default, preferred): a cursor is injected into the page
  and eased in-page; Playwright still performs the real click. Safe, no
  coordinate mapping, so no misclick risk.
- `--cursor=real`: `cliclick` moves the OS pointer and clicks by screen
  coordinate. More authentic, but a bad `screenOrigin` means clicking the wrong
  thing on a live instance.
- With synthetic, **park the real pointer off-window first** (`cliclick m:8,974`)
  or it sits frozen in frame for the whole take.

---

## Geometry (this machine)

- Built-in Retina display is **1512x982 logical points**. The capture window must
  fit inside it, or the real cursor can never reach its right edge. Viewport is
  **1440x780**; at dPR 2 that is 2880x1560 physical.
- **Always export at the native backing resolution** (`--resolution 2984x1744`,
  i.e. window bounds x2). Cap otherwise exports at 1848x1080, and cropping that
  then forces an upscale back to 1080: two resamples, visibly soft text. The
  driver derives this automatically from the recorded window bounds.
- Browser chrome occupies the **top 178px** at native scale; Cap also includes
  ~34px of window edge on the left and bleed on the right and bottom.
- **Keep `.cap` projects per flow.** They hold the native-resolution source, so a
  deleted project cannot be re-exported at higher quality later.

App-only crop that works:

```
crop=2894:1477:34:178,scale=1920:-2:flags=lanczos,pad=1920:1080:0:(1080-ih)/2:0x0C0C0B
```

The pad colour is the app's own `--background`, so the letterbox is invisible.

---

## Selectors: otterdeploy specifics

These cost several failed takes each.

- **Base UI ids are unstable** (`base-ui-_r_27_`). Never target by id.
- **The new-service wizard has no `label[for]` wiring**: `getByLabel()` times out.
- **Input indexes shift mid-flow.** Once an image is typed, a `Filter tags…`
  input appears at index 2 and pushes the service-name field to index 3. The
  service-name field is **the only input with no placeholder**:
  `input:not([placeholder])`.
- The service name **auto-fills from the image**, so a mistargeted write leaves
  the service called `nginx`.
- **Three separate controls are labelled "Settings"**: sidebar, project tab, and
  service-panel tab. `.last()` resolves to *project* settings, whose danger zone
  holds **"Delete project"**. Never use `.last()` for Settings.
- **Graph nodes are not links.** Clicking a node opens a panel and changes the URL
  to `/graph/res_<id>`. To reach service settings, navigate directly to
  `${resourceUrl}?tab=settings` rather than disambiguating tabs.
- **Right-clicking a node opens a context menu**: Open / Logs / Restart / Copy
  internal hostname / Clone… / Delete. This is the delete path to film: it shows
  a feature off, and it sidesteps the "Settings" ambiguity entirely.
- The service delete dialog reads **`Delete <name>?`** and requires typing the
  name. Guard on that exact string before clicking anything destructive.

### The near-miss

An early delete flow used `getByRole('link', {name:'Settings'}).last()`, landed
on **project** settings, and was clicking **"Delete project"** on `store`. It
failed only because that button stays disabled until the *project* name is typed,
and the script was typing the service name. Nothing else stopped it.

`flowDeleteService` now: scopes to the resource URL, asserts `?tab=settings`,
asserts the dialog names the service, and hard-refuses anything matching
`/delete project/i`. **Do not weaken these guards.**

---

## Product behaviour that shapes the film

- **Creating a resource only stages it.** Nothing touches the server until
  **Apply** in the pending-changes bar. Delete stages the same way. This is a
  strength worth filming ("nothing touches the server until you apply") not a
  step to skip.
- **Discard** clears staged changes; used for cleanup after an aborted take.
- Typing an image fetches **live tags from the registry** so they can be clicked.
  This is the flow most worth getting right on camera.

---

## Process rules

- **Write timelines per flow.** A fixed `timeline.json` was silently clobbered by
  a later failed run, destroying the timings its footage depended on and forcing
  a re-shoot.
- **Always clean up created resources**, then verify on `/acme`.
  Baseline for `acme/store`: **12/21 services, 1 database, 9 routes**.
- Takes run against `acme/store`: the project with real services. Guards are the
  only thing between a selector regression and real damage.

---

## Scrub before publishing

Visible in current footage:

1. Server IP `65.108.240.250` inside every `*.sslip.io` hostname.
2. `freddy@demo.com` in the sidebar.
3. On the deployments view: a private repo URL and commit author.

Pointing a real domain at the box before the final take clears 1 and 3.

---

## Open issues

- ~~**Node placement**: new resources dumped at the far right.~~ **FIXED** (od-r96,
  deployed). Cause: dagre lays disconnected components side-by-side in insertion
  order, and a brand-new resource has no edges yet, so it was racked past
  everything. `layout-graph.ts` now anchors wired nodes to their nearest pinned
  neighbour and places orphans beneath the pinned cluster's bounding box.
  Verified on camera: a new node lands inside the cluster.
- **Backups page is empty**: an empty table sells nothing; run one backup first.
- **Logs are all `WARN`** from `store-authentik`; honest but reads as unhealthy.
  Capture with mixed levels across services.
- **Audio unresolved.** Remotion adds sound in post from files; nothing is
  captured from the machine. The blocker is only that the sound cannot be
  judged without listening to it.
- **Remotion composition not built yet.** Licensing is fine: solo product, free tier.

## Assets so far

| File | What |
| --- | --- |
| `clips/app-create.mp4` | 43.4s, app-only, full create -> stage -> apply -> green |
| `clips/app-delete.mp4` | 30.2s, app-only, delete -> confirm -> stage -> apply |
| `driver/timeline-create.json` | 19 events matched to the create take |
| `driver/timeline-delete.json` | 11 events matched to the delete take |
| `out/*` | v1 stills-and-typography film (superseded) |
