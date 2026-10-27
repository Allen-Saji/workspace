import { createHash } from "node:crypto";
import {
  DomainError,
  idField,
  keys,
  object,
  textField,
} from "../domain/contracts.ts";
import type { WorkspaceRecord } from "../domain/contracts.ts";
import { validateProposal } from "../domain/commands.ts";
import type { Proposal } from "../domain/commands.ts";
import { journalDate } from "../journal/personal.ts";

export const ASSISTANT_TIMEZONE = "Asia/Kolkata";
export type AssistantInput = {
  requestId: string;
  text: string;
  contextId?: string;
  history: { role: "user" | "assistant"; text: string }[];
  autoApply: boolean;
};
export function assistantInput(raw: unknown): AssistantInput {
  const v = object(raw);
  keys(v, ["requestId", "text", "contextId", "history", "autoApply"]);
  if (
    typeof v.autoApply !== "boolean" ||
    !Array.isArray(v.history) ||
    v.history.length > 12
  )
    throw new DomainError("invalid_schema");
  const history = v.history.map((raw) => {
    const h = object(raw);
    keys(h, ["role", "text"]);
    if (h.role !== "user" && h.role !== "assistant")
      throw new DomainError("invalid_schema");
    return {
      role: h.role as "user" | "assistant",
      text: textField(h.text, 3000),
    };
  });
  return {
    requestId: idField(v.requestId),
    text: textField(v.text, 4000),
    history,
    autoApply: v.autoApply,
    ...(v.contextId ? { contextId: idField(v.contextId) } : {}),
  };
}
const str = { type: "string" };
const nullable = { type: ["string", "null"] };
const shape = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const assistantSchema = shape({
  reply: str,
  actions: {
    type: "array",
    maxItems: 10,
    items: {
      anyOf: [
        shape({
          type: { const: "record", type: "string" },
          targetId: nullable,
          kind: { type: "string", enum: ["task", "note", "meeting"] },
          title: str,
          status: { type: "string", enum: ["ready", "in_progress", "done"] },
          dueDate: str,
          content: str,
          start: str,
          end: str,
        }),
        shape({
          type: { const: "calendar", type: "string" },
          calendarId: str,
          eventId: nullable,
          title: str,
          start: str,
          end: str,
          attendees: { type: "array", items: str, maxItems: 30 },
          createMeet: { type: "boolean" },
        }),
        shape({
          type: { const: "agenda", type: "string" },
          from: str,
          to: str,
        }),
        shape({
          type: { const: "availability", type: "string" },
          from: str,
          to: str,
          durationMinutes: { type: "integer", minimum: 15, maximum: 480 },
        }),
        shape({
          type: { const: "journal", type: "string" },
          localDate: str,
          content: str,
        }),
      ],
    },
  },
});
export type CalendarAction = {
  type: "calendar";
  calendarId: string;
  eventId: string | null;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  createMeet: boolean;
};
export type ReadAction =
  | { type: "agenda"; from: string; to: string }
  | { type: "availability"; from: string; to: string; durationMinutes: number };
export type AssistantPlan = {
  reply: string;
  proposal?: Proposal;
  calendar?: CalendarAction;
  read?: ReadAction;
  journal?: { localDate: string; content: string };
};
export function stableCommandId(requestId: string) {
  return createHash("sha256")
    .update("assistant:" + requestId)
    .digest("hex")
    .slice(0, 32);
}
export function instant(value: unknown): string {
  const s = textField(value, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{3})?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      s,
    ) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s.slice(0, 10)).toISOString().slice(0, 10) !== s.slice(0, 10)
  )
    throw new DomainError("invalid_timestamp");
  return s;
}
function interval(start: unknown, end: unknown, maxDays = 90) {
  const from = instant(start),
    to = instant(end);
  if (
    Date.parse(to) <= Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > maxDays * 86400000
  )
    throw new DomainError("invalid_interval");
  return { from, to };
}
function date(value: unknown) {
  if (value === "") return "";
  const s = textField(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new DomainError("invalid_date");
  return s;
}
export function validatePlan(
  raw: unknown,
  input: AssistantInput,
  records: WorkspaceRecord[],
): AssistantPlan {
  const v = object(raw);
  keys(v, ["reply", "actions"]);
  const reply = textField(v.reply, 1500);
  if (!Array.isArray(v.actions) || v.actions.length > 10)
    throw new DomainError("invalid_model_output");
  if (!v.actions.length) return { reply };
  const actions = v.actions.map(object),
    types = new Set(actions.map((a) => a.type));
  if (
    types.size !== 1 ||
    (actions[0].type !== "record" && actions.length !== 1)
  )
    throw new DomainError("mixed_actions_require_review");
  if (actions[0].type === "record") {
    const operations = actions.map((a, index) => {
      keys(a, [
        "type",
        "targetId",
        "kind",
        "title",
        "status",
        "dueDate",
        "content",
        "start",
        "end",
      ]);
      if (
        !["task", "note", "meeting"].includes(String(a.kind)) ||
        (a.targetId !== null && typeof a.targetId !== "string")
      )
        throw new DomainError("invalid_model_output");
      const current =
        a.targetId === null ? null : records.find((r) => r.id === a.targetId);
      if (a.targetId !== null && (!current || current.kind !== a.kind))
        throw new DomainError("unknown_entity");
      const title = textField(a.title, 200);
      let data: Record<string, unknown>;
      if (a.kind === "task") {
        if (!["ready", "in_progress", "done"].includes(String(a.status)))
          throw new DomainError("invalid_enum");
        data = { title, status: a.status, dueDate: date(a.dueDate) };
      } else if (a.kind === "note")
        data = { title, content: textField(a.content, 4000) };
      else {
        const times = interval(a.start, a.end);
        data = { title, start: times.from, end: times.to };
      }
      return {
        id: current?.id ?? stableCommandId(input.requestId + "-" + index),
        kind: a.kind as "task" | "note" | "meeting",
        expectedRevision: current?.revision ?? 0,
        data,
      };
    });
    return {
      reply,
      proposal: validateProposal({
        commandId: stableCommandId(input.requestId),
        timezone: ASSISTANT_TIMEZONE,
        operations,
      }),
    };
  }
  const a = actions[0];
  if (a.type === "journal") {
    keys(a, ["type", "localDate", "content"]);
    return {
      reply,
      journal: {
        localDate: journalDate(a.localDate),
        content: textField(a.content, 4000),
      },
    };
  }
  if (a.type === "calendar") {
    keys(a, [
      "type",
      "calendarId",
      "eventId",
      "title",
      "start",
      "end",
      "attendees",
      "createMeet",
    ]);
    const times = interval(a.start, a.end, 31);
    if (
      (a.eventId !== null && typeof a.eventId !== "string") ||
      typeof a.createMeet !== "boolean" ||
      !Array.isArray(a.attendees) ||
      a.attendees.length > 30
    )
      throw new DomainError("invalid_model_output");
    const attendees = a.attendees.map((email) => {
      const s = textField(email, 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        throw new DomainError("invalid_email");
      return s;
    });
    return {
      reply,
      calendar: {
        type: "calendar",
        calendarId: textField(a.calendarId, 300),
        eventId: a.eventId as string | null,
        title: textField(a.title, 200),
        start: times.from,
        end: times.to,
        attendees,
        createMeet: a.createMeet,
      },
    };
  }
  if (a.type === "agenda" || a.type === "availability") {
    keys(
      a,
      a.type === "agenda"
        ? ["type", "from", "to"]
        : ["type", "from", "to", "durationMinutes"],
    );
    const times = interval(a.from, a.to, 14);
    if (a.type === "availability") {
      if (
        !Number.isInteger(a.durationMinutes) ||
        Number(a.durationMinutes) < 15 ||
        Number(a.durationMinutes) > 480
      )
        throw new DomainError("invalid_duration");
      return {
        reply,
        read: {
          type: "availability",
          ...times,
          durationMinutes: Number(a.durationMinutes),
        },
      };
    }
    return { reply, read: { type: "agenda", ...times } };
  }
  throw new DomainError("invalid_model_output");
}

export function freeSlots(
  from: string,
  to: string,
  durationMinutes: number,
  busy: { start: string; end: string }[],
) {
  const duration = durationMinutes * 60000,
    end = Date.parse(to);
  const intervals = busy
    .map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }))
    .sort((a, b) => a.start - b.start);
  if (
    intervals.some(
      (b) =>
        !Number.isFinite(b.start) ||
        !Number.isFinite(b.end) ||
        b.end <= b.start,
    )
  )
    throw new DomainError("availability_unknown");
  const slots: { start: string; end: string }[] = [];
  let cursor = Math.max(Date.parse(from), Date.now());
  // Offer starts on quarter-hour boundaries, at most six options.
  cursor = Math.ceil(cursor / 900000) * 900000;
  for (const block of [...intervals, { start: end, end }]) {
    while (
      cursor + duration <= Math.min(block.start, end) &&
      slots.length < 6
    ) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(cursor + duration).toISOString(),
      });
      cursor += duration;
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= end || slots.length >= 6) break;
  }
  return slots;
}
