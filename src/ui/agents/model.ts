import type { ConnectionView } from "../../connections/hosted.ts";
import type { DiaryEntry, StatusEntry } from "../../journal/contracts.ts";
import type { StoredReport } from "../../storage/port.ts";

export type AgentProfile = {
  id: string;
  name: string;
  connection?: ConnectionView;
  reports: StoredReport[];
  journals: DiaryEntry[];
  status?: StatusEntry;
};

export function connectionState(
  connection: ConnectionView | undefined,
  now: number,
) {
  if (!connection) return "History only";
  if (
    ["active", "approved", "pending"].includes(connection.status) &&
    now > 0 &&
    Date.parse(connection.expiresAt) <= now
  )
    return "Expired";
  return (
    (
      {
        active: "Connected",
        pending: "Pending approval",
        approved: "Awaiting agent",
        expired: "Expired",
        revoked: "Revoked",
        rejected: "Rejected",
      } as Record<string, string>
    )[connection.status] ?? "Unavailable"
  );
}

export function agentProfiles(
  connections: ConnectionView[],
  reports: StoredReport[],
  journals: DiaryEntry[],
  statuses: StatusEntry[],
  names: Record<string, string> = {},
): AgentProfile[] {
  const ids = new Set([
    ...connections.map((item) => item.id),
    ...reports.map((item) => item.connectionId),
    ...journals.map((item) => item.connectionId),
    ...statuses.map((item) => item.connectionId),
  ]);
  return [...ids]
    .map((id) => {
      const connection = connections.find((item) => item.id === id);
      return {
        id,
        name:
          connection?.displayName ??
          names[id] ??
          (id === "current-assistant-explicit-relay"
            ? "Imported reports"
            : `Agent ${id.slice(0, 8)}`),
        connection,
        reports: reports
          .filter((item) => item.connectionId === id)
          .sort(
            (a, b) =>
              Date.parse(b.report.occurredAt) - Date.parse(a.report.occurredAt),
          ),
        journals: journals
          .filter((item) => item.connectionId === id)
          .sort((a, b) => b.localDate.localeCompare(a.localDate)),
        status: statuses
          .filter((item) => item.connectionId === id)
          .sort(
            (a, b) =>
              Date.parse(b.report.observedAt) - Date.parse(a.report.observedAt),
          )[0],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function latestWork(agent: AgentProfile) {
  return [
    ...(agent.status
      ? [
          {
            summary: agent.status.report.summary,
            at: agent.status.report.observedAt,
          },
        ]
      : []),
    ...agent.reports.map((item) => ({
      summary: item.report.summary,
      at: item.report.occurredAt,
    })),
    ...agent.journals.map((item) => ({
      summary: item.report.summary,
      at: item.report.observedAt,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}
