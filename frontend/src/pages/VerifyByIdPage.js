import React, { useEffect, useState, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ScanSearch, FileSearch, FileUp, ArrowLeft } from "lucide-react";
import VerificationResult from "../components/VerificationResult";
import IntegrityResult from "../components/IntegrityResult";
import { verifyCertificatePublic, tamperCheckPublic, apiErrorMessage } from "../utils/api";
import logo from "../assets/nosih-logo.png";
import "./styles.css";

const CERT_RE = /^CERT-[0-9A-F]{8}$/i;
const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true };

/**
 * PUBLIC verification by Certificate ID — no account needed. Chain-authoritative:
 * a database row alone can never produce an authentic verdict, and a chain
 * outage is shown as INDETERMINATE (503), never as success. The stored-document
 * integrity check (hash-only) is included here — there is no separate Tamper
 * Check page.
 */
export default function VerifyByIdPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [input, setInput] = useState(searchParams.get("certificateId") || "");
  const [result, setResult] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const runVerify = useCallback(async (rawId) => {
    const id = String(rawId || "").trim().toUpperCase();
    if (!CERT_RE.test(id)) {
      setError("Enter a certificate ID in the form CERT-XXXXXXXX (printed under the QR code).");
      setResult(null);
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    setIntegrity(null);
    try {
      const res = await verifyCertificatePublic(id);
      setResult(res.data);
    } catch (err) {
      // 404 / 503 still carry a full verdict payload — render it, not a crash.
      const payload = err.response?.data;
      if (payload?.verdict) setResult(payload);
      else setError(apiErrorMessage(err, "Verification failed"));
    } finally {
      setBusy(false);
    }
  }, []);

  // QR codes open /verify?certificateId=CERT-XXXXXXXX — verify immediately.
  useEffect(() => {
    const id = searchParams.get("certificateId");
    if (id) runVerify(id);
  }, []);

  function submit(e) {
    e.preventDefault();
    const id = input.trim().toUpperCase();
    setSearchParams(id ? { certificateId: id } : {});
    runVerify(id);
  }

  function verifyAnother(id) {
    setInput(id);
    setSearchParams({ certificateId: id });
    runVerify(id);
  }

  async function checkStoredIntegrity() {
    if (!result?.certificateId) return;
    setIntegrityBusy(true);
    setIntegrity(null);
    try {
      const res = await tamperCheckPublic(result.certificateId);
      setIntegrity(res.data);
    } catch (err) {
      const payload = err.response?.data;
      if (payload?.verdict) setIntegrity(payload);
      else setIntegrity({ verdict: "not-found", verdictLabel: apiErrorMessage(err, "Integrity check failed"), disclaimer: "" });
    } finally {
      setIntegrityBusy(false);
    }
  }

  return (
    <div className="verify-wrapper">
      <header className="verify-header">
        <img src={logo} alt="NOSIH logo" className="logo-img" />
        <h1>Verify by Certificate ID</h1>
        <p>Enter your unique certificate identifier to retrieve and verify its blockchain registration.</p>
      </header>

      <div className="verify-card">
        <form onSubmit={submit} className="input-row">
          <input
            className="verify-input mono"
            placeholder="CERT-XXXXXXXX"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Certificate ID"
            maxLength={13}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <ScanSearch {...ICON} /> {busy ? "Checking chain…" : "Verify Certificate"}
          </button>
        </form>
        <p className="verify-hint">
          The ID is printed under the QR code on the certificate. Scanning the QR opens this
          page with the check already running.
        </p>

        {error && <div className="alert alert-error">{error}</div>}
        <VerificationResult payload={result} onVerifyAnother={verifyAnother} />

        {result?.found && (
          <div className="verify-actions">
            <button type="button" className="btn btn-secondary" onClick={checkStoredIntegrity} disabled={integrityBusy}>
              <FileSearch {...ICON} /> {integrityBusy ? "Checking stored document…" : "Check stored document integrity"}
            </button>
            <Link className="btn btn-secondary" to="/verify/upload">
              <FileUp {...ICON} /> Verify an uploaded PDF instead
            </Link>
          </div>
        )}

        <IntegrityResult result={integrity} />
      </div>

      <footer className="verify-footer">
        <Link to="/verify"><ArrowLeft {...ICON} /> Back to verification methods</Link>
        <span>NOSIH · hashes on Polygon Amoy · documents encrypted on IPFS</span>
      </footer>
    </div>
  );
}