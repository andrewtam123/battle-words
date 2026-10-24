# Next steps

**Status:** The first Battle Words implementation includes network battles for the existing 20-round game. The remaining roadmap contains:

- Offline caching.
- A reusable predefined dictionary catalog, supporting custom builds and easy dictionary substitution.
- Incremental custom-game builds, local saving, sharing/import links, and default 20-word Easy / Medium / Hard builds.
- Extending battle mode to future custom builds after the dictionary catalog and builder exist.
- Graceful handling of Cloudflare usage limits; the exact approach remains undecided.

These are future implementation tasks. **Custom builds replace the earlier standalone Easy / Medium / Hard mode proposal.** Easy, Medium and Hard become default builds using the same builder/playback system. Dictionary configuration remains a supporting task, and offline caching remains planned.

The current game uses the unchanged SCOWL target vocabulary through level 35, partitioned into normal and specialized pools using pinned ESDB grammatical information and reviewed exceptions. Both modes independently choose normal with 80% probability or specialized with 20% each round, then draw uniformly within that category and length, with replacement. The accepted-answer bank through level 70 and fixed 20-round progression are unchanged. There is no builder, saved-build library or recipe share/import feature yet. Battle uses the existing fixed game. Exact future dictionary cutoffs/sizes and build-size limits remain to be decided.

## 1. Offline caching

The present app requires an online load; it has no registered service worker or deliberate offline cache.

### Desired result

After one successful online visit and completed download, the player can reopen or reload **Battle Words** without a connection and start unlimited new games on desktop or mobile. Keep the static GitHub Pages deployment and the current game rules and vocabulary.

Offline play covers solo games, including custom builds when implemented. Battle mode requires a live network connection and is not part of the offline guarantee.

Offline caching stores application files and word banks. It must **not** add game recovery, saved scores/statistics or accounts. The separately requested custom-build feature will persist reusable build definitions locally; a saved build is not an in-progress game. Reloading will still discard active solo play; battle reconnects follow the separate server policy. The first download needs connectivity, and browser storage clearing/eviction can require another online visit.

### Current code to build on

- `dist/index.html` references local CSS, modules, icons and a manifest using relative paths.
- `dist/js/word-bank.js` fetches `target-pools.json` and `words.json` using module-relative URLs, validates both, and returns in-memory data to the engine. The classified target pools contain disjoint normal and specialized arrays for each length.
- `dist/js/app.js` owns loading/retry feedback and constructs the engine after the banks load. Once loaded, the game needs no additional gameplay requests.
- `dist/js/engine.js` has no browser/network/storage dependency and should not need offline-specific changes.
- The manifest already uses `./` for `id`, `start_url` and `scope`. The workflow deploys `dist/` unchanged. A service worker can be added without a backend or bundler.

### Proposed implementation

#### Register within the hosted application directory

Add `dist/sw.js` and a small registration/lifecycle module under `dist/js/`. Resolve the worker URL relative to the module/site directory so the same files work at `/` and `/battle-words/`; do not hard-code `/sw.js` or intercept other GitHub Pages projects. Use feature detection and preserve online gameplay if registration fails or service workers are unavailable.

Use HTTPS in production; localhost is suitable for development. Keep the registration separate from engine rules and dictionary validation. The [service-worker lifecycle and secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) govern installation and activation.

#### Cache a complete version of the application

Maintain an explicit resource inventory and release version. Precache:

- The application entry (`index.html`), `styles.css`, every runtime JS module imported by the app (including the shared core/view and battle modules), and any added offline module. Caching the static battle modules lets Solo load offline; it does not make the battle service available offline.
- **Both runtime banks**, `data/target-pools.json` and `data/words.json`, as part of the same release.
- `manifest.webmanifest` and the SVG plus 180/192/512 PNG icons.
- `data/SCOWL-LICENSE.txt`, `data/ESDB-LICENSE.txt`, `data/word-source.json`, `data/target-source.json` and the referenced inventory `data/puzzle-words.json`, keeping credits/provenance available offline.

Do not cache the repository, tests, source archive, README, or remote attribution websites. The worker script itself follows the browser's service-worker update mechanism.

When the predefined dictionary catalog and custom builder are added, derive this inventory from their configuration. Cache the target/accepted banks, licenses and provenance for **every catalog dictionary offered for offline builds**, rather than permanently assuming that the current two JSON files are the entire vocabulary. Shared accepted-answer assets only need to be cached once. With no separate download UI planned, include the complete bundled catalog so default, saved and imported builds can use it offline. Validate that every dictionary required by a build is available before allowing offline play.

Use a cache namespace specific to both this application and its hosted scope, plus a version that changes with cached resources. Installation should wait for every required response to be successfully cached; reject incomplete installs and retain the currently working release. Avoid filling a new release with stale HTTP-cache responses. [Cache.addAll()](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll) provides a starting point for precaching; handle failures explicitly and verify behavior in a real browser.

#### Serve cached files consistently and update safely

Serve the installed release's known assets from its versioned cache. Handle the app's root and `index.html` navigations with the cached entry. Limit handling to appropriate same-origin requests inside this app's scope; do not return HTML for missing JSON/JS resources or unrelated URLs. Retain normal network behavior for resources outside the cache policy.

Use the normal waiting-worker lifecycle as the initial update policy: an existing page keeps its current version; a completed replacement activates after old controlled pages close. Do not automatically call `skipWaiting()` and reload an active game, or mix a newly downloaded dictionary with an old running release. First-install control and the definition of "ready offline" need explicit handling; a successful registration alone is insufficient.

If adding an update/reload button, explain that it starts a fresh session and account for other open game tabs before forcing activation. On safe activation, clean up only superseded caches belonging to this application and scope; preserve saved builds. Never delete every cache or storage entry on the origin. The [skipWaiting behavior](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting) is relevant if explicit update activation is introduced.

#### Give accurate status and recovery feedback

Keep Start enabled whenever the validated word banks are available, even if offline installation fails. Distinguish downloading, ready for offline use, and download failure. Only claim readiness after the full cached release is confirmed usable for subsequent navigation. Provide a retry path without interrupting a running game.

Revise the About dialog's current "internet connection is required to load the game" text and the README when the feature actually ships. Explain that initial download requires internet, offline use depends on retained browser data, and progress still resets on reload. Preserve the existing dictionary-load retry path for unavailable/evicted data. Keep implementation terms such as cache versions and service-worker state out of ordinary player-facing copy.

### Acceptance checks

Run the existing `node --test` suite and add focused tests for the new cache/lifecycle behavior. Browser verification is required; mocked network tests alone cannot establish offline launch support.

1. Test clean online installation at both `/` and `/battle-words/`, with no missing assets or scope errors. Confirm readiness waits for both dictionaries and all required files.
2. With the server/network unavailable, reload and close/reopen the cached URL. Start multiple games, complete all 20 rounds including the 9- and 10-letter words, and check alternative answers, pause, shuffle, results and offline license access.
3. Confirm reload discards the active game and no answers, remaining time, seed or scores are persisted. Once local build saving is implemented, confirm saved build definitions survive reload and cache updates independently of active play.
4. Interrupt the initial download or fail one dictionary request. Verify there is no false readiness claim; online play/retry still works. On a failed update, the previous complete offline release remains usable.
5. Publish a test version while another version has an active game, including a second open tab. Verify no forced reload or mixed release; after safe activation, all required files use the new version.
6. Verify cleanup preserves unrelated applications' caches on the same origin. Test cleared/evicted storage and unsupported/failed registration without a broken online game.
7. Smoke-test supported mobile browsers and, where available, launching a home-screen entry offline. Verify narrow/landscape layouts and touch controls remain unchanged.
8. Once the builder exists, verify creating, saving, loading and playing default/custom builds offline, including builds mixing dictionaries. Export and paste-import links should work with the already cached app and catalog; a recipient who has never loaded the site still needs an initial online visit.

Document the browsers tested and any platform limits. Update `AGENTS.md` and the README to distinguish implemented offline behavior from this plan. Keep `.github/workflows/pages.yml` as the sole frontend deployment workflow; extend checks there only if the offline implementation needs them.

## 2. Dictionary catalog and easy substitution

### Current assessment

The engine is already dictionary-independent: `GameEngine` receives `pools` and `acceptedWords` rather than reading SCOWL files itself. A compatible replacement can work without changing its rules. End-to-end substitution is not yet a simple configuration change:

- `dist/js/word-bank.js` always loads `target-pools.json` and `words.json`, requiring both target categories for every supported length.
- `scripts/prepare-words.mjs` is tied to a particular SCOWL archive, categories, size levels and source-file counts, including a fixed minimum of 1,000 inventory words per length. Its classification helpers also pin ESDB inputs and the independent-meaning/regular-inflection policy.
- `dist/js/app.js` hard-codes SCOWL's name, version, levels and spelling coverage plus the ESDB credit; `dist/index.html` fixes the SCOWL and ESDB license links and initial source label.
- Data and loader tests contain SCOWL-specific counts, hashes and example words. These are useful integrity checks, but are not a reusable validation contract for other sources.

### Proposed implementation

1. Define a predefined catalog of bundled dictionary profiles: stable/versioned ID, display name, supported lengths, classified target and accepted-answer asset paths, source/version, filtering/classification policy, per-length/category counts, and license/provenance references. The builder selects from this catalog; a build cannot supply arbitrary dictionary URLs or upload a word list. Keep asset paths relative to the hosted app.
2. Parameterize `loadWordBank()` with that profile and return source/display metadata alongside the existing engine inputs. Render accurate credits and license links from metadata. Selecting a prepared profile should not require edits to engine logic, loader internals or presentation strings.
3. Define a common output contract: sorted, deduplicated lowercase ASCII word arrays keyed by supported length and target category. Preserve disjoint normal/specialized target categories and the independent 80:20 sampling policy; accepted answers remain separate. The current app/catalog supports lengths 4 through 10; expose only lengths actually available for the selected dictionary. Require both target categories at every declared length to be nonempty, reject malformed words, and require every target to belong to the configured accepted-answer vocabulary. The default Easy/Medium/Hard dictionaries must cover all seven lengths. Sorting preserves reproducibility; deduplication preserves uniform sampling within categories. Additional lengths or alphabets require deliberate validation/layout work rather than being silently accepted by imports.
4. Retain the pinned SCOWL importer and ESDB classification as one source adapter. Let additional source adapters or an import command convert and classify prepared local word lists into the common format, with their own attribution and redistribution terms. Make source-specific cutoffs and minimum-size sanity checks configurable; do not impose SCOWL's 1,000-word-per-length inventory guard on every smaller valid profile. Preserve deterministic metadata/hashes and license notices.
5. Separate generic loader/contract tests using small fixtures from integrity tests for shipped providers. Retain SCOWL's pinned counts/hashes for the SCOWL profile, and add corresponding checks for each new bundled source. Keep target selection separate from accepted-answer validation.
6. Document adding/replacing a prepared dictionary in the catalog. Importing dictionary data remains a maintainer workflow; players select predefined catalog entries while building games. No plugin framework, runtime dictionary-download service or player-uploaded vocabulary is required. Keep referenced dictionary IDs/versions stable, or provide explicit migrations, so saved/shared builds do not silently resolve to different vocabulary.

### Acceptance checks

- Swap between the current SCOWL profile and a small independent fixture profile through configuration alone. Confirm the engine, all 20 rounds, alternative answers, displayed counts, credits and license links remain correct.
- Reject missing declared/required lengths or categories, overlapping target categories, duplicate/invalid entries and targets absent from accepted answers with actionable errors. Never fall back silently to another source, an unclassified target inventory or the broader accepted pool for target selection.
- Confirm identical source inputs produce identical ordered pools, metadata and checksums. Keep source-specific integrity checks meaningful.
- Verify root/subpath hosting and ensure the offline resource inventory follows the selected/bundled profiles when caching is implemented.

## 3. Incremental custom builds, local saving and share/import links

### Desired behavior

The player builds a game incrementally. For each addition they specify **word length**, **dictionary from the predefined catalog**, and **number of words to add**, then press Add. They repeat until satisfied. Each addition appends that many rounds in order; different groups can use different lengths and dictionaries. Show the growing group list and total word count, and allow corrections/removal before playing or saving.

Builds can be named and saved locally, reopened for play/editing, and shared through a self-contained export/import link. A build is a **reusable recipe**, not a frozen set of puzzle words: each solo play chooses fresh words using the current time-seeded selection rules. Battle mode, described below, will use one shared draw for both participants in a match; ordinary recipe links do not identify or join that match.

### Default builds

Ship **Battle Words - Easy**, **Battle Words - Medium**, and **Battle Words - Hard** as built-in recipes using the same schema and playback path as custom builds. Each uses its corresponding predefined dictionary for all rounds and the existing progression:

`4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10`

Equivalently, add groups of **2 x 4**, **5 x 5**, **6 x 6**, **3 x 7**, **2 x 8**, **1 x 9**, and **1 x 10** letters. Keep built-in recipes available independently of local saves; customization should create a copy rather than overwrite a shipped default.

Easy/Medium/Hard dictionaries should have progressively broader target vocabularies, preferably nested when derived from a common source. Use meaningful source coverage/familiarity policies rather than random subsets. Dictionary size is an approximate difficulty control, not a per-word guarantee. **Exact cutoffs, counts and initially selected default build remain undecided.** Today's level-35 bank is not automatically assigned to a new label.

### Build format and playback

1. Define a versioned build schema with an optional display name and an ordered list of groups containing `{length, dictionaryId, count}`. Dictionary IDs identify catalog entries with a stable version policy. Keep the portable recipe separate from browser-local save IDs or timestamps. Derive the total number of rounds from the groups.
2. Validate the complete recipe before saving, importing, expanding or starting it: supported schema version, at least one group, known dictionaries, supported/nonempty length pools, positive integer counts, and explicit limits on groups, total rounds, names and encoded link size. Decide practical limits during implementation; custom games must not be hard-coded to 20 rounds. Count totals before allocating an expanded round list. Explain unsupported or unavailable dictionaries instead of silently substituting them.
3. Resolve required dictionary assets once and expand the groups into an immutable per-round plan. Every round binds its length, target pool and accepted-answer policy. Prefer a shared broad accepted dictionary for compatible Easy/Medium/Hard profiles; for other catalog entries use the active round's configured accepted bank. Do not implicitly union unrelated dictionaries or narrow acceptance simply because the target dictionary is easier.
4. Refactor `engine.js` to take a round plan instead of using global `WORD_LENGTHS` for every game. Preserve the existing progression as a default-build constant. Draw all of the build's words upfront, using one `Date.now()` seed, independent 80:20 category choices and uniform sampling within the selected category/length/dictionary with replacement, before scrambling consumes randomness. Freeze the active recipe/pools so editing a saved build cannot change a running game.
5. Make UI progress, current length, final-round detection, result count, perfect-score logic and score denominator derive from the active plan. Audit static HTML instructions and the fixed results-heading threshold as well as `app.js`'s `WORD_LENGTHS` references. Keep branding as **Battle Words**, and clearly label custom builds with their actual totals. Preserve 30 seconds per word, existing tile-removal behavior, once-per-round shuffle through its button or unmodified Space, Ctrl+Backspace clearing, pause and results review.
6. Keep builder/storage/link handling outside the pure engine. Load and validate all required banks before starting the timer, and guard asynchronous build/dictionary changes against stale responses. Test rendering beyond 20 rounds at mobile sizes rather than assuming the current 20-cell layout is sufficient.

### Save builds locally

Use a versioned, application/scope-namespaced local store for the small recipe library; `localStorage` is a reasonable first implementation. It [persists across browser sessions and is scoped to the origin](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API), so saved builds do not automatically synchronize across devices or between localhost and GitHub Pages. Namespacing should also separate deployments sharing one Pages origin.

Provide explicit Save, Load/Edit, Save as copy and Delete operations for user recipes. Handle duplicate names, schema migrations, malformed stored records and unavailable/quota-limited storage without losing other saves or blocking unsaved play. Store build definitions only: no selected words, RNG seed, timer, partial answers, progress or scores. The saved-build library is an intentional new persistence feature; **in-progress game recovery remains excluded**. Do not silently add draft autosaving or general preference storage.

### Export/import through a link

Encode a compact, versioned recipe in the application URL's fragment, for example `#build=<encoded-recipe>`. Preserve the deployed base path so links work with GitHub Pages. This requires no backend, account, server-side share record or URL shortener; [URL fragments are handled by the browser rather than sent as part of the page request](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment).

Provide Copy share link and an import flow both for opening such a link and for pasting one into the app. The recipient sees a validated preview (name, ordered groups, dictionaries and total), then can play it or save a local copy. Import must not automatically overwrite an existing save or interrupt an active game; let the player choose when to leave that game.

Share only recipe data, with dictionary IDs rather than dictionary contents, paths or local save IDs. Treat imports as untrusted structured data: use bounded decoding and the same schema/catalog validation as the builder, render names as text, and never execute supplied content or fetch dictionary URLs from a link. Reject unsupported schema/dictionary versions and oversized links with a useful message. Test the chosen URL-safe encoding and length limits in supported desktop/mobile browsers; keep ordered groups compact rather than expanding every round into the URL. Any compatibility migration must be explicit and preserve or explain changes to the build.

The same build on two devices recreates the same recipe; it does not promise identical random words. A share link is also a portable copy if browser-local storage is cleared. Link decoding can work offline once the app and all referenced catalog assets are cached; first-time recipients still need connectivity to load the site.

### Integration and open choices

Use the same catalog, validation and recipe schema for defaults, custom drafts, local saves and imported links. Keep the static GitHub Pages deployment. Update instructions, credits, metadata and test fixtures when the feature ships. Offline installation must cover all advertised catalog dictionaries and preserve the local recipe library during updates.

Before implementation, settle the Easy/Medium/Hard dictionary definitions, initial default build, supported length choices and bounded build/link sizes. The user has specified incremental groups, local saves and share/import links; those are requirements, not optional follow-up features.

### Acceptance checks

- Incrementally add multiple groups with different lengths/dictionaries/counts; verify exact appended order, edits/removal and totals. Test valid games shorter and longer than 20 rounds, plus validation at the chosen limits.
- Every built-in Easy/Medium/Hard recipe expands to exactly the established 20-word progression. Verify dictionary size ordering and intended subset relationships without changing timing, scoring or sampling rules.
- Verify each custom round draws from its specified dictionary/length and validates against its intended accepted bank. All targets must be accepted; legitimate alternatives remain valid. A fixed test seed plus the same recipe/catalog produces the same targets, while ordinary play still seeds each new game from the current time.
- Complete short, long, mixed-dictionary and default games; each produces exactly one result per configured round and a correct denominator. Exercise restart, Play again and late load responses; active builds must remain immutable.
- Save, reload, edit, copy and delete a recipe; confirm persistence across browser restarts. Test storage failure/corruption and duplicate names. Reload must discard active game state while retaining explicitly saved recipes and built-in defaults.
- Round-trip default/custom recipes through share links in a fresh browser profile; preserve group order, dictionary identities and counts. Test opening and paste-importing links, import preview, local save collisions, malformed/oversized data and unsupported versions/dictionaries. No recipient-side account or prior saved build may be required.
- Verify builder and library controls with touch, keyboard and mobile layouts, including progress/results for larger totals. Test default/saved/imported builds offline once caching exists, including clear errors for missing cached dictionaries and preservation of saves through updates.

## 4. Two-player battle mode

The first implementation now covers the existing 20 rounds, with a separate Cloudflare Worker and one SQLite-backed Durable Object per match. See [BATTLE_SETUP.md](BATTLE_SETUP.md) for the implemented rules, deployment, persistence and reconnect behavior. Deployment still requires configuring the owner's Cloudflare account and public API URL.

The agreed rules supersede the earlier open proposals: shared 30-second deadlines; strictly less than 200 ms receipt separation ties; 0.5 points to each player for tied rounds; two-second answer reveal; equal final scores draw; no battle pause or disconnect forfeits; and matches continue through completion without either player present. Invalid answers are checked locally and claims are revalidated by the authority. All target words and shuffle arrangements are prepared before play. Completed room links provide public results with no automatic expiry. Browser-local names and seat credentials support same-browser reconnects; no private recovery link exists.

Future work is integration with the dictionary catalog and custom builds, after those features are implemented. Freeze the selected recipe and dictionary versions for each match; preserve authoritative arbitration and keep future words private. Ordinary reusable recipe links remain separate from battle room links. Solo must stay independent of the network service.

Before a large public launch, load-test concurrent rooms and establish operational quotas, abuse controls, monitoring and a backup/export policy for retained results. The initial friends-and-family deployment does not include accounts, rankings, spectator access during live matches, or a separate archive service.

## 5. Graceful handling of Cloudflare usage limits

**TODO — design undecided.** Gracefully handle exhausted Cloudflare usage limits in battle mode. This is a requested future task, not implemented quota handling or a decision about a particular retry, monitoring, or hosting strategy.

The current service has general connection/storage failure safeguards, but no quota-specific handling. The browser assumes API responses are JSON and automatically reconnects with a delay capped at eight seconds. Storage failures prevent acknowledgements of unsaved claims; alarm rescheduling also depends on storage and may fail during an extended outage. Saved state can catch up to elapsed deadlines when processing succeeds again, but submissions that could not be saved cannot be recovered.

Before implementing, decide the player-facing message and available actions, retry behavior, treatment of affected live matches, recovery after a prolonged limit, and whether usage monitoring or alerts are needed. Account for failures returned by Cloudflare before our Worker runs, including non-JSON or browser-blocked responses. Preserve solo independence and existing persisted results. The desired behavior and its tests should follow those decisions; no automatic upgrade, spending policy, or change to match rules has been chosen.

## Coordination between these tasks

The dictionary catalog is the foundation for custom builds and their Easy/Medium/Hard defaults. Offline caching can be implemented independently against current assets, but its resource inventory and readiness checks must include the catalog and builder when they ship. Saved recipes are separate from cached application files and the server-persisted battle state and results. Keep current gameplay, SCOWL vocabulary and the 80:20 selection policy unchanged during planning; the custom-build implementation will deliberately generalize fixed lengths/counts while preserving the original progression in default recipes.

Offline caching, dictionary configuration and custom builds can remain entirely static. Battle mode adds live network communication and shared match state; keep that dependency separate so solo play does not depend on the battle service. The frontend can remain on GitHub Pages.
