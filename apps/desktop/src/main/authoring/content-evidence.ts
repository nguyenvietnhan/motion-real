/**
 * Bounded source/evidence helpers for content-plan provenance (main process).
 * Research body is transient — never written into evidence.json.
 */

export type ArticleMetadataLike = {
  sourceUrl: string;
  title?: string;
  site?: string;
  author?: string;
  publishedDate?: string;
  fetchedAt?: string;
};

export type ResearchSource = {
  id: string;
  metadata: ArticleMetadataLike;
  /** Transient body for excerpt validation only — never persist. */
  body: string;
};

export type SourceReference = { sourceId: string; excerpt: string };

export type ProjectEvidence = {
  version: 1;
  sources: Array<{
    id: string;
    sourceUrl: string;
    title: string;
    site?: string;
    author?: string;
    publishedDate?: string;
    fetchedAt: string;
  }>;
  claims: Array<{
    id: string;
    text: string;
    support: "user_brief" | "source_material" | "common_knowledge";
    sourceRef?: SourceReference;
  }>;
  scenes: Array<{ sceneId: string; evidenceClaimIds: string[] }>;
};

const EXCERPT_MIN = 20;
const EXCERPT_MAX = 320;

export function normalizedEvidenceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function excerptMatchesSource(excerpt: string, sourceBody: string): boolean {
  const ex = normalizedEvidenceText(excerpt);
  if (ex.length < EXCERPT_MIN || ex.length > EXCERPT_MAX) return false;
  const body = normalizedEvidenceText(sourceBody);
  return body.includes(ex);
}

export function isValidSourceId(id: string): boolean {
  return /^source-\d{2}$/.test(id);
}

export function isValidExcerpt(excerpt: string): boolean {
  const t = excerpt.trim();
  return t.length >= EXCERPT_MIN && t.length <= EXCERPT_MAX;
}

/** Build ResearchSource list in URL input order with stable sequential ids. */
export function researchSourcesFromIngest(
  items: Array<{ metadata: ArticleMetadataLike; body: string }>,
): ResearchSource[] {
  return items.map((item, index) => ({
    id: `source-${String(index + 1).padStart(2, "0")}`,
    metadata: {
      sourceUrl: item.metadata.sourceUrl,
      ...(item.metadata.title ? { title: item.metadata.title } : {}),
      ...(item.metadata.site ? { site: item.metadata.site } : {}),
      ...(item.metadata.author ? { author: item.metadata.author } : {}),
      ...(item.metadata.publishedDate ? { publishedDate: item.metadata.publishedDate } : {}),
      ...(item.metadata.fetchedAt ? { fetchedAt: item.metadata.fetchedAt } : {}),
    },
    body: item.body,
  }));
}

export function buildProjectEvidence(input: {
  sources: ResearchSource[];
  claims: Array<{
    id: string;
    text: string;
    support: "user_brief" | "source_material" | "common_knowledge";
    sourceRef?: SourceReference;
  }>;
  scenes: Array<{ sceneId: string; evidenceClaimIds: string[] }>;
  now?: string;
}): ProjectEvidence {
  const now = input.now ?? new Date().toISOString();
  return {
    version: 1,
    sources: input.sources.map((s) => ({
      id: s.id,
      sourceUrl: s.metadata.sourceUrl,
      title: s.metadata.title?.trim() || s.metadata.sourceUrl,
      ...(s.metadata.site ? { site: s.metadata.site } : {}),
      ...(s.metadata.author ? { author: s.metadata.author } : {}),
      ...(s.metadata.publishedDate ? { publishedDate: s.metadata.publishedDate } : {}),
      fetchedAt: s.metadata.fetchedAt ?? now,
    })),
    claims: input.claims.map((c) => ({
      id: c.id,
      text: c.text,
      support: c.support,
      ...(c.support === "source_material" && c.sourceRef
        ? {
            sourceRef: {
              sourceId: c.sourceRef.sourceId,
              excerpt: c.sourceRef.excerpt.trim().slice(0, EXCERPT_MAX),
            },
          }
        : {}),
    })),
    scenes: input.scenes.map((s) => ({
      sceneId: s.sceneId,
      evidenceClaimIds: [...s.evidenceClaimIds],
    })),
  };
}
