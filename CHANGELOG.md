# Changelog

## 0.1.0 (unreleased)

- Initial build: `n8nChatUI Trigger` (webhook trigger with timing-safe secret check) and `n8nChatUI` (`Message → Respond` action node), plus the `n8nChatUiApi` credential (unused by v1, built for forward compatibility).
- Found and fixed 8 bugs during manual verification (none caught by build/lint): empty `sendResponse()` body; `"firstEntryJson"` leaking into the `Immediately` response mode; an auth bypass when the Widget Secret is left blank; the secret leaking into execution data via forwarded `metadata`; a per-item response loop violating the "respond once" webhook contract; an unauthenticated HTTP 500 with stack-trace disclosure triggered by a non-string `webhook_secret`; expression-driven type confusion in the response envelope (`renderHtml: "false"` reading as `true`, objects becoming `[object Object]`); and 206kB of `tsbuildinfo` build cache in the published tarball. See README "Development" for details on each.
- Added codex files (`nodes/*/*.node.json`, lost when the scaffold's `Example` node was removed), a `LICENSE` file, and light/dark icon variants — lint now passes with 0 errors and 0 warnings.
- Not yet published. See README "Open items" and "Handoff" for what's left.
- Verification audit: confirmed clean `build`/`lint`/`npm pack --dry-run` (19 files, no build-cache leakage), no runtime `dependencies`, `cloud-support` eligible. Replaced placeholder author/copyright/doc-URLs with real values (`dani-millside-creative`) ahead of pushing to GitHub.
