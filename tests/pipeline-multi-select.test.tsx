// @vitest-environment jsdom

import fs from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineMultiSelect } from "@/app/all-accounts/PipelineMultiSelect";

afterEach(cleanup);

describe("PipelineMultiSelect focus layer", () => {
  it("raises IQ Stage above the shared blurred backdrop and dismisses cleanly", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <span id="stage-label">IQ Stage</span>
        <PipelineMultiSelect
          options={[
            { id: "quoted", label: "Quoted" },
            { id: "bind", label: "Bind requested" },
          ]}
          selected={[]}
          onChange={onChange}
          labelledBy="stage-label"
          accent="iq"
          noun="stage"
        />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "IQ Stage" });
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "IQ Stage" })).toBeTruthy();
    expect(
      trigger
        .closest(".pipeline-select")
        ?.classList.contains("records-filter-control--open"),
    ).toBe(true);

    const backdrop = document.querySelector<HTMLElement>(
      "[data-records-filter-backdrop]",
    )!;
    expect(backdrop).toBeTruthy();
    fireEvent.pointerDown(backdrop);
    expect(screen.queryByRole("listbox", { name: "IQ Stage" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("places the sharp control above a reduced-motion/transparency-aware blur", () => {
    const css = fs.readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--z-records-filter-backdrop: 55");
    expect(css).toContain("--z-records-filter-control: 60");
    expect(css).toMatch(
      /\.records-filter-focus-backdrop\s*\{[\s\S]*?backdrop-filter:\s*blur\(3px\)/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.records-filter-focus-backdrop[\s\S]*?backdrop-filter:\s*none/,
    );
  });
});
