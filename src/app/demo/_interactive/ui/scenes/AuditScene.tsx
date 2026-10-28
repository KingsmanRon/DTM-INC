"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { verifyChain, type ChainVerification } from "@/app/demo/_interactive/state/audit";
import type { AuditCategory } from "@/app/demo/_interactive/types";
import { cx } from "@/app/demo/_interactive/kit/cx";
import { formatDateTime } from "@/app/demo/_interactive/kit/format";
import { SceneHead } from "../common";
import { AuditTimeline, CATEGORY_LABEL } from "../AuditTimeline";
import { useDemo } from "../DemoProvider";

type Filter = AuditCategory | "all";
const FILTERS: Filter[] = ["all", "patient", "document", "clinical", "facility", "billing"];

export function AuditScene() {
  const { model, act } = useDemo();
  const [filter, setFilter] = useState<Filter>("all");
  const [tamperIndex, setTamperIndex] = useState<number | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(null);

  useEffect(() => {
    act({ type: "progress/mark", key: "auditViewed" });
  }, [act]);

  // Oldest first, as the chain is verified. A simulated edit changes one entry in this copy only.
  const chronological = useMemo(() => [...model.audit].reverse(), [model.audit]);
  const working = useMemo(
    () =>
      chronological.map((event, index) =>
        index === tamperIndex ? { ...event, summary: `${event.summary} (altered after the fact)` } : event,
      ),
    [chronological, tamperIndex],
  );

  const shown = model.audit.filter((e) => filter === "all" || e.category === filter);
  const tamperedId = tamperIndex !== null ? chronological[tamperIndex]?.id : null;

  const runCheck = () => {
    setVerification(verifyChain(working));
    act({ type: "progress/mark", key: "integrityVerified" });
  };

  const simulateEdit = () => {
    // Pick a mid-history entry so the break is visible in the timeline.
    const index = Math.max(1, Math.floor(chronological.length / 2) - 1);
    setTamperIndex(index);
    setVerification(null);
  };

  const brokenEvent = verification && !verification.ok && verification.brokenAt !== null ? working[verification.brokenAt] : null;

  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Audit and records accountability"
        title="Audit trail"
        lead="A timeline of administrative and clinical record activity: who did what, and when. Entries describe actions, never clinical content."
      />

      <div className="audit-grid">
        <section className="card card--pad" aria-labelledby="timeline-title">
          <div className="panel-head">
            <h2 id="timeline-title" className="card__title">Record activity</h2>
            <div className="chips" role="group" aria-label="Filter the audit trail">
              {FILTERS.map((f) => (
                <button key={f} type="button" className={cx("chip", filter === f && "chip--on")} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? "All activity" : CATEGORY_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <p className="results-count" role="status">
            {shown.length} {shown.length === 1 ? "entry" : "entries"}. Fictional times and people; most recent first.
          </p>
          {shown.length === 0 ? (
            <div className="empty"><strong>No activity in this category</strong></div>
          ) : (
            <AuditTimeline events={shown} showRef tamperedId={tamperedId} />
          )}
        </section>

        <aside className="stack">
          <section className="card card--pad integrity" aria-labelledby="integrity-title">
            <h2 id="integrity-title" className="card__title">
              <Icon name="shield-check" className="inline-icon" /> Record integrity <Badge tone="warn">Simulated</Badge>
            </h2>
            <p className="card__lead">
              Each entry carries a reference built from the entry before it, so changing history would break the chain
              that follows. This panel illustrates that idea.
            </p>

            <div className="row mt">
              <Button variant="primary" icon="shield-check" onClick={runCheck}>Run simulated integrity check</Button>
              {tamperIndex === null ? (
                <Button icon="pen" onClick={simulateEdit}>Simulate an edit to a past entry</Button>
              ) : (
                <Button variant="ghost" icon="refresh" onClick={() => { setTamperIndex(null); setVerification(null); }}>Undo simulated edit</Button>
              )}
            </div>

            <div aria-live="polite" className="mt">
              {verification?.ok ? (
                <Callout tone="success" icon="check" title="Chain consistent (simulated)">
                  All {verification.checked} entries match their references.
                </Callout>
              ) : null}
              {verification && !verification.ok ? (
                <Callout tone="danger" icon="alert" title="Change detected (simulated)">
                  The entry recorded {brokenEvent ? formatDateTime(brokenEvent.at) : ""} no longer matches its reference,
                  so the alteration would be visible.
                </Callout>
              ) : null}
            </div>

            <p className="fine-print mt">
              Illustration only. The reference codes here are a simple checksum for demonstration. They are not
              cryptographic, and this panel is not evidence of how any deployed system verifies its audit records.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
