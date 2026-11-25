import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, BadgeCheck, Clock, Ban, Plus, Wallet, Users, KeyRound, Search, Eye, RotateCcw,
} from "lucide-react";
import Layout from "../components/Layout";
import {
  listInstitutions, getInstitution, getMyInstitution, setInstitutionStatus,
  listIssuerWallets, addIssuerWallet, patchIssuerWallet, registerUser, patchInstitutionUser,
  apiErrorMessage, sessionUser,
} from "../utils/api";
import {
  INSTITUTION_STATUS_LABELS, INSTITUTION_STATUS_BADGE, ROLE_LABELS,
  formatDate, shortHex,
} from "../utils/certificateHelpers";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true };
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Platform admins: review/approve institutions.
 * Institution admins: manage issuer wallets and staff accounts.
 * Issuers/auditors: read-only view of their own institution.
 *
 * Wallet registration here is the DB association; the on-chain
 * authorizeIssuer transaction is a separate platform-admin deployment step
 * (scripts/addIssuer.js) whose receipt is recorded on the wallet.
 */
export default function InstitutionsPage() {
  const user = sessionUser() || {};
  if (user.role === "platform_admin") return <PlatformView />;
  return <InstitutionView user={user} />;
}

// ── Platform admin ───────────────────────────────────────

function PlatformView() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [walletsByInst, setWalletsByInst] = useState({});
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState(null); // {institution, status, reactivate?}
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listInstitutions(filter ? { status: filter } : undefined)
      .then(async (res) => {
        const insts = res.data.institutions || [];
        setRows(insts);
        const entries = await Promise.all(insts.map(async (i) => {
          try {
            const w = await listIssuerWallets(i.id);
            return [i.id, w.data.wallets || []];
          } catch {
            return [i.id, []];
          }
        }));
        setWalletsByInst(Object.fromEntries(entries));
      })
      .catch((err) => setError(apiErrorMessage(err, "Could not load institutions")))
      .finally(() => setLoading(false));
  }, [filter]);

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

  const term = search.trim().toLowerCase();
  const visible = term
    ? rows.filter((i) => [i.name, i.institutionId, i.registrationNumber].some((v) => String(v || "").toLowerCase().includes(term)))
    : rows;

  return (
    <Layout title="Institutions">
      <div className="toolbar">
        <div className="search-input">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            placeholder="Search institution name, ID or registration no.…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(INSTITUTION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="total-count">{visible.length} institution{visible.length === 1 ? "" : "s"}</span>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? <p className="muted">Loading…</p> : visible.length === 0 ? (
          <p className="muted">No institutions{filter ? ` with status “${filter}”` : ""}{term ? " match your search" : ""}. Applications arrive from the public sign-in page.</p>
        ) : (
          <div className="table-wrapper">
            <table className="cert-table">
              <thead>
                <tr>
                  <th>Institution</th><th>Institution ID</th><th>Wallet</th><th>Registration Date</th>
                  <th>Approval Status</th><th>Account Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((inst) => {
                  const wallets = walletsByInst[inst.id] || [];
                  const primary = wallets.find((w) => w.active) || wallets[0];
                  const enabled = inst.verificationStatus === "approved";
                  return (
                    <tr key={inst.id}>
                      <td>
                        <button type="button" className="link-btn" onClick={() => navigate(`/institutions/${inst.id}`)}>
                          <Building2 {...ICON} /> {inst.name}
                        </button>
                      </td>
                      <td className="mono">{inst.institutionId}</td>
                      <td className="mono" title={primary?.walletAddress || ""}>
                        {primary ? shortHex(primary.walletAddress, 10, 6) : "—"}
                        {wallets.length > 1 && <span className="badge badge-neutral">+{wallets.length - 1}</span>}
                      </td>
                      <td>{formatDate(inst.createdAt)}</td>
                      <td><span className={INSTITUTION_STATUS_BADGE[inst.verificationStatus]}>{INSTITUTION_STATUS_LABELS[inst.verificationStatus]}</span></td>
                      <td><span className={`badge ${enabled ? "badge-active" : "badge-neutral"}`}>{enabled ? "Enabled" : "Disabled"}</span></td>
                      <td className="action-btns">
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate(`/institutions/${inst.id}`)}>
                          <Eye {...ICON} /> View
                        </button>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {decision && (
        <DecisionModal
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={(message) => done(message)}
        />
      )}
      {suspendTarget && (
        <SuspendModal
          institution={suspendTarget}
          onClose={() => setSuspendTarget(null)}
          onDone={(message) => done(message)}
        />
      )}
    </Layout>
  );
}

export function DecisionModal({ decision, onClose, onDone }) {
  const { institution, status, reactivate } = decision;
  const needsReason = status !== "approved";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const title = reactivate ? "Reactivate" : INSTITUTION_STATUS_LABELS[status];

  async function submit(e) {
    e.preventDefault();
    if (needsReason && reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await setInstitutionStatus(institution.id, status, reason.trim());
      onDone(
        reactivate
          ? `${institution.name} (${institution.institutionId}) was reactivated. Certificate registration is enabled again.`
          : `${institution.name} (${institution.institutionId}) is now ${INSTITUTION_STATUS_LABELS[status].toLowerCase()}.`
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Status change failed"));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-header">
          <h2>{title} — {institution.name}</h2>
        </div>
        <p className="modal-warning">
          {reactivate
            ? "Reactivation restores this institution's ability to register new certificates. Previously registered certificates were never affected by the suspension."
            : status === "approved"
              ? "Approval lets this institution register issuer wallets and register certificates. Their public verification badge becomes “Verified institution”."
              : "Rejection blocks registration. The institution keeps its account and can be approved later."}
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Reason {needsReason ? "(required)" : "(optional)"}</label>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} disabled={busy} />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={`btn ${status === "approved" ? "btn-primary" : "btn-danger"}`} disabled={busy || (needsReason && reason.trim().length < 3)}>
              {busy ? "Saving…" : reactivate ? "Confirm Reactivation" : `Confirm ${status}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Suspension confirmation — the administrator must type the EXACT institution
 * ID before Confirm Suspension enables. Uses the existing authorized status
 * mechanism; suspension blocks new registrations only, never revokes or
 * removes previously registered certificates.
 */
export function SuspendModal({ institution, onClose, onDone }) {
  const [confirmId, setConfirmId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const idMatches = confirmId.trim() === institution.institutionId;
  const reasonValid = reason.trim().length >= 3;

  async function submit(e) {
    e.preventDefault();
    if (!idMatches || !reasonValid || busy) return;
    setBusy(true);
    setError("");
    try {
      await setInstitutionStatus(institution.id, "suspended", reason.trim());
      onDone(`${institution.name} (${institution.institutionId}) has been suspended. New certificate registrations are blocked; previously registered certificates remain intact and independently verifiable.`);
    } catch (err) {
      setError(apiErrorMessage(err, "Suspension failed"));
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Suspend institution">
      <div className="modal-card">
        <div className="modal-header">
          <h2><Ban {...ICON} /> Suspend institution</h2>
        </div>

        <table className="details-table suspend-summary">
          <tbody>
            <tr><td>Institution name</td><td><strong>{institution.name}</strong></td></tr>
            <tr><td>Institution ID</td><td className="mono">{institution.institutionId}</td></tr>
          </tbody>
        </table>

        <p className="modal-warning">
          Suspension takes effect immediately: this institution will not be able to register new
          certificates. Previously registered certificates are NOT revoked or altered — they stay
          on-chain and remain independently verifiable. You can reactivate the institution later.
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="suspend-confirm-id">Type the exact institution ID to confirm</label>
            <input
              id="suspend-confirm-id"
              className="mono"
              placeholder={institution.institutionId}
              value={confirmId}
              onChange={(e) => setConfirmId(e.target.value)}
              disabled={busy}
              autoComplete="off"
            />
            {confirmId && !idMatches && (
              <small className="suspend-mismatch">The entered ID does not match {institution.institutionId}.</small>
            )}
          </div>
          <div className="field">
            <label htmlFor="suspend-reason">Reason (required, kept private)</label>
            <textarea
              id="suspend-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
              disabled={busy}
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={!idMatches || !reasonValid || busy}>
              {busy ? "Suspending…" : "Confirm Suspension"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Own institution (admin manages, staff reads) ─────────

function InstitutionView({ user }) {
  const isAdmin = user.role === "institution_admin";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getMyInstitution()
      .then(async (res) => {
        const inst = res.data.institution;
        if (!inst) { setData({ institution: null }); return; }
        const detail = await getInstitution(inst.id);
        setData(detail.data);
      })
      .catch((err) => setError(apiErrorMessage(err, "Could not load your institution")));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <Layout title="Institutions"><div className="alert alert-error">{error}</div></Layout>;
  if (!data) return <Layout title="Institutions"><p className="muted">Loading…</p></Layout>;
  if (!data.institution) {
    return (
      <Layout title="Institutions">
        <div className="card"><p className="muted">Your account is not bound to an institution. Ask a platform admin to attach one.</p></div>
      </Layout>
    );
  }

  const inst = data.institution;
  return (
    <Layout title="Institutions">
      <div className="card">
        <div className="institution-line">
          <Building2 {...ICON} />
          <strong>{inst.name}</strong>
          <span className="mono">{inst.institutionId}</span>
          <span className={INSTITUTION_STATUS_BADGE[inst.verificationStatus]}>{INSTITUTION_STATUS_LABELS[inst.verificationStatus]}</span>
        </div>
        {inst.statusReason && <p className="muted">Platform note: {inst.statusReason}</p>}
        {inst.verificationStatus !== "approved" && (
          <div className="alert alert-warning">
            <Clock {...ICON} /> Registration is disabled until a platform admin approves this institution.
          </div>
        )}
        <table className="details-table">
          <tbody>
            {inst.registrationNumber && <tr><td>Registration number</td><td className="mono">{inst.registrationNumber}</td></tr>}
            {inst.website && <tr><td>Website</td><td><a href={inst.website} target="_blank" rel="noreferrer">{inst.website}</a></td></tr>}
            {inst.address && <tr><td>Address</td><td>{inst.address}</td></tr>}
            {inst.approvedAt && <tr><td>Approved</td><td>{formatDate(inst.approvedAt)}</td></tr>}
          </tbody>
        </table>
      </div>

      <WalletsCard institution={inst} wallets={data.wallets || []} isAdmin={isAdmin} onChanged={load} />
      <StaffCard institution={inst} users={data.users || []} isAdmin={isAdmin} currentUser={user} onChanged={load} />
    </Layout>
  );
}

export function WalletsCard({ institution, wallets, isAdmin, onChanged }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txDrafts, setTxDrafts] = useState({});

  async function add(e) {
    e.preventDefault();
    if (!WALLET_RE.test(address.trim())) { setError("Enter a valid 0x wallet address (40 hex characters)."); return; }
    setBusy(true); setError("");
    try {
      await addIssuerWallet(institution.id, address.trim());
      setAddress("");
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not register the wallet"));
    } finally { setBusy(false); }
  }

  async function patch(walletId, payload) {
    setError("");
    try {
      await patchIssuerWallet(institution.id, walletId, payload);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Wallet update failed"));
    }
  }

  return (
    <div className="card">
      <h3 className="section-title"><Wallet {...ICON} /> Issuer wallets</h3>
      <p className="muted">
        One wallet belongs to one institution. Registration here is the database association —
        the platform must also run the on-chain <span className="mono">authorizeIssuer</span> transaction
        before the wallet can sign registrations.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      {wallets.length === 0 ? <p className="muted">No wallets registered yet.</p> : (
        <div className="table-wrapper">
          <table className="cert-table">
            <thead><tr><th>Wallet</th><th>Status</th><th>On-chain authorization</th>{isAdmin && <th>Actions</th>}</tr></thead>
            <tbody>
              {wallets.map((w) => (
                <tr key={w.id}>
                  <td className="mono" title={w.walletAddress}>{shortHex(w.walletAddress, 16, 8)}</td>
                  <td><span className={`badge ${w.active ? "badge-active" : "badge-neutral"}`}>{w.active ? "active" : "inactive"}</span></td>
                  <td>
                    {isAdmin ? (
                      <div className="inline-edit">
                        <input
                          className="mono"
                          placeholder="0x… authorization tx hash"
                          value={txDrafts[w.id] ?? w.authorizationTxHash ?? ""}
                          onChange={(e) => setTxDrafts((d) => ({ ...d, [w.id]: e.target.value }))}
                        />
                        <button
                          type="button" className="btn btn-sm btn-outline"
                          onClick={() => patch(w.id, { authorizationTxHash: (txDrafts[w.id] ?? w.authorizationTxHash ?? "").trim() })}
                        >
                          <KeyRound size={13} strokeWidth={1.75} aria-hidden /> Save
                        </button>
                      </div>
                    ) : w.authorizationTxHash
                      ? <span className="badge badge-active">authorized</span>
                      : <span className="badge badge-warning">pending</span>}
                  </td>
                  {isAdmin && (
                    <td className="action-btns">
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => patch(w.id, { active: !w.active })}>
                        {w.active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && institution.verificationStatus === "approved" && (
        <form onSubmit={add} className="input-row wallet-add">
          <input
            className="mono" placeholder="0x… issuer wallet address"
            value={address} onChange={(e) => setAddress(e.target.value)} maxLength={42}
          />
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Plus {...ICON} /> Register wallet
          </button>
        </form>
      )}
    </div>
  );
}

export function StaffCard({ institution, users, isAdmin, currentUser, onChanged }) {
  const [form, setForm] = useState({ email: "", password: "", role: "issuer", walletAddress: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");

  async function create(e) {
    e.preventDefault();
    setBusy(true); setError(""); setCreated("");
    try {
      await registerUser({
        email: form.email,
        password: form.password,
        role: form.role,
        walletAddress: form.walletAddress || undefined,
      });
      setCreated(`Account created for ${form.email}. Share the password securely.`);
      setForm({ email: "", password: "", role: "issuer", walletAddress: "" });
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not create the account"));
    } finally { setBusy(false); }
  }

  async function toggle(u) {
    setError("");
    try {
      await patchInstitutionUser(institution.id, u.id, { active: !u.active });
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Update failed"));
    }
  }

  return (
    <div className="card">
      <h3 className="section-title"><Users {...ICON} /> Staff accounts</h3>
      {error && <div className="alert alert-error">{error}</div>}
      {created && <div className="alert alert-success">{created}</div>}
      <div className="table-wrapper">
        <table className="cert-table">
          <thead><tr><th>Email</th><th>Role</th><th>Wallet</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}{u.id === currentUser.id && " (you)"}</td>
                <td><span className="role-badge">{ROLE_LABELS[u.role] || u.role}</span></td>
                <td className="mono" title={u.walletAddress || ""}>{u.walletAddress ? shortHex(u.walletAddress, 10, 6) : "—"}</td>
                <td><span className={`badge ${u.active ? "badge-active" : "badge-revoked"}`}>{u.active ? "active" : "deactivated"}</span></td>
                {isAdmin && (
                  <td className="action-btns">
                    {u.id !== currentUser.id && (
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => toggle(u)}>
                        {u.active ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <form onSubmit={create} className="staff-create">
          <h4>Create an issuer or auditor account</h4>
          <div className="form-grid">
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={8} autoComplete="new-password" />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="issuer">Issuer</option>
                <option value="auditor">Auditor</option>
              </select>
            </div>
            <div className="field">
              <label>MetaMask wallet (issuers)</label>
              <input className="mono" placeholder="0x… (optional)" value={form.walletAddress} onChange={(e) => setForm((f) => ({ ...f, walletAddress: e.target.value }))} maxLength={42} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Plus {...ICON} /> {busy ? "Creating…" : "Create account"}
          </button>
        </form>
      )}
    </div>
  );
}