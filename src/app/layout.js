import { Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
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
    <html lang="en">
      <body className={`fleet-app ${spaceGrotesk.variable} ${geistMono.variable} antialiased`}>
        <div className="fleet-runtime-bg" aria-hidden="true">
          <div className="fleet-runtime-bg__base" />
          <div className="fleet-runtime-bg__grid" />
          <div className="fleet-runtime-bg__waves fleet-runtime-bg__waves--one" />
          <div className="fleet-runtime-bg__waves fleet-runtime-bg__waves--two" />
          <div className="fleet-runtime-bg__waves fleet-runtime-bg__waves--three" />
          <div className="fleet-runtime-bg__glow fleet-runtime-bg__glow--cyan" />
          <div className="fleet-runtime-bg__glow fleet-runtime-bg__glow--violet" />
          <div className="fleet-runtime-bg__glow fleet-runtime-bg__glow--blue" />
          <div className="fleet-runtime-bg__particles" />
        </div>

        <div className="fleet-runtime-app">
          {children}
        </div>
      </body>
    </html>
  );
}
