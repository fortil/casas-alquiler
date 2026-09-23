import { NextResponse, type NextRequest } from "next/server";
import { buildMarkedWorkbook } from "@/lib/exportXlsx";
import { xlsxFilename } from "@/lib/core/report";
import type { ExportRow } from "@/lib/markedHouses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const rows: ExportRow[] = Array.isArray(b.rows) ? b.rows : [];
    const buf = await buildMarkedWorkbook(rows);
    const filename = xlsxFilename(b.tema ?? "casas-marcadas");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
