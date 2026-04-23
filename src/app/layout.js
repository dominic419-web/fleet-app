import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeProvider from "@/components/theme/ThemeProvider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Flottamonitor",
  description: "Flottamonitor",
  icons: {
    icon: [{ url: new URL("./mac_icon-icons.com_54610.ico", import.meta.url) }],
    apple: "/mac_icon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" data-accent="blue" suppressHydrationWarning>
      <body className={`${inter.variable} ${geistMono.variable} antialiased`}>
        <div className="fleet-page-bg mesh-gradient" aria-hidden="true" />
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
