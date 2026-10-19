# Battle Words

A mobile-friendly anagram game with 20 words per game, inspired by [18words](https://18words.com/). This is an independent project and is not affiliated with the original game. Play unlimited solo games or invite a friend to a two-player battle. Solo runs entirely in the browser. Battle uses an authoritative Cloudflare service while GitHub Pages continues to serve the static frontend in `dist/`.

For agent handoff, see [AGENTS.md](AGENTS.md). For battle hosting, local development, rules and persistence, see [BATTLE_SETUP.md](BATTLE_SETUP.md). [NEXT_STEPS.md](NEXT_STEPS.md) covers the remaining offline caching, dictionary catalog and custom-build roadmap. Those features are not implemented; the first battle version uses the existing 20-round game and vocabulary.

## Run locally

Use Node.js 22 or newer for the project and Cloudflare development tools. Static solo preview and the dependency-free Node tests also work on Node 20:

```sh
node scripts/serve.mjs
```

Open [localhost:4173](http://localhost:4173/). Serve the files over HTTP rather than opening `index.html` directly: the game uses JavaScript modules and loads its local word-bank JSON.

To check the repository subpath used by GitHub Pages, stop the server and run:

```sh
node scripts/serve.mjs --project-path
```

Then open [localhost:4173/battle-words/](http://localhost:4173/battle-words/). Run the automated tests without a network connection:

```sh
node --test
```

For local battles, run `npm ci` once, then `npm run battle:dev` in another terminal alongside the static preview server. The frontend uses the local Worker on port 8787 automatically. Use two browser profiles for two players. Online battle deployment requires your Cloudflare account and a configured public API URL; see [the setup guide](BATTLE_SETUP.md).

## Solo rules and random selection

- Every game has exactly 20 rounds, in this fixed length sequence: `4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10` (two 4-letter words, five 5-letter words, six 6-letter words, three 7-letter words, two 8-letter words, one 9-letter word, and one 10-letter word).
- Each round starts with 30 seconds. Use every tile once to make a word. A valid complete answer advances automatically; invalid answers clear for another attempt while time continues. A timeout shows an answer and records a miss.
- Click or tap letter tiles, or type letters. Clicking a selected tile clears the answer from that character's last occurrence onward, including that occurrence. With repeated letters, either selected tile of the same letter has the same effect. Backspace removes only the last letter; Clear empties the entry.
- Shuffle is available once per round through its button. There are no global Space or Shift shortcuts. It rearranges the same letters and does not reset the clock.
- Pause freezes the timer and hides the puzzle. Backgrounding the page also pauses it; return and press Resume. The final screen shows the score and answers for the current game.

Each new game seeds one deterministic **xoshiro128\*\*** generator with `Date.now()` (milliseconds since the Unix epoch). It chooses all 20 target words before consuming randomness to scramble tiles. Each target is drawn independently and uniformly from the deduplicated **SCOWL level 35 and below** puzzle pool of the required length. The index selection uses rejection sampling to avoid modulo bias. Draws are **with replacement**, so a word or anagram group may repeat within or across games. There is no group sampling, frequency weighting, queue, or repeat history. The same seed and vocabulary produce the same selected words.

Any word in the accepted vocabulary made from exactly the available letters counts, including alternative anagrams. The selected target remains the answer revealed after a timeout.

## Battle rules

Create a room, enter a display name and share its link. Exactly two seats are reserved; names can repeat. Both players ready before a three-second countdown. They receive the same words and initial tiles. All targets and permitted shuffle arrangements are prepared before play. A player can shuffle once per round independently of the other player.

The authority's first valid receipt wins, unless the other player's valid answer arrives **strictly less than 200 ms later**, in which case the round ties and neither scores. Both must arrive **before** the shared 30-second deadline. No provisional winner is shown to either player. Invalid answers get immediate local feedback; the server still verifies submitted claims. A valid entry stays filled until the result: green for a win, grey for a tie, or red with “Almost!” for a correct answer that lost.

Both players see an answer for two seconds after each round. The most wins after 20 rounds wins the match; equal scores draw. Battle never pauses, including when Help is open or both players disconnect. Unstarted rooms expire after 30 minutes. Finished room links show public results with no automatic expiry and can be viewed by any number of people.

## Mobile and storage

The responsive interface supports touch, portrait and landscape layouts, and hardware keyboards. It does not require opening a phone's keyboard. The manifest and icons support an optional home-screen entry where the browser provides that feature.

During play, wide windows place round information beside the letters. Narrow screens use compact scores and progress; the smallest portrait screens hide the history grid while retaining the current round, score and timer. Letter buttons stay at least 44 pixels across at the tested phone sizes, and unusual zoom or long messages can still scroll instead of being clipped.

There is **no service worker or offline caching feature**, and offline launch is not guaranteed. Loaded solo gameplay makes no further server requests and remains in memory only; refreshing or closing the page discards that solo game. There are no accounts, rankings or saved solo statistics.

Battle requires a connection. The browser remembers your display name and a private room credential, allowing the same browser to rejoin through the shared room link. Names are not identity. Clearing storage or changing browsers loses the reserved seat; there is no private recovery link. A second tab using the same seat takes control. Authoritative battle state and final results are stored on the service, so the match continues with nobody connected and the results remain available afterward.

## GitHub Pages

The repository is [andrewtam123/battle-words](https://github.com/andrewtam123/battle-words). The included `.github/workflows/pages.yml` workflow publishes `dist/`; confirm the current deployment status in GitHub Actions. There is no need to add a separate Static HTML or Jekyll workflow.

1. Put this project in a GitHub repository with a `main` branch and push it.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. Run the included **Check and publish GitHub Pages** workflow, or push another commit to `main`.
4. Open the Pages URL shown by the completed deployment.

The workflow tests the project, validates the backend bundle, optionally inserts the public `BATTLE_API_URL` repository variable into the frontend configuration, and uploads `dist/`. Pull requests run checks without publishing. Relative asset paths, module-relative dictionary loading, and the manifest's relative scope support repository URLs such as `https://username.github.io/battle-words/`, as well as a domain root. Any static host can serve the frontend without compilation. The separate, manually dispatched `battle.yml` workflow deploys the Cloudflare service when its account secrets have been configured. The repository and published site use `battle-words`: [play Battle Words](https://andrewtam123.github.io/battle-words/).

## Word bank and credits

The bundled vocabulary comes from the official **SCOWL 2020.12.07** release. Puzzle targets use **34,679** unique lowercase words from levels **35 and below** in [`dist/data/puzzle-words.json`](dist/data/puzzle-words.json). Accepted answers retain the broader **87,701** words from levels **70 and below** in [`dist/data/words.json`](dist/data/words.json), so a less-common alternative anagram can still count:

| Letters | Puzzle targets (≤35) | Accepted answers (≤70) |
|---|---:|---:|
| 4 | 1,922 | 3,256 |
| 5 | 3,568 | 6,676 |
| 6 | 5,468 | 11,176 |
| 7 | 6,916 | 15,940 |
| 8 | 6,754 | 18,049 |
| 9 | 5,714 | 17,596 |
| 10 | 4,337 | 15,008 |

SCOWL's numbered source files contain additions at each level. A raw level-35 file therefore does **not** contain all lower-level words on its own; the assembled size-35 dictionary combines levels **10, 20, and 35**. Our target pool includes all three levels. SCOWL levels describe dictionary coverage, so the cutoff reduces obscure targets without guaranteeing every remaining word is familiar.

Both extractions include SCOWL's normal `words` categories, covering English, American, British (`-ise` and `-ize`), Canadian, and accepted variant levels 1–2 within the respective size cutoff. They preserve plurals and inflections. They reject uppercase entries, non-ASCII letters, punctuation, and lengths outside 4–10. Proper-name, abbreviation, contraction, upper-case, and special source categories are excluded. There is no additional frequency, familiarity, or manual curation. The original 4–8-letter pools are unchanged; 9- and 10-letter pools use the same extraction rules.

Source version, exact input files, filters, counts, and SHA-256 checksums are recorded in [`dist/data/word-source.json`](dist/data/word-source.json). The complete upstream notices are retained in [`dist/data/SCOWL-LICENSE.txt`](dist/data/SCOWL-LICENSE.txt); distribute them with the word bank. This game's data is an extracted, filtered copy, not an unmodified SCOWL release.

Rebuild the data with:

```sh
node scripts/prepare-words.mjs
```

The first run downloads the pinned official data archive and verifies its checksum before reading it. Later runs use the cached archive in `vendor/`. No upstream scripts are executed. To use an existing archive without downloading:

```sh
node scripts/prepare-words.mjs --archive /path/to/scowl-2020.12.07.tar.gz
```

The archive SHA-256 is `5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc`. Generated data and metadata are deterministic. The archive cache is not needed to play, host, or test the game.

## Structure and future changes

- `dist/js/game-core.js`: shared word selection, scrambling, tile entry and answer validation, independent of browser, network and storage.
- `dist/js/engine.js`: solo state transitions, timing, pause and results, using the shared core.
- `dist/js/game-view.js`: shared answer/tile/timer rendering and keyboard filtering for both modes.
- `dist/js/app.js`: screens, touch/keyboard controls, lifecycle events, and feedback.
- `dist/js/battle-rules.js`: pure authoritative match transitions, arbitration and safe projections.
- `dist/js/battle-client.js` and `battle-ui.js`: browser connection, local input and battle screens.
- `dist/js/battle-feedback.js`: battle-specific outcome feedback.
- `dist/js/battle-protocol.js` and `battle-config.js`: shared version contract and public service URL.
- `server/`: Cloudflare Worker routing, room authentication, WebSockets and durable storage/alarms; `wrangler.jsonc`: backend deployment configuration.
- `dist/js/word-bank.js`: one place for loading and validating the bundled vocabularies. Level-35 puzzle pools and level-70 accepted answers are passed separately to the engine, allowing further target pruning while preserving legitimate alternative answers.
- `dist/data/`: target and accepted-answer word banks, provenance, and licensing; `dist/styles.css` and `dist/assets/` contain presentation resources.
- `scripts/`: local server and reproducible word-data preparation; `tests/`: engine and data checks.

Offline support can later add a service worker that caches these same-origin static resources, including the dictionary, without changing the engine. Cache versions, download-completion feedback, and update behavior would belong to that future feature. No service-worker stub is installed now.

Graceful handling of Cloudflare usage limits is also a planned task. Its exact approach remains undecided; see [NEXT_STEPS.md](NEXT_STEPS.md).
