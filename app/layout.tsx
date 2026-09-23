import type { Metadata } from "next";
import "./globals.css";
import { NavLinks } from "@/components/NavLinks";

export const metadata: Metadata = {
  title: "Casas en Alquiler — Jamundí & sur de Cali",
  description: "Buscador de casas en alquiler por mejor valor para inquilino",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body suppressHydrationWarning>
        <nav className="nav">
          <span className="brand">🏠 Casas en Alquiler</span>
          <NavLinks />
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
