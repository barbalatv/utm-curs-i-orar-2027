import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orar FCIM UTM · Anul I",
  description: "Orarul actual al studenților din anul I FCIM UTM, actualizat automat din PDF-ul oficial.",
  applicationName: "Orar FCIM",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ro">
      <body className="bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
