import { isDataUrl } from "./document-storage";

export async function resolveDocumentUrl({ supabase, doc, ttlSeconds = 300 }) {
  if (!doc) return "";

  const existingUrl = String(doc.fileDataUrl || "");
  if (existingUrl && isDataUrl(existingUrl)) return existingUrl;

  const storagePath = String(doc.storagePath || doc.storage_path || "");
  if (storagePath) {
    const { data, error } = await supabase.storage
      .from("vehicle-documents")
      .createSignedUrl(storagePath, ttlSeconds);

    if (error) {
      throw error;
    }

    return data?.signedUrl || "";
  }

  return existingUrl;
}

