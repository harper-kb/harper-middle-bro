import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/connection";
import { getSpineIssueDetail } from "@/lib/db/queries/service-spine";
import { getSpineIssueTimeline } from "@/lib/service-spine/timeline.server";
import type {
  SpineIssueDetail,
  SpineTimeline,
} from "@/lib/service-spine/domain";
import { getSessionOperator } from "@/lib/session/session";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET-only issue detail for the drawer: head + tasks + connections from the
 * local mirror, plus the on-demand timeline. A timeline failure is a named
 * partial state — the detail still answers, `timeline` is null and
 * `timelineError` carries fixed category copy (never upstream text).
 */
export type SpineIssueApiResponse = SpineIssueDetail & {
  timeline: SpineTimeline | null;
  timelineError: string | null;
};

const TIMELINE_UNAVAILABLE_COPY =
  "The issue timeline is temporarily unavailable.";

function positiveInteger(value: string | undefined): number | null {
  const raw = value?.trim() ?? "";
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const operator = await getSessionOperator();
  if (!operator) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const { id } = await params;
  const issueId = positiveInteger(id);
  if (!issueId) {
    return NextResponse.json(
      { error: "A valid issue id is required." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const detail = getSpineIssueDetail(getDb(), issueId);
    if (!detail) {
      return NextResponse.json(
        { error: "Issue not found in the spine mirror." },
        { status: 404, headers: NO_STORE },
      );
    }

    let timeline: SpineTimeline | null = null;
    let timelineError: string | null = null;
    try {
      timeline = await getSpineIssueTimeline(issueId);
    } catch {
      timelineError = TIMELINE_UNAVAILABLE_COPY;
    }

    const response: SpineIssueApiResponse = {
      ...detail,
      timeline,
      timelineError,
    };
    return NextResponse.json(response, { headers: NO_STORE });
  } catch (cause) {
    console.warn("service_spine_issue_api_failed", {
      errorCategory:
        cause instanceof Error ? cause.message : "unknown_spine_issue_error",
    });
    return NextResponse.json(
      { error: "Issue detail is temporarily unavailable." },
      { status: 503, headers: NO_STORE },
    );
  }
}
