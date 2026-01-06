# Local Development Issues

Issues discovered during debugging that cause services to not work properly after `bun run dev`.

## Issue 1: Indexer Not Started by `bun run dev`

**Location**: `packages/cli/src/commands/dev.ts:445-447`

```typescript
let filtered = apps.filter(
  (app) =>
    app.enabled !== false &&
    app.autoStart !== false &&
    app.name !== 'indexer' &&    // <-- Indexer explicitly excluded!
    app.name !== 'monitoring',
)
```

**Impact**: The indexer is explicitly excluded from the dev startup. This means:
- Agent search returns empty (`/api/v1/search/agents`)
- Room member lookups fail
- Any feature relying on indexed blockchain data doesn't work

**Workaround**: Manually start the indexer:
```bash
cd apps/indexer
bun run db:up        # Start PostgreSQL (requires Docker)
bun run dev:full     # Start processor, GraphQL, and API
```

All indexer components use the same PostgreSQL database.

## Issue 2: Contract Address Config Can Be Stale

**Location**: `packages/config/contracts.json` vs deployment files

After a fresh `bun run dev`, contract addresses in `packages/config/contracts.json` may not match the actually deployed contracts.

**Status**: Auto-sync added after bootstrap.

## Issue 3: "READY" Screen Hides Service Failures

When `bun run dev` completes, it shows a "READY" screen that clears all previous logs (`console.clear()` at line 541 in dev.ts). This hides:
- Services that failed to start
- Configuration errors
- Missing dependencies

**Impact**: User sees "READY" but services may not be running properly.

**Status**: Fixed - now shows failed services before READY.

## Recommendations

1. **Include indexer in dev startup** - Remove the exclusion or add a `--with-indexer` flag
2. **Keep logs visible** - Don't clear screen, or show a summary of warnings/errors

## Quick Debug Commands

```bash
# Check what's running
lsof -i :4350  # GraphQL
lsof -i :4352  # REST API
lsof -i :4021  # Crucible API
lsof -i :6546  # Anvil chain

# Check if agents are indexed
curl -s "http://localhost:4350/graphql" -d '{"query":"{ registeredAgents { id } }"}'

# Check agent directly from chain
curl -s "http://127.0.0.1:4021/api/v1/agents/14" | jq .

# Start missing indexer services
cd apps/indexer
bun run db:up && bun run dev:full
```
