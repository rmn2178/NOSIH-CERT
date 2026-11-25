import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Search, ChevronLeft, ChevronRight, Eye, ExternalLink, Ban, Info } from "lucide-react";
import Layout from "../components/Layout";
import RevokeModal from "../components/RevokeModal";
import { listCertificates, listInstitutions, apiErrorMessage, sessionUser } from "../utils/api";
import { explorerTxUrl } from "../services/contract";
import {
  typeLabel, statusBadgeClass, STATUS_LABELS, formatDate, shortHex, canRevoke,
} from "../utils/certificateHelpers";

const PAGE_SIZE = 25;
const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true };

/** The award title as recorded at registration — never invented. */
function certificateTitle(c) {
  return c.courseName || c.qualification || typeLabel(c.certificateType);
}

/**
 * Registered Certificates — records already confirmed on the blockchain.
 * Viewing, searching and inspecting only; registration lives in the
 * Certificate Registry page.
 */
export default function RegisteredCertificatesPage() {
  const user = sessionUser() || {};
  const isPlatformAdmin = user.role === "platform_admin";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [registeredFrom, setRegisteredFrom] = useState("");
  const [registeredTo, setRegisteredTo] = useState("");
  const [notice, setNotice] = useState("");
  const [revokeTarget, setRevokeTarget] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]);

  const { data: instData } = useQuery({
    queryKey: ["institutions-list"],
    queryFn: async () => (await listInstitutions()).data.institutions || [],
    enabled: isPlatformAdmin,
  });
  const institutions = instData || [];

  const params = { page, limit: PAGE_SIZE };
  if (debouncedQ) params.q = debouncedQ;
  if (status) params.status = status;
  if (isPlatformAdmin && institutionId) params.institutionId = institutionId;
  if (registeredFrom) params.registeredFrom = registeredFrom;
  if (registeredTo) params.registeredTo = registeredTo;

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ["registered-certificates", params],
    queryFn: async () => (await listCertificates(params)).data,
    placeholderData: keepPreviousData,
  });

  const rows = data?.certificates || [];
  const total = data?.total ?? 0;
  const error = queryError ? apiErrorMessage(queryError, "Could not load registered certificates") : "";

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function onRevoked(certificateId) {
    setRevokeTarget(null);
    setNotice(`${certificateId} was revoked on-chain. The record stays registered and verifiable with status Revoked.`);
    queryClient.invalidateQueries({ queryKey: ["registered-certificates"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
  }

  return (
    <Layout title="Registered Certificates">
      <p className="page-intro">
        Certificates that have been successfully registered on the blockchain. Search, inspect and
        manage the existing records — new registrations happen in the Certificate Registry.
      </p>

      <div className="toolbar">
        <div className="search-input">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            placeholder="Search by Certificate ID or holder name…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isPlatformAdmin && (
          <select value={institutionId} onChange={(e) => { setInstitutionId(e.target.value); setPage(1); }} aria-label="Filter by institution">
            <option value="">All institutions</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.institutionId}>{i.name}</option>
            ))}
          </select>
        )}
        <label className="date-filter">
          <small>Registered from</small>
          <input type="date" value={registeredFrom} onChange={(e) => { setRegisteredFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="date-filter">
          <small>Registered to</small>
          <input type="date" value={registeredTo} onChange={(e) => { setRegisteredTo(e.target.value); setPage(1); }} />
        </label>
        <span className="total-count">{total} registered certificate{total === 1 ? "" : "s"}</span>
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">No registered certificates match. Certificates appear here immediately after chain confirmation.</p>
        ) : (
          <div className="table-wrapper">
            <table className="cert-table registered-table">
              <thead>
                <tr>
                  <th>Certificate ID</th>
                  <th>Certificate Holder</th>
                  <th>Institution</th>
                  <th>Certificate Title</th>
                  <th>Issue Date</th>
                  <th>Registration Date</th>
                  <th>Document Hash</th>
                  <th>Transaction Hash</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.certificateId} className={c.status === "revoked" ? "row-revoked" : ""}>
                    <td className="id-cell mono">{c.certificateId}</td>
                    <td>{c.holderName}</td>
                    <td>{c.institution?.name || "—"}</td>
                    <td>{certificateTitle(c)}</td>
                    <td>{formatDate(c.issueDate)}</td>
                    <td>{formatDate(c.createdAt)}</td>
                    <td className="mono" title={c.documentHash}>{shortHex(c.documentHash, 10, 6)}</td>
                    <td className="mono">
                      <a
                        href={explorerTxUrl(c.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        title={c.txHash}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {shortHex(c.txHash, 10, 6)}
                      </a>
                    </td>
                    <td><span className={statusBadgeClass(c.status)}>{STATUS_LABELS[c.status] || c.status}</span></td>
                    <td className="action-btns">
                      <button
                        type="button" className="btn btn-sm btn-outline" title="View details"
                        onClick={() => navigate(`/registered-certificates/${c.certificateId}`)}
                      >
                        <Eye {...ICON} /> View
                      </button>
                      <button
                        type="button" className="btn btn-sm btn-outline" title="View registration information"
                        onClick={() => navigate(`/registered-certificates/${c.certificateId}#blockchain-proof`)}
                      >
                        <Info {...ICON} /> Info
                      </button>
                      <a
                        className="btn btn-sm btn-outline" title="Inspect blockchain transaction"
                        href={explorerTxUrl(c.txHash)} target="_blank" rel="noreferrer"
                      >
                        <ExternalLink {...ICON} /> Tx
                      </a>
                      {canRevoke(user, c) && (
                        <button type="button" className="btn btn-sm btn-danger" title="Revoke certificate" onClick={() => setRevokeTarget(c)}>
                          <Ban {...ICON} /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="pagination">
            <button type="button" className="btn btn-sm btn-outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={14} strokeWidth={1.75} aria-hidden /> Previous
            </button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="btn btn-sm btn-outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight size={14} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {revokeTarget && (
        <RevokeModal
          certificate={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onRevoked={() => onRevoked(revokeTarget.certificateId)}
        />
      )}
    </Layout>
  );
}