import {
  DomainError,
  idField,
  keys,
  object,
  textField,
} from "../domain/contracts.ts";
import { localDateAt, timezone } from "./contracts.ts";
import type { DiaryEntry } from "./contracts.ts";

export type PersonalEntry = {
  localDate: string;
  timezone: string;
  content: string;
  revision: number;
  updatedAt: string;
};
export type PersonalWrite = Omit<PersonalEntry, "revision" | "updatedAt"> & {
  requestId: string;
  expectedRevision: number;
};
export type JournalDay = {
  entry: PersonalEntry | null;
  recent: Pick<PersonalEntry, "localDate" | "revision" | "updatedAt">[];
};
export type AgentJournalView = {
  diaries: DiaryEntry[];
  names: Record<string, string>;
  enabled: boolean;
};
export interface PersonalJournalPort {
  day(date: string): Promise<JournalDay>;
  save(input: PersonalWrite): Promise<PersonalEntry>;
  history(date: string): Promise<PersonalEntry[]>;
  agents(): Promise<AgentJournalView>;
  close(): void;
}
export function journalDate(value: unknown): string {
  const date = textField(value, 10);
  if (
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new DomainError("invalid_date");
  return date;
}
export function personalWrite(raw: unknown, now = Date.now()): PersonalWrite {
  const input = object(raw);
  keys(input, [
    "requestId",
    "localDate",
    "timezone",
    "content",
    "expectedRevision",
  ]);
  const zone = timezone(input.timezone),
    date = journalDate(input.localDate);
  if (date > localDateAt(now, zone))
    throw new DomainError("journal_future_date");
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    Number(input.expectedRevision) < 0 ||
    Number(input.expectedRevision) >= Number.MAX_SAFE_INTEGER
  )
    throw new DomainError("invalid_revision");
  return {
    requestId: idField(input.requestId),
    localDate: date,
    timezone: zone,
    content: textField(input.content, 12000),
    expectedRevision: Number(input.expectedRevision),
  };
}
export async function preparePersonalJournal(
  store: Pick<PersonalJournalPort, "day">,
  requestId: string,
  localDate: string,
  content: string,
  zone: string,
): Promise<PersonalWrite> {
  const { entry } = await store.day(journalDate(localDate));
  // The model supplies new text only. Appending happens here against the actual owner entry.
  return personalWrite({
    requestId,
    localDate,
    timezone: entry?.timezone ?? zone,
    content: entry ? `${entry.content}\n\n${content}` : content,
    expectedRevision: entry?.revision ?? 0,
  });
}
