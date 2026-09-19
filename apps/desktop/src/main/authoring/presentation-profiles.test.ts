import { describe, expect, it } from "vitest";
import { PRESENTATION_PROFILE_VALUES, type PresentationProfile } from "./content-plan.js";
import { AUTHORING_CONTRACT, TECHNICAL_AUTHORING_CONTRACT } from "./contract-text.js";
import {
  authoringContractForProfile,
  presentationProfileDirection,
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
    expect(contract).toContain("Dual Split-Core");
    expect(contract).toContain("Metric Gauge");
    expect(contract).toContain("Architecture Stack");
    expect(contract).toContain('ACCENT_PRIMARY: "#10B981"');
    expect(contract).toContain('stroke="#10B981"');
    expect(contract).not.toContain('stroke="#38BDF8"');
    expect(contract).toMatch(/LUẬT CHỐNG LẶP & CHỐNG CARD TRAP/);
  });
});
