import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import IssuePage from "./pages/IssuePage";
import CertificatesPage from "./pages/CertificatesPage";
import CertificateDetailsPage from "./pages/CertificateDetailsPage";
import InstitutionsPage from "./pages/InstitutionsPage";
import VerifyPage from "./pages/VerifyPage";
import TamperPage from "./pages/TamperPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public — verification never requires an account */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/tamper" element={<TamperPage />} />

        {/* Protected portal */}
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route
          path="/issue"
          element={<ProtectedRoute roles={["issuer", "institution_admin"]}><IssuePage /></ProtectedRoute>}
        />
        <Route path="/certificates" element={<ProtectedRoute><CertificatesPage /></ProtectedRoute>} />
        <Route path="/certificates/:certificateId" element={<ProtectedRoute><CertificateDetailsPage /></ProtectedRoute>} />
        <Route path="/institutions" element={<ProtectedRoute><InstitutionsPage /></ProtectedRoute>} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}