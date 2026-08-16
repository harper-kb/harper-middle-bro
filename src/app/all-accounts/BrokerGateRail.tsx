"use client";

import { useId } from "react";
import {
  BROKER_GATE_IDS,
  brokerGateView,
} from "@/lib/broker-gate";

/**
 * Compact G1–G6 rail for an expanded Broker order. Highlights only the current
 * gate — earlier gates are not marked completed because the workflow is not
 * strictly monotonic and we do not ship full history events in this pass.
 */
export function BrokerGateRail({
  brokerGate,
  brokerGateAt,
}: {
  brokerGate: string | null;
  brokerGateAt: string | null;
}) {
  const tipId = useId();
  const view = brokerGateView(brokerGate, brokerGateAt);
  if (!view) {
    return (
      <div className="broker-gate-rail" aria-label="Broker gate">
        <p className="text-xs text-[var(--muted)]">Gate unavailable</p>
      </div>
    );
  }

  const tip =
    view.at && !Number.isNaN(new Date(view.at).getTime())
      ? `Current gate since ${new Date(view.at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}`
      : undefined;

  return (
    <div className="broker-gate-rail" aria-label="Broker gate">
      <div className="broker-gate-rail-track" role="list">
        {BROKER_GATE_IDS.map((gate, index) => (
          <span key={gate} className="broker-gate-node" role="listitem">
            {index > 0 ? (
              <span className="broker-gate-connector" aria-hidden="true" />
            ) : null}
            <span
              className={`broker-gate-dot${
                gate === view.gate ? " broker-gate-dot--current" : ""
              }`}
              title={gate === view.gate ? view.label : undefined}
              aria-current={gate === view.gate ? "step" : undefined}
            >
              {gate}
            </span>
          </span>
        ))}
      </div>
      <div
        className="broker-gate-caption"
        tabIndex={tip ? 0 : undefined}
        aria-describedby={tip ? tipId : undefined}
      >
        <p className="broker-gate-caption-code">
          {view.gate}
          <span className="sr-only"> current gate</span>
        </p>
        <p className="broker-gate-caption-label">{view.label}</p>
        {tip ? (
          <span className="meta-tip" role="tooltip" id={tipId}>
            {tip}
          </span>
        ) : null}
      </div>
    </div>
  );
}
