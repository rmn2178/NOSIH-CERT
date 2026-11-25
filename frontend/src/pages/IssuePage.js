import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, FileUp, FolderOpen, Sparkles, PenLine, ShieldCheck, ExternalLink, AlertTriangle,
  CheckCircle2, Loader2, Lock,
} from "lucide-react";
import Layout from "../components/Layout";
import CertificateUpload from "../components/CertificateUpload";
import CertificatePreview from "../components/CertificatePreview";
import WalletConnect from "../components/WalletConnect";
import TransactionStatus from "../components/TransactionStatus";
import QRDisplay from "../components/QRDisplay";
import {
  extractCertificate, fetchTemplates, prepareIssuance, confirmIssuance, startReissue,
  apiErrorMessage, sessionUser,
} from "../utils/api";
import { issueCertificate, explorerTxUrl } from "../services/contract";
import { classifyWalletError } from "../services/wallet";
import {
  FIELD_LABELS, TYPE_LABELS, extraFieldLabel, formatDateTime,
} from "../utils/certificateHelpers";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true };

const EMPTY_FIELDS = {
  certificateType: "other", certificateNumber: "", holderName: "", holderIdentifier: "",
  institutionName: "", institutionAddress: "", courseName: "", qualification: "",
  qualificationLevel: "", specialization: "", grade: "", percentage: "",
  issueDate: "", expiryDate: "", academicYear: "", signatoryName: "", signatoryDesignation: "",
};

const DATE_FIELDS = new Set(["issueDate", "expiryDate"]);
const REQUIRED_FIELDS = new Set(["certificateType", "holderName"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Certificate registration flow: upload → extract → HUMAN REVIEW → prepare →
 * MetaMask sign → independent backend confirmation → receipt.
 *
 * The server never signs. A certificate row exists only after the backend
 * has verified the on-chain receipt against the prepared intent.
 */
export default function IssuePage() {
  const user = sessionUser() || {};
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [phase, setPhase] = useState("upload");
  const [file, setFile] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [fields, setFields] = useState({
    ...EMPTY_FIELDS,
    institutionName: user.institution?.name || "",
    institutionAddress: user.institution?.address || "",
  });
  const [extraData, setExtraData] = useState({});
  const [ai, setAi] = useState(null); // {confidence, evidence, inferredFields, strategy, disclaimer}
  const [reissue, setReissue] = useState(null); // startReissue response
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prepare, setPrepare] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [certificate, setCertificate] = useState(null);
  const [confirmError, setConfirmError] = useState("");
  const [bgStatus, setBgStatus] = useState("idle"); // idle | running | ready | error
  const signerRef = useRef(null);
  const aliveRef = useRef(true);
  const holderNameRef = useRef(null);
  const bgExtractRef = useRef(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Field contract + optional reissue prefill.
  useEffect(() => {
    fetchTemplates()
      .then((res) => setTemplates(res.data))
      .catch((err) => setError(apiErrorMessage(err, "Could not load the field contract")));

    const prefill = location.state?.reissue;
    const reissueId = prefill?.supersedesCertificateId || searchParams.get("reissue");
    if (prefill) {
      applyReissue(prefill);
    } else if (reissueId) {
      startReissue(reissueId)
        .then((res) => applyReissue(res.data))
        .catch((err) => setError(apiErrorMessage(err, "Could not load the reissuance prefill")));
    }
  }, []); // mount-only: templates load once; reissue prefill reads search params at mount

  function applyReissue(data) {
    setReissue(data);
    setFields((f) => ({ ...f, ...data.fields }));
    setExtraData(data.extraData || {});
    setNotice(`Reissuing ${data.supersedesCertificateId}: upload the corrected PDF. The original stays on-chain untouched; verifying it will point to the new certificate.`);
  }

  function setField(key, value) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function resetFlow() {
    bgExtractRef.current = null;
    setBgStatus("idle");
    setPhase("upload");
    setFile(null);
    setError("");
    setConfirmError("");
    setPrepare(null);
    setTxHash(null);
    setCertificate(null);
    setNotice("");
    setAi(null);
  }

  function applyExtractedData(d) {
    setFields((f) => {
      const merged = { ...f };
      for (const [k, v] of Object.entries(d.fields || {})) {
        // Keep the logged-in user's institution details if the document only had a fallback.
        if ((k === "institutionName" || k === "institutionAddress") && f[k] && (!d.evidence?.[k] || d.inferredFields?.includes(k))) {
          continue;
        }
        if (v) merged[k] = v;
      }
      return merged;
    });
    setExtraData(d.extraData || {});
    setAi({
      confidence: d.confidence || {}, evidence: d.evidence || {},
      inferredFields: d.inferredFields || [], strategy: d.strategy,
      disclaimer: d.disclaimer,
    });
    setNotice("");
    setPhase("review");
  }

  function startBackgroundExtraction(selectedFile) {
    const form = new FormData();
    form.append("document", selectedFile);
    const entry = { file: selectedFile, status: "running", data: null, error: null, promise: null };
    setBgStatus("running");
    entry.promise = extractCertificate(form)
      .then((res) => {
        entry.status = "ready";
        entry.data = res.data;
        if (aliveRef.current && bgExtractRef.current === entry) {
          setBgStatus("ready");
        }
        return res.data;
      })
      .catch((err) => {
        entry.status = "error";
        entry.error = err;
        if (aliveRef.current && bgExtractRef.current === entry) {
          setBgStatus("error");
        }
        throw err;
      });
    bgExtractRef.current = entry;
    return entry;
  }

  function handleFileSelect(selectedFile) {
    setFile(selectedFile);
    setError("");
    if (!selectedFile || reissue) {
      bgExtractRef.current = null;
      setBgStatus("idle");
      return;
    }
    startBackgroundExtraction(selectedFile);
  }

  // ── Upload → extraction ────────────────────────────────
  async function runExtraction() {
    if (!file) return;
    const bg = bgExtractRef.current;
    if (bg && bg.file === file && bg.status === "ready" && bg.data) {
      applyExtractedData(bg.data);
      return;
    }

    setPhase("extracting");
    setError("");
    try {
      const data = bg && bg.file === file && bg.status === "running"
        ? await bg.promise
        : await startBackgroundExtraction(file).promise;
      if (!aliveRef.current) return;
      applyExtractedData(data);
    } catch (err) {
      if (!aliveRef.current) return;
      // Extraction failure never blocks registration — manual entry is always possible.
      setAi(null);
      setNotice(`Automatic extraction failed (${apiErrorMessage(err, "unknown error")}). Enter the details manually — every field is editable.`);
      setPhase("review");
    }
  }

  function manualEntry() {
    setAi(null);
    setNotice("Manual entry: fill every field from the source document. Nothing is guessed.");
    setPhase("review");
  }

  // ── Review → prepare ───────────────────────────────────
  const reviewValid =
    fields.holderName.trim().length >= 2 &&
    (templates?.types || Object.keys(TYPE_LABELS)).includes(fields.certificateType);

  async function runPrepare() {
    if (!file || !reviewValid) return;
    setPhase("preparing");
    setError("");
    try {
      const form = new FormData();
      form.append("document", file);
      form.append("metadata", JSON.stringify({ ...fields, extraData }));
      if (reissue?.supersedesCertificateId) {
        form.append("supersedesCertificateId", reissue.supersedesCertificateId);
      }
      const res = await prepareIssuance(form);
      if (!aliveRef.current) return;
      setPrepare(res.data);
      setPhase("wallet");
    } catch (err) {
      if (!aliveRef.current) return;
      setError(apiErrorMessage(err, "Prepare failed"));
      setPhase("review");
    }
  }

  // ── Wallet → sign → confirm ────────────────────────────
  async function onWalletReady({ signer }) {
    signerRef.current = signer;
    setPhase("signing");
    setError("");
    setNotice("");
    try {
      const { txHash: hash } = await issueCertificate(signer, prepare.issueArgs);
      if (!aliveRef.current) return;
      setTxHash(hash);
      setPhase("confirming");
      await runConfirm(prepare.certificateId, hash);
    } catch (err) {
      if (!aliveRef.current) return;
      const werr = classifyWalletError(err);
      setError(werr.message);
      if (werr.code === "USER_REJECTED") {
        setNotice("Nothing was signed or submitted. The prepared intent is still valid — sign again whenever you are ready.");
      }
      // Nothing was broadcast — the intent stays prepared and signing can retry.
      setPhase("wallet");
    }
  }

  async function runConfirm(certificateId, hash) {
    setConfirmError("");
    for (let attempt = 0; attempt < 24; attempt++) {
      try {
        const res = await confirmIssuance(certificateId, hash);
        if (!aliveRef.current) return;
        setCertificate(res.data.certificate);
        setPhase("receipt");
        return;
      } catch (err) {
        if (!aliveRef.current) return;
        const status = err.response?.status;
        const data = err.response?.data;
        if (status === 202 || (status === 503 && attempt < 6)) {
          // Pending receipt / temporary chain outage — retry safely.
          await sleep(5000);
          continue;
        }
        if (status === 500 && data?.recovery) {
          setConfirmError(
            `${data.error} Transaction ${hash} is safe on-chain — use Retry confirm.`
          );
          return; // stay on confirming with a retry button
        }
        // 409 rejected / 410 expired / anything else: readable failure.
        setConfirmError(apiErrorMessage(err, "Confirmation failed"));
        setPhase("failed");
        return;
      }
    }
    setConfirmError("The receipt is still pending after two minutes. The transaction is safe on-chain — use Retry confirm.");
  }

  // ── Render ─────────────────────────────────────────────
  const extraKeys = Array.from(new Set([
    ...Object.keys(templates?.templates?.[fields.certificateType]?.extraFields || {}),
    ...Object.keys(extraData),
  ]));

  const ttlText = prepare?.intentExpiresAt
    ? `Prepared intent expires ${formatDateTime(prepare.intentExpiresAt)} — sign before then.`
    : "";

  const content = (
    <div className="issue-flow">
      {/* Step rail */}
      <ol className="issue-rail">
        {[
          ["upload", "1. Upload PDF"],
          ["review", "2. Review Details"],
          ["wallet", "3. Sign & Register"],
          ["receipt", "4. Receipt"],
        ].map(([key, label]) => {
          const order = ["upload", "extracting", "review", "preparing", "wallet", "signing", "confirming", "receipt"];
          const active = order.indexOf(phase) >= order.indexOf(key) &&
            !(key === "upload" && order.indexOf(phase) > 1) &&
            !(key === "review" && order.indexOf(phase) > 3) &&
            !(key === "wallet" && order.indexOf(phase) > 6);
          const current =
            (key === "upload" && ["upload", "extracting"].includes(phase)) ||
            (key === "review" && ["review", "preparing"].includes(phase)) ||
            (key === "wallet" && ["wallet", "signing", "confirming"].includes(phase)) ||
            (key === "receipt" && phase === "receipt");
          return (
            <li key={key} className={`${active ? "active" : ""} ${current ? "current" : ""}`}>{label}</li>
          );
        })}
      </ol>

      {reissue && phase !== "receipt" && (
        <div className="alert alert-success">
          Reissuing <span className="mono">{reissue.supersedesCertificateId}</span> ({reissue.target?.holderName}). {reissue.note}
        </div>
      )}
      {notice && <div className="alert alert-success">{notice}</div>}
      {error && phase !== "confirming" && <div className="alert alert-error">{error}</div>}

      {/* ── STEP 1: UPLOAD ── */}
      {phase === "upload" && (
        <div className="card">
          <h3 className="section-title">Step 1 — Upload the original certificate PDF</h3>
          <CertificateUpload file={file} onFile={handleFileSelect} />
          {file && (
            <div className="issue-upload-actions">
              <button type="button" className="btn btn-primary" onClick={reissue ? () => setPhase("review") : runExtraction}>
                {reissue
                  ? (<><ArrowRight {...ICON} /> Continue with previous metadata</>)
                  : bgStatus === "ready"
                    ? (<><CheckCircle2 {...ICON} /> Review extracted details</>)
                    : bgStatus === "running"
                      ? (<><Loader2 {...ICON} className="spin" /> Extracting details… Continue</>)
                      : (<><Sparkles {...ICON} /> Extract details with AI</>)}
              </button>
              {!reissue && (
                <button type="button" className="btn btn-secondary" onClick={manualEntry}>
                  <PenLine {...ICON} /> Enter details manually
                </button>
              )}
            </div>
          )}
          <p className="issue-hint">
            The original PDF is hashed exactly as uploaded, encrypted, and stored on IPFS.
            Only cryptographic hashes reach the blockchain — never names or personal identifiers.
          </p>
        </div>
      )}

      {/* ── EXTRACTING ── */}
      {phase === "extracting" && <ExtractingView fileName={file?.name} />}

      {/* ── STEP 2: REVIEW ── */}
      {(phase === "review" || phase === "preparing") && (
        <div className="review-layout">
          <div className="card review-form">
            <h3 className="section-title">Step 2 — Review and confirm extracted details</h3>
            {ai?.disclaimer && <div className="alert alert-warning">{ai.disclaimer}</div>}
            {!ai && !reissue && (
              <div className="alert alert-warning">
                Details were not auto-extracted. Verify each value against the source PDF before registering.
              </div>
            )}

            <div className="form-grid">
              <div className="field">
                <label>{FIELD_LABELS.certificateType} *</label>
                <select value={fields.certificateType} onChange={(e) => setField("certificateType", e.target.value)}>
                  {(templates?.types || Object.keys(TYPE_LABELS)).map((t) => (
                    <option key={t} value={t}>{templates?.templates?.[t]?.label || TYPE_LABELS[t] || t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="holderName">{FIELD_LABELS.holderName} *</label>
                <input
                  id="holderName"
                  ref={holderNameRef}
                  type="text"
                  value={fields.holderName}
                  onChange={(e) => setField("holderName", e.target.value)}
                  placeholder="Full name of the certificate holder"
                  maxLength={200}
                />
                <FieldAi fieldKey="holderName" ai={ai} />
              </div>
              {Object.keys(EMPTY_FIELDS).filter((k) => !REQUIRED_FIELDS.has(k)).map((key) => (
                <div className="field" key={key}>
                  <label>{FIELD_LABELS[key]}</label>
                  <input
                    type={DATE_FIELDS.has(key) ? "date" : "text"}
                    value={fields[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    title={templates?.descriptions?.[key] || ""}
                  />
                  <FieldAi fieldKey={key} ai={ai} />
                </div>
              ))}
            </div>

            {extraKeys.length > 0 && (
              <>
                <h3 className="section-title">Type-specific details</h3>
                <div className="form-grid">
                  {extraKeys.map((key) => (
                    <div className="field" key={key}>
                      <label>{extraFieldLabel(key)}</label>
                      <input
                        type="text"
                        value={extraData[key] || ""}
                        onChange={(e) => setExtraData((d) => ({ ...d, [key]: e.target.value }))}
                        title={templates?.templates?.[fields.certificateType]?.extraFields?.[key] || ""}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}

            {!reviewValid && (
              <div className="alert alert-error">
                <a
                  href="#holderName"
                  onClick={(e) => {
                    e.preventDefault();
                    holderNameRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    holderNameRef.current?.focus();
                  }}
                  style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}
                >
                  Holder name
                </a>{" "}
                (min 2 characters) and certificate type are required.
              </div>
            )}

            <div className="issue-upload-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPhase("upload")} disabled={phase === "preparing"}>
                <ArrowLeft {...ICON} /> Back
              </button>
              <button type="button" className="btn btn-primary" onClick={runPrepare} disabled={!reviewValid || phase === "preparing"}>
                {phase === "preparing" ? "Encrypting + uploading to IPFS…" : (<>Approve &amp; prepare registration <ArrowRight {...ICON} /></>)}
              </button>
            </div>
          </div>

          <div className="review-side">
            <CertificatePreview file={file} title="Source document" height={640} />
          </div>
        </div>
      )}

      {/* ── STEP 3: WALLET / SIGN ── */}
      {phase === "wallet" && prepare && (
        <div className="card">
          <h3 className="section-title">Step 3 — Sign and register on Polygon Amoy</h3>
          <p className="muted">
            Certificate <span className="mono">{prepare.certificateId}</span> is prepared — encrypted document pinned
            to IPFS (<span className="mono">{prepare.issueArgs?.ipfsCID}</span>). {ttlText}
          </p>
          <WalletConnect expectedWallet={prepare.issuerWallet} onReady={onWalletReady} />
        </div>
      )}

      {/* ── SIGNING / CONFIRMING ── */}
      {(phase === "signing" || phase === "confirming") && prepare && (
        <div className="card">
          <h3 className="section-title">
            {phase === "signing" ? "Confirm the transaction in MetaMask" : "Verifying the on-chain receipt…"}
          </h3>
          <TransactionStatus
            phase={phase === "signing" ? "sign" : "confirm"}
            txHash={txHash}
            error={confirmError}
            onRetry={confirmError ? () => { setPhase("confirming"); runConfirm(prepare.certificateId, txHash); } : null}
            retryLabel="Retry confirm"
            note={phase === "signing"
              ? "MetaMask is showing the registerCertificate transaction. Review it and confirm — nothing is submitted until you approve."
              : "The backend independently verifies the receipt, event fields and issuer wallet against the prepared intent."}
          />
        </div>
      )}

      {/* ── FAILED ── */}
      {phase === "failed" && (
        <div className="card">
          <div className="alert alert-error"><AlertTriangle {...ICON} /> {confirmError || "Registration failed."}</div>
          {txHash && (
            <p className="muted">
              Transaction <span className="mono">{txHash}</span>{" "}
              <a href={explorerTxUrl(txHash)} target="_blank" rel="noreferrer">
                <ExternalLink size={13} strokeWidth={1.75} aria-hidden /> view on explorer
              </a>
            </p>
          )}
          <button type="button" className="btn btn-primary" onClick={resetFlow}>
            Register another certificate
          </button>
        </div>
      )}

      {/* ── STEP 4: RECEIPT ── */}
      {phase === "receipt" && certificate && (
        <div className="card receipt-card">
          <div className="status-banner status-valid">
            <ShieldCheck size={26} strokeWidth={1.75} aria-hidden />
            <div>
              <strong>Certificate registered and confirmed on Polygon Amoy</strong>
              <small className="mono">{certificate.certificateId}</small>
            </div>
          </div>
          <div className="receipt-grid">
            <QRDisplay
              certificateId={certificate.certificateId}
              qrCodeData={certificate.qrCodeData}
              verifyUrl={certificate.verifyUrl}
            />
            <div className="receipt-meta">
              <table className="details-table">
                <tbody>
                  <tr><td>Holder / Student</td><td>{certificate.holderName}</td></tr>
                  <tr><td>Certificate type</td><td>{TYPE_LABELS[certificate.certificateType] || certificate.certificateType}</td></tr>
                  <tr><td>Registration date</td><td>{formatDateTime(certificate.issuedAt)}</td></tr>
                  <tr><td>Block number</td><td className="mono">{certificate.blockNumber}</td></tr>
                  <tr>
                    <td>Transaction</td>
                    <td>
                      <a href={explorerTxUrl(certificate.txHash)} target="_blank" rel="noreferrer" className="mono">
                        {certificate.txHash?.slice(0, 18)}… <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
                      </a>
                    </td>
                  </tr>
                  {certificate.supersedesCertificateId && (
                    <tr><td>Supersedes</td><td className="mono">{certificate.supersedesCertificateId}</td></tr>
                  )}
                </tbody>
              </table>
              <div className="issue-upload-actions">
                <Link className="btn btn-primary" to={`/registered-certificates/${certificate.certificateId}`}>
                  View certificate <ArrowRight {...ICON} />
                </Link>
                <Link className="btn btn-secondary" to="/registered-certificates">
                  <FolderOpen {...ICON} /> View registered certificates
                </Link>
                <button type="button" className="btn btn-secondary" onClick={resetFlow}>
                  <FileUp {...ICON} /> Register another
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <Layout title={reissue ? `Reissue ${reissue.supersedesCertificateId}` : "Register Existing Certificate"}>
      {content}
    </Layout>
  );
}

const EXTRACT_STAGES = [
  { title: "Validating & preserving original PDF", detail: "Checking structure without modifying document bytes" },
  { title: "Scanning text layer & local OCR", detail: "Reading printed & scanned text with Tesseract on-server" },
  { title: "Structuring certificate fields", detail: "Identifying holder name, credential ID, dates & issuer" },
  { title: "Preparing review form", detail: "Organizing extracted values for your confirmation" },
];

/** Animated scanner + live multi-stage progress view during extraction. */
function ExtractingView({ fileName }) {
  const [step, setStep] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 700);
    const t2 = setTimeout(() => setStep(2), 2600);
    const t3 = setTimeout(() => setStep(3), 5800);
    const tick = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearInterval(tick);
    };
  }, []);

  const progressPct = [18, 46, 76, 92][step] ?? 92;

  return (
    <div className="card extract-phase">
      <div className="extract-grid">
        <div className="extract-scanner" aria-hidden="true">
          <div className="scan-corner tl" />
          <div className="scan-corner tr" />
          <div className="scan-corner bl" />
          <div className="scan-corner br" />
          <div className="scan-doc">
            <div className="scan-doc-badge" />
            <div className="scan-line-lg" />
            <div className="scan-line-md" />
            <div className="scan-divider" />
            <div className="scan-line-sm" />
            <div className="scan-line-md" />
            <div className="scan-line-sm short" />
            <div className="scan-seal" />
          </div>
          <div className="scan-beam" />
        </div>

        <div className="extract-details">
          <div className="extract-header-row">
            <div>
              <h3>Analysing certificate…</h3>
              {fileName && <div className="extract-filename mono">{fileName}</div>}
            </div>
            <span className="extract-timer mono">{elapsedSec}s</span>
          </div>

          <div className="extract-progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="extract-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>

          <ul className="extract-steps">
            {EXTRACT_STAGES.map((stage, idx) => {
              const state = idx < step ? "done" : idx === step ? "active" : "pending";
              return (
                <li key={stage.title} className={`extract-step ${state}`}>
                  <span className="extract-step-icon">
                    {state === "done" ? (
                      <CheckCircle2 size={17} strokeWidth={2} />
                    ) : state === "active" ? (
                      <Loader2 size={17} strokeWidth={2} className="spin" />
                    ) : (
                      <span className="extract-dot" />
                    )}
                  </span>
                  <div>
                    <strong>{stage.title}</strong>
                    <small>{stage.detail}</small>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="extract-privacy">
            <Lock size={13} strokeWidth={2} aria-hidden />
            <span>Document pixels never leave this server — only extracted text is structured.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Supporting fragment (tooltip) for extracted fields. */
function FieldAi({ fieldKey, ai }) {
  if (!ai) return null;
  const fragment = ai.evidence?.[fieldKey];
  if (!fragment) return null;
  return (
    <small className="field-ai" title={`Source text: "${fragment}"`}>
      <span className="confidence-evidence">"{fragment.slice(0, 60)}{fragment.length > 60 ? "…" : ""}"</span>
    </small>
  );
}
