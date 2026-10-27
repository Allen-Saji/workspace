import { createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DomainError, object } from "../domain/contracts.ts";
import { runtimeConfig } from "../server/config.ts";
import { requestClient, requireUser } from "../server/supabase.ts";
import { enabled, hostedEnabled, testHarness } from "../connections/http.ts";
import { journalDate, personalWrite } from "./personal.ts";
import type {
  AgentJournalView,
  JournalDay,
  PersonalEntry,
  PersonalJournalPort,
} from "./personal.ts";

export function localPersonalJournal(
  path = resolve(".data/personal-journal.sqlite"),
): PersonalJournalPort {
  mkdirSync(resolve(path, ".."), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS personal_journals(date TEXT PRIMARY KEY,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personal_journal_versions(request TEXT PRIMARY KEY,date TEXT NOT NULL,revision INTEGER NOT NULL,digest TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(date,revision));`);
  function get(date: string): PersonalEntry | null {
    const row = db
      .prepare("SELECT body FROM personal_journals WHERE date=?")
      .get(journalDate(date));
    return row ? JSON.parse(String(row.body)) : null;
  }
  return {
    async day(date) {
      return {
        entry: get(date),
        recent: db
          .prepare(
            "SELECT body FROM personal_journals ORDER BY date DESC LIMIT 90",
          )
          .all()
          .map((row) => {
            const entry = JSON.parse(String(row.body)) as PersonalEntry;
            return {
              localDate: entry.localDate,
              revision: entry.revision,
              updatedAt: entry.updatedAt,
            };
          }),
      };
    },
    async save(raw) {
      const input = personalWrite(raw),
        digest = createHash("sha256")
          .update(JSON.stringify(input))
          .digest("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        const prior = db
          .prepare(
            "SELECT digest,body FROM personal_journal_versions WHERE request=?",
          )
          .get(input.requestId);
        if (prior) {
          if (prior.digest !== digest)
            throw new DomainError("idempotency_conflict");
          db.exec("COMMIT");
          return JSON.parse(String(prior.body)) as PersonalEntry;
        }
        const previous = get(input.localDate);
        if ((previous?.revision ?? 0) !== input.expectedRevision)
          throw new DomainError("journal_revision_conflict");
        if (previous && previous.timezone !== input.timezone)
          throw new DomainError("timezone_conflict");
        const entry: PersonalEntry = {
          localDate: input.localDate,
          timezone: input.timezone,
          content: input.content,
          revision: input.expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        };
        const body = JSON.stringify(entry);
        db.prepare(
          "INSERT INTO personal_journals VALUES(?,?) ON CONFLICT(date) DO UPDATE SET body=excluded.body",
        ).run(input.localDate, body);
        db.prepare(
          "INSERT INTO personal_journal_versions VALUES(?,?,?,?,?)",
        ).run(input.requestId, input.localDate, entry.revision, digest, body);
        db.exec("COMMIT");
        return entry;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async history(date) {
      return db
        .prepare(
          "SELECT body FROM personal_journal_versions WHERE date=? ORDER BY revision DESC LIMIT 20",
        )
        .all(journalDate(date))
        .map((row) => JSON.parse(String(row.body)));
    },
    async agents() {
      if (!enabled()) return { diaries: [], names: {}, enabled: false };
      const harness = testHarness();
      return {
        diaries: harness.journal("local-test-owner", "isolated-connection-test")
          .diaries,
        names: Object.fromEntries(
          harness
            .list("local-test-owner", "isolated-connection-test")
            .map((c) => [c.id, c.displayName]),
        ),
        enabled: true,
      };
    },
    close() {
      db.close();
    },
  };
}

export async function personalJournalStore(
  request: Request,
  headers: Headers,
): Promise<PersonalJournalPort> {
  const config = runtimeConfig();
  if (config.mode === "sqlite") return localPersonalJournal();
  const client = requestClient(request, config, headers);
  await requireUser(client);
  async function call(action: string, payload: Record<string, unknown>) {
    const { data, error } = await client.rpc("workspace_personal_journal", {
      action,
      payload,
    });
    const known = [
      "auth_required",
      "workspace_not_provisioned",
      "journal_revision_conflict",
      "idempotency_conflict",
      "timezone_conflict",
      "invalid_date",
      "journal_future_date",
      "invalid_revision",
      "invalid_schema",
      "invalid_text",
      "invalid_timezone",
    ];
    if (error)
      throw new DomainError(
        known.includes(error.message) ? error.message : "storage_unavailable",
      );
    return object(data);
  }
  return {
    day: async (date) =>
      (await call("day", {
        localDate: journalDate(date),
      })) as unknown as JournalDay,
    save: async (input) =>
      (await call("save", personalWrite(input))).entry as PersonalEntry,
    history: async (date) =>
      (await call("history", { localDate: journalDate(date) }))
        .entries as PersonalEntry[],
    async agents() {
      const result = (await call("agents", {})) as unknown as AgentJournalView;
      return { ...result, enabled: result.enabled && hostedEnabled() };
    },
    close() {},
  };
}
