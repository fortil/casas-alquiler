import { NextResponse, type NextRequest } from "next/server";
import { verifyMany } from "@/lib/core/verify";
import { prisma } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Liveness-check a batch of URLs. Optionally persists isActive=false for the
 * dead ones (when `persist` is true and the URL maps to a stored listing).
 */
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const urls: string[] = Array.isArray(b.urls) ? b.urls.slice(0, 60) : [];
    if (urls.length === 0) return NextResponse.json({ results: {} });

    const map = await verifyMany(urls);
    const results: Record<string, { isActive: boolean; reason: string }> = {};
    const dead: string[] = [];
    for (const [url, r] of map) {
      results[url] = { isActive: r.isActive, reason: r.reason };
      if (!r.isActive) dead.push(url);
    }

    if (b.persist && dead.length) {
      await prisma.listing.updateMany({
        where: { url: { in: dead } },
        data: { isActive: false, lastVerifiedAt: new Date() },
      });
    }

    return NextResponse.json({ results, dead });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
