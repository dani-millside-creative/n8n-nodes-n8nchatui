# n8n-nodes-n8nchatui

This is an n8n community node package for [n8nChatUI](https://n8nchatui.com). It replaces the hand-built webhook/Set/IF/Respond-to-Webhook plumbing that n8nChatUI recipes (e.g. the ActiveCampaign lead-capture recipe) currently use to talk to the widget, with two purpose-built nodes:

- **n8nChatUI Trigger** — a webhook trigger that authenticates incoming widget messages (No Auth, Basic Auth, or JWT Auth — all three of the widget builder's "Configure Authentication For Your Webhook" options) and emits a normalized `{ message, sessionId, pageUrl, metadata }` item.
- **n8nChatUI** (action node, `Message → Respond`) — sends the reply back to the widget's pending chat request, with `Text` and up to 4 `Suggested Replies`.

There are three credentials. `n8nChatUiTriggerAuthApi` (User + Password) backs the trigger's Basic Auth mode. `n8nChatUiTriggerJwtAuthApi` (a single shared secret) backs its JWT Auth mode. `n8nChatUiApi` (API key) is unused by either node in v1 — it exists only so a future v1.1 operation can be added without restructuring. See **Open items** below.

**Deliberately excluded from v1:** no `usableAsTool: true`, no LangChain / `@n8n/n8n-nodes-langchain` dependency anywhere in this package. AI-tool-capable community nodes currently can't be verified for n8n Cloud, and Cloud users are the primary audience for this package.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Open items](#open-items)
[Compatibility](#compatibility)
[Development](#development)
[Resources](#resources)

## Installation

Not yet published (see [Open items](#open-items) and the handoff notes below). Once published, follow the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) — as an unverified community node it will only install on self-hosted n8n via the manual "I understand the risks" flow, not directly on n8n Cloud, until it passes n8n's verification process.

## Operations

### n8nChatUI Trigger

Webhook trigger. Configure:

- **Authentication** — `Basic Auth` (default, backed by `n8nChatUiTriggerAuthApi`), `JWT Auth` (backed by `n8nChatUiTriggerJwtAuthApi`, HS512 only — that's the only algorithm n8nChatUI's own signing code ever uses, confirmed against its source, so there's no algorithm field to expose), or `None`. Must match the widget builder's own "Configure Authentication For Your Webhook" setting.
- **Respond** — `Immediately` or `Using 'Respond to n8nChatUI' Node` (default), mirroring the core Webhook node's `responseMode` pattern.

Accepts the widget's existing payload shape (`chatInput` with a `message` fallback). On an auth failure (missing/malformed `Authorization` header, or wrong credentials) it returns HTTP 401 with `{ "output": "Sorry, something went wrong. Please try again later." }` directly and does not run the rest of the workflow.

### n8nChatUI (action node) — Message → Respond

Sends the reply for the pending request from **n8nChatUI Trigger** (when it's set to `Using 'Respond to n8nChatUI' Node`). Fields: **Text**, **Suggested Replies** (up to 4, sent as `followUpPrompts`). Empty suggested replies produce an envelope with no `followUpPrompts` key at all, rather than an empty array. There is no per-response HTML toggle — see **Open items** for why.

## Credentials

**n8nChatUI Trigger Basic Auth** (`n8nChatUiTriggerAuthApi`) — `User` + `Password`. Backs the trigger's `Basic Auth` mode; must match the same values entered in the widget builder's Basic Auth setting. This is a package-local credential rather than n8n's built-in `httpBasicAuth` — community nodes can't reference another package's credential type (n8n's own lint enforces this), so this package ships a structurally identical one.

**n8nChatUI Trigger JWT Auth** (`n8nChatUiTriggerJwtAuthApi`) — a single `JWT Secret` field. Backs the trigger's `JWT Auth` mode; must match the secret entered in the widget builder's JWT Auth setting. Verified with a hand-rolled HS512 (`node:crypto` `createHmac`) checker rather than a JWT library — see **Development** for why that's a deliberate, reasonable choice here rather than a shortcut.

**n8nChatUI API** (`n8nChatUiApi`) — a single `API Key` field. Not required by the v1 `Message → Respond` operation; built ahead of need for a future operation. See [Open items](#open-items) — the auth header/scheme it uses is an unconfirmed placeholder.

## Open items

Confirmed and fixed during dogfooding (2026-09-16), by decompiling the live widget bundle (`cdn.n8nchatui.com/v1/sun-rises-slowly.umd.js`) rather than guessing:

- [x] **Response envelope shape.** `output` was correct as built. `renderHtml` was wrong — there is no per-response HTML field the widget reads at all; HTML rendering is controlled entirely by the widget builder's "Render HTML in Bot Responses" toggle (`chatWindow.renderHTML`), applied globally to every message. Removed the `Render HTML` node parameter and the `renderHtml` envelope key entirely — it was a dead no-op. `quickReplies` was the wrong key name — the widget reads `followUpPrompts`. Renamed the envelope key to match; the node's own "Suggested Replies" UI label is unchanged.
- [x] **Verified live in a browser** against widget `NlvlGb` (`proxy.n8nchatui.com/api/embed/NlvlGb`): reply text renders correctly, and both follow-up-prompt buttons now render and are clickable, sourced straight from the corrected envelope.
- [x] **Incoming webhook authentication design was incompatible with the real widget builder — fixed.** `n8nChatUiTrigger`'s original "Widget Secret" checked a `webhook_secret` value embedded in the request body, but the widget builder's "Configure Authentication For Your Webhook" only offers header-based schemes (No Auth / JWT Auth / Basic Auth) — there is no field anywhere in the widget builder to set a body-embedded secret, so v1's entire auth mechanism could never be satisfied by the real product. Reworked to a n8n-credential-backed `Authentication` option (`Basic Auth` / `JWT Auth` / `None`) that validates a standard `Authorization` header instead — see **Credentials**. This also fixes the plaintext-in-workflow-JSON tradeoff the old node-parameter secret had, since real n8n credentials are encrypted at rest. Verified live against a self-hosted instance: Basic Auth (no header → 401, wrong credentials → 401, correct → 200 with the correct envelope) and JWT Auth (no token → 401, expired → 401, wrong secret/tampered signature → 401, valid → 200), the latter tested with real HS512 tokens signed the same way n8nChatUI's own backend signs them.

Still unconfirmed, but lower priority (v1's `Message → Respond` doesn't consume this credential at all):

- [ ] **Credential auth header/scheme** (`N8nChatUiApi.credentials.ts`) — the `Authorization: Bearer {{apiKey}}` scheme turns out to be correct (confirmed against n8nChatUI's real dashboard API key system, `lib/mcp/auth.ts` in the main app repo — keys are `sk_...`, sent as `Bearer sk_...`). The `documentationUrl` and `test` request URL are still wrong, though: that key currently only authenticates one real endpoint, `POST /api/mcp` (n8nChatUI's own MCP server, scoped `widgets:read`/`widgets:write`), not a plain REST ping. A future v1.1 operation using this credential would need to speak MCP, not a simple HTTP request — a bigger integration shape than this credential's current `authenticate`/`test` config assumes.

Resolved:

- [x] **Icons.** Considered shipping a "real" n8nChatUI logo instead of the placeholder chat-bubble SVG, but there isn't one to use — checked the actual n8nChatUI website source (`components/shared/icons.tsx`) and its own "logo" is just Lucide's generic `MessageSquareMore` icon, not a bespoke mark. Decision (Dani, 2026-09-16): ship the current placeholder as-is; it's conceptually the same thing (a message-bubble glyph) with proper light/dark variants already passing lint clean.
- [x] **Ownership + contact details** — publishes under the `dani-millside-creative` GitHub account/npm account. `package.json` `author` is `Dani Martin <dani@millsidecreative.com>`, `repository`/`bugs` fields added, `LICENSE` copyright updated to match.
- [x] **Repository URLs in the codex files** — `nodes/*/*.node.json` `primaryDocumentation`/`credentialDocumentation` now point at `github.com/dani-millside-creative/n8n-nodes-n8nchatui`.

## Compatibility

Built with `@n8n/create-node` (`n8n-node` CLI) against `n8n-workflow@*` (peer dependency), `n8nNodesApiVersion: 1`, node API `version: 1` on both nodes. Not tested against a specific minimum n8n version yet — do so during local dev-mode testing (`npm run dev`).

## Development

- `npm run dev` — runs n8n locally with this package linked, for manual testing.
- `npm run build` / `npm run lint` (`--fix` to auto-fix) — both pass clean (lint has 3 non-blocking warnings about single-file icons, see Open items).
- `npm run release` — **do not run** without explicit sign-off; see handoff notes below.

Manually verified against a local `npm run dev` instance (wiring **n8nChatUI Trigger** → **n8nChatUI**, both `Respond` modes), across four review passes. Eight real bugs were found and fixed this way — none of them caught by `build`/`lint`, since all of them compiled cleanly and only misbehaved at runtime or at package time:

1. **Empty `sendResponse()` body.** `this.sendResponse()` needs the full `{ body, headers, statusCode }` wrapper — passing the envelope directly as the body compiled and executed without error but silently sent an empty response to the widget.
2. **`Immediately` mode sent the literal string `"firstEntryJson"` as the body.** Returning `webhookResponse: {}` from `webhook()` is silently misread by n8n's default response-data computation, which falls back to echoing its own internal response-mode enum name as the response text instead of an ack. Fixed by sending the ack directly via `getResponseObject()`, the same mechanism already used for the 401 path.
3. **Auth bypass with an unconfigured secret.** If the Widget Secret is left blank, the original constant-time compare treated "no secret configured" and "no secret provided" as a match (`secretsMatch('', '')` → `true`), authenticating any request that omitted `webhook_secret` entirely. n8n's own activation validator blocks *publishing* a workflow with an empty required field, but a saved-but-unactivated workflow's test-webhook listener isn't covered by that check — confirmed exploitable via the test-webhook URL. Fixed: an empty configured secret now always fails closed, regardless of what's provided.
4. **Secret leaked into execution data.** The trigger forwarded `metadata` untouched to the rest of the workflow, and the widget's real payload shape nests `webhook_secret` inside `metadata` — so the shared secret ended up stored in plaintext in every execution's data, visible to anyone with execution-read access, and re-exposed if a prompt or response ever echoed `{{$json.metadata}}`. Fixed by stripping `webhook_secret` from the metadata object before it's attached to the emitted item (it's still read from the raw body for the auth check itself).
5. **Per-item response loop.** `Message → Respond`'s `execute()` originally looped over every input item and called `sendResponse()` once per item — but a webhook can only be answered once. Confirmed against a 2-item input: it happened not to crash (n8n silently no-ops a second `sendResponse` on an already-answered connection, and item 0's response deterministically won), but it did needless work and diverged from core n8n's own established convention for this exact pattern (`Respond to Webhook` always reads parameters from, and responds using, item 0 only — see its source). Rewritten to match: reads item 0, responds once, returns one output item.

6. **Unauthenticated 500 + stack-trace disclosure on a malformed payload.** Every value read off the request body was cast with `as string`, which TypeScript erases at runtime. A payload like `{"metadata":{"webhook_secret":12345}}` reached `Buffer.from(12345)`, which throws a `TypeError` — verified live: the caller got **HTTP 500 with an n8n stack trace including absolute filesystem paths**, before any authentication succeeded. Fixed by narrowing every body-derived value (`asString`/`asObject` helpers) so a non-string secret is treated as absent and rejected with the normal 401. Re-verified against numeric, object, `null`, string-`metadata` and array-`metadata` payloads — all now return a clean 401 or handle gracefully.
7. **Expression-driven type confusion in the response.** `Text`, `Render HTML`, and each `Suggested Reply` are expression-capable, so they can resolve to non-strings regardless of their declared property types. `renderHtml` bound to an expression yielding the string `"false"` was truthy under the cast and would have sent `renderHtml: true`; an object `Text` would have serialized as `[object Object]`; a non-string reply could throw on `.length`. Fixed with explicit coercion (objects JSON-encode, `"false"` → `false`, blank/invalid replies drop). Verified live: object `Text` → JSON string, `"false"` → `false`, replies `[1, "  ", "ok"]` → `["1","ok"]`.
8. **206kB of build cache in the published tarball.** `dist/tsconfig.tsbuildinfo` was 83% of the package (248kB unpacked). Excluded via a `files` negation, bringing the tarball to 41kB unpacked. Note the fix deliberately does **not** relocate the cache via `tsBuildInfoFile`: that was tried first and created a much worse failure — `rm -rf dist && npm run build` then reported "✓ Build successful" while emitting **zero JavaScript**, which could publish an empty package. Keeping the cache inside `dist/` means deleting `dist` also invalidates it. Both `clean build` and `rm -rf dist && build` are verified to emit all 3 node/credential JS files.

Confirmed after fixes: bugs 3, 4, and 6 above describe the original body-embedded `webhook_secret` design, which has since been replaced entirely (2026-09-16) by credential-backed Basic Auth — see **Open items**. Their fail-closed-on-malformed-input lessons carried over into the replacement (the new auth path also never 500s or leaks state on a bad `Authorization` header), but the specific mechanism (`metadata.webhook_secret` / top-level fallback, secret-stripping from forwarded `metadata`) no longer exists in the code.

Current behaviour, verified live against a self-hosted instance: no `Authorization` header → 401; wrong Basic Auth credentials → 401; correct Basic Auth → 200 with the real envelope, trigger correctly extracts `message` (`chatInput` falling back to `message`), `sessionId`, and `pageUrl`; both `Respond` modes send a clean response; empty **Suggested Replies** omits `followUpPrompts` entirely; multi-item input responds once, deterministically, using item 0.

### Why JWT Auth is hand-rolled, not a library

`n8nChatUiTriggerJwtAuthApi` is verified with a ~30-line HS512 checker (`verifyHs512Jwt` in `N8nChatUiTrigger.node.ts`) instead of a JWT library like `jsonwebtoken` — the exact library n8nChatUI's own backend uses to sign these tokens. This was a deliberate choice, not a shortcut: n8nChatUI's signing code (`actions/bots.ts` in the main app repo) only ever uses HS512 — the `JWTAlgorithm` enum has exactly one value — so there's no algorithm negotiation to support, and general-purpose JWT parsing would be more surface area than the problem needs. The verifier hardcodes HS512 rather than trusting the token's own `alg` header, which is what closes off the classic "alg: none" JWT forgery class of bug. Verified live against a self-hosted instance with real HS512 tokens signed the same way n8nChatUI signs them: valid → 200, expired → 401, wrong secret (bad signature) → 401, garbage token → 401 (no crash, no stack trace).

### Verification-readiness checks

- `npx n8n-node cloud-support` → **Cloud support ENABLED**, strict mode on, default ESLint config, "eligible for n8n Cloud verification (if lint passes)".
- `npm run lint` → **0 errors, 0 warnings** (exit 0). No `usableAsTool: true`, no LangChain, no runtime `dependencies`, no restricted imports/globals, no lifecycle scripts, valid `peerDependencies` (`n8n-workflow: "*"` only), valid `n8n` manifest with `dist/` paths. Also caught (and required fixing) that community nodes can't reference another package's credential type — `@n8n/community-nodes/no-credential-reuse` — which is why the Basic Auth credential is package-local rather than n8n's built-in `httpBasicAuth`.
- Codex files (`nodes/*/*.node.json`) added for both nodes — these were dropped when the scaffold's `Example` folder was deleted. Verified they reach `dist` and that n8n loads them (categories resolve to `Communication`, `Marketing`, `Custom Nodes` in the live node list).
- `LICENSE` file added — `package.json` declared MIT with no license file present.
- Both nodes and all three credentials register in a live instance; all four themed icon files resolve and serve HTTP 200.
- `npm pack --dry-run` → 25 files, 60.8kB unpacked, contains exactly the compiled nodes, all three credentials, codex, icons, README and LICENSE. Still **zero runtime `dependencies`** — JWT verification is a hand-rolled HS512 checker using `node:crypto`, not a library (see Development).

### ⚠️ A note on the official scaffolding tool

The build plan for this package said to run `npx n8n-node new`. **Do not run that command as written** — the exact package name `n8n-node` on npm is a dependency-confusion security placeholder (unrelated to n8n), not the real scaffolding tool. This package was correctly scaffolded with `npx @n8n/create-node@latest`, which is the real, official CLI (its `bin` also happens to be named `n8n-node`, which is presumably why the placeholder squats that name).

### Not yet done: recipe integration test

The build plan's M4 calls for rebuilding the existing `activecampaign-lead-capture.json` recipe workflow with these two nodes in place of the webhook/Set/IF/Respond-to-Webhook chain, then re-running that recipe's 7-point QA checklist. That recipe JSON and the corresponding `recipe-page-activecampaign-lead-capture.md` QA checklist were not present alongside the build plan doc, so this step could not be carried out. Supply those files (or the workflow export) to complete M4.

## Handoff (human-only — npm/GitHub account actions)

Status as of 2026-09-16 — ready to publish, blocked only on the npm-account step below:

1. [x] Confirmed the remaining placeholder assumption (`n8nChatUiApi` credential scheme) as far as it can be without a real API — see Open items. Response envelope and trigger auth are fully confirmed and fixed against the real widget.
2. [x] Ownership is settled: `dani-millside-creative/n8n-nodes-n8nchatui` on GitHub, same npm account. `package.json` (`author`, `repository`, `bugs`) and the codex doc URLs already point there.
3. [x] Icon decision made — shipping the existing placeholder (see Open items).
4. [x] Package name confirmed available on the npm registry (`npm view n8n-nodes-n8nchatui` → 404, unclaimed).
5. [x] Dogfooded live on a self-hosted instance (`n8n.millsidecreative.com`) — see Open items and the "Development" bug list for what was found and fixed this way.
6. [ ] **Set up npm Trusted Publishers — this is the one remaining blocker, and it needs Dani's npm login, not something doable from here:**
   - On [npmjs.com](https://npmjs.com), since this package has never been published, create it first with a throwaway local publish OR use "Create a new Trusted Publisher" from your npm account settings before the first publish (npm's Trusted Publishers UI supports pre-registering a publisher for a package name that doesn't exist yet — check the current npm docs, this has changed over time).
   - Repository owner: `dani-millside-creative`, Repository name: `n8n-nodes-n8nchatui`, Workflow name: `publish.yml`, Environment: leave blank.
   - Full instructions are already written out at the top of `.github/workflows/publish.yml`, including the NPM_TOKEN fallback if Trusted Publishers doesn't work for a never-published package.
7. [ ] Once that's confirmed done: push a version tag (`git tag 0.1.0 && git push origin 0.1.0`) to trigger `publish.yml`, which lints, builds, and publishes with provenance. **Not done automatically here — ask explicitly when ready**, since this is a real, public, hard-to-reverse action.
8. [ ] Post-publish: run `npx @n8n/scan-community-package n8n-nodes-n8nchatui` as a final check (it 404s against unpublished code, confirmed while working on this package, so it can't be run before step 7).
9. [ ] Recruit real testers, then submit through [n8n's Creator Portal](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/) for verification — this is a form tied to your own account, not something done from here.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [n8nChatUI](https://n8nchatui.com)
