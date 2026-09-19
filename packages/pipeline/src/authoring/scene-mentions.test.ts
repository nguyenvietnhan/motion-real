import { describe, expect, it } from "vitest";
import { missingSceneMentions } from "./scene-mentions.js";

describe("missingSceneMentions", () => {
  it("finds canonical scene ids in review notes", () => {
    expect(missingSceneMentions("scene-01 sạch, scene-02 cần sửa contrast.", ["scene-01", "scene-02"])).toEqual([]);
  });

  it("accepts Vietnamese and case variants of scene ids", () => {
    expect(missingSceneMentions("Cảnh 01 ổn. canh 2 xong. CẢNH THỨ 3 cần sửa. scene04 sạch.", [
      "scene-01",
      "scene-02",
      "scene-03",
      "scene-04",
    ])).toEqual([]);
  });

  it("does not confuse scene-01 with scene-11", () => {
    expect(missingSceneMentions("scene-11 sạch.", ["scene-01"])).toEqual(["scene-01"]);
    expect(missingSceneMentions("scene-11 sạch.", ["scene-11"])).toEqual([]);
  });

  it("reports every uncovered scoped scene id", () => {
    expect(missingSceneMentions("Ảnh sạch.", ["scene-01", "scene-02"])).toEqual(["scene-01", "scene-02"]);
  });

  it("returns empty for empty scope and ignores blank notes", () => {
    expect(missingSceneMentions("bất cứ gì", [])).toEqual([]);
    expect(missingSceneMentions("", ["scene-01"])).toEqual(["scene-01"]);
  });
});
