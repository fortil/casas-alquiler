import { ALL_ADAPTERS } from "@/lib/adapters";
import { ConfigClient, type SourceMeta } from "@/components/ConfigClient";

// Server Component: derives the small {id,tier,domain} metadata from the real
// adapter registry here, server-side, so the client bundle never has to pull
// in the adapters' scraping implementations (cheerio, tough-cookie, etc.).
export default function ConfigPage() {
  const sources: SourceMeta[] = ALL_ADAPTERS.map((a) => ({ id: a.id, tier: a.tier, domain: a.domain }));
  return <ConfigClient sources={sources} />;
}
