import React, { useState } from "react";
import { Download, Copy, Check, Printer } from "lucide-react";
import { certificateQrUrl, downloadCertificateQr } from "../utils/api";
import { copyText } from "../utils/certificateHelpers";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true };

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Certificate QR — encodes the PUBLIC verify URL, so a phone camera opens
 * the verification page directly. Prefers the stored data URI; falls back
 * to the public PNG endpoint.
 */
export default function QRDisplay({ certificateId, qrCodeData, verifyUrl, compact }) {
  const [copied, setCopied] = useState(false);
  const src = qrCodeData || certificateQrUrl(certificateId);
  const link = verifyUrl || `${window.location.origin}/verify?certificateId=${certificateId}`;

  async function copyLink() {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function printPass() {
    const win = window.open("", "_blank", "width=520,height=640");
    if (!win) return;
    const safeId = escapeHtml(certificateId);
    const safeLink = escapeHtml(link);
    const safeSrc = escapeHtml(src);
    win.document.write(`<!doctype html><html><head><title>Verification Pass - ${safeId}</title>
      <style>
        body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f6f7f9; color: #1e2126; }
        .pass { background: #fff; border: 1px solid #dee0e4; border-radius: 14px; padding: 32px; text-align: center; max-width: 380px; box-shadow: 0 8px 24px rgba(0,0,0,0.06); }
        h1 { font-size: 18px; margin: 0 0 6px; }
        .sub { font-size: 13px; color: #6b7079; margin: 0 0 20px; }
        img { width: 220px; height: 220px; border: 1px solid #e2e4e8; border-radius: 10px; padding: 8px; background: #fff; }
        .id { font-family: monospace; font-size: 14px; font-weight: 700; margin: 16px 0 6px; word-break: break-all; }
        .url { font-size: 11px; color: #6b7079; word-break: break-all; }
        @media print { body { background: #fff; } .pass { box-shadow: none; } }
      </style></head><body>
      <div class="pass">
        <h1>NOSIH Certificate Verification Pass</h1>
        <p class="sub">Scan this QR code with any camera to verify authenticity on Polygon Amoy.</p>
        <img src="${safeSrc}" alt="QR Code" onload="window.print()" />
        <div class="id">${safeId}</div>
        <div class="url">${safeLink}</div>
      </div></body></html>`);
    win.document.close();
  }

  return (
    <div className={`qr-container ${compact ? "qr-compact" : ""}`}>
      <img src={src} alt={`Verification QR for ${certificateId}`} className="qr-image" />
      <div className="qr-meta">
        <span className="mono qr-id">{certificateId}</span>
        <small>Scan to verify — opens the public verification page.</small>
        <div className="qr-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => downloadCertificateQr(certificateId)}>
            <Download {...ICON} /> Download QR
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={printPass}>
            <Printer {...ICON} /> Print Verification Pass
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={copyLink}>
            {copied ? <Check {...ICON} /> : <Copy {...ICON} />} {copied ? "Copied" : "Copy verify link"}
          </button>
        </div>
      </div>
    </div>
  );
}