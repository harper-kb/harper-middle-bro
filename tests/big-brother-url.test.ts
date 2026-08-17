import { describe, expect, it } from "vitest";
import {
  BIG_BROTHER_ORIGIN,
  bigBrotherCompanyId,
  bigBrotherCompanyOrdersUrl,
  isBigBrotherUrl,
} from "@/lib/big-brother";

/**
 * Read-only verified against the live Harper database: every id below is a
 * real `public.companies.id`, which is the key Big Brother routes on (checked
 * against `midfunnel_tasks.bigbrother_url`).
 */
const VERIFIED = [
  { companyId: "900319", name: "Apocalipsis Nocturnal" },
  { companyId: "15777", name: "4 Caps Corpo Inc." },
  { companyId: "16286", name: "Barsha Inc" },
  { companyId: "927775", name: "Daniel Ochoa DBA 8A Services" },
];

describe("Big Brother company id resolution", () => {
  it("reads the route key out of the co-{companies.id} account id", () => {
    for (const { companyId } of VERIFIED) {
      expect(bigBrotherCompanyId(`co-${companyId}`)).toBe(companyId);
    }
  });

  it("rejects account ids that are not the co-{companies.id} shape", () => {
    for (const value of [
      "",
      "co-",
      "co-0",
      "co-007",
      "co--1",
      "co-12.5",
      "co-1e5",
      "co-12 34",
      "co-abc",
      "acct-h-16286",
      "order-13070",
      "16286",
      "co-16286/extra",
      "co-16286?tab=orders",
      null,
      undefined,
    ]) {
      expect(bigBrotherCompanyId(value as string)).toBeNull();
    }
  });

  it("keeps the Step Bro order id out of the company route", () => {
    // Order #13070 belongs to company 900319 — the two are different numbers
    // in different namespaces, and only the company id may reach the URL.
    const orderId = 13070;
    const companyId = bigBrotherCompanyId("co-900319");
    expect(companyId).toBe("900319");
    expect(companyId).not.toBe(String(orderId));
    expect(bigBrotherCompanyOrdersUrl(companyId)).not.toContain(
      String(orderId),
    );
  });
});

describe("Big Brother orders URL", () => {
  it("builds the exact approved path for verified company ids", () => {
    for (const { companyId } of VERIFIED) {
      expect(bigBrotherCompanyOrdersUrl(companyId)).toBe(
        `https://bigbrother.harperinsure.com/company/${companyId}/transaction?tab=orders`,
      );
    }
  });

  it("pins the trusted origin, path shape and fixed tab", () => {
    const url = new URL(bigBrotherCompanyOrdersUrl(900319) as string);
    expect(url.origin).toBe(BIG_BROTHER_ORIGIN);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("bigbrother.harperinsure.com");
    expect(url.pathname).toBe("/company/900319/transaction");
    expect(url.searchParams.get("tab")).toBe("orders");
    expect([...url.searchParams.keys()]).toEqual(["tab"]);
  });

  it("accepts a safe numeric id and refuses an unsafe one", () => {
    expect(bigBrotherCompanyOrdersUrl(15777)).toContain("/company/15777/");
    for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(bigBrotherCompanyOrdersUrl(value)).toBeNull();
    }
  });

  it("never builds a link from a missing, null or malformed id", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      "0",
      "-5",
      "12.5",
      "abc",
      "900319abc",
      "900 319",
      "９００３１９",
    ]) {
      expect(bigBrotherCompanyOrdersUrl(value as string)).toBeNull();
    }
    // Surrounding whitespace is trimmed; the id itself is still exact.
    expect(bigBrotherCompanyOrdersUrl(" 900319 ")).toBe(
      "https://bigbrother.harperinsure.com/company/900319/transaction?tab=orders",
    );
  });

  it("refuses injected paths, hosts and dangerous schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "900319/../../evil",
      "//evil.example.com",
      "https://evil.example.com/company/1",
      "900319?tab=admin",
      "900319#/admin",
      "900319/transaction?tab=orders",
    ]) {
      expect(bigBrotherCompanyOrdersUrl(value)).toBeNull();
    }
  });

  it("only trusts the exact Big Brother origin", () => {
    expect(
      isBigBrotherUrl(
        "https://bigbrother.harperinsure.com/company/1/transaction?tab=orders",
      ),
    ).toBe(true);
    for (const value of [
      "http://bigbrother.harperinsure.com/company/1",
      "https://bigbrother.harperinsure.com.evil.test/company/1",
      "https://evil.test/company/1",
      "https://harperinsure.com/company/1",
      "//bigbrother.harperinsure.com/company/1",
      "javascript:alert(1)",
      "/company/1/transaction?tab=orders",
      "",
    ]) {
      expect(isBigBrotherUrl(value)).toBe(false);
    }
  });
});
