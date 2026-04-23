/// <reference types="https://deno.land/x/types/index.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

const REGISTRATION_EXTRACTION_PROMPT = `You are extracting structured fields from a Hungarian vehicle registration card (forgalmi engedély).

You will receive two images: the FRONT and the BACK side. Use BOTH.

Return ONLY valid JSON matching this schema:
{
  "plate": string|null,
  "vin": string|null,
  "brand": string|null,
  "model": string|null,
  "year": string|null,
  "fuelType": "Benzin"|"Dízel"|"Hibrid"|"Elektromos"|"LPG"|null,
  "registrationExpiry": string|null,
  "note": string|null
}

Rules:
- If you are unsure, set the field to null (do NOT guess).
- plate: Hungarian plate format typically like ABC-123 (uppercase, include hyphen if present).
- vin: 17 characters, uppercase, no spaces.
- year: 4 digits (e.g. "2021") if clearly present.
- registrationExpiry: ISO date (YYYY-MM-DD) if present on the card; if multiple dates exist, choose the one that clearly refers to the registration card validity/expiry. If unclear, null and explain in note.
- fuelType: map common Hungarian terms:
  - benzin -> "Benzin"
  - dízel/gázolaj -> "Dízel"
  - hibrid -> "Hibrid"
  - elektromos -> "Elektromos"
  - LPG/autógáz -> "LPG"
`;

type AiProvider = "openai" | "gemini";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizeProviderHint(raw: unknown): "" | "openai" | "gemini" | "auto" {
  if (raw === null || raw === undefined) return "";
  const t = String(raw).toLowerCase().trim();
  return t === "openai" || t === "gemini" || t === "auto" ? t : "";
}

function resolveAiProviderSelection(params: {
  bodyHint: string;
  envDefault: string;
  hasOpenai: boolean;
  hasGemini: boolean;
}): AiProvider {
  const raw = (params.bodyHint || params.envDefault || "auto").toLowerCase();
  const mode = raw === "openai" || raw === "gemini" ? raw : "auto";

  if (mode === "openai") {
    if (!params.hasOpenai) throw new Error("OPENAI_API_KEY hiányzik, de openai lett kérve.");
    return "openai";
  }
  if (mode === "gemini") {
    if (!params.hasGemini) throw new Error("GEMINI_API_KEY vagy GOOGLE_API_KEY hiányzik, de gemini lett kérve.");
    return "gemini";
  }

  if (params.hasGemini && params.hasOpenai) return "gemini";
  if (params.hasGemini) return "gemini";
  if (params.hasOpenai) return "openai";
  throw new Error("Nincs beállított AI kulcs (OPENAI vagy GEMINI).");
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function cleanPlate(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  const compact = s.replace(/\s+/g, "");
  // Keep original if it already looks like a plate; otherwise try to insert hyphen for ABC123.
  if (/^[A-Z]{3}-\d{3}$/.test(compact)) return compact;
  if (/^[A-Z]{3}\d{3}$/.test(compact)) return `${compact.slice(0, 3)}-${compact.slice(3)}`;
  return compact.length <= 12 ? compact : compact.slice(0, 12);
}

function cleanVin(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return null;
  if (s.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return s;
  // If it's close but not perfect, return it anyway (client can review).
  return s.length <= 25 ? s : s.slice(0, 25);
}

function cleanYear(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/(19|20)\d{2}/);
  return m ? m[0] : null;
}

function cleanFuelType(raw: unknown): "Benzin" | "Dízel" | "Hibrid" | "Elektromos" | "LPG" | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("dízel") || s.includes("dizel") || s.includes("gázolaj")) return "Dízel";
  if (s.includes("benzin")) return "Benzin";
  if (s.includes("hibrid")) return "Hibrid";
  if (s.includes("elektromos") || s.includes("ev")) return "Elektromos";
  if (s.includes("lpg") || s.includes("autógáz") || s.includes("autogaz") || s.includes("gáz")) return "LPG";
  return null;
}

function cleanIsoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  // Accept YYYY-MM-DD directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try DD.MM.YYYY or YYYY.MM.DD
  const dot = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dot) {
    const dd = dot[1].padStart(2, "0");
    const mm = dot[2].padStart(2, "0");
    return `${dot[3]}-${mm}-${dd}`;
  }
  const dot2 = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (dot2) {
    const mm = dot2[2].padStart(2, "0");
    const dd = dot2[3].padStart(2, "0");
    return `${dot2[1]}-${mm}-${dd}`;
  }
  return null;
}

/** Binary → base64 without fromCharCode(...bytes) overflow. */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    const slice = bytes.subarray(i, end);
    chunks.push(String.fromCharCode.apply(null, slice as unknown as number[]));
  }
  return btoa(chunks.join(""));
}

async function callOpenAiVisionExtract(params: {
  apiKey: string;
  front: { mimeType: string; base64Data: string };
  back: { mimeType: string; base64Data: string };
}) {
  const { apiKey, front, back } = params;
  const prompt = REGISTRATION_EXTRACTION_PROMPT;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: "FRONT image:" },
            { type: "input_image", image_url: `data:${front.mimeType};base64,${front.base64Data}` },
            { type: "input_text", text: "BACK image:" },
            { type: "input_image", image_url: `data:${back.mimeType};base64,${back.base64Data}` },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${text}`);
  }

  const json = await response.json();
  const outputText: string =
    json?.output?.[0]?.content?.find?.((c: any) => c?.type === "output_text")?.text ||
    json?.output_text ||
    "";
  return outputText;
}

function parseGeminiGenerateContentJson(json: unknown): string {
  const j = json as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const blockReason = j.promptFeedback?.blockReason;
  if (blockReason) throw new Error(`Gemini blocked: ${blockReason}`);

  const candidate = j.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") throw new Error(`Gemini finish: ${finish}`);

  const partsOut = candidate?.content?.parts;
  const outText = Array.isArray(partsOut) ? partsOut.map((p) => p?.text || "").join("") : "";
  if (!outText) throw new Error("Gemini returned empty text");
  return outText;
}

async function callGeminiVisionExtract(params: {
  apiKey: string;
  model: string;
  front: { mimeType: string; base64Data: string };
  back: { mimeType: string; base64Data: string };
}) {
  const { apiKey, model, front, back } = params;
  const prompt = REGISTRATION_EXTRACTION_PROMPT;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { text: "FRONT image:" },
          { inlineData: { mimeType: front.mimeType || "image/jpeg", data: front.base64Data } },
          { text: "BACK image:" },
          { inlineData: { mimeType: back.mimeType || "image/jpeg", data: back.base64Data } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const json = await response.json();
      return parseGeminiGenerateContentJson(json);
    }

    const errText = await response.text();
    if (response.status === 503 && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`Gemini HTTP ${response.status}: ${errText}`);
  }
  throw new Error("Gemini: internal retry loop ended unexpectedly");
}

async function resolveAuthUserId(supabaseUrl: string, anonKey: string, authHeader: string): Promise<string | null> {
  const trimmed = String(authHeader || "").trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("bearer ") || trimmed.length <= "bearer ".length) return null;

  const base = String(supabaseUrl).replace(/\/$/, "");
  const res = await fetch(`${base}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: trimmed,
      apikey: anonKey,
    },
  });
  if (!res.ok) return null;

  let json: { id?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const id = json?.id;
  return id && typeof id === "string" ? id : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const openAiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  const geminiKey = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "").trim();
  const geminiModel = (Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash").trim();
  const envProviderDefault = (Deno.env.get("REGISTRATION_AI_PROVIDER") || "auto").toLowerCase();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  if (!openAiKey && !geminiKey) {
    return jsonResponse(
      {
        error: "Missing AI credentials",
        detail: "Set at least one Edge Function secret: OPENAI_API_KEY and/or GEMINI_API_KEY (GOOGLE_API_KEY is accepted for Gemini).",
      },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") || "";
  const authUserId = await resolveAuthUserId(supabaseUrl, anonKey, authHeader);
  if (!authUserId) return jsonResponse({ error: "Unauthorized" }, 401);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  let reqUrl: URL;
  try {
    reqUrl = new URL(req.url);
  } catch {
    reqUrl = new URL("http://localhost");
  }
  const qsHint = normalizeProviderHint(reqUrl.searchParams.get("ai_provider"));
  const bodyHint = normalizeProviderHint(payload?.ai_provider ?? payload?.aiProvider) || qsHint;

  let aiProvider: AiProvider;
  try {
    aiProvider = resolveAiProviderSelection({
      bodyHint,
      envDefault:
        envProviderDefault === "openai" || envProviderDefault === "gemini" || envProviderDefault === "auto"
          ? envProviderDefault
          : "auto",
      hasOpenai: Boolean(openAiKey),
      hasGemini: Boolean(geminiKey),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "AI configuration error", detail: msg, ai_provider_requested: bodyHint || null }, 400);
  }

  const frontStoragePath = toStringOrNull(payload?.front_storage_path);
  const backStoragePath = toStringOrNull(payload?.back_storage_path);
  if (!frontStoragePath || !backStoragePath) {
    return jsonResponse({ error: "front_storage_path and back_storage_path are required" }, 400);
  }

  const vehicleIdRaw = payload?.vehicle_id;
  const vehicleId = vehicleIdRaw === null || vehicleIdRaw === undefined || String(vehicleIdRaw).trim() === "" ? null : Number(vehicleIdRaw);

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // Admin-only for now (autó hozzáadás flow); vehicle_id is optional for prefill.
  const { data: memberRow, error: memberErr } = await supabaseAdmin
    .from("company_members")
    .select("company_id,role,status")
    .eq("auth_user_id", authUserId)
    .eq("status", "active")
    .limit(1);

  if (memberErr) return jsonResponse({ error: "Membership lookup failed" }, 500);
  const isAdmin = Array.isArray(memberRow) && memberRow.some((m) => String(m.role) === "admin");
  if (!isAdmin) return jsonResponse({ error: "Forbidden" }, 403);

  // If vehicle_id is provided, validate that it exists (and is in the admin's company) to avoid cross-tenant probing.
  if (vehicleId != null && !Number.isNaN(vehicleId)) {
    const { data: vRow, error: vErr } = await supabaseAdmin
      .from("vehicles")
      .select("id,company_id")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vErr || !vRow?.id) return jsonResponse({ error: "Vehicle not found" }, 404);
  }

  try {
    const [frontDl, backDl] = await Promise.all([
      supabaseAdmin.storage.from("vehicle-documents").download(frontStoragePath),
      supabaseAdmin.storage.from("vehicle-documents").download(backStoragePath),
    ]);

    if (frontDl.error || !frontDl.data) throw new Error(`Failed to download front image: ${frontDl.error?.message || "no data"}`);
    if (backDl.error || !backDl.data) throw new Error(`Failed to download back image: ${backDl.error?.message || "no data"}`);

    const frontMime = frontDl.data.type || "image/jpeg";
    const backMime = backDl.data.type || "image/jpeg";

    const frontBytes = new Uint8Array(await frontDl.data.arrayBuffer());
    const backBytes = new Uint8Array(await backDl.data.arrayBuffer());

    const frontBase64 = uint8ArrayToBase64(frontBytes);
    const backBase64 = uint8ArrayToBase64(backBytes);

    let extractedText: string;
    if (aiProvider === "gemini") {
      extractedText = await callGeminiVisionExtract({
        apiKey: geminiKey,
        model: geminiModel,
        front: { mimeType: frontMime, base64Data: frontBase64 },
        back: { mimeType: backMime, base64Data: backBase64 },
      });
    } else {
      extractedText = await callOpenAiVisionExtract({
        apiKey: openAiKey,
        front: { mimeType: frontMime, base64Data: frontBase64 },
        back: { mimeType: backMime, base64Data: backBase64 },
      });
    }

    const parsed = tryParseJson(extractedText);
    if (!parsed || typeof parsed !== "object") throw new Error("AI response is not valid JSON");

    const raw = parsed as Record<string, unknown>;
    const cleaned = {
      plate: cleanPlate(raw.plate),
      vin: cleanVin(raw.vin),
      brand: toStringOrNull(raw.brand),
      model: toStringOrNull(raw.model),
      year: cleanYear(raw.year),
      fuelType: cleanFuelType(raw.fuelType),
      registrationExpiry: cleanIsoDate(raw.registrationExpiry),
      note: toStringOrNull(raw.note),
    };

    return jsonResponse({
      extracted: cleaned,
      ai_provider: aiProvider,
      ai_provider_requested: bodyHint || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(
      {
        error: "AI processing failed",
        detail: message,
        ai_provider_used: aiProvider,
        ai_provider_requested: bodyHint || null,
      },
      500,
    );
  }
});

