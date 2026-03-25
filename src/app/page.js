"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CarFront,
  Wrench,
  AlertTriangle,
  Gauge,
  CalendarClock,
  Plus,
  Search,
  ChevronRight,
  Bell,
  Download,
  Filter,
  FileText,
  ClipboardList,
  Save,
  Pencil,
  ShieldCheck,
  BadgeCheck,
  Check,
  X,
  Trash2,
  UserPlus,
  Archive,
  RotateCcw,
  Mail,
  Upload,
  Info,
  Activity,
  Sparkles,
  ShieldAlert,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";


import ExportDialog from "@/components/fleet/ExportDialog";
import { supabase } from "@/lib/supabase";
import { ExpiryBadge, NotificationTypeBadge, StatusBadge } from "@/components/fleet/FleetBadges";
import {
  CUSTOM_DRIVER_VALUE,
  CUSTOM_OWNER_VALUE,
  STORAGE_KEYS,
  initialDriverOptions,
  initialVehicles,
  defaultEmailSettings,
  todayIso,
  createDefaultVehicleDocs,
  createInitialDocsMap,
  safeRead,
  safeWrite,
  computeVehicle,
  buildStats,
  getExpiryStatus,
  formatDateHu,
  getOwnerModeAndCustom,
  getDriverModeAndCustom,
  resolveDriverValue,
  resolveOwnerValue,
  getDocUploadStatus,
  severityRank,
  csvEscape,
  downloadFile,
} from "@/lib/fleet-utils";

const SERVICE_CYCLE_KM = 20000;
const WARNING_THRESHOLD_KM = 3000;
const DOCUMENT_STORAGE_BUCKET = "vehicle-documents";

const sanitizeStorageSegment = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "file";

const isDataUrl = (value) => typeof value === "string" && value.startsWith("data:");

const buildDocumentStoragePath = ({ userId, vehicleId, docKey, fileName }) => {
  const safeName = sanitizeStorageSegment(fileName);
  return `${userId}/${vehicleId}/${docKey}/${Date.now()}-${safeName}`;
};

const getStoragePathFromFileUrl = (fileUrl) => {
  if (!fileUrl || typeof fileUrl !== "string" || isDataUrl(fileUrl)) return "";

  const marker = `/storage/v1/object/public/${DOCUMENT_STORAGE_BUCKET}/`;
  const markerIndex = fileUrl.indexOf(marker);
  if (markerIndex === -1) return "";

  return decodeURIComponent(fileUrl.slice(markerIndex + marker.length));
};

const formatKmHu = (value) => Number(value || 0).toLocaleString("hu-HU");
const formatCurrencyHu = (value) =>
  Number(value || 0).toLocaleString("hu-HU", {
    style: "currency",
    currency: "HUF",
    maximumFractionDigits: 0,
  });

const normalizeServiceHistoryItem = (entry) => ({
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
  note: entry?.note || "",
  baselineLastServiceKm:
    entry?.baselineLastServiceKm === null ||
    entry?.baselineLastServiceKm === undefined ||
    Number.isNaN(Number(entry?.baselineLastServiceKm))
      ? null
      : Number(entry.baselineLastServiceKm),
  isServiceRecord: Boolean(entry?.isServiceRecord),
});

const createTimelineEntry = ({
  date = todayIso(),
  type = "note",
  title,
  detail = "",
  km = null,
}) => ({
  id: `${type}-${date}-${km ?? "na"}-${Math.random().toString(36).slice(2, 8)}`,
  date,
  type,
  title,
  detail,
  km,
});

const createServiceRecordEntry = ({
  date = todayIso(),
  serviceType = "Általános szerviz",
  km = null,
  cost = 0,
  provider = "",
  note = "",
}) => {
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
};




const createKmUpdateEntry = ({
  date = todayIso(),
  km = null,
  note = "",
}) => {
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
};

const OIL_SERVICE_LABEL = "Olajcsere";
const TIMING_SERVICE_LABEL = "Vezérlés csere";
const GENERAL_SERVICE_LABEL = "Általános szerviz";
const CUSTOM_SERVICE_VALUE = "__custom_service__";

const PAGE_KEYS = ["home", "vehicles", "documents", "service", "finance"];
const normalizeLegacyPage = (page) => {
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
      return page;
    default:
      return "home";
  }
};

const resolveServiceHistoryType = (draft) => {
  if (draft.serviceType === "oil") return OIL_SERVICE_LABEL;
  if (draft.serviceType === "timing") return TIMING_SERVICE_LABEL;
  if (draft.serviceType === "general") return GENERAL_SERVICE_LABEL;
  return (draft.customServiceType || "").trim();
};

const getLatestServiceKmByType = (vehicle, serviceLabel) => {
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
};

const getCustomServiceCycleStatus = (vehicle, serviceLabel, intervalKm, warningWindowKm) => {
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
};

const getVehicleTone = (vehicle) => {
  if (!vehicle) return "ok";
  if (vehicle.status === "late") return "danger";
  if (vehicle.status === "warning") return "warning";
  return "ok";
};

const getVehicleToneLabel = (vehicle) => {
  const tone = getVehicleTone(vehicle);
  if (tone === "danger") return "Sürgős";
  if (tone === "warning") return "Figyelni";
  return "Stabil";
};

const getVehicleToneClass = (vehicle, isActive = false) => {
  const tone = getVehicleTone(vehicle);
  const base = isActive ? "fleet-vehicle-item fleet-vehicle-active" : "fleet-vehicle-item";
  if (tone === "danger") return `${base} fleet-vehicle-danger`;
  if (tone === "warning") return `${base} fleet-vehicle-warning`;
  return `${base} fleet-vehicle-ok`;
};

const buildVehicleTimeline = (vehicle) => {
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
};

const buildFleetHealthScore = (vehicles, notifications) => {
  const warningCount = vehicles.filter((item) => item.status === "warning").length;
  const lateCount = vehicles.filter((item) => item.status === "late").length;
  const docsCount = notifications.filter((item) => item.category === "docs").length;
  const legalLateCount = notifications.filter(
    (item) => item.category === "legal" && item.status === "late"
  ).length;

  const rawScore = 100 - lateCount * 14 - warningCount * 5 - docsCount * 2 - legalLateCount * 6;
  const value = Math.max(18, Math.min(100, rawScore));

  return {
    value,
    label:
      value >= 85 ? "Stabil flotta" : value >= 70 ? "Figyelmet kér" : "Beavatkozás kell",
    warningCount,
    lateCount,
    docsCount,
    legalLateCount,
  };
};


const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const serializeSupabaseError = (error) => {
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
};

const buildVehicleDbPayload = (formState, resolvedDriver, userId) => ({
  user_id: userId,
  name: formState.name.trim(),
  plate: formState.plate.toUpperCase().trim(),
  currentKm: Number(formState.currentKm),
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
});


const buildFleetHealthTrend = (score, vehicles, notifications) => {
  const monthLabels = ["Jan", "Feb", "Már", "Ápr", "Máj", "Jún", "Júl", "Aug", "Szept", "Okt", "Nov", "Dec"];
  const now = new Date();

  const docPressure = notifications.filter((item) => item.category === "docs").length;
  const legalPressure = notifications.filter((item) => item.category === "legal").length;
  const servicePressure = vehicles.filter((item) => item.status === "warning" || item.status === "late").length;
  const pressure = Math.min(12, servicePressure * 2 + legalPressure * 0.7 + docPressure * 0.35);

  const offsets = [-8.4, -6.1, -4.9, -3.2, -1.7, 0];

  return offsets.map((offset, index) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const seasonal = Math.sin((index + 1) * 0.85) * 1.8;
    const scoreValue = clamp(Math.round(score.value + offset - pressure * 0.18 + seasonal), 18, 100);

    return {
      month: monthLabels[d.getMonth()],
      score: scoreValue,
      alerts: Math.max(0, Math.round(servicePressure + legalPressure * 0.35 + docPressure * 0.2 - (5 - index) * 0.45)),
    };
  });
};


const ensureVehicleHistory = (vehicle) => {
  const existingHistory = Array.isArray(vehicle?.serviceHistory)
    ? vehicle.serviceHistory.map(normalizeServiceHistoryItem)
    : [];

  if (existingHistory.length > 0) {
    return { ...vehicle, serviceHistory: existingHistory };
  }

  return {
    ...vehicle,
    serviceHistory: [
      normalizeServiceHistoryItem({
        ...createTimelineEntry({
          type: "baseline",
          title: "Kiinduló állapot",
          detail: `${formatKmHu(vehicle?.currentKm || 0)} km aktuális futás, ${formatKmHu(
            vehicle?.lastServiceKm || 0
          )} km utolsó szerviz.`,
          km: vehicle?.currentKm || 0,
        }),
        baselineLastServiceKm: Number(vehicle?.lastServiceKm || 0),
      }),
    ],
  };
};

const mapSupabaseVehicleRow = (row) =>
  ensureVehicleHistory({
    id: row.id,
    name:
      row.name ||
      [row.brand, row.model].filter(Boolean).join(" ") ||
      row.plate ||
      `Jármű ${row.id}`,
    plate: row.plate || "",
    currentKm: Number(row.currentKm ?? row.current_km ?? row.mileage ?? 0),
    lastServiceKm: Number(row.lastServiceKm ?? row.last_service_km ?? row.mileage ?? 0),
    driver: row.driver || row.owner || "",
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
  });

const mapSupabaseServiceRow = (row) =>
  normalizeServiceHistoryItem({
    id: row.id,
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
    note: row.note || "",
    isServiceRecord: true,
  });

const mapSupabaseKmRow = (row) =>
  normalizeServiceHistoryItem({
    id: row.id,
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

const attachHistoryToVehicles = (vehicleRows, serviceRows, kmRows) => {
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
    const combinedHistory = (historyByVehicle[row.id] || []).sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.km || 0) - Number(a.km || 0);
    });

    return ensureVehicleHistory({
      ...mapped,
      serviceHistory: combinedHistory,
    });
  });
};

const createDefaultVehicleDocCollections = (insuranceExpiry = "", inspectionExpiry = "") => {
  const defaults = createDefaultVehicleDocs(insuranceExpiry, inspectionExpiry);
  return Object.fromEntries(Object.entries(defaults).map(([docKey, doc]) => [docKey, [doc]]));
};

const buildDocsFromSupabaseRows = (vehicles, documentRows) => {
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
      uploadedAt: row.uploaded_at || "",
      expiry: row.expiry || "",
      note: row.note || "",
    });
  });

  // Ensure every docKey has at least a draft placeholder in memory.
  vehicles.forEach((vehicle) => {
    const vehicleKey = String(vehicle.id);
    const defaults = createDefaultVehicleDocs(vehicle.insuranceExpiry, vehicle.inspectionExpiry);

    Object.entries(defaults).forEach(([docKey, defaultDoc]) => {
      if (!next[vehicleKey][docKey] || next[vehicleKey][docKey].length === 0) {
        next[vehicleKey][docKey] = [{ ...defaultDoc }];
      } else {
        // Backfill titles/metadata for older records.
        next[vehicleKey][docKey] = next[vehicleKey][docKey].map((doc) => ({
          ...doc,
          title: doc.title || defaultDoc.title,
          expiry: doc.expiry || defaultDoc.expiry || "",
        }));
      }
    });
  });

  return next;
};


const sortHistoryEntriesDesc = (entries) =>
  [...(Array.isArray(entries) ? entries : [])]
    .map(normalizeServiceHistoryItem)
    .sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.km || 0) - Number(a.km || 0);
    });

const deriveVehicleKmStateFromHistory = (vehicle, historyEntries) => {
  const normalizedHistory = sortHistoryEntriesDesc(historyEntries);
  const numericEntries = normalizedHistory.filter(
    (entry) => entry.km !== null && entry.km !== undefined && Number.isFinite(Number(entry.km))
  );

  const latestKmEntry = [...numericEntries].sort((a, b) => {
    const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateDiff !== 0) return dateDiff;
    return Number(b.km || 0) - Number(a.km || 0);
  })[0];

  const latestServiceEntry = normalizedHistory
    // "Általános szerviz" should not affect oil/timing replacement baselines.
    // Only oil-change and timing records should update the "lastServiceKm" fallback.
    .filter(
      (entry) =>
        entry.isServiceRecord &&
        entry.km !== null &&
        entry.km !== undefined &&
        (entry.serviceType === OIL_SERVICE_LABEL || entry.serviceType === TIMING_SERVICE_LABEL)
    )
    .sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.km || 0) - Number(a.km || 0);
    })[0];

  const baselineEntry = normalizedHistory.find(
    (entry) =>
      entry.type === "baseline" &&
      entry.baselineLastServiceKm !== null &&
      entry.baselineLastServiceKm !== undefined
  );

  return {
    serviceHistory: normalizedHistory,
    currentKm: Number(latestKmEntry?.km ?? baselineEntry?.km ?? vehicle?.currentKm ?? 0),
    lastServiceKm: Number(
      latestServiceEntry?.km ??
        baselineEntry?.baselineLastServiceKm ??
        vehicle?.lastServiceKm ??
        0
    ),
  };
};

const buildPredictiveService = (vehicle) => {
  if (!vehicle) return null;

  const history = Array.isArray(vehicle.serviceHistory)
    ? vehicle.serviceHistory
        .filter((entry) => entry?.date && entry?.km !== null && entry?.km !== undefined)
        .map((entry) => ({
          ...entry,
          km: Number(entry.km),
          dateObj: new Date(`${entry.date}T00:00:00`),
        }))
        .filter((entry) => Number.isFinite(entry.km) && !Number.isNaN(entry.dateObj.getTime()))
        .sort((a, b) => a.dateObj - b.dateObj)
    : [];

  let avgKmPerDay = 0;
  let confidence = "Becsült modell";

  if (history.length >= 2) {
    const first = history[0];
    const last = history[history.length - 1];
    const dayDiff = Math.max(1, Math.round((last.dateObj - first.dateObj) / 86400000));
    const kmDiff = Math.max(0, last.km - first.km);

    if (kmDiff > 0) {
      avgKmPerDay = kmDiff / dayDiff;
      confidence = "Valós timeline alapján";
    }
  }

  if (!avgKmPerDay || !Number.isFinite(avgKmPerDay)) {
    const cycleUsed = Math.max(0, Number(vehicle.currentKm || 0) - Number(vehicle.lastServiceKm || 0));
    avgKmPerDay = clamp(cycleUsed / 90 || 42, 18, 140);
  }

  const roundedAvg = Math.round(avgKmPerDay * 10) / 10;
  const remainingKm = Number(vehicle.remainingKm || 0);
  const nextThresholdKm = Math.max(0, remainingKm);
  const criticalKmWindow = Math.max(0, remainingKm - 1000);

  const toFutureDate = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };

  const daysToService = remainingKm <= 0 ? 0 : Math.max(1, Math.ceil(nextThresholdKm / Math.max(roundedAvg, 1)));
  const daysToCritical = remainingKm <= 1000 ? 0 : Math.max(1, Math.ceil(criticalKmWindow / Math.max(roundedAvg, 1)));

  return {
    avgKmPerDay: roundedAvg,
    confidence,
    predictedDate: remainingKm <= 0 ? todayIso() : toFutureDate(daysToService),
    criticalDate: remainingKm <= 1000 ? todayIso() : toFutureDate(daysToCritical),
    daysToService,
    daysToCritical,
    riskLabel:
      remainingKm <= 0
        ? "Lejárt"
        : remainingKm <= 1000
        ? "Kritikus"
        : remainingKm <= WARNING_THRESHOLD_KM
        ? "Közelgő"
        : "Stabil",
    recommendation:
      remainingKm <= 0
        ? "A jármű már túlfutotta a szervizciklust. Prioritásként kezeld."
        : remainingKm <= 1000
        ? "Rövid időn belül kritikus állapotba kerülhet. Foglalj szervizidőpontot."
        : remainingKm <= WARNING_THRESHOLD_KM
        ? "A következő hetekben elérheti a szervizküszöböt. Érdemes előre tervezni."
        : "A jármű még stabil, de a használati trend alapján már becsülhető a következő szervizablak.",
  };
};

export default function Home() {
  const [hydrated, setHydrated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [vehicles, setVehicles] = useState([]);
  const [ownerOptions, setOwnerOptions] = useState(initialDriverOptions);
  const [documentsByVehicle, setDocumentsByVehicle] = useState(
    {}
  );
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings);
  const [acknowledgedNotifications, setAcknowledgedNotifications] = useState({});
  const [dismissedNotifications, setDismissedNotifications] = useState({});

  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [activePage, setActivePage] = useState("home");
  const [isVehicleDetailsEditing, setIsVehicleDetailsEditing] = useState(false);

  const [ownerManagerValue, setOwnerManagerValue] = useState("");
  const [ownerToDelete, setOwnerToDelete] = useState(null);
  const [vehicleToDelete, setVehicleToDelete] = useState(null);
  const [vehicleToArchive, setVehicleToArchive] = useState(null);
  const [documentToRemove, setDocumentToRemove] = useState(null);

  const [documentPreview, setDocumentPreview] = useState(null);

  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationCategoryFilter, setNotificationCategoryFilter] = useState("all");
  const [notificationSort, setNotificationSort] = useState("severity");

  const [toast, setToast] = useState(null);
  const [initializationError, setInitializationError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIncludeArchived, setExportIncludeArchived] = useState(true);
  const [exportOptions, setExportOptions] = useState({
    fullJson: true,
    vehiclesCsv: false,
    documentsCsv: false,
    serviceHistoryCsv: false,
    healthCsv: false,
  });

  const notificationRef = useRef(null);
  const fileInputRefs = useRef({});

  const [form, setForm] = useState({
    name: "",
    plate: "",
    currentKm: "",
    lastServiceKm: "",
    ownerMode: "Tulaj 1",
    customOwner: "",
    note: "",
    year: "",
    vin: "",
    fuelType: "Benzin",
    insuranceExpiry: "",
    inspectionExpiry: "",
    oilChangeIntervalKm: "15000",
    timingBeltIntervalKm: "180000",
  });

  const [vehicleDetailsForm, setVehicleDetailsForm] = useState({
    name: "",
    plate: "",
    ownerMode: "Tulaj 1",
    customOwner: "",
    note: "",
    year: "",
    vin: "",
    fuelType: "Benzin",
    insuranceExpiry: "",
    inspectionExpiry: "",
    oilChangeIntervalKm: "",
    timingBeltIntervalKm: "",
  });

  const [serviceDraft, setServiceDraft] = useState({
    currentKm: "",
    lastServiceKm: "",
  });

  const [serviceHistoryDraft, setServiceHistoryDraft] = useState({
    date: todayIso(),
    km: "",
    serviceType: "general",
    customServiceType: "",
    cost: "",
    provider: "",
    note: "",
  });


const [kmUpdateDraft, setKmUpdateDraft] = useState({
  date: todayIso(),
  km: "",
  note: "",
});


  useEffect(() => {
    let isMounted = true;

    const resetBrokenAuthState = async () => {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch (signOutError) {
        console.error("Supabase local signOut error:", signOutError);
      }

      if (!isMounted) return;

      setSession(null);
      setHydrated(true);
      setToast({
        id: Date.now(),
        type: "error",
        message: "A bejelentkezési munkamenet lejárt vagy sérült volt. Jelentkezz be újra.",
      });
    };

    const initializeAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          const authMessage = String(error.message || "").toLowerCase();
          if (
            authMessage.includes("refresh token") ||
            authMessage.includes("invalid") ||
            authMessage.includes("jwt")
          ) {
            await resetBrokenAuthState();
          } else {
            console.error("Supabase getSession error:", error);
            if (isMounted) setSession(null);
          }
        } else if (isMounted) {
          const nextSession = data?.session ?? null;
          setSession(nextSession);
          if (!nextSession) {
            setHydrated(true);
          }
        }
      } catch (error) {
        console.error("Supabase auth init error:", error);
        if (isMounted) setSession(null);
      } finally {
        if (isMounted) setAuthReady(true);
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (!isMounted) return;

      if (event === "SIGNED_OUT") {
        setSession(null);
        setHydrated(true);
        setAuthReady(true);
        return;
      }

      if (event === "TOKEN_REFRESH_FAILED") {
        await resetBrokenAuthState();
        setAuthReady(true);
        return;
      }

      setSession(nextSession ?? null);
      if (!nextSession) {
        setHydrated(true);
      }
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, []);


  useEffect(() => {
    if (!authReady || !session?.user?.id) return;

    const initializeApp = async () => {
      const savedOwners = safeRead(
        STORAGE_KEYS.drivers,
        safeRead(STORAGE_KEYS.owners, initialDriverOptions)
      );
      const savedEmail = safeRead(STORAGE_KEYS.email, defaultEmailSettings);
      const savedAck = safeRead(STORAGE_KEYS.ack, {});
      const savedDismissed = safeRead(STORAGE_KEYS.dismissed, {});
      const savedUi = safeRead(STORAGE_KEYS.ui, {
        selectedId: null,
        activePage: "szerviz",
        query: "",
        filter: "all",
        exportIncludeArchived: true,
        exportOptions: {
          fullJson: true,
          vehiclesCsv: false,
          documentsCsv: false,
          serviceHistoryCsv: false,
          healthCsv: false,
        },
      });

      setOwnerOptions(savedOwners);
      setEmailSettings(savedEmail);
      setAcknowledgedNotifications(savedAck);
      setDismissedNotifications(savedDismissed);
      setActivePage(normalizeLegacyPage(savedUi.activePage || "home"));
      setQuery(savedUi.query || "");
      setFilter(savedUi.filter || "all");
      setExportIncludeArchived(
        typeof savedUi.exportIncludeArchived === "boolean"
          ? savedUi.exportIncludeArchived
          : true
      );
      setExportOptions(
        savedUi.exportOptions || {
          fullJson: true,
          vehiclesCsv: false,
          documentsCsv: false,
          serviceHistoryCsv: false,
          healthCsv: false,
        }
      );

      try {
        setInitializationError("");
        const userId = session.user.id;

        const [vehiclesResult, serviceResult, kmResult, docsResult] = await Promise.all([
          supabase
            .from("vehicles")
            .select("*")
            .eq("user_id", userId)
            .order("id", { ascending: false }),
          supabase
            .from("service_history")
            .select("*")
            .eq("user_id", userId)
            .order("entry_date", { ascending: false }),
          supabase
            .from("km_logs")
            .select("*")
            .eq("user_id", userId)
            .order("entry_date", { ascending: false }),
          supabase
            .from("vehicle_documents")
            .select("*")
            .eq("user_id", userId),
        ]);

        if (vehiclesResult.error) {
          console.error("Supabase vehicle load error:", vehiclesResult.error);
        }
        if (serviceResult.error) {
          console.error("Supabase service_history load error:", serviceResult.error);
        }
        if (kmResult.error) {
          console.error("Supabase km_logs load error:", kmResult.error);
        }
        if (docsResult.error) {
          console.error("Supabase vehicle_documents load error:", docsResult.error);
        }

        const loadedVehicles = attachHistoryToVehicles(
          vehiclesResult.data || [],
          serviceResult.data || [],
          kmResult.data || []
        );

        setVehicles(loadedVehicles);
        setDocumentsByVehicle(buildDocsFromSupabaseRows(loadedVehicles, docsResult.data || []));

        const savedSelectedId = savedUi.selectedId ?? null;
        const selectedExists = loadedVehicles.some((vehicle) => vehicle.id === savedSelectedId);
        setSelectedId(selectedExists ? savedSelectedId : loadedVehicles[0]?.id ?? null);
      } catch (error) {
        console.error("Vehicle initialization error:", error);
        setInitializationError("Az adatok betöltése nem sikerült. Frissítsd az oldalt vagy jelentkezz be újra.");
        setVehicles([]);
        setDocumentsByVehicle({});
        setSelectedId(null);
      } finally {
        setHydrated(true);
      }
    };

    initializeApp();
  }, [authReady, session?.user?.id]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(STORAGE_KEYS.owners, ownerOptions);
  }, [ownerOptions, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(STORAGE_KEYS.email, emailSettings);
  }, [emailSettings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(STORAGE_KEYS.ack, acknowledgedNotifications);
  }, [acknowledgedNotifications, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(STORAGE_KEYS.dismissed, dismissedNotifications);
  }, [dismissedNotifications, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    safeWrite(STORAGE_KEYS.ui, {
      selectedId,
      activePage: safePage,
      query,
      filter,
      exportIncludeArchived,
      exportOptions,
    });
  }, [
    hydrated,
    selectedId,
    activePage,
    query,
    filter,
    exportIncludeArchived,
    exportOptions,
  ]);

  const activeVehicles = useMemo(
    () => vehicles.filter((vehicle) => !vehicle.archived),
    [vehicles]
  );

  const archivedVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.archived),
    [vehicles]
  );

  const enrichedVehicles = useMemo(
    () => activeVehicles.map(computeVehicle),
    [activeVehicles]
  );

  const filteredVehicles = useMemo(() => {
    return enrichedVehicles.filter((v) => {
      const matchesQuery = [v.name, v.plate, v.driver, v.note]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase());

      const matchesFilter =
        filter === "all"
          ? true
          : filter === "warning"
          ? v.status === "warning"
          : filter === "late"
          ? v.status === "late"
          : v.status === "ok";

      return matchesQuery && matchesFilter;
    });
  }, [enrichedVehicles, query, filter]);

  const selectedVehicle = useMemo(() => {
    return (
      filteredVehicles.find((v) => v.id === selectedId) ||
      enrichedVehicles.find((v) => v.id === selectedId) ||
      enrichedVehicles[0] ||
      null
    );
  }, [filteredVehicles, enrichedVehicles, selectedId]);

  const stats = useMemo(() => buildStats(enrichedVehicles), [enrichedVehicles]);

  const allNotifications = useMemo(() => {
    const items = [];

    enrichedVehicles.forEach((vehicle) => {
      const remainingKm = Number(vehicle.remainingKm || 0);

      if (remainingKm <= WARNING_THRESHOLD_KM && remainingKm > 0) {
        items.push({
          id: `service-warning-${vehicle.id}-${remainingKm}`,
          category: "service",
          type: "serviceWarning",
          status: remainingKm <= 1000 ? "late" : "warning",
          vehicleId: vehicle.id,
          title: `${vehicle.name} hamarosan szervizes`,
          description: `${vehicle.plate} • ${remainingKm.toLocaleString("hu-HU")} km van hátra a következő szervizig.`,
        });
      }

      if (remainingKm <= 0) {
        items.push({
          id: `service-late-${vehicle.id}-${Math.abs(remainingKm)}`,
          category: "service",
          type: "serviceLate",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} azonnali szervizt igényel`,
          description: `${vehicle.plate} • ${Math.abs(remainingKm).toLocaleString("hu-HU")} km-rel túlfutott a szervizcikluson.`,
        });
      }

      const predictive = buildPredictiveService(vehicle);

      if (predictive && remainingKm > WARNING_THRESHOLD_KM && predictive.daysToService <= 30) {
        items.push({
          id: `predictive-service-${vehicle.id}-${predictive.predictedDate}`,
          category: "service",
          type: "serviceWarning",
          status: predictive.daysToService <= 14 ? "late" : "warning",
          vehicleId: vehicle.id,
          title: `${vehicle.name} prediktív szervizablakba ér`,
          description: `${vehicle.plate} • Várható szerviz: ${formatDateHu(
            predictive.predictedDate
          )} (~${predictive.daysToService} nap múlva).`,
        });
      }

      if (predictive && remainingKm > 1000 && predictive.daysToCritical <= 14) {
        items.push({
          id: `predictive-critical-${vehicle.id}-${predictive.criticalDate}`,
          category: "service",
          type: "serviceLate",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} hamarosan kritikus küszöbbe lép`,
          description: `${vehicle.plate} • A becsült kritikus dátum: ${formatDateHu(
            predictive.criticalDate
          )} (~${predictive.daysToCritical} nap múlva).`,
        });
      }


      const oilStatus = getCustomServiceCycleStatus(
        vehicle,
        OIL_SERVICE_LABEL,
        vehicle.oilChangeIntervalKm,
        3000
      );

      if (oilStatus?.status === "warning") {
        items.push({
          id: `oil-warning-${vehicle.id}-${oilStatus.nextDueKm}`,
          category: "service",
          type: "serviceWarning",
          status: "warning",
          vehicleId: vehicle.id,
          title: `${vehicle.name} olajcseréje hamarosan esedékes`,
          description: `${vehicle.plate} • ${formatKmHu(oilStatus.remainingKm)} km van hátra az olajcseréig.`,
        });
      }

      if (oilStatus?.status === "late") {
        items.push({
          id: `oil-late-${vehicle.id}-${oilStatus.nextDueKm}`,
          category: "service",
          type: "serviceLate",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} olajcseréje esedékes`,
          description: `${vehicle.plate} • ${formatKmHu(Math.abs(oilStatus.remainingKm))} km-rel túlfutott az olajcsere cikluson.`,
        });
      }

      const timingStatus = getCustomServiceCycleStatus(
        vehicle,
        TIMING_SERVICE_LABEL,
        vehicle.timingBeltIntervalKm,
        10000
      );

      if (timingStatus?.status === "warning") {
        items.push({
          id: `timing-warning-${vehicle.id}-${timingStatus.nextDueKm}`,
          category: "service",
          type: "serviceWarning",
          status: "warning",
          vehicleId: vehicle.id,
          title: `${vehicle.name} vezérlés cseréje közeleg`,
          description: `${vehicle.plate} • ${formatKmHu(timingStatus.remainingKm)} km van hátra a vezérlés cseréig.`,
        });
      }

      if (timingStatus?.status === "late") {
        items.push({
          id: `timing-late-${vehicle.id}-${timingStatus.nextDueKm}`,
          category: "service",
          type: "serviceLate",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} vezérlés cseréje esedékes`,
          description: `${vehicle.plate} • ${formatKmHu(Math.abs(timingStatus.remainingKm))} km-rel túlfutott a vezérlés csere cikluson.`,
        });
      }

      const insuranceStatus = getExpiryStatus(vehicle.insuranceExpiry);
      const inspectionStatus = getExpiryStatus(vehicle.inspectionExpiry);

      if (insuranceStatus.status === "warning") {
        items.push({
          id: `insurance-warning-${vehicle.id}-${vehicle.insuranceExpiry}`,
          category: "legal",
          type: "insuranceWarning",
          status: "warning",
          vehicleId: vehicle.id,
          title: `${vehicle.name} biztosítása hamarosan lejár`,
          description: `${vehicle.plate} • ${insuranceStatus.helper}.`,
        });
      }

      if (insuranceStatus.status === "late") {
        items.push({
          id: `insurance-late-${vehicle.id}-${vehicle.insuranceExpiry}`,
          category: "legal",
          type: "insuranceLate",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} biztosítása lejárt`,
          description: `${vehicle.plate} • ${insuranceStatus.helper}.`,
        });
      }

      if (inspectionStatus.status === "warning") {
        items.push({
          id: `inspection-warning-${vehicle.id}-${vehicle.inspectionExpiry}`,
          category: "legal",
          type: "inspectionWarning",
          status: "warning",
          vehicleId: vehicle.id,
          title: `${vehicle.name} műszakija hamarosan lejár`,
          description: `${vehicle.plate} • ${inspectionStatus.helper}.`,
        });
      }

      if (inspectionStatus.status === "late") {
        items.push({
          id: `inspection-late-${vehicle.id}-${vehicle.inspectionExpiry}`,
          category: "legal",
          type: "inspectionLate",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} műszakija lejárt`,
          description: `${vehicle.plate} • ${inspectionStatus.helper}.`,
        });
      }

      if (!vehicle.driver || !vehicle.driver.trim()) {
        items.push({
          id: `driver-missing-${vehicle.id}`,
          category: "driver",
          type: "driverMissing",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} sofőrje nincs beállítva`,
          description: `${vehicle.plate} • Állíts be sofőrt az autóhoz.`,
        });
      }

      const vehicleDocs = documentsByVehicle[String(vehicle.id)] || {};
      Object.entries(vehicleDocs).forEach(([docKey, docValue]) => {
        const docsArr = Array.isArray(docValue) ? docValue : [docValue];
        const docTitle = docsArr?.[0]?.title || docKey;
        const docStatus = getDocUploadStatus(docsArr);
        const sourceExpiry = docStatus?.sourceExpiry || docsArr?.[0]?.expiry || "";

        if (docStatus.status === "missing") {
          items.push({
            id: `doc-missing-${vehicle.id}-${docKey}`,
            category: "docs",
            type: "docMissing",
            status: "missing",
            vehicleId: vehicle.id,
            title: `${vehicle.name} dokumentuma hiányzik`,
            description: `${vehicle.plate} • ${docTitle} nincs feltöltve.`,
          });
        }

        if (docStatus.status === "warning") {
          items.push({
            id: `doc-warning-${vehicle.id}-${docKey}-${sourceExpiry}`,
            category: "docs",
            type: "docWarning",
            status: "warning",
            vehicleId: vehicle.id,
            title: `${vehicle.name} dokumentuma hamarosan lejár`,
            description: `${vehicle.plate} • ${docTitle}: ${docStatus.helper}.`,
          });
        }

        if (docStatus.status === "late") {
          items.push({
            id: `doc-late-${vehicle.id}-${docKey}-${sourceExpiry}`,
            category: "docs",
            type: "docLate",
            status: "late",
            vehicleId: vehicle.id,
            title: `${vehicle.name} dokumentuma lejárt`,
            description: `${vehicle.plate} • ${docTitle}: ${docStatus.helper}.`,
          });
        }
      });
    });

    const deduped = Array.from(new Map(items.map((item) => [item.id, item])).values());

    const sorted = [...deduped].sort((a, b) => {
      if (notificationSort === "vehicle") {
        return a.title.localeCompare(b.title, "hu");
      }

      if (notificationSort === "category") {
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category, "hu");
        }
        return severityRank(a.status) - severityRank(b.status);
      }

      const sevDiff = severityRank(a.status) - severityRank(b.status);
      if (sevDiff !== 0) return sevDiff;
      return a.title.localeCompare(b.title, "hu");
    });

    return sorted;
  }, [enrichedVehicles, documentsByVehicle, notificationSort]);

  const fleetHealthScore = useMemo(
    () => buildFleetHealthScore(enrichedVehicles, allNotifications),
    [enrichedVehicles, allNotifications]
  );

  const fleetHealthTrend = useMemo(
    () => buildFleetHealthTrend(fleetHealthScore, enrichedVehicles, allNotifications),
    [fleetHealthScore, enrichedVehicles, allNotifications]
  );

  const predictiveService = useMemo(
    () => buildPredictiveService(selectedVehicle),
    [selectedVehicle]
  );

  const selectedVehicleTimeline = useMemo(
    () => buildVehicleTimeline(selectedVehicle),
    [selectedVehicle]
  );

  const selectedVehicleServiceHistory = useMemo(() => {
    if (!selectedVehicle) return [];
    return [...(Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])]
      .map(normalizeServiceHistoryItem)
      .filter((entry) => entry.isServiceRecord)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [selectedVehicle]);


const selectedVehicleAllHistory = useMemo(() => {
  if (!selectedVehicle) return [];
  return [...(Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])]
    .map(normalizeServiceHistoryItem)
    .sort((a, b) => {
      const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
      if (dateDiff !== 0) return dateDiff;
      return Number(b.km || 0) - Number(a.km || 0);
    });
}, [selectedVehicle]);

  const selectedVehicleServiceSummary = useMemo(() => {
    const records = selectedVehicleServiceHistory;
    const totalCost = records.reduce((sum, entry) => sum + Number(entry.cost || 0), 0);
    const currentYear = String(new Date().getFullYear());
    const yearlyCost = records
      .filter((entry) => String(entry.date || "").startsWith(currentYear))
      .reduce((sum, entry) => sum + Number(entry.cost || 0), 0);
    const avgCost = records.length ? totalCost / records.length : 0;
    return {
      totalCost,
      yearlyCost,
      avgCost,
      count: records.length,
      lastService: records[0] || null,
    };
  }, [selectedVehicleServiceHistory]);


  const selectedVehicleOilStatus = useMemo(
    () =>
      getCustomServiceCycleStatus(
        selectedVehicle,
        OIL_SERVICE_LABEL,
        selectedVehicle?.oilChangeIntervalKm,
        3000
      ),
    [selectedVehicle]
  );

  const selectedVehicleTimingStatus = useMemo(
    () =>
      getCustomServiceCycleStatus(
        selectedVehicle,
        TIMING_SERVICE_LABEL,
        selectedVehicle?.timingBeltIntervalKm,
        10000
      ),
    [selectedVehicle]
  );

  const fleetServiceSummary = useMemo(() => {
    const allRecords = activeVehicles.flatMap((vehicle) =>
      (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
        .map(normalizeServiceHistoryItem)
        .filter((entry) => entry.isServiceRecord)
    );
    const totalCost = allRecords.reduce((sum, entry) => sum + Number(entry.cost || 0), 0);
    const count = allRecords.length;
    return {
      totalCost,
      count,
      avgCost: count ? totalCost / count : 0,
      latestDate: [...allRecords]
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0]?.date || "",
    };
  }, [activeVehicles]);


const serviceDashboardDueVehicles = useMemo(() => {
  return [...enrichedVehicles]
    .map((vehicle) => {
      const oilStatus = getCustomServiceCycleStatus(
        vehicle,
        OIL_SERVICE_LABEL,
        vehicle?.oilChangeIntervalKm,
        3000
      );
      const timingStatus = getCustomServiceCycleStatus(
        vehicle,
        TIMING_SERVICE_LABEL,
        vehicle?.timingBeltIntervalKm,
        10000
      );

      const candidates = [
        oilStatus ? { ...oilStatus, label: OIL_SERVICE_LABEL } : null,
        timingStatus ? { ...timingStatus, label: TIMING_SERVICE_LABEL } : null,
      ].filter(Boolean);

      const nextDue = [...candidates].sort(
        (a, b) => Number(a.remainingKm || 0) - Number(b.remainingKm || 0)
      )[0];

      return {
        ...vehicle,
        dueType: nextDue?.label || "",
        dueRemainingKm: Number(nextDue?.remainingKm || 0),
        hasTrackedCycle: candidates.length > 0,
      };
    })
    .filter((vehicle) => vehicle.hasTrackedCycle)
    .sort((a, b) => Number(a.dueRemainingKm || 0) - Number(b.dueRemainingKm || 0))
    .slice(0, 5);
}, [enrichedVehicles]);

const serviceDashboardTopCostVehicles = useMemo(() => {
  return activeVehicles
    .map((vehicle) => {
      const records = (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
        .map(normalizeServiceHistoryItem)
        .filter((entry) => entry.isServiceRecord);

      return {
        ...vehicle,
        totalCost: records.reduce((sum, entry) => sum + Number(entry.cost || 0), 0),
        serviceCount: records.length,
      };
    })
    .filter((vehicle) => vehicle.serviceCount > 0)
    .sort((a, b) => Number(b.totalCost || 0) - Number(a.totalCost || 0))
    .slice(0, 5);
}, [activeVehicles]);

const serviceDashboardYearlyCosts = useMemo(() => {
  const totals = {};

  activeVehicles.forEach((vehicle) => {
    (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
      .map(normalizeServiceHistoryItem)
      .filter((entry) => entry.isServiceRecord)
      .forEach((entry) => {
        const year = String(entry.date || "").slice(0, 4) || "N/A";
        totals[year] = (totals[year] || 0) + Number(entry.cost || 0);
      });
  });

  return Object.entries(totals)
    .map(([year, total]) => ({ year, total }))
    .sort((a, b) => a.year.localeCompare(b.year));
}, [activeVehicles]);


  const filteredNotificationsByCategory = useMemo(() => {
    if (notificationCategoryFilter === "all") return allNotifications;
    return allNotifications.filter((item) => item.category === notificationCategoryFilter);
  }, [allNotifications, notificationCategoryFilter]);

  const visibleNotifications = useMemo(() => {
    return filteredNotificationsByCategory.filter(
      (item) => !dismissedNotifications[item.id]
    );
  }, [filteredNotificationsByCategory, dismissedNotifications]);

  const unreadNotificationsCount = useMemo(() => {
    return allNotifications.filter(
      (item) => !dismissedNotifications[item.id] && !acknowledgedNotifications[item.id]
    ).length;
  }, [allNotifications, dismissedNotifications, acknowledgedNotifications]);

  const prioritySummary = useMemo(() => {
    const criticalVehicles = serviceDashboardDueVehicles.filter(
      (vehicle) => Number(vehicle.dueRemainingKm || 0) <= 1000
    );
    const attentionVehicles = serviceDashboardDueVehicles.filter((vehicle) => {
      const remaining = Number(vehicle.dueRemainingKm || 0);
      return remaining > 1000 && remaining <= WARNING_THRESHOLD_KM;
    });

    const legalNotifications = allNotifications.filter((item) => item.category === "legal");
    const docNotifications = allNotifications.filter((item) => item.category === "docs");
    const ownerNotifications = allNotifications.filter((item) => item.category === "driver");

    const topVehicle = serviceDashboardDueVehicles[0] || null;

    return {
      criticalCount: criticalVehicles.length,
      attentionCount: attentionVehicles.length,
      legalCount: legalNotifications.length,
      docsCount: docNotifications.length,
      ownerCount: ownerNotifications.length,
      topVehicle,
      recommendation:
        criticalVehicles.length > 0
          ? "Van azonnali olajcsere vagy vezérlés teendő. Érdemes a kritikus járművekkel kezdeni."
          : attentionVehicles.length > 0
          ? "A következő 3000 km-en belül több járműnél olajcsere vagy vezérlés esedékes."
          : legalNotifications.length > 0 || docNotifications.length > 0
          ? "A flotta műszakilag stabil, de van adminisztratív utánkövetés."
          : "Jelenleg nincs kritikus teendő. A flotta stabil állapotban van.",
    };
  }, [serviceDashboardDueVehicles, allNotifications]);

  useEffect(() => {
    const validIds = new Set(allNotifications.map((n) => n.id));

    setAcknowledgedNotifications((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        if (validIds.has(key)) next[key] = prev[key];
      });
      return next;
    });

    setDismissedNotifications((prev) => {
      const next = {};
      Object.keys(prev).forEach((key) => {
        if (validIds.has(key)) next[key] = prev[key];
      });
      return next;
    });
  }, [allNotifications]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setNotificationOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!selectedVehicle) return;

    const ownerState = getOwnerModeAndCustom(selectedVehicle.driver, ownerOptions);

    setVehicleDetailsForm({
      name: selectedVehicle.name || "",
      plate: selectedVehicle.plate || "",
      ownerMode: ownerState.ownerMode,
      customOwner: ownerState.customOwner,
      note: selectedVehicle.note || "",
      year: selectedVehicle.year || "",
      vin: selectedVehicle.vin || "",
      fuelType: selectedVehicle.fuelType || "Benzin",
      insuranceExpiry: selectedVehicle.insuranceExpiry || "",
      inspectionExpiry: selectedVehicle.inspectionExpiry || "",
      oilChangeIntervalKm:
        selectedVehicle.oilChangeIntervalKm !== undefined && selectedVehicle.oilChangeIntervalKm !== null
          ? String(selectedVehicle.oilChangeIntervalKm)
          : "",
      timingBeltIntervalKm:
        selectedVehicle.timingBeltIntervalKm !== undefined && selectedVehicle.timingBeltIntervalKm !== null
          ? String(selectedVehicle.timingBeltIntervalKm)
          : "",
    });

    setServiceDraft({
      currentKm: selectedVehicle.currentKm !== undefined ? String(selectedVehicle.currentKm) : "",
      lastServiceKm: selectedVehicle.lastServiceKm !== undefined ? String(selectedVehicle.lastServiceKm) : "",
    });

    setServiceHistoryDraft({
      date: todayIso(),
      km: selectedVehicle.currentKm !== undefined ? String(selectedVehicle.currentKm) : "",
      serviceType: "general",
      customServiceType: "",
      cost: "",
      provider: "",
      note: "",
    });

    setKmUpdateDraft({
      date: todayIso(),
      km: selectedVehicle.currentKm !== undefined ? String(selectedVehicle.currentKm) : "",
      note: "",
    });

    setIsVehicleDetailsEditing(false);
  }, [selectedVehicle, ownerOptions]);

  useEffect(() => {
    if (selectedVehicle) return;
    if (enrichedVehicles[0]) setSelectedId(enrichedVehicles[0].id);
  }, [selectedVehicle, enrichedVehicles]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hydrated) return;

    setDocumentsByVehicle((prev) => {
      const next = { ...prev };

      vehicles.forEach((vehicle) => {
        const idKey = String(vehicle.id);
        if (!next[idKey]) {
          next[idKey] = createDefaultVehicleDocCollections(
            vehicle.insuranceExpiry,
            vehicle.inspectionExpiry
          );
        } else {
          const insuranceArr = Array.isArray(next[idKey].insurance) ? next[idKey].insurance : [];
          const inspectionArr = Array.isArray(next[idKey].inspection) ? next[idKey].inspection : [];

          if (insuranceArr.length > 0 && !insuranceArr[0].expiry) {
            insuranceArr[0].expiry = vehicle.insuranceExpiry || "";
          }
          if (inspectionArr.length > 0 && !inspectionArr[0].expiry) {
            inspectionArr[0].expiry = vehicle.inspectionExpiry || "";
          }
        }
      });

      Object.keys(next).forEach((idKey) => {
        const exists = vehicles.some((vehicle) => String(vehicle.id) === idKey);
        if (!exists) delete next[idKey];
      });

      return next;
    });
  }, [vehicles, hydrated]);

  const navButtonClass = (page) =>
    `rounded-2xl border px-4 py-2 text-sm font-semibold transition-all duration-200 ${
      activePage === page
        ? "border-cyan-300/40 bg-cyan-300/16 text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.18)]"
        : "border-white/8 bg-white/8 text-slate-200 hover:border-cyan-400/22 hover:bg-cyan-400/10 hover:text-white"
    }`;

  const lockedInputClass =
    "rounded-2xl border-white/10 bg-slate-900/70 text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-slate-950/80 disabled:text-slate-400 disabled:shadow-inner";

  const insuranceStatus = selectedVehicle
    ? getExpiryStatus(selectedVehicle.insuranceExpiry)
    : null;

  const inspectionStatus = selectedVehicle
    ? getExpiryStatus(selectedVehicle.inspectionExpiry)
    : null;

  const selectedVehicleDocs = selectedVehicle
    ? documentsByVehicle[String(selectedVehicle.id)] ||
      createDefaultVehicleDocCollections(
        selectedVehicle.insuranceExpiry,
        selectedVehicle.inspectionExpiry
      )
    : null;

  const safePage = PAGE_KEYS.includes(activePage) ? activePage : normalizeLegacyPage(activePage);

  const vehiclesForCsv = useMemo(() => {
    return exportIncludeArchived ? vehicles : activeVehicles;
  }, [exportIncludeArchived, vehicles, activeVehicles]);

  const showToast = (message, type = "success") => {
    setToast({
      id: Date.now(),
      message,
      type,
    });
  };

  const showSaved = (message) => {
    showToast(message, "success");
  };

  const formatFileSize = (size) => {
    if (!size) return "-";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  };

  const triggerDocumentPicker = (vehicleId, docKey) => {
    const refKey = `${vehicleId}-${docKey}`;
    fileInputRefs.current[refKey]?.click();
  };

  const handleFileUpload = async (vehicleId, docKey, file) => {
    if (!file) return;

    const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
    const maxBytes = 2.5 * 1024 * 1024;

    if (!allowedTypes.includes(file.type)) {
      showToast("Csak PDF, JPG vagy PNG tölthető fel", "error");
      return;
    }

    if (file.size > maxBytes) {
      showToast("A fájl túl nagy. Maximum 2.5 MB lehet", "error");
      return;
    }

    const idKey = String(vehicleId);
    const vehicleRow = vehicles.find((v) => String(v.id) === idKey) || null;
    const defaultCollections = createDefaultVehicleDocCollections(
      vehicleRow?.insuranceExpiry || "",
      vehicleRow?.inspectionExpiry || ""
    );

    const currentVehicleDocs = documentsByVehicle[idKey] || defaultCollections;
    const categoryDocs = Array.isArray(currentVehicleDocs?.[docKey]) ? currentVehicleDocs[docKey] : [];
    const fallbackDraft = categoryDocs.find((d) => !d?.uploaded) || null;
    const latestUploaded = [...categoryDocs]
      .filter((d) => d?.uploaded)
      .sort((a, b) => String(b?.uploadedAt || "").localeCompare(String(a?.uploadedAt || "")))[0];
    const defaultMeta =
      fallbackDraft ||
      latestUploaded ||
      defaultCollections?.[docKey]?.[0] ||
      { title: docKey, uploaded: false, expiry: "", note: "" };

    const uploadedAt = todayIso();

    if (session?.user?.id) {
      try {
        const storagePath = buildDocumentStoragePath({
          userId: session.user.id,
          vehicleId,
          docKey,
          fileName: file.name,
        });

        const { error: uploadError } = await supabase.storage
          .from(DOCUMENT_STORAGE_BUCKET)
          .upload(storagePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || undefined,
          });

        if (uploadError) {
          console.error("vehicle-documents storage upload error:", uploadError);
          showToast("A fájl feltöltése nem sikerült", "error");
          return;
        }

        const { data: publicUrlData } = supabase.storage
          .from(DOCUMENT_STORAGE_BUCKET)
          .getPublicUrl(storagePath);

        const publicUrl = publicUrlData?.publicUrl || "";

        const payload = {
          user_id: session.user.id,
          vehicle_id: vehicleId,
          doc_key: docKey,
          title: defaultMeta.title || "",
          uploaded: true,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          file_url: publicUrl,
          uploaded_at: uploadedAt || null,
          expiry: defaultMeta.expiry || null,
          note: defaultMeta.note || "",
        };

        const { data: insertedRows, error: insertError } = await supabase
          .from("vehicle_documents")
          .insert(payload)
          .select("*")
          .limit(1);

        if (insertError) {
          await supabase.storage.from(DOCUMENT_STORAGE_BUCKET).remove([storagePath]);
          console.error("vehicle_documents insert error:", insertError);
          const message = String(insertError?.message || "").toLowerCase();
          const looksLikeDuplicateConstraint =
            message.includes("duplicate") || message.includes("unique") || message.includes("conflict");

          showToast(
            looksLikeDuplicateConstraint
              ? "A dokumentum nem menthető több fájlként. Ellenőrizd a vehicle_documents tábla egyedi korlátozásait."
              : "A dokumentum mentése nem sikerült",
            "error"
          );
          return;
        }

        const insertedRow = insertedRows?.[0];
        const mappedDoc = {
          id: insertedRow?.id,
          title: insertedRow?.title || defaultMeta.title || "",
          uploaded: Boolean(insertedRow?.uploaded),
          fileName: insertedRow?.file_name || file.name || "",
          fileType: insertedRow?.file_type || file.type || "",
          fileSize: Number(insertedRow?.file_size || file.size || 0),
          fileDataUrl: insertedRow?.file_url || publicUrl || "",
          uploadedAt: insertedRow?.uploaded_at || uploadedAt || "",
          expiry: insertedRow?.expiry || defaultMeta.expiry || "",
          note: insertedRow?.note || defaultMeta.note || "",
        };

        setDocumentsByVehicle((prev) => {
          const nextState = { ...prev };
          const current = nextState[idKey] || defaultCollections;
          const existingArr = Array.isArray(current?.[docKey]) ? current[docKey] : [];
          const nextUploadedDocs = existingArr.filter((doc) => doc?.uploaded);
          return {
            ...nextState,
            [idKey]: {
              ...current,
              [docKey]: [...nextUploadedDocs, mappedDoc],
            },
          };
        });

        showSaved("Dokumentum feltöltve");
        return;
      } catch (error) {
        console.error("handleFileUpload error:", error);
        showToast("A dokumentum mentése nem sikerült", "error");
        return;
      }
    }

    const reader = new FileReader();
    reader.onload = () => {
      const fileDataUrl = typeof reader.result === "string" ? reader.result : "";
      const uploadedCandidate = {
        id: `temp-${Date.now()}`,
        ...defaultMeta,
        uploaded: true,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        fileDataUrl,
        uploadedAt,
      };

      setDocumentsByVehicle((prev) => {
        const current = prev[idKey] || defaultCollections;
        const existingArr = Array.isArray(current?.[docKey]) ? current[docKey] : [];
        return {
          ...prev,
          [idKey]: {
            ...current,
            [docKey]: [...existingArr, uploadedCandidate],
          },
        };
      });

      showSaved("Dokumentum feltöltve");
    };

    reader.onerror = () => {
      showToast("Nem sikerült beolvasni a fájlt", "error");
    };

    reader.readAsDataURL(file);
  };

  const isPreviewableImage = (doc) => {
    const type = doc?.fileType?.toLowerCase?.() || "";
    const name = doc?.fileName?.toLowerCase?.() || "";
    return (
      type.startsWith("image/") ||
      name.endsWith(".png") ||
      name.endsWith(".jpg") ||
      name.endsWith(".jpeg") ||
      name.endsWith(".webp") ||
      name.endsWith(".gif")
    );
  };

  const isPreviewablePdf = (doc) => {
    const type = doc?.fileType?.toLowerCase?.() || "";
    const name = doc?.fileName?.toLowerCase?.() || "";
    return type === "application/pdf" || name.endsWith(".pdf");
  };

  const dataUrlToBlob = (dataUrl) => {
    if (!dataUrl || typeof dataUrl !== "string") return null;

    const parts = dataUrl.split(",");
    if (parts.length < 2) return null;

    const mimeMatch = parts[0].match(/data:(.*?);base64/);
    const mimeType = mimeMatch?.[1] || "application/octet-stream";
    const byteString = window.atob(parts[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);

    for (let i = 0; i < byteString.length; i += 1) {
      uint8Array[i] = byteString.charCodeAt(i);
    }

    return new Blob([uint8Array], { type: mimeType });
  };

  const openPdfInNewWindow = (doc) => {
    const fileUrl = doc?.fileDataUrl || "";

    if (!fileUrl) {
      showToast("A PDF nem nyitható meg", "error");
      return;
    }

    if (!isDataUrl(fileUrl)) {
      const newTab = window.open(fileUrl, "_blank", "noopener,noreferrer");
      if (!newTab) {
        showToast("A böngésző blokkolta az új ablakot", "error");
      }
      return;
    }

    const blob = dataUrlToBlob(fileUrl);
    if (!blob) {
      showToast("A PDF nem nyitható meg", "error");
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const newTab = window.open(blobUrl, "_blank", "noopener,noreferrer");

    if (!newTab) {
      URL.revokeObjectURL(blobUrl);
      showToast("A böngésző blokkolta az új ablakot", "error");
      return;
    }

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  };

  const openStoredDocument = (doc) => {
    if (!doc?.fileDataUrl) {
      showToast("Ehhez a dokumentumhoz nincs megnyitható fájl", "error");
      return;
    }

    if (isPreviewablePdf(doc)) {
      openPdfInNewWindow(doc);
      return;
    }

    setDocumentPreview(doc);
  };

  const downloadStoredDocument = async (doc) => {
    if (!doc?.fileDataUrl) {
      showToast("Ehhez a dokumentumhoz nincs letölthető fájl", "error");
      return;
    }

    try {
      if (isDataUrl(doc.fileDataUrl)) {
        const link = document.createElement("a");
        link.href = doc.fileDataUrl;
        link.download = doc.fileName || "dokumentum";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

      const response = await fetch(doc.fileDataUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = doc.fileName || "dokumentum";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error("downloadStoredDocument error:", error);
      showToast("A dokumentum letöltése nem sikerült", "error");
    }
  };

  const handleAcknowledgeNotification = (id) => {
    setAcknowledgedNotifications((prev) => ({
      ...prev,
      [id]: true,
    }));
  };

  const handleDismissNotification = (id) => {
    setDismissedNotifications((prev) => ({
      ...prev,
      [id]: true,
    }));
  };



const computeVehicleHealthIndex = (vehicle) => {
  const insuranceStatus = getExpiryStatus(vehicle.insuranceExpiry);
  const inspectionStatus = getExpiryStatus(vehicle.inspectionExpiry);
  const docs =
    documentsByVehicle[String(vehicle.id)] ||
    createDefaultVehicleDocCollections(vehicle.insuranceExpiry, vehicle.inspectionExpiry);
  const missingDocs = Object.values(docs || {}).filter((docVal) => {
    const docsArr = Array.isArray(docVal) ? docVal : [docVal];
    return !docsArr.some((d) => d?.uploaded);
  }).length;

  const oilStatus = getCustomServiceCycleStatus(
    vehicle,
    OIL_SERVICE_LABEL,
    vehicle?.oilChangeIntervalKm,
    3000
  );
  const timingStatus = getCustomServiceCycleStatus(
    vehicle,
    TIMING_SERVICE_LABEL,
    vehicle?.timingBeltIntervalKm,
    10000
  );

  let score = 100;

  [oilStatus, timingStatus].filter(Boolean).forEach((item) => {
    if (item.status === "late") score -= 22;
    else if (item.status === "warning") score -= 10;
  });

  if (insuranceStatus.status === "late") score -= 15;
  else if (insuranceStatus.status === "warning") score -= 8;

  if (inspectionStatus.status === "late") score -= 15;
  else if (inspectionStatus.status === "warning") score -= 8;

  score -= missingDocs * 6;
  if (!vehicle.driver) score -= 8;

  const serviceRecords = (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
    .map(normalizeServiceHistoryItem)
    .filter((entry) => entry.isServiceRecord);

  if (serviceRecords.length === 0) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
};

  const buildFullJsonExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      vehicles: vehicles.map((vehicle) => ({
        ...vehicle,
        healthIndex: computeVehicleHealthIndex(vehicle),
      })),
      owners: ownerOptions,
      documents: documentsByVehicle,
      emailSettings,
    };

    return {
      content: JSON.stringify(payload, null, 2),
      filename: `fleet-backup-${todayIso()}.json`,
      mimeType: "application/json;charset=utf-8",
    };
  };

  const buildVehiclesCsvExport = () => {
    const rows = [
      [
        "Név",
        "Rendszám",
        "Sofőr",
        "Évjárat",
        "Alvázszám",
        "Üzemanyag",
        "Jelenlegi km",
        "Előző szerviz km",
        "Következő szerviz km",
        "Hátralévő km",
        "Szerviz státusz",
        "Biztosítás lejárat",
        "Műszaki lejárat",
        "Megjegyzés",
        "Archivált",
      ],
      ...vehiclesForCsv.map((vehicle) => {
        const enriched = computeVehicle(vehicle);
        return [
          vehicle.name,
          vehicle.plate,
          vehicle.driver || "",
          vehicle.year || "",
          vehicle.vin || "",
          vehicle.fuelType || "",
          vehicle.currentKm,
          vehicle.lastServiceKm,
          enriched.nextServiceKm,
          enriched.remainingKm,
          enriched.status,
          vehicle.insuranceExpiry || "",
          vehicle.inspectionExpiry || "",
          vehicle.note || "",
          vehicle.archived ? "Igen" : "Nem",
        ];
      }),
    ];

    return {
      content: rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
      filename: `fleet-jarmuvek-${todayIso()}.csv`,
      mimeType: "text/csv;charset=utf-8",
    };
  };

  const buildDocumentsCsvExport = () => {
    const rows = [
      [
        "Jármű neve",
        "Rendszám",
        "Dokumentum típusa",
        "Feltöltve",
        "Fájlnév",
        "Feltöltés dátuma",
        "Lejárat",
        "Státusz",
        "Megjegyzés",
        "Archivált",
      ],
    ];

    vehiclesForCsv.forEach((vehicle) => {
      const vehicleDocs =
        documentsByVehicle[String(vehicle.id)] ||
        createDefaultVehicleDocCollections(vehicle.insuranceExpiry, vehicle.inspectionExpiry);

      Object.values(vehicleDocs).forEach((docValue) => {
        const docsArr = Array.isArray(docValue) ? docValue : [docValue];
        docsArr.forEach((doc) => {
          const docStatus = getDocUploadStatus(doc);
          rows.push([
            vehicle.name,
            vehicle.plate,
            doc.title,
            doc.uploaded ? "Igen" : "Nem",
            doc.fileName || "",
            doc.uploadedAt || "",
            doc.expiry || "",
            docStatus.label,
            doc.note || "",
            vehicle.archived ? "Igen" : "Nem",
          ]);
        });
      });
    });

    return {
      content: rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
      filename: `fleet-dokumentumok-${todayIso()}.csv`,
      mimeType: "text/csv;charset=utf-8",
    };
  };



const buildServiceHistoryCsvExport = () => {
  const rows = [[
    "Jármű neve",
    "Rendszám",
    "Dátum",
    "Típus",
    "Megnevezés",
    "Km",
    "Költség",
    "Partner",
    "Megjegyzés",
    "Archivált",
  ]];

  vehiclesForCsv.forEach((vehicle) => {
    (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
      .map(normalizeServiceHistoryItem)
      .filter((entry) => entry.isServiceRecord)
      .forEach((entry) => {
        rows.push([
          vehicle.name,
          vehicle.plate,
          entry.date || "",
          entry.serviceType || "",
          entry.title || "",
          entry.km ?? "",
          entry.cost ?? 0,
          entry.provider || "",
          entry.note || "",
          vehicle.archived ? "Igen" : "Nem",
        ]);
      });
  });

  return {
    content: rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
    filename: `fleet-szerviz-history-${todayIso()}.csv`,
    mimeType: "text/csv;charset=utf-8",
  };
};

const buildHealthCsvExport = () => {
  const rows = [[
    "Jármű neve",
    "Rendszám",
    "Sofőr",
    "Állapotindex",
    "Olajcsere státusz",
    "Vezérlés státusz",
    "Biztosítás státusz",
    "Műszaki státusz",
    "Hiányzó dokumentumok",
    "Archivált",
  ]];

  vehiclesForCsv.forEach((vehicle) => {
    const oilStatus = getCustomServiceCycleStatus(
      vehicle,
      OIL_SERVICE_LABEL,
      vehicle?.oilChangeIntervalKm,
      3000
    );
    const timingStatus = getCustomServiceCycleStatus(
      vehicle,
      TIMING_SERVICE_LABEL,
      vehicle?.timingBeltIntervalKm,
      10000
    );
    const insuranceStatus = getExpiryStatus(vehicle.insuranceExpiry);
    const inspectionStatus = getExpiryStatus(vehicle.inspectionExpiry);
    const docs =
      documentsByVehicle[String(vehicle.id)] ||
      createDefaultVehicleDocCollections(vehicle.insuranceExpiry, vehicle.inspectionExpiry);
    const missingDocs = Object.values(docs || {}).filter((docVal) => {
      const docsArr = Array.isArray(docVal) ? docVal : [docVal];
      return !docsArr.some((d) => d?.uploaded);
    }).length;

    rows.push([
      vehicle.name,
      vehicle.plate,
      vehicle.driver || "",
      computeVehicleHealthIndex(vehicle),
      oilStatus?.status || "nincs",
      timingStatus?.status || "nincs",
      insuranceStatus.status,
      inspectionStatus.status,
      missingDocs,
      vehicle.archived ? "Igen" : "Nem",
    ]);
  });

  return {
    content: rows.map((row) => row.map(csvEscape).join(",")).join("\n"),
    filename: `fleet-allapotindex-${todayIso()}.csv`,
    mimeType: "text/csv;charset=utf-8",
  };
};

  const toggleExportOption = (key) => {
    setExportOptions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleExportDownload = () => {
    const selectedExports = [];

    if (exportOptions.fullJson) {
      selectedExports.push(buildFullJsonExport());
    }

    if (exportOptions.vehiclesCsv) {
      selectedExports.push(buildVehiclesCsvExport());
    }

    if (exportOptions.documentsCsv) {
      selectedExports.push(buildDocumentsCsvExport());
    }

    if (exportOptions.serviceHistoryCsv) {
      selectedExports.push(buildServiceHistoryCsvExport());
    }

    if (exportOptions.healthCsv) {
      selectedExports.push(buildHealthCsvExport());
    }

    if (selectedExports.length === 0) {
      showSaved("Válassz ki legalább egy export típust");
      return;
    }

    selectedExports.forEach((item, index) => {
      setTimeout(() => {
        downloadFile(item.content, item.filename, item.mimeType);
      }, index * 180);
    });

    setExportOpen(false);
    showSaved(
      selectedExports.length === 1
        ? "Export elkészült"
        : `${selectedExports.length} export fájl letöltve`
    );
  };

  const saveVehicleDetails = async () => {
    const resolvedOwner = resolveOwnerValue(
      vehicleDetailsForm.ownerMode,
      vehicleDetailsForm.customOwner
    );

    if (!vehicleDetailsForm.name.trim() || !vehicleDetailsForm.plate.trim()) {
      showToast("A jármű neve és a rendszám kötelező", "error");
      return;
    }

    if (!selectedId || !session?.user?.id) {
      showToast("Nincs aktív bejelentkezett felhasználó", "error");
      return;
    }

    if (resolvedOwner && !ownerOptions.includes(resolvedOwner)) {
      setOwnerOptions((prev) => [...prev, resolvedOwner]);
    }

    const vehiclePayload = {
      name: vehicleDetailsForm.name.trim(),
      plate: vehicleDetailsForm.plate.toUpperCase().trim(),
      driver: resolvedOwner,
      note: vehicleDetailsForm.note || "",
      year: vehicleDetailsForm.year || null,
      vin: (vehicleDetailsForm.vin || "").toUpperCase(),
      fuelType: vehicleDetailsForm.fuelType || "Benzin",
      insuranceExpiry: vehicleDetailsForm.insuranceExpiry || null,
      inspectionExpiry: vehicleDetailsForm.inspectionExpiry || null,
      oilChangeIntervalKm:
        vehicleDetailsForm.oilChangeIntervalKm === ""
          ? null
          : Number(vehicleDetailsForm.oilChangeIntervalKm),
      timingBeltIntervalKm:
        vehicleDetailsForm.timingBeltIntervalKm === ""
          ? null
          : Number(vehicleDetailsForm.timingBeltIntervalKm),
    };

    const insuranceExpiryValue = vehicleDetailsForm.insuranceExpiry || "";
    const inspectionExpiryValue = vehicleDetailsForm.inspectionExpiry || "";

    try {
      const { error: vehicleError } = await supabase
        .from("vehicles")
        .update(vehiclePayload)
        .eq("id", selectedId)
        .eq("user_id", session.user.id);

      if (vehicleError) {
        console.error("Vehicle update error:", serializeSupabaseError(vehicleError), vehicleError);
        showToast("Nem sikerült menteni a jármű adatait", "error");
        return;
      }

      const { error: insuranceExpiryError } = await supabase
        .from("vehicle_documents")
        .update({ expiry: insuranceExpiryValue || null })
        .eq("vehicle_id", selectedId)
        .eq("user_id", session.user.id)
        .eq("doc_key", "insurance");

      if (insuranceExpiryError) {
        console.error("Vehicle document insurance expiry update error:", insuranceExpiryError);
        showToast("A dokumentum metaadatok mentése nem sikerült", "error");
        return;
      }

      const { error: inspectionExpiryError } = await supabase
        .from("vehicle_documents")
        .update({ expiry: inspectionExpiryValue || null })
        .eq("vehicle_id", selectedId)
        .eq("user_id", session.user.id)
        .eq("doc_key", "inspection");

      if (inspectionExpiryError) {
        console.error("Vehicle document inspection expiry update error:", inspectionExpiryError);
        showToast("A dokumentum metaadatok mentése nem sikerült", "error");
        return;
      }

      setVehicles((prev) =>
        prev.map((v) =>
          v.id === selectedId
            ? {
                ...v,
                name: vehicleDetailsForm.name.trim(),
                plate: vehicleDetailsForm.plate.toUpperCase().trim(),
                driver: resolvedOwner,
                note: vehicleDetailsForm.note,
                year: vehicleDetailsForm.year,
                vin: vehicleDetailsForm.vin.toUpperCase(),
                fuelType: vehicleDetailsForm.fuelType,
                insuranceExpiry: vehicleDetailsForm.insuranceExpiry,
                inspectionExpiry: vehicleDetailsForm.inspectionExpiry,
                oilChangeIntervalKm:
                  vehicleDetailsForm.oilChangeIntervalKm === ""
                    ? ""
                    : Number(vehicleDetailsForm.oilChangeIntervalKm),
                timingBeltIntervalKm:
                  vehicleDetailsForm.timingBeltIntervalKm === ""
                    ? ""
                    : Number(vehicleDetailsForm.timingBeltIntervalKm),
              }
            : v
        )
      );

      setDocumentsByVehicle((prev) => {
        const idKey = String(selectedId);
        const current = prev[idKey] || createDefaultVehicleDocCollections(insuranceExpiryValue, inspectionExpiryValue);
        return {
          ...prev,
          [idKey]: {
            ...current,
            insurance: (Array.isArray(current.insurance) ? current.insurance : []).map((d) => ({
              ...d,
              expiry: insuranceExpiryValue,
            })),
            inspection: (Array.isArray(current.inspection) ? current.inspection : []).map((d) => ({
              ...d,
              expiry: inspectionExpiryValue,
            })),
          },
        };
      });

      setIsVehicleDetailsEditing(false);
      showSaved("Adatok mentve");
    } catch (error) {
      console.error("saveVehicleDetails error:", error);
      showToast("Nem sikerült menteni a jármű adatait", "error");
    }
  };

  const startVehicleDetailsEditing = () => {
    if (!selectedVehicle) return;

    const ownerState = getOwnerModeAndCustom(selectedVehicle.driver, ownerOptions);

    setVehicleDetailsForm({
      name: selectedVehicle.name || "",
      plate: selectedVehicle.plate || "",
      ownerMode: ownerState.ownerMode,
      customOwner: ownerState.customOwner,
      note: selectedVehicle.note || "",
      year: selectedVehicle.year || "",
      vin: selectedVehicle.vin || "",
      fuelType: selectedVehicle.fuelType || "Benzin",
      insuranceExpiry: selectedVehicle.insuranceExpiry || "",
      inspectionExpiry: selectedVehicle.inspectionExpiry || "",
      oilChangeIntervalKm:
        selectedVehicle.oilChangeIntervalKm !== undefined && selectedVehicle.oilChangeIntervalKm !== null
          ? String(selectedVehicle.oilChangeIntervalKm)
          : "",
      timingBeltIntervalKm:
        selectedVehicle.timingBeltIntervalKm !== undefined && selectedVehicle.timingBeltIntervalKm !== null
          ? String(selectedVehicle.timingBeltIntervalKm)
          : "",
    });

    setIsVehicleDetailsEditing(true);
  };

  const cancelVehicleDetailsEditing = () => {
    if (!selectedVehicle) return;

    const ownerState = getOwnerModeAndCustom(selectedVehicle.driver, ownerOptions);

    setVehicleDetailsForm({
      name: selectedVehicle.name || "",
      plate: selectedVehicle.plate || "",
      ownerMode: ownerState.ownerMode,
      customOwner: ownerState.customOwner,
      note: selectedVehicle.note || "",
      year: selectedVehicle.year || "",
      vin: selectedVehicle.vin || "",
      fuelType: selectedVehicle.fuelType || "Benzin",
      insuranceExpiry: selectedVehicle.insuranceExpiry || "",
      inspectionExpiry: selectedVehicle.inspectionExpiry || "",
      oilChangeIntervalKm:
        selectedVehicle.oilChangeIntervalKm !== undefined && selectedVehicle.oilChangeIntervalKm !== null
          ? String(selectedVehicle.oilChangeIntervalKm)
          : "",
      timingBeltIntervalKm:
        selectedVehicle.timingBeltIntervalKm !== undefined && selectedVehicle.timingBeltIntervalKm !== null
          ? String(selectedVehicle.timingBeltIntervalKm)
          : "",
    });

    setIsVehicleDetailsEditing(false);
  };



  const addServiceHistoryEntry = async () => {
    if (!selectedVehicle || !session?.user?.id) return;

    const kmValue =
      serviceHistoryDraft.km === ""
        ? selectedVehicle.currentKm || 0
        : Number.isNaN(Number(serviceHistoryDraft.km))
        ? selectedVehicle.currentKm || 0
        : Number(serviceHistoryDraft.km);

    const costValue =
      serviceHistoryDraft.cost === ""
        ? 0
        : Number.isNaN(Number(serviceHistoryDraft.cost))
        ? 0
        : Number(serviceHistoryDraft.cost);

    const resolvedServiceType = resolveServiceHistoryType(serviceHistoryDraft);

    if (!serviceHistoryDraft.date || !resolvedServiceType) {
      showToast("Dátum és szerviz típus megadása kötelező", "error");
      return;
    }

    try {
      const { data: insertedServiceRows, error: serviceInsertError } = await supabase
        .from("service_history")
        .insert({
          user_id: session.user.id,
          vehicle_id: selectedId,
          entry_date: serviceHistoryDraft.date,
          km: kmValue,
          service_type: resolvedServiceType,
          cost: costValue,
          provider: serviceHistoryDraft.provider.trim(),
          note: serviceHistoryDraft.note.trim(),
          title: resolvedServiceType,
        })
        .select("*")
        .limit(1);

      if (serviceInsertError) {
        console.error("service_history insert error:", serializeSupabaseError(serviceInsertError), serviceInsertError);
        showToast("A szerviz bejegyzést nem sikerült menteni", "error");
        return;
      }

      const insertedServiceRow = insertedServiceRows?.[0];
      const newEntry = insertedServiceRow ? mapSupabaseServiceRow(insertedServiceRow) : createServiceRecordEntry({
        date: serviceHistoryDraft.date,
        serviceType: resolvedServiceType,
        km: kmValue,
        cost: costValue,
        provider: serviceHistoryDraft.provider.trim(),
        note: serviceHistoryDraft.note.trim(),
      });

      const nextCurrentKm = Math.max(Number(selectedVehicle.currentKm || 0), kmValue);

      const { error: vehicleUpdateError } = await supabase
        .from("vehicles")
        .update({
          currentKm: nextCurrentKm,
          lastServiceKm: kmValue,
        })
        .eq("id", selectedId)
        .eq("user_id", session.user.id);

      if (vehicleUpdateError) {
        console.error("vehicles update after service_history error:", vehicleUpdateError);
        showToast("A jármű km adatait nem sikerült frissíteni", "error");
        return;
      }

      setVehicles((prev) =>
        prev.map((vehicle) => {
          if (vehicle.id !== selectedId) return vehicle;

          const recalculated = deriveVehicleKmStateFromHistory(vehicle, [
            newEntry,
            ...(Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : []),
          ]);

          return {
            ...vehicle,
            currentKm: Math.max(Number(recalculated.currentKm || 0), nextCurrentKm),
            lastServiceKm: Number(recalculated.lastServiceKm || kmValue),
            serviceHistory: recalculated.serviceHistory,
          };
        })
      );

      setServiceDraft({
        currentKm: String(nextCurrentKm),
        lastServiceKm: String(kmValue),
      });

      setServiceHistoryDraft({
        date: todayIso(),
        km: String(nextCurrentKm),
        serviceType: "general",
        customServiceType: "",
        cost: "",
        provider: "",
        note: "",
      });

      showSaved("Szerviz bejegyzés hozzáadva");
    } catch (error) {
      console.error("addServiceHistoryEntry error:", error);
      showToast("A szerviz bejegyzést nem sikerült menteni", "error");
    }
  };



const handleKmUpdate = async () => {
  if (!selectedVehicle || !session?.user?.id) return;

  const kmValue = Number(kmUpdateDraft.km);
  if (!kmUpdateDraft.date || Number.isNaN(kmValue) || kmValue <= 0) {
    showToast("Dátum és érvényes km óraállás megadása kötelező", "error");
    return;
  }

  try {
    const { data: insertedKmRows, error: kmInsertError } = await supabase
      .from("km_logs")
      .insert({
        user_id: session.user.id,
        vehicle_id: selectedId,
        entry_date: kmUpdateDraft.date,
        km: kmValue,
        note: kmUpdateDraft.note.trim(),
      })
      .select("*")
      .limit(1);

    if (kmInsertError) {
      console.error("km_logs insert error:", serializeSupabaseError(kmInsertError), kmInsertError);
      showToast("A km frissítést nem sikerült menteni", "error");
      return;
    }

    const insertedKmRow = insertedKmRows?.[0];
    const newEntry = insertedKmRow ? mapSupabaseKmRow(insertedKmRow) : createKmUpdateEntry({
      date: kmUpdateDraft.date,
      km: kmValue,
      note: kmUpdateDraft.note.trim(),
    });

    const { error: vehicleUpdateError } = await supabase
      .from("vehicles")
      .update({
        currentKm: kmValue,
      })
      .eq("id", selectedId)
      .eq("user_id", session.user.id);

    if (vehicleUpdateError) {
      console.error("vehicles update after km_logs error:", vehicleUpdateError);
      showToast("A jármű km adatait nem sikerült frissíteni", "error");
      return;
    }

    setVehicles((prev) =>
      prev.map((vehicle) => {
        if (vehicle.id !== selectedId) return vehicle;

        const recalculated = deriveVehicleKmStateFromHistory(vehicle, [
          newEntry,
          ...(Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : []),
        ]);

        return {
          ...vehicle,
          currentKm: Number(recalculated.currentKm || kmValue),
          lastServiceKm: Number(recalculated.lastServiceKm || vehicle.lastServiceKm || 0),
          serviceHistory: recalculated.serviceHistory,
        };
      })
    );

    setServiceDraft((prev) => ({
      ...prev,
      currentKm: String(kmValue),
    }));

    setKmUpdateDraft({
      date: todayIso(),
      km: "",
      note: "",
    });

    showSaved("Km frissítés mentve");
  } catch (error) {
    console.error("handleKmUpdate error:", error);
    showToast("A km frissítést nem sikerült menteni", "error");
  }
};



  const removeServiceHistoryEntry = async (entryId) => {
    if (!selectedVehicle || !session?.user?.id) return;

    const entryToRemove = (Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])
      .map(normalizeServiceHistoryItem)
      .find((entry) => entry.id === entryId);

    if (!entryToRemove) {
      showToast("A törlendő bejegyzés nem található", "error");
      return;
    }

    try {
      // "Kiinduló állapot" is a derived baseline (not stored in Supabase tables).
      // It should remain visible and counted, so we disallow deletion.
      if (entryToRemove.type === "baseline") {
        showToast("A kiinduló állapot nem törölhető", "error");
        return;
      }

      const targetTable = entryToRemove.isServiceRecord ? "service_history" : "km_logs";
      const { error } = await supabase
        .from(targetTable)
        .delete()
        .eq("id", entryId)
        .eq("user_id", session.user.id);

      if (error) {
        console.error(`${targetTable} delete error:`, error);
        showToast("Nem sikerült törölni a bejegyzést", "error");
        return;
      }

      const remainingHistory = (Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])
        .map(normalizeServiceHistoryItem)
        .filter((entry) => entry.id !== entryId);

      const recalculated = deriveVehicleKmStateFromHistory(selectedVehicle, remainingHistory);

      const { error: vehicleRecalcError } = await supabase
        .from("vehicles")
        .update({
          currentKm: Number(recalculated.currentKm || 0),
          lastServiceKm: Number(recalculated.lastServiceKm || 0),
        })
        .eq("id", selectedId)
        .eq("user_id", session.user.id);

      if (vehicleRecalcError) {
        console.error("vehicles recalc after history delete error:", serializeSupabaseError(vehicleRecalcError), vehicleRecalcError);
        showToast("A jármű km adatait nem sikerült újraszámolni", "error");
        return;
      }

      setVehicles((prev) =>
        prev.map((vehicle) =>
          vehicle.id === selectedId
            ? {
                ...vehicle,
                currentKm: Number(recalculated.currentKm || 0),
                lastServiceKm: Number(recalculated.lastServiceKm || 0),
                serviceHistory: recalculated.serviceHistory,
              }
            : vehicle
        )
      );

      setServiceDraft({
        currentKm: String(Number(recalculated.currentKm || 0)),
        lastServiceKm: String(Number(recalculated.lastServiceKm || 0)),
      });

      setServiceHistoryDraft((prev) => ({
        ...prev,
        km: String(Number(recalculated.currentKm || 0)),
      }));

      setKmUpdateDraft((prev) => ({
        ...prev,
        km: String(Number(recalculated.currentKm || 0)),
      }));

      showSaved("Bejegyzés törölve");
    } catch (error) {
      console.error("removeServiceHistoryEntry error:", error);
      showToast("Nem sikerült törölni a bejegyzést", "error");
    }
  };

  const addOwnerOption = () => {
    const value = ownerManagerValue.trim();
    if (!value) return;
    if (ownerOptions.includes(value)) {
      setOwnerManagerValue("");
      return;
    }

    setOwnerOptions((prev) => [...prev, value]);
    setOwnerManagerValue("");
    showSaved("Sofőr hozzáadva");
  };

  const deleteOwner = () => {
    if (!ownerToDelete) return;

    setOwnerOptions((prev) => prev.filter((owner) => owner !== ownerToDelete));

    setVehicles((prev) =>
      prev.map((vehicle) =>
        vehicle.driver === ownerToDelete
          ? {
              ...vehicle,
              driver: "",
            }
          : vehicle
      )
    );

    setOwnerToDelete(null);
    showSaved("Sofőr törölve");
  };

  const addVehicle = async () => {
    const resolvedOwner = resolveOwnerValue(form.ownerMode, form.customOwner);

    if (!form.name || !form.plate || !form.currentKm || !form.lastServiceKm) {
      showToast("A név, rendszám és km mezők kötelezők", "error");
      return;
    }

    if (!session?.user?.id) {
      showToast("Nincs aktív bejelentkezett felhasználó", "error");
      return;
    }

    if (resolvedOwner && !ownerOptions.includes(resolvedOwner)) {
      setOwnerOptions((prev) => [...prev, resolvedOwner]);
    }

    const vehicleInsertPayload = buildVehicleDbPayload(form, resolvedOwner, session.user.id);

    try {
      const { data: insertedRows, error: vehicleInsertError } = await supabase
        .from("vehicles")
        .insert(vehicleInsertPayload)
        .select("*")
        .limit(1);

      if (vehicleInsertError) {
        const serializedError = serializeSupabaseError(vehicleInsertError);
        console.error("vehicles insert error:", serializedError, vehicleInsertError);

        const duplicatePlate =
          serializedError.includes("vehicles_plate_key") ||
          serializedError.includes("vehicles_user_id_plate") ||
          serializedError.includes("duplicate key value");

        showToast(
          duplicatePlate
            ? "Ehhez a felhasználóhoz már létezik ilyen rendszámú jármű"
            : `Az autó mentése nem sikerült: ${serializedError}`,
          "error"
        );
        return;
      }

      const insertedRow = insertedRows?.[0];
      if (!insertedRow?.id) {
        showToast("Az autó létrejött, de az azonosító nem érkezett vissza", "error");
        return;
      }

      const docSeed = createDefaultVehicleDocs(form.insuranceExpiry, form.inspectionExpiry);
      const docSeedCollections = createDefaultVehicleDocCollections(form.insuranceExpiry, form.inspectionExpiry);

      const documentUpserts = Object.entries(docSeed).map(([docKey, doc]) => ({
        user_id: session.user.id,
        vehicle_id: insertedRow.id,
        doc_key: docKey,
        title: doc.title || "",
        uploaded: Boolean(doc.uploaded),
        file_name: doc.fileName || "",
        file_type: doc.fileType || "",
        file_size: Number(doc.fileSize || 0),
        file_url: doc.fileDataUrl || "",
        uploaded_at: doc.uploadedAt || null,
        expiry: doc.expiry || null,
        note: doc.note || "",
      }));

      if (documentUpserts.length > 0) {
        const { error: docSeedError } = await supabase
          .from("vehicle_documents")
          .insert(documentUpserts);

        if (docSeedError) {
          console.error("vehicle_documents seed error:", serializeSupabaseError(docSeedError), docSeedError);
        }
      }

      const hydratedInsertedRow = {
        ...insertedRow,
      driver: insertedRow?.driver ?? insertedRow?.owner ?? resolvedOwner,
        note: insertedRow?.note ?? (form.note || ""),
        year: insertedRow?.year ?? (form.year || null),
        vin: insertedRow?.vin ?? ((form.vin || "").toUpperCase()),
        fuelType: insertedRow?.fuelType ?? insertedRow?.fuel_type ?? (form.fuelType || "Benzin"),
        insuranceExpiry: insertedRow?.insuranceExpiry ?? insertedRow?.insurance_expiry ?? (form.insuranceExpiry || null),
        inspectionExpiry: insertedRow?.inspectionExpiry ?? insertedRow?.inspection_expiry ?? (form.inspectionExpiry || null),
        oilChangeIntervalKm:
          insertedRow?.oilChangeIntervalKm ?? insertedRow?.oil_change_interval_km ??
          (form.oilChangeIntervalKm === "" ? null : Number(form.oilChangeIntervalKm)),
        timingBeltIntervalKm:
          insertedRow?.timingBeltIntervalKm ?? insertedRow?.timing_belt_interval_km ??
          (form.timingBeltIntervalKm === "" ? null : Number(form.timingBeltIntervalKm)),
        archived: insertedRow?.archived ?? false,
        status: insertedRow?.status ?? "active",
      };

      const newVehicle = ensureVehicleHistory(mapSupabaseVehicleRow(hydratedInsertedRow));

      setVehicles((prev) => [newVehicle, ...prev]);

      setDocumentsByVehicle((prev) => ({
        ...prev,
        [String(newVehicle.id)]: docSeedCollections,
      }));

      setSelectedId(newVehicle.id);

      setForm({
        name: "",
        plate: "",
        currentKm: "",
        lastServiceKm: "",
        ownerMode: ownerOptions[0] || CUSTOM_OWNER_VALUE,
        customOwner: "",
        note: "",
        year: "",
        vin: "",
        fuelType: "Benzin",
        insuranceExpiry: "",
        inspectionExpiry: "",
        oilChangeIntervalKm: "15000",
        timingBeltIntervalKm: "180000",
      });

      setOpen(false);
      setActivePage("vehicles");
      setIsVehicleDetailsEditing(false);
      showSaved("Új autó felvéve");
    } catch (error) {
      console.error("addVehicle error:", error);
      showToast("Az autó mentése nem sikerült", "error");
    }
  };

  const archiveSelectedVehicle = async () => {
    if (!vehicleToArchive || !session?.user?.id) return;

    try {
      const { error } = await supabase
        .from("vehicles")
        .update({ archived: true })
        .eq("id", vehicleToArchive.id)
        .eq("user_id", session.user.id);

      if (error) {
        console.error("archive vehicle error:", error);
        showToast("A jármű archiválása nem sikerült", "error");
        return;
      }

      setVehicles((prev) =>
        prev.map((vehicle) =>
          vehicle.id === vehicleToArchive.id
            ? {
                ...vehicle,
                archived: true,
              }
            : vehicle
        )
      );

      setVehicleToArchive(null);
      showSaved("Jármű archiválva");
    } catch (error) {
      console.error("archiveSelectedVehicle error:", error);
      showToast("A jármű archiválása nem sikerült", "error");
    }
  };

  const restoreVehicle = async (vehicleId) => {
    if (!session?.user?.id) return;

    try {
      const { error } = await supabase
        .from("vehicles")
        .update({ archived: false })
        .eq("id", vehicleId)
        .eq("user_id", session.user.id);

      if (error) {
        console.error("restore vehicle error:", error);
        showToast("A jármű visszaállítása nem sikerült", "error");
        return;
      }

      setVehicles((prev) =>
        prev.map((vehicle) =>
          vehicle.id === vehicleId
            ? {
                ...vehicle,
                archived: false,
              }
            : vehicle
        )
      );

      setSelectedId(vehicleId);
      showSaved("Jármű visszaállítva");
    } catch (error) {
      console.error("restoreVehicle error:", error);
      showToast("A jármű visszaállítása nem sikerült", "error");
    }
  };

  const deleteVehiclePermanently = async () => {
    if (!vehicleToDelete || !session?.user?.id) return;

    try {
      const vehicleId = vehicleToDelete.id;

      const { error: docsDeleteError } = await supabase
        .from("vehicle_documents")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("user_id", session.user.id);

      if (docsDeleteError) {
        console.error("vehicle_documents delete error:", docsDeleteError);
      }

      const { error: serviceDeleteError } = await supabase
        .from("service_history")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("user_id", session.user.id);

      if (serviceDeleteError) {
        console.error("service_history delete error:", serviceDeleteError);
      }

      const { error: kmDeleteError } = await supabase
        .from("km_logs")
        .delete()
        .eq("vehicle_id", vehicleId)
        .eq("user_id", session.user.id);

      if (kmDeleteError) {
        console.error("km_logs delete error:", kmDeleteError);
      }

      const { error: vehicleDeleteError } = await supabase
        .from("vehicles")
        .delete()
        .eq("id", vehicleId)
        .eq("user_id", session.user.id);

      if (vehicleDeleteError) {
        console.error("vehicles delete error:", vehicleDeleteError);
        showToast("A jármű törlése nem sikerült", "error");
        return;
      }

      setVehicles((prev) => prev.filter((vehicle) => vehicle.id !== vehicleId));

      setDocumentsByVehicle((prev) => {
        const next = { ...prev };
        delete next[String(vehicleId)];
        return next;
      });

      setVehicleToDelete(null);
      showSaved("Jármű véglegesen törölve");
    } catch (error) {
      console.error("deleteVehiclePermanently error:", error);
      showToast("A jármű törlése nem sikerült", "error");
    }
  };

  const updateDocField = async (vehicleId, docKey, field, value, documentId = null) => {
    const idKey = String(vehicleId);
    const vehicleRow = vehicles.find((v) => String(v.id) === idKey) || null;
    const defaultCollections = createDefaultVehicleDocCollections(
      vehicleRow?.insuranceExpiry || "",
      vehicleRow?.inspectionExpiry || ""
    );

    setDocumentsByVehicle((prev) => {
      const current = prev[idKey] || defaultCollections;
      const arr = Array.isArray(current?.[docKey]) ? current[docKey] : [];

      const targetIndex = documentId
        ? arr.findIndex((d) => String(d?.id) === String(documentId))
        : arr.findIndex((d) => !d?.uploaded);

      const targetDoc =
        targetIndex >= 0
          ? arr[targetIndex]
          : defaultCollections?.[docKey]?.[0] || arr[0] || { title: docKey, uploaded: false };

      const nextDoc = {
        ...targetDoc,
        [field]: value,
      };

      const nextArr = [...arr];
      if (targetIndex >= 0) nextArr[targetIndex] = nextDoc;
      else nextArr.push(nextDoc);

      return {
        ...prev,
        [idKey]: {
          ...current,
          [docKey]: nextArr,
        },
      };
    });

    if (!session?.user?.id) return;
    const persistFieldValue = field === "expiry" && value === "" ? null : value;
    const idToPersist = documentId || null;

    try {
      const query = supabase.from("vehicle_documents").update({ [field]: persistFieldValue });

      // If we have the exact DB id, update by id. Otherwise, update the legacy draft slot for that category.
      if (idToPersist) {
        const { error } = await query.eq("id", idToPersist).eq("user_id", session.user.id);

        if (error) {
          console.error("vehicle_documents update error:", error);
          showToast("A dokumentum mező mentése nem sikerült", "error");
        }
      } else {
        const { error } = await query
          .eq("vehicle_id", vehicleId)
          .eq("user_id", session.user.id)
          .eq("doc_key", docKey)
          .eq("uploaded", false);

        if (error) {
          console.error("vehicle_documents draft update error:", error);
          showToast("A dokumentum mező mentése nem sikerült", "error");
        }
      }
    } catch (error) {
      console.error("updateDocField error:", error);
      showToast("A dokumentum mező mentése nem sikerült", "error");
    }
  };

  const removeDocument = async (vehicleId, docKey, documentId = null) => {
    const idKey = String(vehicleId);
    const vehicleRow = vehicles.find((v) => String(v.id) === idKey) || null;
    const defaultCollections = createDefaultVehicleDocCollections(
      vehicleRow?.insuranceExpiry || "",
      vehicleRow?.inspectionExpiry || ""
    );

    const currentVehicleDocs = documentsByVehicle[idKey] || defaultCollections;
    const arr = Array.isArray(currentVehicleDocs?.[docKey]) ? currentVehicleDocs[docKey] : [];
    const targetDoc = documentId ? arr.find((d) => String(d?.id) === String(documentId)) : null;

    if (!targetDoc) {
      showToast("A törlendő dokumentum nem található", "error");
      return;
    }

    const hasOtherDraft = arr.some((d) => !d?.uploaded && String(d?.id) !== String(documentId));
    const hasOtherUploaded = arr.some(
      (d) => d?.uploaded && String(d?.id) !== String(documentId)
    );

    if (session?.user?.id) {
      try {
        const storagePath = getStoragePathFromFileUrl(targetDoc?.fileDataUrl);
        if (storagePath) {
          const { error: storageRemoveError } = await supabase.storage
            .from(DOCUMENT_STORAGE_BUCKET)
            .remove([storagePath]);

          if (storageRemoveError) {
            console.error("vehicle-documents storage remove error:", storageRemoveError);
          }
        }

        if (hasOtherDraft || hasOtherUploaded) {
          // Multi-doc mode: delete the specific file row.
          const { error } = await supabase
            .from("vehicle_documents")
            .delete()
            .eq("id", documentId)
            .eq("user_id", session.user.id);

          if (error) {
            console.error("vehicle_documents delete error:", error);
            showToast("A dokumentum eltávolítása nem sikerült", "error");
            return;
          }

          setDocumentsByVehicle((prev) => {
            const current = prev[idKey] || defaultCollections;
            const currentArr = Array.isArray(current?.[docKey]) ? current[docKey] : [];
            return {
              ...prev,
              [idKey]: {
                ...current,
                [docKey]: currentArr.filter((d) => String(d?.id) !== String(documentId)),
              },
            };
          });
        } else {
          // Unique-slot mode: convert the row back to an empty draft slot.
          const { error } = await supabase
            .from("vehicle_documents")
            .update({
              uploaded: false,
              file_name: "",
              file_type: "",
              file_size: 0,
              file_url: "",
              uploaded_at: null,
            })
            .eq("id", documentId)
            .eq("user_id", session.user.id);

          if (error) {
            console.error("vehicle_documents draft update error:", error);
            showToast("A dokumentum eltávolítása nem sikerült", "error");
            return;
          }

          setDocumentsByVehicle((prev) => {
            const current = prev[idKey] || defaultCollections;
            const currentArr = Array.isArray(current?.[docKey]) ? current[docKey] : [];
            const nextArr = currentArr.map((d) =>
              String(d?.id) === String(documentId)
                ? {
                    ...d,
                    uploaded: false,
                    fileName: "",
                    fileType: "",
                    fileSize: 0,
                    fileDataUrl: "",
                    uploadedAt: "",
                  }
                : d
            );
            return {
              ...prev,
              [idKey]: {
                ...current,
                [docKey]: nextArr,
              },
            };
          });
        }
      } catch (error) {
        console.error("removeDocument error:", error);
        showToast("A dokumentum eltávolítása nem sikerült", "error");
        return;
      }
    } else {
      // Local-only behavior (no session): remove from state.
      setDocumentsByVehicle((prev) => {
        const current = prev[idKey] || defaultCollections;
        const currentArr = Array.isArray(current?.[docKey]) ? current[docKey] : [];
        const nextArr =
          hasOtherDraft || hasOtherUploaded
            ? currentArr.filter((d) => String(d?.id) !== String(documentId))
            : currentArr.map((d) =>
                String(d?.id) === String(documentId)
                  ? {
                      ...d,
                      uploaded: false,
                      fileName: "",
                      fileType: "",
                      fileSize: 0,
                      fileDataUrl: "",
                      uploadedAt: "",
                    }
                  : d
              );
        return {
          ...prev,
          [idKey]: {
            ...current,
            [docKey]: nextArr,
          },
        };
      });
    }

    showSaved("Dokumentum eltávolítva");
  };

  const requestDocumentRemove = (vehicleId, docKey, documentId, docTitle) => {
    setDocumentToRemove({
      vehicleId,
      docKey,
      documentId,
      docTitle,
    });
  };

  const confirmDocumentRemove = () => {
    if (!documentToRemove) return;
    removeDocument(documentToRemove.vehicleId, documentToRemove.docKey, documentToRemove.documentId);
    setDocumentToRemove(null);
  };

  if (!hydrated) {
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto max-w-7xl p-8 text-slate-400">Betöltés...</div>
      </div>
    );
  }

  const handlePasswordLogin = async () => {
    const email = authEmail.trim();
    const password = authPassword;

    if (!email || !password) {
      setToast({
        id: Date.now(),
        type: "error",
        title: "Belépési hiba",
        message: "Add meg az email címet és a jelszót.",
      });
      return;
    }

    setAuthSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setAuthSubmitting(false);

    if (error) {
      setToast({
        id: Date.now(),
        type: "error",
        title: "Belépési hiba",
        message: error.message,
      });
      return;
    }

    setAuthPassword("");
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      setToast({
        id: Date.now(),
        type: "error",
        title: "Kilépési hiba",
        message: error.message,
      });
      return;
    }

    setSession(null);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto flex min-h-screen max-w-xl items-center justify-center px-6 text-slate-400">
          Hitelesítés betöltése...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
          <div className="w-full rounded-3xl border border-white/10 bg-slate-950/70 p-8 shadow-2xl backdrop-blur">
            <div className="mb-2 text-sm text-cyan-300">Fleet bejelentkezés</div>
            <h1 className="text-3xl font-bold text-white">Email + jelszó belépés</h1>
            <p className="mt-3 text-sm text-slate-400">
              Add meg az email címedet és a jelszavadat a belépéshez.
            </p>

            <div className="mt-6 space-y-3">
              <div className="space-y-2">
                <Label>Email cím</Label>
                <Input
                  type="email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="pelda@email.hu"
                  className="fleet-input rounded-2xl"
                />
              </div>

              <div className="space-y-2">
                <Label>Jelszó</Label>
                <Input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Jelszó"
                  className="fleet-input rounded-2xl"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handlePasswordLogin();
                    }
                  }}
                />
              </div>

              <Button className="w-full rounded-2xl" onClick={handlePasswordLogin} disabled={authSubmitting}>
                {authSubmitting ? "Belépés..." : "Belépés"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-50">
      <div className="fleet-topbar sticky top-0 z-50 border-b border-cyan-400/10 bg-slate-950/55 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-4 md:px-8">
          <button onClick={() => setActivePage("home")} className={`${navButtonClass("home")} ${safePage === "home" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Home
          </button>

          <button onClick={() => setActivePage("vehicles")} className={`${navButtonClass("vehicles")} ${safePage === "vehicles" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Gépjárművek
          </button>

          <button onClick={() => setActivePage("documents")} className={`${navButtonClass("documents")} ${safePage === "documents" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Dokumentumok
          </button>

          <button onClick={() => setActivePage("service")} className={`${navButtonClass("service")} ${safePage === "service" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Szerviz
          </button>

          <button onClick={() => setActivePage("finance")} className={`${navButtonClass("finance")} ${safePage === "finance" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Pénzügyek
          </button>
        </div>
      </div>

      <div className="fleet-shell mx-auto max-w-7xl px-6 py-8 md:px-8">
        {initializationError ? (
          <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {initializationError}
          </div>
        ) : null}

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
        >
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 backdrop-blur">
              <CarFront className="h-4 w-4" />
              Cégautó dashboard
            </div>

            <h1 className="fleet-heading text-3xl font-bold tracking-tight md:text-5xl">
              Modern flottakezelő Ricsikének
            </h1>

            <p className="mt-3 max-w-2xl text-sm text-slate-400 md:text-base">
              Letisztult, gyors, sofőrbarát kezelőfelület járművekhez,
              kilométerálláshoz, dokumentumokhoz és szerviz esedékességhez.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative" ref={notificationRef}>
              {unreadNotificationsCount > 0 && (
                <span className="pointer-events-none absolute -left-2 -top-2 z-10 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
                  {unreadNotificationsCount}
                </span>
              )}
              <Button
                className="fleet-primary-btn rounded-2xl"
                onClick={() => setNotificationOpen((prev) => !prev)}
              >
                <Bell className="mr-2 h-4 w-4" />
                Értesítések
              </Button>

              {notificationOpen && (
                <div className="absolute right-0 top-14 z-[60] w-[390px] rounded-3xl border border-white/10 bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
                  <div className="mb-3 flex items-center justify-between gap-3 px-2">
                    <div>
                      <div className="font-semibold text-white">Értesítések</div>
                      <div className="text-xs text-slate-400">
                        {visibleNotifications.length} látható • {unreadNotificationsCount} új
                      </div>
                    </div>
                  </div>

                  <div className="mb-3 grid gap-3 px-2 md:grid-cols-2">
                    <Select value={notificationCategoryFilter} onValueChange={setNotificationCategoryFilter}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Kategória" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Minden</SelectItem>
                        <SelectItem value="service">Szerviz</SelectItem>
                        <SelectItem value="legal">Okmány / lejárat</SelectItem>
                        <SelectItem value="docs">Dokumentumok</SelectItem>
                        <SelectItem value="driver">Sofőr</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={notificationSort} onValueChange={setNotificationSort}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Rendezés" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="severity">Súlyosság</SelectItem>
                        <SelectItem value="category">Kategória</SelectItem>
                        <SelectItem value="vehicle">Járműnév</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                    {visibleNotifications.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
                        Nincs aktív értesítés ebben a szűrésben.
                      </div>
                    )}

                    {visibleNotifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`rounded-2xl border p-4 transition ${
                          acknowledgedNotifications[notification.id]
                            ? "border-white/10 bg-white/5 opacity-80"
                            : "border-white/15 bg-slate-900/80"
                        }`}
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <NotificationTypeBadge type={notification.type} />
                            <div className="font-semibold text-white">{notification.title}</div>
                            <div className="text-sm text-slate-400">{notification.description}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleAcknowledgeNotification(notification.id)}
                              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
                              title="Tudomásul vettem"
                            >
                              <Check className="h-4 w-4" />
                            </button>

                            <button
                              onClick={() => handleDismissNotification(notification.id)}
                              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
                              title="Bezárás"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {acknowledgedNotifications[notification.id] && (
                          <div className="text-xs text-emerald-400">Tudomásul véve</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button className="fleet-primary-btn rounded-2xl" onClick={() => setExportOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>

            {safePage === "vehicles" && (
              <Button className="fleet-primary-btn rounded-2xl" onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Új autó
              </Button>
            )}

            <Button className="fleet-primary-btn rounded-2xl" onClick={handleSignOut}>
              <X className="mr-2 h-4 w-4" />
              Kilépés
            </Button>
          </div>
        </motion.div>

        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            className={`fixed bottom-6 right-6 z-[80] flex max-w-[360px] items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
              toast.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
                : "border-amber-500/30 bg-amber-500/15 text-amber-100"
            }`}
          >
            <div
              className={`mt-0.5 rounded-full p-1 ${
                toast.type === "success" ? "bg-emerald-500/20" : "bg-amber-500/20"
              }`}
            >
              {toast.type === "success" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
            </div>

            <div className="flex-1 text-sm font-medium">{toast.message}</div>

            <button
              onClick={() => setToast(null)}
              className="rounded-full border border-white/10 bg-white/5 p-1 text-slate-100 transition hover:bg-white/10"
              title="Bezárás"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}

        {safePage === "home" && (
          <>
            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {[
                {
                  title: "Összes autó",
                  value: stats.total,
                  icon: CarFront,
                  desc: "Aktív járművek",
                },
                {
                  title: "Közelgő fix szerviz",
                  value: stats.warning,
                  icon: CalendarClock,
                  desc: "3000 km-en belül",
                },
                {
                  title: "Lejárt szerviz",
                  value: stats.late,
                  icon: AlertTriangle,
                  desc: "Azonnali teendő",
                },
                {
                  title: "Átlag km",
                  value: stats.avgKm.toLocaleString("hu-HU"),
                  icon: Gauge,
                  desc: "Flotta átlag",
                },
              ].map((card, idx) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className="fleet-card fleet-stat-card rounded-3xl">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardDescription className="text-slate-400">{card.title}</CardDescription>
                        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2 shadow-[0_0_18px_rgba(34,211,238,0.14)]">
                          <card.icon className="h-4 w-4 text-slate-200" />
                        </div>
                      </div>

                      <CardTitle className="text-3xl font-bold">
                        <span
                          className="inline-block bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300 bg-clip-text text-transparent"
                          style={{ WebkitBackgroundClip: "text" }}
                        >
                          {card.value}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 text-sm text-slate-400">{card.desc}</CardContent>
                  </Card>
                </motion.div>
              ))}

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
              >
                <Card className="fleet-card fleet-stat-card fleet-health-card flex flex-col rounded-3xl">
                  <CardHeader className="flex flex-row items-center justify-between pb-1">
                    <CardTitle className="text-sm font-medium text-slate-300">
                      Fleet Health Score
                    </CardTitle>

                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-violet-400/30 bg-violet-500/10 text-violet-300">
                      <Activity className="h-4 w-4" />
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 items-start justify-center px-4 pb-3 pt-1">
                    <div className="relative -mt-3 flex h-20 w-20 items-center justify-center">
                      <div
                        className="absolute inset-[12px] rounded-full"
                        style={{
                          background:
                            "radial-gradient(circle, rgba(139,92,246,0.20), transparent 68%)",
                          filter: "blur(12px)",
                        }}
                      />

                      <svg
                        className="absolute inset-0 h-20 w-20 -rotate-90"
                        viewBox="0 0 120 120"
                      >
                        <circle
                          cx="60"
                          cy="60"
                          r="42"
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth="9"
                          fill="none"
                        />

                        <motion.circle
                          cx="60"
                          cy="60"
                          r="42"
                          stroke="url(#fleetScoreGradient)"
                          strokeWidth="9"
                          fill="none"
                          strokeLinecap="round"
                          strokeDasharray={264}
                          initial={{ strokeDashoffset: 264 }}
                          animate={{ strokeDashoffset: 264 - (264 * fleetHealthScore.value) / 100 }}
                          transition={{ duration: 1.6, ease: "easeOut" }}
                          style={{
                            filter: "drop-shadow(0 0 10px rgba(34,211,238,0.42)) drop-shadow(0 0 14px rgba(139,92,246,0.26))",
                          }}
                        />

                        <defs>
                          <linearGradient
                            id="fleetScoreGradient"
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                          >
                            <stop offset="0%" stopColor="#22d3ee" />
                            <stop offset="100%" stopColor="#8b5cf6" />
                          </linearGradient>
                        </defs>
                      </svg>

                      <motion.div
                        className="relative z-10 flex items-center justify-center"
                        initial={{ scale: 0.92, opacity: 0.7 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                      >
                        <span className="bg-gradient-to-br from-cyan-200 via-cyan-300 to-violet-300 bg-clip-text text-2xl font-bold text-transparent">
                          {fleetHealthScore.value}%
                        </span>
                      </motion.div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            <Card className="fleet-card mb-6 rounded-3xl border border-cyan-400/12">
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Activity className="h-5 w-5 text-cyan-200" />
                      Fleet Health Trend
                    </CardTitle>
                    <CardDescription>
                      Hat havi trend, animált betöltéssel és prediktív vizuális visszajelzéssel.
                    </CardDescription>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                    Utolsó 6 hónap • jelenlegi score: {fleetHealthScore.value}%
                  </div>
                </div>
              </CardHeader>

              <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div className="h-[280px] rounded-3xl border border-cyan-400/10 bg-slate-950/40 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={fleetHealthTrend} margin={{ top: 18, right: 8, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fleetTrendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid stroke="rgba(148, 163, 184, 0.10)" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fill: "rgba(191, 219, 254, 0.72)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[20, 100]}
                        tick={{ fill: "rgba(148, 163, 184, 0.65)", fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                        width={34}
                      />
                      <Tooltip
                        cursor={{ stroke: "rgba(34,211,238,0.25)", strokeWidth: 1 }}
                        contentStyle={{
                          background: "rgba(2, 6, 23, 0.96)",
                          border: "1px solid rgba(34,211,238,0.22)",
                          borderRadius: "16px",
                          boxShadow: "0 0 24px rgba(34,211,238,0.12)",
                          color: "#e2e8f0",
                        }}
                        labelStyle={{ color: "#a5f3fc", fontWeight: 600 }}
                        formatter={(value, name) => [
                          name === "score" ? `${value}%` : value,
                          name === "score" ? "Fleet Health" : "Nyitott alert",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="score"
                        stroke="#22d3ee"
                        strokeWidth={3}
                        fill="url(#fleetTrendFill)"
                        dot={{ r: 0 }}
                        activeDot={{
                          r: 5,
                          strokeWidth: 0,
                          fill: "#a78bfa",
                        }}
                        isAnimationActive={true}
                        animationDuration={1200}
                        animationEasing="ease-out"
                        style={{ filter: "drop-shadow(0 0 8px rgba(34,211,238,0.46))" }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-3xl border border-violet-400/12 bg-slate-950/40 p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.22em] text-violet-200/80">
                      Trend összegzés
                    </div>

                    <div className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:border-cyan-400/25 hover:bg-cyan-400/10 hover:text-cyan-100">
                      <Info className="h-4 w-4" />
                      <div className="pointer-events-none absolute right-0 top-11 z-20 w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-3 text-left text-sm normal-case tracking-normal text-slate-300 opacity-0 shadow-2xl backdrop-blur transition duration-200 group-hover:opacity-100">
                        A trend grafikon a jelenlegi flottaállapotból számolt vizuális health történetet mutatja, hogy a demóban jobban látszódjon az irány.
                      </div>
                    </div>
                  </div>

                  <div className="text-3xl font-bold text-white">
                    {fleetHealthTrend[fleetHealthTrend.length - 1]?.score ?? fleetHealthScore.value}%
                  </div>
                  <div className="mt-2 text-sm text-slate-400">
                    Előző hónaphoz képest{" "}
                    <span className="font-semibold text-cyan-200">
                      {(fleetHealthTrend[fleetHealthTrend.length - 1]?.score ?? fleetHealthScore.value) -
                        (fleetHealthTrend[fleetHealthTrend.length - 2]?.score ?? fleetHealthScore.value)}%
                    </span>{" "}
                    eltérés.
                  </div>

                  <div className="mt-5 space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Aktív riasztások</span>
                      <span className="font-semibold text-white">{allNotifications.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Közelgő fix szerviz</span>
                      <span className="font-semibold text-white">{stats.warning}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Lejárt / sürgős</span>
                      <span className="font-semibold text-white">{stats.late}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="fleet-card mb-6 rounded-3xl border border-violet-400/12">
              <CardHeader>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Bell className="h-5 w-5 text-cyan-200" />
                      Automatikus figyelmeztető központ
                    </CardTitle>
                    <CardDescription>
                      A rendszer valós időben priorizálja a szerviz, jogi és dokumentum teendőket.
                    </CardDescription>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                    {prioritySummary.recommendation}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-3xl border border-red-400/20 bg-red-500/8 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.22em] text-red-200/80">Kritikus fix szerviz</div>
                    <div className="text-3xl font-bold text-white">{prioritySummary.criticalCount}</div>
                    <div className="mt-2 text-sm text-slate-300">Azonnali olajcsere / vezérlés vagy 1000 km-en belüli esedékesség.</div>
                  </div>

                  <div className="rounded-3xl border border-amber-400/20 bg-amber-500/8 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.22em] text-amber-200/80">Közelgő fix szerviz</div>
                    <div className="text-3xl font-bold text-white">{prioritySummary.attentionCount}</div>
                    <div className="mt-2 text-sm text-slate-300">Olajcsere vagy vezérlés a figyelmeztetési ablakban.</div>
                  </div>

                  <div className="rounded-3xl border border-violet-400/20 bg-violet-500/8 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.22em] text-violet-200/80">Lejáratok</div>
                    <div className="text-3xl font-bold text-white">{prioritySummary.legalCount}</div>
                    <div className="mt-2 text-sm text-slate-300">Biztosítás vagy műszaki utánkövetés.</div>
                  </div>

                  <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/8 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.22em] text-cyan-200/80">Dokumentum / sofőr</div>
                    <div className="text-3xl font-bold text-white">
                      {prioritySummary.docsCount + prioritySummary.ownerCount}
                    </div>
                    <div className="mt-2 text-sm text-slate-300">Hiányzó dokumentum vagy sofőr beállítás.</div>
                  </div>
                </div>

                <div className="rounded-3xl border border-cyan-400/12 bg-slate-950/40 p-5">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-100">
                    <Sparkles className="h-4 w-4" />
                    Következő fix prioritás
                  </div>

                  {prioritySummary.topVehicle ? (
                    <>
                      <div className="text-2xl font-bold text-white">{prioritySummary.topVehicle.name}</div>
                      <div className="mt-1 text-sm text-slate-400">
                        {prioritySummary.topVehicle.plate} • {prioritySummary.topVehicle.driver || "Nincs sofőr"} • {prioritySummary.topVehicle.dueType}
                      </div>

                      <div className="mt-4 grid gap-3 text-sm text-slate-300">
                        <div className="flex items-center justify-between">
                          <span>Hátralévő km</span>
                          <span className="font-semibold">
                            {prioritySummary.topVehicle.dueRemainingKm > 0
                              ? `${formatKmHu(prioritySummary.topVehicle.dueRemainingKm)} km`
                              : `-${formatKmHu(Math.abs(prioritySummary.topVehicle.dueRemainingKm))} km`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Státusz</span>
                          <StatusBadge status={prioritySummary.topVehicle.status} />
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button
                          className="rounded-2xl"
                          onClick={() => {
                            setSelectedId(prioritySummary.topVehicle.id);
                            setActivePage("home");
                          }}
                        >
                          Jármű megnyitása
                        </Button>

                        <Button
                          variant="secondary"
                          className="rounded-2xl"
                          onClick={() => setNotificationOpen(true)}
                        >
                          Értesítések áttekintése
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-slate-400">Nincs aktív jármű a prioritási ajánláshoz.</div>
                  )}
                </div>
              </CardContent>
            </Card>


            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-lg">Következő szervizek radar</CardTitle>
                      <CardDescription>
                        Flotta szintű prioritási lista a következő általános, olaj- és vezérlés eseményekhez.
                      </CardDescription>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                      {serviceDashboardDueVehicles.length} kiemelt jármű
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="grid gap-4 md:grid-cols-2">
                  {serviceDashboardDueVehicles.map((vehicle) => (
                    <div
                      key={`due-${vehicle.id}`}
                      className="rounded-3xl border border-white/10 bg-slate-950/40 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{vehicle.name}</div>
                          <div className="mt-1 text-sm text-slate-400">
                            {vehicle.plate} • {vehicle.dueType}
                          </div>
                        </div>
                        <StatusBadge status={vehicle.status} />
                      </div>

                      <div className="mt-4 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Hátralévő km</span>
                          <span className="font-semibold text-white">
                            {vehicle.dueRemainingKm > 0
                              ? `${formatKmHu(vehicle.dueRemainingKm)} km`
                              : `-${formatKmHu(Math.abs(vehicle.dueRemainingKm))} km`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400">Sofőr</span>
                          <span className="text-slate-200">{vehicle.driver || "Nincs sofőr"}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <Button
                          variant="secondary"
                          className="rounded-2xl"
                          onClick={() => {
                            setSelectedId(vehicle.id);
                            setActivePage("service");
                          }}
                        >
                          History megnyitása
                        </Button>
                      </div>
                    </div>
                  ))}

                  {serviceDashboardDueVehicles.length === 0 && (
                    <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400 md:col-span-2">
                      Nincs elég adat a következő szervizek kimutatásához.
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="fleet-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-lg">Legmagasabb szervizköltség</CardTitle>
                    <CardDescription>Top járművek a rögzített history alapján</CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {serviceDashboardTopCostVehicles.map((vehicle, index) => (
                      <div
                        key={`cost-${vehicle.id}`}
                        className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-white">
                              {index + 1}. {vehicle.name}
                            </div>
                            <div className="text-sm text-slate-400">
                              {vehicle.plate} • {vehicle.serviceCount} szerviz
                            </div>
                          </div>

                          <div className="text-right font-semibold text-cyan-200">
                            {formatCurrencyHu(vehicle.totalCost)}
                          </div>
                        </div>
                      </div>
                    ))}

                    {serviceDashboardTopCostVehicles.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
                        Még nincs elég history adat a költség rangsorhoz.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="fleet-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-lg">Éves szervizköltség</CardTitle>
                    <CardDescription>Flotta szintű bontás rögzített bejegyzésekből</CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    {serviceDashboardYearlyCosts.map((item) => (
                      <div
                        key={`year-${item.year}`}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3"
                      >
                        <span className="font-medium text-white">{item.year}</span>
                        <span className="font-semibold text-violet-200">
                          {formatCurrencyHu(item.total)}
                        </span>
                      </div>
                    ))}

                    {serviceDashboardYearlyCosts.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
                        Még nincs rögzített szervizköltség.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

          </>
        )}

        {safePage === "vehicles" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    Sofőrök kezelése
                  </CardTitle>
                  <CardDescription>Előre rögzített sofőrök hozzáadása és törlése</CardDescription>
                </CardHeader>

                <CardContent className="space-y-5">
                  <div className="flex flex-col gap-3 md:flex-row">
                    <Input
                      value={ownerManagerValue}
                      onChange={(e) => setOwnerManagerValue(e.target.value)}
                      placeholder="Új sofőr neve"
                      className="fleet-input rounded-2xl"
                    />
                    <Button className="rounded-2xl" onClick={addOwnerOption}>
                      Hozzáadás
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {ownerOptions.map((owner) => (
                      <div
                        key={owner}
                        className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3"
                      >
                        <div className="font-medium text-white">{owner}</div>
                        <button
                          onClick={() => setOwnerToDelete(owner)}
                          className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
                          title="Sofőr törlése"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}

                    {ownerOptions.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                        Nincs még rögzített sofőr.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Email figyelmeztetés előkészítés
                  </CardTitle>
                  <CardDescription>Előkészített beállítások későbbi email küldéshez</CardDescription>
                </CardHeader>

                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3">
                    <div>
                      <div className="font-medium text-white">Email riasztások</div>
                      <div className="text-sm text-slate-400">
                        Backend nélkül most csak a beállításokat mentjük.
                      </div>
                    </div>
                    <Button
                      variant={emailSettings.enabled ? "default" : "secondary"}
                      className="rounded-2xl"
                      onClick={() =>
                        setEmailSettings((prev) => ({
                          ...prev,
                          enabled: !prev.enabled,
                        }))
                      }
                    >
                      {emailSettings.enabled ? "Bekapcsolva" : "Kikapcsolva"}
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>Címzettek</Label>
                    <Input
                      value={emailSettings.recipients}
                      onChange={(e) =>
                        setEmailSettings((prev) => ({
                          ...prev,
                          recipients: e.target.value,
                        }))
                      }
                      placeholder="pl. fleet@ceg.hu, szerviz@ceg.hu"
                      className="fleet-input rounded-2xl"
                    />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      ["serviceAlerts", "Szerviz riasztások"],
                      ["legalAlerts", "Biztosítás / műszaki"],
                      ["docsAlerts", "Dokumentum riasztások"],
                      ["driverAlerts", "Sofőr hiányzik"],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() =>
                          setEmailSettings((prev) => ({
                            ...prev,
                            [key]: !prev[key],
                          }))
                        }
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          emailSettings[key]
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : "border-white/10 bg-slate-900/60"
                        }`}
                      >
                        <div className="font-medium text-white">{label}</div>
                        <div className="mt-1 text-sm text-slate-400">
                          {emailSettings[key] ? "Aktív" : "Inaktív"}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-400">
                    Jelenleg {allNotifications.length} potenciális riasztás van a rendszerben. Ezek a
                    beállítások frissítés után is megmaradnak.
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle>Járműlista</CardTitle>
                  <CardDescription>Válassz egy járművet az adatlaphoz</CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  {enrichedVehicles.map((vehicle) => (
                    <button
                      key={vehicle.id}
                      onClick={() => setSelectedId(vehicle.id)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        selectedVehicle?.id === vehicle.id
                          ? "border-slate-300/30 bg-white/10"
                          : "border-white/10 bg-slate-900/40 hover:bg-white/5"
                      }`}
                    >
                      <div className="font-semibold">{vehicle.name}</div>
                      <div className="mt-1 text-sm text-slate-400">{vehicle.plate}</div>
                    </button>
                  ))}

                  {enrichedVehicles.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                      Nincs aktív jármű. Hozz létre egy újat az "Új autó" gombbal.
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedVehicle ? (
                <Card className="fleet-card rounded-3xl">
                  <CardHeader className="border-b border-white/10 pb-5">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                          <CardTitle className="text-2xl">Szerkeszthető gépjármű adatlap</CardTitle>
                          <CardDescription>
                            {selectedVehicle.name} · {selectedVehicle.plate}
                          </CardDescription>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          {!isVehicleDetailsEditing ? (
                            <Button variant="secondary" className="rounded-2xl" onClick={startVehicleDetailsEditing}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Szerkesztés
                            </Button>
                          ) : (
                            <Button variant="secondary" className="rounded-2xl" onClick={cancelVehicleDetailsEditing}>
                              <X className="mr-2 h-4 w-4" />
                              Mégse
                            </Button>
                          )}

                          <Button className="rounded-2xl" onClick={saveVehicleDetails} disabled={!isVehicleDetailsEditing}>
                            <Save className="mr-2 h-4 w-4" />
                            Adatok mentése
                          </Button>

                          <Button
                            variant="secondary"
                            className="rounded-2xl"
                            onClick={() => setVehicleToArchive(selectedVehicle)}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            Archiválás
                          </Button>

                          <Button
                            variant="secondary"
                            className="rounded-2xl"
                            onClick={() => setVehicleToDelete(selectedVehicle)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Törlés
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-6 pt-6">
                    {!isVehicleDetailsEditing && (
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                        Az adatlap jelenleg zárolt. A mezők módosításához kattints a Szerkesztés gombra.
                      </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Jármű neve</Label>
                        <Input
                          value={vehicleDetailsForm.name}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              name: e.target.value,
                            })
                          }
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Rendszám</Label>
                        <Input
                          value={vehicleDetailsForm.plate}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              plate: e.target.value.toUpperCase(),
                            })
                          }
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Sofőr</Label>
                        <Select
                          value={vehicleDetailsForm.ownerMode}
                          onValueChange={(value) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              ownerMode: value,
                            })
                          }
                          disabled={!isVehicleDetailsEditing}
                        >
                          <SelectTrigger className={lockedInputClass}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ownerOptions.map((owner) => (
                              <SelectItem key={owner} value={owner}>
                                {owner}
                              </SelectItem>
                            ))}
                            <SelectItem value={CUSTOM_OWNER_VALUE}>Egyéb</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Évjárat</Label>
                        <Input
                          value={vehicleDetailsForm.year}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              year: e.target.value,
                            })
                          }
                          placeholder="pl. 2021"
                          className={lockedInputClass}
                        />
                      </div>

                      {vehicleDetailsForm.ownerMode === CUSTOM_OWNER_VALUE && (
                        <div className="space-y-2 md:col-span-2">
                          <Label>Egyéb sofőr</Label>
                          <Input
                            value={vehicleDetailsForm.customOwner}
                            disabled={!isVehicleDetailsEditing}
                            onChange={(e) =>
                              setVehicleDetailsForm({
                                ...vehicleDetailsForm,
                                customOwner: e.target.value,
                              })
                            }
                            placeholder="Sofőr neve kézzel"
                            className={lockedInputClass}
                          />
                        </div>
                      )}

                      <div className="space-y-2 md:col-span-2">
                        <Label>Alvázszám</Label>
                        <Input
                          value={vehicleDetailsForm.vin}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              vin: e.target.value.toUpperCase(),
                            })
                          }
                          placeholder="VIN / alvázszám"
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Üzemanyag</Label>
                        <Select
                          value={vehicleDetailsForm.fuelType}
                          onValueChange={(value) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              fuelType: value,
                            })
                          }
                          disabled={!isVehicleDetailsEditing}
                        >
                          <SelectTrigger className={lockedInputClass}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Benzin">Benzin</SelectItem>
                            <SelectItem value="Dízel">Dízel</SelectItem>
                            <SelectItem value="Hibrid">Hibrid</SelectItem>
                            <SelectItem value="Elektromos">Elektromos</SelectItem>
                            <SelectItem value="LPG">LPG</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Biztosítás lejárat</Label>
                        <Input
                          type="date"
                          value={vehicleDetailsForm.insuranceExpiry}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              insuranceExpiry: e.target.value,
                            })
                          }
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Műszaki vizsga lejárat</Label>
                        <Input
                          type="date"
                          value={vehicleDetailsForm.inspectionExpiry}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              inspectionExpiry: e.target.value,
                            })
                          }
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Olajcsere ciklus (km)</Label>
                        <Input
                          type="number"
                          value={vehicleDetailsForm.oilChangeIntervalKm}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              oilChangeIntervalKm: e.target.value,
                            })
                          }
                          placeholder="pl. 15000"
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Vezérlés csere ciklus (km)</Label>
                        <Input
                          type="number"
                          value={vehicleDetailsForm.timingBeltIntervalKm}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              timingBeltIntervalKm: e.target.value,
                            })
                          }
                          placeholder="pl. 180000"
                          className={lockedInputClass}
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2">
                        <Label>Megjegyzés</Label>
                        <Input
                          value={vehicleDetailsForm.note}
                          disabled={!isVehicleDetailsEditing}
                          onChange={(e) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              note: e.target.value,
                            })
                          }
                          className={lockedInputClass}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <Card className="fleet-soft-card rounded-3xl">
                        <CardContent className="p-5">
                          <div className="mb-2 text-sm text-slate-400">Rendszám</div>
                          <div className="text-lg font-bold text-white">{selectedVehicle.plate || "—"}</div>
                        </CardContent>
                      </Card>

                      <Card className="fleet-soft-card rounded-3xl">
                        <CardContent className="p-5">
                          <div className="mb-2 text-sm text-slate-400">Évjárat</div>
                          <div className="text-lg font-bold text-white">{selectedVehicle.year || "—"}</div>
                        </CardContent>
                      </Card>

                      <Card className="fleet-soft-card rounded-3xl">
                        <CardContent className="p-5">
                          <div className="mb-2 text-sm text-slate-400">Üzemanyag</div>
                          <div className="text-lg font-bold text-white">{selectedVehicle.fuelType || "—"}</div>
                        </CardContent>
                      </Card>

                      <Card className="fleet-soft-card rounded-3xl">
                        <CardContent className="p-5">
                          <div className="mb-2 text-sm text-slate-400">Sofőr</div>
                          <div className="text-lg font-bold text-white">
                            {selectedVehicle.driver || "Nincs beállítva"}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Card className="fleet-soft-card rounded-3xl">
                        <CardContent className="p-5">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <div className="mb-1 flex items-center gap-2 text-sm text-slate-400">
                                <ShieldCheck className="h-4 w-4" />
                                Biztosítás státusz
                              </div>
                              <div className="text-lg font-bold text-white">
                                {formatDateHu(selectedVehicle.insuranceExpiry)}
                              </div>
                            </div>
                            <ExpiryBadge status={insuranceStatus?.status} />
                          </div>

                          <div className="text-sm text-slate-400">{insuranceStatus?.helper}</div>
                        </CardContent>
                      </Card>

                      <Card className="fleet-soft-card rounded-3xl">
                        <CardContent className="p-5">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                              <div className="mb-1 flex items-center gap-2 text-sm text-slate-400">
                                <BadgeCheck className="h-4 w-4" />
                                Műszaki vizsga státusz
                              </div>
                              <div className="text-lg font-bold text-white">
                                {formatDateHu(selectedVehicle.inspectionExpiry)}
                              </div>
                            </div>
                            <ExpiryBadge status={inspectionStatus?.status} />
                          </div>

                          <div className="text-sm text-slate-400">{inspectionStatus?.helper}</div>
                        </CardContent>
                      </Card>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="fleet-card rounded-3xl">
                  <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="mb-4 rounded-full border border-white/10 bg-white/5 p-4">
                      <ClipboardList className="h-8 w-8 text-slate-300" />
                    </div>
                    <div className="mb-2 text-xl font-semibold text-white">Nincs aktív jármű</div>
                    <div className="max-w-md text-sm text-slate-400">
                      Hozz létre egy új járművet, hogy szerkeszthető adatlap és archiválási műveletek jelenjenek meg itt.
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Card className="fleet-card rounded-3xl">
              <CardHeader>
                <CardTitle>Archivált járművek</CardTitle>
                <CardDescription>Visszaállítható vagy véglegesen törölhető járművek</CardDescription>
              </CardHeader>

              <CardContent className="space-y-3">
                {archivedVehicles.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                    Nincs archivált jármű.
                  </div>
                )}

                {archivedVehicles.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">{vehicle.name}</div>
                      <div className="text-sm text-slate-400">{vehicle.plate}</div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="secondary"
                        className="rounded-2xl"
                        onClick={() => restoreVehicle(vehicle.id)}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Visszaállítás
                      </Button>

                      <Button className="rounded-2xl" onClick={() => setVehicleToDelete(vehicle)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Végleges törlés
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {safePage === "service" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  title: "Flotta összköltség",
                  value: formatCurrencyHu(fleetServiceSummary.totalCost),
                  icon: Wrench,
                  desc: `${fleetServiceSummary.count} rögzített szerviz`,
                },
                {
                  title: "Átlag szervizköltség",
                  value: formatCurrencyHu(fleetServiceSummary.avgCost),
                  icon: Gauge,
                  desc: "Aktív flottára számolva",
                },
                {
                  title: "Kiválasztott jármű költsége",
                  value: formatCurrencyHu(selectedVehicleServiceSummary.totalCost),
                  icon: ClipboardList,
                  desc: selectedVehicle ? selectedVehicle.name : "Nincs kiválasztott jármű",
                },
                {
                  title: "Utolsó szerviz",
                  value: selectedVehicleServiceSummary.lastService ? formatDateHu(selectedVehicleServiceSummary.lastService.date) : "—",
                  icon: CalendarClock,
                  desc: selectedVehicleServiceSummary.lastService?.serviceType || "Nincs még bejegyzés",
                },
              ].map((card, idx) => (
                <motion.div
                  key={card.title}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                >
                  <Card className="fleet-card fleet-stat-card rounded-3xl">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardDescription className="text-slate-400">{card.title}</CardDescription>
                        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2 shadow-[0_0_18px_rgba(34,211,238,0.14)]">
                          <card.icon className="h-4 w-4 text-slate-200" />
                        </div>
                      </div>
                      <CardTitle className="text-2xl font-bold">
                        <span
                          className="inline-block bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300 bg-clip-text text-transparent"
                          style={{ WebkitBackgroundClip: "text" }}
                        >
                          {card.value}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 text-sm text-slate-400">{card.desc}</CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle>Járműlista</CardTitle>
                  <CardDescription>Válassz járművet a szerviz history nézethez</CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  {enrichedVehicles.map((vehicle) => {
                    const serviceRecords = (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
                      .map(normalizeServiceHistoryItem)
                      .filter((entry) => entry.isServiceRecord);
                    const serviceTotal = serviceRecords.reduce((sum, entry) => sum + Number(entry.cost || 0), 0);

                    return (
                      <button
                        key={vehicle.id}
                        onClick={() => setSelectedId(vehicle.id)}
                        className={`w-full rounded-3xl border p-4 text-left transition ${
                          selectedVehicle?.id === vehicle.id
                            ? "border-slate-300/30 bg-white/10"
                            : "border-white/10 bg-slate-900/40 hover:bg-white/5"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold">{vehicle.name}</div>
                            <div className="mt-1 text-sm text-slate-400">{vehicle.plate}</div>
                          </div>
                          <div className="text-right text-xs text-slate-400">
                            <div>{serviceRecords.length} bejegyzés</div>
                            <div className="mt-1 font-semibold text-slate-200">{formatCurrencyHu(serviceTotal)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {enrichedVehicles.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                      Nincs aktív jármű. Hozz létre egy újat az "Új autó" gombbal.
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedVehicle ? (
                <div className="space-y-6">
                  <Card className="fleet-card rounded-3xl">
                    <CardHeader>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <CardTitle className="text-2xl">Szerviz history</CardTitle>
                          <CardDescription>
                            {selectedVehicle.name} · {selectedVehicle.plate} · {selectedVehicle.driver || "Nincs sofőr"}
                          </CardDescription>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                          {selectedVehicleServiceSummary.count} bejegyzés • összesen {formatCurrencyHu(selectedVehicleServiceSummary.totalCost)}
                        </div>
                      </div>
                    </CardHeader>


                    <CardContent className="space-y-5">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                          <div className="text-sm text-slate-400">Összes költség</div>
                          <div className="mt-2 text-3xl font-bold text-white">
                            {formatCurrencyHu(selectedVehicleServiceSummary.totalCost)}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            {selectedVehicleServiceSummary.count} rögzített szerviz
                          </div>
                        </div>

                        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                          <div className="text-sm text-slate-400">Idei költség</div>
                          <div className="mt-2 text-3xl font-bold text-white">
                            {formatCurrencyHu(selectedVehicleServiceSummary.yearlyCost)}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            Aktuális évben rögzített bejegyzésekből
                          </div>
                        </div>

                        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                          <div className="text-sm text-slate-400">Átlag / szerviz</div>
                          <div className="mt-2 text-3xl font-bold text-white">
                            {formatCurrencyHu(selectedVehicleServiceSummary.avgCost)}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            Költségátlag az összes bejegyzésből
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                          <div className="text-sm text-slate-400">Utolsó szerviz</div>
                          <div className="mt-2 text-2xl font-bold text-white">
                            {selectedVehicleServiceSummary.lastService ? formatDateHu(selectedVehicleServiceSummary.lastService.date) : "—"}
                          </div>
                          <div className="mt-2 text-xs text-slate-500">
                            {selectedVehicleServiceSummary.lastService?.serviceType || selectedVehicleServiceSummary.lastService?.title || "Nincs még bejegyzés"}
                          </div>
                        </div>

                        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                          <div className="text-sm text-slate-400">Ciklus beállítások</div>
                          <div className="mt-3 space-y-3 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Olajcsere</span>
                              <span className="font-semibold text-white">
                                {selectedVehicle?.oilChangeIntervalKm ? `${formatKmHu(selectedVehicle.oilChangeIntervalKm)} km` : "—"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Vezérlés</span>
                              <span className="font-semibold text-white">
                                {selectedVehicle?.timingBeltIntervalKm ? `${formatKmHu(selectedVehicle.timingBeltIntervalKm)} km` : "—"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-3xl border border-white/10 bg-slate-950/40 p-5">
                          <div className="text-sm text-slate-400">Következő fix szervizek</div>
                          <div className="mt-3 space-y-4">
                            <div>
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="text-slate-400">Olajcsere</span>
                                <span className="font-semibold text-cyan-100">
                                  {selectedVehicleOilStatus
                                    ? selectedVehicleOilStatus.remainingKm > 0
                                      ? `${formatKmHu(selectedVehicleOilStatus.remainingKm)} km van hátra`
                                      : `${formatKmHu(Math.abs(selectedVehicleOilStatus.remainingKm))} km túlfutás`
                                    : "Nincs beállítva"}
                                </span>
                              </div>
                              <Progress
                                value={
                                  selectedVehicle?.oilChangeIntervalKm && selectedVehicleOilStatus
                                    ? Math.max(
                                        0,
                                        Math.min(
                                          100,
                                          ((selectedVehicle.oilChangeIntervalKm - selectedVehicleOilStatus.remainingKm) /
                                            selectedVehicle.oilChangeIntervalKm) *
                                            100
                                        )
                                      )
                                    : 0
                                }
                                className="fleet-progress mt-2 h-2"
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between gap-3 text-sm">
                                <span className="text-slate-400">Vezérlés</span>
                                <span className="font-semibold text-violet-100">
                                  {selectedVehicleTimingStatus
                                    ? selectedVehicleTimingStatus.remainingKm > 0
                                      ? `${formatKmHu(selectedVehicleTimingStatus.remainingKm)} km van hátra`
                                      : `${formatKmHu(Math.abs(selectedVehicleTimingStatus.remainingKm))} km túlfutás`
                                    : "Nincs beállítva"}
                                </span>
                              </div>
                              <Progress
                                value={
                                  selectedVehicle?.timingBeltIntervalKm && selectedVehicleTimingStatus
                                    ? Math.max(
                                        0,
                                        Math.min(
                                          100,
                                          ((selectedVehicle.timingBeltIntervalKm - selectedVehicleTimingStatus.remainingKm) /
                                            selectedVehicle.timingBeltIntervalKm) *
                                            100
                                        )
                                      )
                                    : 0
                                }
                                className="fleet-progress mt-2 h-2"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                    <Card className="fleet-card rounded-3xl">
                      <CardHeader>
                        <CardTitle>Új szerviz bejegyzés</CardTitle>
                        <CardDescription>Rögzítsd a költséget és a szerviz metaadatokat</CardDescription>
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label>Dátum</Label>
                          <Input
                            type="date"
                            value={serviceHistoryDraft.date}
                            onChange={(e) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                date: e.target.value,
                              }))
                            }
                            className="fleet-input rounded-2xl"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Km óraállás</Label>
                          <Input
                            type="number"
                            value={serviceHistoryDraft.km}
                            onChange={(e) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                km: e.target.value,
                              }))
                            }
                            className="fleet-input rounded-2xl"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Szerviz típusa</Label>
                          <Select
                            value={serviceHistoryDraft.serviceType}
                            onValueChange={(value) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                serviceType: value,
                              }))
                            }
                          >
                            <SelectTrigger className="fleet-input rounded-2xl">
                              <SelectValue placeholder="Válassz szerviz típust" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="general">Általános szerviz</SelectItem>
                              <SelectItem value="oil">Olajcsere</SelectItem>
                              <SelectItem value="timing">Vezérlés csere</SelectItem>
                              <SelectItem value="custom">Egyéb</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {serviceHistoryDraft.serviceType === "custom" && (
                          <div className="space-y-2">
                            <Label>Egyéb szerviz megnevezése</Label>
                            <Input
                              value={serviceHistoryDraft.customServiceType}
                              onChange={(e) =>
                                setServiceHistoryDraft((prev) => ({
                                  ...prev,
                                  customServiceType: e.target.value,
                                }))
                              }
                              placeholder="pl. Fékcsere, futómű állítás"
                              className="fleet-input rounded-2xl"
                            />
                          </div>
                        )}

                        <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
                          Olajcsere ciklus: <span className="text-slate-200">{selectedVehicle?.oilChangeIntervalKm ? `${formatKmHu(selectedVehicle.oilChangeIntervalKm)} km` : "nincs beállítva"}</span>
                          {" • "}
                          Vezérlés ciklus: <span className="text-slate-200">{selectedVehicle?.timingBeltIntervalKm ? `${formatKmHu(selectedVehicle.timingBeltIntervalKm)} km` : "nincs beállítva"}</span>
                        </div>

                        <div className="space-y-2">
                          <Label>Költség (Ft)</Label>
                          <Input
                            type="number"
                            value={serviceHistoryDraft.cost}
                            onChange={(e) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                cost: e.target.value,
                              }))
                            }
                            placeholder="pl. 85000"
                            className="fleet-input rounded-2xl"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Szervizpartner</Label>
                          <Input
                            value={serviceHistoryDraft.provider}
                            onChange={(e) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                provider: e.target.value,
                              }))
                            }
                            placeholder="pl. Bosch Car Service"
                            className="fleet-input rounded-2xl"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Megjegyzés</Label>
                          <Input
                            value={serviceHistoryDraft.note}
                            onChange={(e) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                note: e.target.value,
                              }))
                            }
                            placeholder="pl. szűrők cserélve, következő ellenőrzés 10 000 km múlva"
                            className="fleet-input rounded-2xl"
                          />
                        </div>

                        <div className="pt-2">
                          <Button className="fleet-primary-btn rounded-2xl" onClick={addServiceHistoryEntry}>
                            <Plus className="mr-2 h-4 w-4" />
                            Bejegyzés hozzáadása
                          </Button>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="fleet-card rounded-3xl">
                      <CardHeader>
                        <CardTitle>Szerviz bejegyzések</CardTitle>
                        <CardDescription>Időrendben, költségekkel és partner adatokkal</CardDescription>
                      </CardHeader>

                      <CardContent>
                        <div className="space-y-4">
                          {selectedVehicleServiceHistory.length === 0 && (
                            <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                              Ennél a járműnél még nincs külön rögzített szerviz history bejegyzés.
                            </div>
                          )}

                          {selectedVehicleAllHistory.map((entry) => {
                            const isKmUpdate = entry.type === "km-update" || !entry.isServiceRecord;
                            return (
                              <div
                                key={entry.id}
                                className={`rounded-3xl border p-5 ${
                                  isKmUpdate
                                    ? "border-white/10 bg-slate-900/35"
                                    : "border-white/10 bg-slate-900/50"
                                }`}
                              >
                                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`fleet-tone-pill ${
                                          isKmUpdate
                                            ? "border-white/15 bg-white/5 text-slate-300"
                                            : entry.serviceType === OIL_SERVICE_LABEL
                                            ? "fleet-tone-pill--warning"
                                            : entry.serviceType === TIMING_SERVICE_LABEL
                                            ? "fleet-tone-pill--danger"
                                            : "fleet-tone-pill--ok"
                                        }`}
                                      >
                                        {isKmUpdate ? "Km frissítés" : entry.serviceType || "Szerviz"}
                                      </span>
                                      <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                        {formatDateHu(entry.date)}
                                      </span>
                                    </div>

                                    <div className="text-xl font-semibold text-white">{entry.title}</div>

                                    <div className="text-sm text-slate-400">
                                      {isKmUpdate
                                        ? entry.detail || "Futásteljesítmény frissítve"
                                        : entry.provider
                                        ? `Partner: ${entry.provider}`
                                        : "Partner nincs megadva"}
                                    </div>

                                    {entry.note && !isKmUpdate ? (
                                      <div className="text-sm text-slate-300">{entry.note}</div>
                                    ) : null}
                                  </div>

                                  <div className="flex flex-col items-start gap-2 md:items-end">
                                    <div className={`rounded-full px-3 py-1 text-sm font-semibold ${
                                      isKmUpdate
                                        ? "border border-white/10 bg-white/5 text-slate-200"
                                        : "border border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                                    }`}>
                                      {entry.km !== null && entry.km !== undefined ? `${formatKmHu(entry.km)} km` : "Nincs km adat"}
                                    </div>

                                    {!isKmUpdate ? (
                                      <div className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-sm font-semibold text-violet-100">
                                        {formatCurrencyHu(entry.cost)}
                                      </div>
                                    ) : null}

                                    {entry.type === "baseline" ? null : (
                                      <Button
                                        variant="secondary"
                                        className="rounded-2xl"
                                        onClick={() => removeServiceHistoryEntry(entry.id)}
                                      >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Törlés
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card className="fleet-card rounded-3xl">
                    <CardHeader>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <CardTitle>Gyors km frissítés</CardTitle>
                          <CardDescription>Külön km rögzítés a szerviz oldalon belül</CardDescription>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                          Jelenlegi óraállás: {formatKmHu(selectedVehicle.currentKm)} km
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                      <Card className="fleet-soft-card rounded-3xl">
                        <CardHeader>
                          <CardTitle>Új km rögzítése</CardTitle>
                          <CardDescription>Szerviz nélküli futásteljesítmény frissítés</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="space-y-2">
                            <Label>Dátum</Label>
                            <Input type="date" value={kmUpdateDraft.date} onChange={(e) => setKmUpdateDraft((prev) => ({ ...prev, date: e.target.value }))} className="fleet-input rounded-2xl" />
                          </div>
                          <div className="space-y-2">
                            <Label>Új km óraállás</Label>
                            <Input type="number" value={kmUpdateDraft.km} onChange={(e) => setKmUpdateDraft((prev) => ({ ...prev, km: e.target.value }))} className="fleet-input rounded-2xl" />
                          </div>
                          <div className="space-y-2">
                            <Label>Megjegyzés</Label>
                            <Input value={kmUpdateDraft.note} onChange={(e) => setKmUpdateDraft((prev) => ({ ...prev, note: e.target.value }))} placeholder="pl. havi óraállás rögzítés" className="fleet-input rounded-2xl" />
                          </div>
                          <Button className="rounded-2xl w-full" onClick={handleKmUpdate}>Km frissítés mentése</Button>
                        </CardContent>
                      </Card>

                      <Card className="fleet-soft-card rounded-3xl">
                        <CardHeader>
                          <CardTitle>Legutóbbi km frissítések</CardTitle>
                          <CardDescription>Szerviz nélküli futásteljesítmény napló</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {selectedVehicleAllHistory.filter((entry) => entry.type === "km-update").length === 0 && (
                            <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
                              Még nincs külön km frissítés rögzítve.
                            </div>
                          )}
                          {selectedVehicleAllHistory.filter((entry) => entry.type === "km-update").slice(0, 8).map((entry) => (
                            <div key={`service-km-${entry.id}`} className="rounded-2xl border border-white/10 bg-slate-900/35 px-4 py-3">
                              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                <div>
                                  <div className="font-semibold text-white">{formatKmHu(entry.km)} km</div>
                                  <div className="mt-1 text-sm text-slate-400">{formatDateHu(entry.date)}</div>
                                  {entry.note ? <div className="mt-2 text-sm text-slate-300">{entry.note}</div> : null}
                                </div>
                                <Button variant="secondary" className="rounded-2xl" onClick={() => removeServiceHistoryEntry(entry.id)}>
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Törlés
                                </Button>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <Card className="fleet-card rounded-3xl">
                  <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="mb-4 rounded-full border border-white/10 bg-white/5 p-4">
                      <Wrench className="h-8 w-8 text-slate-300" />
                    </div>
                    <div className="mb-2 text-xl font-semibold text-white">Nincs kiválasztott jármű</div>
                    <div className="max-w-md text-sm text-slate-400">
                      Válassz ki egy járművet a bal oldali listából, és itt tudod majd kezelni a részletes szerviz history-t és költségeket.
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </motion.div>
        )}



{false && safePage === "km" && (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="fleet-card rounded-3xl">
        <CardHeader>
          <CardTitle>Járműlista</CardTitle>
          <CardDescription>Válassz egy járművet a km frissítéshez</CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {enrichedVehicles.map((vehicle) => (
            <button
              key={vehicle.id}
              onClick={() => setSelectedId(vehicle.id)}
              className={`w-full rounded-3xl border p-4 text-left transition ${
                selectedVehicle?.id === vehicle.id
                  ? "border-slate-300/30 bg-white/10"
                  : "border-white/10 bg-slate-900/40 hover:bg-white/5"
              }`}
            >
              <div className="font-semibold">{vehicle.name}</div>
              <div className="mt-1 text-sm text-slate-400">{vehicle.plate}</div>
              <div className="mt-2 text-xs text-slate-500">
                Aktuális: {formatKmHu(vehicle.currentKm)} km
              </div>
            </button>
          ))}

          {enrichedVehicles.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
              Nincs aktív jármű. Hozz létre egy újat az "Új autó" gombbal.
            </div>
          )}
        </CardContent>
      </Card>

      {selectedVehicle ? (
        <Card className="fleet-card rounded-3xl">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="text-2xl">Km frissítés</CardTitle>
                <CardDescription>
                  {selectedVehicle.name} · {selectedVehicle.plate}
                </CardDescription>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
                Jelenlegi óraállás: {formatKmHu(selectedVehicle.currentKm)} km
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
            <Card className="fleet-soft-card rounded-3xl">
              <CardHeader>
                <CardTitle>Új km rögzítése</CardTitle>
                <CardDescription>Csak futásteljesítmény frissítés, szerviz nélkül</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Dátum</Label>
                  <Input
                    type="date"
                    value={kmUpdateDraft.date}
                    onChange={(e) =>
                      setKmUpdateDraft((prev) => ({
                        ...prev,
                        date: e.target.value,
                      }))
                    }
                    className="fleet-input rounded-2xl"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Új km óraállás</Label>
                  <Input
                    type="number"
                    value={kmUpdateDraft.km}
                    onChange={(e) =>
                      setKmUpdateDraft((prev) => ({
                        ...prev,
                        km: e.target.value,
                      }))
                    }
                    className="fleet-input rounded-2xl"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Megjegyzés</Label>
                  <Input
                    value={kmUpdateDraft.note}
                    onChange={(e) =>
                      setKmUpdateDraft((prev) => ({
                        ...prev,
                        note: e.target.value,
                      }))
                    }
                    placeholder="pl. havi óraállás rögzítés"
                    className="fleet-input rounded-2xl"
                  />
                </div>

                <Button className="rounded-2xl w-full" onClick={handleKmUpdate}>
                  Km frissítés mentése
                </Button>
              </CardContent>
            </Card>

            <Card className="fleet-soft-card rounded-3xl">
              <CardHeader>
                <CardTitle>Legutóbbi km frissítések</CardTitle>
                <CardDescription>Szerviz nélküli futásteljesítmény napló</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedVehicleAllHistory.filter((entry) => entry.type === "km-update").length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
                    Még nincs külön km frissítés rögzítve.
                  </div>
                )}

                {selectedVehicleAllHistory
                  .filter((entry) => entry.type === "km-update")
                  .slice(0, 8)
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-2xl border border-white/10 bg-slate-900/35 px-4 py-3"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold text-white">{formatKmHu(entry.km)} km</div>
                          <div className="mt-1 text-sm text-slate-400">{formatDateHu(entry.date)}</div>
                          {entry.note ? (
                            <div className="mt-2 text-sm text-slate-300">{entry.note}</div>
                          ) : null}
                        </div>
                        <Button
                          variant="secondary"
                          className="rounded-2xl"
                          onClick={() => removeServiceHistoryEntry(entry.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Törlés
                        </Button>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      ) : (
        <Card className="fleet-card rounded-3xl">
          <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-10 text-center">
            <div className="mb-4 rounded-full border border-white/10 bg-white/5 p-4">
              <Gauge className="h-8 w-8 text-slate-300" />
            </div>
            <div className="mb-2 text-xl font-semibold text-white">Nincs kiválasztott jármű</div>
            <div className="max-w-md text-sm text-slate-400">
              Válassz ki egy aktív járművet a bal oldali listából, és itt tudod majd külön rögzíteni a kilométer frissítéseket.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  </motion.div>
)}
        {safePage === "finance" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  title: "Éves szervizköltség",
                  value: formatCurrencyHu(fleetServiceSummary.totalCost),
                  icon: Wrench,
                  desc: `${fleetServiceSummary.count} rögzített szerviz`,
                },
                {
                  title: "Átlag / szerviz",
                  value: formatCurrencyHu(fleetServiceSummary.avgCost),
                  icon: Gauge,
                  desc: "Flotta átlag",
                },
                {
                  title: "Legdrágább jármű",
                  value: serviceDashboardTopCostVehicles[0]?.name || "—",
                  icon: CarFront,
                  desc: serviceDashboardTopCostVehicles[0]
                    ? formatCurrencyHu(serviceDashboardTopCostVehicles[0].totalCost)
                    : "Nincs még adat",
                },
                {
                  title: "Legutóbbi szerviz",
                  value: fleetServiceSummary.latestDate ? formatDateHu(fleetServiceSummary.latestDate) : "—",
                  icon: CalendarClock,
                  desc: "Utolsó rögzített dátum",
                },
              ].map((card, idx) => (
                <motion.div key={card.title} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                  <Card className="fleet-card fleet-stat-card rounded-3xl">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardDescription className="text-slate-400">{card.title}</CardDescription>
                        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2 shadow-[0_0_18px_rgba(34,211,238,0.14)]">
                          <card.icon className="h-4 w-4 text-slate-200" />
                        </div>
                      </div>
                      <CardTitle className="text-2xl font-bold">
                        <span className="inline-block bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-300 bg-clip-text text-transparent" style={{ WebkitBackgroundClip: "text" }}>
                          {card.value}
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 text-sm text-slate-400">{card.desc}</CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_360px]">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle>Autónkénti költségek</CardTitle>
                  <CardDescription>Összesített szervizköltség aktív járművenként</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {serviceDashboardTopCostVehicles.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                      Még nincs elég rögzített szervizköltség.
                    </div>
                  )}
                  {serviceDashboardTopCostVehicles.map((vehicle, index) => (
                    <div key={`finance-vehicle-${vehicle.id}`} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold text-white">{index + 1}. {vehicle.name}</div>
                          <div className="text-sm text-slate-400">{vehicle.plate} • {vehicle.serviceCount} bejegyzés</div>
                        </div>
                        <div className="text-right font-semibold text-cyan-200">{formatCurrencyHu(vehicle.totalCost)}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="fleet-card rounded-3xl">
                  <CardHeader>
                    <CardTitle>Éves bontás</CardTitle>
                    <CardDescription>Rögzített szervizköltségek év szerint</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {serviceDashboardYearlyCosts.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                        Még nincs éves költségadat.
                      </div>
                    )}
                    {serviceDashboardYearlyCosts.map((item) => (
                      <div key={`finance-year-${item.year}`} className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                        <span className="font-medium text-white">{item.year}</span>
                        <span className="font-semibold text-violet-200">{formatCurrencyHu(item.total)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="fleet-card rounded-3xl">
                  <CardHeader>
                    <CardTitle>Legutóbbi költséges események</CardTitle>
                    <CardDescription>Utolsó rögzített szervizek költséggel</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {activeVehicles.flatMap((vehicle) =>
                      (Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [])
                        .map(normalizeServiceHistoryItem)
                        .filter((entry) => entry.isServiceRecord && Number(entry.cost || 0) > 0)
                        .map((entry) => ({ vehicle, entry }))
                    )
                    .sort((a, b) => String(b.entry.date || "").localeCompare(String(a.entry.date || "")))
                    .slice(0, 6)
                    .map(({ vehicle, entry }) => (
                      <div key={`finance-entry-${entry.id}`} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-semibold text-white">{vehicle.name} • {entry.title}</div>
                            <div className="text-sm text-slate-400">{formatDateHu(entry.date)} • {vehicle.plate}</div>
                          </div>
                          <div className="font-semibold text-cyan-200">{formatCurrencyHu(entry.cost)}</div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </div>
          </motion.div>
        )}

        {safePage === "documents" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle>Járműlista</CardTitle>
                  <CardDescription>Válassz egy járművet a dokumentumokhoz</CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                  {enrichedVehicles.map((vehicle) => (
                    <button
                      key={vehicle.id}
                      onClick={() => setSelectedId(vehicle.id)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        selectedVehicle?.id === vehicle.id
                          ? "border-slate-300/30 bg-white/10"
                          : "border-white/10 bg-slate-900/40 hover:bg-white/5"
                      }`}
                    >
                      <div className="font-semibold">{vehicle.name}</div>
                      <div className="mt-1 text-sm text-slate-400">{vehicle.plate}</div>
                    </button>
                  ))}

                  {enrichedVehicles.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                      Nincs aktív jármű. Hozz létre egy újat az "Új autó" gombbal.
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedVehicle && selectedVehicleDocs ? (
                <Card className="fleet-card rounded-3xl">
                  <CardHeader>
                    <CardTitle className="text-2xl">Gépjármű dokumentumok</CardTitle>
                    <CardDescription>
                      {selectedVehicle.name} · {selectedVehicle.plate}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {Object.entries(selectedVehicleDocs).map(([docKey, docValue]) => {
                      const docsArr = Array.isArray(docValue) ? docValue : [docValue];
                      const categoryTitle = docsArr?.[0]?.title || docKey;
                      const categoryStatus = getDocUploadStatus(docsArr);
                      const uploadedDocs = docsArr
                        .filter((d) => d?.uploaded)
                        .sort((a, b) => String(b.uploadedAt || "").localeCompare(String(a.uploadedAt || "")));
                      const draftDoc = docsArr.find((d) => !d?.uploaded) || docsArr?.[0] || null;

                      return (
                        <Card key={docKey} className="fleet-soft-card rounded-3xl">
                          <CardContent className="p-5">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div className="rounded-2xl border border-white/10 bg-white/5 p-2">
                                  {docKey === "service" ? (
                                    <ClipboardList className="h-5 w-5 text-slate-200" />
                                  ) : (
                                    <FileText className="h-5 w-5 text-slate-200" />
                                  )}
                                </div>
                                <div className="text-lg font-semibold text-white">{categoryTitle}</div>
                              </div>

                              <ExpiryBadge status={categoryStatus.status} />
                            </div>

                            {uploadedDocs.length === 0 ? (
                              <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                                Nincs feltöltött fájl. A lejárat és megjegyzés beállítható a következő feltöltéshez.
                              </div>
                            ) : (
                              <div className="mb-4 text-sm text-slate-400">
                                {uploadedDocs.length} feltöltött fájl • {categoryStatus.helper}
                              </div>
                            )}

                            {uploadedDocs.length === 0 && (
                              <div className="space-y-3 text-sm text-slate-400">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label>Lejárat</Label>
                                    <Input
                                      type="date"
                                      value={draftDoc?.expiry || ""}
                                      onChange={(e) =>
                                        updateDocField(
                                          selectedVehicle.id,
                                          docKey,
                                          "expiry",
                                          e.target.value,
                                          draftDoc?.id || null
                                        )
                                      }
                                      className="fleet-input rounded-2xl"
                                    />
                                  </div>

                                  <div className="space-y-2">
                                    <Label>Megjegyzés</Label>
                                    <Input
                                      value={draftDoc?.note || ""}
                                      onChange={(e) =>
                                        updateDocField(
                                          selectedVehicle.id,
                                          docKey,
                                          "note",
                                          e.target.value,
                                          draftDoc?.id || null
                                        )
                                      }
                                      className="fleet-input rounded-2xl"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            <input
                              ref={(node) => {
                                fileInputRefs.current[`${selectedVehicle.id}-${docKey}`] = node;
                              }}
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                handleFileUpload(selectedVehicle.id, docKey, file);
                                e.target.value = "";
                              }}
                            />

                            <div className="flex flex-wrap gap-3 mt-4">
                              <Button
                                className="fleet-doc-btn fleet-doc-btn--primary rounded-2xl"
                                onClick={() => triggerDocumentPicker(selectedVehicle.id, docKey)}
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                {uploadedDocs.length > 0 ? "További fájl" : "Feltöltés"}
                              </Button>
                            </div>

                            {uploadedDocs.length > 0 && (
                              <div className="mt-5 space-y-3">
                                {uploadedDocs.map((doc, idx) => {
                                  const fileStatus = getDocUploadStatus(doc);
                                  return (
                                    <div
                                      key={doc.id || `${docKey}-${doc.uploadedAt || idx}`}
                                      className="rounded-3xl border border-white/10 bg-slate-950/40 p-4"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                          <div className="truncate font-semibold text-white">{doc.fileName || "Dokumentum"}</div>
                                          <div className="mt-1 text-sm text-slate-400">
                                            {doc.fileType || "-"} • {formatFileSize(doc.fileSize)}
                                          </div>
                                          <div className="mt-1 text-xs text-slate-500">
                                            Feltöltés: {formatDateHu(doc.uploadedAt)}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <ExpiryBadge status={fileStatus.status} />
                                        </div>
                                      </div>

                                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                                        <div className="space-y-2">
                                          <Label>Lejárat</Label>
                                          <Input
                                            type="date"
                                            value={doc.expiry || ""}
                                            onChange={(e) =>
                                              updateDocField(
                                                selectedVehicle.id,
                                                docKey,
                                                "expiry",
                                                e.target.value,
                                                doc.id
                                              )
                                            }
                                            className="fleet-input rounded-2xl"
                                          />
                                        </div>

                                        <div className="space-y-2">
                                          <Label>Megjegyzés</Label>
                                          <Input
                                            value={doc.note || ""}
                                            onChange={(e) =>
                                              updateDocField(
                                                selectedVehicle.id,
                                                docKey,
                                                "note",
                                                e.target.value,
                                                doc.id
                                              )
                                            }
                                            className="fleet-input rounded-2xl"
                                          />
                                        </div>
                                      </div>

                                      <div className="mt-3 flex flex-wrap gap-3">
                                        <Button
                                          variant="secondary"
                                          className="fleet-doc-btn rounded-2xl"
                                          onClick={() => openStoredDocument(doc)}
                                        >
                                          Megnyitás
                                        </Button>

                                        <Button
                                          variant="secondary"
                                          className="fleet-doc-btn rounded-2xl"
                                          onClick={() => downloadStoredDocument(doc)}
                                        >
                                          <Download className="mr-2 h-4 w-4" />
                                          Letöltés
                                        </Button>

                                        <Button
                                          variant="secondary"
                                          className="fleet-doc-btn fleet-doc-btn--danger rounded-2xl"
                                          onClick={() =>
                                            requestDocumentRemove(selectedVehicle.id, docKey, doc.id, doc.fileName || categoryTitle)
                                          }
                                        >
                                          <X className="mr-2 h-4 w-4" />
                                          Eltávolítás
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </CardContent>
                </Card>
              ) : (
                <Card className="fleet-card rounded-3xl">
                  <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-10 text-center">
                    <div className="mb-4 rounded-full border border-white/10 bg-white/5 p-4">
                      <FileText className="h-8 w-8 text-slate-300" />
                    </div>
                    <div className="mb-2 text-xl font-semibold text-white">Nincs kiválasztott jármű a dokumentumokhoz</div>
                    <div className="max-w-md text-sm text-slate-400">
                      Válassz ki egy aktív járművet a bal oldali listából. Itt tudod majd kezelni a feltöltéseket, lejáratokat és megjegyzéseket.
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {documentPreview && (
        <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-sm">
          <div className="flex h-full w-full items-center justify-center p-3 sm:p-5">
            <div className="flex h-[96vh] w-[98vw] max-w-[1800px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-white">Dokumentum előnézet</div>
                  <div className="mt-1 text-sm text-slate-400">
                    <span className="font-semibold text-white">{documentPreview.fileName || "Dokumentum"}</span>
                    {" • "}
                    {documentPreview.fileType || "Ismeretlen típus"}
                    {" • "}
                    {formatFileSize(documentPreview.fileSize)}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 rounded-2xl text-slate-300 hover:bg-white/10 hover:text-white"
                  onClick={() => setDocumentPreview(null)}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="flex-1 p-3 sm:p-5">
                <div className="h-full w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 p-2 sm:p-3">
                  {documentPreview.fileDataUrl ? (
                    isPreviewableImage(documentPreview) ? (
                      <div className="flex h-full w-full items-center justify-center overflow-auto rounded-2xl bg-slate-950 p-2 sm:p-4">
                        <img
                          src={documentPreview.fileDataUrl}
                          alt={documentPreview.fileName || "Dokumentum előnézet"}
                          className="max-h-full max-w-full rounded-2xl object-contain"
                        />
                      </div>
                    ) : isPreviewablePdf(documentPreview) ? (
                      <div className="h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-white">
                        <iframe
                          src={documentPreview.fileDataUrl}
                          title={documentPreview.fileName || "PDF előnézet"}
                          className="h-full min-h-[70vh] w-full"
                        />
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-4 rounded-2xl bg-slate-950 p-8 text-center">
                        <FileText className="h-10 w-10 text-slate-300" />
                        <div>
                          <div className="text-lg font-semibold text-white">Ehhez a fájltípushoz nincs beépített előnézet</div>
                          <div className="mt-2 text-sm text-slate-400">
                            A dokumentum letölthető, majd megnyitható a saját alkalmazásával.
                          </div>
                        </div>
                        <Button className="rounded-2xl" onClick={() => downloadStoredDocument(documentPreview)}>
                          <Download className="mr-2 h-4 w-4" />
                          Letöltés
                        </Button>
                      </div>
                    )
                  ) : (
                    <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl bg-slate-950 text-sm text-slate-400">
                      Nincs megjeleníthető fájl.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-white/10 px-5 py-4 sm:px-6">
                <Button
                  variant="secondary"
                  className="rounded-2xl"
                  onClick={() => setDocumentPreview(null)}
                >
                  Bezárás
                </Button>
                {documentPreview.fileDataUrl && (
                  <Button className="rounded-2xl" onClick={() => downloadStoredDocument(documentPreview)}>
                    <Download className="mr-2 h-4 w-4" />
                    Letöltés
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .fleet-timeline-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(34, 211, 238, 0.5) transparent;
          scroll-behavior: smooth;
        }
        .fleet-timeline-scroll::-webkit-scrollbar {
          width: 8px;
        }
        .fleet-timeline-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .fleet-timeline-scroll::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: linear-gradient(
            to bottom,
            rgba(34,211,238,0.55),
            rgba(139,92,246,0.45)
          );
          box-shadow: 0 0 10px rgba(34,211,238,0.14);
        }
      `}</style>

      <ExportDialog
        exportOpen={exportOpen}
        setExportOpen={setExportOpen}
        exportOptions={exportOptions}
        toggleExportOption={toggleExportOption}
        exportIncludeArchived={exportIncludeArchived}
        setExportIncludeArchived={setExportIncludeArchived}
        handleExportDownload={handleExportDownload}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fleet-dialog sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Új autó felvétele</DialogTitle>
            <DialogDescription>
              Add meg az alapadatokat. A következő szerviz automatikusan számolódik.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Autó neve</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Rendszám</Label>
              <Input
                value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Jelenlegi km</Label>
              <Input
                type="number"
                value={form.currentKm}
                onChange={(e) => setForm({ ...form, currentKm: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Előző szerviz km</Label>
              <Input
                type="number"
                value={form.lastServiceKm}
                onChange={(e) => setForm({ ...form, lastServiceKm: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Sofőr</Label>
              <Select
                value={form.ownerMode}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    ownerMode: value,
                  }))
                }
              >
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownerOptions.map((owner) => (
                    <SelectItem key={owner} value={owner}>
                      {owner}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_OWNER_VALUE}>Egyéb</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Évjárat</Label>
              <Input
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            {form.ownerMode === CUSTOM_OWNER_VALUE && (
              <div className="space-y-2 md:col-span-2">
                <Label>Egyéb sofőr</Label>
                <Input
                  value={form.customOwner}
                  onChange={(e) => setForm({ ...form, customOwner: e.target.value })}
                  className="fleet-input rounded-2xl"
                />
              </div>
            )}

            <div className="space-y-2 md:col-span-2">
              <Label>Alvázszám</Label>
              <Input
                value={form.vin}
                onChange={(e) => setForm({ ...form, vin: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Üzemanyag</Label>
              <Select value={form.fuelType} onValueChange={(value) => setForm({ ...form, fuelType: value })}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Benzin">Benzin</SelectItem>
                  <SelectItem value="Dízel">Dízel</SelectItem>
                  <SelectItem value="Hibrid">Hibrid</SelectItem>
                  <SelectItem value="Elektromos">Elektromos</SelectItem>
                  <SelectItem value="LPG">LPG</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Biztosítás lejárat</Label>
              <Input
                type="date"
                value={form.insuranceExpiry}
                onChange={(e) => setForm({ ...form, insuranceExpiry: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Műszaki vizsga lejárat</Label>
              <Input
                type="date"
                value={form.inspectionExpiry}
                onChange={(e) => setForm({ ...form, inspectionExpiry: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Olajcsere ciklus (km)</Label>
              <Input
                type="number"
                value={form.oilChangeIntervalKm}
                onChange={(e) => setForm({ ...form, oilChangeIntervalKm: e.target.value })}
                placeholder="pl. 15000"
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Vezérlés csere ciklus (km)</Label>
              <Input
                type="number"
                value={form.timingBeltIntervalKm}
                onChange={(e) => setForm({ ...form, timingBeltIntervalKm: e.target.value })}
                placeholder="pl. 180000"
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Megjegyzés</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="fleet-input rounded-2xl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button className="fleet-dialog-btn fleet-dialog-btn--ghost rounded-2xl" onClick={() => setOpen(false)}>
              Mégse
            </Button>
            <Button className="fleet-dialog-btn fleet-dialog-btn--primary rounded-2xl" onClick={addVehicle}>
              Mentés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={!!documentToRemove} onOpenChange={() => setDocumentToRemove(null)}>
        <DialogContent className="fleet-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dokumentum eltávolítása</DialogTitle>
            <DialogDescription>
              Biztosan eltávolítod a <span className="font-semibold text-white">{documentToRemove?.docTitle}</span>{" "}
              dokumentum feltöltött fájlját? A kiválasztott fájl törlésre kerül; ha ez az utolsó fájl, a kategória lejárat / megjegyzés értékei megmaradhatnak.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button className="fleet-dialog-btn fleet-dialog-btn--ghost rounded-2xl" onClick={() => setDocumentToRemove(null)}>
              Mégse
            </Button>
            <Button className="fleet-dialog-btn fleet-dialog-btn--danger rounded-2xl" onClick={confirmDocumentRemove}>
              Eltávolítás
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ownerToDelete} onOpenChange={() => setOwnerToDelete(null)}>
        <DialogContent className="fleet-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sofőr törlése</DialogTitle>
            <DialogDescription>
              Biztosan törölni szeretné az <span className="font-semibold text-white">{ownerToDelete}</span>{" "}
              sofőrt a rendszerből?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button className="fleet-dialog-btn fleet-dialog-btn--ghost rounded-2xl" onClick={() => setOwnerToDelete(null)}>
              Mégse
            </Button>
            <Button className="fleet-dialog-btn fleet-dialog-btn--danger rounded-2xl" onClick={deleteOwner}>
              Végleges törlés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!vehicleToArchive} onOpenChange={() => setVehicleToArchive(null)}>
        <DialogContent className="fleet-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Jármű archiválása</DialogTitle>
            <DialogDescription>
              Biztosan archiválni szeretné a <span className="font-semibold text-white">{vehicleToArchive?.name}</span>{" "}
              járművet?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button className="fleet-dialog-btn fleet-dialog-btn--ghost rounded-2xl" onClick={() => setVehicleToArchive(null)}>
              Mégse
            </Button>
            <Button className="fleet-dialog-btn fleet-dialog-btn--primary rounded-2xl" onClick={archiveSelectedVehicle}>
              Archiválás
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!vehicleToDelete} onOpenChange={() => setVehicleToDelete(null)}>
        <DialogContent className="fleet-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Végleges törlés</DialogTitle>
            <DialogDescription>
              Biztosan véglegesen törölni szeretné a <span className="font-semibold text-white">{vehicleToDelete?.name}</span>{" "}
              járművett a rendszerből?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button className="fleet-dialog-btn fleet-dialog-btn--ghost rounded-2xl" onClick={() => setVehicleToDelete(null)}>
              Mégse
            </Button>
            <Button className="fleet-dialog-btn fleet-dialog-btn--danger rounded-2xl" onClick={deleteVehiclePermanently}>
              Végleges törlés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}