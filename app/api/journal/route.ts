import { DomainError, keys, object } from "../../../src/domain/contracts.ts";
import { boundedJson, failure, guard } from "../../../src/server/http.ts";
import { journalDate, personalWrite } from "../../../src/journal/personal.ts";
import { personalJournalStore } from "../../../src/journal/personal-store.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  try {
    guard(request);
    const url = new URL(request.url);
    if (
      [...url.searchParams.keys()].some(
        (key) => !["date", "view"].includes(key),
      ) ||
      url.searchParams.getAll("date").length > 1 ||
      url.searchParams.getAll("view").length > 1
    )
      throw new DomainError("invalid_schema");
    const view = url.searchParams.get("view") ?? "day";
    if (!["day", "history", "agents"].includes(view))
      throw new DomainError("invalid_schema");
    const date =
      view === "agents" ? null : journalDate(url.searchParams.get("date"));
    const store = await personalJournalStore(request, headers);
    try {
      return Response.json(
        view === "agents"
          ? await store.agents()
          : view === "history"
            ? { entries: await store.history(date!) }
            : await store.day(date!),
        { headers },
      );
    } finally {
      store.close();
    }
  } catch (error) {
    return failure(error, headers);
  }
}
export async function POST(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  try {
    guard(request, true);
    const input = object(await boundedJson(request));
    keys(input, ["action", "entry"]);
    if (input.action !== "save") throw new DomainError("invalid_schema");
    const entry = personalWrite(input.entry);
    const store = await personalJournalStore(request, headers);
    try {
      return Response.json({ entry: await store.save(entry) }, { headers });
    } finally {
      store.close();
    }
  } catch (error) {
    return failure(error, headers);
  }
}
