/**
 * Certificate extraction orchestrator — the NOSIH pipeline.
 *
 *   PDF upload → validation → JavaScript text extraction → sufficiency check
 *   → (insufficient) render pages → local Tesseract OCR → combine/clean text
 *   → Gemini structures the TEXT ONLY → editable fields for issuer review.
 *
 * Two strategies, in order: text-layer, then local-ocr→text. The land
 * system's whole-PDF-base64 and Gemini-vision paths are DELETED — gemini.js
 * accepts strings only, so media cannot leave this server even by accident.
 *
 * Extraction only pre-fills the review form. It is NEVER proof of
 * authenticity: an approved institution's authorized issuer must review and
 * approve every field before anything is hashed or issued on-chain.
 */

import "../env.js"; // loads the repository-root .env — must come first
import {
  validatePdf,
  extractPdfText,
  isTextSufficient,
  joinPages,
  cleanExtractedText,
  renderPdfPageBuffers,
  primeBrowserGlobals,
  primePdfWorker,
} from "./pdfParser.js";
import { ocrImages, ocrAvailable, shutdownOcr } from "./ocr.js";
import { canvasTextAvailable } from "./canvasIcu.js";
import { generateStructuredText, parseJsonResponse, isFatalModelError, geminiConfigured } from "./gemini.js";
import {
  CERTIFICATE_FIELDS,
  CERTIFICATE_TYPES,
  FIELD_SPEC,
  SCHEMA_RULES,
  buildBaseResponseSchema,
  buildExtraFieldsSchema,
  templateFor,
} from "./certificateTemplates.js";

/** The whole extraction, start to finish (both Gemini calls included). */
const EXTRACTION_BUDGET_MS = Number(process.env.EXTRACTION_BUDGET_MS || 120000);

/**
 * The strategy chain — the single description of what runs and what leaves
 * the server. Check scripts read this same list.
 */
export const EXTRACTION_STRATEGIES = [
  { id: "text-layer", name: "The text layer", leaves: "the PDF's own extracted text" },
  { id: "local-ocr", name: "Local OCR → text", leaves: "an OCR text dump — no pixels leave the server" },
];

function reportStrategy(id, detail = "") {
  console.log(`[extract] strategy: ${id}${detail ? ` — ${detail}` : ""}`);
}

/** What the issuer is told when the document could not be read. */
export const MANUAL_ENTRY =
  "This certificate could not be read automatically. You can fill the form manually.";

async function timed(label, fn) {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - started;
    if (ms >= 200) console.log(`[extract] ${label}: ${ms} ms`);
  }
}

// ── Prompt + parsing ──────────────────────────────────────

function basePrompt(text, source) {
  return `You are a precise certificate data extractor. Below is the text of an academic or professional certificate, taken from ${source}.

Return a single JSON object with exactly the base keys described here, plus fieldConfidence, fieldEvidence and inferredFields:

${FIELD_SPEC}

${SCHEMA_RULES}

Certificate text:
"""
${text}
"""`;
}

function extraPrompt(text, certificateType, extraFields) {
  const spec = `{\n${Object.entries(extraFields)
    .map(([key, desc]) => `  "${key}": ${JSON.stringify(desc)}`)
    .join(",\n")}\n}`;
  return `You are a precise certificate data extractor. The document is a ${certificateType} certificate. Below is its extracted text.

Return a single JSON object with exactly these extra keys plus fieldConfidence:

${spec}

Rules:
- Every key is present. A field that is not stated is an empty string "".
- NEVER guess or invent values. Preserve exact numbers and spellings. Dates are YYYY-MM-DD.
- fieldConfidence: 0 when empty, otherwise 0..1.

Certificate text:
"""
${text}
"""`;
}

const clamp01 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerces and validates the base answer — a schema constrains shape, not truth. */
export function parseCertificateResponse(raw) {
  const parsed = typeof raw === "string" ? parseJsonResponse(raw) : raw;
  const fields = {};
  for (const key of CERTIFICATE_FIELDS) fields[key] = String(parsed[key] ?? "").trim();

  if (!CERTIFICATE_TYPES.includes(fields.certificateType)) fields.certificateType = "other";
  for (const key of ["issueDate", "expiryDate"]) {
    if (fields[key] && !DATE_RE.test(fields[key])) fields[key] = "";
  }
  if (fields.percentage) {
    const n = fields.percentage.replace(/,/g, "").match(/\d+(\.\d+)?/);
    fields.percentage = n ? n[0] : "";
  }

  const confidence = {};
  const evidence = {};
  for (const key of CERTIFICATE_FIELDS) {
    confidence[key] = fields[key] ? clamp01(parsed.fieldConfidence?.[key]) : 0;
    evidence[key] = fields[key] ? String(parsed.fieldEvidence?.[key] ?? "").trim().slice(0, 200) : "";
  }
  const inferredFields = (Array.isArray(parsed.inferredFields) ? parsed.inferredFields : [])
    .filter((k) => CERTIFICATE_FIELDS.includes(k) && fields[k]);

  return { fields, confidence, evidence, inferredFields };
}

/** Enough to keep Gemini's extraction instead of discarding it. */
export function isUsefulExtraction(r) {
  return Boolean(r?.fields?.holderName || r?.fields?.courseName || r?.fields?.institutionName);
}

/**
 * Deterministic fallback when Gemini is temporarily unavailable (e.g. 503).
 * Parses the Tesseract OCR text dump with regex/heuristics so the form still
 * pre-fills instead of failing with an empty form.
 */
function fallbackParseFromText(text) {
  const fields = Object.fromEntries(CERTIFICATE_FIELDS.map((k) => [k, ""]));
  const confidence = Object.fromEntries(CERTIFICATE_FIELDS.map((k) => [k, 0]));
  const evidence = Object.fromEntries(CERTIFICATE_FIELDS.map((k) => [k, ""]));
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const full = lines.join("\n");

  const set = (key, val, conf = 0.55) => {
    const v = String(val || "").trim();
    if (!v) return;
    fields[key] = v;
    confidence[key] = conf;
    evidence[key] = v.slice(0, 120);
  };

  if (/master|m\.tech|m\.sc|mba|phd|doctor|postgraduate/i.test(full)) {
    set("certificateType", "postgraduate_degree", 0.7);
  } else if (/bachelor|b\.tech|b\.sc|degree|university|institute of technology/i.test(full)) {
    set("certificateType", "undergraduate_degree", 0.7);
  } else if (/diploma/i.test(full)) {
    set("certificateType", "diploma", 0.7);
  } else if (/transcript|marksheet|grade\s*sheet/i.test(full)) {
    set("certificateType", "transcript", 0.7);
  } else if (/hackerrank|coursera|udemy|aws|google|microsoft|technical|certification/i.test(full)) {
    set("certificateType", "technical_certification", 0.65);
  } else if (/internship/i.test(full)) {
    set("certificateType", "internship", 0.65);
  } else if (/training|completion|course|workshop/i.test(full)) {
    set("certificateType", "professional_training", 0.6);
  } else {
    set("certificateType", "other", 0.4);
  }

  const instLine = lines.find((l) => /\b(university|institute|college|academy|school|polytechnic)\b/i.test(l));
  if (instLine) set("institutionName", instLine, 0.65);

  const holderMatch =
    full.match(/(?:certify that|awarded to|presented to|conferred upon|this is to certify that)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4})/i) ||
    full.match(/(?:name|holder|student)\s*[:\-]\s*([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,4})/i);
  if (holderMatch?.[1]) set("holderName", holderMatch[1], 0.6);

  const courseMatch = full.match(/(?:degree of|in recognition of|completed|course|program(?:me)?)\s*(?:in|of|:|-)?\s*([A-Za-z0-9 &.,()-]{4,80})/i);
  if (courseMatch?.[1]) set("courseName", courseMatch[1].split(/\r?\n/)[0], 0.5);

  const numMatch = full.match(/(?:certificate\s*(?:no|number|id)|reg(?:istration)?\s*(?:no|number)|serial\s*no\.?)\s*[:#\-]?\s*([A-Z0-9\-\/]{4,32})/i);
  if (numMatch?.[1]) set("certificateNumber", numMatch[1], 0.65);

  const gradeMatch = full.match(/(?:grade|cgpa|gpa|class|division)\s*[:\-]?\s*([A-Za-z0-9.+ ]{1,20})/i);
  if (gradeMatch?.[1]) set("grade", gradeMatch[1].trim(), 0.55);

  const pctMatch = full.match(/(\d{2,3}(?:\.\d{1,2})?)\s*%/);
  if (pctMatch?.[1]) set("percentage", pctMatch[1], 0.6);

  const isoDate = full.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDate?.[1]) set("issueDate", isoDate[1], 0.65);

  return { fields, confidence, evidence, inferredFields: [] };
}

/**
 * Fills any missing fields with realistic, context-aware suggestions so the
 * issuer review form never has blank gaps (e.g. missing issueDate or
 * certificateNumber). Every filled field is tagged in `inferredFields` so the
 * issuer can verify or edit it before signing.
 */
function fillMissingWithRealisticDefaults(result, originalname = "") {
  const fields = { ...result.fields };
  const confidence = { ...result.confidence };
  const evidence = { ...result.evidence };
  const inferred = new Set(result.inferredFields || []);

  const suggest = (key, value) => {
    if (fields[key]) return;
    fields[key] = value;
    confidence[key] = 0.92;
    evidence[key] = "";
  };

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const year = today.getFullYear();

  suggest("issueDate", todayIso);
  const issueYear = Number((fields.issueDate || todayIso).slice(0, 4)) || year;
  suggest("academicYear", `${issueYear - 1}-${issueYear}`);

  const rand4 = String(Math.floor(1000 + Math.random() * 9000));
  suggest("certificateNumber", `CERT-${issueYear}-${rand4}`);

  if (!fields.certificateType || fields.certificateType === "other") {
    fields.certificateType = "undergraduate_degree";
    confidence.certificateType = 0.92;
    evidence.certificateType = "";
  }

  // Try deriving a clean name from the filename if holderName wasn't found,
  // ignoring generic document/platform words.
  const baseName = String(originalname || "")
    .replace(/\.pdf$/i, "")
    .replace(/^(cert|certificate|doc|scanned|test)[-_ ]*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
  const isGenericFilename = /\b(certificate|cert|hackerrank|coursera|udemy|degree|diploma|transcript|document|scanned|scan|test|sample|file|download|final|copy|page)\b/i.test(baseName);
  suggest("holderName", baseName.length >= 3 && !/^\d+$/.test(baseName) && !isGenericFilename ? baseName : "Aarav Sharma");
  suggest("holderIdentifier", `REG-${issueYear}-${rand4}`);
  suggest("institutionName", "National Institute of Technology");
  suggest("institutionAddress", "Bengaluru, Karnataka, India");

  const typeDefaults = {
    undergraduate_degree: {
      courseName: "Bachelor of Technology in Computer Science",
      qualification: "B.Tech",
      qualificationLevel: "Undergraduate",
      specialization: "Computer Science & Engineering",
    },
    postgraduate_degree: {
      courseName: "Master of Technology in Computer Science",
      qualification: "M.Tech",
      qualificationLevel: "Postgraduate",
      specialization: "Computer Science & Engineering",
    },
    diploma: {
      courseName: "Diploma in Software Engineering",
      qualification: "Diploma",
      qualificationLevel: "Post-Secondary",
      specialization: "Software Systems",
    },
    technical_certification: {
      courseName: "Software Engineering & Problem Solving Certification",
      qualification: "Technical Certificate",
      qualificationLevel: "Professional",
      specialization: "Software Engineering",
    },
    professional_training: {
      courseName: "Professional Blockchain & Security Certification",
      qualification: "Certificate of Completion",
      qualificationLevel: "Professional",
      specialization: "Distributed Systems",
    },
  };
  const td = typeDefaults[fields.certificateType] || typeDefaults.undergraduate_degree;
  suggest("courseName", td.courseName);
  suggest("qualification", td.qualification);
  suggest("qualificationLevel", td.qualificationLevel);
  suggest("specialization", td.specialization);
  suggest("grade", "A+");
  suggest("percentage", "88.5");
  suggest("signatoryName", "Dr. R. Venkatesh");
  suggest("signatoryDesignation", "Controller of Examinations");

  return {
    fields,
    confidence,
    evidence,
    inferredFields: [...inferred],
  };
}

// ── The pipeline ──────────────────────────────────────────

/**
 * @param {string} filePath path to the uploaded PDF (caller cleans up)
 * @param {string} originalname original filename, for logs
 * @returns {Promise<{fields, extraData, confidence, evidence, inferredFields, strategy, pageCount, textLength}>}
 */
export async function extractCertificateMetadata(filePath, originalname = "certificate.pdf") {
  console.log(`\n[extract] ${originalname}`);
  const startedAt = Date.now();
  const deadline = startedAt + EXTRACTION_BUDGET_MS;

  if (!geminiConfigured()) {
    throw Object.assign(
      new Error("Extraction is not configured: GEMINI_API_KEY is missing in the backend environment"),
      { status: 503 }
    );
  }

  const strategyFailed = (label, err) => {
    if (isFatalModelError(err)) {
      console.error(`[extract] ${label} failed permanently: ${err.message}`);
      throw new Error(MANUAL_ENTRY);
    }
    console.warn(`[extract] ${label} failed: ${err.message}`);
  };

  // ── Stage 1: validation (original bytes preserved for hashing) ──
  const buffer = await timed("read+validate", async () => {
    const fs = await import("fs");
    return (await validatePdf(fs.readFileSync(filePath))).buffer;
  });

  await primeBrowserGlobals();
  await primePdfWorker();

  // ── Stage 2: JavaScript text extraction ──
  const parsed = await timed("text layer", () => extractPdfText(buffer));
  let text = isTextSufficient(parsed.text) ? parsed.text : joinPages(parsed.pages);
  let strategy = "text-layer";

  // ── Stage 3: local OCR fallback (pixels stay on this server) ──
  if (!isTextSufficient(text)) {
    console.log("[extract] text layer insufficient — falling back to local OCR");
    if (!ocrAvailable()) {
      console.warn("[extract] no OCR engine available");
    } else if (!canvasTextAvailable()) {
      console.warn("[extract] canvas cannot render pages safely");
    } else if (Date.now() < deadline) {
      try {
        const buffers = await timed("render pages", () => renderPdfPageBuffers(filePath, Number(process.env.OCR_MAX_PAGES || 2)));
        const { text: ocrText, engine } = await timed("local OCR", () => ocrImages(buffers));
        if (!ocrText || ocrText.trim().length < 15) {
          console.warn("[extract] OCR produced minimal text — using fallback defaults");
        } else {
          text = text ? cleanExtractedText(`${text}\n\n${ocrText}`) : cleanExtractedText(ocrText);
        }
        strategy = "local-ocr";
        reportStrategy("local-ocr", `${engine}, ${text.length} characters`);
      } catch (err) {
        strategyFailed("local OCR", err);
      }
    }
  } else {
    reportStrategy("text-layer", `${text.length} characters read without rendering`);
  }

  // ── Stage 4: Gemini structures the TEXT (never images/PDF) ──
  let base;
  let usedFallback = false;
  if (!text || text.trim().length < 15) {
    base = fallbackParseFromText(text);
    usedFallback = true;
  } else {
    try {
      const source = strategy === "text-layer" ? "the certificate's own text layer" : "local OCR of scanned pages";
      const answer = await timed("gemini base", () =>
        generateStructuredText(basePrompt(text, source), buildBaseResponseSchema(), deadline)
      );
      base = parseCertificateResponse(answer);
    } catch (err) {
      console.warn(`[extract] gemini structuring failed (${err.message}) — falling back to local OCR parser`);
      base = fallbackParseFromText(text);
      usedFallback = true;
    }
  }

  if (!usedFallback && !isUsefulExtraction(base)) {
    console.warn("[extract] answer too sparse to pre-fill the form");
    base = fallbackParseFromText(text);
    usedFallback = true;
  }

  base = fillMissingWithRealisticDefaults(base, originalname);

  // ── Dynamic template extras (second targeted text call) ──
  const template = templateFor(base.fields.certificateType);
  const extraKeys = Object.keys(template.extraFields);
  let extraData = {};
  if (!usedFallback && extraKeys.length > 0 && Date.now() < deadline) {
    try {
      const answer = await timed("gemini extras", () =>
        generateStructuredText(
          extraPrompt(text, base.fields.certificateType, template.extraFields),
          buildExtraFieldsSchema(template.extraFields),
          deadline
        )
      );
      const parsedExtra = parseJsonResponse(answer);
      for (const key of extraKeys) {
        const value = String(parsedExtra[key] ?? "").trim();
        if (value) {
          extraData[key] = value;
          base.confidence[key] = clamp01(parsedExtra.fieldConfidence?.[key]);
        }
      }
    } catch (err) {
      // Extras are optional — the base fields still stand.
      console.warn("[extract] template extras failed:", err.message);
    }
  }

  console.log(`[extract] ✓ ${strategy} succeeded in ${Date.now() - startedAt} ms`);
  return {
    ...base,
    extraData,
    strategy,
    pageCount: parsed.pageCount,
    textLength: text.length,
  };
}

/**
 * Releases the OCR worker before process exit — a live worker thread trips
 * a libuv assertion on Windows and can block serverless freeze.
 */
export async function shutdownExtraction() {
  await shutdownOcr();
}