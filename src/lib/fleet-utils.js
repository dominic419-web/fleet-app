export const SERVICE_INTERVAL = 20000;
export const EXPIRY_WARNING_DAYS = 30;
export const CUSTOM_OWNER_VALUE = "__custom__";

export const STORAGE_KEYS = {
  vehicles: "fleet_vehicles_v4",
  owners: "fleet_owners_v4",
  docs: "fleet_docs_v4",
  email: "fleet_email_v4",
  ack: "fleet_ack_v4",
  dismissed: "fleet_dismissed_v4",
  ui: "fleet_ui_v1",
};

export const initialOwnerOptions = ["Tulaj 1", "Tulaj 2", "Tulaj 3", "Tulaj 4"];

export const initialVehicles = [
  {
    id: 1,
    name: "Ford Transit",
    plate: "ABC-123",
    currentKm: 125000,
    lastServiceKm: 110000,
    owner: "Tulaj 1",
    note: "Futár autó",
    year: "2020",
    vin: "WF0XXXTTGXLA12345",
    fuelType: "Dízel",
    insuranceExpiry: "2026-08-15",
    inspectionExpiry: "2026-05-20",
    archived: false,
  },
  {
    id: 2,
    name: "Skoda Octavia",
    plate: "DEF-456",
    currentKm: 84300,
    lastServiceKm: 70000,
    owner: "Tulaj 2",
    note: "Értékesítés",
    year: "2021",
    vin: "TMBJR7NX5MY456789",
    fuelType: "Benzin",
    insuranceExpiry: "2026-11-10",
    inspectionExpiry: "2027-01-25",
    archived: false,
  },
  {
    id: 3,
    name: "Toyota Corolla",
    plate: "GHI-789",
    currentKm: 50120,
    lastServiceKm: 40000,
    owner: "Tulaj 3",
    note: "Irodai használat",
    year: "2019",
    vin: "SB1K93BE20E987654",
    fuelType: "Hibrid",
    insuranceExpiry: "2026-07-01",
    inspectionExpiry: "2026-09-12",
    archived: false,
  },
  {
    id: 4,
    name: "Volkswagen Caddy",
    plate: "JKL-321",
    currentKm: 198500,
    lastServiceKm: 176000,
    owner: "Tulaj 4",
    note: "Hosszú utak",
    year: "2018",
    vin: "WV1ZZZSYZJ9012345",
    fuelType: "Dízel",
    insuranceExpiry: "2026-06-30",
    inspectionExpiry: "2026-04-18",
    archived: false,
  },
];

export const defaultEmailSettings = {
  enabled: false,
  recipients: "",
  serviceAlerts: true,
  legalAlerts: true,
  ownerAlerts: true,
  docsAlerts: true,
};

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function createDefaultVehicleDocs(insuranceExpiry = "", inspectionExpiry = "") {
  return {
    registration: {
      title: "Forgalmi engedély",
      uploaded: false,
      fileName: "",
      uploadedAt: "",
      expiry: "",
      note: "",
    },
    insurance: {
      title: "Biztosítás",
      uploaded: false,
      fileName: "",
      uploadedAt: "",
      expiry: insuranceExpiry || "",
      note: "",
    },
    inspection: {
      title: "Műszaki vizsga",
      uploaded: false,
      fileName: "",
      uploadedAt: "",
      expiry: inspectionExpiry || "",
      note: "",
    },
    service: {
      title: "Szerviz dokumentumok",
      uploaded: false,
      fileName: "",
      uploadedAt: "",
      expiry: "",
      note: "",
    },
  };
}

export function createInitialDocsMap(vehicles) {
  const map = {};
  vehicles.forEach((vehicle) => {
    map[String(vehicle.id)] = createDefaultVehicleDocs(
      vehicle.insuranceExpiry,
      vehicle.inspectionExpiry
    );
  });
  return map;
}

export function safeRead(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function safeWrite(key, value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // csendben elengedjük
  }
}

export function computeVehicle(v) {
  const nextServiceKm = v.lastServiceKm + SERVICE_INTERVAL;
  const remainingKm = nextServiceKm - v.currentKm;
  const usedSinceService = Math.max(0, v.currentKm - v.lastServiceKm);
  const progress = Math.min(100, Math.max(0, (usedSinceService / SERVICE_INTERVAL) * 100));

  let status = "ok";
  if (remainingKm <= 0) status = "late";
  else if (remainingKm <= 3000) status = "warning";

  return { ...v, nextServiceKm, remainingKm, progress, status };
}

export function buildStats(vehicles) {
  const total = vehicles.length;
  const warning = vehicles.filter((v) => v.status === "warning").length;
  const late = vehicles.filter((v) => v.status === "late").length;
  const avgKm = total
    ? Math.round(vehicles.reduce((sum, v) => sum + v.currentKm, 0) / total)
    : 0;

  return { total, warning, late, avgKm };
}

export function getDaysUntil(dateString) {
  if (!dateString) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function getExpiryStatus(dateString) {
  const days = getDaysUntil(dateString);

  if (days === null) {
    return {
      status: "unknown",
      label: "Nincs megadva",
      helper: "Adj meg dátumot",
    };
  }

  if (days < 0) {
    return {
      status: "late",
      label: "Lejárt",
      helper: `${Math.abs(days)} napja lejárt`,
    };
  }

  if (days <= EXPIRY_WARNING_DAYS) {
    return {
      status: "warning",
      label: "Közeleg",
      helper: `${days} nap múlva lejár`,
    };
  }

  return {
    status: "ok",
    label: "Rendben",
    helper: `${days} nap múlva lejár`,
  };
}

export function formatDateHu(dateString) {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("hu-HU");
}

export function getOwnerModeAndCustom(owner, ownerOptions) {
  if (owner && ownerOptions.includes(owner)) {
    return {
      ownerMode: owner,
      customOwner: "",
    };
  }

  return {
    ownerMode: CUSTOM_OWNER_VALUE,
    customOwner: owner || "",
  };
}

export function resolveOwnerValue(ownerMode, customOwner) {
  if (ownerMode === CUSTOM_OWNER_VALUE) {
    return customOwner.trim();
  }
  return ownerMode.trim();
}

export function getDocUploadStatus(doc) {
  if (!doc || !doc.uploaded) {
    return {
      status: "missing",
      label: "Hiányzik",
      helper: "Nincs feltöltve",
    };
  }

  if (doc.expiry) {
    const expiry = getExpiryStatus(doc.expiry);
    if (expiry.status === "late") {
      return {
        status: "late",
        label: "Lejárt",
        helper: expiry.helper,
      };
    }
    if (expiry.status === "warning") {
      return {
        status: "warning",
        label: "Közeleg",
        helper: expiry.helper,
      };
    }
  }

  return {
    status: "ok",
    label: "Feltöltve",
    helper: doc.uploadedAt ? `Feltöltve: ${formatDateHu(doc.uploadedAt)}` : "Feltöltve",
  };
}

export function severityRank(status) {
  if (status === "late") return 0;
  if (status === "warning") return 1;
  if (status === "missing") return 2;
  if (status === "ok") return 3;
  return 4;
}

export function csvEscape(value) {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
