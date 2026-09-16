# n8n-nodes-n8nchatui

This is an n8n community node package for [n8nChatUI](https://n8nchatui.com). It replaces the hand-built webhook/Set/IF/Respond-to-Webhook plumbing that n8nChatUI recipes (e.g. the ActiveCampaign lead-capture recipe) currently use to talk to the widget, with two purpose-built nodes:

- **n8nChatUI Trigger** — a webhook trigger that authenticates incoming widget messages with a shared secret (timing-safe comparison) and emits a normalized `{ message, sessionId, pageUrl, metadata }` item.
- **n8nChatUI** (action node, `Message → Respond`) — sends the reply back to the widget's pending chat request, with `Text`, `Render HTML`, and up to 4 `Suggested Replies`.

There is also an `n8nChatUiApi` credential (API key) that neither node consumes in v1 — it exists only so a future v1.1 operation can be added without restructuring. See **Open items** below.

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

- **Widget Secret** — must match the secret configured in the n8nChatUI widget builder.
- **Respond** — `Immediately` or `Using 'Respond to n8nChatUI' Node` (default), mirroring the core Webhook node's `responseMode` pattern.

Accepts the widget's existing payload shape (`chatInput` with a `message` fallback; `metadata.webhook_secret` with a top-level `webhook_secret` fallback). On a secret mismatch it returns HTTP 401 with `{ "output": "Sorry, something went wrong. Please try again later." }` directly and does not run the rest of the workflow.

### n8nChatUI (action node) — Message → Respond

Sends the reply for the pending request from **n8nChatUI Trigger** (when it's set to `Using 'Respond to n8nChatUI' Node`). Fields: **Text**, **Suggested Replies** (up to 4, sent as `followUpPrompts`). Empty suggested replies produce an envelope with no `followUpPrompts` key at all, rather than an empty array. There is no per-response HTML toggle — see **Open items** for why.

## Credentials

**n8nChatUI API** (`n8nChatUiApi`) — a single `API Key` field. Not required by the v1 `Message → Respond` operation; built ahead of need for a future operation. See [Open items](#open-items) — the auth header/scheme it uses is an unconfirmed placeholder.

## Open items

One serious assumption was found wrong during dogfooding and is not yet fixed — this blocks real production use:

- [ ] **Incoming webhook authentication design is incompatible with the real widget builder.** `n8nChatUiTrigger`'s "Widget Secret" checks a `webhook_secret` value embedded in the request body (`metadata.webhook_secret` / top-level fallback). The actual n8nChatUI widget builder's "Configure Authentication For Your Webhook" only offers **No Auth**, **JWT Auth**, and **Basic Auth** — all header-based, standard schemes. There is no field anywhere in the widget builder to set a body-embedded secret, so this node's entire auth mechanism cannot be satisfied by the real product as it exists today. Needs a rework to validate an `Authorization` header (Basic decode+compare, or JWT verify) instead of a body field before this trigger can be used for anything beyond a `No Auth` test.

Confirmed and fixed during dogfooding (2026-09-16), by decompiling the live widget bundle (`cdn.n8nchatui.com/v1/sun-rises-slowly.umd.js`) rather than guessing:

- [x] **Response envelope shape.** `output` was correct as built. `renderHtml` was wrong — there is no per-response HTML field the widget reads at all; HTML rendering is controlled entirely by the widget builder's "Render HTML in Bot Responses" toggle (`chatWindow.renderHTML`), applied globally to every message. Removed the `Render HTML` node parameter and the `renderHtml` envelope key entirely — it was a dead no-op. `quickReplies` was the wrong key name — the widget reads `followUpPrompts`. Renamed the envelope key to match; the node's own "Suggested Replies" UI label is unchanged.
- [x] **Verified live in a browser** against widget `NlvlGb` (`proxy.n8nchatui.com/api/embed/NlvlGb`): reply text renders correctly, and both follow-up-prompt buttons now render and are clickable, sourced straight from the corrected envelope.

Still unconfirmed, but lower priority (v1's `Message → Respond` doesn't consume this credential at all):

- [ ] **Credential auth header/scheme** (`N8nChatUiApi.credentials.ts`) — `Authorization: Bearer {{apiKey}}`, the `documentationUrl`, and the `test` request URL are all placeholders against an n8nChatUI API that doesn't exist yet. Confirm the real scheme once that API exists.

One more is open because this package isn't published yet:

- [ ] **Icons** — both nodes and the credential share a placeholder chat-bubble SVG, now supplied as proper light/dark variants (`n8nchatui.svg` / `n8nchatui.dark.svg`) so lint passes with zero warnings. Replace with the real n8nChatUI logo before publishing; keep both variants.

Resolved:

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

Confirmed after fixes: wrong secret → 401 generic error body, workflow doesn't run; correct secret (both the nested `metadata.webhook_secret` and top-level `webhook_secret` fallback) → workflow runs, trigger correctly extracts `message` (`chatInput` falling back to `message`), `sessionId`, `pageUrl`, and secret-stripped `metadata`; both `Respond` modes send a clean response; empty **Suggested Replies** omits `quickReplies` entirely; multi-item input responds once, deterministically, using item 0; malformed/hostile payloads (non-string secrets, non-object metadata, empty body) all fail closed with 401 and no stack trace.

The two secret positions are checked in order (`metadata.webhook_secret`, then top-level `webhook_secret`) and **not** OR'd together — verified that a request carrying a wrong nested secret plus a correct top-level one is still rejected, so a second position can't be used to smuggle a valid secret past a wrong one.

### Verification-readiness checks

- `npx n8n-node cloud-support` → **Cloud support ENABLED**, strict mode on, default ESLint config, "eligible for n8n Cloud verification (if lint passes)".
- `npm run lint` → **0 errors, 0 warnings** (exit 0). No `usableAsTool: true`, no LangChain, no runtime `dependencies`, no restricted imports/globals, no lifecycle scripts, valid `peerDependencies` (`n8n-workflow: "*"` only), valid `n8n` manifest with `dist/` paths.
- Codex files (`nodes/*/*.node.json`) added for both nodes — these were dropped when the scaffold's `Example` folder was deleted. Verified they reach `dist` and that n8n loads them (categories resolve to `Communication`, `Marketing`, `Custom Nodes` in the live node list).
- `LICENSE` file added — `package.json` declared MIT with no license file present.
- Both nodes and the credential register in a live instance; all four themed icon files resolve and serve HTTP 200.
- `npm pack --dry-run` → 19 files, 41.4kB unpacked, contains exactly the compiled nodes, credential, codex, icons, README and LICENSE.

**Known, deliberate tradeoff (not a bug):** the Widget Secret is a node parameter (`password: true`), not an n8n credential. n8n only encrypts actual credential values at rest — a node parameter with `password: true` is masked in the UI but stored in plaintext in the workflow JSON/DB/exports/version history. This matches the build plan's explicit spec and was confirmed as the intended design rather than changed: it keeps per-trigger-node secrets (no shared credential across widgets) and avoids extra setup friction. Worth reconsidering if this node is ever used somewhere execution/workflow data isn't tightly access-controlled.

### ⚠️ A note on the official scaffolding tool

The build plan for this package said to run `npx n8n-node new`. **Do not run that command as written** — the exact package name `n8n-node` on npm is a dependency-confusion security placeholder (unrelated to n8n), not the real scaffolding tool. This package was correctly scaffolded with `npx @n8n/create-node@latest`, which is the real, official CLI (its `bin` also happens to be named `n8n-node`, which is presumably why the placeholder squats that name).

### Not yet done: recipe integration test

The build plan's M4 calls for rebuilding the existing `activecampaign-lead-capture.json` recipe workflow with these two nodes in place of the webhook/Set/IF/Respond-to-Webhook chain, then re-running that recipe's 7-point QA checklist. That recipe JSON and the corresponding `recipe-page-activecampaign-lead-capture.md` QA checklist were not present alongside the build plan doc, so this step could not be carried out. Supply those files (or the workflow export) to complete M4.

## Handoff (human-only — npm/GitHub account actions)

Not done here, on purpose — this package is not published, and no git tags were pushed:

1. Confirm the two placeholder assumptions above against the real widget frontend and the (currently nonexistent) analytics API.
2. Ownership is settled: `dani-millside-creative/n8n-nodes-n8nchatui` on GitHub, same npm account. `package.json` (`author`, `repository`, `bugs`) and the codex doc URLs already point there.
3. Set up npm Trusted Publishers for that GitHub Actions repo/workflow.
4. `.github/workflows/publish.yml` (already scaffolded) is wired for provenance publishing against that repo.
5. Publish via that GitHub Actions workflow (`npm run release` is wired locally too, but shouldn't be the publish path).
6. Once published, `npx @n8n/scan-community-package n8n-nodes-n8nchatui` can actually run — it fetches from the npm registry by name, so it can't scan local/unpublished code (confirmed while working on this package: it 404s against a package that isn't on npm yet). Run it post-publish as a final check.
7. Dogfood on a self-hosted instance, recruit real testers, then submit through n8n's Creator Portal for verification.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* [n8nChatUI](https://n8nchatui.com)
