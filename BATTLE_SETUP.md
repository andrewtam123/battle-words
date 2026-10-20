# Battle Words: hosting and operation

The frontend remains static HTML, CSS and JavaScript in `dist/`, published by the existing GitHub Pages workflow. Battles use a separate Cloudflare Worker with one SQLite-backed Durable Object per room. Solo requires neither the Worker nor a Cloudflare account. The frontend has no compilation step; Wrangler bundles only the backend.

## Run both parts locally

Install Node.js 22 or newer, with npm available in the shell you are using. From the repository root:

```sh
npm ci
npm test
npm run battle:check
npm run battle:dev
```

Use Node, npm and Wrangler from the same environment. `node_modules` contains platform-specific executables. When switching between Windows and WSL, stop running Wrangler processes and run `npm ci` in the environment you intend to use. An `EIO`/`unlink` error mentioning `@esbuild/win32-x64/esbuild.exe` can mean a Windows Wrangler process still has that file open; stop that process before retrying. Keep `package-lock.json` and `.wrangler/`, which hold pinned dependencies and local room data respectively.

In a second terminal:

```sh
node scripts/serve.mjs --project-path
```

Open `http://127.0.0.1:4173/battle-words/`. On localhost the browser automatically uses `http://127.0.0.1:8787` for battles. Use two independent browser profiles to represent two players; two tabs in the same profile share a seat and the newer connection takes control. Wrangler keeps local room data in the ignored `.wrangler/` directory. Local rooms and production rooms are separate. The preview server binds to loopback, so these addresses are not a phone-accessible deployment.

`node --test` runs the unit tests without installing packages. Installing Wrangler is necessary for the actual Cloudflare runtime check and local backend.

## First Cloudflare deployment

1. Create or use your own Cloudflare account. No purchased domain is needed for an initial `workers.dev` address.
2. Review `wrangler.jsonc`. Keep the `ROOMS` binding and `BattleRoom` SQLite declaration. Set `ALLOWED_ORIGINS` to the exact frontend origins, separated by commas. An origin is scheme plus hostname and optional port, without a repository path. The checked-in production origin is `https://andrewtam123.github.io`; local preview origins are also allowed.
3. Run `npx wrangler login`, then `npm run battle:deploy`. This publishes the Worker and provisions the Durable Object namespace. Individual rooms are created on demand. Login is interactive and uses your account; no credentials belong in source files.
4. Copy the HTTPS Worker origin printed by Wrangler, for example `https://battle-words-api.your-subdomain.workers.dev`.
5. In GitHub repository **Settings → Secrets and variables → Actions → Variables**, set `BATTLE_API_URL` to that origin. Run **Check and publish GitHub Pages** to publish the frontend with that address. The workflow runs `scripts/configure-battle.mjs` before uploading `dist/`.
6. Open the published site in two independent browsers. Create a room, share its link, join and ready both players. Check reconnecting and viewing completed results in a third browser.

For another static host, set the exported URL in `dist/js/battle-config.js`, or run `scripts/configure-battle.mjs` with `BATTLE_API_URL` in the environment before publishing. The URL is public configuration. An empty URL on a non-local host leaves battle unavailable and solo usable. The GitHub repository is `andrewtam123/battle-words` and its Pages address is `https://andrewtam123.github.io/battle-words/`.

## Later deployments

The repository and Pages path were renamed from `20words` to `battle-words`. GitHub redirects the old repository address, but not the old Pages address. Update saved game links to `/battle-words/`, keeping their `#room=...` fragment unchanged. The new path uses the same battle service and stored results. On the same origin, the browser copies an existing name or room credential from the old path's storage when first needed, without replacing newer values or removing the old keys. Home-screen shortcuts should be recreated from the new site address.

The optional **Publish battle service** GitHub Actions workflow is manually dispatched. Configure the `battle-production` environment and its `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets before using it. Use a Cloudflare API token scoped to deploying Workers in your account. These are administrative secrets and must never appear in browser code or room links. You can instead continue deploying from your authenticated local Wrangler CLI.

The Pages workflow tests and validates the backend bundle but only deploys static files. Publishing the backend is a separate operation. Deploy protocol-compatible backend changes before their frontend, and keep existing room schemas readable. A protocol/dictionary mismatch asks the player to reload rather than silently accepting different vocabulary. Changing a dictionary requires updating its version and retaining the vocabulary needed by any still-active room.

## Implemented rules

- The existing 20-word progression and SCOWL target/accepted banks are shared by both modes. Battle samples all targets once with replacement, then prepares initial and shuffle arrangements before play. Future words and random seed stay private on the server.
- Exactly two reserved player seats. Both ready once, then a three-second countdown. Display names need not be unique and are remembered by the browser.
- Each round has an absolute 30-second deadline. The first valid answer received by the authority opens a 200 ms resolution window. Another player's valid receipt strictly less than 200 ms later ties, provided both arrive strictly before the round deadline. A tie awards each player 0.5 points; a sole winner earns one point; neither solving awards zero.
- Invalid answers are rejected locally for immediate retry; the authority independently validates submitted claims. A completed valid entry stays filled with no provisional winner. Final feedback is green for a win, grey for a tie or shared miss, or red with “Almost!” for a correct answer that lost. Shared misses have grey progress cells with a small centered dash (`–`); ties use an equals sign and personal losses a red cross.
- Both modes support unmodified Space to shuffle once per round and Ctrl+Backspace to clear, alongside the Shuffle and Clear buttons. There is no Shift shuffle shortcut. Gameplay keys are ignored in editable fields, open dialogs and inactive gameplay. Space on a focused letter tile shuffles; other focused buttons and links retain their normal Space behavior.
- Every round has a two-second answer reveal. The highest score after 20 rounds wins; equal scores draw. Battle has no pause or disconnect forfeits. Solo retains its original pause and feedback timings.
- Results show each original target and its distinct submitted alternatives on the left, with `✓ Player (4.2s)`, `= Tied (4.2s)`, or `× Missed` on the right. For a shared miss, the word and `× Missed` use the same red as solo missed results. Times measure elapsed time until authority receipt, rounded to one decimal place. Ties use the lower of the two times; shared misses have no time.
- A waiting room expires after 30 minutes. Once started, the match advances through completion even with nobody connected. Completed results have no automatic expiry and are publicly viewable by anyone with the room link. A rematch uses a new link.

## Persistence and reconnects

Each room stores its prepared puzzles, players, authoritative receipts, deadlines and outcomes in its own Durable Object storage. The same storage holds credential hashes and connection metadata. Durable alarms advance phases without incoming browser requests. Each transition is persisted before sending its result; delayed alarms catch up using the original deadlines. The server does not run a per-second countdown loop. Infrastructure interruptions can delay processing and delivery; persisted state allows recovery without extending deadlines.

The browser stores only the display name and a per-room seat credential under the application's hosted path. It does not save the battle's words, timer or score locally. Closing and reopening the room in the same browser reconnects to the current server state. Clearing browser storage or using another browser loses seat access; names are not authentication and there is no private recovery link. A second controlling tab replaces the first. Retries reuse a submission ID so that an acknowledged answer's original receipt time cannot change.

Final result records contain public names, scores and round answers. They exclude seat credentials, credential hashes and socket tickets. Public result responses can be cached; live or authenticated responses cannot. Scores are derived from recorded round outcomes, so existing matches and historical results also award 0.5 points to each player for ties. The browser applies the same calculation to cached public results with older score totals. There is no public match directory, account, ranking, or solo history.

## Operation and scaling

Rooms are independent Durable Objects, so concurrent matches do not share a central game loop. Finished rooms need stored data but no continuously running process. Limits and costs are account-wide: monitor Cloudflare's Workers, Durable Objects and storage usage as the audience grows. Review abuse controls and load-test before a large public launch; per-message limits and two seats do not make public room creation an unlimited free resource.

Graceful handling of exhausted Cloudflare usage limits is a [roadmap TODO](NEXT_STEPS.md), with its exact approach undecided. Current connection/storage safeguards do not constitute quota-specific handling or guarantee uninterrupted play during a provider outage.

Retain the production namespace and its storage to preserve result links. Do not delete or recreate it, reuse a room ID, or apply an expiry policy to completed results. Plan backups/exports before making stronger long-term availability commitments; changing hosts requires moving results and preserving the public URL behavior. The initial implementation does not add a separate archive service or backup scheduler.

Official references: [Durable Objects setup](https://developers.cloudflare.com/durable-objects/get-started/), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), and [GitHub Pages static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
