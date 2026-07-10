import { describe, expect, it } from "vitest";
import {
  addressesForPinnedConnect,
  classifyPublicAddress,
  extractMappedIpv4,
  isPrivateAddress,
  resolvePublicTarget,
  sortPublicAddresses,
} from "./public-address.js";
import { isPipelineError } from "../errors.js";

describe("extractMappedIpv4", () => {
  it("parses dotted and hex IPv4-mapped forms", () => {
    expect(extractMappedIpv4("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(extractMappedIpv4("::ffff:7f00:1")).toBe("127.0.0.1");
    expect(extractMappedIpv4("::ffff:0a00:1")).toBe("10.0.0.1");
    expect(extractMappedIpv4("2001:db8::1")).toBeNull();
  });
});

describe("classifyPublicAddress / isPrivateAddress", () => {
  const blocked = [
    // IPv4 core
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.5",
    "172.16.3.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.0.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "198.18.0.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    // IPv6
    "::1",
    "::",
    "fe80::1",
    "fe90::1",
    "fea0::1",
    "febf::1",
    "fc00::1",
    "fd00::1",
    "ff02::1",
    "2001:db8::1",
    // mapped
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.1.2.3",
    "not-an-ip",
    "",
  ];

  const allowed = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "2606:2800:220:1:248:1893:25c8:1946",
    "2001:4860:4860::8888",
  ];

  it("blocks every special-use / non-globally-routable example", () => {
    for (const ip of blocked) {
      expect(classifyPublicAddress(ip), ip).toBe("blocked");
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const ip of allowed) {
      expect(classifyPublicAddress(ip), ip).toBe("public");
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("resolvePublicTarget", () => {
  it("rejects non-http schemes and private literals", async () => {
    await expect(resolvePublicTarget("file:///etc/passwd", async () => [])).rejects.toSatisfy(
      isPipelineError,
    );
    await expect(
      resolvePublicTarget("http://127.0.0.1:20128/api", async () => []),
    ).rejects.toSatisfy(isPipelineError);
  });

  it("rejects mixed public+private DNS answers fail-closed", async () => {
    await expect(
      resolvePublicTarget("http://evil.example.com/", async () => ["93.184.216.34", "10.1.2.3"]),
    ).rejects.toSatisfy(isPipelineError);
  });

  it("returns sorted public addresses for a clean public host", async () => {
    const target = await resolvePublicTarget("https://example.com/a", async () => [
      "2606:2800:220:1:248:1893:25c8:1946",
      "93.184.216.34",
    ]);
    expect(target.addresses.map((a) => a.address)).toEqual([
      "93.184.216.34",
      "2606:2800:220:1:248:1893:25c8:1946",
    ]);
    expect(target.url.hostname).toBe("example.com");
  });

  it("pins literal public IP without calling lookup", async () => {
    let looked = false;
    const target = await resolvePublicTarget("http://93.184.216.34/", async () => {
      looked = true;
      return [];
    });
    expect(looked).toBe(false);
    expect(target.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("sortPublicAddresses", () => {
  it("orders family 4 before 6", () => {
    const sorted = sortPublicAddresses([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]);
    expect(sorted[0]!.family).toBe(4);
  });
});

describe("addressesForPinnedConnect", () => {
  it("prefers IPv4 when dual-stack so broken AAAA cannot hang dial", () => {
    const dial = addressesForPinnedConnect([
      { address: "2607:6bc0::10", family: 6 },
      { address: "160.79.104.10", family: 4 },
    ]);
    expect(dial).toEqual([{ address: "160.79.104.10", family: 4 }]);
  });

  it("keeps IPv6 when no IPv4 candidate exists", () => {
    const dial = addressesForPinnedConnect([{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }]);
    expect(dial).toHaveLength(1);
    expect(dial[0]!.family).toBe(6);
  });
});
