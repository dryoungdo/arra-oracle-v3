# Federated Search Across Peer Arra Instances — Design

**Status:** Draft (waiting on maintainer review at #1126)
**Author:** GLUEBOY (`@dryoungdo`)
**Date:** 2026-05-08

## Goal

Enable `/api/search` (and MCP `arra_search`) to return RRF-merged results from local + peer arra instances, with safe defaults (fail-closed when configured but no peers reachable, opt-in via env).

## Use case

Active-passive multi-body Oracle deployment (e.g. laptop + cloud). Currently each body sees only its local index. Federated search makes "ONE Oracle, two bodies" knowledge symmetric.

## Reference implementation (already battle-tested)

Client-side fan-out + RRF-merge: [`dryoungdo/wireboy@76ad1d1`](https://github.com/dryoungdo/wireboy/blob/main/scripts/arra-fed/arra-fed.ts) — `arra-fed.ts`. 5-round Codex co-review, 14 P-flagged issues fixed. Empirically verified symmetric across 2 bodies (296 mac + 441 do = identical merged 737 from either body).

Battle-tested invariants:
1. **Fusion key**: `JSON.stringify(["doc", source_file, id])` — no string-concat ambiguity
2. **Per-node fusion-key dedupe**: same node's duplicate doesn't inflate RRF
3. **Strict IPv4 CIDR validation**: blocks DNS bypass like `127.evil.example`
4. **Cache key includes topology + localOnly**: no stale results across config changes
5. **Fail-closed default**: `ARRA_REQUIRE_PEERS=1` + `--local-only` escape hatch
6. **Bearer auth client-side**: `ARRA_AUTH_TOKEN` / `ARRA_PEER_TOKENS` env
7. **Response size capped**, **content-type validated**, **every result-item type-checked**
8. **`_contributors_internal` stripped** before serialization (no payload leak)

## Proposed API surface (Option A — server-side, my preference)

### New endpoint: `GET /api/federated_search`

Same query params as `/api/search` plus:
- `peers` (optional, comma-separated `name=url,name=url`) — overrides server config
- `local_only=true` — skip peers, return local result (escape hatch)

Response:
```json
{
  "results": [
    {
      "id": "...",
      "source_file": "...",
      "rrf_score": 0.01639,
      "best_rank": 1,
      "contributors": [
        { "node": "mac", "rank": 1 },
        { "node": "do", "rank": 2 }
      ],
      "_node": "mac",
      // ... existing /api/search fields
    }
  ],
  "total": 737,
  "query": "...",
  "elapsed_ms": 209,
  "nodes_queried": 2,
  "nodes_succeeded": 2,
  "node_doc_counts": { "mac": 296, "do": 441 },
  "degraded": false,
  "degraded_reason": null
}
```

### CLI extension

```bash
arra-cli search "topic" --federate           # uses ARRA_PEERS env
arra-cli search "topic" --peers do=http://... # one-shot override
arra-cli search "topic" --local-only         # escape hatch
```

When `ARRA_PEERS` env is set and `--federate` not passed, default behavior = local-only (no surprise federation).

### MCP `arra_search` extension

Optional `federate: boolean` (default false) parameter. When true, hits `/api/federated_search` internally.

## Configuration

Server reads peer config in priority order:
1. Per-request `peers=` query param (if request explicitly passes peers)
2. `~/.arra/peers.json` (if exists)
3. `ARRA_PEERS` env var (`name=url,name=url`)

Auth tokens via `ARRA_AUTH_TOKEN` (outbound) and `ARRA_PEER_TOKENS` (per-peer override map).

## Open questions for maintainer (re: #1126)

1. **Server-side endpoint vs CLI-only?** Server-side gives MCP parity for free.
2. **Endpoint naming**: `/api/federated_search` (separate) vs `/api/search?federate=true` (extended)?
3. **Auth model**: bearer token vs WG-only-trust vs both?
4. **Acceptable to port `arra-fed.ts` logic verbatim** (it's MIT, my code), or want redesign?
5. **Default behavior when `ARRA_PEERS` is set but no `--federate` flag**: local-only (current proposal) vs auto-federate?

## Out of scope (this PR)

- Cross-fleet federation (Mycelium ↔ Glyph ↔ etc.) — privacy boundary; opt-in only
- Mesh routing (peer-of-peer) — flat fan-out only
- Differential indexing (knowing which docs only one peer has) — RRF doesn't need it
- Auth strategies beyond bearer (mTLS, OAuth) — bearer suffices for current threat model

## Plan

1. ✅ Open Issue #1126 with use case + reference impl link
2. ✅ Fork + branch `feat/federated-search` with this design
3. ⏳ Wait for maintainer alignment on Q1–Q5
4. ⏳ Port `arra-fed.ts` core (RRF merge, fusion keys, dedupe, cache) into `src/server/federation.ts`
5. ⏳ Add `/api/federated_search` route in `src/routes/search/federated.ts`
6. ⏳ Add CLI `--federate` flag in `src/cli/commands/search.ts`
7. ⏳ Add tests (integration + unit) covering single-peer / multi-peer / partial-failure / auth-fail / size-cap
8. ⏳ Open PR linked to #1126
