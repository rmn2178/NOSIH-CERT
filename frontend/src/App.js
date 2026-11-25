import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProtectedRoute from "./components/ProtectedRoute";

const loadLogin = () => import("./pages/LoginPage");
const loadDashboard = () => import("./pages/DashboardPage");
const loadIssue = () => import("./pages/IssuePage");
const loadCertRegistry = () => import("./pages/CertificateRegistryPage");
const loadRegisteredCerts = () => import("./pages/RegisteredCertificatesPage");
const loadCertDetails = () => import("./pages/CertificateDetailsPage");
const loadInstitutions = () => import("./pages/InstitutionsPage");
const loadInstDetails = () => import("./pages/InstitutionDetailsPage");
const loadVerifyLanding = () => import("./pages/VerifyLandingPage");
const loadVerifyById = () => import("./pages/VerifyByIdPage");
const loadVerifyByUpload = () => import("./pages/VerifyByUploadPage");

const LoginPage = lazy(loadLogin);
const DashboardPage = lazy(loadDashboard);
const IssuePage = lazy(loadIssue);
const CertificateRegistryPage = lazy(loadCertRegistry);
const RegisteredCertificatesPage = lazy(loadRegisteredCerts);
const CertificateDetailsPage = lazy(loadCertDetails);
const InstitutionsPage = lazy(loadInstitutions);
const InstitutionDetailsPage = lazy(loadInstDetails);
const VerifyLandingPage = lazy(loadVerifyLanding);
const VerifyByIdPage = lazy(loadVerifyById);
const VerifyByUploadPage = lazy(loadVerifyByUpload);

const ROUTE_LOADERS = {
  "/dashboard": loadDashboard,
  "/registered-certificates": loadRegisteredCerts,
  "/certificates": loadCertRegistry,
  "/certificates/register": loadIssue,
  "/institutions": loadInstitutions,
  "/verify": loadVerifyLanding,
};

export function prefetchRoute(path) {
  const loader = ROUTE_LOADERS[path];
  if (loader) loader();
}

const CACHE_STORAGE_KEY = "nosih_query_cache_v1";
const PERSISTED_PREFIXES = new Set(["dashboard-stats", "registered-certificates", "institutions-list"]);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Hydrate cached Supabase snapshots immediately on startup so pages render with 0ms delay,
// then silently revalidate in the background.
try {
  const raw = localStorage.getItem(CACHE_STORAGE_KEY);
  if (raw) {
    const entries = JSON.parse(raw);
    if (Array.isArray(entries)) {
      for (const { queryKey, data } of entries) {
        queryClient.setQueryData(queryKey, data, { updatedAt: 0 });
      }
    }
  }
} catch {
  /* ignore corrupt cache */
}

let persistTimer = null;
queryClient.getQueryCache().subscribe((event) => {
  if (event?.type !== "updated" || event?.action?.type !== "success") return;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const snapshot = queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => PERSISTED_PREFIXES.has(q.queryKey?.[0]) && q.state.data !== undefined)
        .slice(0, 10)
        .map((q) => ({ queryKey: q.queryKey, data: q.state.data }));
      localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* ignore quota errors */
    }
  }, 250);
});

function PageFallback() {
  return (
    <div className="page-body" style={{ padding: "28px 36px" }}>
      <div className="stats-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stat-card skel skel-stat" />
        ))}
      </div>
    </div>
  );
}

const REGISTER_ROLES = ["issuer", "institution_admin", "platform_admin"];

/** Legacy /tamper links keep their certificate id into the unified verify flow. */
function LegacyTamperRedirect() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get("certificateId");
  return <Navigate to={id ? `/verify/certificate-id?certificateId=${encodeURIComponent(id)}` : "/verify"} replace />;
}

/** Legacy certificate detail path → the Registered Certificates detail route. */
function LegacyCertificateRedirect() {
  const { certificateId } = useParams();
  return <Navigate to={`/registered-certificates/${certificateId}`} replace />;
}

function AnimatedRoutes() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public — verification never requires an account */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<VerifyLandingPage />} />
        <Route path="/verify/certificate-id" element={<VerifyByIdPage />} />
        <Route path="/verify/upload" element={<VerifyByUploadPage />} />
        <Route path="/tamper" element={<LegacyTamperRedirect />} />

        {/* Protected portal */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/registered-certificates" element={<ProtectedRoute><RegisteredCertificatesPage /></ProtectedRoute>} />
        <Route path="/registered-certificates/:certificateId" element={<ProtectedRoute><CertificateDetailsPage /></ProtectedRoute>} />
        <Route path="/certificates" element={<ProtectedRoute><CertificateRegistryPage /></ProtectedRoute>} />
        <Route path="/certificates/register" element={<ProtectedRoute roles={REGISTER_ROLES}><IssuePage /></ProtectedRoute>} />
        <Route path="/institutions" element={<ProtectedRoute><InstitutionsPage /></ProtectedRoute>} />
        <Route path="/institutions/:id" element={<ProtectedRoute><InstitutionDetailsPage /></ProtectedRoute>} />

        {/* Legacy paths */}
        <Route path="/issue" element={<ProtectedRoute roles={REGISTER_ROLES}><Navigate to="/certificates/register" replace /></ProtectedRoute>} />
        <Route path="/certificates/:certificateId" element={<ProtectedRoute><LegacyCertificateRedirect /></ProtectedRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AnimatedRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}