/**
 * Pins for IQ Stage vocabulary + Broker Gate coercion — no invented mappings.
 */
import assert from "node:assert/strict";
import {
  coerceBrokerGateId,
  BROKER_GATE_LABELS,
  brokerGateView,
} from "../src/lib/broker-gate";
import {
  IQ_STAGE_FILTER_OPTIONS,
  IQ_STAGE_NO_STATUS,
  IQ_STAGE_UNRECOGNIZED,
  iqStageFromTag,
  orderMatchesIqStages,
  parseIqStages,
  serializeIqStages,
} from "../src/lib/iq-stage";

assert.equal(iqStageFromTag(null).id, IQ_STAGE_NO_STATUS);
assert.equal(iqStageFromTag("").id, IQ_STAGE_NO_STATUS);
assert.equal(iqStageFromTag("  ").id, IQ_STAGE_NO_STATUS);
assert.equal(iqStageFromTag(null).label, "No status");

assert.equal(iqStageFromTag("bind_requested").id, "bind_requested");
assert.equal(iqStageFromTag("Bind_Requested").id, "bind_requested");
assert.equal(iqStageFromTag("bind_requested").label, "Bind requested");

assert.equal(iqStageFromTag("some_new_bb_step").id, IQ_STAGE_UNRECOGNIZED);
assert.equal(iqStageFromTag("some_new_bb_step").label, "Step not recognized");
assert.notEqual(iqStageFromTag("some_new_bb_step").id, IQ_STAGE_NO_STATUS);

assert.deepEqual(parseIqStages(undefined), []);
assert.deepEqual(parseIqStages(""), []);
assert.deepEqual(parseIqStages("bind_requested,step:none"), [
  "bind_requested",
  IQ_STAGE_NO_STATUS,
]);
assert.deepEqual(parseIqStages("not-a-real-stage,bind_requested"), [
  "bind_requested",
]);
assert.equal(
  serializeIqStages(["bind_requested", IQ_STAGE_NO_STATUS]),
  "bind_requested,step:none",
);
assert.equal(serializeIqStages([]), undefined);

assert.equal(
  orderMatchesIqStages(null, [IQ_STAGE_NO_STATUS]),
  true,
);
assert.equal(
  orderMatchesIqStages("bind_requested", ["bind_requested"]),
  true,
);
assert.equal(
  orderMatchesIqStages("bind_requested", ["binder_received"]),
  false,
);
assert.equal(orderMatchesIqStages("anything", []), true);

assert.ok(IQ_STAGE_FILTER_OPTIONS[0].id === IQ_STAGE_NO_STATUS);
assert.ok(IQ_STAGE_FILTER_OPTIONS.some((o) => o.id === "create_binder_dont_send"));

assert.equal(coerceBrokerGateId("G2"), "G2");
assert.equal(coerceBrokerGateId("Gate 3"), "G3");
assert.equal(coerceBrokerGateId("g6"), "G6");
assert.equal(coerceBrokerGateId(null), null);
assert.equal(coerceBrokerGateId("G9"), null);

const view = brokerGateView("G2", "2026-05-01T00:00:00.000Z");
assert.equal(view?.gate, "G2");
assert.equal(view?.label, BROKER_GATE_LABELS.G2);
assert.equal(brokerGateView(null), null);

console.log("iq-stage-broker-gate-check: ok");
