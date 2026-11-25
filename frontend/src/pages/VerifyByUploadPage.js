import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ScanSearch, ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import CertificateUpload from "../components/CertificateUpload";
import CertificatePreview from "../components/CertificatePreview";
import IntegrityResult from "../components/IntegrityResult";
import { verifyByDocumentPublic, apiErrorMessage } from "../utils/api";
import { explorerTxUrl } from "../services/contract";
import {
  typeLabel, statusBadgeClass, STATUS_LABELS, formatBytes, shortHex,
} from "../utils/certificateHelpers";
import logo from "../assets/nosih-logo.png";
import "./styles.css";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true };

/** Result wording for the upload method (backend verdict keys unchanged). */
const RESULT_LABELS = {
  "exact-match": "Exact Document Match – Authentic",
  modified: "Document Hash Mismatch",
  "not-found": "Certificate Not Found",
  revoked: "Authentic but Revoked",
  expired: "Expired",
  "blockchain-unavailable": "Blockchain Verification Unavailable",
};

/**
 * PUBLIC verification by uploading the original certificate PDF. The existing
 * SHA-256 implementation hashes the exact uploaded bytes server-side; the hash
 * is looked up in the registered-document index and compared against the
 * CHAIN record. Revocation and expiry are checked separately by the chain.
 */
export default function VerifyByUploadPage() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function chooseFile(f) {
    setFile(f);
    setResult(null);
    setError("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("document", file);
      const res = await verifyByDocumentPublic(form);
      setResult(res.data);
    } catch (err) {
      const payload = err.response?.data;
      if (payload?.verdict) setResult(payload);
      else setError(apiErrorMessage(err, "Verification failed"));
    } finally {
      setBusy(false);
    }
  }

  const shown = result
    ? { ...result, verdictLabel: RESULT_LABELS[result.verdict] || result.verdictLabel || result.label }
    : null;
  const cert = result?.certificate;

  return (
    <div className="verify-wrapper">
      <header className="verify-header">
        <img src={logo} alt="NOSIH logo" className="logo-img" />
        <h1>Verify by Certificate PDF</h1>
        <p>Upload your original certificate PDF to verify whether its document hash matches the registered blockchain record.</p>
      </header>

      <div className="verify-card">
        <form onSubmit={submit}>
          <CertificateUpload
            file={file}
            onFile={chooseFile}
            disabled={busy}
            hint="PDF only — the original file is hashed exactly as uploaded (SHA-256) and compared with the chain record."
          />

          {file && (
            <>
              <div className="verify-upload-meta">
                <span><strong>{file.name}</strong> · {formatBytes(file.size)}</span>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => chooseFile(null)} disabled={busy}>
                  <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> Remove / replace
                </button>
              </div>
              <CertificatePreview file={file} title="Uploaded certificate" height={420} />
              <div className="issue-upload-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  <ScanSearch {...ICON} /> {busy ? "Hashing and checking chain…" : "Verify Certificate"}
                </button>
              </div>
            </>
          )}
        </form>

        {error && <div className="alert alert-error">{error}</div>}

        {shown && (
          <>
            <IntegrityResult result={shown} />

            {cert && (
              <div className="result-sections">
                <section className="result-section">
                  <h3>Registered certificate</h3>
                  <table className="details-table">
                    <tbody>
                      <tr><td>Certificate ID</td><td className="mono">{result.certificateId}</td></tr>
                      <tr><td>Certificate holder</td><td>{cert.holderName || "—"}</td></tr>
                      {result.institution && (
                        <tr><td>Institution</td><td>{result.institution.name} <span className="mono">({result.institution.institutionId})</span></td></tr>
                      )}
                      <tr><td>Certificate title</td><td>{cert.courseName || cert.qualification || typeLabel(cert.certificateType)}</td></tr>
                      {result.transactionHash && (
                        <tr>
                          <td>Blockchain transaction</td>
                          <td className="hash-cell">
                            <span className="mono" title={result.transactionHash}>{shortHex(result.transactionHash, 16, 8)}</span>{" "}
                            <a href={explorerTxUrl(result.transactionHash)} target="_blank" rel="noreferrer">
                              <ExternalLink size={13} strokeWidth={1.75} aria-hidden /> explorer
                            </a>
                          </td>
                        </tr>
                      )}
                      {result.certificateStatus && (
                        <tr>
                          <td>Current status</td>
                          <td><span className={statusBadgeClass(result.certificateStatus)}>{STATUS_LABELS[result.certificateStatus] || result.certificateStatus}</span></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </section>
              </div>
            )}
          </>
        )}

        <div className="verify-actions">
          <Link className="btn btn-secondary" to="/verify/certificate-id">
            <ScanSearch {...ICON} /> Verify by Certificate ID instead
          </Link>
        </div>
      </div>

      <footer className="verify-footer">
        <Link to="/verify"><ArrowLeft {...ICON} /> Back to verification methods</Link>
        <span>NOSIH · integrity is proven with hashes, never with AI</span>
      </footer>
    </div>
  );
}