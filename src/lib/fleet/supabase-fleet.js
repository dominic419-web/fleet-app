import { createDefaultVehicleDocs, todayIso } from "@/lib/fleet-utils";
import {
  compareHistoryEntriesDesc,
  mergeVehicleHistoryWithBaseline,
  normalizeServiceHistoryItem,
} from "./service-history";
import { formatCurrencyHu } from "./formatters-hu";

export function serializeSupabaseError(error) {
  if (!error) return "Ismeretlen hiba";
  if (typeof error === "string") return error;

  const parts = [error.message, error.details, error.hint, error.code]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error));
  } catch {
    return "Nem sikerült kiolvasni a hiba részleteit";
  }
}

/** Supabase Storage returns this when the bucket was never created in the project. */
export function isSupabaseStorageBucketNotFoundError(error) {
  return serializeSupabaseError(error).toLowerCase().includes("bucket not found");
}

export function expenseReceiptBucketMissingUserHint(bucketId) {
  const id = String(bucketId || "expense-receipts").trim() || "expense-receipts";
  return `Hiányzik a Supabase Storage „${id}” bucketje. Hozd létre (Storage → New bucket → név: ${id}, Private), majd futtasd a tárolási policy SQL-t (supabase-expense-log.sql), ha még nem futott.`;
}

/** Network / DNS / browser blocked the request before the Edge Function could run. */
export function isSupabaseFunctionsFetchError(error) {
  if (!error) return false;
  if (error.name === "FunctionsFetchError") return true;
  return serializeSupabaseError(error).includes("Failed to send a request to the Edge Function");
}

export function serializeFunctionsInvokeError(error) {
  if (!error) return "";
  const base = serializeSupabaseError(error);
  const ctx = error.context;
  const ctxMsg = ctx && typeof ctx.message === "string" ? ctx.message.trim() : "";
  return ctxMsg ? `${base} (${ctxMsg})` : base;
}

export function edgeFunctionUnreachableUserHint(functionName) {
  const fn = String(functionName || "process-expense-receipt").trim() || "process-expense-receipt";
  return `A(z) „${fn}” Edge Function felé nem ment ki a kérés (hálózat / tiltás / rossz Supabase URL). Telepítsd a függvényt (Dashboard → Edge Functions, vagy: supabase functions deploy ${fn}), ellenőrizd az internetet és a .env NEXT_PUBLIC_SUPABASE_URL értékét.`;
}

/** Response body from a failed `functions.invoke` when status was non-2xx. */
export async function parseFunctionsHttpErrorBody(error) {
  if (!error || error.name !== "FunctionsHttpError") return null;
  const res = error.context;
  if (!res || typeof res.json !== "function") return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Pull human-readable fragments from nested Edge / OpenAI / proxy JSON. */
function flattenExpenseAiErrorMessages(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) return [];
  if (typeof value === "string") {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) {
    return value.flatMap((v) => flattenExpenseAiErrorMessages(v, depth + 1));
  }
  if (typeof value === "object") {
    const keys = ["detail", "message", "msg", "description", "hint", "reason", "error"];
    const acc = [];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        acc.push(...flattenExpenseAiErrorMessages(value[k], depth + 1));
      }
    }
    return acc;
  }
  return [];
}

export function mapProcessExpenseReceiptErrorBody(body) {
  if (!body || typeof body !== "object") {
    return "Az AI szolgáltatás hibát jelzett. Próbáld újra, vagy nézd meg az Edge Function naplót.";
  }

  const parts = flattenExpenseAiErrorMessages(body);
  const hay = parts.join(" ").toLowerCase();

  if (hay.includes("driver not found")) {
    return "Ehhez a bejelentkezéshez nincs sofőr rekord társítva (drivers.auth_user_id). Az admin felületen kösd össze a sofőrt ezzel a fiókkal.";
  }
  if (hay.includes("vehicle not assigned")) {
    return "Ez a jármű nincs hozzárendelve ehhez a sofőrhöz.";
  }
  if (hay.includes("vehicle not found")) {
    return "A kiválasztott jármű nem található.";
  }
  if (hay.includes("unauthorized")) {
    return "A művelethez be kell jelentkezned.";
  }
  if (hay.includes("receipt_storage_path and vehicle_id are required")) {
    return "Hiányzó adat a kérésben.";
  }
  if (hay.includes("missing ai credentials") || hay.includes("missing openai_api_key")) {
    return "Az Edge Function környezetben hiányzik legalább egy AI kulcs: OPENAI_API_KEY és/vagy GEMINI_API_KEY (GOOGLE_API_KEY is elfogadott) — Supabase → Edge Functions → Secrets.";
  }
  if (hay.includes("ai configuration error")) {
    const d = typeof body.detail === "string" ? body.detail : "";
    return d ? `AI beállítás: ${d}` : "Az AI szolgáltató választása nem sikerült (hiányzó kulcs vagy érvénytelen mód).";
  }
  if (hay.includes("missing supabase environment")) {
    return "Az Edge Function környezetben hiányzik Supabase kulcs (SUPABASE_URL / SERVICE_ROLE / ANON a felhőben általában automatikus; lokálisan állítsd be).";
  }
  if (hay.includes("failed to create ai job")) {
    return parts.find((p) => p.toLowerCase().includes("failed to create")) || "Nem sikerült AI feladatot létrehozni (adatbázis / RLS).";
  }
  if (hay.includes("expense_entries_currency_check")) {
    return "A bizonylatról kiolvasott pénznem nem felelt meg az adatbázis szabályának (3–5 karakteres kód, pl. HUF, EUR). Az AI választ a szerver most normalizálja — futtasd újra: supabase functions deploy process-expense-receipt, majd próbáld újra a kitöltést.";
  }
  if (hay.includes("expense_entries_type_check")) {
    return "A kiolvasott költségtípus nem volt engedélyezett érték. Próbáld újra az AI kitöltést, vagy vedd fel az admintal a típus bővítését.";
  }
  // Gemini hibák gyakran { error: "AI processing failed", detail: "Gemini HTTP 429: …" } alatt jönnek — ezeket az általános ág előtt kell felismerni.
  if (hay.includes("gemini http")) {
    if (
      hay.includes("gemini http 429") ||
      (hay.includes("429") && (hay.includes("exceeded your current quota") || hay.includes("quota")))
    ) {
      return "A Google Gemini elutasította a kérést (HTTP 429): a kulcshoz tartozó kvóta vagy percenkénti / napi limit betelt, vagy a projektben nincs megfelelő számlázás / szint. Ellenőrizd a limitet és a használatot: https://ai.google.dev/gemini-api/docs/rate-limits — a GEMINI_API_KEY mögötti Google Cloud / AI Studio projektben állítsd be a billinget vagy várj a limit újranyitására.";
    }
    if (
      hay.includes("gemini http 404") ||
      (hay.includes("404") && (hay.includes("no longer available") || hay.includes("not_found")))
    ) {
      return "A Google Gemini azt jelzi, hogy a kért modell (pl. gemini-2.0-flash) már nem elérhető új API-kulcsokhoz (HTTP 404). Állítsd a Supabase Edge Function secretben a GEMINI_MODEL értékét újabb modellre (pl. gemini-2.5-flash), majd futtasd: supabase functions deploy process-expense-receipt. Modelllista: https://ai.google.dev/gemini-api/docs/models";
    }
    if (
      hay.includes("gemini http 503") ||
      (hay.includes("503") && (hay.includes("unavailable") || hay.includes("high demand")))
    ) {
      return "A Google Gemini szervere átmenetileg túlterhelt (HTTP 503). Ez általában csak néhány percig tart — várj egy kicsit, majd próbáld újra az AI kitöltést. A szerver automatikusan újrapróbálja a hívást; ha továbbra is hibázik, válaszd az OpenAI módot (ha van hozzá kulcs), vagy próbáld később.";
    }
    if (hay.includes("resource_exhausted") || hay.includes("resource exhausted")) {
      return "A Google Gemini erőforrás-korlát miatt utasította el a kérést. Várj egy kicsit, vagy nézd meg a kvótát a Google Cloud konzolon.";
    }
  }
  if (hay.includes("ai processing failed")) {
    const d = typeof body.detail === "string" ? body.detail : parts.find((p) => p.length > 20) || "";
    return d ? `AI hiba: ${d.length > 300 ? `${d.slice(0, 300)}…` : d}` : "AI feldolgozás közben hiba történt.";
  }
  if (
    (hay.includes("insufficient_quota") || hay.includes("exceeded your current quota")) &&
    !hay.includes("gemini http")
  ) {
    const requested = typeof body.ai_provider_requested === "string" ? body.ai_provider_requested.toLowerCase().trim() : "";
    const used = typeof body.ai_provider_used === "string" ? body.ai_provider_used.toLowerCase().trim() : "";
    const openaiLine =
      "Az OpenAI fiókban nincs elég keret (kvóta / billing). Tölts fel kreditet vagy állítsd be a fizetést: https://platform.openai.com/account/billing";
    if (requested === "gemini" && used === "openai") {
      return `${openaiLine} — A kérésed szerint a Gemini lett kiválasztva, de a szerver mégis OpenAI-t hívott. Állítsd be a GEMINI_API_KEY (vagy GOOGLE_API_KEY) Supabase Edge Function secretben, majd futtasd: supabase functions deploy process-expense-receipt, és frissítsd az oldalt (Ctrl+F5).`;
    }
    return openaiLine;
  }
  if (hay.includes("rate_limit") || (hay.includes("openai http 429") && !hay.includes("insufficient_quota"))) {
    return "Az OpenAI átmenetileg túlterhelt vagy túl sok a kérés (429). Várj egy percet, majd próbáld újra.";
  }
  if (hay.includes("resource_exhausted") || hay.includes("resource exhausted")) {
    return "A Google Gemini kvóta / erőforrás korlát miatt elutasította a kérést. Várj egy kicsit, vagy ellenőrizd a kvótát a Google AI Studio / Cloud konzolon.";
  }
  if (hay.includes("gemini blocked")) {
    return "A Gemini biztonsági szűrője letiltotta a bizonylat feldolgozását. Próbálj másik képet, vagy válaszd az OpenAI módot.";
  }
  if (hay.includes("gemini http")) {
    return parts.join(" — ").slice(0, 400);
  }
  if (hay.includes("openai http")) {
    return parts.join(" — ").slice(0, 400);
  }
  if (hay.includes("could not reach supabase")) {
    const d = typeof body.detail === "string" ? body.detail : parts[0] || "";
    return d
      ? `A szerver nem érte el a Supabase Edge Functiont: ${d.length > 180 ? `${d.slice(0, 180)}…` : d}`
      : "A szerver nem érte el a Supabase Edge Functiont. Ellenőrizd a hoszting .env értékeit és az internetet.";
  }
  if (hay.includes("missing next_public_supabase")) {
    return "A szerveren hiányzik a NEXT_PUBLIC_SUPABASE_URL vagy a NEXT_PUBLIC_SUPABASE_ANON_KEY (Vercel/hosting env + újra deploy).";
  }
  if (hay.includes("es256") || hay.includes("unsupported jwt algorithm")) {
    return "ES256 JWT: az Edge Function átjáró nem fogadja el a tokent. A repóban lévő supabase/config.toml már kikapcsolja a gateway JWT ellenőrzést ehhez a függvényhez — futtasd újra: supabase functions deploy process-expense-receipt";
  }

  const merged = parts.filter(Boolean).join(" — ");
  if (merged) return merged.length > 380 ? `${merged.slice(0, 380)}…` : merged;

  try {
    const j = JSON.stringify(body);
    if (j && j !== "{}" && j !== "null") return j.length > 320 ? `${j.slice(0, 320)}…` : j;
  } catch {
    /* ignore */
  }
  return "Az AI szolgáltatás visszautasította a kérést.";
}

/** Use when HTTP status is not OK and body may be non-JSON or wrapper-shaped. */
export function formatProcessExpenseReceiptHttpFailure(status, body, rawText) {
  const fromMap = mapProcessExpenseReceiptErrorBody(body);
  const generic = "Az AI szolgáltatás visszautasította a kérést.";
  if (fromMap && fromMap !== generic) return fromMap;

  const raw = typeof rawText === "string" ? rawText.trim() : "";
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const inner = mapProcessExpenseReceiptErrorBody(parsed);
        if (inner && inner !== generic) return inner;
      }
    } catch {
      /* not JSON */
    }
    const snippet = raw.replace(/\s+/g, " ").slice(0, 360);
    if (snippet) return snippet.length >= 360 ? `${snippet}…` : snippet;
  }

  return fromMap || `AI feldolgozás HTTP ${status}`;
}

export async function processExpenseReceiptInvokeFailureMessage(error) {
  if (error?.name === "FunctionsHttpError") {
    const body = await parseFunctionsHttpErrorBody(error);
    return mapProcessExpenseReceiptErrorBody(body);
  }
  return serializeSupabaseError(error);
}

export function buildVehicleDbPayload(formState, resolvedDriver, userId) {
  const status =
    formState?.status === "active" || formState?.status === "service" || formState?.status === "inactive"
      ? formState.status
      : "active";
  return {
    user_id: userId,
    brand: String(formState?.brand || "").trim() || null,
    model: String(formState?.model || "").trim() || null,
    name: formState.name.trim(),
    plate: formState.plate.toUpperCase().trim(),
    currentKm: Number(formState.currentKm),
    initial_km: Number(formState.currentKm),
    lastServiceKm: Number(formState.lastServiceKm),
    driver: resolvedDriver || "",
    note: formState.note || "",
    year: formState.year || null,
    vin: (formState.vin || "").toUpperCase(),
    fuelType: formState.fuelType || "Benzin",
    insuranceExpiry: formState.insuranceExpiry || null,
    inspectionExpiry: formState.inspectionExpiry || null,
    oilChangeIntervalKm:
      formState.oilChangeIntervalKm === "" ? null : Number(formState.oilChangeIntervalKm),
    timingBeltIntervalKm:
      formState.timingBeltIntervalKm === "" ? null : Number(formState.timingBeltIntervalKm),
    archived: false,
    status,
    image_path: null,
  };
}

export function mapDriverFromRow(row) {
  return {
    id: row.id,
    user_id: row.user_id ?? null,
    auth_user_id: row.auth_user_id ?? null,
    name: row.name || "",
    phone: row.phone || "",
    email: row.email || "",
    notes: row.notes || "",
    is_active: row.is_active !== false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapSupabaseVehicleRow(row) {
  return {
    id: row.id,
    user_id: row.user_id ?? row.userId ?? null,
    brand: row.brand || "",
    model: row.model || "",
    name:
      row.name ||
      [row.brand, row.model].filter(Boolean).join(" ") ||
      row.plate ||
      `Jármű ${row.id}`,
    plate: row.plate || "",
    currentKm: Number(row.currentKm ?? row.current_km ?? row.mileage ?? 0),
    initialKm:
      row.initial_km !== undefined && row.initial_km !== null && String(row.initial_km).trim() !== ""
        ? Number(row.initial_km)
        : row.initialKm !== undefined && row.initialKm !== null && String(row.initialKm).trim() !== ""
          ? Number(row.initialKm)
          : null,
    createdAt: row.created_at || row.createdAt || null,
    lastServiceKm: Number(row.lastServiceKm ?? row.last_service_km ?? row.mileage ?? 0),
    driver: row.driver || row.owner || "",
    driver_id: row.driver_id ?? row.driverId ?? null,
    note: row.note || "",
    year: row.year ? String(row.year) : "",
    vin: row.vin || "",
    fuelType: row.fuelType || row.fuel_type || "Benzin",
    insuranceExpiry: row.insuranceExpiry || row.insurance_expiry || "",
    inspectionExpiry: row.inspectionExpiry || row.inspection_expiry || "",
    oilChangeIntervalKm:
      row.oilChangeIntervalKm === null || row.oilChangeIntervalKm === undefined
        ? row.oil_change_interval_km === null || row.oil_change_interval_km === undefined
          ? ""
          : Number(row.oil_change_interval_km)
        : Number(row.oilChangeIntervalKm),
    timingBeltIntervalKm:
      row.timingBeltIntervalKm === null || row.timingBeltIntervalKm === undefined
        ? row.timing_belt_interval_km === null || row.timing_belt_interval_km === undefined
          ? ""
          : Number(row.timing_belt_interval_km)
        : Number(row.timingBeltIntervalKm),
    archived: Boolean(row.archived),
    status: row.status || "active",
    imagePath: row.image_path || row.imagePath || "",
    serviceHistory: [],
  };
}

export function mapSupabaseServiceRow(row) {
  return normalizeServiceHistoryItem({
    id: row.id != null ? String(row.id) : `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: row.entry_date || row.date || todayIso(),
    type: "service-record",
    title: row.service_type || row.title || "Szerviz",
    detail: [
      row.provider ? `Partner: ${row.provider}` : null,
      Number(row.cost || 0) > 0 ? `Költség: ${formatCurrencyHu(Number(row.cost || 0))}` : null,
      row.note ? `Megjegyzés: ${row.note}` : null,
    ]
      .filter(Boolean)
      .join(" • "),
    km:
      row.km === null || row.km === undefined || Number.isNaN(Number(row.km))
        ? null
        : Number(row.km),
    serviceType: row.service_type || row.title || "Szerviz",
    cost: Number(row.cost || 0),
    provider: row.provider || "",
    service_partner_id: row.service_partner_id ?? row.servicePartnerId ?? null,
    note: row.note || "",
    isServiceRecord: true,
  });
}

export function mapSupabaseKmRow(row) {
  return normalizeServiceHistoryItem({
    id: row.id != null ? String(row.id) : `km-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: row.entry_date || row.date || todayIso(),
    type: "km-update",
    title: "Km frissítés",
    detail: row.note ? `Megjegyzés: ${row.note}` : "Futásteljesítmény frissítve",
    km:
      row.km === null || row.km === undefined || Number.isNaN(Number(row.km))
        ? null
        : Number(row.km),
    serviceType: "",
    cost: 0,
    provider: "",
    note: row.note || "",
    isServiceRecord: false,
  });
}

export function attachHistoryToVehicles(vehicleRows, serviceRows, kmRows) {
  const historyByVehicle = {};

  (serviceRows || []).forEach((row) => {
    const key = row.vehicle_id;
    if (!historyByVehicle[key]) historyByVehicle[key] = [];
    historyByVehicle[key].push(mapSupabaseServiceRow(row));
  });

  (kmRows || []).forEach((row) => {
    const key = row.vehicle_id;
    if (!historyByVehicle[key]) historyByVehicle[key] = [];
    historyByVehicle[key].push(mapSupabaseKmRow(row));
  });

  return (vehicleRows || []).map((row) => {
    const mapped = mapSupabaseVehicleRow(row);
    const combinedHistory = (historyByVehicle[row.id] || []).sort(compareHistoryEntriesDesc);

    return mergeVehicleHistoryWithBaseline({
      ...mapped,
      serviceHistory: combinedHistory,
    });
  });
}

export function createDefaultVehicleDocCollections(insuranceExpiry = "", inspectionExpiry = "") {
  const defaults = createDefaultVehicleDocs(insuranceExpiry, inspectionExpiry);
  return Object.fromEntries(Object.entries(defaults).map(([docKey, doc]) => [docKey, [doc]]));
}

export function buildDocsFromSupabaseRows(vehicles, documentRows) {
  const next = {};

  vehicles.forEach((vehicle) => {
    const defaults = createDefaultVehicleDocs(vehicle.insuranceExpiry, vehicle.inspectionExpiry);
    next[String(vehicle.id)] = Object.fromEntries(Object.keys(defaults).map((docKey) => [docKey, []]));
  });

  (documentRows || []).forEach((row) => {
    const vehicleKey = String(row.vehicle_id);
    if (!next[vehicleKey]) return;
    const docKey = row.doc_key;
    if (!docKey || !next[vehicleKey][docKey]) return;

    next[vehicleKey][docKey].push({
      id: row.id,
      title: row.title || "",
      uploaded: Boolean(row.uploaded),
      fileName: row.file_name || "",
      fileType: row.file_type || "",
      fileSize: Number(row.file_size || 0),
      fileDataUrl: row.file_url || row.file_data_url || "",
      storagePath: row.storage_path || "",
      uploadedAt: row.uploaded_at || "",
      expiry: row.expiry || "",
      note: row.note || "",
    });
  });

  vehicles.forEach((vehicle) => {
    const vehicleKey = String(vehicle.id);
    const defaults = createDefaultVehicleDocs(vehicle.insuranceExpiry, vehicle.inspectionExpiry);

    Object.entries(defaults).forEach(([docKey, defaultDoc]) => {
      if (!next[vehicleKey][docKey] || next[vehicleKey][docKey].length === 0) {
        next[vehicleKey][docKey] = [{ ...defaultDoc }];
      } else {
        next[vehicleKey][docKey] = next[vehicleKey][docKey].map((doc) => ({
          ...doc,
          title: doc.title || defaultDoc.title,
          expiry: doc.expiry || defaultDoc.expiry || "",
        }));
      }
    });
  });

  return next;
}
