import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Award, ShieldCheck, Ban, Clock, Building2, FileUp, ScanSearch, ArrowRight,
} from "lucide-react";
import Layout from "../components/Layout";
import { getDashboardStats, apiErrorMessage, sessionUser } from "../utils/api";
import {
  typeLabel, statusBadgeClass, STATUS_LABELS, formatDate, ROLE_LABELS,
} from "../utils/certificateHelpers";

const ICON = { size: 20, strokeWidth: 1.75, "aria-hidden": true };

/**
 * Institution-scoped overview (platform admins see platform-wide numbers).
 * Counts come from the backend /certificates/stats endpoint — single round-trip
 * cached via React Query for instant back-navigation.
 */
export default function DashboardPage() {
  const user = sessionUser() || {};
  const isPlatformAdmin = user.role === "platform_admin";
  const navigate = useNavigate();

  const { data, error: queryError } = useQuery({
    queryKey: ["dashboard-stats", user.id || user.email, user.role],
    queryFn: async () => (await getDashboardStats()).data,
  });

  const stats = data?.stats || null;
  const recent = data?.recent || [];
  const instCounts = data?.institutions || null;
  const error = queryError ? apiErrorMessage(queryError, "Could not load the dashboard") : "";

  const cards = stats ? [
    { label: isPlatformAdmin ? "Certificates (platform)" : "Certificates issued", value: stats.total, icon: <Award {...ICON} /> },
    { label: "Active", value: stats.active, icon: <ShieldCheck {...ICON} />, tone: "success" },
    { label: "Revoked", value: stats.revoked, icon: <Ban {...ICON} />, tone: "danger" },
    { label: "Expired", value: stats.expired, icon: <Clock {...ICON} />, tone: "warning" },
  ] : [];

  return (
    <Layout title="Dashboard">
      <div className="dashboard-headline">
        <h2>{user.institution?.name || (isPlatformAdmin ? "NOSIH platform" : "Welcome")}</h2>
        <p>
          {ROLE_LABELS[user.role] || user.role}
          {user.institution?.verificationStatus && user.institution.verificationStatus !== "approved" && (
            <span className="badge badge-warning">Institution {user.institution.verificationStatus}</span>
          )}
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!stats && !error && (
        <div className="stats-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="stat-card skel skel-stat" style={{ animationDelay: `${i * 0.07}s` }} />
          ))}
        </div>
      )}

      {stats && (
        <div className="stats-grid">
          {cards.map((c, i) => (
            <div
              key={c.label}
              className={`stat-card ${c.tone ? `stat-${c.tone}` : ""}`}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div className="stat-icon">{c.icon}</div>
              <div className="stat-value">{c.value}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {instCounts && (
        <div className="stats-grid stats-grid-secondary">
          <div className="stat-card">
            <div className="stat-icon"><Building2 {...ICON} /></div>
            <div className="stat-value">{instCounts.total}</div>
            <div className="stat-label">Institutions</div>
          </div>
          <div className="stat-card stat-success">
            <div className="stat-icon"><ShieldCheck {...ICON} /></div>
            <div className="stat-value">{instCounts.approved}</div>
            <div className="stat-label">Approved</div>
          </div>
          <div className="stat-card stat-warning">
            <div className="stat-icon"><Clock {...ICON} /></div>
            <div className="stat-value">{instCounts.pending}</div>
            <div className="stat-label">Pending review</div>
          </div>
        </div>
      )}

      <div className="action-grid">
        {["issuer", "institution_admin", "platform_admin"].includes(user.role) && (
          <Link to="/certificates" className="action-card">
            <span className="action-icon"><Award {...ICON} /></span>
            <strong>Certificate registry</strong>
            <small>Register, search, inspect, revoke, reissue</small>
          </Link>
        )}
        <Link to="/verify" className="action-card">
          <span className="action-icon"><ScanSearch {...ICON} /></span>
          <strong>Verify a certificate</strong>
          <small>Chain-authoritative public check</small>
        </Link>
      </div>

      <div className="card">
        <div className="section-title-row">
          <h3 className="section-title">Recent certificates</h3>
          <Link to="/registered-certificates" className="btn btn-sm btn-outline">
            View all <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="muted">No certificates yet. Issued certificates appear here with their live status.</p>
        ) : (
          <div className="table-wrapper">
            <table className="cert-table">
              <thead>
                <tr>
                  <th>Certificate ID</th><th>Holder</th><th>Type</th><th>Issued</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.certificateId} className="row-click" onClick={() => navigate(`/registered-certificates/${c.certificateId}`)}>
                    <td className="id-cell mono">{c.certificateId}</td>
                    <td>{c.holderName}</td>
                    <td>{typeLabel(c.certificateType)}</td>
                    <td>{formatDate(c.issueDate || c.createdAt)}</td>
                    <td><span className={statusBadgeClass(c.status)}>{STATUS_LABELS[c.status] || c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="dashboard-declaration">
        Every certificate is anchored on Polygon Amoy. Verification reads the chain first —
        the database alone can never make a certificate authentic.
      </p>
    </Layout>
  );
}