import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { classifySocial, extractSocialsFromHtml } from "../src/socials.js";

const fx = (name: string) =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("classifySocial — twitter / x", () => {
  it("classifies twitter.com profile URL as twitter", () => {
    expect(classifySocial("https://twitter.com/mrbrownsir")).toEqual({
      column: "twitter",
      url: "https://twitter.com/mrbrownsir",
    });
  });

  it("classifies x.com profile URL as twitter", () => {
    expect(classifySocial("https://x.com/maggie_dough")).toEqual({
      column: "twitter",
      url: "https://x.com/maggie_dough",
    });
  });

  it("strips leading www. from host but preserves it in the stored URL", () => {
    expect(classifySocial("https://www.x.com/foo")).toEqual({
      column: "twitter",
      url: "https://www.x.com/foo",
    });
  });

  it("rejects twitter share intents", () => {
    expect(classifySocial("https://twitter.com/intent/tweet?url=...")).toBeNull();
  });

  it("rejects /share path", () => {
    expect(classifySocial("https://twitter.com/share?u=...")).toBeNull();
  });
});

describe("classifySocial — instagram", () => {
  it("classifies instagram.com profile", () => {
    expect(classifySocial("https://www.instagram.com/byalicefinno/")?.column).toBe("instagram");
  });
});

describe("classifySocial — linkedin", () => {
  it("classifies linkedin.com/in/ profile", () => {
    expect(classifySocial("https://www.linkedin.com/in/sydney-lake/")?.column).toBe("linkedin");
  });

  it("classifies linkedin.com/company/ as linkedin", () => {
    expect(classifySocial("https://www.linkedin.com/company/byline-extraction/")?.column).toBe("linkedin");
  });

  it("rejects linkedin.com/jobs path", () => {
    expect(classifySocial("https://www.linkedin.com/jobs/view/123")).toBeNull();
  });

  it("rejects linkedin shareArticle", () => {
    expect(classifySocial("https://www.linkedin.com/shareArticle?mini=true&url=...")).toBeNull();
  });
});

describe("classifySocial — bluesky", () => {
  it("classifies bsky.app/profile/ as bluesky", () => {
    expect(classifySocial("https://bsky.app/profile/jane.bsky.social")?.column).toBe("bluesky");
  });

  it("rejects bsky.app/intent/compose", () => {
    expect(classifySocial("https://bsky.app/intent/compose?text=...")).toBeNull();
  });
});

describe("classifySocial — negative cases", () => {
  it("rejects facebook (not in allowlist)", () => {
    expect(classifySocial("https://www.facebook.com/something")).toBeNull();
  });

  it("rejects sharer.php", () => {
    expect(classifySocial("https://www.facebook.com/sharer.php?u=...")).toBeNull();
  });

  it("rejects unknown host", () => {
    expect(classifySocial("https://example.com/foo")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(classifySocial("")).toBeNull();
  });

  it("rejects unparseable URL", () => {
    expect(classifySocial("not a url")).toBeNull();
  });

  it("rejects bare hash anchor", () => {
    expect(classifySocial("#")).toBeNull();
  });
});

describe("extractSocialsFromHtml — JSON-LD sameAs", () => {
  it("collects author + publisher sameAs URLs into per-platform columns", () => {
    const result = extractSocialsFromHtml(fx("article-socials-jsonld.html"));
    expect(result.twitter).toEqual(
      expect.arrayContaining([
        "https://twitter.com/bob",
        "https://twitter.com/examplenewsroom",
      ]),
    );
    expect(result.instagram).toEqual(
      expect.arrayContaining([
        "https://www.instagram.com/byalicefinno/",
        "https://www.instagram.com/examplenewsroom/",
      ]),
    );
    // example.com is not on the allowlist
    expect(result.linkedin).toBeUndefined();
    expect(result.bluesky).toBeUndefined();
  });

  it("handles sameAs as a single string (not array)", () => {
    const result = extractSocialsFromHtml(fx("article-socials-jsonld.html"));
    expect(result.twitter).toContain("https://twitter.com/bob");
  });

  it("collects sameAs from sibling Person and Organization entries in @graph", () => {
    const result = extractSocialsFromHtml(fx("article-socials-graph.html"));
    expect(result.twitter).toEqual(
      expect.arrayContaining([
        "https://twitter.com/authora",
        "https://x.com/pubaccount",
      ]),
    );
    expect(result.instagram).toEqual(["https://www.instagram.com/pubaccount/"]);
    expect(result.linkedin).toEqual(["https://www.linkedin.com/company/pubaccount/"]);
  });
});

describe("extractSocialsFromHtml — byline-area anchor scan", () => {
  it("collects social anchors inside byline regions and drops shares/empties/out-of-area", () => {
    const result = extractSocialsFromHtml(fx("article-socials-byline-anchors.html"));
    expect(result.twitter).toEqual(["https://twitter.com/janedoe"]);
    expect(result.instagram).toEqual(["https://www.instagram.com/janedoe/"]);
    expect(result.linkedin).toEqual(["https://www.linkedin.com/in/janedoe/"]);
    expect(result.bluesky).toEqual(["https://bsky.app/profile/janedoe.bsky.social"]);
  });

  it("does not pick up the in-story twitter.com/elsewhere link", () => {
    const result = extractSocialsFromHtml(fx("article-socials-byline-anchors.html"));
    expect(result.twitter).not.toContain("https://twitter.com/elsewhere");
  });
});

describe("extractSocialsFromHtml — combined sources", () => {
  it("dedupes URLs that appear in both JSON-LD and byline anchors", () => {
    const result = extractSocialsFromHtml(fx("article-socials-mixed.html"));
    // twitter.com/sam appears in sameAs AND in the byline anchor → exactly once
    expect(result.twitter?.filter((u) => u === "https://twitter.com/sam")).toHaveLength(1);
    // Both author and publisher twitter URLs land in the same column
    expect(result.twitter).toEqual(
      expect.arrayContaining(["https://twitter.com/sam", "https://twitter.com/pub"]),
    );
    expect(result.linkedin).toEqual(["https://www.linkedin.com/in/sam/"]);
  });

  it("returns an empty result when only share intents and out-of-area links exist", () => {
    const result = extractSocialsFromHtml(fx("article-socials-none.html"));
    expect(result).toEqual({});
  });
});
