import { describe, it, expect } from "vitest";
import { readVietnameseInteger, normalizeVietnameseNumbers } from "./vi-number.js";

describe("readVietnameseInteger", () => {
  it("reads small numbers with Vietnamese tens rules (mười/mươi/mốt/lăm)", () => {
    expect(readVietnameseInteger(0)).toBe("không");
    expect(readVietnameseInteger(5)).toBe("năm");
    expect(readVietnameseInteger(11)).toBe("mười một");
    expect(readVietnameseInteger(15)).toBe("mười lăm");
    expect(readVietnameseInteger(21)).toBe("hai mươi mốt");
    expect(readVietnameseInteger(25)).toBe("hai mươi lăm");
    expect(readVietnameseInteger(105)).toBe("một trăm lẻ năm");
    expect(readVietnameseInteger(190)).toBe("một trăm chín mươi");
  });

  it("reads YEARS as natural cardinals, not English digit-pairs", () => {
    // The whole point of hướng B: 2026 must NOT be "hai mươi hai sáu".
    expect(readVietnameseInteger(2026)).toBe("hai nghìn không trăm hai mươi sáu");
    expect(readVietnameseInteger(2029)).toBe("hai nghìn không trăm hai mươi chín");
    expect(readVietnameseInteger(2019)).toBe("hai nghìn không trăm mười chín");
    expect(readVietnameseInteger(2005)).toBe("hai nghìn không trăm lẻ năm");
  });

  it("reads thousands / millions / billions", () => {
    expect(readVietnameseInteger(110000)).toBe("một trăm mười nghìn");
    expect(readVietnameseInteger(920)).toBe("chín trăm hai mươi");
    expect(readVietnameseInteger(30)).toBe("ba mươi");
    expect(readVietnameseInteger(1000000)).toBe("một triệu");
    expect(readVietnameseInteger(1500000000)).toBe("một tỷ năm trăm triệu");
  });
});

describe("normalizeVietnameseNumbers", () => {
  it("voices a year inside a sentence the natural way", () => {
    expect(normalizeVietnameseNumbers("ký vào năm 2026")).toBe("ký vào năm hai nghìn không trăm hai mươi sáu");
  });

  it("handles percentages and grouped thousands", () => {
    expect(normalizeVietnameseNumbers("tăng 92% trong quý")).toBe("tăng chín mươi hai phần trăm trong quý");
    expect(normalizeVietnameseNumbers("khoảng 110.000 GPU")).toBe("khoảng một trăm mười nghìn GPU");
  });

  it("keeps the Vietnamese scale word and only voices the digits", () => {
    expect(normalizeVietnameseNumbers("920 triệu USD")).toBe("chín trăm hai mươi triệu USD");
    expect(normalizeVietnameseNumbers("vượt 30 tỷ đô la")).toBe("vượt ba mươi tỷ đô la");
  });

  it("reads decimals digit-by-digit after 'phẩy'", () => {
    expect(normalizeVietnameseNumbers("1,25 tỷ")).toBe("một phẩy hai năm tỷ");
  });

  it("leaves numbers fused to letters alone (model/brand names)", () => {
    expect(normalizeVietnameseNumbers("chip B200 và H100")).toBe("chip B200 và H100");
    expect(normalizeVietnameseNumbers("mạng 5G")).toBe("mạng 5G");
  });

  it("voices a 'ngày X tháng Y năm Z' date written with digits", () => {
    expect(normalizeVietnameseNumbers("ngày 5 tháng 6 năm 2026")).toBe(
      "ngày năm tháng sáu năm hai nghìn không trăm hai mươi sáu",
    );
  });
});
