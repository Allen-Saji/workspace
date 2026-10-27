import { DomainError } from "../../../src/domain/contracts.ts";
import { guard, boundedJson, failure } from "../../../src/server/http.ts";
import { requestRepository } from "../../../src/server/repository.ts";
import { commandRepository } from "../../../src/server/command-repository.ts";
import {
  assistantConfigured,
  modelRequest,
  callModel,
} from "../../../src/assistant/provider.ts";
import { assistantInput } from "../../../src/assistant/contracts.ts";
import { assistantLedger } from "../../../src/assistant/ledger.ts";
import { runAssistant } from "../../../src/assistant/service.ts";
import { calendarService } from "../../../src/calendar/service.ts";
import { personalJournalStore } from "../../../src/journal/personal-store.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  try {
    guard(request);
    const db = await requestRepository(request, headers);
    try {
      const snapshot = await db.snapshot();
      if (!assistantConfigured())
        return Response.json(
          {
            available: false,
            reason:
              "The assistant is not configured yet. Manual editing is available.",
            timezone: "Asia/Kolkata",
          },
          { headers },
        );
      const ledger = await assistantLedger(
        request,
        headers,
        snapshot.workspaceId,
      );
      try {
        return Response.json(
          {
            available: true,
            timezone: "Asia/Kolkata",
            budget: await ledger.summary(),
          },
          { headers },
        );
      } finally {
        ledger.close();
      }
    } finally {
      db.close();
    }
  } catch (e) {
    return failure(e, headers);
  }
}
export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  try {
    guard(request, true);
    const input = assistantInput(await boundedJson(request));
    const db = await requestRepository(request, headers);
    try {
      const snapshot = await db.snapshot();
      if (!assistantConfigured())
        throw new DomainError("assistant_not_enabled");
      const body = modelRequest(input, snapshot.records); // Validate input bounds before reserving any budget.
      const ledger = await assistantLedger(
        request,
        headers,
        snapshot.workspaceId,
      );
      try {
        const commands = await commandRepository(request, headers);
        try {
          const calendar = await calendarService(request, headers);
          try {
            const result = await runAssistant({
              input,
              records: snapshot.records,
              workspaceId: snapshot.workspaceId,
              ledger,
              calendar,
              journal: {
                async day(date) {
                  const journal = await personalJournalStore(request, headers);
                  try {
                    return await journal.day(date);
                  } finally {
                    journal.close();
                  }
                },
              },
              apply: (p) => commands.apply(p),
              model: async () => {
                // Calendar details are included only for explicit calendar-edit requests.
                // Agenda and availability requests use server-side reads after planning.
                let events: unknown[] = [];
                try {
                  if (
                    /\b(move|reschedule|edit|change|update)\b/i.test(
                      input.text,
                    ) &&
                    /\b(meeting|event|appointment|call)\b/i.test(input.text) &&
                    (await calendar.status()).connected
                  ) {
                    const now = new Date();
                    const list = await calendar.events(
                      "primary",
                      now.toISOString(),
                      new Date(now.getTime() + 14 * 86400000).toISOString(),
                    );
                    events = list.events
                      .slice(0, 20)
                      .map((e) => ({
                        id: e.id,
                        calendarId: e.calendarId,
                        title: e.title,
                        start: e.start,
                        end: e.end,
                        attendees: e.attendees,
                      }));
                    if (Buffer.byteLength(JSON.stringify(events)) > 5000)
                      events = [];
                  }
                } catch {
                  /* Explicit calendar reads still report their own failures. */
                }
                return callModel(
                  events.length
                    ? modelRequest(input, snapshot.records, new Date(), events)
                    : body,
                );
              },
            });
            return Response.json(result, { headers });
          } finally {
            calendar.close();
          }
        } finally {
          commands.close();
        }
      } finally {
        ledger.close();
      }
    } finally {
      db.close();
    }
  } catch (e) {
    return failure(e, headers);
  }
}
