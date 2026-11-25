import React, { useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, Award, Building2, ScanSearch, FolderOpen } from "lucide-react";
import logo from "../assets/nosih-logo.png";
import { sessionUser, getDashboardStats, listCertificates } from "../utils/api";
import { ROLE_LABELS } from "../utils/certificateHelpers";
import { prefetchRoute, queryClient } from "../App";

const NAV_ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true };

export default function Layout({ title, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = sessionUser() || {};

  function prefetchNav(to) {
    prefetchRoute(to);
    if (to === "/dashboard") {
      queryClient.prefetchQuery({
        queryKey: ["dashboard-stats", user.id || user.email, user.role],
        queryFn: async () => (await getDashboardStats()).data,
      });
    } else if (to === "/registered-certificates") {
      queryClient.prefetchQuery({
        queryKey: ["registered-certificates", { page: 1, limit: 25 }],
        queryFn: async () => (await listCertificates({ page: 1, limit: 25 })).data,
      });
    }
  }

  useEffect(() => {
    const id = setTimeout(() => {
      ["/dashboard", "/registered-certificates", "/certificates", "/certificates/register", "/institutions", "/verify"].forEach(prefetchRoute);
      if (user.id || user.email) {
        queryClient.prefetchQuery({
          queryKey: ["dashboard-stats", user.id || user.email, user.role],
          queryFn: async () => (await getDashboardStats()).data,
        });
        queryClient.prefetchQuery({
          queryKey: ["registered-certificates", { page: 1, limit: 25 }],
          queryFn: async () => (await listCertificates({ page: 1, limit: 25 })).data,
        });
      }
    }, 100);
    return () => clearTimeout(id);
  }, []);

  function logout() {
    queryClient.clear();
    try { localStorage.removeItem("nosih_query_cache_v1"); } catch {}
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    navigate("/login");
  }

  const navItems = [
    { to: "/dashboard", icon: <LayoutDashboard {...NAV_ICON} />, label: "Dashboard", exact: true },
    { to: "/registered-certificates", match: "/registered-certificates", icon: <FolderOpen {...NAV_ICON} />, label: "Registered Certificates" },
    { to: "/certificates", match: "/certificates", icon: <Award {...NAV_ICON} />, label: "Certificate Registry" },
    { to: "/institutions", match: "/institutions", icon: <Building2 {...NAV_ICON} />, label: "Institutions" },
    { to: "/verify", match: "/verify", icon: <ScanSearch {...NAV_ICON} />, label: "Verify Certificate" },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src={logo} alt="NOSIH logo" className="brand-logo" />
          <span>NOSIH</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.exact}
              onMouseEnter={() => prefetchNav(item.to)}
              onMouseDown={() => prefetchNav(item.to)}
              onFocus={() => prefetchNav(item.to)}
              className={({ isActive }) => {
                // Section items stay active on their sub-pages (detail, register, verify methods).
                const matchActive = item.match
                  ? location.pathname === item.match || location.pathname.startsWith(`${item.match}/`)
                  : isActive;
                return `nav-item ${matchActive ? "active" : ""}`;
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <small>{user.email}</small>
            <span className="role-badge">{ROLE_LABELS[user.role] || user.role}</span>
            {user.institution?.name && <small className="user-institution">{user.institution.name}</small>}
          </div>
          <button onClick={logout} className="logout-btn">Sign Out</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <h1>{title}</h1>
        </header>
        <div className="page-body">{children}</div>
      </main>
    </div>
  );
}