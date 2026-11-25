#!/usr/bin/env node
/**
 * Generates a demo certificate PDF for NOSIH prototype testing.
 * Output: scripts/demo-certificate.pdf
 *
 *   node --env-file=.env scripts/generate-demo-cert-pdf.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend", "package.json"));

// Use @napi-rs/canvas (already a backend dep) to draw the certificate
const { createCanvas } = require("@napi-rs/canvas");

const W = 1123, H = 794; // A4 landscape px at 96dpi
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

// Background
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

// Gold border
ctx.strokeStyle = "#b8960c";
ctx.lineWidth = 12;
ctx.strokeRect(20, 20, W - 40, H - 40);
ctx.strokeStyle = "#d4af37";
ctx.lineWidth = 3;
ctx.strokeRect(32, 32, W - 64, H - 64);

// Header band
ctx.fillStyle = "#1a3a5c";
ctx.fillRect(20, 20, W - 40, 110);

// Institution name
ctx.fillStyle = "#ffffff";
ctx.font = "bold 36px serif";
ctx.textAlign = "center";
ctx.fillText("MERIDIAN INSTITUTE OF TECHNOLOGY", W / 2, 75);

ctx.font = "18px serif";
ctx.fillText("Chennai, Tamil Nadu, India  |  Est. 2010  |  Reg: MER-IT-2026-001", W / 2, 108);

// Certificate title
ctx.fillStyle = "#1a3a5c";
ctx.font = "bold 48px serif";
ctx.fillText("CERTIFICATE OF COMPLETION", W / 2, 210);

// Decorative line
ctx.strokeStyle = "#d4af37";
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(100, 230);
ctx.lineTo(W - 100, 230);
ctx.stroke();

// Body text
ctx.fillStyle = "#333333";
ctx.font = "22px serif";
ctx.fillText("This is to certify that", W / 2, 290);

ctx.fillStyle = "#1a3a5c";
ctx.font = "bold 42px serif";
ctx.fillText("Priya Sharma", W / 2, 350);

ctx.fillStyle = "#333333";
ctx.font = "22px serif";
ctx.fillText("Student ID: STU-2023-0847", W / 2, 390);

ctx.fillText("has successfully completed the course of", W / 2, 435);

ctx.fillStyle = "#1a3a5c";
ctx.font = "bold 30px serif";
ctx.fillText("Bachelor of Computer Science and Engineering", W / 2, 480);

ctx.fillStyle = "#333333";
ctx.font = "22px serif";
ctx.fillText("with First Class Honours  |  CGPA: 8.9 / 10.0  |  Academic Year: 2020–2024", W / 2, 525);

// Dates
ctx.font = "20px serif";
ctx.textAlign = "left";
ctx.fillText("Issue Date:   15 November 2024", 120, 600);
ctx.fillText("Expiry Date:  15 November 2029", 120, 630);
ctx.fillText("Certificate No: CERT-MIT-2024-0847", 120, 660);

// Signatory
ctx.textAlign = "right";
ctx.fillText("Dr. Ananya Krishnan", W - 120, 600);
ctx.fillText("Registrar & Principal", W - 120, 630);
ctx.fillText("Meridian Institute of Technology", W - 120, 660);

// Footer
ctx.fillStyle = "#1a3a5c";
ctx.fillRect(20, H - 70, W - 40, 50);
ctx.fillStyle = "#ffffff";
ctx.font = "16px sans-serif";
ctx.textAlign = "center";
ctx.fillText(
  "Verify this certificate at: http://localhost:3000/verify  |  Blockchain: Polygon Amoy  |  NOSIH Certificate Authentication",
  W / 2, H - 40
);

// Save as PNG first (canvas doesn't do PDF natively, but NOSIH accepts PNG for extraction)
const outPath = path.join(root, "scripts", "demo-certificate.png");
const buf = canvas.toBuffer("image/png");
fs.writeFileSync(outPath, buf);
console.log(`✅ Demo certificate image saved: ${outPath}`);
console.log(`   Upload this file at http://localhost:3000/issue`);
console.log(`\n   Certificate details:`);
console.log(`     Holder  : Priya Sharma`);
console.log(`     Course  : Bachelor of Computer Science and Engineering`);
console.log(`     Grade   : First Class Honours, CGPA 8.9/10`);
console.log(`     Issued  : 15 November 2024`);
console.log(`     Expires : 15 November 2029`);
console.log(`     Inst.   : Meridian Institute of Technology`);
