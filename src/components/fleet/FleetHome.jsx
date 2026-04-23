"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  CarFront,
  Wrench,
  AlertTriangle,
  BarChart3,
  Gauge,
  CalendarClock,
  Plus,
  Search,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  Handshake,
  Home as HomeIcon,
  Users,
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
import DriverView from "@/components/fleet/DriverView";
import JourneyLogPdf from "@/components/fleet/JourneyLogPdf";
import { supabase, isSupabaseRefreshTokenBrokenError } from "@/lib/supabase";
import {
  driverOutboxCount,
  enqueueDriverOutboxItem,
  getDueDriverOutboxItems,
  markDriverOutboxItemFailed,
  readDriverOutbox,
  removeDriverOutboxItem,
} from "@/lib/fleet/driver-outbox";
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

import {
  SERVICE_CYCLE_KM,
  WARNING_THRESHOLD_KM,
  DOCUMENT_STORAGE_BUCKET,
  EXPENSE_RECEIPTS_STORAGE_BUCKET,
  OIL_SERVICE_LABEL,
  TIMING_SERVICE_LABEL,
  GENERAL_SERVICE_LABEL,
  CUSTOM_SERVICE_VALUE,
  SELECT_NONE_VALUE,
  PAGE_KEYS,
} from "@/lib/fleet/constants";
import {
  sanitizeStorageSegment,
  isDataUrl,
  buildDocumentStoragePath,
  getStoragePathFromFileUrl,
} from "@/lib/fleet/document-storage";
import { resolveDocumentUrl } from "@/lib/fleet/document-urls";
import { formatKmHu, formatCurrencyHu } from "@/lib/fleet/formatters-hu";
import {
  normalizeServiceHistoryItem,
  createTimelineEntry,
  createServiceRecordEntry,
  createKmUpdateEntry,
  normalizeLegacyPage,
  resolveServiceHistoryType,
  getLatestServiceKmByType,
  getCustomServiceCycleStatus,
  getVehicleTone,
  getVehicleToneLabel,
  getVehicleToneClass,
  buildVehicleTimeline,
  compareHistoryEntriesDesc,
  mergeVehicleHistoryWithBaseline,
  sortHistoryEntriesDesc,
  deriveVehicleKmStateFromHistory,
  resolveVehicleInitialKm,
  baselineEntryDate,
  buildInitialKmBaselineEntry,
} from "@/lib/fleet/service-history";
import {
  buildFleetHealthScore,
  buildFleetHealthTrend,
  clamp,
  buildPredictiveService,
} from "@/lib/fleet/vehicle-analytics";
import {
  serializeSupabaseError,
  isSupabaseStorageBucketNotFoundError,
  expenseReceiptBucketMissingUserHint,
  formatProcessExpenseReceiptHttpFailure,
  buildVehicleDbPayload,
  mapDriverFromRow,
  mapSupabaseVehicleRow,
  mapSupabaseServiceRow,
  mapSupabaseKmRow,
  attachHistoryToVehicles,
  createDefaultVehicleDocCollections,
  buildDocsFromSupabaseRows,
} from "@/lib/fleet/supabase-fleet";
import { computeVehicleHealthIndex } from "@/lib/fleet/vehicle-health";
import { buildServiceHistoryCsvExport, buildHealthCsvExport } from "@/lib/fleet/export-csv";
import { pdf } from "@react-pdf/renderer";
export default function FleetHome() {
  const [hydrated, setHydrated] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [vehicles, setVehicles] = useState([]);
  const [ownerOptions, setOwnerOptions] = useState(initialDriverOptions);
  const [drivers, setDrivers] = useState([]);
  const [servicePartners, setServicePartners] = useState([]);
  const [documentsByVehicle, setDocumentsByVehicle] = useState(
    {}
  );
  const [driverDocumentsByVehicle, setDriverDocumentsByVehicle] = useState({});
  const [emailSettings, setEmailSettings] = useState(defaultEmailSettings);
  const [acknowledgedNotifications, setAcknowledgedNotifications] = useState({});
  const [dismissedNotifications, setDismissedNotifications] = useState({});

  const [companyMemberships, setCompanyMemberships] = useState([]);
  const [companySwitching, setCompanySwitching] = useState(false);
  const currentCompanyId = useMemo(() => {
    const v = session?.user?.app_metadata?.company_id;
    return v != null && String(v).trim() !== "" ? String(v).trim() : null;
  }, [session?.user?.app_metadata?.company_id]);
  const tenantUserId = currentCompanyId; // phase-1: company id == legacy tenant user_id
  const currentCompanyRole = useMemo(() => {
    const m = companyMemberships.find((it) => String(it.company_id) === String(currentCompanyId));
    return m?.role || "";
  }, [companyMemberships, currentCompanyId]);

  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [activePage, setActivePage] = useState("home");
  const [isVehicleDetailsEditing, setIsVehicleDetailsEditing] = useState(false);

  const [driverSearch, setDriverSearch] = useState("");
  const [driverStatusFilter, setDriverStatusFilter] = useState("all"); // all | active | inactive
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerStatusFilter, setPartnerStatusFilter] = useState("all"); // all | active | inactive

  const [ownerManagerValue, setOwnerManagerValue] = useState("");
  const [ownerToDelete, setOwnerToDelete] = useState(null);
  const [vehicleToDelete, setVehicleToDelete] = useState(null);
  const [vehicleToArchive, setVehicleToArchive] = useState(null);
  const [documentToRemove, setDocumentToRemove] = useState(null);

  const [documentPreview, setDocumentPreview] = useState(null);
  const [documentPreviewZoom, setDocumentPreviewZoom] = useState(1);

  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [driverEditing, setDriverEditing] = useState(null);
  const [driverForm, setDriverForm] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
    is_active: true,
  });
  const [driverToDelete, setDriverToDelete] = useState(null);

  const [partnerDialogOpen, setPartnerDialogOpen] = useState(false);
  const [partnerEditing, setPartnerEditing] = useState(null);
  const [partnerForm, setPartnerForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    contact_person: "",
    notes: "",
    is_active: true,
  });
  const [partnerToDelete, setPartnerToDelete] = useState(null);

  const [isDriver, setIsDriver] = useState(false);
  const [currentDriver, setCurrentDriver] = useState(null);
  const [driverVehicles, setDriverVehicles] = useState([]);
  const [selectedDriverVehicleId, setSelectedDriverVehicleId] = useState(null);
  const [driverKmDraft, setDriverKmDraft] = useState("");
  const [driverKmSaving, setDriverKmSaving] = useState(false);
  const [driverJourneyDraft, setDriverJourneyDraft] = useState({
    tripType: "business",
    startLocation: "",
    startKm: "",
    endLocation: "",
    endKm: "",
  });
  const [driverJourneySaving, setDriverJourneySaving] = useState(false);
  const [driverActiveJourneysByVehicle, setDriverActiveJourneysByVehicle] = useState({});

  const [driverExpensesByVehicle, setDriverExpensesByVehicle] = useState({});
  const [driverExpenseDraft, setDriverExpenseDraft] = useState({
    expenseType: "fuel",
    occurredAt: todayIso(),
    stationName: "",
    stationLocation: "",
    odometerKm: "",
    fuelType: "Dízel",
    liters: "",
    unitPrice: "",
    grossAmount: "",
    currency: "HUF",
    paymentMethod: "card",
    paymentCardLast4: "",
    note: "",
  });
  const [driverExpenseSaving, setDriverExpenseSaving] = useState(false);
  const [driverExpenseReceiptFile, setDriverExpenseReceiptFile] = useState(null);
  const [driverExpenseAiFile, setDriverExpenseAiFile] = useState(null);
  const [driverExpenseAiProvider, setDriverExpenseAiProvider] = useState(() => {
    if (typeof window === "undefined") return "auto";
    const v = String(window.localStorage.getItem("fleet_expense_ai_provider") || "").toLowerCase().trim();
    return v === "openai" || v === "gemini" || v === "auto" ? v : "auto";
  });
  const [driverExpenseAiSaving, setDriverExpenseAiSaving] = useState(false);
  const [driverExpenseDraftOpen, setDriverExpenseDraftOpen] = useState(false);
  const [driverExpenseDraftEntry, setDriverExpenseDraftEntry] = useState(null);
  const [driverExpenseDraftForm, setDriverExpenseDraftForm] = useState({
    occurredAt: "",
    stationName: "",
    stationLocation: "",
    odometerKm: "",
    currency: "HUF",
    grossAmount: "",
    netAmount: "",
    vatAmount: "",
    vatRate: "",
    invoiceNumber: "",
    paymentMethod: "",
    paymentCardLast4: "",
    fuelType: "",
    liters: "",
    unitPrice: "",
    expenseType: "fuel",
    note: "",
  });

  const selectedDriverVehicle = useMemo(() => {
    if (selectedDriverVehicleId == null) return null;
    return (
      driverVehicles.find((v) => String(v.id) === String(selectedDriverVehicleId)) ?? null
    );
  }, [driverVehicles, selectedDriverVehicleId]);

  const [driverOutboxProcessing, setDriverOutboxProcessing] = useState(false);
  const [driverOutboxCountState, setDriverOutboxCountState] = useState(0);
  const driverRequestLocksRef = useRef({});

  const initialsFromName = (name) => {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return "—";
    const first = parts[0]?.[0] || "";
    const last = (parts.length > 1 ? parts[parts.length - 1]?.[0] : parts[0]?.[1]) || "";
    return `${first}${last}`.toUpperCase();
  };

  const refreshDriverOutboxCount = () => {
    setDriverOutboxCountState(driverOutboxCount());
  };

  const driverDraftStorageKey = (kind, vehicleId) => `fleet_driver_${kind}_v1:${String(vehicleId || "")}`;

  const readDriverDraft = (kind, vehicleId, fallback) => {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(driverDraftStorageKey(kind, vehicleId));
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  };

  const writeDriverDraft = (kind, vehicleId, value) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(driverDraftStorageKey(kind, vehicleId), JSON.stringify(value ?? null));
    } catch {
      /* ignore */
    }
  };

  const clearDriverDraft = (kind, vehicleId) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(driverDraftStorageKey(kind, vehicleId));
    } catch {
      /* ignore */
    }
  };

  const isNetworkishErrorMessage = (msg) => {
    const t = String(msg || "").toLowerCase();
    if (!t) return false;
    return (
      t.includes("failed to fetch") ||
      t.includes("fetch") && t.includes("failed") ||
      t.includes("network") ||
      t.includes("networkerror") ||
      t.includes("the internet connection appears to be offline") ||
      t.includes("functionsfetcherror")
    );
  };

  const shouldQueueDueToConnectivity = (errorLike) => {
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return true;
    return isNetworkishErrorMessage(serializeSupabaseError(errorLike));
  };

  useEffect(() => {
    refreshDriverOutboxCount();
    const tick = () => refreshDriverOutboxCount();
    const id = window.setInterval(tick, 3000);
    const onOnline = () => tick();
    const onStorage = (e) => {
      if (!e || e.key === "fleet_driver_outbox_v1") tick();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Restore per-vehicle drafts after refresh / crash.
  useEffect(() => {
    if (!isDriver) return;
    if (!selectedDriverVehicleId) return;
    const vehicleId = selectedDriverVehicleId;

    const storedKm = readDriverDraft("kmDraft", vehicleId, "");
    if (typeof storedKm === "string") {
      setDriverKmDraft(storedKm);
    }

    const storedJourney = readDriverDraft("journeyDraft", vehicleId, null);
    if (storedJourney && typeof storedJourney === "object") {
      setDriverJourneyDraft((prev) => ({
        ...prev,
        tripType: storedJourney.tripType === "private" ? "private" : "business",
        startLocation: storedJourney.startLocation ?? "",
        startKm: storedJourney.startKm ?? "",
        endLocation: storedJourney.endLocation ?? "",
        endKm: storedJourney.endKm ?? "",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriver, selectedDriverVehicleId]);

  // Persist drafts while editing.
  useEffect(() => {
    if (!isDriver) return;
    if (!selectedDriverVehicleId) return;
    writeDriverDraft("kmDraft", selectedDriverVehicleId, String(driverKmDraft ?? ""));
  }, [driverKmDraft, isDriver, selectedDriverVehicleId]);

  useEffect(() => {
    if (!isDriver) return;
    if (!selectedDriverVehicleId) return;
    writeDriverDraft("journeyDraft", selectedDriverVehicleId, driverJourneyDraft || {});
  }, [driverJourneyDraft, isDriver, selectedDriverVehicleId]);

  const processDriverOutboxOnce = async () => {
    if (driverOutboxProcessing) return;
    if (!session?.user?.id || !currentDriver?.id) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const due = getDueDriverOutboxItems({ limit: 4 });
    if (due.length === 0) return;

    setDriverOutboxProcessing(true);
    try {
      for (const item of due) {
        const id = item?.id;
        const type = String(item?.type || "");
        const payload = item?.payload || null;
        if (!id || !type) {
          if (id) removeDriverOutboxItem(id);
          continue;
        }

        try {
          if (type === "km_save") {
            const vehicleId = payload?.vehicleId;
            const newKm = payload?.newKm;
            const note = payload?.note || "";
            if (!vehicleId || newKm == null) {
              removeDriverOutboxItem(id);
              continue;
            }
            const res = await persistDriverOdometerReading({ vehicleId, newKm, note });
            if (!res?.ok) {
              throw res?.error || new Error("km_save failed");
            }
            removeDriverOutboxItem(id);
            continue;
          }

          if (type === "expense_save") {
            const p = payload?.insertPayload;
            if (!p || !p.vehicle_id || !p.driver_id || !p.user_id) {
              removeDriverOutboxItem(id);
              continue;
            }
            const { data, error } = await supabase.from("expense_entries").insert(p).select("*").limit(1);
            if (error) throw error;
            const inserted = data?.[0];
            if (inserted?.id) {
              setDriverExpensesByVehicle((prev) => {
                const key = String(inserted.vehicle_id);
                const current = Array.isArray(prev?.[key]) ? prev[key] : [];
                return { ...prev, [key]: [inserted, ...current].slice(0, 120) };
              });
            }
            removeDriverOutboxItem(id);
            continue;
          }

          // Unknown type: drop it.
          removeDriverOutboxItem(id);
        } catch (err) {
          if (!shouldQueueDueToConnectivity(err)) {
            // Non-network-ish: keep it but back off; user can see it pending and retry manually.
            markDriverOutboxItemFailed(id, serializeSupabaseError(err));
          } else {
            markDriverOutboxItemFailed(id, serializeSupabaseError(err));
          }
        }
      }
    } finally {
      setDriverOutboxProcessing(false);
      refreshDriverOutboxCount();
    }
  };

  useEffect(() => {
    if (!isDriver) return;
    if (driverOutboxProcessing) return;
    if (driverOutboxCountState <= 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    const id = window.setInterval(() => {
      processDriverOutboxOnce();
    }, 5000);
    return () => window.clearInterval(id);
  }, [driverOutboxCountState, driverOutboxProcessing, isDriver, session?.user?.id, currentDriver?.id]);

  const selectedDriverActiveJourney = useMemo(() => {
    if (!selectedDriverVehicle?.id) return null;
    return driverActiveJourneysByVehicle?.[String(selectedDriverVehicle.id)] || null;
  }, [driverActiveJourneysByVehicle, selectedDriverVehicle?.id]);

  const selectedDriverExpenses = useMemo(() => {
    if (!selectedDriverVehicle?.id) return [];
    return driverExpensesByVehicle?.[String(selectedDriverVehicle.id)] || [];
  }, [driverExpensesByVehicle, selectedDriverVehicle?.id]);

  const selectedDriverRegistrationDoc = useMemo(() => {
    if (!selectedDriverVehicle?.id) return null;
    const idKey = String(selectedDriverVehicle.id);
    const collections = driverDocumentsByVehicle?.[idKey] || {};
    const registrationArr = Array.isArray(collections?.registration) ? collections.registration : [];
    const uploaded = registrationArr.filter((d) => d?.uploaded);
    return (
      uploaded.sort((a, b) => String(b?.uploadedAt || "").localeCompare(String(a?.uploadedAt || "")))[0] ??
      null
    );
  }, [driverDocumentsByVehicle, selectedDriverVehicle?.id]);

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

  const [journeyLogs, setJourneyLogs] = useState([]);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const [journeyVehicleFilter, setJourneyVehicleFilter] = useState("all");
  const [journeyDriverFilter, setJourneyDriverFilter] = useState("all");
  const [journeyMonthFilter, setJourneyMonthFilter] = useState(() => todayIso().slice(0, 7)); // YYYY-MM
  const [journeyEditOpen, setJourneyEditOpen] = useState(false);
  const [journeyEditing, setJourneyEditing] = useState(null);
  const [journeyEditForm, setJourneyEditForm] = useState({
    startedAt: "",
    endedAt: "",
    startKm: "",
    endKm: "",
    startLocation: "",
    endLocation: "",
    tripType: "business",
    note: "",
  });
  const [journeyAddOpen, setJourneyAddOpen] = useState(false);
  const [journeyAddForm, setJourneyAddForm] = useState({
    vehicleId: "all",
    driverId: "all",
    startedAt: "",
    endedAt: "",
    startKm: "",
    endKm: "",
    startLocation: "",
    endLocation: "",
    tripType: "business",
    note: "",
  });

  const [expenseEntries, setExpenseEntries] = useState([]);
  const [expenseLoading, setExpenseLoading] = useState(false);
  const [expenseMonthFilter, setExpenseMonthFilter] = useState(() => todayIso().slice(0, 7)); // YYYY-MM
  const [expenseVehicleFilter, setExpenseVehicleFilter] = useState("all");
  const [expenseDriverFilter, setExpenseDriverFilter] = useState("all");
  const [expenseTypeFilter, setExpenseTypeFilter] = useState("all");
  const [expenseAddOpen, setExpenseAddOpen] = useState(false);
  const [expenseAddMode, setExpenseAddMode] = useState("manual"); // manual | ai
  const [expenseAddSaving, setExpenseAddSaving] = useState(false);
  const [expenseAddFile, setExpenseAddFile] = useState(null); // AI receipt file
  const [expenseAddReceiptFile, setExpenseAddReceiptFile] = useState(null); // manual receipt file
  const [expenseAddAiProvider, setExpenseAddAiProvider] = useState(() => {
    if (typeof window === "undefined") return "auto";
    const v = String(window.localStorage.getItem("fleet_expense_ai_provider") || "").toLowerCase().trim();
    return v === "openai" || v === "gemini" || v === "auto" ? v : "auto";
  });
  const [expenseAddForm, setExpenseAddForm] = useState({
    vehicleId: "all",
    driverId: "all",
    expenseType: "fuel",
    occurredAt: todayIso(),
    stationName: "",
    stationLocation: "",
    odometerKm: "",
    fuelType: "",
    liters: "",
    unitPrice: "",
    grossAmount: "",
    currency: "HUF",
    paymentMethod: "",
    paymentCardLast4: "",
    note: "",
  });
  const [expenseEditOpen, setExpenseEditOpen] = useState(false);
  const [expenseEditing, setExpenseEditing] = useState(null);
  const [expenseEditForm, setExpenseEditForm] = useState({
    occurredAt: "",
    expenseType: "fuel",
    stationName: "",
    stationLocation: "",
    odometerKm: "",
    currency: "HUF",
    grossAmount: "",
    netAmount: "",
    vatAmount: "",
    vatRate: "",
    invoiceNumber: "",
    paymentMethod: "",
    paymentCardLast4: "",
    fuelType: "",
    liters: "",
    unitPrice: "",
    status: "posted",
    note: "",
  });

  const [adminDeleteDialog, setAdminDeleteDialog] = useState(null);
  const [adminDeleteSaving, setAdminDeleteSaving] = useState(false);

  const notificationRef = useRef(null);
  const fileInputRefs = useRef({});

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarGroupsOpen, setSidebarGroupsOpen] = useState({
    vehicles: true,
    reports: true,
    contacts: true,
  });

  const [vehicleLifecycleFilter, setVehicleLifecycleFilter] = useState("all"); // all | active | service | inactive | archived
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [vehicleImageUploading, setVehicleImageUploading] = useState(false);
  const [vehicleShowAllFields, setVehicleShowAllFields] = useState(false);

  const [form, setForm] = useState({
    brand: "",
    model: "",
    name: "",
    plate: "",
    currentKm: "",
    lastServiceKm: "",
    status: "active",
    ownerMode: "Tulaj 1",
    customOwner: "",
    driverId: "",
    note: "",
    year: "",
    vin: "",
    fuelType: "Benzin",
    insuranceExpiry: "",
    inspectionExpiry: "",
    oilChangeIntervalKm: "15000",
    timingBeltIntervalKm: "180000",
  });

  const [registrationFrontFile, setRegistrationFrontFile] = useState(null);
  const [registrationBackFile, setRegistrationBackFile] = useState(null);
  const [registrationAiProvider, setRegistrationAiProvider] = useState(() => {
    if (typeof window === "undefined") return "auto";
    const v = String(window.localStorage.getItem("fleet_registration_ai_provider") || "").toLowerCase().trim();
    return v === "openai" || v === "gemini" || v === "auto" ? v : "auto";
  });
  const [registrationAiSaving, setRegistrationAiSaving] = useState(false);
  const [registrationFrontStoragePath, setRegistrationFrontStoragePath] = useState("");
  const [registrationBackStoragePath, setRegistrationBackStoragePath] = useState("");
  const [registrationAiExpiry, setRegistrationAiExpiry] = useState("");

  const runRegistrationAiPrefill = async () => {
    if (!session?.user?.id) {
      showToast("Be kell jelentkezned", "error");
      return;
    }
    if (currentCompanyRole !== "admin") {
      showToast("Csak admin futtathat AI kitöltést autó hozzáadásnál", "error");
      return;
    }
    if (!currentCompanyId) {
      showToast("Hiányzó cég kontextus (company_id)", "error");
      return;
    }
    if (!registrationFrontFile || !registrationBackFile) {
      showToast("Töltsd fel a forgalmi elöl és hátul képét", "error");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    const maxBytes = 8 * 1024 * 1024;
      const files = [registrationFrontFile, registrationBackFile];
    for (const f of files) {
      if (f.size > maxBytes) {
        showToast("A kép túl nagy (max 8 MB)", "error");
        return;
      }
      if (f.type && !allowedTypes.includes(f.type)) {
        showToast("Csak JPG, PNG vagy WEBP tölthető fel", "error");
        return;
      }
    }

    setRegistrationAiSaving(true);
    try {
      const safeFrontName = sanitizeStorageSegment(registrationFrontFile.name || "forgalmi-elol.jpg");
      const safeBackName = sanitizeStorageSegment(registrationBackFile.name || "forgalmi-hatul.jpg");
      const frontPath = `${currentCompanyId}/vehicle_registration/pending/${Date.now()}-front-${safeFrontName}`;
      const backPath = `${currentCompanyId}/vehicle_registration/pending/${Date.now()}-back-${safeBackName}`;

      const [frontUpload, backUpload] = await Promise.all([
        supabase.storage.from(DOCUMENT_STORAGE_BUCKET).upload(frontPath, registrationFrontFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: registrationFrontFile.type || undefined,
        }),
        supabase.storage.from(DOCUMENT_STORAGE_BUCKET).upload(backPath, registrationBackFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: registrationBackFile.type || undefined,
        }),
      ]);

      if (frontUpload?.error) {
        console.error("vehicle-documents registration front upload:", serializeSupabaseError(frontUpload.error), frontUpload.error);
        showToast("A forgalmi (elöl) feltöltése nem sikerült", "error");
        return;
      }
      if (backUpload?.error) {
        console.error("vehicle-documents registration back upload:", serializeSupabaseError(backUpload.error), backUpload.error);
        // best-effort cleanup
        try {
          await supabase.storage.from(DOCUMENT_STORAGE_BUCKET).remove([frontPath]);
        } catch {
          /* ignore */
        }
        showToast("A forgalmi (hátul) feltöltése nem sikerült", "error");
        return;
      }

      setRegistrationFrontStoragePath(frontPath);
      setRegistrationBackStoragePath(backPath);

      const { data: sessWrap } = await supabase.auth.getSession();
      const accessToken = sessWrap?.session?.access_token || session?.access_token;
      if (!accessToken) {
        showToast("Bejelentkezés lejárt. Jelentkezz be újra.", "error");
        return;
      }

      const hint =
        registrationAiProvider === "openai" || registrationAiProvider === "gemini" || registrationAiProvider === "auto"
          ? registrationAiProvider
          : "auto";
      const fnUrl = `/api/fleet/process-registration-card?ai_provider=${encodeURIComponent(hint)}`;
      const fnRes = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          front_storage_path: frontPath,
          back_storage_path: backPath,
          vehicle_id: null,
          ai_provider: hint,
        }),
      });

      const fnText = await fnRes.text();
      let fnData = null;
      try {
        fnData = fnText ? JSON.parse(fnText) : null;
      } catch {
        fnData = null;
      }

      if (!fnRes.ok) {
        const detail =
          typeof fnData?.detail === "string"
            ? fnData.detail
            : typeof fnData?.error === "string"
              ? fnData.error
              : "";

        if (fnRes.status === 404) {
          showToast(
            detail ||
              "AI feldolgozás HTTP 404: a végpont nem elérhető. Ellenőrizd, hogy a Next.js app újra lett-e indítva / redeploy-olva, és hogy a Supabase Edge Function `process-registration-card` telepítve van (supabase functions deploy process-registration-card).",
            "error",
          );
          return;
        }

        showToast(detail || `AI feldolgozás HTTP ${fnRes.status}`, "error");
        return;
      }

      const extracted = fnData?.extracted || null;
      if (!extracted || typeof extracted !== "object") {
        showToast("AI feldolgozás kész, de nem jött vissza értelmezhető adat.", "error");
        return;
      }

      const nextPlate = String(extracted.plate || "").trim();
      const nextVin = String(extracted.vin || "").trim();
      const nextBrand = String(extracted.brand || "").trim();
      const nextModel = String(extracted.model || "").trim();
      const nextYear = String(extracted.year || "").trim();
      const nextFuel = String(extracted.fuelType || "").trim();
      const nextExpiry = String(extracted.registrationExpiry || "").trim();

      setForm((prev) => ({
        ...prev,
        plate: prev.plate ? prev.plate : nextPlate || prev.plate,
        vin: prev.vin ? prev.vin : nextVin || prev.vin,
        brand: prev.brand ? prev.brand : nextBrand || prev.brand,
        model: prev.model ? prev.model : nextModel || prev.model,
        year: prev.year ? prev.year : nextYear || prev.year,
        fuelType:
          prev.fuelType && prev.fuelType !== "Benzin"
            ? prev.fuelType
            : nextFuel || prev.fuelType,
      }));

      if (nextExpiry) {
        setRegistrationAiExpiry(nextExpiry);
      }

      showSaved("AI kitöltés kész");
    } catch (e) {
      console.error("runRegistrationAiPrefill error:", e);
      showToast("AI feldolgozás nem sikerült", "error");
    } finally {
      setRegistrationAiSaving(false);
    }
  };

  const [vehicleDetailsForm, setVehicleDetailsForm] = useState({
    brand: "",
    model: "",
    name: "",
    plate: "",
    status: "active",
    imagePath: "",
    ownerMode: "Tulaj 1",
    customOwner: "",
    driverId: "",
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
    servicePartnerId: "",
    note: "",
  });


const [kmUpdateDraft, setKmUpdateDraft] = useState({
  date: todayIso(),
  km: "",
  note: "",
});

  useEffect(() => {
    // Reset zoom when opening a new preview.
    if (documentPreview) {
      setDocumentPreviewZoom(1);
    }
  }, [documentPreview]);


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
      setIsDriver(false);
      setCurrentDriver(null);
      setDriverVehicles([]);
      setSelectedDriverVehicleId(null);
      setDriverKmDraft("");
      setHydrated(true);
      setToast({
        id: Date.now(),
        type: "error",
        message: "A bejelentkezési munkamenet lejárt vagy sérült volt. Jelentkezz be újra.",
      });
    };

    const initializeAuth = async () => {
      try {
        let data = null;
        let error = null;
        try {
          const res = await supabase.auth.getSession();
          data = res.data;
          error = res.error;
        } catch (e) {
          error = e;
        }

        if (error) {
          if (isSupabaseRefreshTokenBrokenError(error)) {
            await resetBrokenAuthState();
          } else {
            console.error("Supabase getSession error:", error);
            if (isMounted) setSession(null);
          }
        } else if (isMounted) {
          const nextSession = data?.session ?? null;
          setSession(nextSession);
          if (nextSession?.user?.id) {
            // Load memberships early so we can bootstrap company context if needed.
            void loadCompanyMemberships(nextSession);
          }
          if (!nextSession) {
            setHydrated(true);
          }
        }
      } catch (error) {
        if (isSupabaseRefreshTokenBrokenError(error)) {
          await resetBrokenAuthState();
        } else {
          console.error("Supabase auth init error:", error);
          if (isMounted) setSession(null);
        }
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
        setIsDriver(false);
        setCurrentDriver(null);
        setDriverVehicles([]);
        setSelectedDriverVehicleId(null);
        setDriverKmDraft("");
        setDriverDocumentsByVehicle({});
        setDriverJourneyDraft({
          tripType: "business",
          startLocation: "",
          startKm: "",
          endLocation: "",
          endKm: "",
        });
        setDriverExpensesByVehicle({});
        setDriverExpenseDraft({
          expenseType: "fuel",
          occurredAt: todayIso(),
          stationName: "",
          stationLocation: "",
          odometerKm: "",
          fuelType: "Dízel",
          liters: "",
          unitPrice: "",
          grossAmount: "",
          currency: "HUF",
          paymentMethod: "card",
          paymentCardLast4: "",
          note: "",
        });
        setDriverExpenseSaving(false);
        setDriverExpenseReceiptFile(null);
        setDriverExpenseAiFile(null);
        setDriverExpenseAiSaving(false);
        setDriverExpenseDraftOpen(false);
        setDriverExpenseDraftEntry(null);
        setDriverJourneySaving(false);
        setDriverActiveJourneysByVehicle({});
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
      if (nextSession?.user?.id) {
        void loadCompanyMemberships(nextSession);
      }
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
    if (!currentCompanyId) return;

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
        await loadCompanyMemberships(session);

        // Company context is required for RLS now; queries below are scoped by company_id.

        setIsDriver(false);
        setCurrentDriver(null);
        setDriverVehicles([]);
        setSelectedDriverVehicleId(null);
        setDriverKmDraft("");

        const { data: driverByAuth, error: driverAuthLookupError } = await supabase
          .from("drivers")
          .select("*")
          .eq("auth_user_id", userId)
          .maybeSingle();

        if (driverAuthLookupError) {
          console.warn("Driver auth lookup (continuing as admin):", driverAuthLookupError.message || driverAuthLookupError);
        }

        if (!driverAuthLookupError && driverByAuth) {
          const mappedDriver = mapDriverFromRow(driverByAuth);
          setCurrentDriver(mappedDriver);
          setIsDriver(true);

          const vehicleRes = await supabase
            .from("vehicles")
            .select("*")
            .eq("company_id", currentCompanyId)
            .eq("driver_id", driverByAuth.id)
            .order("id", { ascending: false });

          if (vehicleRes.error) {
            console.error(
              "Driver vehicle load error:",
              serializeSupabaseError(vehicleRes.error),
              vehicleRes.error
            );
            setInitializationError(
              `A járművek betöltése nem sikerült. ${vehicleRes.error?.message ? `(${vehicleRes.error.message})` : ""}`.trim()
            );
            setDriverVehicles([]);
            setSelectedDriverVehicleId(null);
          } else {
            const vehicleRows = vehicleRes.data || [];
            const driverVehicleIds = vehicleRows
              .map((v) => v.id)
              .filter((id) => id !== null && id !== undefined);

            let kmRows = [];
            let svcRows = [];
            let driverDocsRows = [];
            let activeJourneyRows = [];
            let expenseRows = [];
            if (driverVehicleIds.length > 0) {
              const [kmRes, svcRes, docsRes, journeyRes, expenseRes] = await Promise.all([
                supabase
                  .from("km_logs")
                  .select("*")
                  .in("vehicle_id", driverVehicleIds)
                  .order("entry_date", { ascending: false }),
                supabase
                  .from("service_history")
                  .select("*")
                  .in("vehicle_id", driverVehicleIds)
                  .order("entry_date", { ascending: false }),
                supabase
                  .from("vehicle_documents")
                  .select("*")
                  .in("vehicle_id", driverVehicleIds)
                  .eq("doc_key", "registration"),
                supabase
                  .from("journey_logs")
                  .select("*")
                  .in("vehicle_id", driverVehicleIds)
                  .is("ended_at", null),
                supabase
                  .from("expense_entries")
                  .select("*")
                  .in("vehicle_id", driverVehicleIds)
                  .order("occurred_at", { ascending: false })
                  .limit(120),
              ]);
              if (kmRes.error) {
                console.error("Driver km_logs load error:", kmRes.error);
              }
              if (svcRes.error) {
                console.error("Driver service_history load error:", svcRes.error);
              }
              if (docsRes.error) {
                console.error("Driver vehicle_documents load error:", docsRes.error);
              }
              if (journeyRes.error) {
                console.error("Driver journey_logs load error:", journeyRes.error);
              }
              if (expenseRes.error) {
                console.error("Driver expense_entries load error:", expenseRes.error);
              }
              kmRows = kmRes.data || [];
              svcRows = svcRes.data || [];
              driverDocsRows = docsRes.data || [];
              activeJourneyRows = journeyRes.data || [];
              expenseRows = expenseRes.data || [];
            }

            const withHistory = attachHistoryToVehicles(vehicleRows, svcRows, kmRows);
            setDriverVehicles(withHistory);
            setDriverDocumentsByVehicle(buildDocsFromSupabaseRows(withHistory, driverDocsRows));
            setDriverActiveJourneysByVehicle(
              Object.fromEntries((activeJourneyRows || []).map((row) => [String(row.vehicle_id), row]))
            );
            const expensesMap = {};
            (expenseRows || []).forEach((row) => {
              const key = String(row.vehicle_id);
              if (!expensesMap[key]) expensesMap[key] = [];
              expensesMap[key].push(row);
            });
            setDriverExpensesByVehicle(expensesMap);
            setSelectedDriverVehicleId((prev) => {
              if (prev != null && withHistory.some((v) => String(v.id) === String(prev))) {
                return prev;
              }
              return withHistory[0]?.id ?? null;
            });
          }

          setVehicles([]);
          setDocumentsByVehicle({});
          setDrivers([]);
          setServicePartners([]);
          setSelectedId(null);
          return;
        }

        const vehiclesResult = await supabase
          .from("vehicles")
          .select("*")
          .eq("company_id", currentCompanyId)
          .order("id", { ascending: false });

        const adminVehicleIds = (vehiclesResult.data || [])
          .map((v) => v.id)
          .filter((id) => id !== null && id !== undefined);

        const kmLogsQuery =
          adminVehicleIds.length === 0
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from("km_logs")
                .select("*")
                .in("vehicle_id", adminVehicleIds)
                .order("entry_date", { ascending: false });

        const [serviceResult, kmResult, docsResult, driversResult, partnersResult, journeysResult, expensesResult] = await Promise.all([
          supabase
            .from("service_history")
            .select("*")
            .eq("company_id", currentCompanyId)
            .order("entry_date", { ascending: false }),
          kmLogsQuery,
          supabase
            .from("vehicle_documents")
            .select("*")
            .eq("company_id", currentCompanyId),
          supabase
            .from("drivers")
            .select("*")
            .eq("company_id", currentCompanyId)
            .order("name", { ascending: true }),
          supabase
            .from("service_partners")
            .select("*")
            .eq("company_id", currentCompanyId)
            .order("name", { ascending: true }),
          supabase
            .from("journey_logs")
            .select("*")
            .eq("company_id", currentCompanyId)
            .order("started_at", { ascending: false })
            .limit(5000),
          supabase
            .from("expense_entries")
            .select("*")
            .eq("company_id", currentCompanyId)
            .order("occurred_at", { ascending: false })
            .limit(5000),
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
        if (driversResult.error) {
          console.error("Supabase drivers load error:", driversResult.error);
        }
        if (partnersResult.error) {
          console.error("Supabase service_partners load error:", partnersResult.error);
        }
        if (journeysResult.error) {
          console.error("Supabase journey_logs load error:", journeysResult.error);
        }
        if (expensesResult.error) {
          console.error("Supabase expense_entries load error:", expensesResult.error);
        }

        const loadedVehicles = attachHistoryToVehicles(
          vehiclesResult.data || [],
          serviceResult.data || [],
          kmResult.data || []
        );

        setVehicles(loadedVehicles);
        setDocumentsByVehicle(buildDocsFromSupabaseRows(loadedVehicles, docsResult.data || []));
        setDrivers((driversResult.data || []).map(mapDriverFromRow));
        setServicePartners((partnersResult.data || []).map((row) => ({
          id: row.id,
          user_id: row.user_id,
          name: row.name || "",
          phone: row.phone || "",
          email: row.email || "",
          address: row.address || "",
          contact_person: row.contact_person || "",
          notes: row.notes || "",
          is_active: row.is_active !== false,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })));
        setJourneyLogs(journeysResult.data || []);
        setExpenseEntries(expensesResult.data || []);

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
  }, [authReady, session?.user?.id, currentCompanyId]);

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

  const computeVehicleWithLifecycle = (vehicle) => {
    const lifecycleStatus = String(vehicle?.status || "active");
    const computed = computeVehicle(vehicle);
    return { ...computed, lifecycleStatus };
  };

  const enrichedAllVehicles = useMemo(() => vehicles.map(computeVehicleWithLifecycle), [vehicles]);

  const enrichedVehicles = useMemo(
    () => activeVehicles.map(computeVehicleWithLifecycle),
    [activeVehicles]
  );

  const vehiclesForCards = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    const base =
      vehicleLifecycleFilter === "archived"
        ? archivedVehicles
        : activeVehicles;

    const statusFiltered =
      vehicleLifecycleFilter === "all" || vehicleLifecycleFilter === "archived"
        ? base
        : base.filter((v) => String(v.status || "active") === vehicleLifecycleFilter);

    return statusFiltered
      .map(computeVehicleWithLifecycle)
      .filter((v) => {
        if (!q) return true;
        return [v.name, v.plate, v.driver, v.note]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [activeVehicles, archivedVehicles, vehicleLifecycleFilter, query]);

  const vehicleImageUrlById = useMemo(() => {
    const map = {};
    (vehicles || []).forEach((v) => {
      const id = v?.id;
      const path = String(v?.imagePath || "").trim();
      if (!id || !path) return;
      const { data } = supabase.storage.from("vehicle_images").getPublicUrl(path);
      const url = data?.publicUrl || "";
      if (url) map[String(id)] = url;
    });
    return map;
  }, [vehicles]);

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
      enrichedAllVehicles.find((v) => v.id === selectedId) ||
      enrichedVehicles[0] ||
      null
    );
  }, [filteredVehicles, enrichedAllVehicles, enrichedVehicles, selectedId]);

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
    .sort(compareHistoryEntriesDesc);
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
      brand: selectedVehicle.brand || "",
      model: selectedVehicle.model || "",
      name: selectedVehicle.name || "",
      plate: selectedVehicle.plate || "",
      status: selectedVehicle.lifecycleStatus || "active",
      ownerMode: ownerState.ownerMode,
      customOwner: ownerState.customOwner,
      driverId: selectedVehicle?.driver_id ? String(selectedVehicle.driver_id) : "",
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

  const companyMembershipsLoadingRef = useRef(false);

  const loadCompanyMemberships = async (sess) => {
    if (!sess?.user?.id) return;
    if (companyMembershipsLoadingRef.current) return;
    companyMembershipsLoadingRef.current = true;

    const withTimeout = async (promise, ms, label) => {
      let timer;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`${label || "request"} timeout after ${ms}ms`));
            }, ms);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    try {
      const { data, error } = await withTimeout(
        supabase
          .from("company_members")
          .select("company_id,role,status")
          .eq("auth_user_id", sess.user.id)
          .eq("status", "active")
          .order("company_id", { ascending: true }),
        8000,
        "company_members select"
      );
      if (error) {
        console.warn("company_members load error:", error);
        return;
      }
      const rows = Array.isArray(data) ? data : [];

      const ids = Array.from(
        new Set(rows.map((r) => String(r.company_id || "").trim()).filter(Boolean))
      );

      let namesById = {};
      if (ids.length > 0) {
        const { data: companies, error: companiesErr } = await withTimeout(
          supabase.from("companies").select("id,name").in("id", ids),
          8000,
          "companies select"
        );
        if (companiesErr) {
          console.warn("companies load error:", companiesErr);
        } else {
          namesById = Object.fromEntries(
            (Array.isArray(companies) ? companies : []).map((c) => [String(c.id), c.name || ""])
          );
        }
      }

      setCompanyMemberships(
        rows.map((r) => {
          const companyId = String(r.company_id || "").trim();
          return {
            company_id: r.company_id,
            role: r.role,
            status: r.status,
            name: namesById[companyId] || "",
          };
        })
      );
    } catch (e) {
      console.warn("loadCompanyMemberships error:", e);
    } finally {
      companyMembershipsLoadingRef.current = false;
    }
  };

  // Company context is required for RLS. If missing, user must explicitly select a company.
  // (Do NOT auto-switch; it can create repeated switch/request loops when a user has multiple memberships.)

  const switchCompany = async (companyId) => {
    if (!session?.access_token) return;
    if (companySwitching) return;
    const next = String(companyId || "").trim();
    if (!next) return;
    if (next === String(currentCompanyId || "")) return;

    setCompanySwitching(true);
    try {
      const res = await fetch("/api/company/switch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ company_id: next }),
      });
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) {
        showToast(body?.error || "Company váltás nem sikerült", "error");
        return;
      }

      await supabase.auth.refreshSession();
      // Hard reload ensures all queries rerun under new JWT claim.
      window.location.reload();
    } catch (e) {
      console.error("switchCompany error:", e);
      showToast("Company váltás nem sikerült", "error");
    } finally {
      setCompanySwitching(false);
    }
  };

  const isoToLocalInput = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toISOString().slice(0, 16);
    } catch {
      return "";
    }
  };

  const localInputToIso = (value) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  };

  const openEditJourney = (row) => {
    setJourneyEditing(row);
    setJourneyEditForm({
      startedAt: isoToLocalInput(row?.started_at || row?.startedAt),
      endedAt: isoToLocalInput(row?.ended_at || row?.endedAt),
      startKm: row?.start_km != null ? String(row.start_km) : "",
      endKm: row?.end_km != null ? String(row.end_km) : "",
      startLocation: row?.start_location || "",
      endLocation: row?.end_location || "",
      tripType: row?.trip_type === "private" ? "private" : "business",
      note: row?.note || "",
    });
    setJourneyEditOpen(true);
  };

  const openAddJourney = () => {
    if (isDriver) return;
    setJourneyAddForm((prev) => ({
      ...prev,
      vehicleId: journeyVehicleFilter !== "all" ? journeyVehicleFilter : "all",
      driverId: journeyDriverFilter !== "all" ? journeyDriverFilter : "all",
      startedAt: "",
      endedAt: "",
      startKm: "",
      endKm: "",
      startLocation: "",
      endLocation: "",
      tripType: "business",
      note: "",
    }));
    setJourneyAddOpen(true);
  };

  const saveAddedJourney = async () => {
    if (!session?.user?.id) return;
    if (isDriver) return;

    const vehicleId = journeyAddForm.vehicleId !== "all" ? Number(journeyAddForm.vehicleId) : null;
    const driverId = journeyAddForm.driverId !== "all" ? Number(journeyAddForm.driverId) : null;
    if (!vehicleId || Number.isNaN(vehicleId)) {
      showToast("Jármű kiválasztása kötelező", "error");
      return;
    }
    if (!driverId || Number.isNaN(driverId)) {
      showToast("Sofőr kiválasztása kötelező", "error");
      return;
    }

    const startedAtIso = localInputToIso(journeyAddForm.startedAt);
    const endedAtIso = journeyAddForm.endedAt ? localInputToIso(journeyAddForm.endedAt) : null;
    const startKm = journeyAddForm.startKm === "" ? null : Number(journeyAddForm.startKm);
    const endKm = journeyAddForm.endKm === "" ? null : Number(journeyAddForm.endKm);

    if (!startedAtIso) {
      showToast("Indulás időpont megadása kötelező", "error");
      return;
    }
    if (startKm == null || Number.isNaN(startKm) || startKm < 0) {
      showToast("Érvényes induló km megadása kötelező", "error");
      return;
    }
    if (!String(journeyAddForm.startLocation || "").trim()) {
      showToast("Indulás helye kötelező", "error");
      return;
    }
    if (endedAtIso) {
      if (!String(journeyAddForm.endLocation || "").trim()) {
        showToast("Lezárt útnál az érkezés helye kötelező", "error");
        return;
      }
      if (endKm == null || Number.isNaN(endKm) || endKm < startKm) {
        showToast("Lezárt útnál az érkező km kötelező és nem lehet kisebb az indulónál", "error");
        return;
      }
      if (new Date(endedAtIso).getTime() < new Date(startedAtIso).getTime()) {
        showToast("A befejezés nem lehet korábbi az indulásnál", "error");
        return;
      }
    }

    const payload = {
      user_id: tenantUserId,
      company_id: currentCompanyId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      started_at: startedAtIso,
      ended_at: endedAtIso,
      start_km: Math.round(startKm),
      end_km: endKm == null ? null : Math.round(endKm),
      start_location: String(journeyAddForm.startLocation || "").trim(),
      end_location: endedAtIso ? String(journeyAddForm.endLocation || "").trim() : null,
      trip_type: journeyAddForm.tripType === "private" ? "private" : "business",
      note: String(journeyAddForm.note || "").trim(),
      created_by_auth_user_id: session.user.id,
    };

    setJourneyLoading(true);
    try {
      const { data, error } = await supabase.from("journey_logs").insert(payload).select("*").limit(1);
      if (error) {
        console.error("journey_logs admin insert error:", serializeSupabaseError(error), error);
        showToast("Az út mentése nem sikerült", "error");
        return;
      }
      const inserted = data?.[0];
      if (inserted?.id) {
        setJourneyLogs((prev) => [inserted, ...(Array.isArray(prev) ? prev : [])]);
      }
      setJourneyAddOpen(false);
      showSaved("Út rögzítve");
    } catch (e) {
      console.error("saveAddedJourney error:", e);
      showToast("Az út mentése nem sikerült", "error");
    } finally {
      setJourneyLoading(false);
    }
  };

  const openAddExpense = () => {
    if (isDriver) return;
    setExpenseAddMode("manual");
    setExpenseAddSaving(false);
    setExpenseAddFile(null);
    setExpenseAddReceiptFile(null);
    setExpenseAddForm((prev) => ({
      ...prev,
      vehicleId: expenseVehicleFilter !== "all" ? expenseVehicleFilter : "all",
      driverId: expenseDriverFilter !== "all" ? expenseDriverFilter : "all",
      expenseType: expenseTypeFilter !== "all" ? expenseTypeFilter : "fuel",
      occurredAt: todayIso(),
      stationName: "",
      stationLocation: "",
      odometerKm: "",
      fuelType: "",
      liters: "",
      unitPrice: "",
      grossAmount: "",
      currency: "HUF",
      netAmount: "",
      vatAmount: "",
      vatRate: "",
      paymentMethod: "",
      paymentCardLast4: "",
      note: "",
    }));
    setExpenseAddOpen(true);
  };

  const saveAddedExpenseManual = async () => {
    if (!session?.user?.id) return;
    if (isDriver) return;

    const vehicleId = expenseAddForm.vehicleId !== "all" ? Number(expenseAddForm.vehicleId) : null;
    const driverId = expenseAddForm.driverId !== "all" ? Number(expenseAddForm.driverId) : null;
    if (!vehicleId || Number.isNaN(vehicleId)) {
      showToast("Jármű kiválasztása kötelező", "error");
      return;
    }
    if (!driverId || Number.isNaN(driverId)) {
      showToast("Sofőr kiválasztása kötelező", "error");
      return;
    }

    const occurredAt = String(expenseAddForm.occurredAt || "").trim();
    const occurredIso = occurredAt ? new Date(`${occurredAt}T12:00:00.000Z`).toISOString() : null;
    if (!occurredIso) {
      showToast("Dátum megadása kötelező", "error");
      return;
    }

    const gross = normalizeNumberInput(expenseAddForm.grossAmount).num;
    if (gross == null || gross < 0) {
      showToast("Érvényes bruttó összeg megadása kötelező", "error");
      return;
    }

    const expenseType = String(expenseAddForm.expenseType || "fuel").trim() || "fuel";
    const liters = normalizeNumberInput(expenseAddForm.liters).num;
    if (expenseType === "fuel" && (liters == null || liters <= 0)) {
      showToast("Tankolásnál a liter megadása kötelező", "error");
      return;
    }

    const vehicle = vehicles.find((v) => String(v.id) === String(vehicleId)) || null;
    if (!vehicle) {
      showToast("Ismeretlen jármű", "error");
      return;
    }

    const computedVat = computeVatFields({
      gross,
      net: normalizeNumberInput(expenseAddForm.netAmount).num,
      vat: normalizeNumberInput(expenseAddForm.vatAmount).num,
      vatRate: normalizeNumberInput(expenseAddForm.vatRate).num,
      defaultVatRate:
        (expenseAddForm.vatRate ?? "") === "" &&
        (expenseAddForm.netAmount ?? "") === "" &&
        (expenseAddForm.vatAmount ?? "") === ""
          ? defaultVatRateForExpense({ currency: expenseAddForm.currency, expenseType: expenseAddForm.expenseType })
          : null,
    });

    const payload = {
      user_id: tenantUserId,
      company_id: currentCompanyId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      expense_type: expenseType,
      occurred_at: occurredIso,
      station_name: String(expenseAddForm.stationName || "").trim() || null,
      station_location: String(expenseAddForm.stationLocation || "").trim() || null,
      odometer_km:
        normalizeNumberInput(expenseAddForm.odometerKm).num == null
          ? null
          : Math.round(normalizeNumberInput(expenseAddForm.odometerKm).num),
      currency: String(expenseAddForm.currency || "HUF").trim() || "HUF",
      gross_amount: Number(gross.toFixed(2)),
      net_amount: computedVat.net == null ? null : Number(Number(computedVat.net).toFixed(2)),
      vat_amount: computedVat.vat == null ? null : Number(Number(computedVat.vat).toFixed(2)),
      vat_rate: computedVat.vatRate == null ? null : Number(Number(computedVat.vatRate).toFixed(2)),
      payment_method: String(expenseAddForm.paymentMethod || "").trim() || null,
      payment_card_last4: String(expenseAddForm.paymentCardLast4 || "").trim() || null,
      fuel_type: expenseType === "fuel" ? String(expenseAddForm.fuelType || "").trim() || null : null,
      liters: expenseType === "fuel" && liters != null ? Number(liters.toFixed(3)) : null,
      unit_price:
        expenseType === "fuel" && normalizeNumberInput(expenseAddForm.unitPrice).num != null
          ? Number(normalizeNumberInput(expenseAddForm.unitPrice).num.toFixed(3))
          : null,
      receipt_storage_path: null,
      receipt_mime: null,
      receipt_original_filename: null,
      status: "posted",
      note: String(expenseAddForm.note || "").trim() || null,
      created_by_auth_user_id: session.user.id,
    };

    setExpenseAddSaving(true);
    try {
      if (expenseAddReceiptFile) {
        const file = expenseAddReceiptFile;
        const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
        const maxBytes = 8 * 1024 * 1024;
        if (file.size > maxBytes) {
          showToast("A bizonylat túl nagy (max 8 MB)", "error");
          return;
        }
        if (file.type && !allowedTypes.includes(file.type)) {
          showToast("Csak PDF, JPG, PNG vagy WEBP tölthető fel", "error");
          return;
        }

        const month = String(payload.occurred_at || "").slice(0, 7) || todayIso().slice(0, 7);
        const storagePath = `${session.user.id}/${vehicleId}/${month}/${Date.now()}-${sanitizeStorageSegment(file.name)}`;
        const { error: uploadError } = await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
        if (uploadError) {
          if (isSupabaseStorageBucketNotFoundError(uploadError)) {
            showToast(expenseReceiptBucketMissingUserHint(EXPENSE_RECEIPTS_STORAGE_BUCKET), "error");
          } else {
            showToast("A bizonylat feltöltése nem sikerült", "error");
          }
          return;
        }
        payload.receipt_storage_path = storagePath;
        payload.receipt_mime = file.type || null;
        payload.receipt_original_filename = file.name || null;
      }

      const { data, error } = await supabase.from("expense_entries").insert(payload).select("*").limit(1);
      if (error) {
        if (payload.receipt_storage_path) {
          await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).remove([payload.receipt_storage_path]);
        }
        console.error("expense_entries admin manual insert error:", serializeSupabaseError(error), error);
        showToast("A költség mentése nem sikerült", "error");
        return;
      }
      const inserted = data?.[0];
      if (inserted?.id) {
        setExpenseEntries((prev) => [inserted, ...(Array.isArray(prev) ? prev : [])]);
      }
      setExpenseAddOpen(false);
      showSaved("Költség rögzítve");
    } catch (e) {
      console.error("saveAddedExpenseManual error:", e);
      showToast("A költség mentése nem sikerült", "error");
    } finally {
      setExpenseAddSaving(false);
    }
  };

  const saveAddedExpenseAi = async () => {
    if (!session?.user?.id) return;
    if (isDriver) return;

    const vehicleId = expenseAddForm.vehicleId !== "all" ? Number(expenseAddForm.vehicleId) : null;
    const driverId = expenseAddForm.driverId !== "all" ? Number(expenseAddForm.driverId) : null;
    if (!vehicleId || Number.isNaN(vehicleId)) {
      showToast("Jármű kiválasztása kötelező", "error");
      return;
    }
    if (!driverId || Number.isNaN(driverId)) {
      showToast("Sofőr kiválasztása kötelező", "error");
      return;
    }
    const file = expenseAddFile;
    if (!file) {
      showToast("Válassz bizonylat képet vagy PDF-et", "error");
      return;
    }

    setExpenseAddSaving(true);
    try {
      const month = todayIso().slice(0, 7);
      const storagePath = `${session.user.id}/${vehicleId}/${month}/${Date.now()}-${sanitizeStorageSegment(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (uploadError) {
        if (isSupabaseStorageBucketNotFoundError(uploadError)) {
          showToast(expenseReceiptBucketMissingUserHint(EXPENSE_RECEIPTS_STORAGE_BUCKET), "error");
        } else {
          showToast("A bizonylat feltöltése nem sikerült", "error");
        }
        return;
      }

      const { data: sessWrap } = await supabase.auth.getSession();
      const accessToken = sessWrap?.session?.access_token || session?.access_token;
      if (!accessToken) {
        showToast("Bejelentkezés lejárt. Jelentkezz be újra.", "error");
        return;
      }

      const hint =
        expenseAddAiProvider === "openai" || expenseAddAiProvider === "gemini" || expenseAddAiProvider === "auto"
          ? expenseAddAiProvider
          : "auto";
      const fnUrl = `/api/fleet/process-expense-receipt?ai_provider=${encodeURIComponent(hint)}`;
      const fnRes = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          receipt_storage_path: storagePath,
          vehicle_id: vehicleId,
          driver_id: driverId,
          ai_provider: hint,
        }),
      });

      const fnText = await fnRes.text();
      let fnData = null;
      try {
        fnData = fnText ? JSON.parse(fnText) : null;
      } catch {
        fnData = null;
      }
      if (!fnRes.ok) {
        const msg = formatProcessExpenseReceiptHttpFailure(fnRes.status, fnData, fnText);
        showToast(msg, "error");
        return;
      }

      const rawEntryId = fnData?.entry_id ?? fnData?.entry?.id;
      const entryId =
        rawEntryId !== undefined && rawEntryId !== null && String(rawEntryId).trim() !== "" ? String(rawEntryId).trim() : null;

      let draft =
        fnData?.entry && typeof fnData.entry === "object" && !Array.isArray(fnData.entry) ? fnData.entry : null;
      if (entryId && !draft?.id) {
        const { data: entryRows } = await supabase.from("expense_entries").select("*").eq("id", entryId).limit(1);
        draft = entryRows?.[0] || null;
      }

      if (draft?.id) {
        setExpenseEntries((prev) => [draft, ...(Array.isArray(prev) ? prev : [])]);
        setExpenseAddOpen(false);
        showSaved("AI draft elkészült");
        return;
      }

      showToast("AI feldolgozás kész, de nem jött vissza bejegyzés.", "error");
    } catch (e) {
      console.error("saveAddedExpenseAi error:", e);
      showToast("AI feldolgozás nem sikerült", "error");
    } finally {
      setExpenseAddSaving(false);
    }
  };

  const saveEditedJourney = async () => {
    if (!session?.user?.id || !journeyEditing?.id) return;

    const startedAtIso = localInputToIso(journeyEditForm.startedAt);
    const endedAtIso = journeyEditForm.endedAt ? localInputToIso(journeyEditForm.endedAt) : null;
    const startKm = journeyEditForm.startKm === "" ? null : Number(journeyEditForm.startKm);
    const endKm = journeyEditForm.endKm === "" ? null : Number(journeyEditForm.endKm);

    if (!startedAtIso) {
      showToast("Indulás időpont megadása kötelező", "error");
      return;
    }
    if (startKm == null || Number.isNaN(startKm) || startKm < 0) {
      showToast("Érvényes induló km megadása kötelező", "error");
      return;
    }
    if (!String(journeyEditForm.startLocation || "").trim()) {
      showToast("Indulás helye kötelező", "error");
      return;
    }
    if (endedAtIso) {
      if (!String(journeyEditForm.endLocation || "").trim()) {
        showToast("Lezárt útnál az érkezés helye kötelező", "error");
        return;
      }
      if (endKm == null || Number.isNaN(endKm) || endKm < startKm) {
        showToast("Lezárt útnál az érkező km kötelező és nem lehet kisebb az indulónál", "error");
        return;
      }
      if (new Date(endedAtIso).getTime() < new Date(startedAtIso).getTime()) {
        showToast("A befejezés nem lehet korábbi az indulásnál", "error");
        return;
      }
    }

    const payload = {
      started_at: startedAtIso,
      ended_at: endedAtIso,
      start_km: Math.round(startKm),
      end_km: endKm == null ? null : Math.round(endKm),
      start_location: String(journeyEditForm.startLocation || "").trim(),
      end_location: endedAtIso ? String(journeyEditForm.endLocation || "").trim() : null,
      trip_type: journeyEditForm.tripType === "private" ? "private" : "business",
      note: String(journeyEditForm.note || "").trim(),
    };

    setJourneyLoading(true);
    try {
      const { data, error } = await supabase
        .from("journey_logs")
        .update(payload)
        .eq("id", journeyEditing.id)
        .eq("user_id", session.user.id)
        .select("*")
        .limit(1);

      if (error) {
        console.error("journey_logs admin update error:", serializeSupabaseError(error), error);
        showToast("A bejegyzés mentése nem sikerült", "error");
        return;
      }

      const updated = data?.[0];
      if (updated?.id) {
        setJourneyLogs((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      }

      setJourneyEditOpen(false);
      setJourneyEditing(null);
      showSaved("Bejegyzés mentve");
    } catch (error) {
      console.error("saveEditedJourney error:", error);
      showToast("A bejegyzés mentése nem sikerült", "error");
    } finally {
      setJourneyLoading(false);
    }
  };

  const openAdminDeleteJourney = (row) => {
    if (isDriver) return;
    if (!row?.id) return;
    const vehicle = vehicles.find((v) => String(v.id) === String(row.vehicle_id)) || null;
    const driver = drivers.find((d) => String(d.id) === String(row.driver_id)) || null;
    const dateLabel = String(row.started_at || "").slice(0, 10) || "—";
    const summary = `${dateLabel} • ${vehicle?.plate || "—"} • ${driver?.name || "—"}`;

    setAdminDeleteDialog({
      kind: "journey",
      id: row.id,
      userId: row.user_id,
      summary,
    });
  };

  const openAdminDeleteExpense = (row) => {
    if (isDriver) return;
    if (!row?.id) return;
    const vehicle = vehicles.find((v) => String(v.id) === String(row.vehicle_id)) || null;
    const driver = drivers.find((d) => String(d.id) === String(row.driver_id)) || null;
    const dateLabel = String(row.occurred_at || "").slice(0, 10) || "—";
    const summary = `${dateLabel} • ${vehicle?.plate || "—"} • ${driver?.name || "—"} • ${Number(row.gross_amount || 0).toLocaleString("hu-HU")} ${
      row.currency || "HUF"
    }`;

    setAdminDeleteDialog({
      kind: "expense",
      id: row.id,
      userId: row.user_id,
      receiptPath: row.receipt_storage_path || "",
      summary,
    });
  };

  const openEditExpense = (row) => {
    if (isDriver) return;
    if (!row?.id) return;
    setExpenseEditing(row);
    setExpenseEditForm({
      occurredAt: String(row.occurred_at || "").slice(0, 10) || todayIso(),
      expenseType: row.expense_type || "fuel",
      stationName: row.station_name || "",
      stationLocation: row.station_location || "",
      odometerKm: row.odometer_km != null ? String(row.odometer_km) : "",
      currency: row.currency || "HUF",
      grossAmount: row.gross_amount != null ? String(row.gross_amount) : "",
      netAmount: row.net_amount != null ? String(row.net_amount) : "",
      vatAmount: row.vat_amount != null ? String(row.vat_amount) : "",
      vatRate: row.vat_rate != null ? String(row.vat_rate) : "",
      invoiceNumber: row.invoice_number || "",
      paymentMethod: row.payment_method || "",
      paymentCardLast4: row.payment_card_last4 || "",
      fuelType: row.fuel_type || "",
      liters: row.liters != null ? String(row.liters) : "",
      unitPrice: row.unit_price != null ? String(row.unit_price) : "",
      status: row.status || "posted",
      note: row.note || "",
    });
    setExpenseEditOpen(true);
  };

  const computeVatFields = ({ gross, net, vat, vatRate, defaultVatRate = null }) => {
    const round2 = (n) => (n == null || !Number.isFinite(n) ? null : Number(Number(n).toFixed(2)));
    const roundRate = (n) => (n == null || !Number.isFinite(n) ? null : Number(Number(n).toFixed(2)));

    const g = gross;
    const n = net;
    const v = vat;
    let r = vatRate;

    const result = { net: n, vat: v, vatRate: r };
    if (g == null || !Number.isFinite(g) || g < 0) return result;

    // If nothing VAT-related was provided but we have a default, apply it.
    if ((r == null || !Number.isFinite(r)) && (n == null || !Number.isFinite(n)) && (v == null || !Number.isFinite(v))) {
      if (defaultVatRate != null && Number.isFinite(defaultVatRate) && defaultVatRate >= 0) {
        r = defaultVatRate;
        result.vatRate = roundRate(r);
      }
    }

    // Priority: if rate present -> compute net+vat; else if net present -> compute vat+rate; else if vat present -> compute net+rate.
    if (r != null && Number.isFinite(r) && r >= 0) {
      const denom = 1 + r / 100;
      if (denom > 0) {
        const computedNet = g / denom;
        const computedVat = g - computedNet;
        result.net = round2(computedNet);
        result.vat = round2(computedVat);
        result.vatRate = roundRate(r);
      }
      return result;
    }

    if (n != null && Number.isFinite(n) && n >= 0) {
      const computedVat = g - n;
      const computedRate = n > 0 ? (computedVat / n) * 100 : null;
      result.net = round2(n);
      result.vat = round2(computedVat);
      result.vatRate = computedRate == null ? null : roundRate(computedRate);
      return result;
    }

    if (v != null && Number.isFinite(v)) {
      const computedNet = g - v;
      const computedRate = computedNet > 0 ? (v / computedNet) * 100 : null;
      result.net = round2(computedNet);
      result.vat = round2(v);
      result.vatRate = computedRate == null ? null : roundRate(computedRate);
      return result;
    }

    return result;
  };

  const normalizeNumberInput = (value) => {
    const raw = String(value ?? "").trim().replace(",", ".");
    if (raw === "") return { raw: "", num: null };
    const n = Number(raw);
    return { raw, num: Number.isNaN(n) ? null : n };
  };

  const defaultVatRateForExpense = ({ currency, expenseType }) => {
    const cur = String(currency || "").trim().toUpperCase();
    const type = String(expenseType || "").trim().toLowerCase();
    // HU default VAT assumption when missing on AI/manual: editable after fill.
    if (cur === "HUF") return 27;
    // If not HUF, don't guess.
    if (type === "fuel") return null;
    return null;
  };

  // Auto-fill VAT fields for admin expense edit (only fill missing fields).
  useEffect(() => {
    if (!expenseEditOpen) return;
    const gross = normalizeNumberInput(expenseEditForm.grossAmount).num;
    const net = normalizeNumberInput(expenseEditForm.netAmount).num;
    const vat = normalizeNumberInput(expenseEditForm.vatAmount).num;
    const rate = normalizeNumberInput(expenseEditForm.vatRate).num;

    const defaultRate =
      (expenseEditForm.vatRate ?? "") === "" &&
      (expenseEditForm.netAmount ?? "") === "" &&
      (expenseEditForm.vatAmount ?? "") === ""
        ? defaultVatRateForExpense({ currency: expenseEditForm.currency, expenseType: expenseEditForm.expenseType })
        : null;

    const computed = computeVatFields({ gross, net, vat, vatRate: rate, defaultVatRate: defaultRate });
    const next = {};

    if ((expenseEditForm.netAmount ?? "") === "" && computed.net != null) next.netAmount = String(computed.net);
    if ((expenseEditForm.vatAmount ?? "") === "" && computed.vat != null) next.vatAmount = String(computed.vat);
    if ((expenseEditForm.vatRate ?? "") === "" && computed.vatRate != null) next.vatRate = String(computed.vatRate);

    if (Object.keys(next).length > 0) {
      setExpenseEditForm((p) => ({ ...p, ...next }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseEditForm.grossAmount, expenseEditForm.netAmount, expenseEditForm.vatAmount, expenseEditForm.vatRate, expenseEditOpen]);

  // Auto-fill VAT fields for AI draft edit dialog (only fill missing fields).
  useEffect(() => {
    if (!driverExpenseDraftOpen) return;
    const gross = normalizeNumberInput(driverExpenseDraftForm.grossAmount).num;
    const net = normalizeNumberInput(driverExpenseDraftForm.netAmount).num;
    const vat = normalizeNumberInput(driverExpenseDraftForm.vatAmount).num;
    const rate = normalizeNumberInput(driverExpenseDraftForm.vatRate).num;

    const defaultRate =
      (driverExpenseDraftForm.vatRate ?? "") === "" &&
      (driverExpenseDraftForm.netAmount ?? "") === "" &&
      (driverExpenseDraftForm.vatAmount ?? "") === ""
        ? defaultVatRateForExpense({ currency: driverExpenseDraftForm.currency, expenseType: driverExpenseDraftForm.expenseType })
        : null;

    const computed = computeVatFields({ gross, net, vat, vatRate: rate, defaultVatRate: defaultRate });
    const next = {};

    if ((driverExpenseDraftForm.netAmount ?? "") === "" && computed.net != null) next.netAmount = String(computed.net);
    if ((driverExpenseDraftForm.vatAmount ?? "") === "" && computed.vat != null) next.vatAmount = String(computed.vat);
    if ((driverExpenseDraftForm.vatRate ?? "") === "" && computed.vatRate != null) next.vatRate = String(computed.vatRate);

    if (Object.keys(next).length > 0) {
      setDriverExpenseDraftForm((p) => ({ ...p, ...next }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverExpenseDraftForm.grossAmount, driverExpenseDraftForm.netAmount, driverExpenseDraftForm.vatAmount, driverExpenseDraftForm.vatRate, driverExpenseDraftOpen]);

  // Auto-fill VAT fields for admin expense add (manual) dialog (only fill missing fields).
  useEffect(() => {
    if (!expenseAddOpen) return;
    if (expenseAddMode !== "manual") return;

    const gross = normalizeNumberInput(expenseAddForm.grossAmount).num;
    const net = normalizeNumberInput(expenseAddForm.netAmount).num;
    const vat = normalizeNumberInput(expenseAddForm.vatAmount).num;
    const rate = normalizeNumberInput(expenseAddForm.vatRate).num;

    const defaultRate =
      (expenseAddForm.vatRate ?? "") === "" &&
      (expenseAddForm.netAmount ?? "") === "" &&
      (expenseAddForm.vatAmount ?? "") === ""
        ? defaultVatRateForExpense({ currency: expenseAddForm.currency, expenseType: expenseAddForm.expenseType })
        : null;

    const computed = computeVatFields({ gross, net, vat, vatRate: rate, defaultVatRate: defaultRate });
    const next = {};

    if ((expenseAddForm.netAmount ?? "") === "" && computed.net != null) next.netAmount = String(computed.net);
    if ((expenseAddForm.vatAmount ?? "") === "" && computed.vat != null) next.vatAmount = String(computed.vat);
    if ((expenseAddForm.vatRate ?? "") === "" && computed.vatRate != null) next.vatRate = String(computed.vatRate);

    if (Object.keys(next).length > 0) {
      setExpenseAddForm((p) => ({ ...p, ...next }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    expenseAddForm.grossAmount,
    expenseAddForm.netAmount,
    expenseAddForm.vatAmount,
    expenseAddForm.vatRate,
    expenseAddForm.currency,
    expenseAddForm.expenseType,
    expenseAddMode,
    expenseAddOpen,
  ]);

  const saveEditedExpense = async () => {
    if (!session?.user?.id || !expenseEditing?.id) return;

    const occurredAt = String(expenseEditForm.occurredAt || "").trim();
    const occurredIso = occurredAt ? new Date(`${occurredAt}T12:00:00.000Z`).toISOString() : null;
    if (!occurredIso) {
      showToast("Dátum megadása kötelező", "error");
      return;
    }

    const toNum = (v) => normalizeNumberInput(v).num;

    const expenseType = String(expenseEditForm.expenseType || "fuel").trim() || "fuel";
    const currency = String(expenseEditForm.currency || "HUF").trim() || "HUF";
    const grossAmount = toNum(expenseEditForm.grossAmount);
    if (grossAmount == null || grossAmount < 0) {
      showToast("Érvényes bruttó összeg megadása kötelező", "error");
      return;
    }

    const liters = toNum(expenseEditForm.liters);
    if (expenseType === "fuel") {
      if (liters == null || liters <= 0) {
        showToast("Tankolásnál a liter megadása kötelező", "error");
        return;
      }
    }

    const computedVat = computeVatFields({
      gross: grossAmount,
      net: toNum(expenseEditForm.netAmount),
      vat: toNum(expenseEditForm.vatAmount),
      vatRate: toNum(expenseEditForm.vatRate),
      defaultVatRate:
        (expenseEditForm.vatRate ?? "") === "" &&
        (expenseEditForm.netAmount ?? "") === "" &&
        (expenseEditForm.vatAmount ?? "") === ""
          ? defaultVatRateForExpense({ currency: expenseEditForm.currency, expenseType: expenseEditForm.expenseType })
          : null,
    });

    const payload = {
      occurred_at: occurredIso,
      expense_type: expenseType,
      station_name: String(expenseEditForm.stationName || "").trim() || null,
      station_location: String(expenseEditForm.stationLocation || "").trim() || null,
      odometer_km: toNum(expenseEditForm.odometerKm) == null ? null : Math.round(toNum(expenseEditForm.odometerKm)),
      currency,
      gross_amount: Number(grossAmount.toFixed(2)),
      net_amount: computedVat.net == null ? null : Number(Number(computedVat.net).toFixed(2)),
      vat_amount: computedVat.vat == null ? null : Number(Number(computedVat.vat).toFixed(2)),
      vat_rate: computedVat.vatRate == null ? null : Number(Number(computedVat.vatRate).toFixed(2)),
      invoice_number: String(expenseEditForm.invoiceNumber || "").trim() || null,
      payment_method: String(expenseEditForm.paymentMethod || "").trim() || null,
      payment_card_last4: String(expenseEditForm.paymentCardLast4 || "").trim() || null,
      fuel_type: expenseType === "fuel" ? String(expenseEditForm.fuelType || "").trim() || null : null,
      liters: expenseType === "fuel" && liters != null ? Number(liters.toFixed(3)) : null,
      unit_price:
        expenseType === "fuel" && toNum(expenseEditForm.unitPrice) != null
          ? Number(toNum(expenseEditForm.unitPrice).toFixed(3))
          : null,
      status: String(expenseEditForm.status || "posted").trim() || "posted",
      note: String(expenseEditForm.note || "").trim() || null,
    };

    setExpenseLoading(true);
    try {
      const { data, error } = await supabase
        .from("expense_entries")
        .update(payload)
        .eq("id", expenseEditing.id)
        .eq("user_id", session.user.id)
        .select("*")
        .limit(1);

      if (error) {
        console.error("expense_entries admin update error:", serializeSupabaseError(error), error);
        showToast("A bejegyzés mentése nem sikerült", "error");
        return;
      }

      const updated = data?.[0];
      if (updated?.id) {
        setExpenseEntries((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      }

      setExpenseEditOpen(false);
      setExpenseEditing(null);
      showSaved("Bejegyzés mentve");
    } catch (error) {
      console.error("saveEditedExpense error:", error);
      showToast("A bejegyzés mentése nem sikerült", "error");
    } finally {
      setExpenseLoading(false);
    }
  };

  const confirmAdminDelete = async () => {
    if (!session?.user?.id) return;
    const target = adminDeleteDialog;
    if (!target?.id || !target?.kind) return;

    setAdminDeleteSaving(true);
    try {
      if (target.kind === "journey") {
        const { error } = await supabase.from("journey_logs").delete().eq("id", target.id).eq("user_id", session.user.id);
        if (error) {
          console.error("journey_logs admin delete error:", serializeSupabaseError(error), error);
          showToast("Az út bejegyzés törlése nem sikerült", "error");
          return;
        }

        setJourneyLogs((prev) => prev.filter((r) => String(r.id) !== String(target.id)));
        if (journeyEditing?.id && String(journeyEditing.id) === String(target.id)) {
          setJourneyEditOpen(false);
          setJourneyEditing(null);
        }
        showSaved("Út bejegyzés törölve");
      }

      if (target.kind === "expense") {
        const receiptPath = String(target.receiptPath || "").trim();
        if (receiptPath) {
          const { error: storageErr } = await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).remove([receiptPath]);
          if (storageErr) {
            console.error("expense-receipts delete error (admin):", storageErr);
          }

          const { error: jobsErr } = await supabase.from("expense_ai_jobs").delete().eq("receipt_storage_path", receiptPath);
          if (jobsErr) {
            console.error("expense_ai_jobs delete error (admin):", jobsErr);
          }
        }

        const { error } = await supabase.from("expense_entries").delete().eq("id", target.id).eq("user_id", session.user.id);
        if (error) {
          console.error("expense_entries admin delete error:", serializeSupabaseError(error), error);
          showToast("A költség törlése nem sikerült", "error");
          return;
        }

        setExpenseEntries((prev) => prev.filter((r) => String(r.id) !== String(target.id)));
        if (driverExpenseDraftEntry?.id && String(driverExpenseDraftEntry.id) === String(target.id)) {
          setDriverExpenseDraftOpen(false);
          setDriverExpenseDraftEntry(null);
        }
        showSaved("Költség törölve");
      }

      setAdminDeleteDialog(null);
    } catch (error) {
      console.error("confirmAdminDelete error:", error);
      showToast("A törlés nem sikerült", "error");
    } finally {
      setAdminDeleteSaving(false);
    }
  };

  const exportJourneyPdfMonthly = async () => {
    if (!journeyMonthFilter) {
      showToast("Hónap megadása kötelező (YYYY-MM)", "error");
      return;
    }
    if (journeyVehicleFilter === "all") {
      showToast("Válassz járművet a havi PDF exporthoz", "error");
      return;
    }

    const vehicle = vehicles.find((v) => String(v.id) === String(journeyVehicleFilter)) || null;
    const vehicleLabel = vehicle ? `${vehicle.name || "Jármű"} • ${vehicle.plate || "—"}` : "—";

    const rows = journeyLogs
      .filter((row) => String(row.vehicle_id) === String(journeyVehicleFilter))
      .filter((row) => String(row.started_at || "").slice(0, 7) === String(journeyMonthFilter).trim())
      .sort((a, b) => String(a.started_at || "").localeCompare(String(b.started_at || "")));

    if (rows.length === 0) {
      showToast("Nincs exportálható sor ebben a hónapban", "error");
      return;
    }

    try {
      const doc = (
        <JourneyLogPdf month={String(journeyMonthFilter).trim()} vehicleLabel={vehicleLabel} rows={rows} />
      );
      const blob = await pdf(doc).toBlob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `utnyilvantartas-${sanitizeStorageSegment(vehicle?.plate || String(journeyVehicleFilter))}-${String(
        journeyMonthFilter
      ).trim()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      showSaved("PDF export elkészült");
    } catch (error) {
      console.error("exportJourneyPdfMonthly error:", error);
      showToast("A PDF export nem sikerült", "error");
    }
  };

  const exportExpensesCsv = () => {
    const rows = (expenseEntries || [])
      .filter((row) => {
        const monthOk =
          !expenseMonthFilter ||
          String(row.occurred_at || "").slice(0, 7) === String(expenseMonthFilter).trim();
        const vehicleOk =
          expenseVehicleFilter === "all" || String(row.vehicle_id) === String(expenseVehicleFilter);
        const driverOk =
          expenseDriverFilter === "all" || String(row.driver_id) === String(expenseDriverFilter);
        const typeOk = expenseTypeFilter === "all" || String(row.expense_type) === String(expenseTypeFilter);
        return monthOk && vehicleOk && driverOk && typeOk;
      })
      .sort((a, b) => String(a.occurred_at || "").localeCompare(String(b.occurred_at || "")));

    const header = [
      "Dátum",
      "Jármű",
      "Sofőr",
      "Típus",
      "Kút",
      "Helyszín",
      "Km",
      "Liter",
      "Egységár",
      "Bruttó",
      "Pénznem",
      "ÁFA kulcs",
      "Nettó",
      "ÁFA",
      "Számlaszám",
      "Fizetés",
      "Kártya utolsó 4",
      "Státusz",
      "Megjegyzés",
    ];

    const lines = [
      header,
      ...rows.map((r) => {
        const vehicle = vehicles.find((v) => String(v.id) === String(r.vehicle_id)) || null;
        const driver = drivers.find((d) => String(d.id) === String(r.driver_id)) || null;

        const gross = r.gross_amount == null ? null : Number(r.gross_amount);
        const net = r.net_amount == null ? null : Number(r.net_amount);
        const vat = r.vat_amount == null ? null : Number(r.vat_amount);
        const vatRate = r.vat_rate == null ? null : Number(r.vat_rate);
        const defaultRate =
          (net == null && vat == null && vatRate == null) && String(r.currency || "").toUpperCase().trim() === "HUF"
            ? 27
            : null;
        const computedVat = computeVatFields({
          gross,
          net,
          vat,
          vatRate,
          defaultVatRate: defaultRate,
        });

        return [
          String(r.occurred_at || "").slice(0, 10),
          vehicle?.plate || "",
          driver?.name || "",
          r.expense_type || "",
          r.station_name || "",
          r.station_location || "",
          r.odometer_km ?? "",
          r.liters ?? "",
          r.unit_price ?? "",
          r.gross_amount ?? "",
          r.currency || "",
          computedVat.vatRate ?? "",
          computedVat.net ?? "",
          computedVat.vat ?? "",
          r.invoice_number || "",
          r.payment_method || "",
          r.payment_card_last4 || "",
          r.status || "",
          r.note || "",
        ].map((value) => csvEscape(String(value ?? "")));
      }),
    ];

    const content = lines.map((line) => line.join(";")).join("\n");
    downloadFile(content, `koltsegnaplo-${String(expenseMonthFilter || todayIso().slice(0, 7))}.csv`, "text/csv;charset=utf-8");
    showSaved("CSV export elkészült");
  };

  const openExpenseReceipt = async (entry, mode = "open") => {
    const storagePath = entry?.receipt_storage_path || entry?.receipt_storage_path || "";
    if (!storagePath) {
      showToast("Ehhez a bejegyzéshez nincs bizonylat", "error");
      return;
    }

    try {
      const { data, error } = await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).createSignedUrl(storagePath, 300);
      if (error) {
        if (isSupabaseStorageBucketNotFoundError(error)) {
          console.warn("createSignedUrl expense-receipts:", serializeSupabaseError(error));
          showToast(expenseReceiptBucketMissingUserHint(EXPENSE_RECEIPTS_STORAGE_BUCKET), "error");
        } else {
          console.error("createSignedUrl expense-receipts error:", error);
          showToast("A bizonylat link nem kérhető le", "error");
        }
        return;
      }

      const signedUrl = data?.signedUrl || "";
      if (!signedUrl) {
        showToast("A bizonylat link nem kérhető le", "error");
        return;
      }

      if (mode === "open") {
        const newTab = window.open(signedUrl, "_blank", "noopener,noreferrer");
        if (!newTab) showToast("A böngésző blokkolta az új ablakot", "error");
        return;
      }

      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = entry?.receipt_original_filename || "bizonylat";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      console.error("openExpenseReceipt error:", error);
      showToast("A bizonylat megnyitása/letöltése nem sikerült", "error");
    }
  };

  const resetDriverForm = () => {
    setDriverForm({ name: "", phone: "", email: "", notes: "", is_active: true });
    setDriverEditing(null);
  };

  const openCreateDriver = () => {
    resetDriverForm();
    setDriverDialogOpen(true);
  };

  const openEditDriver = (driver) => {
    setDriverEditing(driver);
    setDriverForm({
      name: driver?.name || "",
      phone: driver?.phone || "",
      email: driver?.email || "",
      notes: driver?.notes || "",
      is_active: driver?.is_active !== false,
    });
    setDriverDialogOpen(true);
  };

  const saveDriver = async () => {
    if (!session?.user?.id) return;
    if (!driverForm.name.trim()) {
      showToast("A sofőr neve kötelező", "error");
      return;
    }

    const payload = {
      user_id: tenantUserId,
      company_id: currentCompanyId,
      name: driverForm.name.trim(),
      phone: driverForm.phone.trim(),
      email: driverForm.email.trim(),
      notes: driverForm.notes.trim(),
      is_active: Boolean(driverForm.is_active),
    };

    const query = driverEditing?.id
      ? supabase.from("drivers").update(payload).eq("id", driverEditing.id).eq("company_id", currentCompanyId)
      : supabase.from("drivers").insert(payload).select("*").limit(1);

    const { data, error } = await query;
    if (error) {
      console.error("drivers save error:", serializeSupabaseError(error), error);
      showToast("A sofőr mentése nem sikerült", "error");
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (driverEditing?.id) {
      setDrivers((prev) => prev.map((d) => (d.id === driverEditing.id ? { ...d, ...payload } : d)));
    } else if (row?.id) {
      setDrivers((prev) => [...prev, { ...payload, id: row.id }].sort((a, b) => a.name.localeCompare(b.name, "hu")));
    }

    setDriverDialogOpen(false);
    resetDriverForm();
    showSaved(driverEditing?.id ? "Sofőr frissítve" : "Sofőr létrehozva");
  };

  const deleteDriver = async () => {
    if (!session?.user?.id || !driverToDelete?.id) return;
    const { error } = await supabase.from("drivers").delete().eq("id", driverToDelete.id).eq("company_id", currentCompanyId);
    if (error) {
      console.error("drivers delete error:", serializeSupabaseError(error), error);
      showToast("A sofőr törlése nem sikerült", "error");
      return;
    }
    setDrivers((prev) => prev.filter((d) => d.id !== driverToDelete.id));
    setDriverToDelete(null);
    showSaved("Sofőr törölve");
  };

  const resetPartnerForm = () => {
    setPartnerForm({
      name: "",
      phone: "",
      email: "",
      address: "",
      contact_person: "",
      notes: "",
      is_active: true,
    });
    setPartnerEditing(null);
  };

  const openCreatePartner = () => {
    resetPartnerForm();
    setPartnerDialogOpen(true);
  };

  const openEditPartner = (partner) => {
    setPartnerEditing(partner);
    setPartnerForm({
      name: partner?.name || "",
      phone: partner?.phone || "",
      email: partner?.email || "",
      address: partner?.address || "",
      contact_person: partner?.contact_person || "",
      notes: partner?.notes || "",
      is_active: partner?.is_active !== false,
    });
    setPartnerDialogOpen(true);
  };

  const savePartner = async () => {
    if (!session?.user?.id) return;
    if (!partnerForm.name.trim()) {
      showToast("A szervizpartner neve kötelező", "error");
      return;
    }

    const payload = {
      user_id: tenantUserId,
      company_id: currentCompanyId,
      name: partnerForm.name.trim(),
      phone: partnerForm.phone.trim(),
      email: partnerForm.email.trim(),
      address: partnerForm.address.trim(),
      contact_person: partnerForm.contact_person.trim(),
      notes: partnerForm.notes.trim(),
      is_active: Boolean(partnerForm.is_active),
    };

    const query = partnerEditing?.id
      ? supabase.from("service_partners").update(payload).eq("id", partnerEditing.id).eq("company_id", currentCompanyId)
      : supabase.from("service_partners").insert(payload).select("*").limit(1);

    const { data, error } = await query;
    if (error) {
      console.error("service_partners save error:", serializeSupabaseError(error), error);
      showToast("A szervizpartner mentése nem sikerült", "error");
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (partnerEditing?.id) {
      setServicePartners((prev) => prev.map((p) => (p.id === partnerEditing.id ? { ...p, ...payload } : p)));
    } else if (row?.id) {
      setServicePartners((prev) => [...prev, { ...payload, id: row.id }].sort((a, b) => a.name.localeCompare(b.name, "hu")));
    }

    setPartnerDialogOpen(false);
    resetPartnerForm();
    showSaved(partnerEditing?.id ? "Szervizpartner frissítve" : "Szervizpartner létrehozva");
  };

  const deletePartner = async () => {
    if (!session?.user?.id || !partnerToDelete?.id) return;
    const { error } = await supabase
      .from("service_partners")
      .delete()
      .eq("id", partnerToDelete.id)
      .eq("company_id", currentCompanyId);
    if (error) {
      console.error("service_partners delete error:", serializeSupabaseError(error), error);
      showToast("A szervizpartner törlése nem sikerült", "error");
      return;
    }
    setServicePartners((prev) => prev.filter((p) => p.id !== partnerToDelete.id));
    setPartnerToDelete(null);
    showSaved("Szervizpartner törölve");
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

        const payload = {
          user_id: session.user.id,
          vehicle_id: vehicleId,
          doc_key: docKey,
          title: defaultMeta.title || "",
          uploaded: true,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          file_url: "",
          storage_path: storagePath,
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
          fileDataUrl: insertedRow?.file_url || "",
          storagePath: insertedRow?.storage_path || storagePath || "",
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

  const openPdfInNewWindow = async (doc) => {
    let fileUrl = String(doc?.fileDataUrl || "");
    if (!fileUrl || (!isDataUrl(fileUrl) && !fileUrl.startsWith("http"))) {
      try {
        fileUrl = await resolveDocumentUrl({ supabase, doc });
      } catch (error) {
        console.error("resolveDocumentUrl error:", error);
        showToast("A PDF aláírt linkje nem kérhető le", "error");
        return;
      }
    }

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

  const openStoredDocument = async (doc) => {
    if (!doc) {
      showToast("Ehhez a dokumentumhoz nincs megnyitható fájl", "error");
      return;
    }

    let resolvedUrl = "";
    try {
      resolvedUrl = await resolveDocumentUrl({ supabase, doc });
    } catch (error) {
      console.error("resolveDocumentUrl error:", error);
      showToast("A dokumentum aláírt linkje nem kérhető le", "error");
      return;
    }

    if (!resolvedUrl) {
      showToast("Ehhez a dokumentumhoz nincs megnyitható fájl", "error");
      return;
    }

    const docForOpen = { ...doc, fileDataUrl: resolvedUrl };

    if (isPreviewablePdf(docForOpen)) {
      await openPdfInNewWindow(docForOpen);
      return;
    }

    setDocumentPreview(docForOpen);
  };

  const downloadStoredDocument = async (doc) => {
    try {
      const fileUrl = await resolveDocumentUrl({ supabase, doc });
      if (!fileUrl) {
        showToast("Ehhez a dokumentumhoz nincs letölthető fájl", "error");
        return;
      }

      if (isDataUrl(fileUrl)) {
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = doc.fileName || "dokumentum";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

      const response = await fetch(fileUrl);
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

  const buildFullJsonExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      vehicles: vehicles.map((vehicle) => ({
        ...vehicle,
        healthIndex: computeVehicleHealthIndex(vehicle, documentsByVehicle),
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
      selectedExports.push(buildServiceHistoryCsvExport(vehiclesForCsv));
    }

    if (exportOptions.healthCsv) {
      selectedExports.push(buildHealthCsvExport(vehiclesForCsv, documentsByVehicle));
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
    const selectedDriver = drivers.find((d) => String(d.id) === String(vehicleDetailsForm.driverId));
    const resolvedOwner = resolveOwnerValue(
      vehicleDetailsForm.ownerMode,
      vehicleDetailsForm.customOwner
    );
    const resolvedDriverName = selectedDriver?.name || resolvedOwner;

    if (!vehicleDetailsForm.name.trim() || !vehicleDetailsForm.plate.trim()) {
      showToast("A jármű neve és a rendszám kötelező", "error");
      return;
    }

    if (!selectedId || !session?.user?.id) {
      showToast("Nincs aktív bejelentkezett felhasználó", "error");
      return;
    }

    if (resolvedDriverName && resolvedOwner && !ownerOptions.includes(resolvedOwner)) {
      setOwnerOptions((prev) => [...prev, resolvedOwner]);
    }

    const vehiclePayload = {
      brand: String(vehicleDetailsForm.brand || "").trim() || null,
      model: String(vehicleDetailsForm.model || "").trim() || null,
      name: vehicleDetailsForm.name.trim(),
      plate: vehicleDetailsForm.plate.toUpperCase().trim(),
      driver: resolvedDriverName,
      driver_id: vehicleDetailsForm.driverId ? Number(vehicleDetailsForm.driverId) : null,
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

    if (currentCompanyRole === "admin") {
      const status =
        vehicleDetailsForm.status === "active" ||
        vehicleDetailsForm.status === "service" ||
        vehicleDetailsForm.status === "inactive"
          ? vehicleDetailsForm.status
          : "active";
      vehiclePayload.status = status;
    }

    const insuranceExpiryValue = vehicleDetailsForm.insuranceExpiry || "";
    const inspectionExpiryValue = vehicleDetailsForm.inspectionExpiry || "";

    try {
      const { error: vehicleError } = await supabase
        .from("vehicles")
        .update(vehiclePayload)
        .eq("id", selectedId)
        .eq("company_id", currentCompanyId);

      if (vehicleError) {
        console.error("Vehicle update error:", serializeSupabaseError(vehicleError), vehicleError);
        showToast("Nem sikerült menteni a jármű adatait", "error");
        return;
      }

      const { error: insuranceExpiryError } = await supabase
        .from("vehicle_documents")
        .update({ expiry: insuranceExpiryValue || null })
        .eq("vehicle_id", selectedId)
        .eq("company_id", currentCompanyId)
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
        .eq("company_id", currentCompanyId)
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
                brand: String(vehicleDetailsForm.brand || "").trim(),
                model: String(vehicleDetailsForm.model || "").trim(),
                name: vehicleDetailsForm.name.trim(),
                plate: vehicleDetailsForm.plate.toUpperCase().trim(),
                driver: resolvedDriverName,
                driver_id: vehicleDetailsForm.driverId ? Number(vehicleDetailsForm.driverId) : null,
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
                status: vehiclePayload.status ?? v.status,
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
      brand: selectedVehicle.brand || "",
      model: selectedVehicle.model || "",
      name: selectedVehicle.name || "",
      plate: selectedVehicle.plate || "",
      status: selectedVehicle.lifecycleStatus || "active",
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
      brand: selectedVehicle.brand || "",
      model: selectedVehicle.model || "",
      name: selectedVehicle.name || "",
      plate: selectedVehicle.plate || "",
      status: selectedVehicle.lifecycleStatus || "active",
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
      const selectedPartner = servicePartners.find(
        (p) => String(p.id) === String(serviceHistoryDraft.servicePartnerId)
      );
      const resolvedPartnerName = selectedPartner?.name || "";

      const { data: insertedServiceRows, error: serviceInsertError } = await supabase
        .from("service_history")
        .insert({
          user_id: session.user.id,
          vehicle_id: selectedId,
          entry_date: serviceHistoryDraft.date,
          km: kmValue,
          service_type: resolvedServiceType,
          cost: costValue,
          service_partner_id: serviceHistoryDraft.servicePartnerId
            ? Number(serviceHistoryDraft.servicePartnerId)
            : null,
          provider: resolvedPartnerName,
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
        provider: resolvedPartnerName,
        servicePartnerId: serviceHistoryDraft.servicePartnerId
          ? Number(serviceHistoryDraft.servicePartnerId)
          : null,
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

          return mergeVehicleHistoryWithBaseline({
            ...vehicle,
            currentKm: Math.max(Number(recalculated.currentKm || 0), nextCurrentKm),
            lastServiceKm: Number(recalculated.lastServiceKm || kmValue),
            serviceHistory: recalculated.serviceHistory,
          });
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
        servicePartnerId: "",
        note: "",
      });

      showSaved("Szerviz bejegyzés hozzáadva");
    } catch (error) {
      console.error("addServiceHistoryEntry error:", error);
      showToast("A szerviz bejegyzést nem sikerült menteni", "error");
    }
  };



const handleDriverKmSave = async () => {
  if (!session?.user?.id || !currentDriver?.id || !selectedDriverVehicle?.id) return;
  if (driverRequestLocksRef.current.driverKmSave) return;
  driverRequestLocksRef.current.driverKmSave = true;

  const targetVehicleId = selectedDriverVehicle.id;

  const trimmed = String(driverKmDraft ?? "").trim();
  const newKm = Number(trimmed);

  if (trimmed === "" || Number.isNaN(newKm)) {
    showToast("Érvényes km megadása kötelező", "error");
    driverRequestLocksRef.current.driverKmSave = false;
    return;
  }

  const currentKm = Number(selectedDriverVehicle.currentKm || 0);
  if (newKm < currentKm) {
    showToast(`Az új km nem lehet kisebb a jelenleginél (${formatKmHu(currentKm)} km)`, "error");
    driverRequestLocksRef.current.driverKmSave = false;
    return;
  }

  setDriverKmSaving(true);

  try {
    const insertPayload = {
      // Driver-side RLS insert policies are based on the driver's auth user,
      // so keep `km_logs.user_id` as the current session user.
      user_id: session.user.id,
      vehicle_id: targetVehicleId,
      entry_date: todayIso(),
      km: newKm,
      note: "",
      driver_id: currentDriver.id,
      source: "driver",
    };

    const { data: insertedKmRows, error: kmInsertError } = await supabase
      .from("km_logs")
      .insert(insertPayload)
      .select("*")
      .limit(1);

    if (kmInsertError) {
      console.error("km_logs insert error (driver):", serializeSupabaseError(kmInsertError), kmInsertError);
      if (shouldQueueDueToConnectivity(kmInsertError)) {
        enqueueDriverOutboxItem({
          type: "km_save",
          payload: { vehicleId: targetVehicleId, newKm, note: "" },
        });
        refreshDriverOutboxCount();
        showToast("Gyenge hálózat: a km mentés függőbe került, később automatikusan beküldjük.", "warning");
        return;
      }
      showToast("A km rögzítése nem sikerült", "error");
      return;
    }

    const insertedRow = insertedKmRows?.[0];
    const newEntry = insertedRow
      ? mapSupabaseKmRow(insertedRow)
      : mapSupabaseKmRow({
          id: `local-${Date.now()}`,
          entry_date: insertPayload.entry_date,
          km: newKm,
          note: "",
        });

    const { error: vehicleUpdateError } = await supabase
      .from("vehicles")
      .update({ currentKm: newKm })
      .eq("id", targetVehicleId);

    if (vehicleUpdateError) {
      console.error("vehicles update after km_logs (driver):", vehicleUpdateError);
      if (shouldQueueDueToConnectivity(vehicleUpdateError)) {
        enqueueDriverOutboxItem({
          type: "km_save",
          payload: { vehicleId: targetVehicleId, newKm, note: "" },
        });
        refreshDriverOutboxCount();
        showToast("Gyenge hálózat: a km mentés függőbe került, később automatikusan beküldjük.", "warning");
        return;
      }
      showToast("A jármű km adatait nem sikerült frissíteni", "error");
      return;
    }

    // Rebuild history from DB so each km_logs row stays a separate entry (no client merge/replace).
    const { data: freshVehicle, error: freshVehicleError } = await supabase
      .from("vehicles")
      .select("*")
      .eq("id", targetVehicleId)
      .maybeSingle();

    const { data: kmRows, error: kmRefreshError } = await supabase
      .from("km_logs")
      .select("*")
      .eq("vehicle_id", targetVehicleId)
      .order("entry_date", { ascending: false });

    const { data: svcRows, error: svcRefreshError } = await supabase
      .from("service_history")
      .select("*")
      .eq("vehicle_id", targetVehicleId)
      .order("entry_date", { ascending: false });

    if (kmRefreshError) {
      console.error("km_logs refresh after driver save:", kmRefreshError);
    }
    if (svcRefreshError) {
      console.error("service_history refresh after driver save:", svcRefreshError);
    }

    if (!freshVehicleError && freshVehicle) {
      const rebuilt = attachHistoryToVehicles([freshVehicle], svcRows || [], kmRows || [])[0];
      setDriverVehicles((prev) =>
        prev.map((v) => (String(v.id) === String(targetVehicleId) ? rebuilt : v))
      );
    } else {
      setDriverVehicles((prev) =>
        prev.map((v) => {
          if (String(v.id) !== String(targetVehicleId)) return v;
          const history = Array.isArray(v.serviceHistory) ? v.serviceHistory : [];
          const recalculated = deriveVehicleKmStateFromHistory(v, [newEntry, ...history]);
          return mergeVehicleHistoryWithBaseline({
            ...v,
            currentKm: Number(recalculated.currentKm || newKm),
            lastServiceKm: Number(recalculated.lastServiceKm || v.lastServiceKm || 0),
            serviceHistory: recalculated.serviceHistory,
          });
        })
      );
    }

    setDriverKmDraft("");
    clearDriverDraft("kmDraft", targetVehicleId);
    showSaved("Km rögzítve");
  } catch (error) {
    console.error("handleDriverKmSave error:", error);
    if (shouldQueueDueToConnectivity(error)) {
      enqueueDriverOutboxItem({
        type: "km_save",
        payload: { vehicleId: targetVehicleId, newKm, note: "" },
      });
      refreshDriverOutboxCount();
      showToast("Gyenge hálózat: a km mentés függőbe került, később automatikusan beküldjük.", "warning");
    } else {
      showToast("A km rögzítése nem sikerült", "error");
    }
  } finally {
    setDriverKmSaving(false);
    driverRequestLocksRef.current.driverKmSave = false;
  }
};

const persistDriverOdometerReading = async ({ vehicleId, newKm, note = "" }) => {
  if (!session?.user?.id || !currentDriver?.id || !vehicleId) return { ok: false };

  const targetVehicleId = vehicleId;
  const roundedKm = Math.round(Number(newKm));
  if (!Number.isFinite(roundedKm) || roundedKm < 0) return { ok: false };

  const insertPayload = {
    user_id: session.user.id,
    vehicle_id: targetVehicleId,
    entry_date: todayIso(),
    km: roundedKm,
    note: String(note || ""),
    driver_id: currentDriver.id,
    source: "driver",
  };

  const { data: insertedKmRows, error: kmInsertError } = await supabase
    .from("km_logs")
    .insert(insertPayload)
    .select("*")
    .limit(1);

  if (kmInsertError) {
    console.error("km_logs insert error (driver journey km sync):", serializeSupabaseError(kmInsertError), kmInsertError);
    return { ok: false, error: kmInsertError };
  }

  const insertedRow = insertedKmRows?.[0];
  const newEntry = insertedRow
    ? mapSupabaseKmRow(insertedRow)
    : mapSupabaseKmRow({
        id: `local-${Date.now()}`,
        entry_date: insertPayload.entry_date,
        km: roundedKm,
        note: insertPayload.note,
      });

  const { error: vehicleUpdateError } = await supabase.from("vehicles").update({ currentKm: roundedKm }).eq("id", targetVehicleId);

  if (vehicleUpdateError) {
    console.error("vehicles update after km_logs (driver journey km sync):", vehicleUpdateError);
    return { ok: false, error: vehicleUpdateError };
  }

  const { data: freshVehicle, error: freshVehicleError } = await supabase.from("vehicles").select("*").eq("id", targetVehicleId).maybeSingle();

  const { data: kmRows, error: kmRefreshError } = await supabase
    .from("km_logs")
    .select("*")
    .eq("vehicle_id", targetVehicleId)
    .order("entry_date", { ascending: false });

  const { data: svcRows, error: svcRefreshError } = await supabase
    .from("service_history")
    .select("*")
    .eq("vehicle_id", targetVehicleId)
    .order("entry_date", { ascending: false });

  if (kmRefreshError) {
    console.error("km_logs refresh after driver journey km sync:", kmRefreshError);
  }
  if (svcRefreshError) {
    console.error("service_history refresh after driver journey km sync:", svcRefreshError);
  }

  if (!freshVehicleError && freshVehicle) {
    const rebuilt = attachHistoryToVehicles([freshVehicle], svcRows || [], kmRows || [])[0];
    setDriverVehicles((prev) => prev.map((v) => (String(v.id) === String(targetVehicleId) ? rebuilt : v)));
  } else {
    setDriverVehicles((prev) =>
      prev.map((v) => {
        if (String(v.id) !== String(targetVehicleId)) return v;
        const history = Array.isArray(v.serviceHistory) ? v.serviceHistory : [];
        const recalculated = deriveVehicleKmStateFromHistory(v, [newEntry, ...history]);
        return mergeVehicleHistoryWithBaseline({
          ...v,
          currentKm: Number(recalculated.currentKm || roundedKm),
          lastServiceKm: Number(recalculated.lastServiceKm || v.lastServiceKm || 0),
          serviceHistory: recalculated.serviceHistory,
        });
      })
    );
  }

  return { ok: true };
};

const handleDriverJourneyStart = async () => {
  if (!session?.user?.id || !currentDriver?.id || !selectedDriverVehicle?.id) return;
  if (driverRequestLocksRef.current.driverJourneyStart) return;
  driverRequestLocksRef.current.driverJourneyStart = true;
  if (selectedDriverActiveJourney?.id) {
    showToast("Van folyamatban lévő út ennél a járműnél", "error");
    driverRequestLocksRef.current.driverJourneyStart = false;
    return;
  }

  const startLocation = String(driverJourneyDraft.startLocation || "").trim();
  const tripType = driverJourneyDraft.tripType === "private" ? "private" : "business";
  const startKmRaw = String(driverJourneyDraft.startKm || "").trim();
  const startKm =
    startKmRaw === "" ? Number(selectedDriverVehicle.currentKm || 0) : Number(startKmRaw);

  if (!startLocation) {
    showToast("Indulási hely megadása kötelező", "error");
    driverRequestLocksRef.current.driverJourneyStart = false;
    return;
  }
  if (Number.isNaN(startKm) || startKm < 0) {
    showToast("Érvényes induló km megadása kötelező", "error");
    driverRequestLocksRef.current.driverJourneyStart = false;
    return;
  }

  setDriverJourneySaving(true);
  try {
    const payload = {
      user_id: selectedDriverVehicle.user_id,
      vehicle_id: selectedDriverVehicle.id,
      driver_id: currentDriver.id,
      started_at: new Date().toISOString(),
      start_km: Math.round(startKm),
      start_location: startLocation,
      trip_type: tripType,
      created_by_auth_user_id: session.user.id,
    };

    const { data, error } = await supabase
      .from("journey_logs")
      .insert(payload)
      .select("*")
      .limit(1);

    if (error) {
      console.error("journey_logs insert error:", serializeSupabaseError(error), error);
      showToast("Az út indítása nem sikerült", "error");
      return;
    }

    const inserted = data?.[0];
    if (inserted?.id) {
      setDriverActiveJourneysByVehicle((prev) => ({
        ...prev,
        [String(selectedDriverVehicle.id)]: inserted,
      }));
    }

    setDriverJourneyDraft((prev) => ({
      ...prev,
      startLocation: "",
      startKm: "",
    }));
    clearDriverDraft("journeyDraft", selectedDriverVehicle.id);
    showSaved("Út elindítva");
  } catch (error) {
    console.error("handleDriverJourneyStart error:", error);
    showToast("Az út indítása nem sikerült", "error");
  } finally {
    setDriverJourneySaving(false);
    driverRequestLocksRef.current.driverJourneyStart = false;
  }
};

const handleDriverJourneyStop = async () => {
  if (!session?.user?.id || !currentDriver?.id || !selectedDriverVehicle?.id) return;
  if (driverRequestLocksRef.current.driverJourneyStop) return;
  driverRequestLocksRef.current.driverJourneyStop = true;
  const active = selectedDriverActiveJourney;
  if (!active?.id) {
    showToast("Nincs folyamatban lévő út ennél a járműnél", "error");
    driverRequestLocksRef.current.driverJourneyStop = false;
    return;
  }

  const endLocation = String(driverJourneyDraft.endLocation || "").trim();
  const endKmRaw = String(driverJourneyDraft.endKm || "").trim();
  const endKm = Number(endKmRaw);

  if (!endLocation) {
    showToast("Érkezési hely megadása kötelező", "error");
    driverRequestLocksRef.current.driverJourneyStop = false;
    return;
  }
  if (endKmRaw === "" || Number.isNaN(endKm) || endKm < 0) {
    showToast("Érvényes érkező km megadása kötelező", "error");
    driverRequestLocksRef.current.driverJourneyStop = false;
    return;
  }

  const startKm = Number(active.start_km ?? active.startKm ?? 0);
  if (endKm < startKm) {
    showToast(`Az érkező km nem lehet kisebb az indulónál (${formatKmHu(startKm)} km)`, "error");
    driverRequestLocksRef.current.driverJourneyStop = false;
    return;
  }

  setDriverJourneySaving(true);
  try {
    const payload = {
      ended_at: new Date().toISOString(),
      end_km: Math.round(endKm),
      end_location: endLocation,
      ended_by_auth_user_id: session.user.id,
    };

    const { data, error } = await supabase
      .from("journey_logs")
      .update(payload)
      .eq("id", active.id)
      .select("*")
      .limit(1);

    if (error) {
      console.error("journey_logs stop update error:", serializeSupabaseError(error), error);
      showToast("Az út lezárása nem sikerült", "error");
      return;
    }

    const roundedEndKm = Math.round(endKm);
    const currentKm = Number(selectedDriverVehicle.currentKm || 0);
    if (roundedEndKm > currentKm) {
      const kmSync = await persistDriverOdometerReading({
        vehicleId: selectedDriverVehicle.id,
        newKm: roundedEndKm,
        note: "Út lezárás",
      });
      if (!kmSync?.ok) {
        showToast("Az út lezáródott, de a km rögzítése nem sikerült", "error");
      }
    }

    setDriverActiveJourneysByVehicle((prev) => {
      const next = { ...prev };
      delete next[String(selectedDriverVehicle.id)];
      return next;
    });

    setDriverJourneyDraft((prev) => ({
      ...prev,
      endLocation: "",
      endKm: "",
    }));
    clearDriverDraft("journeyDraft", selectedDriverVehicle.id);

    showSaved("Út lezárva");
  } catch (error) {
    console.error("handleDriverJourneyStop error:", error);
    showToast("Az út lezárása nem sikerült", "error");
  } finally {
    setDriverJourneySaving(false);
    driverRequestLocksRef.current.driverJourneyStop = false;
  }
};

const handleDriverExpenseSave = async () => {
  if (!session?.user?.id || !currentDriver?.id || !selectedDriverVehicle?.id) return;
  if (driverRequestLocksRef.current.driverExpenseSave) return;
  driverRequestLocksRef.current.driverExpenseSave = true;

  const vehicle = selectedDriverVehicle;
  const occurredAt = String(driverExpenseDraft.occurredAt || "").trim();
  const occurredIso = occurredAt ? new Date(`${occurredAt}T12:00:00.000Z`).toISOString() : new Date().toISOString();

  const expenseType = driverExpenseDraft.expenseType || "fuel";
  const grossRaw = String(driverExpenseDraft.grossAmount || "").trim().replace(",", ".");
  const grossAmount = Number(grossRaw);
  if (!grossRaw || Number.isNaN(grossAmount) || grossAmount < 0) {
    showToast("Érvényes bruttó összeg megadása kötelező", "error");
    driverRequestLocksRef.current.driverExpenseSave = false;
    return;
  }

  const litersRaw = String(driverExpenseDraft.liters || "").trim().replace(",", ".");
  const unitRaw = String(driverExpenseDraft.unitPrice || "").trim().replace(",", ".");
  const liters = litersRaw ? Number(litersRaw) : null;
  const unitPrice = unitRaw ? Number(unitRaw) : null;

  if (expenseType === "fuel") {
    if (liters == null || Number.isNaN(liters) || liters <= 0) {
      showToast("Tankolásnál a liter megadása kötelező", "error");
      driverRequestLocksRef.current.driverExpenseSave = false;
      return;
    }
  }

  const odometerRaw = String(driverExpenseDraft.odometerKm || "").trim();
  const odometerKm = odometerRaw === "" ? null : Number(odometerRaw);
  if (odometerKm != null && (Number.isNaN(odometerKm) || odometerKm < 0)) {
    showToast("Érvényes km óraállást adj meg", "error");
    driverRequestLocksRef.current.driverExpenseSave = false;
    return;
  }

  const payload = {
    user_id: vehicle.user_id,
    vehicle_id: vehicle.id,
    driver_id: currentDriver.id,
    expense_type: expenseType,
    occurred_at: occurredIso,
    station_name: String(driverExpenseDraft.stationName || "").trim() || null,
    station_location: String(driverExpenseDraft.stationLocation || "").trim() || null,
    odometer_km: odometerKm == null ? null : Math.round(odometerKm),
    currency: String(driverExpenseDraft.currency || "HUF").trim() || "HUF",
    gross_amount: Number(grossAmount.toFixed(2)),
    payment_method: String(driverExpenseDraft.paymentMethod || "").trim() || null,
    payment_card_last4: String(driverExpenseDraft.paymentCardLast4 || "").trim() || null,
    fuel_type: expenseType === "fuel" ? String(driverExpenseDraft.fuelType || "").trim() || null : null,
    liters: expenseType === "fuel" && liters != null && !Number.isNaN(liters) ? Number(liters.toFixed(3)) : null,
    unit_price:
      expenseType === "fuel" && unitPrice != null && !Number.isNaN(unitPrice)
        ? Number(unitPrice.toFixed(3))
        : null,
    receipt_storage_path: null,
    receipt_mime: null,
    receipt_original_filename: null,
    status: "posted",
    note: String(driverExpenseDraft.note || "").trim() || null,
    created_by_auth_user_id: session.user.id,
  };

  setDriverExpenseSaving(true);
  try {
    if (driverExpenseReceiptFile) {
      const file = driverExpenseReceiptFile;
      const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
      const maxBytes = 8 * 1024 * 1024;
      if (file.size > maxBytes) {
        showToast("A bizonylat túl nagy (max 8 MB)", "error");
        driverRequestLocksRef.current.driverExpenseSave = false;
        return;
      }
      if (file.type && !allowedTypes.includes(file.type)) {
        showToast("Csak PDF, JPG, PNG vagy WEBP tölthető fel", "error");
        driverRequestLocksRef.current.driverExpenseSave = false;
        return;
      }

      const month = String(payload.occurred_at || "").slice(0, 7) || todayIso().slice(0, 7);
      const storagePath = `${vehicle.user_id}/${vehicle.id}/${month}/${Date.now()}-${sanitizeStorageSegment(file.name)}`;
      const { error: uploadError } = await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (uploadError) {
        if (isSupabaseStorageBucketNotFoundError(uploadError)) {
          console.warn("expense-receipts upload:", serializeSupabaseError(uploadError));
          showToast(expenseReceiptBucketMissingUserHint(EXPENSE_RECEIPTS_STORAGE_BUCKET), "error");
        } else {
          console.error("expense-receipts upload error:", uploadError);
          showToast("A bizonylat feltöltése nem sikerült", "error");
        }
        driverRequestLocksRef.current.driverExpenseSave = false;
        return;
      }

      payload.receipt_storage_path = storagePath;
      payload.receipt_mime = file.type || null;
      payload.receipt_original_filename = file.name || null;
    }

    const { data, error } = await supabase
      .from("expense_entries")
      .insert(payload)
      .select("*")
      .limit(1);

    if (error) {
      if (payload.receipt_storage_path) {
        await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).remove([payload.receipt_storage_path]);
      }
      console.error("expense_entries insert error:", serializeSupabaseError(error), error);
      if (!payload.receipt_storage_path && shouldQueueDueToConnectivity(error)) {
        enqueueDriverOutboxItem({
          type: "expense_save",
          payload: { insertPayload: payload },
        });
        refreshDriverOutboxCount();
        showToast("Gyenge hálózat: a költség mentés függőbe került, később automatikusan beküldjük.", "warning");
        return;
      }
      showToast("A költség mentése nem sikerült", "error");
      return;
    }

    const inserted = data?.[0];
    if (inserted?.id) {
      setDriverExpensesByVehicle((prev) => {
        const key = String(vehicle.id);
        const current = Array.isArray(prev?.[key]) ? prev[key] : [];
        return {
          ...prev,
          [key]: [inserted, ...current].slice(0, 120),
        };
      });
    }

    showSaved("Költség rögzítve");
    setDriverExpenseDraft((prev) => ({
      ...prev,
      stationName: "",
      stationLocation: "",
      liters: "",
      unitPrice: "",
      grossAmount: "",
      paymentCardLast4: "",
      note: "",
    }));
    setDriverExpenseReceiptFile(null);
  } catch (error) {
    console.error("handleDriverExpenseSave error:", error);
    if (!driverExpenseReceiptFile && shouldQueueDueToConnectivity(error)) {
      enqueueDriverOutboxItem({
        type: "expense_save",
        payload: { insertPayload: payload },
      });
      refreshDriverOutboxCount();
      showToast("Gyenge hálózat: a költség mentés függőbe került, később automatikusan beküldjük.", "warning");
    } else {
      showToast("A költség mentése nem sikerült", "error");
    }
  } finally {
    setDriverExpenseSaving(false);
    driverRequestLocksRef.current.driverExpenseSave = false;
  }
};

const openDriverExpenseDraft = (entry) => {
  if (!entry) return;
  setDriverExpenseDraftEntry(entry);
  setDriverExpenseDraftForm({
    occurredAt: String(entry.occurred_at || "").slice(0, 10) || todayIso(),
    stationName: entry.station_name || "",
    stationLocation: entry.station_location || "",
    odometerKm: entry.odometer_km != null ? String(entry.odometer_km) : "",
    currency: entry.currency || "HUF",
    grossAmount: entry.gross_amount != null ? String(entry.gross_amount) : "",
    netAmount: entry.net_amount != null ? String(entry.net_amount) : "",
    vatAmount: entry.vat_amount != null ? String(entry.vat_amount) : "",
    vatRate: entry.vat_rate != null ? String(entry.vat_rate) : "",
    invoiceNumber: entry.invoice_number || "",
    paymentMethod: entry.payment_method || "",
    paymentCardLast4: entry.payment_card_last4 || "",
    fuelType: entry.fuel_type || "",
    liters: entry.liters != null ? String(entry.liters) : "",
    unitPrice: entry.unit_price != null ? String(entry.unit_price) : "",
    expenseType: entry.expense_type || "fuel",
    note: entry.note || "",
  });
  setDriverExpenseDraftOpen(true);
};

const saveDriverExpenseDraft = async (nextStatus) => {
  if (!session?.user?.id || !currentDriver?.id) return;
  const entry = driverExpenseDraftEntry;
  if (!entry?.id) return;

  const occurredIso = driverExpenseDraftForm.occurredAt
    ? new Date(`${driverExpenseDraftForm.occurredAt}T12:00:00.000Z`).toISOString()
    : new Date().toISOString();

  const toNum = (v) => {
    const raw = String(v || "").trim().replace(",", ".");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  };

  const payload = {
    occurred_at: occurredIso,
    station_name: String(driverExpenseDraftForm.stationName || "").trim() || null,
    station_location: String(driverExpenseDraftForm.stationLocation || "").trim() || null,
    odometer_km: toNum(driverExpenseDraftForm.odometerKm) == null ? null : Math.round(toNum(driverExpenseDraftForm.odometerKm)),
    currency: String(driverExpenseDraftForm.currency || "HUF").trim() || "HUF",
    gross_amount: toNum(driverExpenseDraftForm.grossAmount) == null ? 0 : Number(toNum(driverExpenseDraftForm.grossAmount).toFixed(2)),
    net_amount: toNum(driverExpenseDraftForm.netAmount) == null ? null : Number(toNum(driverExpenseDraftForm.netAmount).toFixed(2)),
    vat_amount: toNum(driverExpenseDraftForm.vatAmount) == null ? null : Number(toNum(driverExpenseDraftForm.vatAmount).toFixed(2)),
    vat_rate: toNum(driverExpenseDraftForm.vatRate),
    invoice_number: String(driverExpenseDraftForm.invoiceNumber || "").trim() || null,
    payment_method: String(driverExpenseDraftForm.paymentMethod || "").trim() || null,
    payment_card_last4: String(driverExpenseDraftForm.paymentCardLast4 || "").trim() || null,
    fuel_type: String(driverExpenseDraftForm.fuelType || "").trim() || null,
    liters: toNum(driverExpenseDraftForm.liters) == null ? null : Number(toNum(driverExpenseDraftForm.liters).toFixed(3)),
    unit_price: toNum(driverExpenseDraftForm.unitPrice) == null ? null : Number(toNum(driverExpenseDraftForm.unitPrice).toFixed(3)),
    expense_type: driverExpenseDraftForm.expenseType || "fuel",
    note: String(driverExpenseDraftForm.note || "").trim() || null,
    status: nextStatus,
  };

  setDriverExpenseSaving(true);
  try {
    const { data, error } = await supabase
      .from("expense_entries")
      .update(payload)
      .eq("id", entry.id)
      .select("*")
      .limit(1);

    if (error) {
      console.error("expense_entries draft update error:", serializeSupabaseError(error), error);
      showToast("A draft mentése nem sikerült", "error");
      return;
    }

    const updated = data?.[0];
    if (updated?.id) {
      setDriverExpensesByVehicle((prev) => {
        const key = String(updated.vehicle_id);
        const current = Array.isArray(prev?.[key]) ? prev[key] : [];
        return {
          ...prev,
          [key]: current.map((r) => (r.id === updated.id ? updated : r)),
        };
      });
    }

    setDriverExpenseDraftOpen(false);
    setDriverExpenseDraftEntry(null);
    showSaved(nextStatus === "posted" ? "Mentve (jóváhagyva)" : "Mentve (elutasítva)");
  } catch (error) {
    console.error("saveDriverExpenseDraft error:", error);
    showToast("A draft mentése nem sikerült", "error");
  } finally {
    setDriverExpenseSaving(false);
  }
};

const handleDriverExpenseAiProcess = async () => {
  if (!session?.user?.id) {
    showToast("Bejelentkezés szükséges", "error");
    return;
  }
  if (!currentDriver?.id) {
    showToast("Ehhez a fiókhoz nincs sofőr profil. Az admin kösse össze a sofőrt ezzel a bejelentkezéssel.", "error");
    return;
  }
  if (!selectedDriverVehicle?.id) {
    showToast("Válassz járművet a listában az AI kitöltés előtt.", "error");
    return;
  }
  const vehicle = selectedDriverVehicle;
  const file = driverExpenseAiFile;
  if (!file) {
    showToast("Válassz bizonylat képet vagy PDF-et", "error");
    return;
  }

  setDriverExpenseAiSaving(true);
  try {
    const month = todayIso().slice(0, 7);
    const storagePath = `${vehicle.user_id}/${vehicle.id}/${month}/${Date.now()}-${sanitizeStorageSegment(file.name)}`;
    const { error: uploadError } = await supabase.storage.from(EXPENSE_RECEIPTS_STORAGE_BUCKET).upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
    if (uploadError) {
      if (isSupabaseStorageBucketNotFoundError(uploadError)) {
        console.warn("expense-receipts AI upload:", serializeSupabaseError(uploadError));
        showToast(expenseReceiptBucketMissingUserHint(EXPENSE_RECEIPTS_STORAGE_BUCKET), "error");
      } else {
        console.error("expense-receipts AI upload error:", uploadError);
        showToast("A bizonylat feltöltése nem sikerült", "error");
      }
      return;
    }

    const { data: sessWrap, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) {
      console.warn("getSession before AI:", sessErr);
    }
    const accessToken = sessWrap?.session?.access_token || session?.access_token;
    if (!accessToken) {
      showToast("Bejelentkezés lejárt vagy hiányzik a munkamenet. Jelentkezz be újra.", "error");
      return;
    }

    // Same-origin API proxy → avoids browser "Failed to fetch" to *.supabase.co/functions (ad blockers, strict networks).
    const hint =
      driverExpenseAiProvider === "openai" || driverExpenseAiProvider === "gemini" || driverExpenseAiProvider === "auto"
        ? driverExpenseAiProvider
        : "auto";
    const fnUrl = `/api/fleet/process-expense-receipt?ai_provider=${encodeURIComponent(hint)}`;
    const fnRes = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        receipt_storage_path: storagePath,
        vehicle_id: vehicle.id,
        ai_provider: hint,
      }),
    });

    const fnText = await fnRes.text();
    let fnData = null;
    try {
      fnData = fnText ? JSON.parse(fnText) : null;
    } catch {
      fnData = null;
    }

    if (!fnRes.ok) {
      const msg = formatProcessExpenseReceiptHttpFailure(fnRes.status, fnData, fnText);
      console.warn("process-expense-receipt:", fnRes.status, fnText?.slice?.(0, 800));
      showToast(msg, "error");
      return;
    }

    let fnPayload = fnData && typeof fnData === "object" && !Array.isArray(fnData) ? fnData : null;
    if (!fnPayload && typeof fnData === "string") {
      try {
        const parsed = JSON.parse(fnData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fnPayload = parsed;
      } catch {
        /* ignore */
      }
    }
    if (!fnPayload) {
      showToast("Váratlan válasz az AI szolgáltatástól. Frissítsd az oldalt és próbáld újra.", "error");
      return;
    }

    const rawEntryId = fnPayload.entry_id ?? fnPayload.entry?.id;
    const entryId =
      rawEntryId !== undefined && rawEntryId !== null && String(rawEntryId).trim() !== "" ? String(rawEntryId).trim() : null;

    let draft =
      fnPayload.entry && typeof fnPayload.entry === "object" && !Array.isArray(fnPayload.entry) ? fnPayload.entry : null;

    if (entryId && !draft?.id) {
      const { data: entryRows, error: entryErr } = await supabase.from("expense_entries").select("*").eq("id", entryId).limit(1);

      if (entryErr) {
        console.error("expense_entries fetch draft error:", entryErr);
        showToast("A vázlat betöltése nem sikerült (adatbázis).", "error");
        return;
      }
      draft = entryRows?.[0] || null;
    }

    if (draft?.id) {
      setDriverExpensesByVehicle((prev) => {
        const key = String(vehicle.id);
        const current = Array.isArray(prev?.[key]) ? prev[key] : [];
        return {
          ...prev,
          [key]: [draft, ...current].slice(0, 120),
        };
      });
      openDriverExpenseDraft(draft);
      setDriverExpenseAiFile(null);
      showSaved("AI draft elkészült, ellenőrizd és mentsd");
      return;
    }

    if (entryId) {
      showToast(
        "A bejegyzés elkészülhetett a háttérben, de nem sikerült megjeleníteni. Frissítsd az oldalt, vagy nézd meg a költségek listáját.",
        "error",
      );
      return;
    }

    showToast("AI feldolgozás kész, de nem jött vissza bejegyzésazonosító.", "error");
  } catch (error) {
    console.error("handleDriverExpenseAiProcess error:", error);
    showToast("AI feldolgozás nem sikerült", "error");
  } finally {
    setDriverExpenseAiSaving(false);
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

        return mergeVehicleHistoryWithBaseline({
          ...vehicle,
          currentKm: Number(recalculated.currentKm || kmValue),
          lastServiceKm: Number(recalculated.lastServiceKm || vehicle.lastServiceKm || 0),
          serviceHistory: recalculated.serviceHistory,
        });
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
      const { data: deletedRows, error } = await supabase
        .from(targetTable)
        .delete()
        .eq("id", entryId)
        .select("id");

      if (error) {
        console.error(`${targetTable} delete error:`, serializeSupabaseError(error), error);
        showToast("Nem sikerült törölni a bejegyzést", "error");
        return;
      }

      if (!deletedRows?.length) {
        console.warn(`${targetTable} delete affected 0 rows for id:`, entryId);
        showToast("A bejegyzés nem lett törölve (nincs ilyen rekord vagy nincs jogosultság)", "error");
        return;
      }

      const remainingHistory = (Array.isArray(selectedVehicle.serviceHistory) ? selectedVehicle.serviceHistory : [])
        .map(normalizeServiceHistoryItem)
        .filter((entry) => String(entry.id) !== String(entryId));

      const mergedAfterDelete = mergeVehicleHistoryWithBaseline({
        ...selectedVehicle,
        serviceHistory: remainingHistory,
      });

      const recalculated = deriveVehicleKmStateFromHistory(mergedAfterDelete, mergedAfterDelete.serviceHistory);

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
    const selectedDriver = drivers.find((d) => String(d.id) === String(form.driverId));
    const resolvedOwner = resolveOwnerValue(form.ownerMode, form.customOwner);
    const resolvedDriverName = selectedDriver?.name || resolvedOwner;

    if (!form.name || !form.plate || !form.currentKm || !form.lastServiceKm) {
      showToast("A név, rendszám és km mezők kötelezők", "error");
      return;
    }

    if (!session?.user?.id) {
      showToast("Nincs aktív bejelentkezett felhasználó", "error");
      return;
    }

    if (resolvedDriverName && resolvedOwner && !ownerOptions.includes(resolvedOwner)) {
      setOwnerOptions((prev) => [...prev, resolvedOwner]);
    }

    const vehicleInsertPayload = {
      ...buildVehicleDbPayload(form, resolvedDriverName, session.user.id),
      company_id: currentCompanyId,
      driver_id: form.driverId ? Number(form.driverId) : null,
    };

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
        company_id: currentCompanyId,
        vehicle_id: insertedRow.id,
        doc_key: docKey,
        title: doc.title || "",
        uploaded: Boolean(doc.uploaded),
        file_name: doc.fileName || "",
        file_type: doc.fileType || "",
        file_size: Number(doc.fileSize || 0),
        file_url: doc.fileDataUrl || "",
        storage_path: null,
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

      const shouldInsertRegistration =
        registrationFrontStoragePath && registrationBackStoragePath && registrationFrontFile && registrationBackFile;
      if (shouldInsertRegistration) {
        try {
          // Remove the seeded placeholder "registration" row, then insert 2 actual files (front/back).
          await supabase
            .from("vehicle_documents")
            .delete()
            .eq("vehicle_id", insertedRow.id)
            .eq("company_id", currentCompanyId)
            .eq("doc_key", "registration")
            .is("storage_path", null);

          const expiryValue = registrationAiExpiry ? registrationAiExpiry : null;
          const regDocs = [
            {
              user_id: session.user.id,
              company_id: currentCompanyId,
              vehicle_id: insertedRow.id,
              doc_key: "registration",
              title: "Forgalmi (elöl)",
              uploaded: true,
              file_name: registrationFrontFile.name || "",
              file_type: registrationFrontFile.type || "",
              file_size: Number(registrationFrontFile.size || 0),
              file_url: "",
              storage_path: registrationFrontStoragePath,
              uploaded_at: new Date().toISOString(),
              expiry: expiryValue,
              note: "",
            },
            {
              user_id: session.user.id,
              company_id: currentCompanyId,
              vehicle_id: insertedRow.id,
              doc_key: "registration",
              title: "Forgalmi (hátul)",
              uploaded: true,
              file_name: registrationBackFile.name || "",
              file_type: registrationBackFile.type || "",
              file_size: Number(registrationBackFile.size || 0),
              file_url: "",
              storage_path: registrationBackStoragePath,
              uploaded_at: new Date().toISOString(),
              expiry: expiryValue,
              note: "",
            },
          ];

          const { error: regInsertErr } = await supabase.from("vehicle_documents").insert(regDocs);
          if (regInsertErr) {
            console.error("vehicle_documents registration insert error:", serializeSupabaseError(regInsertErr), regInsertErr);
          } else {
            docSeedCollections.registration = [
              {
                id: `reg-front-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: "Forgalmi (elöl)",
                uploaded: true,
                fileName: registrationFrontFile.name || "",
                fileType: registrationFrontFile.type || "",
                fileSize: Number(registrationFrontFile.size || 0),
                fileDataUrl: "",
                storagePath: registrationFrontStoragePath,
                uploadedAt: new Date().toISOString().slice(0, 10),
                expiry: registrationAiExpiry || "",
                note: "",
              },
              {
                id: `reg-back-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: "Forgalmi (hátul)",
                uploaded: true,
                fileName: registrationBackFile.name || "",
                fileType: registrationBackFile.type || "",
                fileSize: Number(registrationBackFile.size || 0),
                fileDataUrl: "",
                storagePath: registrationBackStoragePath,
                uploadedAt: new Date().toISOString().slice(0, 10),
                expiry: registrationAiExpiry || "",
                note: "",
              },
            ];
          }
        } catch (e) {
          console.error("registration docs attach error:", e);
        }
      }

      const hydratedInsertedRow = {
        ...insertedRow,
      driver: insertedRow?.driver ?? insertedRow?.owner ?? resolvedOwner,
        initial_km: insertedRow?.initial_km ?? insertedRow?.initialKm ?? Number(form.currentKm),
        created_at: insertedRow?.created_at ?? insertedRow?.createdAt ?? null,
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

      const newVehicle = mergeVehicleHistoryWithBaseline(mapSupabaseVehicleRow(hydratedInsertedRow));

      setVehicles((prev) => [newVehicle, ...prev]);

      setDocumentsByVehicle((prev) => ({
        ...prev,
        [String(newVehicle.id)]: docSeedCollections,
      }));

      setSelectedId(newVehicle.id);

      setForm({
        brand: "",
        model: "",
        name: "",
        plate: "",
        currentKm: "",
        lastServiceKm: "",
        status: "active",
        ownerMode: ownerOptions[0] || CUSTOM_OWNER_VALUE,
        customOwner: "",
        driverId: "",
        note: "",
        year: "",
        vin: "",
        fuelType: "Benzin",
        insuranceExpiry: "",
        inspectionExpiry: "",
        oilChangeIntervalKm: "15000",
        timingBeltIntervalKm: "180000",
      });

      setRegistrationFrontFile(null);
      setRegistrationBackFile(null);
      setRegistrationFrontStoragePath("");
      setRegistrationBackStoragePath("");
      setRegistrationAiExpiry("");

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
        .eq("company_id", currentCompanyId);

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

  const uploadSelectedVehicleImage = async (file) => {
    if (!file || !selectedId) return;
    if (currentCompanyRole !== "admin") return;
    if (!currentCompanyId) return;

    setVehicleImageUploading(true);
    try {
      const safeName = sanitizeStorageSegment(String(file.name || "vehicle").toLowerCase());
      const ext = safeName.includes(".") ? safeName.split(".").pop() : "";
      const base = safeName.replace(/\.[^/.]+$/, "") || "vehicle";
      const finalName = `${base}-${Date.now()}${ext ? `.${ext}` : ""}`;
      const objectPath = `${currentCompanyId}/vehicles/${selectedId}/${finalName}`;

      const { error: uploadErr } = await supabase.storage
        .from("vehicle_images")
        .upload(objectPath, file, { upsert: true, contentType: file.type || "image/*" });
      if (uploadErr) {
        console.error("vehicle image upload error:", serializeSupabaseError(uploadErr), uploadErr);
        showToast(`Kép feltöltése nem sikerült: ${serializeSupabaseError(uploadErr)}`, "error");
        return;
      }

      const { error: updateErr } = await supabase
        .from("vehicles")
        .update({ image_path: objectPath })
        .eq("id", selectedId)
        .eq("company_id", currentCompanyId);
      if (updateErr) {
        console.error("vehicle image_path update error:", serializeSupabaseError(updateErr), updateErr);
        showToast(`Kép mentése nem sikerült: ${serializeSupabaseError(updateErr)}`, "error");
        return;
      }

      setVehicles((prev) =>
        prev.map((v) => (v.id === selectedId ? { ...v, imagePath: objectPath } : v))
      );
      setVehicleDetailsForm((prev) => ({ ...prev, imagePath: objectPath }));
      showSaved("Kép feltöltve");
    } catch (e) {
      console.error("uploadSelectedVehicleImage error:", e);
      showToast("Kép feltöltése nem sikerült", "error");
    } finally {
      setVehicleImageUploading(false);
    }
  };

  const deleteSelectedVehicleImage = async () => {
    if (!selectedId) return;
    if (currentCompanyRole !== "admin") return;
    if (!currentCompanyId) return;

    const storagePath =
      String(vehicleDetailsForm?.imagePath || "").trim() ||
      String(selectedVehicle?.imagePath || "").trim();
    if (!storagePath) {
      showToast("Nincs törölhető kép", "error");
      return;
    }

    setVehicleImageUploading(true);
    try {
      const { error: storageErr } = await supabase.storage
        .from("vehicle_images")
        .remove([storagePath]);
      if (storageErr) {
        console.error("vehicle image delete storage error:", serializeSupabaseError(storageErr), storageErr);
        showToast(`Kép törlése nem sikerült: ${serializeSupabaseError(storageErr)}`, "error");
        return;
      }

      const { error: updateErr } = await supabase
        .from("vehicles")
        .update({ image_path: null })
        .eq("id", selectedId)
        .eq("company_id", currentCompanyId);
      if (updateErr) {
        console.error("vehicle image_path null update error:", serializeSupabaseError(updateErr), updateErr);
        showToast(`Kép törlése nem sikerült: ${serializeSupabaseError(updateErr)}`, "error");
        return;
      }

      setVehicles((prev) => prev.map((v) => (v.id === selectedId ? { ...v, imagePath: "" } : v)));
      setVehicleDetailsForm((prev) => ({ ...prev, imagePath: "" }));
      showSaved("Kép törölve");
    } catch (e) {
      console.error("deleteSelectedVehicleImage error:", e);
      showToast("Kép törlése nem sikerült", "error");
    } finally {
      setVehicleImageUploading(false);
    }
  };

  const restoreVehicle = async (vehicleId) => {
    if (!session?.user?.id) return;

    try {
      const { error } = await supabase
        .from("vehicles")
        .update({ archived: false })
        .eq("id", vehicleId)
        .eq("company_id", currentCompanyId);

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
        .eq("vehicle_id", vehicleId);

      if (serviceDeleteError) {
        console.error("service_history delete error:", serviceDeleteError);
      }

      const { error: kmDeleteError } = await supabase
        .from("km_logs")
        .delete()
        .eq("vehicle_id", vehicleId);

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
        const storagePath =
          targetDoc?.storagePath || getStoragePathFromFileUrl(targetDoc?.fileDataUrl);
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
              storage_path: null,
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
        <div className="w-full p-8 text-slate-400">Betöltés...</div>
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
    setIsDriver(false);
    setCurrentDriver(null);
    setDriverVehicles([]);
    setSelectedDriverVehicleId(null);
    setDriverKmDraft("");
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

  if (!currentCompanyId) {
    const memberships = Array.isArray(companyMemberships) ? companyMemberships : [];
    return (
      <div className="min-h-screen text-slate-50">
        <div className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-6">
          <div className="w-full rounded-3xl border border-white/10 bg-slate-950/70 p-8 shadow-2xl backdrop-blur">
            <div className="mb-2 text-sm text-cyan-300">Company kiválasztás</div>
            <h1 className="text-3xl font-bold text-white">Válassz céget</h1>
            <p className="mt-3 text-sm text-slate-400">
              Több céghez tartozol, ezért a folytatáshoz ki kell választanod, melyik cég adatait szeretnéd kezelni.
            </p>

            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label>Cég</Label>
                <Select
                  onValueChange={(v) => switchCompany(v)}
                  disabled={companySwitching || memberships.length === 0}
                >
                  <SelectTrigger className="fleet-input rounded-2xl">
                    <SelectValue placeholder={memberships.length > 0 ? "Válassz..." : "Nincs elérhető cég"} />
                  </SelectTrigger>
                  <SelectContent>
                    {memberships.map((m) => {
                      const id = String(m.company_id || "").trim();
                      if (!id) return null;
                      const label = (m.name && String(m.name).trim() !== "" ? m.name : id).trim();
                      return (
                        <SelectItem key={id} value={id}>
                          {label} {m.role ? `(${m.role})` : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-2xl"
                  onClick={() => loadCompanyMemberships(session)}
                  disabled={companySwitching}
                >
                  Lista frissítése
                </Button>
                <Button type="button" variant="ghost" className="rounded-2xl" onClick={handleSignOut}>
                  Kilépés
                </Button>
              </div>

              {initializationError ? (
                <div className="rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                  {initializationError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isDriver) {
    return (
      <>
        <DriverView
          vehicles={driverVehicles}
          selectedVehicleId={selectedDriverVehicleId}
          onSelectVehicle={(id) => {
            setSelectedDriverVehicleId(id);
            setDriverKmDraft("");
            setDriverJourneyDraft((prev) => ({
              ...prev,
              startKm: "",
              startLocation: "",
              endKm: "",
              endLocation: "",
            }));
          }}
          vehicle={selectedDriverVehicle}
          registrationDoc={selectedDriverRegistrationDoc}
          onOpenDocument={openStoredDocument}
          onDownloadDocument={downloadStoredDocument}
          journeyDraft={driverJourneyDraft}
          onJourneyDraftChange={setDriverJourneyDraft}
          activeJourney={selectedDriverActiveJourney}
          onStartJourney={handleDriverJourneyStart}
          onStopJourney={handleDriverJourneyStop}
          journeySaving={driverJourneySaving}
          expenseDraft={driverExpenseDraft}
          onExpenseDraftChange={setDriverExpenseDraft}
          onReceiptFileChange={setDriverExpenseReceiptFile}
          receiptFile={driverExpenseReceiptFile}
          expenses={selectedDriverExpenses}
          onOpenExpense={openDriverExpenseDraft}
          aiFile={driverExpenseAiFile}
          onAiFileChange={setDriverExpenseAiFile}
          aiProvider={driverExpenseAiProvider}
          onAiProviderChange={(v) => {
            const next = v === "openai" || v === "gemini" || v === "auto" ? v : "auto";
            setDriverExpenseAiProvider(next);
            try {
              window.localStorage.setItem("fleet_expense_ai_provider", next);
            } catch {
              /* ignore */
            }
          }}
          onRunAi={handleDriverExpenseAiProcess}
          aiSaving={driverExpenseAiSaving}
          onSubmitExpense={handleDriverExpenseSave}
          expenseSaving={driverExpenseSaving}
          kmValue={driverKmDraft}
          onKmChange={setDriverKmDraft}
          onSubmitKm={handleDriverKmSave}
          saving={driverKmSaving}
          outboxCount={driverOutboxCountState}
          outboxProcessing={driverOutboxProcessing}
          onRetryOutbox={() => processDriverOutboxOnce()}
          onLogout={handleSignOut}
          loadError={initializationError}
        />

        <Dialog open={driverExpenseDraftOpen} onOpenChange={setDriverExpenseDraftOpen}>
          <DialogContent className="fleet-dialog sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>AI draft ellenőrzése</DialogTitle>
              <DialogDescription>Javítsd a mezőket, majd jóváhagyás.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Dátum</Label>
                <Input
                  type="date"
                  value={driverExpenseDraftForm.occurredAt}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, occurredAt: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>
              <div className="space-y-2">
                <Label>Típus</Label>
                <Input
                  value={driverExpenseDraftForm.expenseType}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, expenseType: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>

              <div className="space-y-2">
                <Label>Kút</Label>
                <Input
                  value={driverExpenseDraftForm.stationName}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, stationName: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>
              <div className="space-y-2">
                <Label>Helyszín</Label>
                <Input
                  value={driverExpenseDraftForm.stationLocation}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, stationLocation: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>

              <div className="space-y-2">
                <Label>Liter</Label>
                <Input
                  value={driverExpenseDraftForm.liters}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, liters: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>
              <div className="space-y-2">
                <Label>Egységár</Label>
                <Input
                  value={driverExpenseDraftForm.unitPrice}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, unitPrice: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>

              <div className="space-y-2">
                <Label>Bruttó</Label>
                <Input
                  value={driverExpenseDraftForm.grossAmount}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, grossAmount: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>
              <div className="space-y-2">
                <Label>Pénznem</Label>
                <Input
                  value={driverExpenseDraftForm.currency}
                  onChange={(e) => setDriverExpenseDraftForm((p) => ({ ...p, currency: e.target.value }))}
                  className="fleet-input rounded-2xl"
                  disabled={driverExpenseAiSaving || driverExpenseSaving}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="secondary"
                className="rounded-2xl"
                disabled={driverExpenseAiSaving || driverExpenseSaving}
                onClick={() => saveDriverExpenseDraft("rejected")}
              >
                Elutasítás
              </Button>
              <Button
                className="fleet-primary-btn rounded-2xl"
                disabled={driverExpenseAiSaving || driverExpenseSaving}
                onClick={() => saveDriverExpenseDraft("posted")}
              >
                <Save className="mr-2 h-4 w-4" />
                Jóváhagyás
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            className={`fixed bottom-6 right-6 z-[200] flex max-w-[360px] items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
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
              type="button"
              onClick={() => setToast(null)}
              className="rounded-full border border-white/10 bg-white/5 p-1 text-slate-100 transition hover:bg-white/10"
              title="Bezárás"
            >
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen text-slate-50 md:flex md:items-stretch">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[90] bg-slate-950/70 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fleet-sidebar fixed left-0 top-0 z-[100] h-screen transition-[transform,width] duration-200 md:sticky md:translate-x-0 ${
          sidebarCollapsed ? "w-[84px]" : "w-[292px]"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-3 px-2 py-2">
            <div className="inline-flex items-center gap-2">
              {sidebarCollapsed ? (
                <button
                  className="hidden rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10 md:inline-flex"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="Oldalsáv kinyitása"
                  title="Kinyitás"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-2">
                  <CarFront className="h-4 w-4 text-slate-200" />
                </div>
              )}
              {!sidebarCollapsed && (
                <div>
                  <div className="text-sm font-semibold text-white">Fleet</div>
                  <div className="text-xs text-slate-400">Dashboard</div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!sidebarCollapsed && (
                <button
                  className="hidden rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10 md:inline-flex"
                  onClick={() => setSidebarCollapsed(true)}
                  aria-label="Oldalsáv összecsukása"
                  title="Összecsukás"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
              )}
              <button
                className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10 md:hidden"
                onClick={() => setSidebarOpen(false)}
                aria-label="Menü bezárása"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className={`mt-4 space-y-2 overflow-y-auto ${sidebarCollapsed ? "" : "pr-1"}`}>
            {sidebarCollapsed ? (
              <div className="space-y-2">
                {[
                  { key: "home", label: "Home", Icon: HomeIcon, tone: "" },
                  { key: "vehicles", label: "Gépjárművek", Icon: CarFront, tone: "vehicles" },
                  { key: "documents", label: "Dokumentumok", Icon: FileText, tone: "vehicles" },
                  { key: "service", label: "Szerviz", Icon: Wrench, tone: "vehicles" },
                  { key: "journeys", label: "Útnyilvántartás", Icon: ClipboardList, tone: "vehicles" },
                  { key: "expenses", label: "Költségnapló", Icon: BarChart3, tone: "reports" },
                  { key: "finance", label: "Pénzügyek", Icon: BarChart3, tone: "reports" },
                  { key: "drivers", label: "Sofőrök", Icon: Users, tone: "contacts" },
                  { key: "partners", label: "Szervizpartnerek", Icon: Handshake, tone: "contacts" },
                ].map(({ key, label, Icon, tone }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActivePage(key);
                      setSidebarOpen(false);
                    }}
                    className="fleet-nav-item flex w-full items-center justify-center rounded-2xl p-3"
                    data-active={safePage === key}
                    data-tone={tone || undefined}
                    aria-label={label}
                    title={label}
                  >
                    <Icon className="h-5 w-5" />
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button
                  onClick={() => {
                    setActivePage("home");
                    setSidebarOpen(false);
                  }}
                  className="fleet-nav-item flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-semibold"
                  data-active={safePage === "home"}
                >
                  <HomeIcon className="h-4 w-4" />
                  Home
                </button>

                <div className="pt-2">
                  <button
                    onClick={() =>
                      setSidebarGroupsOpen((prev) => ({ ...prev, vehicles: !prev.vehicles }))
                    }
                    className="fleet-nav-group flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.22em]"
                  >
                    <span>Járművek</span>
                    <ChevronRight
                      className={`h-4 w-4 transition ${sidebarGroupsOpen.vehicles ? "rotate-90" : ""}`}
                    />
                  </button>
                  {sidebarGroupsOpen.vehicles && (
                    <div className="mt-2 space-y-1 pl-1">
                      {[
                        { key: "vehicles", label: "Gépjárművek", Icon: CarFront },
                        { key: "documents", label: "Dokumentumok", Icon: FileText },
                        { key: "service", label: "Szerviz", Icon: Wrench },
                        { key: "journeys", label: "Útnyilvántartás", Icon: ClipboardList },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => {
                            setActivePage(item.key);
                            setSidebarOpen(false);
                          }}
                          className="fleet-nav-item w-full rounded-2xl border px-3 py-2 text-left text-sm"
                          data-active={safePage === item.key}
                          data-tone="vehicles"
                        >
                          <div className="flex items-center gap-2">
                            <item.Icon className="h-4 w-4" />
                            {item.label}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    onClick={() =>
                      setSidebarGroupsOpen((prev) => ({ ...prev, reports: !prev.reports }))
                    }
                    className="fleet-nav-group flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.22em]"
                  >
                    <span>Kimutatások</span>
                    <ChevronRight
                      className={`h-4 w-4 transition ${sidebarGroupsOpen.reports ? "rotate-90" : ""}`}
                    />
                  </button>
                  {sidebarGroupsOpen.reports && (
                    <div className="mt-2 space-y-1 pl-1">
                      <button
                        onClick={() => {
                          setActivePage("expenses");
                          setSidebarOpen(false);
                        }}
                        className="fleet-nav-item w-full rounded-2xl border px-3 py-2 text-left text-sm"
                        data-active={safePage === "expenses"}
                        data-tone="reports"
                      >
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Költségnapló
                        </div>
                      </button>
                      <button
                        onClick={() => {
                          setActivePage("finance");
                          setSidebarOpen(false);
                        }}
                        className="fleet-nav-item w-full rounded-2xl border px-3 py-2 text-left text-sm"
                        data-active={safePage === "finance"}
                        data-tone="reports"
                      >
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Pénzügyek
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <button
                    onClick={() =>
                      setSidebarGroupsOpen((prev) => ({ ...prev, contacts: !prev.contacts }))
                    }
                    className="fleet-nav-group flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.22em]"
                  >
                    <span>Kapcsolatok</span>
                    <ChevronRight
                      className={`h-4 w-4 transition ${sidebarGroupsOpen.contacts ? "rotate-90" : ""}`}
                    />
                  </button>
                  {sidebarGroupsOpen.contacts && (
                    <div className="mt-2 space-y-1 pl-1">
                      {[
                        { key: "drivers", label: "Sofőrök", Icon: Users },
                        { key: "partners", label: "Szervizpartnerek", Icon: Handshake },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => {
                            setActivePage(item.key);
                            setSidebarOpen(false);
                          }}
                          className="fleet-nav-item w-full rounded-2xl border px-3 py-2 text-left text-sm"
                          data-active={safePage === item.key}
                          data-tone="contacts"
                        >
                          <div className="flex items-center gap-2">
                            <item.Icon className="h-4 w-4" />
                            {item.label}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 w-full">
        {/* Mobile top strip */}
        <div className="sticky top-0 z-[80] border-b border-white/10 bg-background/70 px-4 py-3 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between gap-3">
            <button
              className="rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10"
              onClick={() => setSidebarOpen(true)}
              aria-label="Menü megnyitása"
            >
              <Filter className="h-4 w-4" />
            </button>
            <div className="text-sm font-semibold text-white">Fleet</div>
            <div className="w-9" />
          </div>
        </div>

        <div className="fleet-shell w-full px-6 py-8 md:px-8">
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
            {Array.isArray(companyMemberships) && companyMemberships.length > 0 ? (
              <div className="flex items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Company</div>
                <Select
                  value={currentCompanyId || ""}
                  onValueChange={(v) => switchCompany(v)}
                  disabled={companySwitching}
                >
                  <SelectTrigger className="fleet-topbar-chip h-9 rounded-full px-4">
                    <SelectValue placeholder="Válassz céget" />
                  </SelectTrigger>
                  <SelectContent>
                    {companyMemberships.map((m) => (
                      <SelectItem key={`company-${m.company_id}`} value={String(m.company_id)}>
                        {m.name ? `${m.name} (${m.role})` : `${m.company_id.slice(0, 8)}… (${m.role})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="relative" ref={notificationRef}>
              {unreadNotificationsCount > 0 && (
                <span className="pointer-events-none absolute -left-2 -top-2 z-10 flex h-6 min-w-[24px] items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
                  {unreadNotificationsCount}
                </span>
              )}
              <Button
                variant="outline"
                className="fleet-topbar-chip px-4"
                onClick={() => setNotificationOpen((prev) => !prev)}
                data-active={notificationOpen}
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

            <Button variant="outline" className="fleet-topbar-chip px-4" onClick={() => setExportOpen(true)}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>

            {/* Vehicles page has its own header action */}

            <Button variant="outline" className="fleet-topbar-chip px-4" onClick={handleSignOut}>
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
                  <Card
                    className={`fleet-card fleet-stat-card fleet-tint rounded-3xl ${
                      ["fleet-tint-blue", "fleet-tint-emerald", "fleet-tint-amber", "fleet-tint-blue"][idx] ||
                      "fleet-tint-blue"
                    }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardDescription className="text-slate-400">{card.title}</CardDescription>
                        <div className="fleet-stat-icon rounded-2xl p-2">
                          <card.icon className="h-4 w-4 text-slate-200" />
                        </div>
                      </div>

                      <CardTitle className="text-3xl font-bold">
                        <span className="fleet-stat-value inline-block">{card.value}</span>
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
                <Card className="fleet-card fleet-stat-card fleet-health-card fleet-tint fleet-tint-blue flex flex-col rounded-3xl">
                  <CardHeader className="flex flex-row items-center justify-between pb-1">
                    <CardTitle className="text-sm font-medium text-slate-300">
                      Fleet Health Score
                    </CardTitle>

                    <div className="fleet-stat-icon flex h-8 w-8 items-center justify-center rounded-full text-slate-200">
                      <Activity className="h-4 w-4" />
                    </div>
                  </CardHeader>

                  <CardContent className="flex flex-1 items-start justify-center px-4 pb-3 pt-1">
                    <div className="relative -mt-3 flex h-20 w-20 items-center justify-center">

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
                        <span className="bg-gradient-to-br from-cyan-200 via-sky-300 to-cyan-100 bg-clip-text text-2xl font-bold text-transparent">
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

                <div className="rounded-3xl border border-cyan-400/12 bg-slate-950/40 p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.22em] text-cyan-200/80">
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

            <Card className="fleet-card mb-6 rounded-3xl border border-cyan-400/12">
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

                  <div className="rounded-3xl border border-sky-400/20 bg-sky-500/8 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.22em] text-sky-200/80">Lejáratok</div>
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
                        <span className="font-semibold text-cyan-200">
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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-sm text-slate-400">Járművek</div>
                <h2 className="text-2xl font-bold text-white">Gépjárművek</h2>
                <div className="mt-1 text-sm text-slate-400">
                  {vehiclesForCards.length} jármű a szűrésben • {activeVehicles.length} aktív (nem archivált)
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Keresés név vagy rendszám..."
                  className="fleet-input h-11 rounded-2xl sm:w-[280px]"
                />

                <Button className="fleet-primary-btn h-11 rounded-2xl px-5" onClick={() => setOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Új autó
                </Button>

                <Select value={vehicleLifecycleFilter} onValueChange={(v) => setVehicleLifecycleFilter(v)}>
                  <SelectTrigger className="fleet-input h-11 rounded-2xl sm:w-[220px]">
                    <SelectValue placeholder="Szűrés" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Összes (nem archivált)</SelectItem>
                    <SelectItem value="active">Aktív</SelectItem>
                    <SelectItem value="service">Szerviz alatt</SelectItem>
                    <SelectItem value="inactive">Inaktív</SelectItem>
                    <SelectItem value="archived">Archivált</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {vehiclesForCards.map((vehicle) => {
                const lifecycle = String(vehicle.archived ? "archived" : vehicle.lifecycleStatus || "active");
                const badge =
                  lifecycle === "archived"
                    ? { label: "Archivált", tone: "neutral" }
                    : lifecycle === "service"
                      ? { label: "Szerviz alatt", tone: "warn" }
                      : lifecycle === "inactive"
                        ? { label: "Inaktív", tone: "neutral" }
                        : { label: "Aktív", tone: "ok" };

                return (
                  <button
                    key={vehicle.id}
                    onClick={() => {
                      setSelectedId(vehicle.id);
                      setVehicleModalOpen(true);
                      setIsVehicleDetailsEditing(false);
                    }}
                    className={`fleet-card fleet-tint group relative overflow-hidden rounded-3xl text-left transition ${
                      lifecycle === "service"
                        ? "fleet-tint-amber"
                        : lifecycle === "inactive"
                          ? "fleet-tint-blue"
                          : lifecycle === "archived"
                            ? "fleet-tint-blue"
                            : "fleet-tint-emerald"
                    }`}
                  >
                    <div className="relative">
                      <div className="h-32 w-full bg-slate-900/50">
                        {vehicleImageUrlById[String(vehicle.id)] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={vehicleImageUrlById[String(vehicle.id)]}
                            alt={vehicle.name || "Jármű"}
                            className="block h-32 w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-32 items-center justify-center text-xs text-slate-400">Nincs kép</div>
                        )}
                      </div>
                    </div>

                    <div className="p-4">
                      <div className="text-[0.95rem] font-semibold tracking-tight text-foreground">
                        {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || vehicle.name}
                      </div>
                      {vehicle.brand || vehicle.model ? (
                        vehicle.name && vehicle.name !== [vehicle.brand, vehicle.model].filter(Boolean).join(" ") ? (
                          <div className="mt-0.5 text-xs text-slate-400">{vehicle.name}</div>
                        ) : null
                      ) : null}
                      <div className="mt-1 text-sm text-muted-foreground">{vehicle.plate}</div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">Üzemanyag</div>
                          <div className="font-medium text-foreground">{vehicle.fuelType || "—"}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Km</div>
                          <div className="font-medium text-foreground">{formatKmHu(vehicle.currentKm)}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-xs text-muted-foreground">Sofőr</div>
                          <div className="font-medium text-foreground">{vehicle.driver || "Nincs sofőr"}</div>
                        </div>
                      </div>
                    </div>

                    <div className="fleet-status-pill absolute bottom-3 right-3" data-tone={badge.tone}>
                      {badge.label}
                    </div>
                  </button>
                );
              })}
            </div>

            {vehiclesForCards.length === 0 ? (
              <div className="fleet-card rounded-3xl p-6 text-sm text-muted-foreground">
                Nincs találat a megadott szűrőkkel.
              </div>
            ) : null}

            <div className="hidden">
            <div className="grid gap-6 xl:grid-cols-2">
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
                  <div className="space-y-3">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Keresés név vagy rendszám..."
                      className="fleet-input rounded-2xl"
                    />

                    <Select value={vehicleLifecycleFilter} onValueChange={(v) => setVehicleLifecycleFilter(v)}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Szűrés" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Összes (nem archivált)</SelectItem>
                        <SelectItem value="active">Aktív</SelectItem>
                        <SelectItem value="service">Szerviz alatt</SelectItem>
                        <SelectItem value="inactive">Inaktív</SelectItem>
                        <SelectItem value="archived">Archivált</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    {vehiclesForCards.map((vehicle) => {
                      const lifecycle = String(vehicle.archived ? "archived" : vehicle.status || "active");
                      const badge =
                        lifecycle === "archived"
                          ? { label: "Archivált", cls: "border-slate-400/25 bg-slate-400/10 text-slate-100" }
                          : lifecycle === "service"
                            ? { label: "Szerviz alatt", cls: "border-amber-400/25 bg-amber-400/10 text-amber-100" }
                            : lifecycle === "inactive"
                              ? { label: "Inaktív", cls: "border-slate-400/25 bg-slate-900/40 text-slate-200" }
                              : { label: "Aktív", cls: "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" };

                      return (
                        <button
                          key={vehicle.id}
                          onClick={() => {
                            setSelectedId(vehicle.id);
                            setVehicleModalOpen(true);
                            setIsVehicleDetailsEditing(false);
                          }}
                          className={`rounded-3xl border p-4 text-left transition ${
                            selectedVehicle?.id === vehicle.id
                              ? "border-slate-300/30 bg-white/10"
                              : "border-white/10 bg-slate-900/40 hover:bg-white/5"
                          }`}
                        >
                          <div className="mb-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/40">
                            {vehicleImageUrlById[String(vehicle.id)] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={vehicleImageUrlById[String(vehicle.id)]}
                                alt={vehicle.name || "Jármű"}
                                className="block h-28 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-28 items-center justify-center text-xs text-slate-400">Nincs kép</div>
                            )}
                          </div>

                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-white">{vehicle.name}</div>
                              <div className="mt-1 text-sm text-slate-400">{vehicle.plate}</div>
                            </div>
                            <div className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
                              {badge.label}
                            </div>
                          </div>

                          <div className="mt-3 space-y-1 text-sm text-slate-300">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Üzemanyag</span>
                              <span className="font-medium text-slate-200">{vehicle.fuelType || "—"}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Km</span>
                              <span className="font-medium text-slate-200">{formatKmHu(vehicle.currentKm)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-slate-400">Sofőr</span>
                              <span className="font-medium text-slate-200">{vehicle.driver || "Nincs sofőr"}</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {vehiclesForCards.length === 0 && (
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                      Nincs találat a megadott szűrőkkel.
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="hidden">
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
                          value={vehicleDetailsForm.driverId}
                          onValueChange={(value) =>
                            setVehicleDetailsForm({
                              ...vehicleDetailsForm,
                              driverId: value === SELECT_NONE_VALUE ? "" : value,
                            })
                          }
                          disabled={!isVehicleDetailsEditing}
                        >
                          <SelectTrigger className={lockedInputClass}>
                            <SelectValue placeholder="Válassz sofőrt" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SELECT_NONE_VALUE}>Nincs beállítva</SelectItem>
                            {drivers
                              .filter((d) => d.is_active)
                              .map((d) => (
                                <SelectItem key={d.id} value={String(d.id)}>
                                  {d.name}
                                </SelectItem>
                              ))}
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

                      {currentCompanyRole === "admin" ? (
                        <div className="space-y-2">
                          <Label>Státusz</Label>
                          <Select
                            value={vehicleDetailsForm.status}
                            onValueChange={(value) =>
                              setVehicleDetailsForm({
                                ...vehicleDetailsForm,
                                status: value,
                              })
                            }
                            disabled={!isVehicleDetailsEditing}
                          >
                            <SelectTrigger className={lockedInputClass}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Aktív</SelectItem>
                              <SelectItem value="service">Szerviz alatt</SelectItem>
                              <SelectItem value="inactive">Inaktív</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : null}

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

              <Dialog
                open={vehicleModalOpen && !!selectedVehicle}
                onOpenChange={(v) => {
                  setVehicleModalOpen(v);
                  if (!v) setIsVehicleDetailsEditing(false);
                  if (!v) setVehicleShowAllFields(false);
                }}
              >
                <DialogContent className="fleet-dialog sm:max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>
                      {selectedVehicle
                        ? `${[selectedVehicle.brand, selectedVehicle.model].filter(Boolean).join(" ") || selectedVehicle.name} · ${
                            selectedVehicle.plate
                          }`
                        : "Jármű"}
                    </DialogTitle>
                    <DialogDescription>Részletek és szerkesztés</DialogDescription>
                  </DialogHeader>

                  {selectedVehicle ? (
                    <div className="space-y-6">
                      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
                        <div className="space-y-3">
                          <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/40">
                            {vehicleImageUrlById[String(selectedVehicle.id)] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={vehicleImageUrlById[String(selectedVehicle.id)]}
                                alt={selectedVehicle.name || "Jármű"}
                                className="block h-40 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-40 w-full items-center justify-center bg-slate-900/60 text-slate-400">
                                Nincs kép
                              </div>
                            )}
                          </div>

                          {currentCompanyRole === "admin" ? (
                            <div className="space-y-2">
                              <Label>Kép feltöltése</Label>
                              <Input
                                type="file"
                                accept="image/*"
                                disabled={vehicleImageUploading}
                                onChange={(e) => {
                                  const file = e.target.files?.[0] || null;
                                  if (file) void uploadSelectedVehicleImage(file);
                                  try {
                                    e.target.value = "";
                                  } catch {
                                    /* ignore */
                                  }
                                }}
                                className="fleet-input rounded-2xl"
                              />
                            </div>
                          ) : null}

                          {currentCompanyRole === "admin" && vehicleImageUrlById[String(selectedVehicle.id)] ? (
                            <Button
                              type="button"
                              variant="destructive"
                              className="w-full rounded-2xl"
                              disabled={vehicleImageUploading}
                              onClick={deleteSelectedVehicleImage}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Kép törlése
                            </Button>
                          ) : null}
                        </div>

                        <div className="space-y-4">
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
                              Mentés
                            </Button>

                            <Button
                              variant="secondary"
                              className="rounded-2xl"
                              onClick={() => setVehicleShowAllFields((p) => !p)}
                            >
                              <FileText className="mr-2 h-4 w-4" />
                              {vehicleShowAllFields ? "Kevesebb adat" : "Minden adat"}
                            </Button>

                            <Button variant="secondary" className="rounded-2xl" onClick={() => setVehicleToArchive(selectedVehicle)}>
                              <Archive className="mr-2 h-4 w-4" />
                              Archiválás
                            </Button>

                            <Button variant="secondary" className="rounded-2xl" onClick={() => setVehicleToDelete(selectedVehicle)}>
                              <Trash2 className="mr-2 h-4 w-4" />
                              Törlés
                            </Button>
                          </div>

                          {!isVehicleDetailsEditing ? (
                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                              A mezők szerkesztéséhez kattints a Szerkesztés gombra.
                            </div>
                          ) : null}

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>Márka</Label>
                              <Input
                                value={vehicleDetailsForm.brand || ""}
                                disabled={!isVehicleDetailsEditing}
                                onChange={(e) => setVehicleDetailsForm({ ...vehicleDetailsForm, brand: e.target.value })}
                                placeholder="pl. Opel"
                                className={lockedInputClass}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Típus</Label>
                              <Input
                                value={vehicleDetailsForm.model || ""}
                                disabled={!isVehicleDetailsEditing}
                                onChange={(e) => setVehicleDetailsForm({ ...vehicleDetailsForm, model: e.target.value })}
                                placeholder="pl. Astra"
                                className={lockedInputClass}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Jármű neve</Label>
                              <Input
                                value={vehicleDetailsForm.name}
                                disabled={!isVehicleDetailsEditing}
                                onChange={(e) => setVehicleDetailsForm({ ...vehicleDetailsForm, name: e.target.value })}
                                className={lockedInputClass}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Rendszám</Label>
                              <Input
                                value={vehicleDetailsForm.plate}
                                disabled={!isVehicleDetailsEditing}
                                onChange={(e) =>
                                  setVehicleDetailsForm({ ...vehicleDetailsForm, plate: e.target.value.toUpperCase() })
                                }
                                className={lockedInputClass}
                              />
                            </div>

                            <div className="space-y-2">
                              <Label>Sofőr</Label>
                              <Select
                                value={vehicleDetailsForm.driverId}
                                onValueChange={(value) =>
                                  setVehicleDetailsForm({
                                    ...vehicleDetailsForm,
                                    driverId: value === SELECT_NONE_VALUE ? "" : value,
                                  })
                                }
                                disabled={!isVehicleDetailsEditing}
                              >
                                <SelectTrigger className={lockedInputClass}>
                                  <SelectValue placeholder="Válassz sofőrt" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={SELECT_NONE_VALUE}>Nincs beállítva</SelectItem>
                                  {drivers
                                    .filter((d) => d.is_active)
                                    .map((d) => (
                                      <SelectItem key={d.id} value={String(d.id)}>
                                        {d.name}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <Label>Évjárat</Label>
                              <Input
                                value={vehicleDetailsForm.year}
                                disabled={!isVehicleDetailsEditing}
                                onChange={(e) => setVehicleDetailsForm({ ...vehicleDetailsForm, year: e.target.value })}
                                className={lockedInputClass}
                              />
                            </div>

                            {currentCompanyRole === "admin" ? (
                              <div className="space-y-2">
                                <Label>Státusz</Label>
                                <Select
                                  value={vehicleDetailsForm.status}
                                  onValueChange={(value) => setVehicleDetailsForm({ ...vehicleDetailsForm, status: value })}
                                  disabled={!isVehicleDetailsEditing}
                                >
                                  <SelectTrigger className={lockedInputClass}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="active">Aktív</SelectItem>
                                    <SelectItem value="service">Szerviz alatt</SelectItem>
                                    <SelectItem value="inactive">Inaktív</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : null}

                            <div className="space-y-2">
                              <Label>Üzemanyag</Label>
                              <Select
                                value={vehicleDetailsForm.fuelType}
                                onValueChange={(value) => setVehicleDetailsForm({ ...vehicleDetailsForm, fuelType: value })}
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
                              <Label>Megjegyzés</Label>
                              <Input
                                value={vehicleDetailsForm.note}
                                disabled={!isVehicleDetailsEditing}
                                onChange={(e) => setVehicleDetailsForm({ ...vehicleDetailsForm, note: e.target.value })}
                                className={lockedInputClass}
                              />
                            </div>

                            {vehicleShowAllFields ? (
                              <>
                                <div className="space-y-2 md:col-span-2">
                                  <Label>Alvázszám</Label>
                                  <Input
                                    value={vehicleDetailsForm.vin}
                                    disabled={!isVehicleDetailsEditing}
                                    onChange={(e) =>
                                      setVehicleDetailsForm({ ...vehicleDetailsForm, vin: e.target.value.toUpperCase() })
                                    }
                                    className={lockedInputClass}
                                  />
                                </div>

                                <div className="space-y-2">
                                  <Label>Biztosítás lejárat</Label>
                                  <Input
                                    type="date"
                                    value={vehicleDetailsForm.insuranceExpiry}
                                    disabled={!isVehicleDetailsEditing}
                                    onChange={(e) =>
                                      setVehicleDetailsForm({ ...vehicleDetailsForm, insuranceExpiry: e.target.value })
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
                                      setVehicleDetailsForm({ ...vehicleDetailsForm, inspectionExpiry: e.target.value })
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
                                      setVehicleDetailsForm({ ...vehicleDetailsForm, oilChangeIntervalKm: e.target.value })
                                    }
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
                                      setVehicleDetailsForm({ ...vehicleDetailsForm, timingBeltIntervalKm: e.target.value })
                                    }
                                    className={lockedInputClass}
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </DialogContent>
              </Dialog>
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
            </div>
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
                          className="inline-block bg-gradient-to-r from-cyan-300 via-sky-400 to-cyan-100 bg-clip-text text-transparent"
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
                        onClick={() => {
                          setSelectedId(vehicle.id);
                          setVehicleModalOpen(true);
                          setIsVehicleDetailsEditing(false);
                        }}
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
                      Nincs aktív jármű. Hozz létre egy újat az &quot;Új autó&quot; gombbal.
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
                                <span className="font-semibold text-cyan-100">
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
                          <Select
                            value={serviceHistoryDraft.servicePartnerId}
                            onValueChange={(value) =>
                              setServiceHistoryDraft((prev) => ({
                                ...prev,
                                servicePartnerId: value === SELECT_NONE_VALUE ? "" : value,
                              }))
                            }
                          >
                            <SelectTrigger className="fleet-input rounded-2xl">
                              <SelectValue placeholder="Válassz szervizpartnert" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SELECT_NONE_VALUE}>Nincs kiválasztva</SelectItem>
                              {servicePartners
                                .filter((p) => p.is_active)
                                .map((p) => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
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
                            const isBaseline = entry.type === "baseline";
                            const isKmUpdate =
                              !isBaseline &&
                              (entry.type === "km-update" ||
                                (!entry.isServiceRecord && entry.type !== "baseline"));
                            const isServiceEvent = !isBaseline && !isKmUpdate;
                            return (
                              <div
                                key={entry.id}
                                className={`rounded-3xl border p-5 ${
                                  isBaseline
                                    ? "border-white/[0.08] bg-slate-950/55 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                                    : isKmUpdate
                                    ? "border-sky-400/20 bg-gradient-to-br from-sky-950/35 via-slate-950/40 to-slate-950/60 shadow-[0_0_24px_-12px_rgba(56,189,248,0.35)]"
                                    : "border-cyan-400/15 bg-gradient-to-br from-cyan-950/20 via-slate-950/45 to-slate-950/60 shadow-[0_0_28px_-14px_rgba(34,211,238,0.16)]"
                                }`}
                              >
                                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                  <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`fleet-tone-pill text-[0.65rem] font-semibold uppercase tracking-[0.14em] ${
                                          isBaseline
                                            ? "border-slate-500/30 bg-slate-800/60 text-slate-300"
                                            : isKmUpdate
                                            ? "border-sky-400/35 bg-sky-500/10 text-sky-200"
                                            : entry.serviceType === OIL_SERVICE_LABEL
                                            ? "fleet-tone-pill--warning"
                                            : entry.serviceType === TIMING_SERVICE_LABEL
                                            ? "fleet-tone-pill--danger"
                                            : "fleet-tone-pill--ok"
                                        }`}
                                      >
                                        {isBaseline ? "KIINDULÓ" : isKmUpdate ? "KM FRISSÍTÉS" : "SZERVIZ"}
                                      </span>
                                      <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                                        {formatDateHu(entry.date)}
                                      </span>
                                    </div>

                                    <div className="text-xl font-semibold text-white">{entry.title}</div>

                                    <div className="text-sm text-slate-400">
                                      {isBaseline
                                        ? "Rögzített induló kilométerállás"
                                        : isKmUpdate
                                        ? "Külön rögzített kilométer-frissítés"
                                        : entry.provider
                                        ? `Partner: ${entry.provider}`
                                        : "Partner nincs megadva"}
                                    </div>

                                    {isBaseline && entry.detail ? (
                                      <div className="text-xs leading-relaxed text-slate-500">{entry.detail}</div>
                                    ) : null}

                                    {isKmUpdate && entry.detail ? (
                                      <div className="text-xs leading-relaxed text-slate-500">{entry.detail}</div>
                                    ) : null}

                                    {entry.note ? (
                                      <div className="text-sm text-slate-300">{entry.note}</div>
                                    ) : null}
                                  </div>

                                  <div className="flex flex-col items-start gap-2 md:items-end">
                                    <div
                                      className={`rounded-full px-3 py-1 text-sm font-semibold ${
                                        isBaseline
                                          ? "border border-slate-600/35 bg-slate-800/40 text-slate-200"
                                          : isKmUpdate
                                          ? "border border-sky-400/25 bg-sky-500/10 text-sky-100"
                                          : "border border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
                                      }`}
                                    >
                                      {entry.km !== null && entry.km !== undefined ? `${formatKmHu(entry.km)} km` : "Nincs km adat"}
                                    </div>

                                    {isServiceEvent ? (
                                      <div className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-sm font-semibold text-sky-100">
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
              onClick={() => {
                setSelectedId(vehicle.id);
                setVehicleModalOpen(true);
                setIsVehicleDetailsEditing(false);
              }}
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
              Nincs aktív jármű. Hozz létre egy újat az &quot;Új autó&quot; gombbal.
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
                        <span className="inline-block bg-gradient-to-r from-cyan-300 via-sky-400 to-cyan-100 bg-clip-text text-transparent" style={{ WebkitBackgroundClip: "text" }}>
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
                        <span className="font-semibold text-cyan-200">{formatCurrencyHu(item.total)}</span>
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

        {safePage === "journeys" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <Card className="fleet-card rounded-3xl">
              <CardHeader>
                <CardTitle>Útnyilvántartás</CardTitle>
                <CardDescription>NAV-kompatibilis út napló járművenként</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Hónap (YYYY-MM)</Label>
                    <Input
                      value={journeyMonthFilter}
                      onChange={(e) => setJourneyMonthFilter(e.target.value)}
                      placeholder="pl. 2026-04"
                      className="fleet-input rounded-2xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Jármű</Label>
                    <Select value={journeyVehicleFilter} onValueChange={setJourneyVehicleFilter}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Összes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Összes</SelectItem>
                        {vehicles.map((v) => (
                          <SelectItem key={`journey-veh-${v.id}`} value={String(v.id)}>
                            {v.name || "Jármű"} • {v.plate || "—"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Sofőr</Label>
                    <Select value={journeyDriverFilter} onValueChange={setJourneyDriverFilter}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Összes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Összes</SelectItem>
                        {drivers.map((d) => (
                          <SelectItem key={`journey-driver-${d.id}`} value={String(d.id)}>
                            {d.name || "Sofőr"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-400">
                    Tipp: havi PDF exporthoz válassz járművet + hónapot.
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {!isDriver ? (
                      <Button variant="secondary" className="rounded-2xl" onClick={openAddJourney}>
                        <Plus className="mr-2 h-4 w-4" />
                        Új út
                      </Button>
                    ) : null}
                    <Button className="fleet-primary-btn rounded-2xl" onClick={exportJourneyPdfMonthly}>
                      <Download className="mr-2 h-4 w-4" />
                      PDF export (havi / jármű)
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-white/10">
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-white/5 text-slate-300">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Dátum</th>
                        <th className="px-4 py-3 font-semibold">Jármű</th>
                        <th className="px-4 py-3 font-semibold">Sofőr</th>
                        <th className="px-4 py-3 font-semibold">Honnan → Hová</th>
                        <th className="px-4 py-3 font-semibold">Kezdés / Vége</th>
                        <th className="px-4 py-3 font-semibold">Km (start/end)</th>
                        <th className="px-4 py-3 font-semibold">Táv</th>
                        <th className="px-4 py-3 font-semibold">Típus</th>
                        <th className="px-4 py-3 font-semibold">Rögzítette</th>
                        <th className="px-4 py-3 font-semibold">Művelet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {journeyLogs
                        .filter((row) => {
                          const monthOk =
                            !journeyMonthFilter ||
                            String(row.started_at || "").slice(0, 7) === String(journeyMonthFilter).trim();
                          const vehicleOk =
                            journeyVehicleFilter === "all" ||
                            String(row.vehicle_id) === String(journeyVehicleFilter);
                          const driverOk =
                            journeyDriverFilter === "all" ||
                            String(row.driver_id) === String(journeyDriverFilter);
                          return monthOk && vehicleOk && driverOk;
                        })
                        .slice(0, 400)
                        .map((row) => {
                          const vehicle = vehicles.find((v) => String(v.id) === String(row.vehicle_id)) || null;
                          const driver = drivers.find((d) => String(d.id) === String(row.driver_id)) || null;
                          const dateLabel = String(row.started_at || "").slice(0, 10) || "—";
                          const timeStart = String(row.started_at || "").slice(11, 16) || "—";
                          const timeEnd = row.ended_at ? String(row.ended_at).slice(11, 16) : "—";
                          const startKm = row.start_km ?? "—";
                          const endKm = row.end_km ?? "—";
                          const distance =
                            row.end_km != null && row.start_km != null ? Number(row.end_km) - Number(row.start_km) : null;
                          const createdBy = String(row.created_by_auth_user_id || "").trim();
                          const createdByDriver =
                            createdBy
                              ? drivers.find((d) => String(d.auth_user_id || "") === createdBy) || null
                              : null;
                          const createdLabel = createdBy
                            ? createdBy === String(session?.user?.id || "")
                              ? "Admin"
                              : createdByDriver?.name || "Ismeretlen"
                            : "—";

                          return (
                            <tr key={`journey-${row.id}`} className="bg-slate-950/20">
                              <td className="px-4 py-3 text-slate-200">{dateLabel}</td>
                              <td className="px-4 py-3 text-slate-200">
                                {vehicle?.name || "—"}
                                <div className="text-xs text-slate-400">{vehicle?.plate || "—"}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-200">{driver?.name || "—"}</td>
                              <td className="px-4 py-3 text-slate-200">
                                <div className="text-slate-200">{row.start_location || "—"}</div>
                                <div className="text-slate-400">{row.end_location || "—"}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-200">
                                {timeStart} / {timeEnd}
                              </td>
                              <td className="px-4 py-3 text-slate-200">
                                {startKm} / {endKm}
                              </td>
                              <td className="px-4 py-3 font-semibold text-cyan-200">
                                {distance == null ? "—" : `${distance} km`}
                              </td>
                              <td className="px-4 py-3 text-slate-200">
                                {row.trip_type === "private" ? "Privát" : "Üzleti"}
                              </td>
                              <td className="px-4 py-3 text-slate-200">
                                {createdLabel}
                                {createdBy && createdBy !== String(session?.user?.id || "") ? (
                                  <div className="text-xs text-slate-400">Sofőr</div>
                                ) : createdBy ? (
                                  <div className="text-xs text-slate-400">Admin</div>
                                ) : null}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                  <Button
                                    variant="secondary"
                                    size="icon"
                                    className="rounded-2xl"
                                    onClick={() => openEditJourney(row)}
                                    aria-label="Szerkesztés"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {!isDriver ? (
                                    <Button
                                      variant="destructive"
                                      size="icon"
                                      className="rounded-2xl"
                                      onClick={() => openAdminDeleteJourney(row)}
                                      aria-label="Törlés"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                      {journeyLogs.length === 0 && (
                        <tr>
                          <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                            Még nincs rögzített út napló bejegyzés.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {journeyLoading ? (
                  <div className="text-sm text-slate-400">Betöltés...</div>
                ) : null}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {safePage === "expenses" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <Card className="fleet-card rounded-3xl">
              <CardHeader>
                <CardTitle>Költségnapló</CardTitle>
                <CardDescription>Tankolás és egyéb költségek havi bontásban</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Hónap (YYYY-MM)</Label>
                    <Input
                      value={expenseMonthFilter}
                      onChange={(e) => setExpenseMonthFilter(e.target.value)}
                      className="fleet-input rounded-2xl"
                      placeholder="pl. 2026-04"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Jármű</Label>
                    <Select value={expenseVehicleFilter} onValueChange={setExpenseVehicleFilter}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Összes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Összes</SelectItem>
                        {vehicles.map((v) => (
                          <SelectItem key={`exp-veh-${v.id}`} value={String(v.id)}>
                            {v.name || "Jármű"} • {v.plate || "—"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Sofőr</Label>
                    <Select value={expenseDriverFilter} onValueChange={setExpenseDriverFilter}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Összes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Összes</SelectItem>
                        {drivers.map((d) => (
                          <SelectItem key={`exp-driver-${d.id}`} value={String(d.id)}>
                            {d.name || "Sofőr"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Típus</Label>
                    <Select value={expenseTypeFilter} onValueChange={setExpenseTypeFilter}>
                      <SelectTrigger className="fleet-input rounded-2xl">
                        <SelectValue placeholder="Összes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Összes</SelectItem>
                        <SelectItem value="fuel">Tankolás</SelectItem>
                        <SelectItem value="toll">Útdíj</SelectItem>
                        <SelectItem value="parking">Parkolás</SelectItem>
                        <SelectItem value="service">Szerviz</SelectItem>
                        <SelectItem value="fluid">Folyadék</SelectItem>
                        <SelectItem value="other">Egyéb</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-slate-400">
                    Összes tétel:{" "}
                    <span className="font-semibold text-slate-200">
                      {
                        (expenseEntries || []).filter((row) => {
                          const monthOk =
                            !expenseMonthFilter ||
                            String(row.occurred_at || "").slice(0, 7) === String(expenseMonthFilter).trim();
                          const vehicleOk =
                            expenseVehicleFilter === "all" ||
                            String(row.vehicle_id) === String(expenseVehicleFilter);
                          const driverOk =
                            expenseDriverFilter === "all" ||
                            String(row.driver_id) === String(expenseDriverFilter);
                          const typeOk =
                            expenseTypeFilter === "all" || String(row.expense_type) === String(expenseTypeFilter);
                          return monthOk && vehicleOk && driverOk && typeOk;
                        }).length
                      }
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {!isDriver ? (
                      <Button variant="secondary" className="rounded-2xl" onClick={openAddExpense}>
                        <Plus className="mr-2 h-4 w-4" />
                        Új költség
                      </Button>
                    ) : null}
                    <Button className="fleet-primary-btn rounded-2xl" onClick={exportExpensesCsv}>
                      <Download className="mr-2 h-4 w-4" />
                      CSV export
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-3xl border border-white/10">
                  <table className="w-full min-w-[1100px] text-left text-sm">
                    <thead className="bg-white/5 text-slate-300">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Dátum</th>
                        <th className="px-4 py-3 font-semibold">Jármű</th>
                        <th className="px-4 py-3 font-semibold">Sofőr</th>
                        <th className="px-4 py-3 font-semibold">Típus</th>
                        <th className="px-4 py-3 font-semibold">Kút</th>
                        <th className="px-4 py-3 font-semibold">Liter</th>
                        <th className="px-4 py-3 font-semibold">Bruttó</th>
                        <th className="px-4 py-3 font-semibold">ÁFA</th>
                        <th className="px-4 py-3 font-semibold">Bizonylat</th>
                        <th className="px-4 py-3 font-semibold">Státusz</th>
                        <th className="px-4 py-3 font-semibold">Rögzítette</th>
                        <th className="px-4 py-3 font-semibold">Művelet</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {(expenseEntries || [])
                        .filter((row) => {
                          const monthOk =
                            !expenseMonthFilter ||
                            String(row.occurred_at || "").slice(0, 7) === String(expenseMonthFilter).trim();
                          const vehicleOk =
                            expenseVehicleFilter === "all" ||
                            String(row.vehicle_id) === String(expenseVehicleFilter);
                          const driverOk =
                            expenseDriverFilter === "all" ||
                            String(row.driver_id) === String(expenseDriverFilter);
                          const typeOk =
                            expenseTypeFilter === "all" || String(row.expense_type) === String(expenseTypeFilter);
                          return monthOk && vehicleOk && driverOk && typeOk;
                        })
                        .slice(0, 500)
                        .map((row) => {
                          const vehicle = vehicles.find((v) => String(v.id) === String(row.vehicle_id)) || null;
                          const driver = drivers.find((d) => String(d.id) === String(row.driver_id)) || null;
                          const createdBy = String(row.created_by_auth_user_id || "").trim();
                          const createdByDriver =
                            createdBy
                              ? drivers.find((d) => String(d.auth_user_id || "") === createdBy) || null
                              : null;
                          const createdLabel = createdBy
                            ? createdBy === String(session?.user?.id || "")
                              ? "Admin"
                              : createdByDriver?.name || "Ismeretlen"
                            : "—";
                          return (
                            <tr key={`admin-exp-${row.id}`} className="bg-slate-950/20">
                              <td className="px-4 py-3 text-slate-200">
                                {String(row.occurred_at || "").slice(0, 10) || "—"}
                              </td>
                              <td className="px-4 py-3 text-slate-200">
                                {vehicle?.plate || "—"}
                                <div className="text-xs text-slate-400">{vehicle?.name || ""}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-200">{driver?.name || "—"}</td>
                              <td className="px-4 py-3 text-slate-200">{row.expense_type || "—"}</td>
                              <td className="px-4 py-3 text-slate-200">{row.station_name || "—"}</td>
                              <td className="px-4 py-3 text-slate-200">
                                {row.liters != null ? `${Number(row.liters).toLocaleString("hu-HU")} l` : "—"}
                              </td>
                              <td className="px-4 py-3 font-semibold text-cyan-200">
                                {Number(row.gross_amount || 0).toLocaleString("hu-HU")} {row.currency || "HUF"}
                              </td>
                              <td className="px-4 py-3 text-slate-200">
                                {row.vat_amount != null ? Number(row.vat_amount).toLocaleString("hu-HU") : "—"}
                              </td>
                              <td className="px-4 py-3">
                                {row.receipt_storage_path ? (
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="secondary"
                                      className="rounded-2xl"
                                      onClick={() => openExpenseReceipt(row, "open")}
                                    >
                                      Megnyitás
                                    </Button>
                                    <Button
                                      className="fleet-primary-btn rounded-2xl"
                                      onClick={() => openExpenseReceipt(row, "download")}
                                    >
                                      Letöltés
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-200">{row.status || "—"}</td>
                              <td className="px-4 py-3 text-slate-200">
                                {createdLabel}
                                {createdBy && createdBy !== String(session?.user?.id || "") ? (
                                  <div className="text-xs text-slate-400">Sofőr</div>
                                ) : createdBy ? (
                                  <div className="text-xs text-slate-400">Admin</div>
                                ) : null}
                              </td>
                              <td className="px-4 py-3">
                                {!isDriver ? (
                                  <div className="flex flex-col gap-2 sm:flex-row">
                                    <Button
                                      variant="secondary"
                                      size="icon"
                                      className="rounded-2xl"
                                      onClick={() => openEditExpense(row)}
                                      aria-label="Szerkesztés"
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="icon"
                                      className="rounded-2xl"
                                      onClick={() => openAdminDeleteExpense(row)}
                                      aria-label="Törlés"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                      {(expenseEntries || []).length === 0 && (
                        <tr>
                          <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                            Még nincs rögzített költség.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {expenseLoading ? <div className="text-sm text-slate-400">Betöltés...</div> : null}
              </CardContent>
            </Card>
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
                      onClick={() => {
                        setSelectedId(vehicle.id);
                        setVehicleModalOpen(true);
                        setIsVehicleDetailsEditing(false);
                      }}
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
                      Nincs aktív jármű. Hozz létre egy újat az &quot;Új autó&quot; gombbal.
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

        {safePage === "drivers" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-slate-950/40 px-3 py-1 text-sm text-slate-200 shadow-[0_0_22px_rgba(34,211,238,0.08)] backdrop-blur">
                  <UserPlus className="h-4 w-4" />
                  Kapcsolatok
                </div>
                <h2 className="text-3xl font-bold text-white">Sofőrök</h2>
                <p className="mt-2 text-sm text-slate-400">Sofőr master-data a jármű hozzárendelésekhez.</p>
              </div>

              <Button className="fleet-primary-btn rounded-2xl shadow-[0_0_26px_rgba(34,211,238,0.14)] hover:scale-[1.01] active:scale-[0.99] transition" onClick={openCreateDriver}>
                <Plus className="mr-2 h-4 w-4" />
                Új sofőr
              </Button>
            </div>

            <Card className="fleet-card rounded-3xl">
              <CardHeader>
                <CardTitle>Sofőrök</CardTitle>
                <CardDescription>Keresés, státusz és gyors műveletek</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                      placeholder="Sofőr keresése..."
                      className="fleet-input h-11 rounded-2xl pl-10"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Select value={driverStatusFilter} onValueChange={setDriverStatusFilter}>
                      <SelectTrigger className="fleet-input h-11 rounded-2xl sm:w-[180px]">
                        <SelectValue placeholder="Státusz" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Minden státusz</SelectItem>
                        <SelectItem value="active">Aktív</SelectItem>
                        <SelectItem value="inactive">Inaktív</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {drivers.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                    Még nincs rögzített sofőr.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {drivers
                      .filter((d) => {
                        const term = String(driverSearch || "").trim().toLowerCase();
                        const matchesTerm =
                          !term ||
                          String(d?.name || "").toLowerCase().includes(term) ||
                          String(d?.email || "").toLowerCase().includes(term) ||
                          String(d?.phone || "").toLowerCase().includes(term);

                        const statusOk =
                          driverStatusFilter === "all" ||
                          (driverStatusFilter === "active" ? d?.is_active !== false : d?.is_active === false);

                        return matchesTerm && statusOk;
                      })
                      .map((d) => {
                        const assignedCount = vehicles.filter((v) => String(v?.driver_id || "") === String(d?.id || "")).length;
                        return (
                          <div
                            key={d.id}
                            className="group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-950/35 via-slate-950/25 to-slate-950/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition duration-200 hover:-translate-y-[1px] hover:border-cyan-400/20 hover:shadow-[0_18px_70px_rgba(2,6,23,0.55),0_0_34px_rgba(34,211,238,0.08)]"
                          >
                            <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent opacity-70" />
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-white">
                                  {initialsFromName(d?.name)}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="truncate font-semibold text-white">{d.name}</div>
                                    <span
                                      className={`rounded-full border px-2.5 py-0.5 text-xs ${
                                        d.is_active
                                          ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.10)]"
                                          : "border-white/10 bg-white/5 text-slate-300"
                                      }`}
                                    >
                                      {d.is_active ? "Aktív" : "Inaktív"}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-sm text-slate-400">
                                    {[d.phone, d.email].filter(Boolean).join(" • ") || "Nincs elérhetőség"}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3">
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                                <div className="text-xs text-slate-400">Hozzárendelt</div>
                                <div className="mt-0.5 text-lg font-semibold text-white">{assignedCount}</div>
                                <div className="text-xs text-slate-500">jármű</div>
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                                <div className="text-xs text-slate-400">Megjegyzés</div>
                                <div className="mt-0.5 line-clamp-2 text-sm text-slate-200">{d.notes || "—"}</div>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <Button
                                variant="secondary"
                                className="rounded-2xl border border-white/10 bg-white/5 text-slate-200 hover:border-cyan-400/20 hover:bg-cyan-400/10 hover:text-white transition"
                                onClick={() => openEditDriver(d)}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Szerkesztés
                              </Button>
                              <Button
                                variant="secondary"
                                className="rounded-2xl border border-white/10 bg-white/5 text-slate-200 hover:border-red-400/25 hover:bg-red-500/10 hover:text-white transition"
                                onClick={() => setDriverToDelete(d)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Törlés
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog
              open={driverDialogOpen}
              onOpenChange={(next) => {
                setDriverDialogOpen(next);
                if (!next) resetDriverForm();
              }}
            >
              <DialogContent className="fleet-dialog sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>{driverEditing ? "Sofőr szerkesztése" : "Új sofőr"}</DialogTitle>
                  <DialogDescription>Alap adatok és státusz.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Név</Label>
                    <Input
                      value={driverForm.name}
                      onChange={(e) => setDriverForm((p) => ({ ...p, name: e.target.value }))}
                      className="fleet-input rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefon</Label>
                    <Input
                      value={driverForm.phone}
                      onChange={(e) => setDriverForm((p) => ({ ...p, phone: e.target.value }))}
                      className="fleet-input rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      value={driverForm.email}
                      onChange={(e) => setDriverForm((p) => ({ ...p, email: e.target.value }))}
                      className="fleet-input rounded-2xl"
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Megjegyzés</Label>
                    <Input
                      value={driverForm.notes}
                      onChange={(e) => setDriverForm((p) => ({ ...p, notes: e.target.value }))}
                      className="fleet-input rounded-2xl"
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 md:col-span-2">
                    <div>
                      <div className="font-medium text-white">Aktív státusz</div>
                      <div className="text-sm text-slate-400">Inaktív sofőr nem ajánlott hozzárendeléshez.</div>
                    </div>
                    <Button
                      variant={driverForm.is_active ? "default" : "secondary"}
                      className="rounded-2xl"
                      onClick={() => setDriverForm((p) => ({ ...p, is_active: !p.is_active }))}
                    >
                      {driverForm.is_active ? "Aktív" : "Inaktív"}
                    </Button>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="secondary" className="rounded-2xl" onClick={() => setDriverDialogOpen(false)}>
                    Mégse
                  </Button>
                  <Button className="fleet-primary-btn rounded-2xl" onClick={saveDriver}>
                    <Save className="mr-2 h-4 w-4" />
                    Mentés
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(driverToDelete)} onOpenChange={(next) => !next && setDriverToDelete(null)}>
              <DialogContent className="fleet-dialog sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Sofőr törlése</DialogTitle>
                  <DialogDescription>
                    Biztosan törlöd a(z){" "}
                    <span className="font-semibold text-white">{driverToDelete?.name}</span> sofőrt?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="secondary" className="rounded-2xl" onClick={() => setDriverToDelete(null)}>
                    Mégse
                  </Button>
                  <Button className="rounded-2xl" variant="destructive" onClick={deleteDriver}>
                    Törlés
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </motion.div>
        )}

        {safePage === "partners" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-slate-950/40 px-3 py-1 text-sm text-slate-200 shadow-[0_0_22px_rgba(34,211,238,0.08)] backdrop-blur">
                  <Wrench className="h-4 w-4" />
                  Kapcsolatok
                </div>
                <h2 className="text-3xl font-bold text-white">Szervizpartnerek</h2>
                <p className="mt-2 text-sm text-slate-400">Master-data lista szervizekhez és partnerekhez.</p>
              </div>

              <Button className="fleet-primary-btn rounded-2xl shadow-[0_0_26px_rgba(34,211,238,0.14)] hover:scale-[1.01] active:scale-[0.99] transition" onClick={openCreatePartner}>
                <Plus className="mr-2 h-4 w-4" />
                Új szervizpartner
              </Button>
            </div>

            <Card className="fleet-card rounded-3xl">
              <CardHeader>
                <CardTitle>Szervizpartnerek</CardTitle>
                <CardDescription>Keresés, státusz és gyors műveletek</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={partnerSearch}
                      onChange={(e) => setPartnerSearch(e.target.value)}
                      placeholder="Szervizpartner keresése..."
                      className="fleet-input h-11 rounded-2xl pl-10"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Select value={partnerStatusFilter} onValueChange={setPartnerStatusFilter}>
                      <SelectTrigger className="fleet-input h-11 rounded-2xl sm:w-[180px]">
                        <SelectValue placeholder="Státusz" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Minden státusz</SelectItem>
                        <SelectItem value="active">Aktív</SelectItem>
                        <SelectItem value="inactive">Inaktív</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {servicePartners.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-400">
                    Még nincs rögzített szervizpartner.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {servicePartners
                      .filter((p) => {
                        const term = String(partnerSearch || "").trim().toLowerCase();
                        const matchesTerm =
                          !term ||
                          String(p?.name || "").toLowerCase().includes(term) ||
                          String(p?.contact_person || "").toLowerCase().includes(term) ||
                          String(p?.email || "").toLowerCase().includes(term) ||
                          String(p?.phone || "").toLowerCase().includes(term) ||
                          String(p?.address || "").toLowerCase().includes(term);

                        const statusOk =
                          partnerStatusFilter === "all" ||
                          (partnerStatusFilter === "active" ? p?.is_active !== false : p?.is_active === false);

                        return matchesTerm && statusOk;
                      })
                      .map((p) => (
                        <div
                          key={p.id}
                          className="group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-950/35 via-slate-950/25 to-slate-950/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition duration-200 hover:-translate-y-[1px] hover:border-cyan-400/20 hover:shadow-[0_18px_70px_rgba(2,6,23,0.55),0_0_34px_rgba(34,211,238,0.08)]"
                        >
                          <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent opacity-70" />
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-white">
                                {initialsFromName(p?.name)}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="truncate font-semibold text-white">{p.name}</div>
                                  <span
                                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                                      p.is_active
                                        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.10)]"
                                        : "border-white/10 bg-white/5 text-slate-300"
                                    }`}
                                  >
                                    {p.is_active ? "Aktív" : "Inaktív"}
                                  </span>
                                </div>
                                <div className="mt-1 truncate text-sm text-slate-400">
                                  {[p.contact_person, p.phone, p.email].filter(Boolean).join(" • ") || "Nincs elérhetőség"}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            {p.address ? <div className="text-sm text-slate-300">{p.address}</div> : null}
                            {p.notes ? <div className="line-clamp-2 text-sm text-slate-300">{p.notes}</div> : null}
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button
                              variant="secondary"
                              className="rounded-2xl border border-white/10 bg-white/5 text-slate-200 hover:border-cyan-400/20 hover:bg-cyan-400/10 hover:text-white transition"
                              onClick={() => openEditPartner(p)}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Szerkesztés
                            </Button>
                            <Button
                              variant="secondary"
                              className="rounded-2xl border border-white/10 bg-white/5 text-slate-200 hover:border-red-400/25 hover:bg-red-500/10 hover:text-white transition"
                              onClick={() => setPartnerToDelete(p)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Törlés
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog
              open={partnerDialogOpen}
              onOpenChange={(next) => {
                setPartnerDialogOpen(next);
                if (!next) resetPartnerForm();
              }}
            >
              <DialogContent className="fleet-dialog sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>{partnerEditing ? "Szervizpartner szerkesztése" : "Új szervizpartner"}</DialogTitle>
                  <DialogDescription>Partner adatok és státusz.</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Név</Label>
                    <Input value={partnerForm.name} onChange={(e) => setPartnerForm((p) => ({ ...p, name: e.target.value }))} className="fleet-input rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kapcsolattartó</Label>
                    <Input value={partnerForm.contact_person} onChange={(e) => setPartnerForm((p) => ({ ...p, contact_person: e.target.value }))} className="fleet-input rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefon</Label>
                    <Input value={partnerForm.phone} onChange={(e) => setPartnerForm((p) => ({ ...p, phone: e.target.value }))} className="fleet-input rounded-2xl" />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={partnerForm.email} onChange={(e) => setPartnerForm((p) => ({ ...p, email: e.target.value }))} className="fleet-input rounded-2xl" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Cím</Label>
                    <Input value={partnerForm.address} onChange={(e) => setPartnerForm((p) => ({ ...p, address: e.target.value }))} className="fleet-input rounded-2xl" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Megjegyzés</Label>
                    <Input value={partnerForm.notes} onChange={(e) => setPartnerForm((p) => ({ ...p, notes: e.target.value }))} className="fleet-input rounded-2xl" />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 md:col-span-2">
                    <div>
                      <div className="font-medium text-white">Aktív státusz</div>
                      <div className="text-sm text-slate-400">Inaktív partner nem ajánlott kiválasztáshoz.</div>
                    </div>
                    <Button
                      variant={partnerForm.is_active ? "default" : "secondary"}
                      className="rounded-2xl"
                      onClick={() => setPartnerForm((p) => ({ ...p, is_active: !p.is_active }))}
                    >
                      {partnerForm.is_active ? "Aktív" : "Inaktív"}
                    </Button>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="secondary" className="rounded-2xl" onClick={() => setPartnerDialogOpen(false)}>
                    Mégse
                  </Button>
                  <Button className="fleet-primary-btn rounded-2xl" onClick={savePartner}>
                    <Save className="mr-2 h-4 w-4" />
                    Mentés
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={Boolean(partnerToDelete)} onOpenChange={(next) => !next && setPartnerToDelete(null)}>
              <DialogContent className="fleet-dialog sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Szervizpartner törlése</DialogTitle>
                  <DialogDescription>
                    Biztosan törlöd a(z){" "}
                    <span className="font-semibold text-white">{partnerToDelete?.name}</span> partnert?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="secondary" className="rounded-2xl" onClick={() => setPartnerToDelete(null)}>
                    Mégse
                  </Button>
                  <Button className="rounded-2xl" variant="destructive" onClick={deletePartner}>
                    Törlés
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </motion.div>
        )}
      </div>

      <Dialog
        open={Boolean(adminDeleteDialog)}
        onOpenChange={(next) => {
          if (!next && !adminDeleteSaving) setAdminDeleteDialog(null);
        }}
      >
        <DialogContent className="fleet-dialog sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {adminDeleteDialog?.kind === "journey" ? "Út bejegyzés törlése" : "Költség törlése"}
            </DialogTitle>
            <DialogDescription>
              Biztosan véglegesen törlöd ezt a bejegyzést? A művelet nem vonható vissza.
              {adminDeleteDialog?.summary ? (
                <>
                  <br />
                  <span className="mt-2 block font-medium text-white">{adminDeleteDialog.summary}</span>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="secondary"
              className="rounded-2xl"
              disabled={adminDeleteSaving}
              onClick={() => setAdminDeleteDialog(null)}
            >
              Mégse
            </Button>
            <Button className="rounded-2xl" variant="destructive" disabled={adminDeleteSaving} onClick={confirmAdminDelete}>
              {adminDeleteSaving ? "Törlés…" : "Törlés"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={journeyEditOpen} onOpenChange={setJourneyEditOpen}>
        <DialogContent className="fleet-dialog sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Út bejegyzés szerkesztése</DialogTitle>
            <DialogDescription>
              Admin jogosultsággal javíthatod a NAV útnyilvántartás sorokat.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Indulás ideje</Label>
              <Input
                type="datetime-local"
                value={journeyEditForm.startedAt}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, startedAt: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Befejezés ideje (opcionális)</Label>
              <Input
                type="datetime-local"
                value={journeyEditForm.endedAt}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, endedAt: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Induló km</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={journeyEditForm.startKm}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, startKm: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Érkező km</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={journeyEditForm.endKm}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, endKm: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Honnan</Label>
              <Input
                value={journeyEditForm.startLocation}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, startLocation: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Hová</Label>
              <Input
                value={journeyEditForm.endLocation}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, endLocation: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Típus</Label>
              <Select
                value={journeyEditForm.tripType}
                onValueChange={(value) => setJourneyEditForm((p) => ({ ...p, tripType: value }))}
              >
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Üzleti</SelectItem>
                  <SelectItem value="private">Privát</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Megjegyzés</Label>
              <Input
                value={journeyEditForm.note}
                onChange={(e) => setJourneyEditForm((p) => ({ ...p, note: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              className="rounded-2xl"
              onClick={() => setJourneyEditOpen(false)}
              disabled={journeyLoading}
            >
              Mégse
            </Button>
            <Button
              className="fleet-primary-btn rounded-2xl"
              onClick={saveEditedJourney}
              disabled={journeyLoading}
            >
              <Save className="mr-2 h-4 w-4" />
              Mentés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseEditOpen} onOpenChange={setExpenseEditOpen}>
        <DialogContent className="fleet-dialog sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Költség bejegyzés szerkesztése</DialogTitle>
            <DialogDescription>
              Admin jogosultsággal javíthatod a költség napló sorokat.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Dátum</Label>
              <Input
                type="date"
                value={expenseEditForm.occurredAt}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, occurredAt: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Típus</Label>
              <Select
                value={expenseEditForm.expenseType || "fuel"}
                onValueChange={(value) => setExpenseEditForm((p) => ({ ...p, expenseType: value }))}
              >
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fuel">Tankolás</SelectItem>
                  <SelectItem value="toll">Útdíj</SelectItem>
                  <SelectItem value="parking">Parkolás</SelectItem>
                  <SelectItem value="service">Szerviz</SelectItem>
                  <SelectItem value="fluid">Folyadék</SelectItem>
                  <SelectItem value="other">Egyéb</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Kút</Label>
              <Input
                value={expenseEditForm.stationName}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, stationName: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Helyszín</Label>
              <Input
                value={expenseEditForm.stationLocation}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, stationLocation: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Km óraállás</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={expenseEditForm.odometerKm}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, odometerKm: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Státusz</Label>
              <Input
                value={expenseEditForm.status}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, status: e.target.value }))}
                className="fleet-input rounded-2xl"
                placeholder="posted / draft_ai / ..."
              />
            </div>

            {String(expenseEditForm.expenseType || "fuel") === "fuel" ? (
              <>
                <div className="space-y-2">
                  <Label>Üzemanyag</Label>
                  <Input
                    value={expenseEditForm.fuelType}
                    onChange={(e) => setExpenseEditForm((p) => ({ ...p, fuelType: e.target.value }))}
                    className="fleet-input rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Liter</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={expenseEditForm.liters}
                    onChange={(e) => setExpenseEditForm((p) => ({ ...p, liters: e.target.value }))}
                    className="fleet-input rounded-2xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Egységár</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={expenseEditForm.unitPrice}
                    onChange={(e) => setExpenseEditForm((p) => ({ ...p, unitPrice: e.target.value }))}
                    className="fleet-input rounded-2xl"
                  />
                </div>
              </>
            ) : null}

            <div className="space-y-2">
              <Label>Bruttó</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={expenseEditForm.grossAmount}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, grossAmount: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Pénznem</Label>
              <Input
                value={expenseEditForm.currency}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, currency: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Nettó (opcionális)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={expenseEditForm.netAmount}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, netAmount: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>ÁFA összeg (opcionális)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={expenseEditForm.vatAmount}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, vatAmount: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>ÁFA % (opcionális)</Label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={expenseEditForm.vatRate}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, vatRate: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Számlaszám (opcionális)</Label>
              <Input
                value={expenseEditForm.invoiceNumber}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, invoiceNumber: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Fizetés módja</Label>
              <Input
                value={expenseEditForm.paymentMethod}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, paymentMethod: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Kártya utolsó 4 (opcionális)</Label>
              <Input
                value={expenseEditForm.paymentCardLast4}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, paymentCardLast4: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Megjegyzés</Label>
              <Input
                value={expenseEditForm.note}
                onChange={(e) => setExpenseEditForm((p) => ({ ...p, note: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              className="rounded-2xl"
              onClick={() => setExpenseEditOpen(false)}
              disabled={expenseLoading}
            >
              Mégse
            </Button>
            <Button
              className="fleet-primary-btn rounded-2xl"
              onClick={saveEditedExpense}
              disabled={expenseLoading}
            >
              <Save className="mr-2 h-4 w-4" />
              Mentés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={journeyAddOpen} onOpenChange={setJourneyAddOpen}>
        <DialogContent className="fleet-dialog sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Út hozzáadása</DialogTitle>
            <DialogDescription>Admin rögzítés az útnyilvántartáshoz.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Jármű</Label>
              <Select value={journeyAddForm.vehicleId} onValueChange={(v) => setJourneyAddForm((p) => ({ ...p, vehicleId: v }))}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue placeholder="Válassz" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Válassz…</SelectItem>
                  {vehicles.map((veh) => (
                    <SelectItem key={`add-journey-veh-${veh.id}`} value={String(veh.id)}>
                      {veh.name || "Jármű"} • {veh.plate || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Sofőr</Label>
              <Select value={journeyAddForm.driverId} onValueChange={(v) => setJourneyAddForm((p) => ({ ...p, driverId: v }))}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue placeholder="Válassz" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Válassz…</SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={`add-journey-driver-${d.id}`} value={String(d.id)}>
                      {d.name || "Sofőr"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Indulás ideje</Label>
              <Input
                type="datetime-local"
                value={journeyAddForm.startedAt}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, startedAt: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>
            <div className="space-y-2">
              <Label>Befejezés ideje (opcionális)</Label>
              <Input
                type="datetime-local"
                value={journeyAddForm.endedAt}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, endedAt: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Induló km</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={journeyAddForm.startKm}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, startKm: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>
            <div className="space-y-2">
              <Label>Érkező km</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                value={journeyAddForm.endKm}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, endKm: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Honnan</Label>
              <Input
                value={journeyAddForm.startLocation}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, startLocation: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Hová</Label>
              <Input
                value={journeyAddForm.endLocation}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, endLocation: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Típus</Label>
              <Select value={journeyAddForm.tripType} onValueChange={(v) => setJourneyAddForm((p) => ({ ...p, tripType: v }))}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Üzleti</SelectItem>
                  <SelectItem value="private">Privát</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Megjegyzés</Label>
              <Input
                value={journeyAddForm.note}
                onChange={(e) => setJourneyAddForm((p) => ({ ...p, note: e.target.value }))}
                className="fleet-input rounded-2xl"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" className="rounded-2xl" onClick={() => setJourneyAddOpen(false)} disabled={journeyLoading}>
              Mégse
            </Button>
            <Button className="fleet-primary-btn rounded-2xl" onClick={saveAddedJourney} disabled={journeyLoading}>
              <Save className="mr-2 h-4 w-4" />
              Mentés
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={expenseAddOpen} onOpenChange={setExpenseAddOpen}>
        <DialogContent className="fleet-dialog sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Költség hozzáadása</DialogTitle>
            <DialogDescription>Manuális rögzítés vagy bizonylat → AI draft.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Mód</Label>
              <Select value={expenseAddMode} onValueChange={(v) => setExpenseAddMode(v === "ai" ? "ai" : "manual")}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manuális</SelectItem>
                  <SelectItem value="ai">AI (bizonylat)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div />

            <div className="space-y-2">
              <Label>Jármű</Label>
              <Select value={expenseAddForm.vehicleId} onValueChange={(v) => setExpenseAddForm((p) => ({ ...p, vehicleId: v }))}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue placeholder="Válassz" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Válassz…</SelectItem>
                  {vehicles.map((veh) => (
                    <SelectItem key={`add-exp-veh-${veh.id}`} value={String(veh.id)}>
                      {veh.name || "Jármű"} • {veh.plate || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Sofőr</Label>
              <Select value={expenseAddForm.driverId} onValueChange={(v) => setExpenseAddForm((p) => ({ ...p, driverId: v }))}>
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue placeholder="Válassz" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Válassz…</SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={`add-exp-driver-${d.id}`} value={String(d.id)}>
                      {d.name || "Sofőr"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {expenseAddMode === "ai" ? (
              <>
                <div className="space-y-2">
                  <Label>AI szolgáltató</Label>
                  <Select value={expenseAddAiProvider} onValueChange={(v) => setExpenseAddAiProvider(v)}>
                    <SelectTrigger className="fleet-input rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Automatikus</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Bizonylat</Label>
                  <Input
                    type="file"
                    accept="image/*,application/pdf"
                    className="fleet-input rounded-2xl"
                    disabled={expenseAddSaving}
                    onChange={(e) => setExpenseAddFile(e.target.files?.[0] || null)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Dátum</Label>
                  <Input
                    type="date"
                    value={expenseAddForm.occurredAt}
                    onChange={(e) => setExpenseAddForm((p) => ({ ...p, occurredAt: e.target.value }))}
                    className="fleet-input rounded-2xl"
                    disabled={expenseAddSaving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Típus</Label>
                  <Select value={expenseAddForm.expenseType} onValueChange={(v) => setExpenseAddForm((p) => ({ ...p, expenseType: v }))}>
                    <SelectTrigger className="fleet-input rounded-2xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fuel">Tankolás</SelectItem>
                      <SelectItem value="toll">Útdíj</SelectItem>
                      <SelectItem value="parking">Parkolás</SelectItem>
                      <SelectItem value="service">Szerviz</SelectItem>
                      <SelectItem value="fluid">Folyadék</SelectItem>
                      <SelectItem value="other">Egyéb</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Kút</Label>
                  <Input value={expenseAddForm.stationName} onChange={(e) => setExpenseAddForm((p) => ({ ...p, stationName: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>
                <div className="space-y-2">
                  <Label>Helyszín</Label>
                  <Input value={expenseAddForm.stationLocation} onChange={(e) => setExpenseAddForm((p) => ({ ...p, stationLocation: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>

                <div className="space-y-2">
                  <Label>Km</Label>
                  <Input type="number" inputMode="numeric" min={0} value={expenseAddForm.odometerKm} onChange={(e) => setExpenseAddForm((p) => ({ ...p, odometerKm: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>
                <div className="space-y-2">
                  <Label>Pénznem</Label>
                  <Input value={expenseAddForm.currency} onChange={(e) => setExpenseAddForm((p) => ({ ...p, currency: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>

                {String(expenseAddForm.expenseType || "fuel") === "fuel" ? (
                  <>
                    <div className="space-y-2">
                      <Label>Üzemanyag</Label>
                      <Input value={expenseAddForm.fuelType} onChange={(e) => setExpenseAddForm((p) => ({ ...p, fuelType: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                    </div>
                    <div className="space-y-2">
                      <Label>Liter</Label>
                      <Input type="number" inputMode="decimal" min={0} value={expenseAddForm.liters} onChange={(e) => setExpenseAddForm((p) => ({ ...p, liters: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                    </div>
                    <div className="space-y-2">
                      <Label>Egységár</Label>
                      <Input type="number" inputMode="decimal" min={0} value={expenseAddForm.unitPrice} onChange={(e) => setExpenseAddForm((p) => ({ ...p, unitPrice: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                    </div>
                  </>
                ) : null}

                <div className="space-y-2">
                  <Label>Bruttó</Label>
                  <Input type="number" inputMode="decimal" min={0} value={expenseAddForm.grossAmount} onChange={(e) => setExpenseAddForm((p) => ({ ...p, grossAmount: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>
                <div className="space-y-2">
                  <Label>Nettó (opcionális)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={expenseAddForm.netAmount}
                    onChange={(e) => setExpenseAddForm((p) => ({ ...p, netAmount: e.target.value }))}
                    className="fleet-input rounded-2xl"
                    disabled={expenseAddSaving}
                  />
                </div>

                <div className="space-y-2">
                  <Label>ÁFA összeg (opcionális)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={expenseAddForm.vatAmount}
                    onChange={(e) => setExpenseAddForm((p) => ({ ...p, vatAmount: e.target.value }))}
                    className="fleet-input rounded-2xl"
                    disabled={expenseAddSaving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>ÁFA % (opcionális)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={expenseAddForm.vatRate}
                    onChange={(e) => setExpenseAddForm((p) => ({ ...p, vatRate: e.target.value }))}
                    className="fleet-input rounded-2xl"
                    disabled={expenseAddSaving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Fizetés</Label>
                  <Input value={expenseAddForm.paymentMethod} onChange={(e) => setExpenseAddForm((p) => ({ ...p, paymentMethod: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>

                <div className="space-y-2">
                  <Label>Kártya utolsó 4</Label>
                  <Input value={expenseAddForm.paymentCardLast4} onChange={(e) => setExpenseAddForm((p) => ({ ...p, paymentCardLast4: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>
                <div className="space-y-2">
                  <Label>Bizonylat (opcionális)</Label>
                  <Input type="file" accept="image/*,application/pdf" className="fleet-input rounded-2xl" disabled={expenseAddSaving} onChange={(e) => setExpenseAddReceiptFile(e.target.files?.[0] || null)} />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label>Megjegyzés</Label>
                  <Input value={expenseAddForm.note} onChange={(e) => setExpenseAddForm((p) => ({ ...p, note: e.target.value }))} className="fleet-input rounded-2xl" disabled={expenseAddSaving} />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="secondary" className="rounded-2xl" onClick={() => setExpenseAddOpen(false)} disabled={expenseAddSaving}>
              Mégse
            </Button>
            <Button
              className="fleet-primary-btn rounded-2xl"
              onClick={expenseAddMode === "ai" ? saveAddedExpenseAi : saveAddedExpenseManual}
              disabled={expenseAddSaving}
            >
              <Save className="mr-2 h-4 w-4" />
              {expenseAddMode === "ai" ? "AI indítás" : "Mentés"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

                <div className="flex shrink-0 items-center gap-2">
                  {isPreviewableImage(documentPreview) ? (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-2xl"
                        onClick={() => setDocumentPreviewZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                      >
                        −
                      </Button>
                      <div className="min-w-[70px] text-center text-xs font-semibold text-slate-200">
                        {Math.round(documentPreviewZoom * 100)}%
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-2xl"
                        onClick={() => setDocumentPreviewZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                      >
                        +
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="rounded-2xl"
                        onClick={() => setDocumentPreviewZoom(1)}
                      >
                        100%
                      </Button>
                    </>
                  ) : null}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-2xl text-slate-300 hover:bg-white/10 hover:text-white"
                    onClick={() => setDocumentPreview(null)}
                  >
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              <div className="flex-1 p-3 sm:p-5">
                <div className="h-full w-full overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 p-2 sm:p-3">
                  {documentPreview.fileDataUrl ? (
                    isPreviewableImage(documentPreview) ? (
                      <div className="h-full w-full overflow-auto overscroll-contain rounded-2xl bg-slate-950 p-2 sm:p-4 touch-pan-x touch-pan-y">
                        <img
                          src={documentPreview.fileDataUrl}
                          alt={documentPreview.fileName || "Dokumentum előnézet"}
                          draggable={false}
                          style={{
                            transform: `scale(${documentPreviewZoom})`,
                            transformOrigin: "top left",
                          }}
                          className="block max-h-none max-w-none rounded-2xl object-contain"
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

        </div>

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
              <Label>Márka</Label>
              <Input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="pl. Opel"
                className="fleet-input rounded-2xl"
              />
            </div>

            <div className="space-y-2">
              <Label>Típus</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="pl. Astra"
                className="fleet-input rounded-2xl"
              />
            </div>

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

            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Forgalmi (elöl + hátul) → AI kitöltés</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      Tölts fel 2 képet, és az AI kitölti a rendszám/VIN/márka/típus/év/üzemanyag mezőket.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={registrationAiProvider}
                      onValueChange={(next) => {
                        const v =
                          next === "openai" || next === "gemini" || next === "auto" ? next : "auto";
                        setRegistrationAiProvider(v);
                        try {
                          window.localStorage.setItem("fleet_registration_ai_provider", v);
                        } catch {
                          /* ignore */
                        }
                      }}
                      disabled={registrationAiSaving}
                    >
                      <SelectTrigger className="fleet-input h-10 rounded-2xl sm:w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatikus</SelectItem>
                        <SelectItem value="gemini">Google Gemini</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      className="fleet-primary-btn h-10 rounded-2xl"
                      disabled={registrationAiSaving || !registrationFrontFile || !registrationBackFile}
                      onClick={runRegistrationAiPrefill}
                    >
                      {registrationAiSaving ? "AI..." : "AI kitöltés"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Forgalmi – elöl</Label>
                    <Input
                      type="file"
                      accept="image/*"
                      className="fleet-input rounded-2xl"
                      disabled={registrationAiSaving}
                      onChange={(e) => setRegistrationFrontFile(e.target.files?.[0] || null)}
                    />
                    {registrationFrontFile ? (
                      <div className="text-xs text-slate-400">{registrationFrontFile.name}</div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label>Forgalmi – hátul</Label>
                    <Input
                      type="file"
                      accept="image/*"
                      className="fleet-input rounded-2xl"
                      disabled={registrationAiSaving}
                      onChange={(e) => setRegistrationBackFile(e.target.files?.[0] || null)}
                    />
                    {registrationBackFile ? (
                      <div className="text-xs text-slate-400">{registrationBackFile.name}</div>
                    ) : null}
                  </div>
                </div>
              </div>
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
                value={form.driverId}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    driverId: value === SELECT_NONE_VALUE ? "" : value,
                  }))
                }
              >
                <SelectTrigger className="fleet-input rounded-2xl">
                  <SelectValue placeholder="Válassz sofőrt" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SELECT_NONE_VALUE}>Nincs beállítva</SelectItem>
                  {drivers
                    .filter((d) => d.is_active)
                    .map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
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

            {currentCompanyRole === "admin" ? (
              <div className="space-y-2">
                <Label>Státusz</Label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                  <SelectTrigger className="fleet-input rounded-2xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktív</SelectItem>
                    <SelectItem value="service">Szerviz alatt</SelectItem>
                    <SelectItem value="inactive">Inaktív</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

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