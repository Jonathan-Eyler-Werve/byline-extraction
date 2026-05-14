import type { SocialResult } from "./socials.js";

export type ExtractionResult = {
  sourceUrl: string;
  author: string;
  authorEmail?: string;
  pageUrl: string;
  feedTitle?: string;
  title?: string;
  publishedAt?: string;
  error?: string;
  socials?: SocialResult;
};

export type FeedConfig = {
  pageUrl: string;
  title?: string;
  linkSelector?: string;
  linkPattern?: string;
};

export type AppConfig = {
  feeds: FeedConfig[];
};
