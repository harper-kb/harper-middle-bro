/**
 * Global read-only Ask Memory — grounded answers with citations.
 * Default scope: current account/task/page; optional global search.
 */

export type MemoryCitation = {
  kind:
    | "account"
    | "ticket"
    | "thread"
    | "document"
    | "communication"
    | "skill"
    | "notion";
  label: string;
  href: string | null;
};

export type MemoryAnswer =
  | { kind: "answer"; answer: string; citations: MemoryCitation[] }
  | { kind: "refusal"; answer: string };

export type MemoryContext = {
  accountId: string | null;
  accountName: string | null;
  workItemId: string | null;
  pagePath: string;
  /** Optional explicit global search */
  globalQuery: string | null;
};

const REFUSAL =
  "I Only Answer From Grounded Desk Records, Skills, Or Approved Playbooks.";

export function askMemory(
  question: string,
  context: MemoryContext,
  corpus: {
    accountNotes?: string | null;
    ticketSummaries?: string[];
    threadSubjects?: string[];
    skillHits?: { title: string; href: string }[];
    notionHits?: { title: string; href: string }[];
  },
): MemoryAnswer {
  const q = question.trim().toLowerCase();
  if (!q) {
    return { kind: "refusal", answer: REFUSAL };
  }

  // Weather / opinion — refuse
  if (/weather|opinion|should we fire|guess/.test(q)) {
    return { kind: "refusal", answer: REFUSAL };
  }

  const citations: MemoryCitation[] = [];
  const parts: string[] = [];

  if (context.accountName && /account|this (company|insured)|who is/.test(q)) {
    parts.push(`Account on page: ${context.accountName}.`);
    citations.push({
      kind: "account",
      label: context.accountName,
      href: context.accountId ? `/accounts/${context.accountId}` : null,
    });
  }

  if (corpus.accountNotes && /note|remember|last/.test(q)) {
    parts.push(`Account note: ${corpus.accountNotes.slice(0, 240)}`);
    citations.push({
      kind: "account",
      label: "Account Notes",
      href: context.accountId ? `/accounts/${context.accountId}` : null,
    });
  }

  if (corpus.ticketSummaries?.length && /ticket|sr|open work/.test(q)) {
    parts.push(`Open tickets: ${corpus.ticketSummaries.slice(0, 3).join("; ")}`);
    for (const t of corpus.ticketSummaries.slice(0, 3)) {
      citations.push({ kind: "ticket", label: t, href: null });
    }
  }

  if (corpus.threadSubjects?.length && /thread|email|comm/.test(q)) {
    parts.push(`Threads: ${corpus.threadSubjects.slice(0, 3).join("; ")}`);
    for (const t of corpus.threadSubjects.slice(0, 3)) {
      citations.push({ kind: "thread", label: t, href: null });
    }
  }

  if (corpus.skillHits?.length && /skill|playbook|how do|policy/.test(q)) {
    for (const s of corpus.skillHits.slice(0, 3)) {
      parts.push(`Skill: ${s.title}`);
      citations.push({ kind: "skill", label: s.title, href: s.href });
    }
  }

  if (corpus.notionHits?.length && /notion|template|playbook/.test(q)) {
    for (const n of corpus.notionHits.slice(0, 3)) {
      parts.push(`Playbook: ${n.title}`);
      citations.push({ kind: "notion", label: n.title, href: n.href });
    }
  }

  if (context.globalQuery) {
    parts.push(`Global search scoped to: ${context.globalQuery}`);
  }

  if (parts.length === 0) {
    return { kind: "refusal", answer: REFUSAL };
  }

  return {
    kind: "answer",
    answer: parts.join(" "),
    citations,
  };
}
