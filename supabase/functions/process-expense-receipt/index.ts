/// <reference types="https://deno.land/x/types/index.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

const RECEIPT_EXTRACTION_PROMPT = `You are extracting structured fields from a Hungarian fuel/expense receipt.

Return ONLY valid JSON matching this schema:
{
  "expense_type": "fuel"|"toll"|"parking"|"service"|"fluid"|"other"|null,
  "occurred_at": string|null,
  "station_name": string|null,
  "station_location": string|null,
  "odometer_km": number|null,
  "currency": string|null,
  "gross_amount": number|null,
  "net_amount": number|null,
  "vat_amount": number|null,
  "vat_rate": number|null,
  "invoice_number": string|null,
  "payment_method": string|null,
  "payment_card_last4": string|null,
  "fuel_type": string|null,
  "liters": number|null,
  "unit_price": number|null,
  "note": string|null
}

Rules:
- Use dot decimals.
- currency: always a 3-letter ISO 4217 code in uppercase (HUF, EUR, USD, …). Hungarian receipts: use HUF, not "Ft" or "Forint" as the currency string.
- Prefer the final amount paid (ÖSSZESEN / total) as gross_amount when multiple totals appear (e.g. official price adjustments).
- If multiple VAT rates exist, pick the main one and keep others out; put details in note.
- If you are unsure, set the field to null.`;

type AiProvider = "openai" | "gemini";

function resolveAiProviderSelection(params: {
  bodyHint: string;
  envDefault: string;
  hasOpenai: boolean;
  hasGemini: boolean;
}): AiProvider {
  const raw = (params.bodyHint || params.envDefault || "auto").toLowerCase();
  const mode = raw === "openai" || raw === "gemini" ? raw : "auto";

  if (mode === "openai") {
    if (!params.hasOpenai) {
      throw new Error("OPENAI_API_KEY hiányzik, de openai lett kérve.");
    }
    return "openai";
  }
  if (mode === "gemini") {
    if (!params.hasGemini) {
      throw new Error("GEMINI_API_KEY vagy GOOGLE_API_KEY hiányzik, de gemini lett kérve.");
    }
    return "gemini";
  }

  if (params.hasGemini && params.hasOpenai) return "gemini";
  if (params.hasGemini) return "gemini";
  if (params.hasOpenai) return "openai";
  throw new Error("Nincs beállított AI kulcs (OPENAI vagy GEMINI).");
}

type ExtractedExpense = {
  occurred_at?: string | null;
  station_name?: string | null;
  station_location?: string | null;
  odometer_km?: number | null;
  currency?: string | null;
  gross_amount?: number | null;
  net_amount?: number | null;
  vat_amount?: number | null;
  vat_rate?: number | null;
  invoice_number?: string | null;
  payment_method?: string | null;
  payment_card_last4?: string | null;
  fuel_type?: string | null;
  liters?: number | null;
  unit_price?: number | null;
  expense_type?: "fuel" | "toll" | "parking" | "service" | "fluid" | "other" | null;
  note?: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/** DB check: char_length(currency) between 3 and 5 — map "Ft", symbols, etc. to ISO-style codes. */
function normalizeCurrencyForExpenseDb(raw: unknown): string {
  const s0 = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s0) return "HUF";
  const u = s0.toUpperCase();

  if (/^(HUF|EUR|USD|GBP|CHF|RON|CZK|PLN|SEK|DKK)$/.test(u)) {
    return u.length <= 5 ? u : "HUF";
  }
  if (u === "FT" || u.includes("FORINT") || /^F[Tt]\.?$/.test(s0)) {
    return "HUF";
  }
  if (u === "EURO" || s0 === "€") return "EUR";
  if (u === "DOLLAR" || s0 === "$") return "USD";
  if (u === "LEI") return "RON";

  const compact = u.replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z0-9]{3,5}$/.test(compact)) {
    return compact.slice(0, 5);
  }

  return "HUF";
}

const EXPENSE_TYPES_DB = new Set(["fuel", "toll", "parking", "service", "fluid", "other"]);

function normalizeExpenseTypeForDb(raw: unknown): "fuel" | "toll" | "parking" | "service" | "fluid" | "other" {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (EXPENSE_TYPES_DB.has(t)) {
    return t as "fuel" | "toll" | "parking" | "service" | "fluid" | "other";
  }
  if (t === "maintenance" || t === "repair" || t === "car_wash") return "service";
  return "fuel";
}

/** Client hint: JSON body and/or `?ai_provider=` on the Edge request URL (belt-and-suspenders). */
function normalizeProviderHint(raw: unknown): "" | "openai" | "gemini" | "auto" {
  if (raw === null || raw === undefined) return "";
  const t = String(raw).toLowerCase().trim();
  return t === "openai" || t === "gemini" || t === "auto" ? t : "";
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Try to salvage JSON from a larger response
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

/** Binary → base64 without `fromCharCode(...bytes)` (stack overflow on large images). */
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

async function callOpenAiVisionExtract(params: { apiKey: string; mimeType: string; base64Data: string }) {
  const { apiKey, mimeType, base64Data } = params;
  const prompt = RECEIPT_EXTRACTION_PROMPT;

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
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${base64Data}`,
            },
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

async function callGeminiVisionExtract(params: { apiKey: string; model: string; mimeType: string; base64Data: string }) {
  const { apiKey, model, mimeType, base64Data } = params;
  const prompt = RECEIPT_EXTRACTION_PROMPT;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: base64Data,
            },
          },
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

function parseGeminiGenerateContentJson(json: unknown): string {
  const j = json as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const blockReason = j.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked: ${blockReason}`);
  }

  const candidate = j.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
    throw new Error(`Gemini finish: ${finish}`);
  }

  const partsOut = candidate?.content?.parts;
  let outText = "";
  if (Array.isArray(partsOut)) {
    outText = partsOut.map((p: { text?: string }) => p?.text || "").join("");
  }
  if (!outText) {
    throw new Error("Gemini returned empty text");
  }
  return outText;
}

/**
 * Resolve the signed-in user's auth UUID via GoTrue HTTP API.
 * `supabase.auth.getUser()` in Edge can fail with ES256 tokens; Auth server validates the JWT instead.
 */
async function resolveAuthUserId(supabaseUrl: string, anonKey: string, authHeader: string): Promise<string | null> {
  const trimmed = String(authHeader || "").trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("bearer ") || trimmed.length <= "bearer ".length) {
    return null;
  }

  const base = String(supabaseUrl).replace(/\/$/, "");
  const res = await fetch(`${base}/auth/v1/user`, {
    method: "GET",
    headers: {
      Authorization: trimmed,
      apikey: anonKey,
    },
  });

  if (!res.ok) {
    return null;
  }

  let json: { id?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    return null;
  }

  const id = json?.id;
  if (!id || typeof id !== "string") {
    return null;
  }

  return id;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const openAiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  const geminiKey = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY") || "").trim();
  // gemini-2.0-flash is not offered to new API keys (404); default to a current model.
  const geminiModel = (Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash").trim();
  const envProviderDefault = (Deno.env.get("EXPENSE_AI_PROVIDER") || "auto").toLowerCase();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }
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
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const authUserId = await resolveAuthUserId(supabaseUrl, anonKey, authHeader);
  if (!authUserId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

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
  const bodyHint =
    normalizeProviderHint(payload?.ai_provider ?? payload?.aiProvider) || qsHint;

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
    return jsonResponse(
      { error: "AI configuration error", detail: msg, ai_provider_requested: bodyHint || null },
      400,
    );
  }

  const receiptStoragePath = toStringOrNull(payload?.receipt_storage_path);
  const vehicleIdRaw = payload?.vehicle_id;
  const vehicleId = vehicleIdRaw === null || vehicleIdRaw === undefined ? null : Number(vehicleIdRaw);
  const requestedDriverIdRaw = payload?.driver_id;
  const requestedDriverId =
    requestedDriverIdRaw === null || requestedDriverIdRaw === undefined || String(requestedDriverIdRaw).trim() === ""
      ? null
      : Number(requestedDriverIdRaw);

  if (!receiptStoragePath || !vehicleId || Number.isNaN(vehicleId)) {
    return jsonResponse({ error: "receipt_storage_path and vehicle_id are required" }, 400);
  }

  const { data: vehicleRow, error: vehicleErr } = await supabaseAdmin
    .from("vehicles")
    .select("id,user_id,driver_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleErr || !vehicleRow?.id) {
    return jsonResponse({ error: "Vehicle not found" }, 404);
  }

  const tenantUserId = String(vehicleRow.user_id);

  // Resolve driver context:
  // - driver flow: auth_user_id is linked to a driver; require the vehicle assignment
  // - admin flow: auth user == tenant user_id and driver_id explicitly provided; allow AI for any driver of the tenant
  const { data: driverRow, error: driverErr } = await supabaseAdmin
    .from("drivers")
    .select("id,user_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (driverErr) {
    return jsonResponse({ error: "Driver lookup failed" }, 500);
  }

  let driverId: number | null = null;

  if (driverRow?.id) {
    driverId = Number(driverRow.id);
    if (Number(vehicleRow.driver_id) !== driverId) {
      return jsonResponse({ error: "Vehicle not assigned to this driver" }, 403);
    }
  } else {
    if (!tenantUserId || tenantUserId !== authUserId) {
      return jsonResponse({ error: "Unauthorized" }, 403);
    }
    if (!requestedDriverId || Number.isNaN(requestedDriverId)) {
      return jsonResponse({ error: "driver_id is required for admin AI processing" }, 400);
    }

    const { data: adminDriverRow, error: adminDriverErr } = await supabaseAdmin
      .from("drivers")
      .select("id,user_id")
      .eq("id", requestedDriverId)
      .maybeSingle();

    if (adminDriverErr) {
      return jsonResponse({ error: "Driver lookup failed" }, 500);
    }
    if (!adminDriverRow?.id || String(adminDriverRow.user_id || "") !== tenantUserId) {
      return jsonResponse({ error: "Driver not found" }, 404);
    }
    driverId = Number(adminDriverRow.id);
  }

  // Create job row
  const { data: jobInsert, error: jobInsertErr } = await supabaseAdmin
    .from("expense_ai_jobs")
    .insert({
      user_id: tenantUserId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      receipt_storage_path: receiptStoragePath,
      status: "processing",
    })
    .select("*")
    .limit(1);

  if (jobInsertErr) {
    return jsonResponse({ error: "Failed to create AI job", detail: jobInsertErr.message }, 500);
  }

  const job = jobInsert?.[0];
  const jobId = job?.id;

  try {
    const { data: fileData, error: dlErr } = await supabaseAdmin.storage
      .from("expense-receipts")
      .download(receiptStoragePath);

    if (dlErr || !fileData) {
      throw new Error(`Failed to download receipt: ${dlErr?.message || "no data"}`);
    }

    const contentType = fileData.type || "image/jpeg";
    const bytes = new Uint8Array(await fileData.arrayBuffer());
    const base64 = uint8ArrayToBase64(bytes);

    let extractedText: string;
    if (aiProvider === "gemini") {
      extractedText = await callGeminiVisionExtract({
        apiKey: geminiKey,
        model: geminiModel,
        mimeType: contentType,
        base64Data: base64,
      });
    } else {
      extractedText = await callOpenAiVisionExtract({
        apiKey: openAiKey,
        mimeType: contentType,
        base64Data: base64,
      });
    }

    const parsed = tryParseJson(extractedText);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("AI response is not valid JSON");
    }

    const raw = parsed as Record<string, unknown>;
    const extracted: ExtractedExpense = {
      expense_type: normalizeExpenseTypeForDb(raw.expense_type),
      occurred_at: toStringOrNull(raw.occurred_at),
      station_name: toStringOrNull(raw.station_name),
      station_location: toStringOrNull(raw.station_location),
      odometer_km: toNumberOrNull(raw.odometer_km),
      currency: normalizeCurrencyForExpenseDb(raw.currency),
      gross_amount: toNumberOrNull(raw.gross_amount),
      net_amount: toNumberOrNull(raw.net_amount),
      vat_amount: toNumberOrNull(raw.vat_amount),
      vat_rate: toNumberOrNull(raw.vat_rate),
      invoice_number: toStringOrNull(raw.invoice_number),
      payment_method: toStringOrNull(raw.payment_method),
      payment_card_last4: toStringOrNull(raw.payment_card_last4),
      fuel_type: toStringOrNull(raw.fuel_type),
      liters: toNumberOrNull(raw.liters),
      unit_price: toNumberOrNull(raw.unit_price),
      note: toStringOrNull(raw.note),
    };

    const occurredAt = extracted.occurred_at ? new Date(extracted.occurred_at).toISOString() : new Date().toISOString();
    const gross = extracted.gross_amount ?? 0;

    const confidence =
      extracted.gross_amount != null && extracted.liters != null ? 0.85 : extracted.gross_amount != null ? 0.65 : 0.45;

    const { data: entryInsert, error: entryErr } = await supabaseAdmin
      .from("expense_entries")
      .insert({
        user_id: tenantUserId,
        vehicle_id: vehicleId,
        driver_id: driverId,
        expense_type: extracted.expense_type,
        occurred_at: occurredAt,
        station_name: extracted.station_name,
        station_location: extracted.station_location,
        odometer_km: extracted.odometer_km == null ? null : Math.round(extracted.odometer_km),
        currency: extracted.currency || "HUF",
        gross_amount: Number(gross.toFixed(2)),
        net_amount: extracted.net_amount == null ? null : Number(extracted.net_amount.toFixed(2)),
        vat_amount: extracted.vat_amount == null ? null : Number(extracted.vat_amount.toFixed(2)),
        vat_rate: extracted.vat_rate,
        invoice_number: extracted.invoice_number,
        payment_method: extracted.payment_method,
        payment_card_last4: extracted.payment_card_last4,
        fuel_type: extracted.fuel_type,
        liters: extracted.liters == null ? null : Number(extracted.liters.toFixed(3)),
        unit_price: extracted.unit_price == null ? null : Number(extracted.unit_price.toFixed(3)),
        receipt_storage_path: receiptStoragePath,
        receipt_mime: contentType,
        receipt_original_filename: null,
        status: "draft_ai",
        ai_confidence: confidence,
        ai_raw_json: raw,
        created_by_auth_user_id: authUserId,
      })
      .select("*")
      .limit(1);

    if (entryErr) {
      throw new Error(`Failed to create draft entry: ${entryErr.message}`);
    }

    const entry = entryInsert?.[0];

    await supabaseAdmin
      .from("expense_ai_jobs")
      .update({ status: "succeeded", result_json: extracted })
      .eq("id", jobId);

    return jsonResponse({
      job_id: jobId,
      // Always return the created row so the client can open the draft even if a follow-up SELECT is blocked by RLS.
      entry_id: entry?.id != null ? String(entry.id) : null,
      entry: entry ?? null,
      extracted,
      ai_provider: aiProvider,
      ai_provider_requested: bodyHint || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin
      .from("expense_ai_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", jobId);
    return jsonResponse({
      error: "AI processing failed",
      detail: message,
      job_id: jobId,
      ai_provider_used: aiProvider,
      ai_provider_requested: bodyHint || null,
    }, 500);
  }
});

