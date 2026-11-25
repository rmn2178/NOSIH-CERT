import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileUp, ArrowRight, ShieldCheck } from "lucide-react";
import Layout from "../components/Layout";
import { listCertificates, apiErrorMessage, sessionUser } from "../utils/api";
import { typeLabel, statusBadgeClass, STATUS_LABELS, formatDate } from "../utils/certificateHelpers";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true };

/**
 * Certificate Registry — the entry point for registering certificates that
 * institutions have ALREADY issued. NOSIH never creates or issues certificates;
 * the original institution-issued PDF is the certificate. The registration
 * workflow itself is the existing upload → review → prepare → sign → confirm
 * flow (IssuePage at /certificates/register).
 */
export default function CertificateRegistryPage() {
  const user = sessionUser() || {};
  const canRegister = ["issuer", "institution_admin", "platform_admin"].includes(user.role);
  const navigate = useNavigate();

  const [recent, setRecent] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    listCertificates({ limit: 8 })
      .then((res) => {
        if (!alive) return;
        setRecent(res.data.certificates || []);
        setTotal(res.data.total ?? 0);
      })
      .catch((err) => { if (alive) setError(apiErrorMessage(err, "Could not load the registration history")); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <Layout title="Certificate Registry">
      <div className="card registry-intro">
        <h3 className="section-title"><ShieldCheck {...ICON} /> Register an already-issued certificate</h3>
        <p>
          NOSIH does not create or issue certificates. Educational institutions have already issued
          certificates to students — the original institution-issued PDF is the certificate. NOSIH
          registers these existing certificates on the blockchain so their registration and integrity
          can be verified later.
        </p>
        <p className="muted">
          During registration the original PDF is hashed exactly as uploaded, encrypted and stored on
          IPFS, and only cryptographic hashes are anchored on Polygon Amoy by the issuer's own wallet.
        </p>
        {canRegister ? (
          <Link to="/certificates/register" className="btn btn-primary">
            <FileUp {...ICON} /> Register Existing Certificate
          </Link>
        ) : (
          <div className="alert alert-warning">
            Your role can view the registry but cannot register certificates. Registration requires an
            issuer or institution admin account.
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title-row">
          <h3 className="section-title">Registration history</h3>
          <Link to="/registered-certificates" className="btn btn-sm btn-outline">
            View all ({total}) <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="muted">No certificates registered yet. Successful blockchain registrations appear here and in Registered Certificates.</p>
        ) : (
          <div className="table-wrapper">
            <table className="cert-table">
              <thead>
                <tr>
                  <th>Certificate ID</th><th>Holder</th><th>Certificate Title</th><th>Registration Date</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr
                    key={c.certificateId}
                    className={`row-click ${c.status === "revoked" ? "row-revoked" : ""}`}
                    onClick={() => navigate(`/registered-certificates/${c.certificateId}`)}
                  >
                    <td className="id-cell mono">{c.certificateId}</td>
                    <td>{c.holderName}</td>
                    <td>{c.courseName || c.qualification || typeLabel(c.certificateType)}</td>
                    <td>{formatDate(c.createdAt)}</td>
                    <td><span className={statusBadgeClass(c.status)}>{STATUS_LABELS[c.status] || c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}