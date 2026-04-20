import { todayIso } from "@/lib/fleet-utils";
import {
  GENERAL_SERVICE_LABEL,
  OIL_SERVICE_LABEL,
  SERVICE_CYCLE_KM,
  TIMING_SERVICE_LABEL,
} from "./constants";
import { formatCurrencyHu, formatKmHu } from "./formatters-hu";

export function normalizeServiceHistoryItem(entry) {
  return {
    id: entry?.id || `history-${Math.random().toString(36).slice(2, 8)}`,
    date: entry?.date || todayIso(),
    type: entry?.type || "note",
    title: entry?.title || "Szerviz esemény",
    detail: entry?.detail || "",
    km:
      entry?.km === null || entry?.km === undefined || Number.isNaN(Number(entry?.km))
        ? null
        : Number(entry.km),
    serviceType: entry?.serviceType || "",
    cost:
      entry?.cost === null || entry?.cost === undefined || Number.isNaN(Number(entry?.cost))
        ? 0
        : Number(entry.cost),
    provider: entry?.provider || "",
    servicePartnerId:
      entry?.servicePartnerId === null || entry?.servicePartnerId === undefined
        ? entry?.service_partner_id === null || entry?.service_partner_id === undefined
          ? null
          : Number(entry.service_partner_id)
        : Number(entry.servicePartnerId),
    note: entry?.note || "",
    baselineLastServiceKm:
      entry?.baselineLastServiceKm === null ||
      entry?.baselineLastServiceKm === undefined ||
      Number.isNaN(Number(entry?.baselineLastServiceKm))
        ? null
        : Number(entry.baselineLastServiceKm),
    isServiceRecord: Boolean(entry?.isServiceRecord),
  };
}

export function createTimelineEntry({
  date = todayIso(),
  type = "note",
  title,
  detail = "",
  km = null,
}) {
  return {
    id: `${type}-${date}-${km ?? "na"}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    type,
    title,
    detail,
    km,
  };
}

export function createServiceRecordEntry({
  date = todayIso(),
  serviceType = "Általános szerviz",
  km = null,
  cost = 0,
  provider = "",
  note = "",
}) {
  const normalizedKm =
    km === null || km === undefined || Number.isNaN(Number(km)) ? null : Number(km);
  const normalizedCost = Number.isNaN(Number(cost)) ? 0 : Number(cost);

  return normalizeServiceHistoryItem({
    id: `service-record-${date}-${normalizedKm ?? "na"}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    type: "service-record",
    title: serviceType,
    detail: [
      provider ? `Partner: ${provider}` : null,
      normalizedCost > 0 ? `Költség: ${formatCurrencyHu(normalizedCost)}` : null,
      note ? `Megjegyzés: ${note}` : null,
    ]
      .filter(Boolean)
      .join(" • "),
    km: normalizedKm,
    serviceType,
    cost: normalizedCost,
    provider,
    note,
    isServiceRecord: true,
  });
}

export function createKmUpdateEntry({ date = todayIso(), km = null, note = "" }) {
  const normalizedKm =
    km === null || km === undefined || Number.isNaN(Number(km)) ? null : Number(km);

  return normalizeServiceHistoryItem({
    id: `km-update-${date}-${normalizedKm ?? "na"}-${Math.random().toString(36).slice(2, 8)}`,
    date,
    type: "km-update",
    title: "Km frissítés",
    detail: note ? `Megjegyzés: ${note}` : "Futásteljesítmény frissítve",
    km: normalizedKm,
    serviceType: "",
    cost: 0,
    provider: "",
    note,
    isServiceRecord: false,
  });
}

export function normalizeLegacyPage(page) {
  switch (page) {
    case "szerviz":
      return "home";
    case "adatok":
      return "vehicles";
    case "dokumentumok":
      return "documents";
    case "history":
    case "km":
      return "service";
    case "home":
    case "vehicles":
    case "documents":
    case "service":
    case "finance":
    case "drivers":
    case "partners":
      return page;
    default:
      return "home";
  }
}

export function resolveServiceHistoryType(draft) {
  if (draft.serviceType === "oil") return OIL_SERVICE_LABEL;
  if (draft.serviceType === "timing") return TIMING_SERVICE_LABEL;
  if (draft.serviceType === "general") return GENERAL_SERVICE_LABEL;
  return (draft.customServiceType || "").trim();
}

export function getLatestServiceKmByType(vehicle, serviceLabel) {
  if (!vehicle) return Number(vehicle?.lastServiceKm || 0);

  const history = Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [];
  const normalizedHistory = [...history].map(normalizeServiceHistoryItem);

  const record = normalizedHistory
    .filter(
      (entry) =>
        entry.isServiceRecord &&
        entry.serviceType === serviceLabel &&
        entry.km !== null &&
        entry.km !== undefined
    )
    .sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.km || 0) - Number(a.km || 0);
    })[0];

  if (record) return Number(record.km || 0);

  const baselineEntry = normalizedHistory.find(
    (entry) =>
      entry.type === "baseline" &&
      entry.baselineLastServiceKm !== null &&
      entry.baselineLastServiceKm !== undefined
  );

  return Number(baselineEntry?.baselineLastServiceKm ?? vehicle.lastServiceKm ?? 0);
}

export function getCustomServiceCycleStatus(vehicle, serviceLabel, intervalKm, warningWindowKm) {
  const interval = Number(intervalKm || 0);
  if (!vehicle || !interval || interval <= 0) return null;

  const baselineKm = getLatestServiceKmByType(vehicle, serviceLabel);
  const currentKm = Number(vehicle.currentKm || 0);
  const nextDueKm = baselineKm + interval;
  const remainingKm = nextDueKm - currentKm;

  return {
    baselineKm,
    nextDueKm,
    remainingKm,
    status:
      remainingKm <= 0 ? "late" : remainingKm <= warningWindowKm ? "warning" : "ok",
  };
}

export function getVehicleTone(vehicle) {
  if (!vehicle) return "ok";
  if (vehicle.status === "late") return "danger";
  if (vehicle.status === "warning") return "warning";
  return "ok";
}

export function getVehicleToneLabel(vehicle) {
  const tone = getVehicleTone(vehicle);
  if (tone === "danger") return "Sürgős";
  if (tone === "warning") return "Figyelni";
  return "Stabil";
}

export function getVehicleToneClass(vehicle, isActive = false) {
  const tone = getVehicleTone(vehicle);
  const base = isActive ? "fleet-vehicle-item fleet-vehicle-active" : "fleet-vehicle-item";
  if (tone === "danger") return `${base} fleet-vehicle-danger`;
  if (tone === "warning") return `${base} fleet-vehicle-warning`;
  return `${base} fleet-vehicle-ok`;
}

export function buildVehicleTimeline(vehicle) {
  if (!vehicle) return [];
  const history = Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [];

  if (history.length > 0) {
    return [...history]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 6);
  }

  return [
    createTimelineEntry({
      type: "forecast",
      title: "Következő szerviz célérték",
      detail: `${formatKmHu((vehicle.lastServiceKm || 0) + SERVICE_CYCLE_KM)} km-nél várható.`,
      km: (vehicle.lastServiceKm || 0) + SERVICE_CYCLE_KM,
    }),
    createTimelineEntry({
      type: "baseline",
      title: "Aktuális futás rögzítve",
      detail: `${formatKmHu(vehicle.currentKm || 0)} km jelenlegi óraállás.`,
      km: vehicle.currentKm || 0,
    }),
    createTimelineEntry({
      type: "service",
      title: "Utolsó ismert szervizciklus",
      detail: `${formatKmHu(vehicle.lastServiceKm || 0)} km-nél indult az aktuális ciklus.`,
      km: vehicle.lastServiceKm || 0,
    }),
  ];
}

/** Newest first; tie-break by km then stable id so same-day km logs stay distinct rows. */
export function compareHistoryEntriesDesc(a, b) {
  const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateDiff !== 0) return dateDiff;
  const kmDiff = Number(b.km || 0) - Number(a.km || 0);
  if (kmDiff !== 0) return kmDiff;
  return String(b.id ?? "").localeCompare(String(a.id ?? ""));
}

/** Baseline km: DB `initial_km` when set; legacy rows fall back once to current odometer. */
export function resolveVehicleInitialKm(vehicle) {
  const raw = vehicle?.initialKm ?? vehicle?.initial_km;
  if (raw !== null && raw !== undefined && raw !== "" && !Number.isNaN(Number(raw))) {
    return Number(raw);
  }
  const fallback = vehicle?.currentKm ?? vehicle?.current_km ?? vehicle?.mileage;
  if (fallback !== null && fallback !== undefined && fallback !== "" && !Number.isNaN(Number(fallback))) {
    return Number(fallback);
  }
  return 0;
}

export function baselineEntryDate(vehicle) {
  const created = vehicle?.createdAt ?? vehicle?.created_at;
  if (created && typeof created === "string") {
    const d = created.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  return "2000-01-01";
}

export function buildInitialKmBaselineEntry(vehicle) {
  const baselineKm = resolveVehicleInitialKm(vehicle);
  const bDate = baselineEntryDate(vehicle);
  return normalizeServiceHistoryItem({
    id: `baseline-initial-${vehicle?.id ?? "unknown"}`,
    date: bDate,
    type: "baseline",
    title: "Kiinduló állapot",
    detail: `${formatKmHu(baselineKm)} km kiinduló óraállás, ${formatKmHu(vehicle?.lastServiceKm || 0)} km utolsó szerviz.`,
    km: baselineKm,
    serviceType: "",
    cost: 0,
    provider: "",
    note: "",
    baselineLastServiceKm: Number(vehicle?.lastServiceKm ?? 0),
    isServiceRecord: false,
  });
}

/** One synthetic baseline from `initial_km`, then all real km_logs / service rows (no duplicate baselines). */
export function mergeVehicleHistoryWithBaseline(vehicle) {
  if (!vehicle) return vehicle;
  const existing = Array.isArray(vehicle.serviceHistory)
    ? vehicle.serviceHistory.map(normalizeServiceHistoryItem)
    : [];
  const withoutBaseline = existing.filter((e) => e.type !== "baseline");
  const baseline = buildInitialKmBaselineEntry(vehicle);
  const merged = [baseline, ...withoutBaseline].sort(compareHistoryEntriesDesc);
  return { ...vehicle, serviceHistory: merged };
}

export function sortHistoryEntriesDesc(entries) {
  return [...(Array.isArray(entries) ? entries : [])]
    .map(normalizeServiceHistoryItem)
    .sort(compareHistoryEntriesDesc);
}

export function deriveVehicleKmStateFromHistory(vehicle, historyEntries) {
  const normalizedHistory = sortHistoryEntriesDesc(historyEntries);
  const numericEntries = normalizedHistory.filter(
    (entry) =>
      entry.type !== "baseline" &&
      entry.km !== null &&
      entry.km !== undefined &&
      Number.isFinite(Number(entry.km))
  );

  const latestKmEntry = [...numericEntries].sort(compareHistoryEntriesDesc)[0];

  const latestServiceEntry = normalizedHistory
    .filter(
      (entry) =>
        entry.isServiceRecord &&
        entry.km !== null &&
        entry.km !== undefined &&
        (entry.serviceType === OIL_SERVICE_LABEL || entry.serviceType === TIMING_SERVICE_LABEL)
    )
    .sort(compareHistoryEntriesDesc)[0];

  const baselineEntry = normalizedHistory.find(
    (entry) =>
      entry.type === "baseline" &&
      entry.baselineLastServiceKm !== null &&
      entry.baselineLastServiceKm !== undefined
  );

  return {
    serviceHistory: normalizedHistory,
    currentKm: Number(latestKmEntry?.km ?? resolveVehicleInitialKm(vehicle)),
    lastServiceKm: Number(
      latestServiceEntry?.km ??
        baselineEntry?.baselineLastServiceKm ??
        vehicle?.lastServiceKm ??
        0
    ),
  };
}
