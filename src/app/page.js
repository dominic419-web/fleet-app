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
  LogOut,
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


import { supabase } from "@/lib/supabase";
import ExportDialog from "@/components/fleet/ExportDialog";
import { ExpiryBadge, NotificationTypeBadge, StatusBadge } from "@/components/fleet/FleetBadges";
import {
  CUSTOM_OWNER_VALUE,
  STORAGE_KEYS,
  initialOwnerOptions,
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
  resolveOwnerValue,
  getDocUploadStatus,
  severityRank,
  csvEscape,
  downloadFile,
} from "@/lib/fleet-utils";

const SERVICE_CYCLE_KM = 20000;
const WARNING_THRESHOLD_KM = 3000;

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



const parseLastServiceKmFromEntry = (entry) => {
  const sources = [entry?.detail, entry?.title, entry?.note].filter(Boolean);

  for (const source of sources) {
    const value = String(source);

    const explicitMatch = value.match(/Utolsó\s+szerviz:\s*([\d\s.,]+)/i);
    if (explicitMatch?.[1]) {
      const normalized = explicitMatch[1].replace(/[^\d]/g, "");
      if (normalized) return Number(normalized);
    }

    const reverseMatch = value.match(/([\d\s.,]+)\s*km\s+utolsó\s+szerviz/i);
    if (reverseMatch?.[1]) {
      const normalized = reverseMatch[1].replace(/[^\d]/g, "");
      if (normalized) return Number(normalized);
    }
  }

  return null;
};

const buildVehicleStateFromHistory = (history, fallbackVehicle = null) => {
  const normalizedHistory = Array.isArray(history)
    ? history.map(normalizeServiceHistoryItem)
    : [];

  const sortedByDateDesc = [...normalizedHistory].sort((a, b) => {
    const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateDiff !== 0) return dateDiff;
    return Number(b.km || 0) - Number(a.km || 0);
  });

  const latestKmEntry = sortedByDateDesc.find(
    (entry) => entry.km !== null && entry.km !== undefined && !Number.isNaN(Number(entry.km))
  );

  const latestServiceEntry = sortedByDateDesc.find(
    (entry) =>
      entry.isServiceRecord &&
      entry.km !== null &&
      entry.km !== undefined &&
      !Number.isNaN(Number(entry.km))
  );

  const baselineLastServiceEntry = sortedByDateDesc.find(
    (entry) => parseLastServiceKmFromEntry(entry) !== null
  );

  const currentKm =
    latestKmEntry?.km !== undefined && latestKmEntry?.km !== null
      ? Number(latestKmEntry.km)
      : Number(fallbackVehicle?.currentKm || 0);

  const lastServiceKm =
    latestServiceEntry?.km !== undefined && latestServiceEntry?.km !== null
      ? Number(latestServiceEntry.km)
      : baselineLastServiceEntry
      ? Number(parseLastServiceKmFromEntry(baselineLastServiceEntry))
      : Number(fallbackVehicle?.lastServiceKm || 0);

  return {
    currentKm,
    lastServiceKm,
    serviceHistory: normalizedHistory,
  };
};

const mapServiceHistoryRowToEntry = (row) =>
  normalizeServiceHistoryItem({
    id: row?.id,
    date: row?.entry_date || todayIso(),
    type: "service-record",
    title: row?.title || row?.service_type || "Szerviz esemény",
    detail: [
      row?.provider ? `Partner: ${row.provider}` : null,
      Number(row?.cost || 0) > 0 ? `Költség: ${formatCurrencyHu(Number(row.cost || 0))}` : null,
      row?.note ? `Megjegyzés: ${row.note}` : null,
    ]
      .filter(Boolean)
      .join(" • "),
    km:
      row?.km === null || row?.km === undefined || Number.isNaN(Number(row?.km))
        ? null
        : Number(row.km),
    serviceType: row?.service_type || row?.title || "",
    cost: Number(row?.cost || 0),
    provider: row?.provider || "",
    note: row?.note || "",
    isServiceRecord: true,
  });

const mapKmLogRowToEntry = (row) =>
  normalizeServiceHistoryItem({
    id: row?.id,
    date: row?.entry_date || todayIso(),
    type: "km-update",
    title: "Km frissítés",
    detail: row?.note ? `Megjegyzés: ${row.note}` : "Futásteljesítmény frissítve",
    km:
      row?.km === null || row?.km === undefined || Number.isNaN(Number(row?.km))
        ? null
        : Number(row.km),
    serviceType: "",
    cost: 0,
    provider: "",
    note: row?.note || "",
    isServiceRecord: false,
  });

const combineHistorySources = ({
  embeddedHistory = [],
  serviceRows = [],
  kmRows = [],
}) => {
  const combined = [
    ...(Array.isArray(embeddedHistory) ? embeddedHistory : []).map(normalizeServiceHistoryItem),
    ...(Array.isArray(serviceRows) ? serviceRows : []).map(mapServiceHistoryRowToEntry),
    ...(Array.isArray(kmRows) ? kmRows : []).map(mapKmLogRowToEntry),
  ];

  const deduped = Array.from(
    new Map(combined.map((entry) => [String(entry.id), normalizeServiceHistoryItem(entry)])).values()
  );

  return deduped.sort((a, b) => {
    const dateDiff = String(b.date || "").localeCompare(String(a.date || ""));
    if (dateDiff !== 0) return dateDiff;
    return Number(b.km || 0) - Number(a.km || 0);
  });
};

const attachHistoryToVehicles = (vehiclesList = [], serviceRows = [], kmRows = []) => {
  return (Array.isArray(vehiclesList) ? vehiclesList : []).map((vehicle) => {
    const embeddedHistory = Array.isArray(vehicle?.serviceHistory) ? vehicle.serviceHistory : [];
    const vehicleServiceRows = (Array.isArray(serviceRows) ? serviceRows : []).filter(
      (row) => Number(row?.vehicle_id) === Number(vehicle?.id)
    );
    const vehicleKmRows = (Array.isArray(kmRows) ? kmRows : []).filter(
      (row) => Number(row?.vehicle_id) === Number(vehicle?.id)
    );

    const combinedHistory = combineHistorySources({
      embeddedHistory,
      serviceRows: vehicleServiceRows,
      kmRows: vehicleKmRows,
    });

    return ensureVehicleHistory({
      ...vehicle,
      serviceHistory: combinedHistory,
    });
  });
};

const fetchVehicleHistoryRows = async (vehicleId, userId = null) => {
  let serviceQuery = supabase
    .from("service_history")
    .select("*")
    .eq("vehicle_id", vehicleId);

  let kmQuery = supabase
    .from("km_logs")
    .select("*")
    .eq("vehicle_id", vehicleId);

  if (userId) {
    serviceQuery = serviceQuery.eq("user_id", userId);
    kmQuery = kmQuery.eq("user_id", userId);
  }

  const [{ data: serviceRows, error: serviceError }, { data: kmRows, error: kmError }] =
    await Promise.all([
      serviceQuery.order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
      kmQuery.order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
    ]);

  return {
    serviceRows: serviceRows || [],
    kmRows: kmRows || [],
    error: serviceError || kmError || null,
  };
};

const OIL_SERVICE_LABEL = "Olajcsere";
const TIMING_SERVICE_LABEL = "Vezérlés csere";
const GENERAL_SERVICE_LABEL = "Általános szerviz";
const CUSTOM_SERVICE_VALUE = "__custom_service__";

const resolveServiceHistoryType = (draft) => {
  if (draft.serviceType === "oil") return OIL_SERVICE_LABEL;
  if (draft.serviceType === "timing") return TIMING_SERVICE_LABEL;
  if (draft.serviceType === "general") return GENERAL_SERVICE_LABEL;
  return (draft.customServiceType || "").trim();
};

const getLatestServiceKmByType = (vehicle, serviceLabel) => {
  if (!vehicle) return Number(vehicle?.lastServiceKm || 0);
  const history = Array.isArray(vehicle.serviceHistory) ? vehicle.serviceHistory : [];
  const record = [...history]
    .map(normalizeServiceHistoryItem)
    .filter((entry) => entry.isServiceRecord && entry.serviceType === serviceLabel && entry.km !== null && entry.km !== undefined)
    .sort((a, b) => Number(b.km || 0) - Number(a.km || 0))[0];
  return Number(record?.km ?? vehicle.lastServiceKm ?? 0);
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

  const [vehicles, setVehicles] = useState(initialVehicles);
  const [ownerOptions, setOwnerOptions] = useState(initialOwnerOptions);
  const [documentsByVehicle, setDocumentsByVehicle] = useState(
    createInitialDocsMap(initialVehicles)
  );
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings);
  const [acknowledgedNotifications, setAcknowledgedNotifications] = useState({});
  const [dismissedNotifications, setDismissedNotifications] = useState({});

  const [selectedId, setSelectedId] = useState(initialVehicles[0].id);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [activePage, setActivePage] = useState("szerviz");
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

  const currentUser = session?.user ?? null;
  const scopedStorageKey = (key) => (currentUser?.id ? `${key}-${currentUser.id}` : key);

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
        normalizeServiceHistoryItem(
          createTimelineEntry({
            type: "baseline",
            title: "Kiinduló állapot",
            detail: `${formatKmHu(vehicle?.currentKm || 0)} km aktuális futás, ${formatKmHu(
              vehicle?.lastServiceKm || 0
            )} km utolsó szerviz.`,
            km: vehicle?.currentKm || 0,
          })
        ),
      ],
    };
  };


  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Auth session load error:", error);
      }
      if (isMounted) {
        setSession(data?.session ?? null);
        setAuthReady(true);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handlePasswordLogin = async () => {
    const email = authEmail.trim();
    const password = authPassword;

    if (!email || !password) {
      showToast("Add meg az email címet és a jelszót", "error");
      return;
    }

    setAuthSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setAuthSubmitting(false);

    if (error) {
      showToast(`Belépési hiba: ${error.message}`, "error");
      return;
    }

    setAuthPassword("");
    showToast("Sikeres bejelentkezés", "success");
  };

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      showToast(`Kilépési hiba: ${error.message}`, "error");
      return;
    }
    setHydrated(false);
    showToast("Sikeres kilépés", "success");
  };

  useEffect(() => {
    if (!authReady || !currentUser?.id) return;

    const initializeApp = async () => {
      const fallbackVehicles = safeRead(
        scopedStorageKey(STORAGE_KEYS.vehicles),
        initialVehicles
      ).map(ensureVehicleHistory);

      const savedOwners = safeRead(scopedStorageKey(STORAGE_KEYS.owners), initialOwnerOptions);
      const savedEmail = safeRead(scopedStorageKey(STORAGE_KEYS.email), defaultEmailSettings);
      const savedAck = safeRead(scopedStorageKey(STORAGE_KEYS.ack), {});
      const savedDismissed = safeRead(scopedStorageKey(STORAGE_KEYS.dismissed), {});
      const savedUi = safeRead(scopedStorageKey(STORAGE_KEYS.ui), {
        selectedId: fallbackVehicles[0]?.id ?? null,
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

      let loadedVehicles = fallbackVehicles;

      try {
        await Promise.all([
          supabase.from("vehicles").update({ user_id: currentUser.id }).is("user_id", null),
          supabase.from("service_history").update({ user_id: currentUser.id }).is("user_id", null),
          supabase.from("km_logs").update({ user_id: currentUser.id }).is("user_id", null),
        ]);

        const { data, error } = await supabase
          .from("vehicles")
          .select("*")
          .eq("user_id", currentUser.id)
          .order("id", { ascending: false });

        if (error) {
          console.error("Supabase vehicle load error:", error);
        } else if (Array.isArray(data) && data.length > 0) {
          const [serviceResult, kmResult] = await Promise.all([
            supabase
              .from("service_history")
              .select("*")
              .eq("user_id", currentUser.id)
              .order("entry_date", { ascending: false })
              .order("created_at", { ascending: false }),
            supabase
              .from("km_logs")
              .select("*")
              .eq("user_id", currentUser.id)
              .order("entry_date", { ascending: false })
              .order("created_at", { ascending: false }),
          ]);

          if (serviceResult.error) {
            console.error("Supabase service_history load error:", serviceResult.error);
          }

          if (kmResult.error) {
            console.error("Supabase km_logs load error:", kmResult.error);
          }

          loadedVehicles = attachHistoryToVehicles(
            data,
            serviceResult.data || [],
            kmResult.data || []
          );
        } else if (Array.isArray(data) && data.length === 0) {
          loadedVehicles = [];
        }
      } catch (err) {
        console.error("Vehicle initialization error:", err);
      }

      const savedDocs = safeRead(
        scopedStorageKey(STORAGE_KEYS.docs),
        createInitialDocsMap(loadedVehicles)
      );

      setVehicles(loadedVehicles);
      setOwnerOptions(savedOwners);
      setDocumentsByVehicle(savedDocs);
      setEmailSettings(savedEmail);
      setAcknowledgedNotifications(savedAck);
      setDismissedNotifications(savedDismissed);

      setSelectedId(savedUi.selectedId ?? loadedVehicles[0]?.id ?? null);
      setActivePage(savedUi.activePage || "szerviz");
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

      setHydrated(true);
    };

    initializeApp();
  }, [authReady, currentUser?.id]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(scopedStorageKey(STORAGE_KEYS.vehicles), vehicles);
  }, [vehicles, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(scopedStorageKey(STORAGE_KEYS.owners), ownerOptions);
  }, [ownerOptions, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(scopedStorageKey(STORAGE_KEYS.docs), documentsByVehicle);
  }, [documentsByVehicle, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(scopedStorageKey(STORAGE_KEYS.email), emailSettings);
  }, [emailSettings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(scopedStorageKey(STORAGE_KEYS.ack), acknowledgedNotifications);
  }, [acknowledgedNotifications, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    safeWrite(scopedStorageKey(STORAGE_KEYS.dismissed), dismissedNotifications);
  }, [dismissedNotifications, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    safeWrite(scopedStorageKey(STORAGE_KEYS.ui), {
      selectedId,
      activePage,
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
      const matchesQuery = [v.name, v.plate, v.owner, v.note]
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

      if (!vehicle.owner || !vehicle.owner.trim()) {
        items.push({
          id: `owner-missing-${vehicle.id}`,
          category: "owner",
          type: "ownerMissing",
          status: "late",
          vehicleId: vehicle.id,
          title: `${vehicle.name} tulajdonosa nincs beállítva`,
          description: `${vehicle.plate} • Állíts be tulajdonost az autóhoz.`,
        });
      }

      const vehicleDocs = documentsByVehicle[String(vehicle.id)] || {};
      Object.entries(vehicleDocs).forEach(([docKey, doc]) => {
        const docStatus = getDocUploadStatus(doc);

        if (docStatus.status === "missing") {
          items.push({
            id: `doc-missing-${vehicle.id}-${docKey}`,
            category: "docs",
            type: "docMissing",
            status: "missing",
            vehicleId: vehicle.id,
            title: `${vehicle.name} dokumentuma hiányzik`,
            description: `${vehicle.plate} • ${doc.title} nincs feltöltve.`,
          });
        }

        if (docStatus.status === "warning") {
          items.push({
            id: `doc-warning-${vehicle.id}-${docKey}-${doc.expiry}`,
            category: "docs",
            type: "docWarning",
            status: "warning",
            vehicleId: vehicle.id,
            title: `${vehicle.name} dokumentuma hamarosan lejár`,
            description: `${vehicle.plate} • ${doc.title}: ${docStatus.helper}.`,
          });
        }

        if (docStatus.status === "late") {
          items.push({
            id: `doc-late-${vehicle.id}-${docKey}-${doc.expiry}`,
            category: "docs",
            type: "docLate",
            status: "late",
            vehicleId: vehicle.id,
            title: `${vehicle.name} dokumentuma lejárt`,
            description: `${vehicle.plate} • ${doc.title}: ${docStatus.helper}.`,
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
    const ownerNotifications = allNotifications.filter((item) => item.category === "owner");

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

    const ownerState = getOwnerModeAndCustom(selectedVehicle.owner, ownerOptions);

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
          next[idKey] = createDefaultVehicleDocs(
            vehicle.insuranceExpiry,
            vehicle.inspectionExpiry
          );
        } else {
          if (next[idKey].insurance && !next[idKey].insurance.expiry) {
            next[idKey].insurance.expiry = vehicle.insuranceExpiry || "";
          }
          if (next[idKey].inspection && !next[idKey].inspection.expiry) {
            next[idKey].inspection.expiry = vehicle.inspectionExpiry || "";
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
      createDefaultVehicleDocs(
        selectedVehicle.insuranceExpiry,
        selectedVehicle.inspectionExpiry
      )
    : null;

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

  const handleFileUpload = (vehicleId, docKey, file) => {
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

    const reader = new FileReader();
    reader.onload = () => {
      const fileDataUrl = typeof reader.result === "string" ? reader.result : "";

      setDocumentsByVehicle((prev) => {
        const idKey = String(vehicleId);
        const vehicleDocs = prev[idKey] || createDefaultVehicleDocs();
        const doc = vehicleDocs[docKey];

        return {
          ...prev,
          [idKey]: {
            ...vehicleDocs,
            [docKey]: {
              ...doc,
              uploaded: true,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
              fileDataUrl,
              uploadedAt: todayIso(),
            },
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
    const blob = dataUrlToBlob(doc?.fileDataUrl);
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

  const downloadStoredDocument = (doc) => {
    if (!doc?.fileDataUrl) {
      showToast("Ehhez a dokumentumhoz nincs letölthető fájl", "error");
      return;
    }

    const link = document.createElement("a");
    link.href = doc.fileDataUrl;
    link.download = doc.fileName || "dokumentum";
    document.body.appendChild(link);
    link.click();
    link.remove();
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
    createDefaultVehicleDocs(vehicle.insuranceExpiry, vehicle.inspectionExpiry);
  const missingDocs = Object.values(docs || {}).filter((doc) => !doc?.uploaded).length;

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
  if (!vehicle.owner) score -= 8;

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
        "Tulajdonos",
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
          vehicle.owner || "",
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
        createDefaultVehicleDocs(vehicle.insuranceExpiry, vehicle.inspectionExpiry);

      Object.values(vehicleDocs).forEach((doc) => {
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
    "Tulajdonos",
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
      createDefaultVehicleDocs(vehicle.insuranceExpiry, vehicle.inspectionExpiry);
    const missingDocs = Object.values(docs || {}).filter((doc) => !doc?.uploaded).length;

    rows.push([
      vehicle.name,
      vehicle.plate,
      vehicle.owner || "",
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
    if (!currentUser?.id) return;
    const resolvedOwner = resolveOwnerValue(
      vehicleDetailsForm.ownerMode,
      vehicleDetailsForm.customOwner
    );

    if (!vehicleDetailsForm.name.trim() || !vehicleDetailsForm.plate.trim() || !selectedVehicle) {
      return;
    }

    if (resolvedOwner && !ownerOptions.includes(resolvedOwner)) {
      setOwnerOptions((prev) => [...prev, resolvedOwner]);
    }

    const vehiclePayload = {
      name: vehicleDetailsForm.name.trim(),
      plate: vehicleDetailsForm.plate.toUpperCase().trim(),
      owner: resolvedOwner,
      note: vehicleDetailsForm.note || "",
      year: vehicleDetailsForm.year || "",
      vin: vehicleDetailsForm.vin.toUpperCase() || "",
      fuelType: vehicleDetailsForm.fuelType || "Benzin",
      insuranceExpiry: vehicleDetailsForm.insuranceExpiry || "",
      inspectionExpiry: vehicleDetailsForm.inspectionExpiry || "",
      oilChangeIntervalKm:
        vehicleDetailsForm.oilChangeIntervalKm === ""
          ? null
          : Number(vehicleDetailsForm.oilChangeIntervalKm),
      timingBeltIntervalKm:
        vehicleDetailsForm.timingBeltIntervalKm === ""
          ? null
          : Number(vehicleDetailsForm.timingBeltIntervalKm),
    };

    const { data, error } = await supabase
      .from("vehicles")
      .update(vehiclePayload)
      .eq("id", selectedId)
      .eq("user_id", currentUser.id)
      .select();

    console.log("SUPABASE UPDATE DATA:", data);
    console.log("SUPABASE UPDATE ERROR:", error);

    if (error) {
      showToast(`Mentési hiba: ${error.message}`, "error");
      return;
    }

    const updatedVehicle = data?.[0];

    if (updatedVehicle) {
      setVehicles((prev) =>
        prev.map((v) =>
          v.id === selectedId ? ensureVehicleHistory(updatedVehicle) : v
        )
      );
    }

    setDocumentsByVehicle((prev) => {
      const idKey = String(selectedId);
      const current = prev[idKey] || createDefaultVehicleDocs();
      return {
        ...prev,
        [idKey]: {
          ...current,
          insurance: {
            ...current.insurance,
            expiry: vehicleDetailsForm.insuranceExpiry || "",
          },
          inspection: {
            ...current.inspection,
            expiry: vehicleDetailsForm.inspectionExpiry || "",
          },
        },
      };
    });

    setIsVehicleDetailsEditing(false);
    showSaved("Adatok mentve");
  };

  const startVehicleDetailsEditing = () => {
    if (!selectedVehicle) return;

    const ownerState = getOwnerModeAndCustom(selectedVehicle.owner, ownerOptions);

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

    const ownerState = getOwnerModeAndCustom(selectedVehicle.owner, ownerOptions);

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

  const saveServiceDraft = () => {
    const currentKmValue = Number.isNaN(Number(serviceDraft.currentKm))
      ? 0
      : Number(serviceDraft.currentKm);
    const lastServiceKmValue = Number.isNaN(Number(serviceDraft.lastServiceKm))
      ? 0
      : Number(serviceDraft.lastServiceKm);

    setVehicles((prev) =>
      prev.map((v) =>
        v.id === selectedId
          ? {
              ...v,
              currentKm: currentKmValue,
              lastServiceKm: lastServiceKmValue,
              serviceHistory: [
                createTimelineEntry({
                  type: "update",
                  title: "Szerviz adatok frissítve",
                  detail: `Aktuális: ${formatKmHu(currentKmValue)} km • Utolsó szerviz: ${formatKmHu(lastServiceKmValue)} km`,
                  km: currentKmValue,
                }),
                ...(Array.isArray(v.serviceHistory) ? v.serviceHistory : []),
              ].slice(0, 8),
            }
          : v
      )
    );

    showSaved("Szerviz adatok mentve");
  };

  const registerServiceNow = () => {
    const currentKmValue = Number.isNaN(Number(serviceDraft.currentKm))
      ? 0
      : Number(serviceDraft.currentKm);

    setServiceDraft({
      currentKm: String(currentKmValue),
      lastServiceKm: String(currentKmValue),
    });

    setVehicles((prev) =>
      prev.map((v) =>
        v.id === selectedId
          ? {
              ...v,
              currentKm: currentKmValue,
              lastServiceKm: currentKmValue,
              serviceHistory: [
                createTimelineEntry({
                  type: "service",
                  title: "Szerviz rögzítve",
                  detail: `Új ciklus indult ${formatKmHu(currentKmValue)} km állástól.`,
                  km: currentKmValue,
                }),
                ...(Array.isArray(v.serviceHistory) ? v.serviceHistory : []),
              ].slice(0, 8),
            }
          : v
      )
    );

    showSaved("Szerviz rögzítve");
  };

  const addServiceHistoryEntry = async () => {
    if (!currentUser?.id) return;
    if (!selectedVehicle) return;

    const kmValue =
      serviceHistoryDraft.km === ""
        ? Number(selectedVehicle.currentKm || 0)
        : Number.isNaN(Number(serviceHistoryDraft.km))
        ? Number(selectedVehicle.currentKm || 0)
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

    const newEntry = createServiceRecordEntry({
      date: serviceHistoryDraft.date,
      serviceType: resolvedServiceType,
      km: kmValue,
      cost: costValue,
      provider: serviceHistoryDraft.provider.trim(),
      note: serviceHistoryDraft.note.trim(),
    });

    const currentHistory = Array.isArray(selectedVehicle.serviceHistory)
      ? selectedVehicle.serviceHistory.map(normalizeServiceHistoryItem)
      : [];
    const updatedCurrentKm = kmValue;

    const { data: insertedRows, error: insertError } = await supabase
      .from("service_history")
      .insert([
        {
          vehicle_id: selectedId,
          user_id: currentUser.id,
          entry_date: serviceHistoryDraft.date,
          km: kmValue,
          service_type: resolvedServiceType,
          title: resolvedServiceType,
          cost: costValue,
          provider: serviceHistoryDraft.provider.trim(),
          note: serviceHistoryDraft.note.trim(),
        },
      ])
      .select();

    console.log("SUPABASE SERVICE ENTRY DATA:", insertedRows);
    console.log("SUPABASE SERVICE ENTRY ERROR:", insertError);

    if (insertError) {
      showToast(`Mentési hiba: ${insertError.message}`, "error");
      return;
    }

    const insertedEntry = insertedRows?.[0]
      ? mapServiceHistoryRowToEntry(insertedRows[0])
      : newEntry;

    const updatedHistory = [insertedEntry, ...currentHistory].slice(0, 50);

    const { data: updatedVehicles, error: updateError } = await supabase
      .from("vehicles")
      .update({
        currentKm: updatedCurrentKm,
        lastServiceKm: kmValue,
      })
      .eq("id", selectedId)
      .eq("user_id", currentUser.id)
      .select();

    if (updateError) {
      showToast(`Mentési hiba: ${updateError.message}`, "error");
      return;
    }

    const updatedVehicle = updatedVehicles?.[0];

    if (updatedVehicle) {
      setVehicles((prev) =>
        prev.map((vehicle) =>
          vehicle.id === selectedId
            ? ensureVehicleHistory({
                ...updatedVehicle,
                serviceHistory: updatedHistory,
              })
            : vehicle
        )
      );
    }

    setServiceDraft({
      currentKm: String(updatedCurrentKm),
      lastServiceKm: String(kmValue),
    });

    setServiceHistoryDraft({
      date: todayIso(),
      km: String(updatedCurrentKm),
      serviceType: "general",
      customServiceType: "",
      cost: "",
      provider: "",
      note: "",
    });

    setKmUpdateDraft((prev) => ({
      ...prev,
      km: String(updatedCurrentKm),
    }));

    showSaved("Szerviz bejegyzés hozzáadva");
  };


const handleKmUpdate = async () => {
  if (!currentUser?.id) return;
  if (!selectedVehicle) return;

  const kmValue = Number(kmUpdateDraft.km);
  if (!kmUpdateDraft.date || Number.isNaN(kmValue) || kmValue <= 0) {
    showToast("Dátum és érvényes km óraállás megadása kötelező", "error");
    return;
  }

  const newEntry = createKmUpdateEntry({
    date: kmUpdateDraft.date,
    km: kmValue,
    note: kmUpdateDraft.note.trim(),
  });

  const currentHistory = Array.isArray(selectedVehicle.serviceHistory)
    ? selectedVehicle.serviceHistory.map(normalizeServiceHistoryItem)
    : [];

  const { data: insertedRows, error: insertError } = await supabase
    .from("km_logs")
    .insert([
      {
        vehicle_id: selectedId,
        user_id: currentUser.id,
        entry_date: kmUpdateDraft.date,
        km: kmValue,
        note: kmUpdateDraft.note.trim(),
      },
    ])
    .select();

  console.log("SUPABASE KM UPDATE DATA:", insertedRows);
  console.log("SUPABASE KM UPDATE ERROR:", insertError);

  if (insertError) {
    showToast(`Mentési hiba: ${insertError.message}`, "error");
    return;
  }

  const insertedEntry = insertedRows?.[0]
    ? mapKmLogRowToEntry(insertedRows[0])
    : newEntry;
  const updatedHistory = [insertedEntry, ...currentHistory].slice(0, 50);

  const { data: updatedVehicles, error: updateError } = await supabase
    .from("vehicles")
    .update({
      currentKm: kmValue,
    })
    .eq("id", selectedId)
    .eq("user_id", currentUser.id)
    .select();

  if (updateError) {
    showToast(`Mentési hiba: ${updateError.message}`, "error");
    return;
  }

  const updatedVehicle = updatedVehicles?.[0];

  if (updatedVehicle) {
    setVehicles((prev) =>
      prev.map((vehicle) =>
        vehicle.id === selectedId
          ? ensureVehicleHistory({
              ...updatedVehicle,
              serviceHistory: updatedHistory,
            })
          : vehicle
      )
    );
  }

  setServiceDraft((prev) => ({
    ...prev,
    currentKm: String(kmValue),
  }));

  setServiceHistoryDraft((prev) => ({
    ...prev,
    km: String(kmValue),
  }));

  setKmUpdateDraft({
    date: todayIso(),
    km: "",
    note: "",
  });

  showSaved("Km frissítés mentve");
};

  const removeServiceHistoryEntry = async (entryId) => {
    if (!currentUser?.id) return;
    if (!selectedVehicle) return;

    const targetEntry = (Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])
      .map(normalizeServiceHistoryItem)
      .find((entry) => String(entry.id) === String(entryId));

    if (!targetEntry) return;

    let deleteError = null;

    if (targetEntry.isServiceRecord) {
      const { error } = await supabase
        .from("service_history")
        .delete()
        .eq("id", entryId)
        .eq("vehicle_id", selectedId)
        .eq("user_id", currentUser.id);

      deleteError = error;
    } else if (targetEntry.type === "km-update") {
      const { error } = await supabase
        .from("km_logs")
        .delete()
        .eq("id", entryId)
        .eq("vehicle_id", selectedId)
        .eq("user_id", currentUser.id);

      deleteError = error;
    }

    console.log("SUPABASE HISTORY DELETE ERROR:", deleteError);

    if (deleteError) {
      showToast(`Törlési hiba: ${deleteError.message}`, "error");
      return;
    }

    const { serviceRows, kmRows, error: historyLoadError } = await fetchVehicleHistoryRows(selectedId, currentUser.id);

    if (historyLoadError) {
      showToast(`Törlés utáni betöltési hiba: ${historyLoadError.message}`, "error");
      return;
    }

    const embeddedHistory = (Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])
      .map(normalizeServiceHistoryItem)
      .filter(
        (entry) =>
          String(entry.id) !== String(entryId) &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            String(entry.id || "")
          )
      );

    const combinedHistory = combineHistorySources({
      embeddedHistory,
      serviceRows,
      kmRows,
    });

    const recalculatedState = buildVehicleStateFromHistory(combinedHistory, selectedVehicle);

    const { data: updatedVehicles, error: vehicleUpdateError } = await supabase
      .from("vehicles")
      .update({
        currentKm: recalculatedState.currentKm,
        lastServiceKm: recalculatedState.lastServiceKm,
      })
      .eq("id", selectedId)
      .eq("user_id", currentUser.id)
      .select();

    if (vehicleUpdateError) {
      showToast(`Törlési hiba: ${vehicleUpdateError.message}`, "error");
      return;
    }

    const updatedVehicle = updatedVehicles?.[0];

    if (updatedVehicle) {
      setVehicles((prev) =>
        prev.map((vehicle) =>
          vehicle.id === selectedId
            ? ensureVehicleHistory({
                ...updatedVehicle,
                serviceHistory: combinedHistory,
              })
            : vehicle
        )
      );

      setServiceDraft({
        currentKm: String(updatedVehicle.currentKm ?? recalculatedState.currentKm),
        lastServiceKm: String(updatedVehicle.lastServiceKm ?? recalculatedState.lastServiceKm),
      });

      setServiceHistoryDraft((prev) => ({
        ...prev,
        km: String(updatedVehicle.currentKm ?? recalculatedState.currentKm),
      }));

      setKmUpdateDraft((prev) => ({
        ...prev,
        km: String(updatedVehicle.currentKm ?? recalculatedState.currentKm),
      }));
    }

    showSaved("Szerviz bejegyzés törölve");
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
    showSaved("Tulajdonos hozzáadva");
  };

  const deleteOwner = () => {
    if (!ownerToDelete) return;

    setOwnerOptions((prev) => prev.filter((owner) => owner !== ownerToDelete));

    setVehicles((prev) =>
      prev.map((vehicle) =>
        vehicle.owner === ownerToDelete
          ? {
              ...vehicle,
              owner: "",
            }
          : vehicle
      )
    );

    setOwnerToDelete(null);
    showSaved("Tulajdonos törölve");
  };

  const addVehicle = async () => {
    if (!currentUser?.id) return;
    const resolvedOwner = resolveOwnerValue(form.ownerMode, form.customOwner);

    if (!form.name || !form.plate || !form.currentKm || !form.lastServiceKm) {
      return;
    }

    if (resolvedOwner && !ownerOptions.includes(resolvedOwner)) {
      setOwnerOptions((prev) => [...prev, resolvedOwner]);
    }

    const vehiclePayload = {
      name: form.name.trim(),
      plate: form.plate.toUpperCase().trim(),
      currentKm: Number(form.currentKm),
      lastServiceKm: Number(form.lastServiceKm),
      owner: resolvedOwner,
      note: form.note || "",
      year: form.year || "",
      vin: (form.vin || "").toUpperCase(),
      fuelType: form.fuelType || "Benzin",
      insuranceExpiry: form.insuranceExpiry || "",
      inspectionExpiry: form.inspectionExpiry || "",
      oilChangeIntervalKm:
        form.oilChangeIntervalKm === "" ? null : Number(form.oilChangeIntervalKm),
      timingBeltIntervalKm:
        form.timingBeltIntervalKm === "" ? null : Number(form.timingBeltIntervalKm),
      archived: false,
      user_id: currentUser.id,
    };

    const { data, error } = await supabase
      .from("vehicles")
      .insert([vehiclePayload])
      .select();

    console.log("SUPABASE INSERT DATA:", data);
    console.log("SUPABASE INSERT ERROR:", error);

    if (error) {
      showToast(`Mentési hiba: ${error.message}`, "error");
      return;
    }

    const insertedVehicle = data?.[0];

    if (insertedVehicle) {
      const normalizedVehicle = ensureVehicleHistory(insertedVehicle);

      setVehicles((prev) => [normalizedVehicle, ...prev]);

      setDocumentsByVehicle((prev) => ({
        ...prev,
        [String(normalizedVehicle.id)]: createDefaultVehicleDocs(
          normalizedVehicle.insuranceExpiry,
          normalizedVehicle.inspectionExpiry
        ),
      }));

      setSelectedId(normalizedVehicle.id);
    }

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
    setActivePage("adatok");
    setIsVehicleDetailsEditing(false);
    showSaved("Új autó felvéve");
  };

  const archiveSelectedVehicle = async () => {
    if (!currentUser?.id) return;
    if (!vehicleToArchive) return;

    const { error } = await supabase
      .from("vehicles")
      .update({ archived: true })
      .eq("id", vehicleToArchive.id)
      .eq("user_id", currentUser.id);

    if (error) {
      showToast(`Archiválási hiba: ${error.message}`, "error");
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
  };

  const restoreVehicle = async (vehicleId) => {
    if (!currentUser?.id) return;

    const { error } = await supabase
      .from("vehicles")
      .update({ archived: false })
      .eq("id", vehicleId)
      .eq("user_id", currentUser.id);

    if (error) {
      showToast(`Visszaállítási hiba: ${error.message}`, "error");
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
  };

  const deleteVehiclePermanently = async () => {
    if (!currentUser?.id) return;
    if (!vehicleToDelete) return;

    const vehicleId = vehicleToDelete.id;

    const { error } = await supabase
      .from("vehicles")
      .delete()
      .eq("id", vehicleId)
      .eq("user_id", currentUser.id);

    console.log("SUPABASE DELETE ERROR:", error);

    if (error) {
      showToast(`Törlési hiba: ${error.message}`, "error");
      return;
    }

    setVehicles((prev) => prev.filter((vehicle) => vehicle.id !== vehicleId));

    setDocumentsByVehicle((prev) => {
      const next = { ...prev };
      delete next[String(vehicleId)];
      return next;
    });

    if (selectedId === vehicleId) {
      const remainingVehicles = vehicles.filter(
        (vehicle) => vehicle.id !== vehicleId && !vehicle.archived
      );
      setSelectedId(remainingVehicles[0]?.id ?? null);
    }

    setVehicleToDelete(null);
    showSaved("Jármű véglegesen törölve");
  };

  const updateDocField = (vehicleId, docKey, field, value) => {
    setDocumentsByVehicle((prev) => {
      const idKey = String(vehicleId);
      const vehicleDocs = prev[idKey] || createDefaultVehicleDocs();
      const doc = vehicleDocs[docKey];

      return {
        ...prev,
        [idKey]: {
          ...vehicleDocs,
          [docKey]: {
            ...doc,
            [field]: value,
          },
        },
      };
    });
  };

  const removeDocument = (vehicleId, docKey) => {
    setDocumentsByVehicle((prev) => {
      const idKey = String(vehicleId);
      const vehicleDocs = prev[idKey] || createDefaultVehicleDocs();
      const doc = vehicleDocs[docKey];

      return {
        ...prev,
        [idKey]: {
          ...vehicleDocs,
          [docKey]: {
            ...doc,
            uploaded: false,
            fileName: "",
            fileType: "",
            fileSize: 0,
            fileDataUrl: "",
            uploadedAt: "",
          },
        },
      };
    });

    showSaved("Dokumentum eltávolítva");
  };

  const requestDocumentRemove = (vehicleId, docKey, docTitle) => {
    setDocumentToRemove({
      vehicleId,
      docKey,
      docTitle,
    });
  };

  const confirmDocumentRemove = () => {
    if (!documentToRemove) return;
    removeDocument(documentToRemove.vehicleId, documentToRemove.docKey);
    setDocumentToRemove(null);
  };


  if (!authReady) {
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
          <div className="fleet-card w-full rounded-3xl border border-white/10 bg-slate-950/70 p-8">
            <div className="mb-3 text-sm uppercase tracking-[0.22em] text-cyan-200/80">Fleet login</div>
            <h1 className="text-3xl font-bold text-white">Bejelentkezés</h1>
            <p className="mt-3 text-sm text-slate-400">
              Email és jelszó megadásával tudsz belépni a flottakezelőbe.
            </p>
            <div className="mt-6 space-y-3">
              <Label>Email cím</Label>
              <Input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="pelda@email.hu"
                className="fleet-input rounded-2xl"
              />
              <Label>Jelszó</Label>
              <Input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Jelszó"
                className="fleet-input rounded-2xl"
              />
              <Button className="w-full rounded-2xl" onClick={handlePasswordLogin} disabled={authSubmitting}>
                {authSubmitting ? "Belépés..." : "Belépés"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto flex min-h-screen max-w-md items-center justify-center px-6">
          <div className="fleet-card w-full rounded-3xl border border-white/10 bg-slate-950/70 p-8">
            <div className="mb-3 text-sm uppercase tracking-[0.22em] text-cyan-200/80">Fleet login</div>
            <h1 className="text-3xl font-bold text-white">Bejelentkezés</h1>
            <p className="mt-3 text-sm text-slate-400">
              Add meg az email címedet és a jelszavadat a belépéshez.
            </p>
            <div className="mt-6 space-y-3">
              <Label>Email cím</Label>
              <Input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="pelda@email.hu"
                className="fleet-input rounded-2xl"
              />
              <Label>Jelszó</Label>
              <Input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Jelszó"
                className="fleet-input rounded-2xl"
              />
              <Button className="w-full rounded-2xl" onClick={handlePasswordLogin} disabled={authSubmitting}>
                {authSubmitting ? "Belépés..." : "Belépés"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto max-w-7xl p-8 text-slate-400">Betöltés...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-50">
      <div className="fleet-topbar sticky top-0 z-50 border-b border-cyan-400/10 bg-slate-950/55 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-6 py-4 md:px-8">
          <button onClick={() => setActivePage("szerviz")} className={`${navButtonClass("szerviz")} ${activePage === "szerviz" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Szerviz
          </button>

          <button onClick={() => setActivePage("adatok")} className={`${navButtonClass("adatok")} ${activePage === "adatok" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Gépjármű adatok
          </button>

          <button onClick={() => setActivePage("dokumentumok")} className={`${navButtonClass("dokumentumok")} ${activePage === "dokumentumok" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Gépjármű dokumentumok
          </button>

          <button onClick={() => setActivePage("history")} className={`${navButtonClass("history")} ${activePage === "history" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Szerviz history
          </button>

          <button onClick={() => setActivePage("km")} className={`${navButtonClass("km")} ${activePage === "km" ? "fleet-tab-active" : "fleet-tab-inactive"}`}>
            Km frissítés
          </button>
        </div>
      </div>

      <div className="fleet-shell mx-auto max-w-7xl px-6 py-8 md:px-8">
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
              Letisztult, gyors, tulajdonosbarát kezelőfelület járművekhez,
              kilométerálláshoz, dokumentumokhoz és szerviz esedékességhez.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative" ref={notificationRef}>
              <Button
                variant="secondary"
                className="fleet-action-btn relative rounded-2xl"
                onClick={() => setNotificationOpen((prev) => !prev)}
              >
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -left-2 -top-2 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
                    {unreadNotificationsCount}
                  </span>
                )}
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
                        <SelectItem value="owner">Tulajdonos</SelectItem>
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

            <Button variant="secondary" className="fleet-action-btn rounded-2xl" onClick={() => setExportOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>

            <Button variant="secondary" className="fleet-action-btn rounded-2xl" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Kilépés
            </Button>

            {activePage === "adatok" && (
              <Button className="fleet-primary-btn rounded-2xl" onClick={() => setOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Új autó
              </Button>
            )}
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

        {activePage === "szerviz" && (
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
                    <div className="mb-2 text-xs uppercase tracking-[0.22em] text-cyan-200/80">Dokumentum / tulaj</div>
                    <div className="text-3xl font-bold text-white">
                      {prioritySummary.docsCount + prioritySummary.ownerCount}
                    </div>
                    <div className="mt-2 text-sm text-slate-300">Hiányzó dokumentum vagy tulajdonos beállítás.</div>
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
                        {prioritySummary.topVehicle.plate} • {prioritySummary.topVehicle.owner || "Nincs tulajdonos"} • {prioritySummary.topVehicle.dueType}
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
                            setActivePage("szerviz");
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
                          <span className="text-slate-400">Tulajdonos</span>
                          <span className="text-slate-200">{vehicle.owner || "Nincs tulajdonos"}</span>
                        </div>
                      </div>

                      <div className="mt-4">
                        <Button
                          variant="secondary"
                          className="rounded-2xl"
                          onClick={() => {
                            setSelectedId(vehicle.id);
                            setActivePage("history");
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

        {activePage === "adatok" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid gap-6 xl:grid-cols-2">
              <Card className="fleet-card rounded-3xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    Tulajdonosok kezelése
                  </CardTitle>
                  <CardDescription>Előre rögzített tulajdonosok hozzáadása és törlése</CardDescription>
                </CardHeader>

                <CardContent className="space-y-5">
                  <div className="flex flex-col gap-3 md:flex-row">
                    <Input
                      value={ownerManagerValue}
                      onChange={(e) => setOwnerManagerValue(e.target.value)}
                      placeholder="Új tulajdonos neve"
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
                          title="Tulajdonos törlése"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}

                    {ownerOptions.length === 0 && (
                      <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                        Nincs még rögzített tulajdonos.
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
                      ["ownerAlerts", "Tulajdonos hiányzik"],
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
                        <Label>Tulajdonos</Label>
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
                          <Label>Egyéb tulajdonos</Label>
                          <Input
                            value={vehicleDetailsForm.customOwner}
                            disabled={!isVehicleDetailsEditing}
                            onChange={(e) =>
                              setVehicleDetailsForm({
                                ...vehicleDetailsForm,
                                customOwner: e.target.value,
                              })
                            }
                            placeholder="Tulajdonos neve kézzel"
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
                          <div className="mb-2 text-sm text-slate-400">Tulajdonos</div>
                          <div className="text-lg font-bold text-white">
                            {selectedVehicle.owner || "Nincs beállítva"}
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

        {activePage === "history" && (
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
                            {selectedVehicle.name} · {selectedVehicle.plate} · {selectedVehicle.owner || "Nincs tulajdonos"}
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
                            {selectedVehicleServiceSummary.lastService?.serviceTypeLabel || "Nincs még bejegyzés"}
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
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
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



{activePage === "km" && (
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
        {activePage === "dokumentumok" && (
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
                    {Object.entries(selectedVehicleDocs).map(([docKey, doc]) => {
                      const status = getDocUploadStatus(doc);

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
                                <div className="text-lg font-semibold text-white">{doc.title}</div>
                              </div>

                              <ExpiryBadge status={status.status} />
                            </div>

                            <div className="space-y-3 text-sm text-slate-400">
                              <div>
                                Fájl: <span className="text-slate-200">{doc.fileName || "Nincs fájl"}</span>
                              </div>
                              <div>
                                Típus: <span className="text-slate-200">{doc.fileType || "-"}</span>
                              </div>
                              <div>
                                Méret: <span className="text-slate-200">{formatFileSize(doc.fileSize)}</span>
                              </div>
                              <div>
                                Feltöltés: <span className="text-slate-200">{formatDateHu(doc.uploadedAt)}</span>
                              </div>
                              <div>
                                Lejárat: <span className="text-slate-200">{formatDateHu(doc.expiry)}</span>
                              </div>
                              <div>{status.helper}</div>
                            </div>

                            <div className="mt-4 space-y-3">
                              <div className="space-y-2">
                                <Label>Lejárat</Label>
                                <Input
                                  type="date"
                                  value={doc.expiry || ""}
                                  onChange={(e) =>
                                    updateDocField(selectedVehicle.id, docKey, "expiry", e.target.value)
                                  }
                                  className="fleet-input rounded-2xl"
                                />
                              </div>

                              <div className="space-y-2">
                                <Label>Megjegyzés</Label>
                                <Input
                                  value={doc.note || ""}
                                  onChange={(e) =>
                                    updateDocField(selectedVehicle.id, docKey, "note", e.target.value)
                                  }
                                  className="fleet-input rounded-2xl"
                                />
                              </div>

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

                              <div className="flex flex-wrap gap-3">
                                <Button
                                  className="fleet-doc-btn fleet-doc-btn--primary rounded-2xl"
                                  onClick={() => triggerDocumentPicker(selectedVehicle.id, docKey)}
                                >
                                  <Upload className="mr-2 h-4 w-4" />
                                  {doc.uploaded ? "Fájl csere" : "Feltöltés"}
                                </Button>

                                {doc.uploaded && doc.fileDataUrl ? (
                                  <>
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
                                  </>
                                ) : null}

                                {doc.uploaded ? (
                                  <Button
                                    variant="secondary"
                                    className="fleet-doc-btn fleet-doc-btn--danger rounded-2xl"
                                    onClick={() => requestDocumentRemove(selectedVehicle.id, docKey, doc.title)}
                                  >
                                    <X className="mr-2 h-4 w-4" />
                                    Eltávolítás
                                  </Button>
                                ) : null}
                              </div>
                            </div>
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
              <Label>Tulajdonos</Label>
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
                <Label>Egyéb tulajdonos</Label>
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
              dokumentum feltöltött fájlját? A lejárat és a megjegyzés megmarad, de a feltöltés állapota törlődik.
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
            <DialogTitle>Tulajdonos törlése</DialogTitle>
            <DialogDescription>
              Biztosan törölni szeretné az <span className="font-semibold text-white">{ownerToDelete}</span>{" "}
              tulajdonost a rendszerből?
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
              járművet a rendszerből?
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