# Agent handoff: Battle Words

## Purpose and current scope

This repository is **Battle Words**, a mobile-friendly anagram game with a static solo frontend and a Cloudflare battle service, inspired by 18words. The local folder remains `18words`; the GitHub repository and Pages path are `battle-words`; the product name is **Battle Words**. Preserve the original-game attribution where it is a historical credit.

Read this file, [README.md](README.md), and the relevant implementation before changing behavior. [NEXT_STEPS.md](NEXT_STEPS.md) contains the requested future features: **offline caching**, a **predefined dictionary catalog/easy dictionary substitution**, **incremental custom builds with local saving and share/import links**, and extending the implemented **two-player battle mode** to future custom builds. Custom builds replace the earlier standalone difficulty-mode proposal; 20-word Easy/Medium/Hard recipes will be built-in defaults. These are plans, not instructions to implement features during unrelated tasks. Dictionary cutoffs/sizes, the initially selected default build, and build/link size limits remain open. Battle rules and hosting are documented in [BATTLE_SETUP.md](BATTLE_SETUP.md).

This is an early-stage game, and the user prefers lean code that implements the current behavior. Add backward-compatible datasets, version maps or migrations only for a concrete need or an explicit request. Do not preserve every historical implementation by default. Keep explicitly required data, including completed battle results, readable; this preference does not authorize removing unrelated existing features.

The source review on **2026-10-12** covered the engine, UI, styles, HTML, manifest, dictionary loader/generator, tests, and Pages workflow. All **37 Node tests passed** on Node 24.19.0. This is a review baseline, not a guarantee about later changes. No core gameplay defect was found; review limitations are recorded below.

The **2026-10-18** battle implementation adds pure match rules, a Cloudflare service and separate browser controls, with 81 passing Node tests at implementation time. Local Chrome testing completed all 20 battle rounds across two profiles, public results in a third, reload/rejoin, shuffle persistence, tab takeover, local invalid feedback, battle Help without pause, solo pause/Help, and a simulated slow correct submission receiving red “Almost!” feedback. Nine- and ten-letter battle layouts were checked at 320 px. Reopening the browser after restarting the local server recovered the reserved seat and retained completed public results. Wrangler's real local runtime and deployment dry run passed. This is local validation, not a deployed Cloudflare account check or a full accessibility audit.

The subsequent shared-core/view refactor has **85 passing Node tests**, including cross-mode validation and an independently pinned pre-refactor random-stream digest. Four full-game fixtures retained identical targets and every solo/battle tile arrangement. Local Chrome checks completed 20 rounds in each mode at 320 px, covering repeated-letter removal, focus, keyboard guards, invalid retries, shuffle, solo pause, battle reconnect/results and delayed “Almost!” feedback. The Worker bundle dry run passed. Shared helpers preserve solo's on-demand scrambling and battle's precomputed arrangements; their distinct controllers still own timing, pause and scoring.

The **2026-10-20** battle scoring/results update has **95 passing Node tests** and a successful Worker bundle dry run. Browser fixtures checked recalculation of historical totals, the lower tied solve time, alternative-answer layout, all five feedback cases, 24-character names and 9/10-letter results at 320 px, plus 10-letter feedback at 568 × 320. Solo startup, pause/resume and Help passed smoke checks at the repository subpath. These were fixture-based browser checks, not a new live two-client match or deployed-service validation.

The subsequent keyboard-shortcut update has **101 passing Node tests**, including shared key filtering, focus, modifier and repeat guards. Browser checks covered Space shuffle and Ctrl+Backspace clear in live solo and a battle transport fixture, single-use shuffle, pause/dialog guards, pending battle answers, native button activation and player-name editing. Battle service behavior was not changed or revalidated through a live two-client match.

The **2026-10-23** dictionary update deliberately replaces uniform selection across each entire length pool with independent **80% normal / 20% specialized** category draws in both solo and battle, followed by uniform selection within the chosen category. The 34,679 targets and 87,701 accepted answers remain unchanged. Checksum-pinned ESDB grammatical relationships and reviewed exceptions classify the existing targets. See the current policy below; earlier random-stream baselines describe the behavior before this intentional sampling change.

Validation for that update: **142 Node tests passed**, including classification fixtures, full inventory partition checks, category probability/boundary tests, solo/battle draw parity, strict loader rejection and legacy battle-room compatibility. All seven generated data/license files reproduced byte-for-byte, and the Worker deployment dry run passed in WSL using the existing Linux dependencies. Local in-app Chromium checks at `/battle-words/` covered dictionary startup, typed valid answers (including repeated letters), Space shuffle, Help pause/explicit resume, the updated About text/credits, and an intentionally failed classified-dictionary download followed by successful Retry. This was not a new live two-client battle, physical-device test or accessibility audit.

The **2026-10-24** spelling update narrows both targets and accepted answers to SCOWL's shared English and American source categories, excluding other dialects and all optional variant categories. It contains **33,299 targets** and **83,821 accepted answers**, preserving the independent 80:20 normal/specialized policy. Only the current dictionary is supported for gameplay: unfinished rooms created with an incompatible dictionary require a new battle, while completed result links remain readable from their stored results. Earlier vocabulary counts and validation records above describe their respective releases.

Validation for the American-only, current-dictionary implementation: **152 Node tests passed**, including rejected outdated room actions/reconnects, preserved completed results, and American-only answer validation. All seven generated data/license files reproduced byte-for-byte, and the Worker bundle dry run passed in WSL. Local Chromium transport fixtures at `/battle-words/` checked the new-battle instruction for outdated unfinished rooms without a futile Retry/join form, Home recovery, readable completed results with older spellings, and rejection of `metre` followed by acceptance of `meter` in current games. These are local checks, not a production deployment or a new live two-client match.

The subsequent release-cache fix has **162 passing Node tests**, a successful WSL Worker dry run and successful site packaging. Local Chromium checks simulated two deployments with cached assets and stale HTML: startup selected the current release, names and invitation links survived, saved seats rejoined, and a stale create action refreshed into battle setup. A service/frontend rollout gap offered Update game without a reload loop. An active solo game stayed on its loaded release, including after leaving battle setup while an update check was delayed. These were local transport fixtures, not a live two-client match or a new accessibility audit.

## Product decisions to preserve

- Exactly **20 rounds**, with lengths defined by `WORD_LENGTHS` in `dist/js/game-core.js` (also reexported by `engine.js`):
  `4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10`.
  Rounds 19 and 20 are **9 and 10 letters**. The earlier 18- and 19-word versions are superseded. This is the current shipped game and the required progression for future default builds; planned custom builds may use different counts and ordered lengths.
- Each word gets **30 seconds**. Unused time does not carry forward. Solo score is the number solved out of 20; battle awards **1 point for a win, 0.5 to each player for a tie, and 0 when neither solves**. Elapsed times are shown only in results review.
- Unlimited new games, no daily challenge or account requirement. The current solo app has no backend, database, external runtime library, analytics, or remote dictionary API. Battle mode is an explicitly requested exception: it uses an authoritative Cloudflare Worker and SQLite-backed Durable Objects. Solo must remain independent of that service.
- Solo game state lives only in memory. Reloading or closing the page loses the solo game. **Solo game recovery and saved scores/statistics remain excluded.** Battle specifically persists server match state/results and browser names/seat credentials, as requested; see the battle section below. The user has now requested persistent local **build definitions**, which is a specific exception to the earlier no-persistence scope, not permission to save active words, seeds, timer, answers or progress. No build storage exists yet.
- There is currently **no service worker or deliberate offline cache**. A loaded solo game can keep running without additional gameplay requests, but offline reload/launch is not promised. The manifest alone does not provide offline support.
- Preserve touch/mobile play and hardware keyboard support. In both modes, unmodified **Space** shuffles once per round; **Cmd+Backspace on Mac** or **Ctrl+Backspace elsewhere** clears the entry. Shuffle and Clear buttons remain available. There is no Shift shuffle shortcut. Ignore gameplay keys in editable fields, open dialogs and inactive gameplay. Focused non-tile buttons and links retain normal Space activation; Space on a focused letter tile shuffles.

## Architecture and edit locations

`dist/` is the checked-in, editable application source. Local preview serves it directly; there is **no compilation step** that regenerates its HTML/CSS/JS. Deployment runs `npm run site:prepare` to copy those sources into the ignored `.tmp/site/` package with versioned asset paths and an inline startup loader. Edit `dist/`, never the staged package. Do not add a framework or transpiler without a task that needs it.

| File | Responsibility |
| --- | --- |
| `dist/js/game-core.js` | Shared pure progression, RNG, word draws, scrambling, tile entry and answer validation for both modes. No DOM, network or storage. |
| `dist/js/engine.js` | Solo deadlines, pause/resume, state transitions and results, using the shared core. Retains its existing helper exports for compatibility. |
| `dist/js/game-view.js` | Shared browser element creation, answer/tile/timer rendering and keyboard filtering. Mode controllers own lifecycle and outcomes. |
| `dist/js/app.js` | Solo DOM rendering, input, lifecycle and integration with separate battle UI. |
| `dist/js/battle-rules.js` | Pure battle transitions, precomputed puzzles, deadline arbitration and safe projections. |
| `dist/js/battle-scoring.js` | Shared outcome-based score calculation for authority state, browser views and historical results. |
| `dist/js/battle-client.js`, `battle-ui.js` | Browser transport, local entry validation, credentials, reconnect and battle screens. |
| `dist/js/battle-feedback.js`, `battle-protocol.js` | Battle outcome feedback and shared protocol/dictionary versions. |
| `server/`, `wrangler.jsonc` | Cloudflare routing, room auth, WebSockets, persisted state and durable alarms. |
| `dist/js/word-bank.js` | The single dictionary-loading boundary; fetches and validates current classified targets and accepted answers. |
| `dist/js/site-release.js` | Startup release check, bounded stale-page recovery and update checks before battle requests. Inlined into published HTML. |
| `dist/index.html` | Static screens, instructions, metadata, accessible labels, credits and asset links. |
| `dist/styles.css` | Responsive layout, tile/answer sizing, focus, colors and reduced-motion behavior. |
| `dist/manifest.webmanifest`, `dist/assets/` | Home-screen metadata and SVG/PNG branding. |
| `dist/data/` | Generated target inventory, classified target pools, accepted dictionary, provenance and full SCOWL/ESDB license notices. |
| `scripts/prepare-words.mjs`, `scripts/lib/` | Reproducible SCOWL extraction and ESDB-based target classification. |
| `scripts/data/target-overrides.json` | Explicit reviewed classifications with reasons; unresolved source entries must not silently fall into a category. |
| `scripts/serve.mjs` | Local static preview server; not a production backend. |
| `scripts/prepare-site.mjs` | Stages one release in `.tmp/site/`, with HTML and an asset directory named by a content hash. Does not modify source. |
| `tests/` | Built-in Node tests for rules, dictionary integrity and loading. |
| `.github/workflows/pages.yml` | Test, configure, package and publish `.tmp/site/` to GitHub Pages. |

Keep reusable puzzle rules in the shared core, mode-specific progression in the solo/battle controllers, browser behavior in the UI, and data access in the loader. Both browser battle validation and server validation use the same pure validator, but the authority must still validate every claim independently. Shared view helpers must not pause, advance rounds or award outcomes. Rendering uses DOM methods and `textContent`. URLs are relative or derived from `import.meta.url`; preserve hosting under both `/` and `/battle-words/`.

Published JavaScript, dictionary JSON and CSS live together under `_releases/<content-hash>/`. Relative imports and dictionary URLs must stay within that release; never fall back to unversioned runtime files or retain historical release datasets. The root HTML embeds the startup loader and its release ID. Before importing the app, it fetches `release.json` with `no-store` and a unique query, then refreshes stale HTML once per advertised release while preserving the room fragment. Repeated stale HTML or missing assets must offer recovery rather than a reload loop. Local preview uses the `development` marker and needs no release manifest.

Battle checks for a newer release before creating or joining, saves the entered name before refreshing, and offers **Update game** for a client/service version mismatch. A service deployed ahead of Pages must show that publication is still in progress rather than repeatedly reloading. Never automatically refresh active solo or battle play. Keep names and seat credentials scoped to the document's hosted path (for example `battle-words:/battle-words/:`), not the versioned module directory. Clear update query markers before constructing shared invitations.

## Rules and implementation details that are easy to regress

### Random selection

`beginGame()` passes `Date.now()` to `GameEngine.start()`. The entire timestamp string is hashed into a deterministic, non-cryptographic xoshiro128** generator. **All 20 target words are drawn before any tile scrambling consumes random numbers.** Each round independently chooses normal with **80% probability** or specialized with **20% probability**, then draws uniformly from that category's deduplicated target array for the required length, **with replacement**. The 80:20 ratio is an expectation, not a quota of exactly 16 and 4 words per game. Both category and word selection use rejection sampling to avoid modulo bias.

Do not add a queue, anagram-group sampling, word-frequency weighting, duplicate prevention, or repeat history. Repeated words/groups are allowed. The same seed, selection policy and ordered pools give the same target sequence. Player shuffles consume the remaining RNG stream and can affect later tile arrangements, but cannot change the already selected words.

### Tiles and answers

Tiles have stable IDs, including duplicate letters. A full selection submits automatically. Any accepted word using exactly the available letters succeeds; the selected target is also always accepted by the engine. Invalid full guesses clear the selection and permit immediate retry while the timer keeps running; the UI briefly displays the rejected entry.

Clicking a **selected** tile removes the suffix starting at the **last occurrence of that character in the current entry**, inclusive. Example: with `NNO` entered, clicking either selected N leaves `N`. This is deliberately different from removing one tile and shifting the rest. Backspace removes only the last selected tile; Clear, Cmd+Backspace on Mac, or Ctrl+Backspace elsewhere removes everything.

Shuffle clears the entry and preserves the target, tile identities and remaining time. Scrambling avoids the target spelling and, on shuffle, the previous visible order when another permutation exists. Its bounded fallback must still terminate for repeated/identical-letter inputs.

### Timing and lifecycle

The engine uses an injectable monotonic clock (`performance.now()` by default), separate from the wall-clock seed. Every gameplay action checks the deadline before processing input; an input exactly at the deadline loses. `snapshot()` does not advance time; `tick()` does. Only one result can be recorded per round.

The state machine is `ready -> playing -> feedback -> playing/finished`, with `playing <-> paused`. The UI calls `nextRound()` after **900 ms** for success or **1,800 ms** for a timeout reveal. Invalid feedback lasts **650 ms**. Feedback time does not consume the next round's time.

In the current solo game, Pause, opening Help/About, hiding the document, and `pagehide` suspend play. The puzzle is hidden on the pause screen. Returning to the tab or closing a dialog requires explicit Resume. Feedback suspension is tracked separately in the UI because the engine remains in `feedback`. Battle has no pause, including Help, backgrounding and disconnects. Its lifecycle is separate; a local tab cannot suspend the match clock.

Preserve `clearScheduledWork()`, the game-generation/round checks on callbacks, and feedback suspension when changing lifecycle code. Countdown frames update the timer without rebuilding tiles. Direct typing/Backspace blur a focused letter tile to avoid the previously reported orange focus ring, while Tab navigation retains visible focus.

Round-dependent labels in `app.js` mostly use `WORD_LENGTHS.length`, but HTML copy, the score denominator, icons, manifest and README contain explicit branding/counts. The results heading also uses a fixed 12-solved threshold. Any future requested rule/name change needs an audit of all these locations.

### Planned custom-build extension

The requested builder appends ordered groups of **word length + predefined dictionary + number of words** until the player is satisfied. Builds must be locally saveable and portable through export/import links. Share the reusable recipe, not a fixed seed or sampled answers; every solo play continues to draw fresh words. Default Easy/Medium/Hard builds use the exact 20-word progression above and their corresponding dictionaries. A battle invite is separate from a future recipe link and joins a match with one shared word sequence.

Implementation will need an explicit, immutable per-round plan in place of global `WORD_LENGTHS` for arbitrary games, dictionary resolution for each round, and dynamic progress/scoring/final-round UI. Draw all configured targets before scrambling, retaining independent 80:20 category draws and uniform sampling within each selected category with replacement. Bind accepted answers to the chosen dictionary policy per round; share a broad bank across compatible profiles rather than accidentally unioning unrelated sources. Keep catalog, build validation, local storage and link encoding outside the engine. The full plan and acceptance checks are in `NEXT_STEPS.md`; none of this is implemented in the current source.

### Implemented battle mode

Battle currently uses exactly the existing 20 rounds and dictionary, including the same independent 80:20 category policy as solo. Custom builds remain future work. Its pure rules live separately from GameEngine; keep solo behavior unchanged. All targets are sampled before all initial/shuffle arrangements are prepared, once on the authority. Do not expose future targets, seed, credentials or provisional opponent claims in browser snapshots.

Both reserved players ready once, followed by a three-second countdown. Shared rounds have strict 30-second deadlines. The first valid authority receipt opens a 200 ms window; the other player's valid receipt must be strictly less than 200 ms later and strictly before the round deadline to tie. Exact deadline or exact 200 ms separation loses. A win awards one point; a tie awards 0.5 to each player; neither solving awards zero. Do not show a provisional winner to either client. All rounds reveal a full answer for two seconds. The highest score after 20 rounds wins; equal scores draw. Derive scores from round outcomes so existing matches and historical results, including cached result responses, also use half-points for ties.

Invalid answers are checked locally for immediate retry and server claims are independently validated. A valid full entry remains filled in its normal color pending resolution, without a Submitted message. Confirmed win is green, tie grey, and a correct answer that lost is red with Almost!. When neither player solves, feedback is neutral grey and the completed progress cell is grey with a small centered dash (`–`); ties retain the equals sign and personal losses retain the red cross. Preserve stable tile IDs, repeated-letter suffix removal and once-per-round shuffle through its button or unmodified Space.

Battle results show the original target on the left, with distinct submitted alternative answers beneath it. The right side shows `✓ Player (4.2s)`, `= Tied (4.2s)`, or `× Missed` with no time. For a shared miss, the word and `× Missed` use the same red as solo missed results. Times use authority receipt elapsed times, rounded to one decimal place; a tie shows the lower of the two times. Keep completed result links available unless their removal is separately requested.

One SQLite-backed Durable Object per room owns atomic seat claims, state, deadlines and outcomes. Persist before broadcasting. Durable alarms and absolute deadlines advance matches even when both clients disconnect; they never pause or forfeit. Submission IDs make retries idempotent and retain original receipt times. Do not convert the fixed receipt window into client-time latency compensation.

Names are nonunique display text, cached in browser storage. Private random per-room credentials reserve at most two seats and support same-browser reconnect through the ordinary room link. Never identify a player by name, free a seat on disconnect, or expose credentials in the shared link. No private recovery link exists; storage loss means losing seat access. A new controlling connection replaces the old one, which must stop automatic reconnecting.

The repository/Pages rename to `battle-words` preserves same-origin browser names and seats through a narrow read-and-copy fallback from the old `/20words/` storage prefix. Keep existing new-path values and legacy keys intact. Saved room links need the new `/battle-words/` path with the same fragment; GitHub does not redirect the old Pages URL. The rename checks passed all 88 Node tests, the Worker dry run, and a Chrome check of the new subpath, solo startup and storage migration.

Waiting rooms expire after 30 minutes. Completed rooms have no automatic expiry: anyone with the room link may read final public results, without occupying a seat. Do not expire completed records, reuse IDs, delete the production namespace, or expose private room data in public results. Separate rematches use new room links. Browser storage must not gain saved solo games, active words or timers.

New rooms use American-only targets and accepted answers. Gameplay supports only the current dictionary version. An unfinished room with an incompatible version must direct players to start a new battle; never rewrite its version or silently validate it with the current bank. Do not retain old dictionaries or add version-to-bank maps for these rooms. Completed public results remain readable from stored results without loading their former dictionary.

See [BATTLE_SETUP.md](BATTLE_SETUP.md) for local commands, account setup, deployment and operations. The existing Pages workflow publishes static files only; the manually dispatched battle workflow separately publishes the Worker. A blank production battle URL keeps solo available and displays battle as unavailable. No Cloudflare account or live deployment is created simply by editing the repository.

Graceful handling of Cloudflare usage limits is a TODO in [NEXT_STEPS.md](NEXT_STEPS.md). The exact method, retry policy and treatment of matches affected by a prolonged outage remain undecided. General failure safeguards do not guarantee service or autonomous completion while Cloudflare blocks required operations. Do not implement a quota strategy during unrelated work.

## Vocabulary and licensing

The following describes the current shipped dictionary, not a permanent restriction to SCOWL. The engine already accepts replacement pools, but the loader filenames, generator, UI credits and tests are still source-specific. The catalog/custom-build roadmap will address those couplings; neither feature is implemented yet. Catalog entries define target-pool breadth separately from accepted answers, and the builder chooses a dictionary per group. Preserve the 80:20 category policy and uniform selection within each selected category.

- Source is checksum-pinned **SCOWL 2020.12.07**. Targets: **33,299** words from cumulative levels **10, 20 and 35**. Accepted answers: **83,821** words through level **70**. A raw SCOWL level-35 source file does not include lower tiers by itself.
- Both banks have separate pools for lengths **4 through 10** and include only `english-words` and `american-words` source categories. SCOWL's `english` category supplies shared spellings. Exclude British, Canadian and all optional variant categories, including `variant_1` and `variant_2`, which can reintroduce regional alternatives. Preserve inflections within the American spelling policy.
- The filter is exactly lowercase ASCII `^[a-z]{4,10}$`, applied before any case conversion; there is no accent normalization or manual/frequency/content exclusion of words. Name/upper/abbreviation/contraction/special categories are excluded. SCOWL 35 reduces obscurity, but does not guarantee familiar targets.
- `puzzle-words.json` preserves the full target inventory. The runtime loads its disjoint normal/specialized partition from `target-pools.json`; `words.json` controls alternative-answer acceptance. Do not substitute the broad bank or an unclassified pool if classified targets fail to load. The loader validates sorted, unique, nonempty categories for every required length, disjointness and inclusion in accepted answers before enabling Start.
- **Normal:** qualifying independent lexical entries (including adjectives), all comparative/superlative forms, and irregular inflections. **Specialized:** regular plural/verb forms without a qualifying normal use, including ordinary spelling changes and `f/fe/ff → ves` plurals such as knives/leaves/wolves. Classify individual forms rather than entire word families; takes remains regular even though took is irregular. An independent meaning or irregular use takes priority when spellings overlap; a gerund/participle label alone does not.
- Classification uses the checksum-pinned ESDB export commit `7f2f4078354752045ee16a041605686561122185` and source commit recorded in `target-source.json`. Separate headword/lemma entries through ESDB size 70 qualify as independent meanings, including adjectives and untagged entries; prefixes/suffixes do not. Inflection relationships at all source sizes establish forms, including bases outside playable lengths and spelling variants. Reviewed exceptions preserve existing independent targets beyond that metadata cutoff or resolve missing/conflicting entries. ESDB adds no new vocabulary and is a generation-time data source only.
- Per-length counts, source files and hashes are in `dist/data/word-source.json`; category counts, the classification policy, ESDB provenance and reviewed exceptions are in `dist/data/target-source.json`. `scripts/data/target-overrides.json` records explicit decisions with reasons, and unknown classifications stop generation for review. Tests pin the American bank counts and bytes. Update expectations only for intentional, reviewed data-policy changes.
- Preserve the generator's LF line endings, including final newlines in generated JSON: hashes cover exact bytes. Repository `.gitattributes` pins data JSON, license notices and reviewed-override JSON to LF. Check line endings before changing expected hashes; do not silently change machine-wide Git settings.
- Change the generator or reviewed classification decisions rather than hand-editing generated JSON. It rebuilds both banks, classified pools, provenance and `SCOWL-LICENSE.txt` / `ESDB-LICENSE.txt` together. Preserve complete upstream notices and statements describing modifications. No standalone license for the game code has been selected in this repository; do not treat the dictionary licenses as licenses for all project code.

Rebuild only when data work calls for it:

```sh
node scripts/prepare-words.mjs
# Or use existing checksum-matching inputs without downloading:
node scripts/prepare-words.mjs --archive /path/to/scowl-2020.12.07.tar.gz --lexicon-dir /path/to/esdb
```

The ESDB directory must contain pinned `scowl.txt` and `Copyright` files. Each option can be supplied separately. The normal command caches the SCOWL archive in `vendor/` and ESDB inputs in `vendor/esdb/<pinned-export-commit>/`; `.gitignore` excludes these caches. The pinned tar is parsed in memory, and upstream scripts are never executed. The caches are unnecessary for playing, serving or testing the committed app.

## Run and validate

Use **Node.js 22+** for the project and Wrangler; CI uses Node 22. Solo preview and pure tests also work on Node 20. The frontend has no runtime packages; `npm ci` installs the pinned Wrangler development dependency for backend preview/validation. Commands from the repository root:

```sh
node --test
node scripts/serve.mjs
# Alternatively, test the GitHub Pages subpath:
node scripts/serve.mjs --project-path
```

The server listens at `http://127.0.0.1:4173/`, or `http://127.0.0.1:4173/battle-words/` with `--project-path`. Stop your previous server or use another `PORT` before starting a second one on the same port. It binds to loopback only, so this URL is not directly reachable from a separate phone. It serves `dist/` with `Cache-Control: no-store`. Opening `index.html` via `file://` is not supported because the app uses modules and fetches JSON.

Check the actual shell and runtime availability before giving commands. The user has used **WSL**; Windows PowerShell syntax and paths will not work in its Linux shell. Codex's bundled Windows Node/Git are not necessarily on the user's WSL PATH. A Windows credential helper also needs Windows Git available; the working workaround used Windows `git.exe credential-manager` as the helper command, rather than invoking `git-credential-manager.exe` directly. Inspect current tooling/configuration before proposing another authentication change; keep credentials out of output and documentation.

Wrangler/esbuild dependencies are platform-specific. Stop agent-started Windows preview processes before the user reinstalls dependencies from WSL: a running Windows `esbuild.exe` can cause WSL `npm ci` to fail with `EIO` on unlink. Reinstall with `npm ci` in the intended execution environment after switching Windows/WSL; retain the lockfile and local `.wrangler/` room data. Do not start Windows Wrangler against a WSL dependency installation.

Automated coverage is 24 engine tests, 7 data tests and 6 loader tests at the review baseline. It covers deadline boundaries, repeated-letter removal, alternative answers, shuffle, pause, independent draws, full 20-round completion, long-word pools, checksums and licensing. It does **not** exercise the DOM, real browser timers, focus, dialogs, visibility changes, responsive layout, hosting, or service workers.

For UI/lifecycle changes, complement the relevant Node tests with browser smoke checks:

1. Load at the repository subpath; verify startup and dictionary-error/retry behavior when relevant.
2. Exercise touch/click and typing, repeated letters, selected-letter suffix removal, Backspace, Cmd+Backspace on Mac or Ctrl+Backspace elsewhere, invalid answers and single-use shuffle through both its button and unmodified Space. Check keyboard focus, Space on focused tiles versus other buttons/links, editable-field/dialog/inactive-play guards, and the absence of a Shift shuffle shortcut.
3. Pause/resume, open/close dialogs, switch tabs/apps, and restart during feedback; confirm no hidden timer loss or stale round transition.
4. Verify 9- and 10-letter rounds at narrow mobile widths (including 320 px), results out of 20, word review and another fresh game. Check landscape/short-height layouts when styling changes.

Use temporary test fixtures or injected clocks where appropriate; do not ship fixed answers, shortened timers or test-only controls. Restore any temporary browser viewport and avoid disrupting a user-requested playtest server. Report what was actually verified; a Node pass is not a mobile/browser accessibility audit.

## Hosting and repository

The configured origin at review time is [andrewtam123/battle-words](https://github.com/andrewtam123/battle-words), on `main`. Recheck remotes/branch/status before Git operations; repository state and deployment status can change independently of these documents.

The authoritative frontend workflow is **Check and publish GitHub Pages** in `.github/workflows/pages.yml`. It runs `npm ci`, `npm test` and the Worker dry-run check, optionally injects the public `BATTLE_API_URL`, runs `npm run site:prepare`, uploads **`.tmp/site/`**, and deploys successful `main` pushes/manual runs. Configuration must precede packaging so the configured API URL participates in the release hash. Pull requests run checks and packaging without deployment. In repository Settings -> Pages, the source is **GitHub Actions**. Do not add GitHub's extra `static.yml` or Jekyll template: the existing workflow already publishes the correct directory.

The expected Pages address is `https://andrewtam123.github.io/battle-words/`; confirm live status from the current successful deployment rather than assuming it from configuration. A push to `main` can publish immediately. Commit the project sources, tests, generated data and workflow; publish only the staged `.tmp/site/` package. Verify live files using the published `release.json` ID; exact source bytes, including checkout line endings, determine the hash, so a local package need not have CI's ID.

## Review limitations

The responsive gameplay fix groups round information and puzzle controls in `.round-overview` and `.round-puzzle` wrappers shared by both modes. Wide windows and short landscape phones use two columns; compact portrait screens prioritize the letters. Keep the active-game CSS scoped to visible game ancestors so returning Home restores its normal layout. Preserve scrolling as a fallback rather than clipping content or fixing the page height. Browser-only fixtures checked 192 playing/feedback cases across 16 viewports, from 320 × 480 portrait and 568 × 320 landscape through 1920 × 1080, including 4/9/10 letters and 24-character names. Every letter and Shuffle/Clear button fit inside those viewports, letter targets stayed at least 44 pixels, and no horizontal overflow occurred. These are Chrome viewport checks, not a physical-device or assistive-technology audit.

No full assistive-technology audit has been performed. The earlier muted-text contrast finding (`#73796f` on `#f7f6f0`, approximately 4.13:1) was addressed during the battle UI work by darkening `--muted` to `#626b60`. Other colors, layouts and assistive technologies still need a comprehensive audit; do not claim full accessibility conformance. See [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
