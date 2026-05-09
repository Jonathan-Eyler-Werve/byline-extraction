import type { ExtractionResult } from "./types.js";

export type SheetClient = {
  readSeenSourceUrls(): Promise<Set<string>>;
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
  fetchImpl?: typeof fetch;
}): SheetClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

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
    readSeenSourceUrls: async () => {
      const url = `${opts.webhookUrl}?op=seen`;
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(30_000),
      });
      const data = await parse(res, "seen");
      return new Set(data.urls ?? []);
    },

    appendRows: async (rows) => {
      if (rows.length === 0) return;
      const res = await fetchImpl(opts.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "append", rows }),
        signal: AbortSignal.timeout(60_000),
      });
      await parse(res, "append");
    },
  };
}
