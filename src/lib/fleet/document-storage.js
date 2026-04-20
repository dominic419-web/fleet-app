import { DOCUMENT_STORAGE_BUCKET } from "./constants";

export function sanitizeStorageSegment(value) {
  return (
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "file"
  );
}

export function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

export function buildDocumentStoragePath({ userId, vehicleId, docKey, fileName }) {
  const safeName = sanitizeStorageSegment(fileName);
  return `${userId}/${vehicleId}/${docKey}/${Date.now()}-${safeName}`;
}

export function getStoragePathFromFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string" || isDataUrl(fileUrl)) return "";

  const marker = `/storage/v1/object/public/${DOCUMENT_STORAGE_BUCKET}/`;
  const markerIndex = fileUrl.indexOf(marker);
  if (markerIndex === -1) return "";

  return decodeURIComponent(fileUrl.slice(markerIndex + marker.length));
}
