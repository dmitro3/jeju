# Onboarding Fixes

This document tracks fixes made to improve the local development onboarding experience.

## Branch: `fix/onboarding-issues`

All fixes are on the `hellno/jeju` fork, branch `fix/onboarding-issues`.

---

## 1. README.md - Kurtosis Formula Name

**File:** `README.md`

**Issue:** The Homebrew formula name for Kurtosis was incorrect.

**Fix:** Changed `kurtosis-tech/tap/kurtosis` to `kurtosis-tech/tap/kurtosis-cli`.

---

## 2. Dynamic Deployment Loading

**File:** `packages/contracts/ts/deployments.ts`

**Issue:** Static imports of deployment JSON files failed during `bun install` because the files don't exist until contracts are deployed.

**Fix:** Changed to dynamic loading with `fs.existsSync` and `readFileSync`, with fallbacks to empty objects. Added `isDeployed()` helper and clear error messages when deployments are missing.

---

## 3. Foundry Dependencies in Postinstall

**File:** `package.json`

**Issue:** `forge install` wasn't run during install, causing missing Solidity dependencies.

**Fix:** Added `cd packages/contracts && forge install --no-git && cd ../..` to the postinstall script.

---

## 4. SQLit Config Property Names

**File:** `packages/shared/src/services/database.ts`

**Issue:** SQLit client config used wrong property names (`blockProducerEndpoint` instead of `endpoint`).

**Fix:** Changed to match the `SQLitClientConfig` interface:
- `blockProducerEndpoint` → `endpoint`
- `timeout` → `timeoutMs`

---

## 5. Stale Git Submodule

**File:** `vendor/eliza-cloud-v2` (deleted)

**Issue:** Stale submodule reference in git index blocking operations.

**Fix:** Removed with `git rm --cached vendor/eliza-cloud-v2`.

---

## 6. Local Domain Network Detection

**File:** `packages/config/index.ts`

**Issue:** `*.local.jejunetwork.org` domains were detected as mainnet instead of localnet, causing "Mainnet contracts not yet deployed" errors.

**Fix:** Added `hostname.endsWith('.local.jejunetwork.org')` to the localnet detection in `detectNetworkFromHostname()`.

---

## 7. UUID Polyfill for HTTP Contexts

**File:** `packages/auth/src/sdk/client.ts`

**Issue:** `crypto.randomUUID()` requires HTTPS (secure context), failing on `http://` local dev URLs.

**Fix:** Added `generateUUID()` helper function that uses `crypto.getRandomValues()` as fallback when `crypto.randomUUID()` is unavailable.

---

## 8. OAuth3 Proxy URL for Browser

**File:** `apps/crucible/web/config/index.ts`

**Issue:** Browser was calling `http://127.0.0.1:4200` directly for OAuth3, causing CORS issues when running from `*.local.jejunetwork.org`.

**Fix:** Added `getOAuth3TeeUrl()` function that returns `http://oauth3.local.jejunetwork.org:8080` when in browser on localnet with proxy domains.

---

## 9. OAuth3 CORS Origins

**File:** `apps/oauth3/api/index.ts`

**Issue:** CORS `Access-Control-Allow-Origin` didn't include `*.local.jejunetwork.org` domains.

**Fix:** Added all local dev proxy domains to `explicitOrigins`:
- `crucible.local.jejunetwork.org:8080`
- `autocrat.local.jejunetwork.org:8080`
- `bazaar.local.jejunetwork.org:8080`
- etc.

---

## 10. Agent Registration Missing Name Field

**File:** `apps/crucible/web/pages/CreateAgent.tsx`

**Issue:** Frontend sent `character.name` but API required top-level `name` field.

**Fix:** Added `name: agentName` to the request body alongside `character`.

---

## 11. KMS Signer Fallback for Localnet

**Files:**
- `apps/crucible/api/sdk/kms-signer.ts`
- `apps/crucible/api/server.ts`

**Issue:** Agent registration failed with "Signer required for registration (KMS or wallet)" because KMS service isn't running locally.

**Fix:** Added fallback wallet mechanism:
- `KMSSigner` now accepts a `fallbackPrivateKey` option
- When KMS service is unavailable on localnet, falls back to local wallet signing
- Uses Anvil default key (`0xac0974...`) for localnet transactions

---

## Local Development Setup

After these fixes, the setup process is:

```bash
# Prerequisites
brew install kurtosis-tech/tap/kurtosis-cli
brew install caddy

# Install dependencies
bun install

# Add hosts entries (one-time, requires sudo)
sudo tee -a /etc/hosts << 'EOF'
# JEJU LOCAL DEV START
127.0.0.1  local.jejunetwork.org
127.0.0.1  crucible.local.jejunetwork.org
127.0.0.1  oauth3.local.jejunetwork.org
# ... other domains
# JEJU LOCAL DEV END
EOF

# Start development
bun run dev

# Access apps
open http://crucible.local.jejunetwork.org:8080
```

## Environment Variables

For agent inference to work, add to `.env`:

```bash
# One of these (GROQ has free tier)
GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Chain Configuration

| Network | Chain ID | RPC URL |
|---------|----------|---------|
| Localnet | 31337 | http://127.0.0.1:6546 |
| Testnet | 420690 | https://testnet-rpc.jejunetwork.org |
| Mainnet | 420691 | https://rpc.jejunetwork.org |

## Test Wallet (Localnet)

```
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```
