import type { SourceAdapter } from "@/lib/adapters/types";
import { biencoAdapter } from "@/lib/adapters/bienco";
import { fincaraizAdapter } from "@/lib/adapters/fincaraiz";
import { ciencuadrasAdapter } from "@/lib/adapters/ciencuadras";
import { properatiAdapter } from "@/lib/adapters/properati";
import { rentolaAdapter } from "@/lib/adapters/rentola";
import { inmobiliariajrAdapter } from "@/lib/adapters/inmobiliariajr";
import { inmoalfaguaraAdapter } from "@/lib/adapters/inmoalfaguara";
import { naranjoduqueAdapter } from "@/lib/adapters/naranjoduque";
import { elpaisfincaraizAdapter } from "@/lib/adapters/elpaisfincaraiz";
import { mitulaAdapter } from "@/lib/adapters/mitula";
import { metrocuadradoAdapter } from "@/lib/adapters/metrocuadrado";
import { arriendoAdapter } from "@/lib/adapters/arriendo";
import { century21Adapter } from "@/lib/adapters/century21";

/** All implemented source adapters, in ROI / tier order. */
export const ALL_ADAPTERS: SourceAdapter[] = [
  biencoAdapter,
  fincaraizAdapter,
  ciencuadrasAdapter,
  properatiAdapter,
  rentolaAdapter,
  inmobiliariajrAdapter,
  inmoalfaguaraAdapter,
  naranjoduqueAdapter,
  elpaisfincaraizAdapter,
  mitulaAdapter,
  metrocuadradoAdapter,
  arriendoAdapter,
  century21Adapter,
];

export interface AdapterSelection {
  /** include Tier C sources that need Bright Data / headless */
  includeHardSources?: boolean;
  /** explicit allowlist of adapter ids; when set, overrides tier filtering */
  only?: string[];
}

export function selectAdapters(opts: AdapterSelection = {}): SourceAdapter[] {
  let list = ALL_ADAPTERS;
  if (opts.only && opts.only.length) {
    const set = new Set(opts.only);
    return list.filter((a) => set.has(a.id));
  }
  if (!opts.includeHardSources) {
    list = list.filter((a) => a.tier !== "C");
  }
  return list;
}

export function getAdapter(id: string): SourceAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}

/** Root domains already covered by an implemented adapter (single source of truth). */
export const ADAPTER_DOMAINS: Record<string, string> = Object.fromEntries(
  ALL_ADAPTERS.map((a) => [a.id, a.domain]),
);
