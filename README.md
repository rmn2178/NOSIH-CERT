# CertiChain

Decentralized certificate authentication for academic and professional credentials.
Institutions issue tamper-evident certificates; anyone verifies them against the
Polygon Amoy blockchain — no account needed. The chain is the authority: a
certificate is authentic only when its on-chain record matches the approved
document and metadata, and its issuer was authorized by an approved institution.

## Architecture

```
Browser (React SPA)                    Vercel
  MetaMask — signs issuance              │
  public verify / tamper check           ▼
        │                          Express API (backend/)
        │                            │        │         │
        ▼                            ▼        ▼         ▼
  Polygon Amoy (80002)          Supabase    Pinata    Google Gemini
  CertificateRegistry           Postgres    IPFS      text-only extraction
  hashes + status only          + RLS       AES-256-GCM ciphertext
```

Three stores, three jobs:

- **Supabase Postgres** — institutions, users, certificates, issuance intents,
  private event log (revocation reasons). RLS is on with zero policies; only the
  backend's service-role key reaches the data.
- **Pinata IPFS** — the certificate PDF, encrypted with AES-256-GCM before
  upload. Only ciphertext is ever pinned.
- **Polygon Amoy — CertificateRegistry** — keyed hashes and lifecycle status.
  No names, no roll numbers, no plaintext ever goes on-chain. Verification reads
  the chain directly and treats the database as a secondary index.

### Security model

- Issuance is signed **only by the issuer's MetaMask wallet**. The backend
  prepares exact call arguments and independently verifies the receipt; there is
  no server-side issuance key.
- Revocation is the **only server-side chain write**, signed by a dedicated
  `REVOKE_PRIVATE_KEY` (REVOKER_ROLE). The reason text stays private in Supabase;
  only its keyed hash goes on-chain.
- Identity hashes are HMAC-SHA256 with a server-side pepper (`HASH_PEPPER`), so
  low-entropy inputs (names, ids) cannot be brute-forced from public chain data.
- AI extraction is a convenience, never an authenticity proof. A human approves
  every field before anything is hashed, pinned, or signed.
- Missing credentials produce clear configuration errors (503 with the exact
  variable names) — never simulated success.

### Roles

| Role | Capabilities |
| --- | --- |
| `platform_admin` | Approve/reject/suspend institutions, manage any institution's staff and wallets, revoke any certificate |
| `institution_admin` | Own institution profile, wallets, staff; issue, revoke, reissue own certificates |
| `issuer` | Issue and reissue own institution's certificates |
| `auditor` | Read-only access to own institution's certificates |
| public | Verify by certificate id / QR, run tamper checks — no account |

## Repository layout

```
backend/            Express API (ESM) — routes, services, middleware
  supabase/migrations/001_certichain.sql   additive schema migration
  scripts/          offline gates (checkP2…checkP8), seed, smoke, fixtures
contracts/          CertificateRegistry.sol (OpenZeppelin AccessControl)
test/               Hardhat suites — in-memory network only
frontend/           React SPA (CRA) — issue, verify, tamper, institutions
scripts/            deploy/issuer tooling, env + service diagnostics, Vercel wiring
deployments/        amoy.json — written by deploy:amoy (address, tx, roles)
plan/               migration plan and design documents
```

## Quick start (local)

Prerequisites: Node 22, a Supabase project, a Pinata account, a Gemini API key,
MetaMask with Polygon Amoy added, and POL for the deployer/issuer/revoker wallets.

```bash
npm install                     # contract tooling
npm install --prefix backend
npm install --prefix frontend

cp .env.example .env            # fill in — see the template's comments
# frontend/.env.local: REACT_APP_API_URL=/api, REACT_APP_CHAIN_ID=80002,
# REACT_APP_AMOY_RPC_URL (public RPC), REACT_APP_CONTRACT_ADDRESS (after deploy)
```

1. **Database** — existing NOSIH project: apply
   `backend/supabase/migrations/001_certichain.sql` in the Supabase SQL editor
   (additive, idempotent — land data is preserved; take a backup first).
   Fresh project: run `backend/supabase/schema.sql` instead.
2. **Platform admin** — `npm run seed:admin` (uses `ADMIN_EMAIL` / `ADMIN_PASSWORD`).
3. **Contract** — `npm run deploy:amoy -- --yes` (live write; needs a funded
   deployer). It grants REVOKER_ROLE, saves `deployments/amoy.json`, regenerates
   both ABI modules, and fills `CONTRACT_ADDRESS` in both env files.
4. **Institution** — sign in as the platform admin, register the institution
   (or use the public application flow), approve it, add its issuer wallet.
5. **Authorize the wallet on-chain** — `npm run issuer:add -- --yes` (defaults to
   `ISSUER_ADDRESS` and the only approved institution). This also activates the
   `issuer_wallets` row the issuance handshake checks.
6. **Run** — `npm --prefix backend run dev` (port 5000) and
   `npm --prefix frontend start` (port 3000, proxies `/api`).

The issuer imports their wallet key into MetaMask, funds it with POL, and issues
from the Issue page. The private key never touches the server.

## Core flows

**Issuance (prepare → sign → confirm).** Upload the PDF → text-only AI extraction
(digital PDFs through their text layer; scanned pages OCR'd locally, only text
sent to Gemini) → human review of every field → backend hashes the approved
metadata + exact document bytes, encrypts and pins the PDF, and creates a
30-minute issuance intent → MetaMask signs `issueCertificate` with the pinned
arguments → backend independently verifies the receipt and every
`CertificateIssued` event field against the intent before the certificate row
becomes authoritative. Confirm is idempotent and retry-safe (202 while pending).

**Verification (public, chain-first).** `/verify` reads the chain directly.
Ten verdicts: authentic-active, revoked, expired, superseded, document-mismatch,
metadata-mismatch, issuer-unauthorized, not-found, db-chain-mismatch, and
blockchain-unavailable (503 — indeterminate, never "valid from the DB alone").

**Tamper check (public).** Mode A re-hashes the stored ciphertext's plaintext;
Mode B hashes uploaded bytes against the chain's document hash. Superseded
certificates link to the registered replacement.

**Revocation / reissue.** Platform admin or the owning institution admin revokes
with a mandatory reason (private in the event log, keyed hash on-chain). Reissue
prefills a new certificate from the old one and records the supersede link on
both chain and database.

## Deployment (Vercel)

`vercel.json` builds the frontend and serves the API from `api/index.js`
(same origin, `/api/*` rewrite). `REACT_APP_*` values are inlined at **build
time** — they must exist on the project before deploying:

```bash
vercel login
npm run vercel:env        # pushes backend vars + REACT_APP_* (dry-run: --dry-run)
npm run check:deploy      # preflight: env, live credentials, native modules, trace
npm run vercel:deploy
```

Local-only variables (`PORT`, `ADMIN_*`, `DEPLOYER_PRIVATE_KEY`, …) are never
pushed. There is no `ISSUER_PRIVATE_KEY` anywhere — issuance is MetaMask-only.

## Verification gates

No CI workflows are configured; these local gates are the proof. Offline gates
run without credentials; live gates need the real `.env`.

| Gate | What it proves |
| --- | --- |
| `npm test` | CertificateRegistry + issuance handshake + verification suites (in-memory Hardhat — never a live ledger) |
| `npm run check:p2` … `check:p8` | schema/authz, extraction, storage/QR, handshake, verification/revocation, frontend contracts — offline |
| `npm run check:ui-render` | production bundle renders readable failures in jsdom (no blank React tree) |
| `npm run check:env` | env audit, key/address derivation, frontend config, RPC + balances (read-only) |
| `npm run check:gas` | wallet credit report (read-only, nothing broadcast) |
| `npm run check:services` | Supabase / Gemini / Pinata credentials with real read-only calls |
| `npm run check:jwt` / `check:ipfs` | Pinata JWT scope; 1-byte pin + fetch roundtrip |
| `npm run check:extract` | real-Gemini extraction on digital + scanned certificate fixtures |
| `npm run check:boot` | misconfigured boot stays up and names every missing variable |
| `npm run check:deploy` | full Vercel preflight incl. native-module file trace |
| `npm run smoke:api` | live HTTP authorization story (needs migration + seeded admin) |

Standing rule: **no test writes to the live ledger.** All contract tests run on
the in-memory Hardhat network; live Amoy writes (deploy, authorize, acceptance
issuances/revocations) happen only with explicit approval and funded wallets.

## Environment reference

Required at boot: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the **secret**
service-role key — the publishable key cannot read `users`), `JWT_SECRET`,
`DOCUMENT_ENC_KEY`, `HASH_PEPPER`. Chain reads additionally need
`CONTRACT_ADDRESS`. Feature-gated: `GEMINI_API_KEY` (extraction), Pinata
credentials (issuance), `REVOKE_PRIVATE_KEY` (revocation). Back up
`DOCUMENT_ENC_KEY` and `HASH_PEPPER` — losing them loses stored certificates and
breaks identity linkage. See `.env.example` for the full annotated list.