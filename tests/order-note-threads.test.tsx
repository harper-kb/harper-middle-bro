import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderNoteThreads } from "@/app/all-accounts/OrderNoteThreads";

describe("OrderNoteThreads", () => {
  it("renders separate accessible summary cards without exposing note content", () => {
    const html = renderToStaticMarkup(
      <OrderNoteThreads
        accountId="co-906441"
        accountName="ReliableRide Transportation LLC"
        orderId={7535}
        orderLabel="Order #7535"
        canEditProducer={false}
        producerEditHref="https://bigbrother.harperinsure.com/company/906441/transaction?tab=orders"
      />,
    );

    expect(html).toContain('aria-label="Producer Notes summary"');
    expect(html).toContain('aria-label="Service Notes summary"');
    expect(html).toContain(
      'aria-label="View full Producer Notes thread"',
    );
    expect(html).toContain('aria-label="View full Service Notes thread"');
    expect(html.match(/AI Summary/g)).toHaveLength(2);
    expect(html).toContain("Generating AI summary");
    expect(html).not.toContain("ReliableRide Transportation LLC");
  });
});
