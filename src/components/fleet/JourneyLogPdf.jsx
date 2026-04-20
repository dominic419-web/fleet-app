"use client";

import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

// Unicode font (Hungarian accents) for PDF rendering.
// Use Noto Sans served by Google Fonts. If you prefer offline fonts,
// we can swap these URLs to local `/public/fonts/...` assets.
Font.register({
  family: "NotoSans",
  fonts: [
    {
      // Stable TTF source (avoids fonts.gstatic.com versioned URL 404s)
      src: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
      fontWeight: 400,
    },
    {
      src: "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf",
      fontWeight: 700,
    },
  ],
});

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 32,
    paddingHorizontal: 28,
    fontSize: 10,
    fontFamily: "NotoSans",
    color: "#0b1220",
  },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  subtitle: { fontSize: 11, marginBottom: 14, color: "#334155" },
  metaRow: { flexDirection: "row", gap: 18, marginBottom: 10 },
  metaItem: { fontSize: 10, color: "#0f172a" },

  table: { borderWidth: 1, borderColor: "#0f172a" },
  thead: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderBottomWidth: 1,
    borderBottomColor: "#0f172a",
  },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#0f172a" },
  rowLast: { flexDirection: "row" },
  th: { padding: 6, fontSize: 9, fontWeight: 700, borderRightWidth: 1, borderRightColor: "#0f172a" },
  thLast: { padding: 6, fontSize: 9, fontWeight: 700 },
  td: { padding: 6, fontSize: 9, borderRightWidth: 1, borderRightColor: "#0f172a" },
  tdLast: { padding: 6, fontSize: 9 },
  tdWrap: { flexWrap: "wrap", lineHeight: 1.2 },
  tdSmall: { fontSize: 8, lineHeight: 1.15 },
  tdSmallWrap: { fontSize: 8, lineHeight: 1.15, flexWrap: "wrap" },

  footer: { marginTop: 12, flexDirection: "row", justifyContent: "space-between" },
  total: { fontSize: 11, fontWeight: 700 },
});

const col = {
  date: { width: "9%" },
  time: { width: "12%" },
  route: { width: "33%" },
  km: { width: "18%" },
  distance: { width: "9%" },
  type: { width: "8%" },
  note: { width: "11%" },
};

function hhmm(iso) {
  if (!iso) return "—";
  return String(iso).slice(11, 16) || "—";
}

function ymd(iso) {
  if (!iso) return "—";
  return String(iso).slice(0, 10) || "—";
}

export default function JourneyLogPdf({ month, vehicleLabel, rows }) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalKm = safeRows.reduce((sum, r) => {
    const startKm = Number(r.start_km ?? 0);
    const endKm = Number(r.end_km ?? startKm);
    const distance = Number.isFinite(endKm - startKm) ? Math.max(0, endKm - startKm) : 0;
    return sum + distance;
  }, 0);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Útnyilvántartás</Text>
        <Text style={styles.subtitle}>Havi bontás (NAV)</Text>

        <View style={styles.metaRow}>
          <Text style={styles.metaItem}>Hónap: {month || "—"}</Text>
          <Text style={styles.metaItem}>Jármű: {vehicleLabel || "—"}</Text>
          <Text style={styles.metaItem}>Sorok: {String(safeRows.length)}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.thead}>
            <Text style={[styles.th, col.date]}>Dátum</Text>
            <Text style={[styles.th, col.time]}>Idő</Text>
            <Text style={[styles.th, col.route]}>Honnan → Hová</Text>
            <Text style={[styles.th, col.km]}>Km (start/end)</Text>
            <Text style={[styles.th, col.distance]}>Táv</Text>
            <Text style={[styles.th, col.type]}>Típus</Text>
            <Text style={[styles.thLast, col.note]}>Megjegyzés</Text>
          </View>

          {safeRows.map((r, idx) => {
            const startKm = Number(r.start_km ?? 0);
            const endKm = r.end_km == null ? null : Number(r.end_km);
            const distance = endKm == null ? "" : String(Math.max(0, endKm - startKm));
            const isLast = idx === safeRows.length - 1;
            return (
              <View key={`pdf-row-${r.id}`} style={isLast ? styles.rowLast : styles.row}>
                <Text style={[styles.td, col.date]}>{ymd(r.started_at)}</Text>
                <Text style={[styles.td, col.time]}>
                  {hhmm(r.started_at)} / {hhmm(r.ended_at)}
                </Text>
                <Text style={[styles.td, styles.tdSmallWrap, col.route]} wrap>
                  {(r.start_location || "—") + " → " + (r.end_location || "—")}
                </Text>
                <Text style={[styles.td, col.km]}>
                  {String(r.start_km ?? "—")} / {String(r.end_km ?? "—")}
                </Text>
                <Text style={[styles.td, col.distance]}>{distance ? `${distance} km` : "—"}</Text>
                <Text style={[styles.td, col.type]}>{r.trip_type === "private" ? "Privát" : "Üzleti"}</Text>
                <Text style={[styles.tdLast, styles.tdSmallWrap, col.note]} wrap>
                  {r.note || ""}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Text style={styles.total}>Összes táv: {totalKm} km</Text>
          <Text style={{ fontSize: 9, color: "#475569" }}>
            Generálva: {new Date().toISOString().slice(0, 10)}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

