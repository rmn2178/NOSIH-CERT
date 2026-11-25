import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ShieldX, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import { formatDateTime } from "../utils/certificateHelpers";

/** Verdict → presentation. Keys match the backend tamper verdicts exactly. */
const STYLE = {
  intact: { cls: "status-valid", Icon: ShieldCheck, text: "The stored document decrypts, authenticates and matches the chain fingerprint byte-for-byte." },
  "exact-match": { cls: "status-valid", Icon: ShieldCheck, text: "The uploaded PDF is byte-for-byte the document registered on-chain." },
  "stored-document-mismatch": { cls: "status-invalid", Icon: ShieldX, text: "The stored document does NOT match the chain fingerprint. Treat the stored copy as compromised." },
  modified: { cls: "status-invalid", Icon: ShieldX, text: "The uploaded PDF does NOT match the registered document. It has been modified or was never registered." },
  "registered-under-different-id": { cls: "status-invalid", Icon: ShieldAlert, text: "This exact document IS registered — but under a different certificate ID. The ID you entered does not own this document." },
  revoked: { cls: "status-revoked", Icon: ShieldX, text: "The document matches the registered hash, but the certificate has been REVOKED. Do not accept it." },
  expired: { cls: "status-warning", Icon: ShieldAlert, text: "The document matches, but the certificate has expired." },
  superseded: { cls: "status-warning", Icon: ShieldAlert, text: "The document matches, but this certificate was superseded by a newer one." },
  "not-found": { cls: "status-invalid", Icon: ShieldAlert, text: "No registered record was found for this document. The lookup uses the registered-document hash index — an unregistered PDF cannot be matched." },
  "blockchain-unavailable": { cls: "status-warning", Icon: ShieldAlert, text: "The blockchain could not be reached. This result is INDETERMINATE — the document is NOT confirmed authentic. Retry in a moment." },
};

/**
 * Document-integrity result (hash comparison). Shared by both verification
 * methods — integrity checking lives only inside Verify Certificate.
 */
export default function IntegrityResult({ result }) {
  if (!result) return null;
  const style = STYLE[result.verdict] || STYLE["not-found"];

  return (
    <div className="verify-result">
      <div className={`status-banner ${style.cls}`}>
        <style.Icon size={26} strokeWidth={1.75} aria-hidden />
        <div>
          <strong>{result.verdictLabel || result.label || result.verdict}</strong>
          {result.certificateId && <small className="mono">{result.certificateId}</small>}
        </div>
      </div>
      <p className="tamper-explain">{style.text}</p>

      {result.verdict === "blockchain-unavailable" && result.error && (
        <div className="alert alert-error">{result.error}</div>
      )}

      {result.registeredCertificateId && (
        <div className="alert alert-warning">
          The document belongs to <Link className="mono" to={`/verify/certificate-id?certificateId=${result.registeredCertificateId}`}>{result.registeredCertificateId}</Link>.
        </div>
      )}
      {result.supersededByCertificateId && (
        <div className="alert alert-warning">
          Replaced by <Link className="mono" to={`/verify/certificate-id?certificateId=${result.supersededByCertificateId}`}>{result.supersededByCertificateId}</Link>.
        </div>
      )}

      {(result.uploadedHash || result.chainDocumentHash) && (
        <div className={`hash-comparison ${result.match === true ? "is-match" : result.match === false ? "is-mismatch" : ""}`}>
          <div className="hash-compare-grid">
            <div className="hash-card">
              <span className="hash-label">On-Chain SHA-256</span>
              <code className="hash-val original mono" title={result.chainDocumentHash || ""}>
                {result.chainDocumentHash || "No matching record found on-chain"}
              </code>
            </div>
            <div className="hash-card">
              <span className="hash-label">Uploaded PDF SHA-256</span>
              <code
                className={`hash-val mono ${result.match === true ? "match" : result.match === false ? "mismatch" : ""}`}
                title={result.uploadedHash || ""}
              >
                {result.uploadedHash || "—"}
              </code>
            </div>
          </div>
          {result.match === true && (
            <div className="hash-match-indicator match">
              <CheckCircle2 size={16} strokeWidth={2} aria-hidden /> Byte-for-byte SHA-256 match — authentic document
            </div>
          )}
          {result.match === false && (
            <div className="hash-match-indicator mismatch">
              <XCircle size={16} strokeWidth={2} aria-hidden />{" "}
              {result.chainDocumentHash ? "SHA-256 mismatch — document has been modified" : "Uploaded hash is not registered on-chain"}
            </div>
          )}
        </div>
      )}

      {result.mode === "stored-document" && result.documentSource && (
        <p className="muted">
          Source: {String(result.documentSource).includes("/ipfs/") || String(result.documentSource).startsWith("http") ? "IPFS (encrypted mirror)" : "private storage cache"} —
          contents were decrypted server-side for hashing only and are never exposed by this check.
        </p>
      )}
      {result.revoked && result.verdict !== "revoked" && (
        <div className="revoked-section">Note: this certificate is revoked on-chain.</div>
      )}
      <p className="verify-disclaimer">
        {result.disclaimer} {result.verifiedAt && <>Checked {formatDateTime(result.verifiedAt)}.</>}
      </p>
    </div>
  );
}