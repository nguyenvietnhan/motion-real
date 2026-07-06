import type { ContentPlan } from "../content-plan.js";

export const JSON_ONLY_AUTHOR_REPLY = [
  "```json",
  JSON.stringify(
    {
      title: "Fable safeguards incident fixture",
      theme: { dominant: "#191B1F", mood: "cyber safety" },
      scenes: [
        {
          component: "scene-01",
          eyebrow: "CYBER",
          headline: "Safeguards need a severity lens",
          narration: "A cyber safety framework needs clear categories before the visuals are authored.",
          props: {},
          transitionToNext: "fade",
        },
        {
          component: "scene-02",
          eyebrow: "CLASSIFIERS",
          headline: "Four use buckets",
          narration: "The story separates prohibited use, high-risk dual use, low-risk dual use, and benign work.",
          props: {},
          transitionToNext: "fade",
        },
        {
          component: "scene-03",
          eyebrow: "JAILBREAKS",
          headline: "Severity becomes visible",
          narration: "A compact rubric lets the video explain why some jailbreaks matter more than others.",
          props: {},
        },
      ],
    },
    null,
    2,
  ),
  "```",
].join("\n");

export const CLAIM_LEDGER_MISSING_EVIDENCE_PLAN: ContentPlan = {
  title: "Why the incident needs a ledger",
  viewerPromise: "The viewer sees why concrete measurements need evidence before authoring.",
  hookType: "number",
  first3SecondsLine: "A single unsupported number can make a script unsafe.",
  openLoop: "The plan looks polished, but one fact has no usable claim id.",
  payoff: "The repair should fix the evidence link or remove the fact, not weaken the gate.",
  claims: [
    {
      id: "claim-01",
      text: "An unverified lab note mentioned a 500-cycle prototype.",
      support: "source_material",
      confidence: "uncertain",
      action: "omit",
    },
  ],
  scenes: [
    {
      sceneId: "scene-01",
      purpose: "hook",
      beat: "Expose the unsupported measurement.",
      narration: "The prototype reached 500 cycles in 2026, according to a lab note that is not usable evidence.",
      onScreenText: "500 cycles?",
      visualMetaphor: "A bright number with an empty evidence slot below it.",
      motionProgression: "Quick entrance: the number snaps in; semantic: the evidence slot stays empty; final hold on the missing link.",
      layoutFamily: "big-number",
      evidenceClaimIds: [],
    },
    {
      sceneId: "scene-02",
      purpose: "context",
      beat: "Explain the safety rule.",
      narration: "Facts can stay only when the plan points at supported evidence marked for use.",
      onScreenText: "Supported + use",
      visualMetaphor: "A claim card passing through a narrow gate.",
      motionProgression: "Quick entrance: the gate appears; semantic: unsupported cards slide aside; final hold on the accepted path.",
      layoutFamily: "diagram",
      evidenceClaimIds: [],
    },
    {
      sceneId: "scene-03",
      purpose: "payoff",
      beat: "Resolve with a safe repair.",
      narration: "A targeted repair should either attach a usable claim or rewrite the scene without the measurement.",
      onScreenText: "Repair the fact, not the gate",
      visualMetaphor: "The empty slot turns into a rewrite pencil.",
      motionProgression: "Quick entrance: a pencil draws over the unsupported number; final hold on the safer version.",
      layoutFamily: "statement",
      evidenceClaimIds: [],
    },
  ],
};

export const ANTHROPIC_FABLE_SAFEGUARDS_SNAPSHOT = [
  "---",
  "source_url: https://www.anthropic.com/news/fable-safeguards-jailbreak-framework",
  "title: More details on Fable 5's cyber safeguards and our jailbreak framework",
  "published: 2026-07-02",
  "site: Anthropic",
  "---",
  "",
  "Snapshot summary:",
  "- Claude Fable 5 was redeployed globally, and Anthropic described cyber safety classifiers plus a draft cyber jailbreak severity framework.",
  "- The classifier categories separate prohibited use, high-risk dual use, low-risk dual use, and benign use.",
  "- The proposed Cyber Jailbreak Severity (CJS) rubric considers capability gain, breadth, ease of weaponization, and discoverability.",
].join("\n");
