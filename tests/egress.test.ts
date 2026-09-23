import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock both remote-egress providers so no Bright Data credits are spent.
vi.mock("@/lib/providers/brightdata", () => ({
  hasBrightData: vi.fn(() => false),
  brightDataFetch: vi.fn(async () => null as string | null),
}));
vi.mock("@/lib/providers/scrapingBrowser", () => ({
  hasScrapingBrowser: vi.fn(() => false),
  browserEgressFetch: vi.fn(async () => null as string | null),
  closeScrapingBrowser: vi.fn(async () => {}),
}));

import { HttpClient, setForcedFetchVia } from "@/lib/adapters/base/httpClient";
import { brightDataFetch } from "@/lib/providers/brightdata";
import { browserEgressFetch, hasScrapingBrowser } from "@/lib/providers/scrapingBrowser";

const URL_ = "https://portal.example/listado";

beforeEach(() => {
  // Reset provider mocks to their "nothing configured / nothing fetched"
  // defaults — later tests override per-case.
  vi.mocked(hasScrapingBrowser).mockReturnValue(false);
  vi.mocked(browserEgressFetch).mockResolvedValue(null);
  vi.mocked(brightDataFetch).mockResolvedValue(null);
  // Kill the local network path: direct fetch always fails, so any success
  // proves the request went through a remote egress mock.
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("local network disabled in test");
  }));
});

afterEach(() => {
  setForcedFetchVia(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("HttpClient forced remote egress", () => {
  it("routes direct requests through Bright Data when forced", async () => {
    vi.mocked(brightDataFetch).mockResolvedValue("<html>remoto</html>");
    setForcedFetchVia("brightdata");
    const http = new HttpClient();
    const body = await http.getText(URL_, { via: "direct" });
    expect(body).toBe("<html>remoto</html>");
    expect(brightDataFetch).toHaveBeenCalledWith(URL_, expect.anything());
  });

  it("keeps using the local IP when not forced", async () => {
    const http = new HttpClient();
    await expect(http.getText(URL_, { via: "direct" })).rejects.toThrow();
    expect(brightDataFetch).not.toHaveBeenCalled();
    expect(browserEgressFetch).not.toHaveBeenCalled();
  });

  it("prefers the Scraping Browser egress over the Unlocker API", async () => {
    vi.mocked(hasScrapingBrowser).mockReturnValue(true);
    vi.mocked(browserEgressFetch).mockResolvedValue("<html>browser</html>");
    setForcedFetchVia("brightdata");
    const http = new HttpClient();
    const body = await http.getText(URL_);
    expect(body).toBe("<html>browser</html>");
    expect(browserEgressFetch).toHaveBeenCalled();
    expect(brightDataFetch).not.toHaveBeenCalled();
  });

  it("falls back to the Unlocker API when the browser egress fails", async () => {
    vi.mocked(hasScrapingBrowser).mockReturnValue(true);
    vi.mocked(browserEgressFetch).mockResolvedValue(null);
    vi.mocked(brightDataFetch).mockResolvedValue("<html>unlocker</html>");
    setForcedFetchVia("brightdata");
    const http = new HttpClient();
    const body = await http.getText(URL_);
    expect(body).toBe("<html>unlocker</html>");
    expect(brightDataFetch).toHaveBeenCalledWith(URL_, expect.anything());
  });

  it("throws when forced remote egress is unavailable", async () => {
    setForcedFetchVia("brightdata");
    const http = new HttpClient();
    await expect(http.getText(URL_)).rejects.toThrow(/brightdata fetch failed/);
  });
});

describe("hasScrapingBrowser", () => {
  it("reflects the BRIGHTDATA_BROWSER_WS env var", async () => {
    const { hasScrapingBrowser: real } = await vi.importActual<
      typeof import("@/lib/providers/scrapingBrowser")
    >("@/lib/providers/scrapingBrowser");
    vi.stubEnv("BRIGHTDATA_BROWSER_WS", "");
    expect(real()).toBe(false);
    vi.stubEnv("BRIGHTDATA_BROWSER_WS", "wss://brd.example:9222");
    expect(real()).toBe(true);
  });
});
