import { csvEscape, getExpiryStatus, todayIso } from "@/lib/fleet-utils";
import { OIL_SERVICE_LABEL, TIMING_SERVICE_LABEL } from "./constants";
import { createDefaultVehicleDocCollections } from "./supabase-fleet";
import { getCustomServiceCycleStatus, normalizeServiceHistoryItem } from "./service-history";
import { computeVehicleHealthIndex } from "./vehicle-health";

export function buildServiceHistoryCsvExport(vehiclesForCsv) {
  const rows = [
    [
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
    ],
  ];

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
}

export function buildHealthCsvExport(vehiclesForCsv, documentsByVehicle) {
  const rows = [
    [
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
    ],
  ];

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
      computeVehicleHealthIndex(vehicle, documentsByVehicle),
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
}
