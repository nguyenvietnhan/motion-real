import { describe, expect, it } from "vitest";
import { PRESENTATION_PROFILE_VALUES, type PresentationProfile } from "./content-plan.js";
import {
  AUTHORING_CONTRACT,
  TECHNICAL_AUTHORING_CONTRACT,
  authoringContract,
} from "./contract-text.js";
import {
  PROFILE_ARCHETYPES,
  authoringContractForProfile,
  presentationProfileDirection,
  profileArchetypeDirection,
} from "./presentation-profiles.js";

describe("presentation profile directions", () => {
  it("returns the legacy aggregate contract only when an old plan has no profile", () => {
    expect(authoringContractForProfile(undefined)).toBe(AUTHORING_CONTRACT);
  });

  it.each(PRESENTATION_PROFILE_VALUES)("isolates the %s creative direction", (profile) => {
    const direction = presentationProfileDirection(profile);
    const contract = authoringContractForProfile(profile);

    expect(direction).toContain(`PRESENTATION PROFILE: ${profile}`);
    expect(contract).toContain(TECHNICAL_AUTHORING_CONTRACT);
    expect(contract).toContain(direction);
    expect(contract).not.toContain("Bản đồ nội dung → hình thức");

    for (const other of PRESENTATION_PROFILE_VALUES) {
      if (other !== profile) expect(contract).not.toContain(`PRESENTATION PROFILE: ${other}`);
    }
  });

  it("keeps each profile focused on a distinct viewer outcome", () => {
    const expected: Record<PresentationProfile, RegExp> = {
      "editorial-story": /what happened|đã xảy ra/i,
      "mechanism-explainer": /how.*works|hoạt động/i,
      "evidence-explainer": /evidence|bằng chứng/i,
      "procedural-guide": /ordered task|thực hiện/i,
      "comparison-decision": /choose|lựa chọn/i,
      "narrative-conceptual": /evolved|ý nghĩa/i,
      "product-showcase": /actually does|thực sự làm được/i,
    };
    for (const profile of PRESENTATION_PROFILE_VALUES) {
      expect(presentationProfileDirection(profile)).toMatch(expected[profile]);
    }
  });

  it("makes mechanism scenes simulate domain primitives instead of summarizing attributes", () => {
    const direction = presentationProfileDirection("mechanism-explainer");

    expect(direction).toMatch(/initial state.*action\/decision.*resulting state/i);
    expect(direction).toMatch(/domain primitives/i);
    expect(direction).toMatch(/simulate.*state transition/i);
    expect(direction).toMatch(/nodes.*edges.*path traversal/i);
    expect(direction).toMatch(/feature grid.*pros\/cons/i);
  });

  it("treats the selected profile as dominant grammar rather than one repeated layout", () => {
    const direction = presentationProfileDirection("comparison-decision");

    expect(direction).toMatch(/CHỦ ĐẠO/);
    expect(direction).toMatch(/không phải một layout áp cho mọi cảnh/i);
    expect(direction).toMatch(/cùng visual field.*cùng hệ quy chiếu/i);
  });

  it("makes editorial scenes carry the story with evidence objects instead of card stacks", () => {
    const direction = presentationProfileDirection("editorial-story");

    expect(direction).toMatch(/one dominant evidence object/i);
    expect(direction).toMatch(/photo.*map.*timeline.*chart/i);
    expect(direction).toMatch(/card carousel/i);
    expect(direction).toMatch(/headline.*label/i);
  });

  it("includes geometric archetypes and palette tokens in contract for profile", () => {
    const contract = authoringContractForProfile("mechanism-explainer", "#10B981");
    expect(contract).toContain("Pipeline Dataflow");
    expect(contract).toContain("State Machine Transition");
    expect(contract).toContain("Architecture Stack");
    expect(contract).toContain('ACCENT_PRIMARY: "#10B981"');
    expect(contract).toContain('stroke="#10B981"');
    expect(contract).not.toContain('stroke="#38BDF8"');
    expect(contract).toMatch(/LUẬT CHỐNG LẶP & CHỐNG CARD TRAP/);
  });

  it("includes extensibility clause in technical contract for any profile", () => {
    const contract = authoringContractForProfile("editorial-story", "#38BDF8");
    expect(contract).toMatch(/ĐIỀU KHOẢN MỞ RỘNG BỐ CỤC/);
    expect(contract).toMatch(/hai cột đối chiếu, đồng hồ đo số liệu, đường nối SVG/);
  });

  it("returns fallback contract with generic 4 archetypes when profile is undefined", () => {
    const fallback = authoringContractForProfile(undefined, "#10B981");
    expect(fallback).toContain("Pipeline Dataflow");
    expect(fallback).toContain("Dual Split-Core");
    expect(fallback).toContain("Metric Gauge");
    expect(fallback).toContain("Architecture Stack");
    expect(fallback).toContain('ACCENT_PRIMARY: "#10B981"');
  });

  it("returns fallback contract when profile is an unknown or invalid string", () => {
    const fallback = authoringContractForProfile("non-existent-profile" as any, "#10B981");
    expect(fallback).toBe(authoringContract("#10B981"));
    expect(fallback).toContain("Pipeline Dataflow");
    expect(fallback).toContain("Dual Split-Core");
    expect(fallback).toContain("Metric Gauge");
    expect(fallback).toContain("Architecture Stack");
  });

  it("defaults dominantColor to #38BDF8 when omitted in profileArchetypeDirection", () => {
    const mixin = profileArchetypeDirection("editorial-story");
    expect(mixin).toContain("#38BDF8");
    expect(mixin).toContain("Timeline Spine");
  });

  const DOMAIN_ARCHETYPE_MAP: Record<PresentationProfile, string[]> = {
    "mechanism-explainer": ["Pipeline Dataflow", "State Machine Transition", "Architecture Stack"],
    "comparison-decision": ["Dual Split-Core", "Comparison Matrix Shelf"],
    "evidence-explainer": ["Metric Gauge", "Data Trend Arc / Bar Delta", "Sourced Document Excerpt"],
    "editorial-story": ["Timeline Spine", "Photo/Map Focal Anchor", "Event Headline Banner"],
    "procedural-guide": ["Terminal Command Flow", "Step-by-Step Action Shelf"],
    "product-showcase": ["Spotlight App Window Frame", "Feature Callout Magnifier"],
    "narrative-conceptual": ["Metaphor Metamorphosis", "Concept Tension Balance"],
  };

  it.each(PRESENTATION_PROFILE_VALUES)(
    "verifies profile %s outputs its designated domain archetypes and interpolates dominantColor",
    (profile) => {
      const customDominant = "#EC4899";
      const expectedArchetypes = DOMAIN_ARCHETYPE_MAP[profile];

      // Check profileArchetypeDirection directly
      const mixin = profileArchetypeDirection(profile, customDominant);
      for (const archetype of expectedArchetypes) {
        expect(mixin).toContain(archetype);
      }
      expect(mixin).toContain(customDominant);
      expect(mixin).not.toContain("#38BDF8");
      expect(mixin).toMatch(/LUẬT CHỐNG LẶP & CHỐNG CARD TRAP/);

      // Check assembled authoringContractForProfile
      const contract = authoringContractForProfile(profile, customDominant);
      for (const archetype of expectedArchetypes) {
        expect(contract).toContain(archetype);
      }
      expect(contract).toContain(`ACCENT_PRIMARY: "${customDominant}"`);
      expect(contract).toContain(presentationProfileDirection(profile));
      expect(contract).toContain("ĐIỀU KHOẢN MỞ RỘNG BỐ CỤC");

      // Check PROFILE_ARCHETYPES map directly
      const rawRecipe = PROFILE_ARCHETYPES[profile](customDominant);
      for (const archetype of expectedArchetypes) {
        expect(rawRecipe).toContain(archetype);
      }
      expect(rawRecipe).toContain(customDominant);
    },
  );
});
