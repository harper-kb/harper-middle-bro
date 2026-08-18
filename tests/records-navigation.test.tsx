// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
}));

import { BackToAccounts } from "@/app/accounts/[id]/BackToAccounts";
import {
  accountDetailHref,
  parseRecordsReturnHref,
  recordsNavigationHrefs,
  recordsListHref,
  recordsViewHref,
} from "@/app/all-accounts/records-navigation";
import { getAccountOrdersView } from "@/app/all-accounts/view-config";

afterEach(() => {
  cleanup();
  navigation.replace.mockReset();
});

const FILTERS = {
  source: "iq",
  iqStage: "bind_requested,awaiting_binder",
  range: "this-week",
  carrier: "hiscox ins co",
  state: "CA,NY",
  sort: "revenue-desc,newest",
  q: "roofing",
  page: "4",
};

describe("durable Records navigation", () => {
  it("carries compatible filters between Records views and resets only page", () => {
    expect(
      recordsViewHref(getAccountOrdersView("pending"), FILTERS),
    ).toBe(
      "/pending-orders?source=iq&iqStage=bind_requested%2Cawaiting_binder&range=this-week&carrier=hiscox+ins+co&state=CA%2CNY&sort=revenue-desc%2Cnewest&q=roofing",
    );
  });

  it("drops only filters the destination cannot apply", () => {
    expect(recordsViewHref(getAccountOrdersView("lost"), FILTERS)).toBe(
      "/lost-orders?source=iq&carrier=hiscox+ins+co&state=CA%2CNY&sort=revenue-desc%2Cnewest&q=roofing",
    );
  });

  it("captures the exact current list, including its page", () => {
    expect(recordsListHref("/pending-orders", FILTERS)).toBe(
      "/pending-orders?source=iq&iqStage=bind_requested%2Cawaiting_binder&range=this-week&carrier=hiscox+ins+co&state=CA%2CNY&sort=revenue-desc%2Cnewest&q=roofing&page=4",
    );
  });

  it("round-trips that list through an account detail link", () => {
    const recordsHref = recordsListHref("/pending-orders", FILTERS);
    const detailHref = accountDetailHref("co-927875", recordsHref);
    const detailUrl = new URL(detailHref, "https://step-bro.invalid");

    expect(detailUrl.pathname).toBe("/accounts/co-927875");
    expect(
      parseRecordsReturnHref(detailUrl.searchParams.get("recordsReturn")),
    ).toBe(recordsHref);
  });

  it("rejects external, malformed, and non-Records return destinations", () => {
    for (const value of [
      "https://example.com/pending-orders?source=iq",
      "//example.com/pending-orders",
      "/accounts/co-1?source=iq",
      "/pending-orders#unexpected",
      "/\\example.com/pending-orders",
      "javascript:alert(1)",
      ["/pending-orders"],
      null,
    ]) {
      expect(parseRecordsReturnHref(value)).toBeNull();
    }
  });

  it("canonicalizes a trusted Records return and drops only invalid fields", () => {
    expect(
      parseRecordsReturnHref(
        "/pending-orders?page=3&source=iq&iqStage=unknown,bind_requested&range=all-time&q=acme",
      ),
    ).toBe(
      "/pending-orders?source=iq&iqStage=bind_requested&q=acme&page=3",
    );
  });

  it("gives the company sidebar compatible per-view destinations", () => {
    expect(
      recordsNavigationHrefs(
        "/pending-orders?source=iq&iqStage=bind_requested&range=this-week&carrier=hiscox+ins+co&page=4",
      ),
    ).toEqual({
      all: "/all-accounts?source=iq&iqStage=bind_requested&carrier=hiscox+ins+co",
      pending:
        "/pending-orders?source=iq&iqStage=bind_requested&range=this-week&carrier=hiscox+ins+co",
      bound:
        "/bound-orders?source=iq&range=this-week&carrier=hiscox+ins+co",
      lost: "/lost-orders?source=iq&carrier=hiscox+ins+co",
    });
  });
});

describe("Back to Accounts", () => {
  it("restores the explicit filtered list without consulting referrer", () => {
    const returnHref = "/pending-orders?source=broker&brokerGate=G4&page=3";
    render(<BackToAccounts returnHref={returnHref} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to Accounts" }));

    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(returnHref, {
      scroll: false,
    });
  });

  it("uses All Accounts only when no valid Records context exists", () => {
    render(<BackToAccounts returnHref={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to Accounts" }));

    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith(
      "/all-accounts",
      { scroll: false },
    );
  });
});
