"use client";

import { useEffect, useRef } from "react";
import type { NodeTone, PathNode, TicketPath } from "@/lib/path";

const NODE_W = 150;
const NODE_H = 56;
const GAP_X = 54;
const GAP_Y = 24;
const PAD = 26;

const TONES: Record<NodeTone, { fill: string; stroke: string; dot: string }> = {
  intake: { fill: "#1f333e", stroke: "#3d5462", dot: "#9c8f78" },
  outbound: { fill: "#263c48", stroke: "#c45c4a", dot: "#c45c4a" },
  inbound: { fill: "#22343f", stroke: "#9c8f78", dot: "#9c8f78" },
  client: { fill: "#22343f", stroke: "#6f9a86", dot: "#6f9a86" },
  outcome: { fill: "#1f333e", stroke: "#6f9a86", dot: "#6f9a86" },
};

function x(col: number) {
  return PAD + col * (NODE_W + GAP_X);
}

function y(lane: number) {
  return PAD + lane * (NODE_H + GAP_Y);
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The path, clickable. Wish-stick / network-map: one lane per desk, gold
 * marks on nodes that carry reasoning. The node you're reviewing pulses.
 */
export function PathMap({
  path,
  decisionByMessage,
  selectedMessageId,
  onSelect,
}: {
  path: TicketPath;
  decisionByMessage: Record<string, string>;
  selectedMessageId: string | null;
  onSelect: (decisionId: string) => void;
}) {
  const byId = new Map(path.nodes.map((n) => [n.id, n]));
  const width = x(path.cols - 1) + NODE_W + PAD;
  const height = y(path.lanes - 1) + NODE_H + PAD;
  const scroller = useRef<HTMLDivElement>(null);

  // A long path scrolls past the edge — bring the node you're reading into view.
  const selectedCol = selectedMessageId
    ? (path.nodes.find((n) => n.messageId === selectedMessageId)?.col ?? null)
    : null;

  useEffect(() => {
    const el = scroller.current;
    if (!el || selectedCol == null) return;
    const target = x(selectedCol) + NODE_W / 2 - el.clientWidth / 2;
    el.scrollTo({ left: Math.max(target, 0), behavior: "smooth" });
  }, [selectedCol]);

  return (
    <div
      ref={scroller}
      className="life-map overflow-x-auto p-1"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="max-w-none"
        role="group"
        aria-label="Request path"
      >
        <defs>
          <marker
            id="map-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.4)" />
          </marker>
        </defs>

        {path.edges.map((e, i) => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;

          const x1 = x(from.col) + NODE_W;
          const y1 = y(from.lane) + NODE_H / 2;
          const x2 = x(to.col);
          const y2 = y(to.lane) + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          const live =
            selectedMessageId != null &&
            (from.messageId === selectedMessageId ||
              to.messageId === selectedMessageId);

          return (
            <path
              key={`${e.from}-${e.to}-${i}`}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={live ? "rgba(196,92,74,0.85)" : "rgba(255,255,255,0.22)"}
              strokeWidth={live ? 2 : 1.5}
              markerEnd="url(#map-arrow)"
              className={live ? "life-edge" : undefined}
            />
          );
        })}

        {path.nodes.map((node) => (
          <MapNode
            key={node.id}
            node={node}
            decisionId={
              node.messageId ? (decisionByMessage[node.messageId] ?? null) : null
            }
            selected={
              node.messageId != null && node.messageId === selectedMessageId
            }
            onSelect={onSelect}
          />
        ))}
      </svg>
    </div>
  );
}

function MapNode({
  node,
  decisionId,
  selected,
  onSelect,
}: {
  node: PathNode;
  decisionId: string | null;
  selected: boolean;
  onSelect: (decisionId: string) => void;
}) {
  const tone = TONES[node.tone];
  const left = x(node.col);
  const top = y(node.lane);
  const clickable = decisionId != null;

  return (
    <g
      className={`${clickable ? "trace-node" : ""} ${selected ? "trace-node-on" : ""}`}
      onClick={clickable ? () => onSelect(decisionId) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(decisionId);
              }
            }
          : undefined
      }
    >
      <rect
        x={left}
        y={top}
        width={NODE_W}
        height={NODE_H}
        rx={12}
        fill={tone.fill}
        stroke={selected ? "#e2c789" : tone.stroke}
        strokeWidth={selected ? 2 : 1.25}
      />
      {selected && (
        <rect
          x={left - 3}
          y={top - 3}
          width={NODE_W + 6}
          height={NODE_H + 6}
          rx={15}
          fill="none"
          stroke="rgba(226,199,137,0.45)"
          strokeWidth={1.5}
          className="life-pulse"
        />
      )}

      <circle cx={left + 14} cy={top + 18} r={3.5} fill={tone.dot} />
      <text
        x={left + 26}
        y={top + 22}
        fill="#ffffff"
        fontSize={11.5}
        fontWeight={600}
      >
        {clip(node.title, 17)}
      </text>
      <text x={left + 14} y={top + 40} fill="rgba(255,255,255,0.62)" fontSize={10}>
        {clip(node.subtitle, 22)}
      </text>

      {clickable && (
        <circle
          cx={left + NODE_W - 13}
          cy={top + 14}
          r={3}
          fill="#e2c789"
          className={selected ? undefined : "life-star"}
        />
      )}

      <title>
        {`${node.title} · ${node.subtitle}\n${node.detail}${clickable ? "\n\nClick to read the reasoning" : ""}`}
      </title>
    </g>
  );
}
