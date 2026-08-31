import type { ContentPlan } from "../content-plan.js";

export const JSON_ONLY_AUTHOR_REPLY = [
  "```json",
  JSON.stringify(
    {
      title: "Fable safeguards incident fixture",
      theme: { dominant: "#191B1F" },
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

export const AUTHORING_RELIABILITY_REGRESSION_FIXTURE = {
  capturedAt: "2026-07-06",
  classification: "prompt/pipeline fragility, not provider-only failure",
  failures: [
    {
      kind: "content-plan-invalid-purpose",
      detail: "Non-hook scene purpose used values outside the content-plan enum.",
      invalidPurposeValues: ["definition", "example", "mechanism"],
    },
    {
      kind: "admission-invalid-interpolate-range",
      detail: "N5 rejected a literal non-increasing Remotion interpolate inputRange.",
      inputRange: [0, -18],
    },
    {
      kind: "batched-author-reply-incomplete",
      detail: "A four-scene TSX batch returned only the first requested component.",
      expectedComponentIds: ["scene-05", "scene-06", "scene-07", "scene-08"],
      returnedComponentIds: ["scene-05"],
    },
  ],
} as const;

export const INVALID_PURPOSE_CONTENT_PLAN_REPLY = JSON.stringify({
  title: "Random Forest không phải một cây",
  viewerPromise: "Người xem hiểu vì sao nhiều cây bỏ phiếu ổn định hơn một cây.",
  hookType: "contradiction",
  first3SecondsLine: "Một cây quyết định dễ học vẹt. Cả rừng thì khó lệch hơn.",
  openLoop: "Sức mạnh không nằm ở từng cây, mà ở cách chúng bất đồng với nhau.",
  payoff: "Random Forest làm mượt sai lệch bằng nhiều quyết định độc lập rồi lấy đa số.",
  claims: [],
  scenes: [
    {
      sceneId: "scene-01",
      purpose: "hook",
      beat: "Open with the forest metaphor.",
      narration:
        "Một cây quyết định dễ học vẹt. Cả rừng thì khó lệch hơn. Người xem thấy ngay sự khác biệt giữa một quyết định đơn lẻ và một tập hợp ý kiến độc lập. Hình ảnh rừng yên ổn đối lập với một cây lung lay giúp mở vòng lặp giải thích.",
      onScreenText: "Một cây vs cả rừng",
      visualMetaphor: "One shaky tree next to a calm forest.",
      motionProgression: "Quick entrance: one tree appears, then the forest fills in behind it; final hold on the contrast.",
      layoutFamily: "signature-visual",
      evidenceClaimIds: [],
    },
    {
      sceneId: "scene-02",
      purpose: "definition",
      beat: "Define the vote.",
      narration:
        "Mỗi cây nhìn dữ liệu hơi khác nhau, rồi cả rừng bỏ phiếu. Đó không phải phép màu, mà là cách gom nhiều góc nhìn yếu thành một quyết định ổn định hơn. Người xem theo dõi từng lá phiếu nhỏ góp thành đa số.",
      onScreenText: "Nhiều góc nhìn",
      visualMetaphor: "Small trees casting ballots.",
      motionProgression: "Text appears.",
      layoutFamily: "diagram",
      evidenceClaimIds: [],
    },
    {
      sceneId: "scene-03",
      purpose: "mechanism",
      beat: "Show the mechanism.",
      narration:
        "Khi một cây đoán lệch, các cây còn lại kéo kết quả về hướng ổn định hơn. Random Forest làm mượt sai lệch bằng nhiều quyết định độc lập rồi lấy đa số, nên một lỗi đơn lẻ không làm cả câu trả lời sụp đổ.",
      onScreenText: "Đa số làm mượt",
      visualMetaphor: "Votes collecting into one calmer answer.",
      layoutFamily: "timeline",
      evidenceClaimIds: [],
    },
  ],
});

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
