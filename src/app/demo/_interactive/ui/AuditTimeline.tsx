import { Icon, type IconName } from "@/app/demo/_interactive/kit/Icon";
import { Badge } from "@/app/demo/_interactive/kit/Badge";
import { dayKey, formatDate, formatTime } from "@/app/demo/_interactive/kit/format";
import { ROLE_LABEL } from "@/app/demo/_interactive/state/permissions";
import type { AuditCategory, AuditEvent } from "@/app/demo/_interactive/types";

const CATEGORY_ICON: Record<AuditCategory, IconName> = {
  patient: "user",
  document: "file",
  clinical: "stethoscope",
  facility: "building",
  billing: "stack",
};

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  patient: "Patient",
  document: "Documents",
  clinical: "Clinical",
  facility: "Hospitals",
  billing: "Billing File Tracking",
};

/** Timeline of record activity, grouped by day, newest first. */
export function AuditTimeline({
  events,
  showRef = false,
  tamperedId,
  label = "Audit timeline",
}: {
  events: readonly AuditEvent[];
  showRef?: boolean;
  tamperedId?: string | null;
  label?: string;
}) {
  const groups: { day: string; events: AuditEvent[] }[] = [];
  for (const event of events) {
    const day = dayKey(event.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }

  return (
    <ol className="timeline" aria-label={label}>
      {groups.map((group) => (
        <li key={group.day} className="timeline__group">
          <h3 className="timeline__day">{formatDate(`${group.day}T00:00:00+02:00`)}</h3>
          <ol className="timeline__list">
            {group.events.map((event) => (
              <li key={event.id} className="timeline__item" data-category={event.category}>
                <span className={`timeline__dot timeline__dot--${event.category}`} aria-hidden="true">
                  <Icon name={CATEGORY_ICON[event.category]} />
                </span>
                <div className="timeline__body">
                  <p className="timeline__summary">
                    <span className="sr-only">{CATEGORY_LABEL[event.category]}: </span>
                    {event.summary}
                    {tamperedId === event.id ? (
                      <Badge tone="danger" className="timeline__flag">Edited (simulated)</Badge>
                    ) : null}
                  </p>
                  <p className="timeline__meta">
                    <time dateTime={event.at}>{formatTime(event.at)}</time>
                    <span aria-hidden="true">·</span>
                    <span>{event.actorName}</span>
                    <Badge tone={event.actorRole === "doctor" ? "teal" : event.actorRole === "admin" ? "navy" : "info"}>
                      {ROLE_LABEL[event.actorRole]}
                    </Badge>
                    <span aria-hidden="true">·</span>
                    <span className="mono">{event.target}</span>
                    {showRef ? <span className="timeline__ref mono">ref {event.ref}</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}
