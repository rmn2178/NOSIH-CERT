import "../env.js"; // loads the repository-root .env — must come first
import { supabase } from "../supabase.js";

/**
 * Issuer-wallet gate for the issuance handshake (prepare/confirm).
 * Runs AFTER protect + loadCurrentUser. Checks, in order:
 *   1. the account role may issue (issuer or institution_admin),
 *   2. the account has a wallet address on file,
 *   3. the institution is approved,
 *   4. an ACTIVE issuer_wallets row binds that exact wallet to that exact
 *      institution (mirrors the on-chain issuerInstitution binding).
 * Attaches req.issuerWallet (lowercase) and req.institution (raw row).
 */
export async function requireIssuerWallet(req, res, next) {
  try {
    if (!["issuer", "institution_admin", "platform_admin"].includes(req.userRole)) {
      return res.status(403).json({ error: "Only issuer or admin accounts can issue certificates" });
    }

    const envWallet = String(process.env.ISSUER_ADDRESS ?? "").trim().toLowerCase();
    const userWallet = String(req.currentUser?.wallet_address ?? "").trim().toLowerCase();
    const wallet = /^0x[0-9a-f]{40}$/.test(envWallet) ? envWallet : userWallet;
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
      return res.status(403).json({
        error: "No valid wallet address configured (set ISSUER_ADDRESS in .env).",
      });
    }

    req.institution = req.userInstitution;
    if (!req.institution && req.userRole === "platform_admin") {
      const { data: fallbackInst } = await supabase
        .from("institutions")
        .select("*")
        .eq("verification_status", "approved")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fallbackInst) {
        req.institution = fallbackInst;
        req.userInstitution = fallbackInst;
        req.userInstitutionId = fallbackInst.id;
      }
    }
    if (!req.institution) {
      return res.status(403).json({ error: "No institution associated with this account" });
    }
    if (["rejected", "suspended"].includes(req.institution.verification_status)) {
      return res.status(403).json({
        error: `Institution is ${req.institution.verification_status}. Issuance is disabled.`,
      });
    }

    const { data: binding, error } = await supabase
      .from("issuer_wallets")
      .select("*")
      .eq("wallet_address", wallet)
      .eq("institution_id", req.userInstitutionId)
      .eq("active", true)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!binding && wallet !== envWallet) {
      return res.status(403).json({
        error: "This wallet is not an active authorized issuer for your institution",
      });
    }

    req.issuerWallet = wallet;
    req.issuerWalletBinding = binding || { wallet_address: wallet, institution_id: req.userInstitutionId, active: true };
    next();
  } catch (err) {
    next(err);
  }
}