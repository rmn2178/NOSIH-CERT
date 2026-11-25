import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Building2, BadgeCheck, Ban, RotateCcw } from "lucide-react";
import Layout from "../components/Layout";
import { getInstitution, apiErrorMessage, sessionUser } from "../utils/api";
import {
  INSTITUTION_STATUS_LABELS, INSTITUTION_STATUS_BADGE, formatDate,
} from "../utils/certificateHelpers";
import { WalletsCard, StaffCard, DecisionModal, SuspendModal } from "./InstitutionsPage";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true };

/**
 * Institution detail — platform admins see any institution and can
 * approve / suspend / reactivate; institution admins manage their own
 * wallets and staff. Access is enforced server-side (requireInstitutionMember).
 */
export default function InstitutionDetailsPage() {
  const { id } = useParams();
  const user = sessionUser() || {};
  const isPlatformAdmin = user.role === "platform_admin";

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decision, setDecision] = useState(null);
  const [suspendTarget, setSuspendTarget] = useState(null);

  const load = useCallback(() => {
    getInstitution(id)
      .then((res) => setData(res.data))
      .catch((err) => setError(apiErrorMessage(err, "Could not load the institution")));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  function done(message) {
    setDecision(null);
    setSuspendTarget(null);
    setNotice(message);
    load();
  }

  if (error) {
    return (
      <Layout title="Institution">
        <div className="alert alert-error">{error}</div>
        <Link to="/institutions" className="btn btn-secondary"><ArrowLeft {...ICON} /> Back to institutions</Link>
      </Layout>
    );
  }
  if (!data) return <Layout title="Institution"><p className="muted">Loading…</p></Layout>;

  const inst = data.institution;
  const isAdmin = user.role === "institution_admin" && user.institutionId === inst.id;
  const enabled = inst.verificationStatus === "approved";

  return (
    <Layout title={inst.name}>
      <div className="details-header">
        <Link to="/institutions" className="btn btn-sm btn-outline"><ArrowLeft {...ICON} /> All institutions</Link>
        <span className={INSTITUTION_STATUS_BADGE[inst.verificationStatus]}>{INSTITUTION_STATUS_LABELS[inst.verificationStatus]}</span>
        {isPlatformAdmin && (
          <div className="details-actions">
            {(inst.verificationStatus === "pending" || inst.verificationStatus === "rejected") && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDecision({ institution: inst, status: "approved" })}>
                <BadgeCheck {...ICON} /> Approve
              </button>
            )}
            {inst.verificationStatus === "pending" && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setDecision({ institution: inst, status: "rejected" })}>
                Reject
              </button>
            )}
            {inst.verificationStatus === "approved" && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => setSuspendTarget(inst)}>
                <Ban {...ICON} /> Suspend
              </button>
            )}
            {inst.verificationStatus === "suspended" && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDecision({ institution: inst, status: "approved", reactivate: true })}>
                <RotateCcw {...ICON} /> Reactivate
              </button>
            )}
          </div>
        )}
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {inst.statusReason && <p className="muted">Platform note: {inst.statusReason}</p>}
      {inst.verificationStatus === "suspended" && (
        <div className="alert alert-warning">
          This institution is suspended — new certificate registrations are blocked. Previously
          registered certificates remain intact and independently verifiable.
        </div>
      )}

      <div className="card">
        <div className="institution-line">
          <Building2 {...ICON} />
          <strong>{inst.name}</strong>
          <span className="mono">{inst.institutionId}</span>
        </div>
        <table className="details-table">
          <tbody>
            <tr><td>Institution ID</td><td className="mono">{inst.institutionId}</td></tr>
            {inst.legalName && <tr><td>Legal name</td><td>{inst.legalName}</td></tr>}
            {inst.registrationNumber && <tr><td>Registration number</td><td className="mono">{inst.registrationNumber}</td></tr>}
            {inst.website && <tr><td>Website</td><td><a href={inst.website} target="_blank" rel="noreferrer">{inst.website}</a></td></tr>}
            {inst.address && <tr><td>Address</td><td>{inst.address}</td></tr>}
            <tr><td>Registration date</td><td>{formatDate(inst.createdAt)}</td></tr>
            {inst.approvedAt && <tr><td>Approved</td><td>{formatDate(inst.approvedAt)}</td></tr>}
            <tr><td>Approval status</td><td><span className={INSTITUTION_STATUS_BADGE[inst.verificationStatus]}>{INSTITUTION_STATUS_LABELS[inst.verificationStatus]}</span></td></tr>
            <tr><td>Account status</td><td><span className={`badge ${enabled ? "badge-active" : "badge-neutral"}`}>{enabled ? "Enabled" : "Disabled"}</span></td></tr>
          </tbody>
        </table>
      </div>

      <WalletsCard institution={inst} wallets={data.wallets || []} isAdmin={isAdmin} onChanged={load} />
      <StaffCard institution={inst} users={data.users || []} isAdmin={isAdmin} currentUser={user} onChanged={load} />

      {decision && (
        <DecisionModal decision={decision} onClose={() => setDecision(null)} onDone={done} />
      )}
      {suspendTarget && (
        <SuspendModal institution={suspendTarget} onClose={() => setSuspendTarget(null)} onDone={done} />
      )}
    </Layout>
  );
}