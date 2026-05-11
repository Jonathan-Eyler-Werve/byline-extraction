import type { ExtractionResult } from "./types.js";
import { USER_AGENT } from "./userAgent.js";

export type SheetClient = {
  readSeenSourceUrls(opts?: { excludeErrors?: boolean }): Promise<Set<string>>;
  appendRows(rows: ExtractionResult[]): Promise<void>;
};

export function makeDryRunSheetClient(
  onAppend: (rows: ExtractionResult[]) => void = () => {},
): SheetClient {
  return {
    readSeenSourceUrls: async () => new Set<string>(),
    appendRows: async (rows) => { onAppend(rows); },
  };
}

type WebhookResponse = {
  urls?: string[];
  appended?: number;
  error?: string;
};

export function makeWebhookSheetClient(opts: {
  webhookUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
}): SheetClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const buildUrl = (params: Record<string, string> = {}): string => {
    const u = new URL(opts.webhookUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (opts.token) u.searchParams.set("token", opts.token);
    return u.toString();
  };

  const parse = async (res: Response, label: string): Promise<WebhookResponse> => {
    if (!res.ok) {
      throw new Error(`webhook ${label} failed: ${res.status}`);
    }
    const data = (await res.json()) as WebhookResponse;
    if (data.error) {
      throw new Error(`webhook ${label} error: ${data.error}`);
    }
    return data;
  };

  return {
    readSeenSourceUrls: async (readOpts) => {
      const params: Record<string, string> = { op: "seen" };
      if (readOpts?.excludeErrors) params.excludeErrors = "1";
      const res = await fetchImpl(buildUrl(params), {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      const data = await parse(res, "seen");
      return new Set(data.urls ?? []);
    },

    appendRows: async (rows) => {
      if (rows.length === 0) return;
      const res = await fetchImpl(buildUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ op: "append", rows }),
        signal: AbortSignal.timeout(60_000),
      });
      await parse(res, "append");
    },
  };
}
