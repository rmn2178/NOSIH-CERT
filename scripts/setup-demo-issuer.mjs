#!/usr/bin/env node
/**
 * NOSIH demo — creates a sample issuer account under the Meridian institution
 * and registers the issuer wallet in the database.
 *
 *   node --env-file=.env scripts/setup-demo-issuer.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend", "package.json"));
require("dotenv").config({ path: path.join(root, ".env") });

const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── 1. Find institution ───────────────────────────────────
const { data: inst, error: instErr } = await supabase
  .from("institutions")
  .select("id, institution_id, name")
  .eq("institution_id", "INST-BBF5A9DF")
  .single();

if (instErr || !inst) {
  console.error("Institution not found — run: npm run setup:institution first");
  process.exit(1);
}
console.log(`✅ Institution: ${inst.name} (${inst.institution_id})`);

// ── 2. Create issuer user ─────────────────────────────────
const ISSUER_EMAIL = "issuer@meridian-example.com";
const ISSUER_PASS = "Issuer@2026";

const { data: existingUser } = await supabase
  .from("users")
  .select("id, email, role")
  .eq("email", ISSUER_EMAIL)
  .maybeSingle();

if (existingUser) {
  console.log(`   Issuer already exists: ${existingUser.email} (${existingUser.role})`);
} else {
  const hash = await bcrypt.hash(ISSUER_PASS, 12);
  const { data: newUser, error: uErr } = await supabase
    .from("users")
    .insert({
      email: ISSUER_EMAIL,
      password_hash: hash,
      role: "issuer",
      institution_id: inst.id,
      organization_name: inst.name,
      active: true,
    })
    .select()
    .single();

  if (uErr) {
    console.error("Error creating issuer:", uErr.message);
    process.exit(1);
  }
  console.log(`✅ Created issuer: ${newUser.email}`);
}

// ── 3. Register issuer wallet ─────────────────────────────
const WALLET = (process.env.ISSUER_ADDRESS || "").toLowerCase();
if (!WALLET) {
  console.error("ISSUER_ADDRESS not set in .env");
  process.exit(1);
}

const { data: existingWallet } = await supabase
  .from("issuer_wallets")
  .select("id, active")
  .eq("wallet_address", WALLET)
  .maybeSingle();

if (existingWallet) {
  console.log(`   Wallet already registered: ${WALLET} (active: ${existingWallet.active})`);
} else {
  const { error: wErr } = await supabase.from("issuer_wallets").insert({
    institution_id: inst.id,
    wallet_address: WALLET,
    active: true,
  });
  if (wErr) {
    console.error("Wallet registration error:", wErr.message);
    process.exit(1);
  }
  console.log(`✅ Wallet registered: ${WALLET}`);
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║          NOSIH DEMO — PROTOTYPE CREDENTIALS                  ║
╠══════════════════════════════════════════════════════════════╣
║  Platform Admin                                              ║
║    Email   : admin@nosih.com                                 ║
║    Password: ADMIN@123                                       ║
╠══════════════════════════════════════════════════════════════╣
║  Institution: Meridian Institute of Technology               ║
║                                                              ║
║  Institution Admin (approve members, manage institution)     ║
║    Email   : registrar@meridian-example.com                  ║
║    Password: Meridian@2026                                   ║
║                                                              ║
║  Issuer (registers/issues certificates on blockchain)        ║
║    Email   : issuer@meridian-example.com                     ║
║    Password: Issuer@2026                                     ║
╠══════════════════════════════════════════════════════════════╣
║  Flow:                                                       ║
║  1. Login as Issuer → Issue a Certificate                    ║
║  2. Upload a PDF → AI extracts fields → Review               ║
║  3. Connect MetaMask → Sign & submit to Polygon Amoy         ║
║  4. Copy the CERT-XXXXXXXX ID                                ║
║  5. Go to Verify → paste ID → see chain-authoritative status ║
╚══════════════════════════════════════════════════════════════╝
`);
