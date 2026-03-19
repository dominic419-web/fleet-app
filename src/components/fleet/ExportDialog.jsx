import { Check, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ExportDialog({
  exportOpen,
  setExportOpen,
  exportOptions,
  toggleExportOption,
  exportIncludeArchived,
  setExportIncludeArchived,
  handleExportDownload,
}) {
  return (
    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
      <DialogContent className="border-white/10 bg-slate-950 text-slate-50 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            Válaszd ki, milyen formátumban és milyen tartalmat szeretnél exportálni.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div className="mb-2 font-medium text-white">Mit szeretnél exportálni?</div>
            <div className="mb-4 text-sm text-slate-400">
              Jelöld be a kívánt export fájlokat, majd kattints a Letöltés gombra.
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => toggleExportOption("fullJson")}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-left transition hover:border-white/20 hover:bg-slate-900"
              >
                <div>
                  <div className="font-medium text-white">Teljes mentés JSON</div>
                  <div className="text-sm text-slate-400">
                    Teljes backup járművekkel, dokumentumokkal és email beállításokkal.
                  </div>
                </div>
                <div
                  className={`ml-4 flex h-6 w-6 items-center justify-center rounded-md border ${
                    exportOptions.fullJson
                      ? "border-white bg-white text-slate-950"
                      : "border-white/20 bg-transparent text-transparent"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => toggleExportOption("vehiclesCsv")}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-left transition hover:border-white/20 hover:bg-slate-900"
              >
                <div>
                  <div className="font-medium text-white">Járművek CSV</div>
                  <div className="text-sm text-slate-400">
                    Táblázatos export a jármű alapadatokról és szervizállapotról.
                  </div>
                </div>
                <div
                  className={`ml-4 flex h-6 w-6 items-center justify-center rounded-md border ${
                    exportOptions.vehiclesCsv
                      ? "border-white bg-white text-slate-950"
                      : "border-white/20 bg-transparent text-transparent"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => toggleExportOption("documentsCsv")}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-left transition hover:border-white/20 hover:bg-slate-900"
              >
                <div>
                  <div className="font-medium text-white">Dokumentumok CSV</div>
                  <div className="text-sm text-slate-400">
                    Táblázatos export a dokumentumok állapotáról és lejáratáról.
                  </div>
                </div>
                <div
                  className={`ml-4 flex h-6 w-6 items-center justify-center rounded-md border ${
                    exportOptions.documentsCsv
                      ? "border-white bg-white text-slate-950"
                      : "border-white/20 bg-transparent text-transparent"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => toggleExportOption("serviceHistoryCsv")}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-left transition hover:border-white/20 hover:bg-slate-900"
              >
                <div>
                  <div className="font-medium text-white">Szerviz history CSV</div>
                  <div className="text-sm text-slate-400">
                    Táblázatos export a szerviz bejegyzésekről, költségekről és dátumokról.
                  </div>
                </div>
                <div
                  className={`ml-4 flex h-6 w-6 items-center justify-center rounded-md border ${
                    exportOptions.serviceHistoryCsv
                      ? "border-white bg-white text-slate-950"
                      : "border-white/20 bg-transparent text-transparent"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </div>
              </button>

              <button
                type="button"
                onClick={() => toggleExportOption("healthCsv")}
                className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-left transition hover:border-white/20 hover:bg-slate-900"
              >
                <div>
                  <div className="font-medium text-white">Jármű állapotindex CSV</div>
                  <div className="text-sm text-slate-400">
                    Export a járművenkénti állapotindex összesítésről.
                  </div>
                </div>
                <div
                  className={`ml-4 flex h-6 w-6 items-center justify-center rounded-md border ${
                    exportOptions.healthCsv
                      ? "border-white bg-white text-slate-950"
                      : "border-white/20 bg-transparent text-transparent"
                  }`}
                >
                  <Check className="h-4 w-4" />
                </div>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
            <div className="mb-2 font-medium text-white">Archivált járművek</div>
            <div className="mb-4 text-sm text-slate-400">
              A CSV export tartalmazza-e az archivált járműveket is.
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                variant={exportIncludeArchived ? "default" : "secondary"}
                className="rounded-2xl"
                onClick={() => setExportIncludeArchived(true)}
              >
                Belefoglalva
              </Button>
              <Button
                variant={!exportIncludeArchived ? "default" : "secondary"}
                className="rounded-2xl"
                onClick={() => setExportIncludeArchived(false)}
              >
                Kihagyva
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="secondary" className="rounded-2xl" onClick={() => setExportOpen(false)}>
            Bezárás
          </Button>
          <Button className="rounded-2xl" onClick={handleExportDownload}>
            <Download className="mr-2 h-4 w-4" />
            Letöltés
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
