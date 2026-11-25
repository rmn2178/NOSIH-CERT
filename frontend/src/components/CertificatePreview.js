import React, { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";

/**
 * Source-PDF preview. Works with a File (issue flow) or a Blob (decrypted
 * document from the API). Uses an object URL and always revokes it.
 */
export default function CertificatePreview({ file, title = "Certificate PDF", height = 520 }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file || !url) return null;

  return (
    <div className="pdf-preview">
      <div className="pdf-preview-bar">
        <span>{title}</span>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <a className="btn btn-sm btn-outline" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden /> Open in new tab
          </a>
          <a className="btn btn-sm btn-outline" href={url} download={file.name || "certificate.pdf"}>
            <Download size={14} strokeWidth={1.75} aria-hidden /> Download
          </a>
        </div>
      </div>
      <iframe
        src={url}
        title={title}
        width="100%"
        height={height}
        style={{ border: "none", display: "block", background: "#fff" }}
      />
    </div>
  );
}