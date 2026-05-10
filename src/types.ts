export type ExtractionResult = {
  sourceUrl: string;
  author: string;
  authorEmail?: string;
  pageUrl: string;
  title?: string;
  publishedAt?: string;
  error?: string;
};

export type FeedConfig = {
  pageUrl: string;
  linkSelector?: string;
  linkPattern?: string;
};

export type AppConfig = {
  feeds: FeedConfig[];
};
