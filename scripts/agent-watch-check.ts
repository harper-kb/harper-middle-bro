/**
 * Agent Watch deterministic self-check — run with: npx tsx scripts/agent-watch-check.ts
 *
 * No db. Two synthetic corpora: a clean desk where every rule stays quiet,
 * and a dirty desk where every rule fires on a crafted violation. Also
 * asserts finding order (critical → warn → info) and that every finding
 * carries at least one citation. Exit 1 on any failure.
 */

import {
  AUTO_SEND_STORM_THRESHOLD,
  runAgentWatch,
  SEVERITY_ORDER,
  WATCH_RULES,
  type WatchCorpus,
  type WatchDecision,
  type WatchIntakeEvent,
  type WatchRuleId,
  type WatchTicket,
} from "../src/lib/agent-watch";
import { verbatimExcerpt } from "../src/lib/service-ack";

const AS_OF = "2026-08-07T12:00:00.000Z";

// ——— Fixture builders ———

function ticket(overrides?: Partial<WatchTicket>): WatchTicket {
  return {
    id: "tkt-clean",
    srNumber: "SR-90001",
    status: "ready_to_issue",
    requestType: "additional_insured",
    fastPathBasis: null,
    namedOnPolicyRequired: false,
    escalatedAt: null,
    escalationDueBy: null,
    escalationResolvedAt: null,
    createdAt: "2026-08-07T09:00:00.000Z",
    closedAt: null,
    policies: [{ id: "pol-1", policyNumber: "COT-BOP-1", carrier: "Coterie" }],
    ...overrides,
  };
}

function intake(overrides?: Partial<WatchIntakeEvent>): WatchIntakeEvent {
  const body = "Please add Willow Creek HOA as additional insured on our BOP.";
  return {
    id: "evt-clean",
    channel: "email",
    fromName: "Dana Ruiz",
    receivedAt: "2026-08-07T08:00:00.000Z",
    status: "ticketed",
    body,
    ticketId: "tkt-clean",
    ackSentAt: "2026-08-07T08:01:00.000Z",
    ackBody: `We received your email — here is your request exactly as it reached us:\n> ${verbatimExcerpt(body)}\nWe opened service request SR-90001.`,
    callMissed: null,
    ...overrides,
  };
}

function decision(overrides?: Partial<WatchDecision>): WatchDecision {
  return {
    id: "dec-1",
    ticketId: "tkt-clean",
    kind: "send",
    author: "ai",
    headline: "Emailed the Coterie desk",
    createdAt: "2026-08-07T09:30:00.000Z",
    ...overrides,
  };
}

function corpus(overrides?: Partial<WatchCorpus>): WatchCorpus {
  return {
    asOf: AS_OF,
    tickets: [ticket()],
    blanketByPolicyId: { "pol-1": { ai: true, wos: false } },
    decisions: [decision()],
    messages: [
      {
        id: "msg-1",
        ticketId: "tkt-clean",
        direction: "outbound",
        createdAt: "2026-08-07T09:30:00.000Z",
      },
    ],
    intakeEvents: [intake()],
    ...overrides,
  };
}

/** N auto-sends, one minute apart, inside a single 10-minute window. */
function autoSendBurst(n: number): WatchDecision[] {
  return Array.from({ length: n }, (_, i) =>
    decision({
      id: `dec-auto-${i}`,
      kind: "auto_send",
      createdAt: `2026-08-07T10:0${i}:00.000Z`,
    }),
  );
}

/** The single reply-kind decision the quote-confirm path records when the agent proceeds inside authority. */
function aiConfirm(overrides?: Partial<WatchDecision>): WatchDecision {
  return decision({
    id: "dec-confirm",
    kind: "reply",
    author: "ai",
    headline: "ISC Certs Desk Quoted $100.00",
    steps: [{ id: "authority", verdict: "ok" }],
    ...overrides,
  });
}

// ——— Harness ———

let failures = 0;
function check(name: string, ok: boolean, note = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && note ? ` — ${note}` : ""}`);
  if (!ok) failures++;
}

function fired(c: WatchCorpus): WatchRuleId[] {
  return runAgentWatch(c).findings.map((f) => f.ruleId);
}

// ——— 1. Clean corpus stays quiet ———

const cleanReport = runAgentWatch(corpus());
check(
  "clean corpus produces zero findings",
  cleanReport.findings.length === 0,
  `got ${cleanReport.findings.map((f) => f.ruleId).join(", ")}`,
);
check(
  "clean corpus still reports checked counts",
  WATCH_RULES.every((r) => cleanReport.checked[r.id] > 0),
);
check(
  "clean rollups count the ai send",
  cleanReport.rollups.aiActionsTotal === 1 &&
    cleanReport.rollups.humanSends === 1 &&
    cleanReport.rollups.acksSent === 1,
);

// ——— 2. Each rule fires on its crafted violation ———

const fastPathNoBlanket = corpus({
  tickets: [
    ticket({
      fastPathBasis: "Blanket Applies — CG 20 33 04 13 On COT-BOP-1",
    }),
  ],
  blanketByPolicyId: { "pol-1": { ai: false, wos: false } },
});
check(
  "FAST_PATH_WITHOUT_BLANKET fires when no blanket form backs the basis",
  fired(fastPathNoBlanket).includes("FAST_PATH_WITHOUT_BLANKET"),
);

const fastPathWrongKind = corpus({
  tickets: [
    ticket({
      requestType: "waiver_of_subrogation",
      fastPathBasis: "Blanket Applies — CG 24 04 05 09 On COT-BOP-1",
    }),
  ],
  // Blanket AI exists but the request needed blanket WOS.
  blanketByPolicyId: { "pol-1": { ai: true, wos: false } },
});
check(
  "FAST_PATH_WITHOUT_BLANKET fires when only the wrong blanket kind exists",
  fired(fastPathWrongKind).includes("FAST_PATH_WITHOUT_BLANKET"),
);

const namedRequired = corpus({
  tickets: [
    ticket({
      fastPathBasis: "Blanket Applies — CG 20 33 04 13 On COT-BOP-1",
      namedOnPolicyRequired: true,
    }),
  ],
});
check(
  "FAST_PATH_DESPITE_NAMED_REQUIRED fires on named-on-policy fast path",
  fired(namedRequired).includes("FAST_PATH_DESPITE_NAMED_REQUIRED"),
);

const misquote = corpus({
  intakeEvents: [
    intake({
      ackBody:
        "We received your email about a certificate request and opened SR-90001.",
    }),
  ],
});
check(
  "ACK_MISQUOTE fires when the ack paraphrases instead of quoting",
  fired(misquote).includes("ACK_MISQUOTE"),
);
check(
  "ACK_MISQUOTE stays quiet when the ack contains the verbatim excerpt",
  !fired(corpus()).includes("ACK_MISQUOTE"),
);

const orphanAck = corpus({
  intakeEvents: [intake({ ticketId: null })],
});
check(
  "ACK_WITHOUT_TICKET fires on an ack with no ticket",
  fired(orphanAck).includes("ACK_WITHOUT_TICKET"),
);

const staleEscalation = corpus({
  tickets: [
    ticket({
      escalatedAt: "2026-08-05T09:00:00.000Z",
      escalationDueBy: "2026-08-05T23:59:00.000Z",
      escalationResolvedAt: null,
    }),
  ],
});
check(
  "STALE_ESCALATION fires past dueBy and unresolved",
  fired(staleEscalation).includes("STALE_ESCALATION"),
);
check(
  "STALE_ESCALATION stays quiet when resolved",
  !fired(
    corpus({
      tickets: [
        ticket({
          escalatedAt: "2026-08-05T09:00:00.000Z",
          escalationDueBy: "2026-08-05T23:59:00.000Z",
          escalationResolvedAt: "2026-08-05T18:00:00.000Z",
        }),
      ],
    }),
  ).includes("STALE_ESCALATION"),
);

const rottingCall = corpus({
  intakeEvents: [
    intake({
      id: "evt-call",
      channel: "call",
      callMissed: true,
      status: "pending",
      receivedAt: "2026-08-05T08:00:00.000Z", // 52h before AS_OF
      ackSentAt: null,
      ackBody: null,
      ticketId: null,
    }),
  ],
});
check(
  "MISSED_CALL_ROTTING fires on a pending missed call past 24h",
  fired(rottingCall).includes("MISSED_CALL_ROTTING"),
);
check(
  "MISSED_CALL_ROTTING stays quiet on a fresh missed call",
  !fired(
    corpus({
      intakeEvents: [
        intake({
          id: "evt-call-fresh",
          channel: "call",
          callMissed: true,
          status: "pending",
          receivedAt: "2026-08-07T06:00:00.000Z", // 6h before AS_OF
          ackSentAt: null,
          ackBody: null,
          ticketId: null,
        }),
      ],
    }),
  ).includes("MISSED_CALL_ROTTING"),
);

const storm = corpus({
  decisions: [decision(), ...autoSendBurst(AUTO_SEND_STORM_THRESHOLD + 1)],
});
check(
  `AUTO_SEND_STORM fires on ${AUTO_SEND_STORM_THRESHOLD + 1} auto-sends in 10 minutes`,
  fired(storm).includes("AUTO_SEND_STORM"),
);
check(
  `AUTO_SEND_STORM stays quiet at exactly ${AUTO_SEND_STORM_THRESHOLD}`,
  !fired(
    corpus({
      decisions: [decision(), ...autoSendBurst(AUTO_SEND_STORM_THRESHOLD)],
    }),
  ).includes("AUTO_SEND_STORM"),
);
const stormFinding = runAgentWatch(storm).findings.find(
  (f) => f.ruleId === "AUTO_SEND_STORM",
);
check(
  "AUTO_SEND_STORM cites every send in the burst exactly once",
  stormFinding != null &&
    stormFinding.citations.length === AUTO_SEND_STORM_THRESHOLD + 1,
  `got ${stormFinding?.citations.length ?? 0} citations`,
);

// —— AI-authored confirms are automated sends too ——
// The quote-confirm path records one reply-kind decision whose authority
// step passed; it must show in the auto-send rollup and the storm
// denominator without inflating the AI Actions total.

const confirmReport = runAgentWatch(
  corpus({ decisions: [decision(), aiConfirm()] }),
);
check(
  "auto-send rollup counts an AI-authored authority-ok confirm",
  confirmReport.rollups.autoSends === 1,
  `autoSends=${confirmReport.rollups.autoSends}`,
);
check(
  "confirm stays one decision in AI Actions (no double count)",
  confirmReport.rollups.aiActionsTotal === 2,
  `aiActionsTotal=${confirmReport.rollups.aiActionsTotal}`,
);
check(
  "a parked over-authority reply is not an auto-send",
  runAgentWatch(
    corpus({
      decisions: [
        aiConfirm({
          id: "dec-parked",
          steps: [{ id: "authority", verdict: "warn" }],
        }),
      ],
    }),
  ).rollups.autoSends === 0,
);
check(
  "an AI confirm inside the window tips the storm denominator",
  fired(
    corpus({
      decisions: [
        ...autoSendBurst(AUTO_SEND_STORM_THRESHOLD),
        aiConfirm({
          id: "dec-confirm-storm",
          createdAt: "2026-08-07T10:05:30.000Z",
        }),
      ],
    }),
  ).includes("AUTO_SEND_STORM"),
);

const stuck = corpus({
  tickets: [
    ticket({
      id: "tkt-stuck",
      srNumber: "SR-90002",
      createdAt: "2026-08-01T09:00:00.000Z",
    }),
  ],
  decisions: [],
  messages: [],
  intakeEvents: [],
});
check(
  "TICKET_STUCK fires on an open ticket idle past 72h",
  fired(stuck).includes("TICKET_STUCK"),
);
check(
  "TICKET_STUCK stays quiet when a recent message bumps activity",
  !fired(
    corpus({
      tickets: [
        ticket({
          id: "tkt-stuck",
          srNumber: "SR-90002",
          createdAt: "2026-08-01T09:00:00.000Z",
        }),
      ],
      decisions: [],
      messages: [
        {
          id: "msg-recent",
          ticketId: "tkt-stuck",
          direction: "inbound",
          createdAt: "2026-08-06T09:00:00.000Z",
        },
      ],
      intakeEvents: [],
    }),
  ).includes("TICKET_STUCK"),
);
check(
  "TICKET_STUCK stays quiet on a closed ticket",
  !fired(
    corpus({
      tickets: [
        ticket({
          id: "tkt-old-closed",
          srNumber: "SR-90003",
          status: "closed",
          createdAt: "2026-08-01T09:00:00.000Z",
          closedAt: "2026-08-01T12:00:00.000Z",
        }),
      ],
      decisions: [],
      messages: [],
      intakeEvents: [],
    }),
  ).includes("TICKET_STUCK"),
);

// ——— 3. Everything-wrong corpus: ordering + citations ———

const dirty: WatchCorpus = {
  asOf: AS_OF,
  tickets: [
    ticket({
      id: "tkt-bad-fp",
      srNumber: "SR-90010",
      fastPathBasis: "Blanket Applies — CG 20 33 04 13 On COT-BOP-1",
      namedOnPolicyRequired: true,
    }),
    ticket({
      id: "tkt-stale",
      srNumber: "SR-90011",
      escalatedAt: "2026-08-04T09:00:00.000Z",
      escalationDueBy: "2026-08-04T23:59:00.000Z",
      createdAt: "2026-08-01T09:00:00.000Z",
    }),
  ],
  blanketByPolicyId: { "pol-1": { ai: false, wos: false } },
  decisions: autoSendBurst(AUTO_SEND_STORM_THRESHOLD + 2),
  messages: [],
  intakeEvents: [
    intake({ id: "evt-misquote", ackBody: "Thanks, we are on it!" }),
    intake({ id: "evt-orphan", ticketId: null }),
    intake({
      id: "evt-rot",
      channel: "call",
      callMissed: true,
      status: "pending",
      receivedAt: "2026-08-04T08:00:00.000Z",
      ackSentAt: null,
      ackBody: null,
      ticketId: null,
    }),
  ],
};
const dirtyReport = runAgentWatch(dirty);
const dirtyRules = new Set(dirtyReport.findings.map((f) => f.ruleId));
const expectAll: WatchRuleId[] = [
  "FAST_PATH_WITHOUT_BLANKET",
  "FAST_PATH_DESPITE_NAMED_REQUIRED",
  "ACK_MISQUOTE",
  "ACK_WITHOUT_TICKET",
  "STALE_ESCALATION",
  "MISSED_CALL_ROTTING",
  "AUTO_SEND_STORM",
  "TICKET_STUCK",
];
check(
  "dirty corpus fires all eight rules",
  expectAll.every((r) => dirtyRules.has(r)),
  `missing: ${expectAll.filter((r) => !dirtyRules.has(r)).join(", ")}`,
);
check(
  "findings sort critical → warn → info",
  dirtyReport.findings.every(
    (f, i, arr) =>
      i === 0 ||
      SEVERITY_ORDER[arr[i - 1].severity] <= SEVERITY_ORDER[f.severity],
  ),
);
check(
  "every finding carries at least one citation",
  dirtyReport.findings.every((f) => f.citations.length > 0),
);
check(
  "same corpus twice yields identical reports (determinism)",
  JSON.stringify(runAgentWatch(dirty)) === JSON.stringify(dirtyReport),
);

// ——— Verdict ———

console.log(
  failures === 0
    ? "\nALL CHECKS PASSED"
    : `\n${failures} CHECK${failures === 1 ? "" : "S"} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
