import { createHash } from "node:crypto";
import { DomainError, object } from "../domain/contracts.ts";
import type { WorkspaceRecord } from "../domain/contracts.ts";
import type { CommandReceipt, Proposal } from "../domain/commands.ts";
import { validatePlan, freeSlots } from "./contracts.ts";
import type { AssistantInput, AssistantPlan } from "./contracts.ts";
import { sealResult, openResult } from "./ledger.ts";
import type { AssistantLedger } from "./ledger.ts";
import { preparePersonalJournal } from "../journal/personal.ts";
import type { PersonalJournalPort } from "../journal/personal.ts";
import { stableCommandId, ASSISTANT_TIMEZONE } from "./contracts.ts";

export type AssistantEvent = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  etag?: string;
  attendees?: string[];
  joinUrl?: string;
};
export type CalendarPort = {
  status(): Promise<{ connected: boolean }>;
  events(
    calendarId: string,
    from: string,
    to: string,
  ): Promise<{ events: AssistantEvent[]; truncated?: boolean }>;
  freebusy(
    calendarId: string,
    from: string,
    to: string,
  ): Promise<{ busy: { start: string; end: string }[] }>;
  preview(requestId: string, event: Record<string, unknown>): Promise<unknown>;
};
export async function runAssistant(args: {
  input: AssistantInput;
  records: WorkspaceRecord[];
  workspaceId: string;
  ledger: AssistantLedger;
  model: () => Promise<unknown>;
  apply: (proposal: Proposal) => Promise<CommandReceipt>;
  calendar: CalendarPort;
  journal?: Pick<PersonalJournalPort, "day">;
}) {
  const { input, records, workspaceId, ledger, model, apply, calendar } = args;
  const digest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const reservation = await ledger.reserve(input.requestId, digest);
  let plan: AssistantPlan;
  if (!reservation.fresh) {
    if (!reservation.payload)
      throw new DomainError("assistant_request_pending");
    const cached = object(
      openResult(workspaceId, input.requestId, reservation.payload),
    );
    if (cached.stage === "complete") return cached.response;
    if (cached.stage !== "planned")
      throw new DomainError("assistant_replay_invalid");
    // Authenticated encryption binds this server-created plan to owner and request ID.
    plan = cached.plan as AssistantPlan;
  } else {
    plan = validatePlan(await model(), input, records);
    await ledger.save(
      input.requestId,
      digest,
      sealResult(workspaceId, input.requestId, { stage: "planned", plan }),
    );
  }
  let response: Record<string, unknown> = { reply: plan.reply };
  if (plan.proposal) {
    if (input.autoApply && plan.proposal.operations.length === 1) {
      const receipt = await apply(plan.proposal);
      response = {
        reply: receipt.undo
          ? "This change was already undone."
          : "Saved your change.",
        receipt,
      };
    } else
      response = {
        reply: "Review these changes before applying them.",
        proposal: plan.proposal,
      };
  } else if (plan.journal) {
    if (!args.journal) throw new DomainError("journal_unavailable");
    const journalProposal = await preparePersonalJournal(
      args.journal,
      stableCommandId("journal-" + input.requestId),
      plan.journal.localDate,
      plan.journal.content,
      ASSISTANT_TIMEZONE,
    );
    response = {
      reply:
        "Review your journal entry before saving. New text is added after any saved entry for this day.",
      journalProposal,
    };
  } else if (plan.calendar) {
    const a = plan.calendar;
    let etag: string | undefined;
    if (a.eventId) {
      // Resolve the current remote entity again; never accept a model-supplied etag.
      const horizon = new Date(Date.now() + 89 * 86400000).toISOString();
      const listed = await calendar.events(
        a.calendarId,
        new Date(Date.now() - 86400000).toISOString(),
        horizon,
      );
      const event = listed.events.find((e) => e.id === a.eventId);
      if (!event || !event.etag)
        throw new DomainError("calendar_event_not_found");
      if (event.allDay)
        throw new DomainError("calendar_all_day_edit_unsupported");
      etag = event.etag;
    }
    const result = await calendar.preview(input.requestId, {
      calendarId: a.calendarId,
      ...(a.eventId ? { id: a.eventId, etag } : {}),
      title: a.title,
      start: a.start,
      end: a.end,
      attendees: a.attendees,
      createMeet: a.createMeet,
    });
    response = {
      reply:
        "Review the meeting details before confirming. Invitations are sent only when you confirm.",
      calendarProposal: result,
    };
  } else if (plan.read) {
    const a = plan.read;
    const local = records
      .filter(
        (r) =>
          r.kind === "meeting" &&
          Date.parse(String(r.data.start)) < Date.parse(a.to) &&
          Date.parse(String(r.data.end)) > Date.parse(a.from),
      )
      .map((r) => ({
        id: r.id,
        calendarId: "local",
        title: String(r.data.title),
        start: String(r.data.start),
        end: String(r.data.end),
        allDay: false,
      }));
    const status = await calendar.status();
    if (a.type === "agenda") {
      const remote = status.connected
        ? await calendar.events("primary", a.from, a.to)
        : { events: [], truncated: false };
      const events = [...local, ...remote.events].sort((a, b) =>
        a.start.localeCompare(b.start),
      );
      response = {
        reply: `${events.length ? `Found ${events.length} meeting${events.length === 1 ? "" : "s"} in that period.` : "No meetings in that period."}${status.connected ? "" : " Google Calendar is not connected; this includes local meetings only."}${remote.truncated ? " The Google result is incomplete; narrow the date range." : ""}`,
        events,
      };
    } else {
      if (!status.connected) throw new DomainError("calendar_not_connected");
      const result = await calendar.freebusy("primary", a.from, a.to);
      const slots = freeSlots(a.from, a.to, a.durationMinutes, [
        ...result.busy,
        ...local,
      ]);
      response = {
        reply: slots.length
          ? "These times are free in your primary Google calendar and local meetings. Availability can change before booking."
          : "No matching free time in that window.",
        slots,
      };
    }
  }
  await ledger.save(
    input.requestId,
    digest,
    sealResult(workspaceId, input.requestId, { stage: "complete", response }),
  );
  return response;
}
