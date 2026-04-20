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

export function buildVehicleDbPayload(formState, resolvedDriver, userId) {
  return {
    user_id: userId,
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
    status: "active",
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
