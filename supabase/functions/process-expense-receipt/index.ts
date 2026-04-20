/// <reference types="https://deno.land/x/types/index.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.2";

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

async function callOpenAiVisionExtract(params: { apiKey: string; mimeType: string; base64Data: string }) {
  const { apiKey, mimeType, base64Data } = params;
  const prompt = `You are extracting structured fields from a Hungarian fuel/expense receipt.\n\nReturn ONLY valid JSON matching this schema:\n{\n  \"expense_type\": \"fuel\"|\"toll\"|\"parking\"|\"service\"|\"fluid\"|\"other\"|null,\n  \"occurred_at\": string|null,  // ISO-8601 if possible (date/time), else null\n  \"station_name\": string|null,\n  \"station_location\": string|null,\n  \"odometer_km\": number|null,\n  \"currency\": string|null,  // e.g. HUF\n  \"gross_amount\": number|null,\n  \"net_amount\": number|null,\n  \"vat_amount\": number|null,\n  \"vat_rate\": number|null,\n  \"invoice_number\": string|null,\n  \"payment_method\": string|null,\n  \"payment_card_last4\": string|null,\n  \"fuel_type\": string|null,\n  \"liters\": number|null,\n  \"unit_price\": number|null,\n  \"note\": string|null\n}\n\nRules:\n- Use dot decimals.\n- If multiple VAT rates exist, pick the main one and keep others out; put details in note.\n- If you are unsure, set the field to null.\n`;

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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const openAiKey = Deno.env.get("OPENAI_API_KEY") || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }
  if (!openAiKey) {
    return jsonResponse({ error: "Missing OPENAI_API_KEY" }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";

  const supabaseAuthed = createClient(supabaseUrl, anonKey, {
    global: { headers: { authorization: authHeader } },
  });
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await supabaseAuthed.auth.getUser();
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const receiptStoragePath = toStringOrNull(payload?.receipt_storage_path);
  const vehicleIdRaw = payload?.vehicle_id;
  const vehicleId = vehicleIdRaw === null || vehicleIdRaw === undefined ? null : Number(vehicleIdRaw);

  if (!receiptStoragePath || !vehicleId || Number.isNaN(vehicleId)) {
    return jsonResponse({ error: "receipt_storage_path and vehicle_id are required" }, 400);
  }

  // Resolve driver by auth user id and validate vehicle assignment.
  const { data: driverRow, error: driverErr } = await supabaseAdmin
    .from("drivers")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();

  if (driverErr || !driverRow?.id) {
    return jsonResponse({ error: "Driver not found for this user" }, 403);
  }

  const driverId = Number(driverRow.id);

  const { data: vehicleRow, error: vehicleErr } = await supabaseAdmin
    .from("vehicles")
    .select("id,user_id,driver_id")
    .eq("id", vehicleId)
    .maybeSingle();

  if (vehicleErr || !vehicleRow?.id) {
    return jsonResponse({ error: "Vehicle not found" }, 404);
  }

  if (Number(vehicleRow.driver_id) !== driverId) {
    return jsonResponse({ error: "Vehicle not assigned to this driver" }, 403);
  }

  const tenantUserId = String(vehicleRow.user_id);

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
    const base64 = btoa(String.fromCharCode(...bytes));

    const extractedText = await callOpenAiVisionExtract({
      apiKey: openAiKey,
      mimeType: contentType,
      base64Data: base64,
    });

    const parsed = tryParseJson(extractedText);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("AI response is not valid JSON");
    }

    const raw = parsed as Record<string, unknown>;
    const extracted: ExtractedExpense = {
      expense_type: (raw.expense_type as any) || "fuel",
      occurred_at: toStringOrNull(raw.occurred_at),
      station_name: toStringOrNull(raw.station_name),
      station_location: toStringOrNull(raw.station_location),
      odometer_km: toNumberOrNull(raw.odometer_km),
      currency: toStringOrNull(raw.currency) || "HUF",
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
        expense_type: extracted.expense_type || "fuel",
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
        created_by_auth_user_id: userData.user.id,
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
      entry_id: entry?.id,
      extracted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin
      .from("expense_ai_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", jobId);
    return jsonResponse({ error: "AI processing failed", detail: message, job_id: jobId }, 500);
  }
});

