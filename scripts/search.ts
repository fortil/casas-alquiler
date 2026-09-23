import "dotenv/config";
import { searchStored } from "@/lib/core/query";
import { DEFAULT_WEIGHTS, parsePoint } from "@/lib/config";

/**
 * CLI search over stored listings (Mode A read path).
 *   npm run search -- --ref 3.2616,-76.5417 --max 8 --min 80 --cities jamundi
 */
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const ref = parsePoint(arg("ref", "3.2616,-76.5417")) ?? { lat: 3.2616, lng: -76.5417 };
  const maxDistKm = parseFloat(arg("max", "8")!);
  const minAreaM2 = parseFloat(arg("min", "80")!);
  const cities = (arg("cities", "jamundi,cali") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const distanceMode = arg("drive") === undefined ? "haversine" : "google_driving";

  const res = await searchStored({
    cities,
    refPoint: ref,
    maxDistKm,
    minAreaM2,
    weights: DEFAULT_WEIGHTS,
    distanceMode: distanceMode as "haversine" | "google_driving",
    topN: 10,
  });

  console.log(
    `\nRef ${ref.lat},${ref.lng}  max ${maxDistKm}km  min ${minAreaM2}m²  cities=${cities.join(",")}`,
  );
  console.log(
    `Active in DB: ${res.totalActive} · after filters: ${res.stats.kept} · with location: ${res.stats.withLocation}`,
  );
  console.log(`Dropped reasons:`, res.droppedReasons);
  console.log(`\n=== TOP ${res.top.length} ===`);
  for (const l of res.top) {
    const loc = [l.barrio, l.conjunto].filter(Boolean).join(" / ") || l.address || "?";
    console.log(
      `#${l.rank} [${(l.sources ?? [l.source]).join("+")}] ${loc} (${l.city}) — ` +
        `${l.areaM2}m² $${l.price?.toLocaleString("es-CO")} ` +
        `($${Math.round(l.costPerM2).toLocaleString("es-CO")}/m²) ` +
        `${l.distanceKm?.toFixed(1)}km score=${l.score.toFixed(3)}` +
        (l.phone ? ` tel=${l.phone}` : ""),
    );
    if ((l.sources?.length ?? 0) > 1) {
      for (const s of l.sourceLinks ?? []) console.log(`      ↳ ${s.source}: ${s.url}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
