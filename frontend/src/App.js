import React, { Suspense, lazy, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CSSTransition, TransitionGroup } from "react-transition-group";
import ProtectedRoute from "./components/ProtectedRoute";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const IssuePage = lazy(() => import("./pages/IssuePage"));
const CertificateRegistryPage = lazy(() => import("./pages/CertificateRegistryPage"));
const RegisteredCertificatesPage = lazy(() => import("./pages/RegisteredCertificatesPage"));
const CertificateDetailsPage = lazy(() => import("./pages/CertificateDetailsPage"));
const InstitutionsPage = lazy(() => import("./pages/InstitutionsPage"));
const InstitutionDetailsPage = lazy(() => import("./pages/InstitutionDetailsPage"));
const VerifyLandingPage = lazy(() => import("./pages/VerifyLandingPage"));
const VerifyByIdPage = lazy(() => import("./pages/VerifyByIdPage"));
const VerifyByUploadPage = lazy(() => import("./pages/VerifyByUploadPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
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
  const location = useLocation();
  const nodeRef = useRef(null);

  return (
    <TransitionGroup component={null}>
      <CSSTransition
        key={location.pathname}
        nodeRef={nodeRef}
        classNames="page"
        timeout={260}
        unmountOnExit
      >
        <div ref={nodeRef} style={{ position: "relative", width: "100%" }}>
          <Suspense fallback={<PageFallback />}>
            <Routes location={location}>
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
        </div>
      </CSSTransition>
    </TransitionGroup>
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