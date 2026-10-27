import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";

test("hosted personal journals isolate owners, preserve retries/history and reject direct or revoked access", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid);
      create function auth.uid() returns uuid language sql stable as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      grant usage on schema auth to authenticated,anon;
      insert into auth.users values('${alice}'),('${bob}');insert into auth.sessions values('${alice}','${alice}'),('${bob}','${bob}');`);
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261023132335_workspace_owner_isolation.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`create table workspace_private.agent_activation(singleton boolean primary key, enabled boolean);insert into workspace_private.agent_activation values(true,false);
      create table workspace_private.agent_connections(id uuid,workspace_id uuid,display_name text);
      create table workspace_private.agent_diaries(workspace_id uuid,connection_id uuid,local_date date,body jsonb);`);
    await db.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261026180836_personal_journal.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query(
      "insert into workspace_private.workspaces(owner_id) values($1),($2)",
      [alice, bob],
    );
    await db.exec(`insert into workspace_private.agent_connections
      select owner_id,id,case when owner_id='${alice}' then 'Alice agent' else 'Bob agent' end from workspace_private.workspaces;
      insert into workspace_private.agent_diaries
      select id,owner_id,'2026-10-25',jsonb_build_object('connectionId',owner_id,'localDate','2026-10-25') from workspace_private.workspaces;`);
    async function user(id: string) {
      await db.exec("reset role");
      await db.query(
        "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
        [id, JSON.stringify({ session_id: id, is_anonymous: false })],
      );
      await db.exec("set role authenticated");
    }
    async function call(
      action = "day",
      payload: Record<string, unknown> = { localDate: "2026-10-25" },
    ) {
      const result = await db.query<{
        value: {
          entry: { revision: number; content: string };
          entries: { revision: number }[];
          recent: unknown[];
          diaries: unknown[];
          names: Record<string, string>;
          enabled: boolean;
        };
      }>("select public.workspace_personal_journal($1,$2::jsonb) value", [
        action,
        JSON.stringify(payload),
      ]);
      return result.rows[0].value;
    }
    const input = {
      requestId: "save1",
      localDate: "2026-10-25",
      timezone: "Asia/Kolkata",
      content: "Alice private journal",
      expectedRevision: 0,
    };
    await user(alice);
    const first = await call("save", input);
    assert.equal(first.entry.revision, 1);
    await call("save", {
      ...input,
      requestId: "save2",
      content: "Alice revised",
      expectedRevision: 1,
    });
    assert.deepEqual(await call("save", input), first);
    await assert.rejects(
      call("save", { ...input, content: "Different replay" }),
      /idempotency_conflict/,
    );
    await assert.rejects(
      call("save", { ...input, requestId: "stale" }),
      /journal_revision_conflict/,
    );
    await assert.rejects(
      call("save", {
        ...input,
        requestId: "zone",
        timezone: "UTC",
        expectedRevision: 2,
      }),
      /timezone_conflict/,
    );
    await assert.rejects(
      call("save", { ...input, requestId: "future", localDate: "2099-01-01" }),
      /journal_future_date/,
    );
    await assert.rejects(
      call("save", { ...input, workspaceId: bob }),
      /invalid_schema/,
    );
    assert.deepEqual(
      (await call("history")).entries.map((e) => e.revision),
      [2, 1],
    );
    await assert.rejects(
      db.query("select * from workspace_private.personal_journals"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from workspace_private.personal_journal_versions"),
      /permission denied/,
    );
    const agents = await call("agents", {});
    assert.equal(agents.enabled, false);
    assert.equal(agents.diaries.length, 1);
    assert.deepEqual(Object.values(agents.names), ["Alice agent"]);
    await user(bob);
    assert.deepEqual(Object.values((await call("agents", {})).names), [
      "Bob agent",
    ]);
    assert.equal((await call()).entry, null);
    assert.deepEqual((await call("history")).entries, []);
    await call("save", { ...input, content: "Bob private journal" });
    await user(alice);
    assert.equal((await call()).entry.content, "Alice revised");
    await db.exec("reset role;set role anon");
    await assert.rejects(call(), /permission denied/);
    await db.exec("reset role");
    await db.query("delete from auth.sessions where user_id=$1", [alice]);
    await user(alice);
    await assert.rejects(call(), /auth_required/);
  } finally {
    await db.close();
  }
});
