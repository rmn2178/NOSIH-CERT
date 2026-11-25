import React from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ScanSearch, FileUp, ArrowRight, ArrowLeft } from "lucide-react";
import logo from "../assets/nosih-logo.png";
import "./styles.css";

const ICON = { size: 30, strokeWidth: 1.75, "aria-hidden": true };

/**
 * Verify Certificate landing — one entry point, two methods on separate pages.
 * QR codes open /verify?certificateId=… and are forwarded to the ID method
 * with the check already running.
 */
export default function VerifyLandingPage() {
  const [searchParams] = useSearchParams();
  const certificateId = searchParams.get("certificateId");
  if (certificateId) {
    return <Navigate to={`/verify/certificate-id?certificateId=${encodeURIComponent(certificateId)}`} replace />;
  }

  const signedIn = Boolean(sessionStorage.getItem("token"));

  return (
    <div className="verify-wrapper">
      <header className="verify-header">
        <img src={logo} alt="NOSIH logo" className="logo-img" />
        <h1>VERIFY YOUR CERTIFICATE</h1>
        <p>Choose your preferred method to verify the authenticity and integrity of your certificate.</p>
      </header>

      <div className="verify-method-grid">
        <Link to="/verify/certificate-id" className="verify-method-card">
          <span className="verify-method-icon"><ScanSearch {...ICON} /></span>
          <h2>Verify by Certificate ID</h2>
          <p>Enter your unique certificate identifier to retrieve and verify its blockchain registration.</p>
          <span className="verify-method-cta">Continue <ArrowRight size={16} strokeWidth={1.75} aria-hidden /></span>
        </Link>

        <Link to="/verify/upload" className="verify-method-card">
          <span className="verify-method-icon"><FileUp {...ICON} /></span>
          <h2>Verify by Certificate PDF</h2>
          <p>Upload your original certificate PDF to verify whether its document hash matches the registered blockchain record.</p>
          <span className="verify-method-cta">Continue <ArrowRight size={16} strokeWidth={1.75} aria-hidden /></span>
        </Link>
      </div>

      <footer className="verify-footer">
        {signedIn ? (
          <Link to="/dashboard"><ArrowLeft size={14} strokeWidth={1.75} aria-hidden /> Back to dashboard</Link>
        ) : (
          <Link to="/login">Institution sign in <ArrowRight size={14} strokeWidth={1.75} aria-hidden /></Link>
        )}
        <span>NOSIH · hashes on Polygon Amoy · documents encrypted on IPFS</span>
      </footer>
    </div>
  );
}