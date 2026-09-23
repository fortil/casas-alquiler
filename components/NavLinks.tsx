"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Buscar" },
  { href: "/list", label: "Mi lista" },
  { href: "/history", label: "Historial" },
  { href: "/marked", label: "Marcadas" },
  { href: "/config", label: "Configuración" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </>
  );
}
