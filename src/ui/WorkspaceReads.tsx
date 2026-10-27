"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ReadCache } from "./read-cache";

type StoredResponse = {
  body: string;
  status: number;
  headers: [string, string][];
};
type Reads = {
  read: (path: string, options?: { signal?: AbortSignal }) => Promise<Response>;
  peek: <T>(path: string) => T | undefined;
  invalidate: (prefix?: string) => void;
};
const Context = createContext<Reads | null>(null);
class UncachedResponse extends Error {
  constructor(readonly response: StoredResponse) {
    super("Uncached response");
  }
}
const restore = (value: StoredResponse) =>
  new Response(value.body, { status: value.status, headers: value.headers });

export function WorkspaceReads({
  revision,
  children,
}: {
  revision: number;
  children: React.ReactNode;
}) {
  // The provider is keyed by workspace identity and never persists private data.
  const [cache] = useState(() => new ReadCache<StoredResponse>());
  useEffect(() => () => cache.invalidate(), [cache]);
  const reads = useMemo<Reads>(() => {
    const key = (path: string) => `${revision}:${path}`;
    return {
      async read(path, options) {
        try {
          const result = await cache.read(
            key(path),
            async (signal) => {
              const response = await fetch(path, {
                cache: "no-store",
                signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
              });
              const stored: StoredResponse = {
                body: await response.text(),
                status: response.status,
                headers: [...response.headers.entries()],
              };
              if (!response.ok) {
                if (response.status === 401 || response.status === 403)
                  cache.invalidate();
                throw new UncachedResponse(stored);
              }
              // Decode now so malformed responses are never cached as successes.
              JSON.parse(stored.body);
              return stored;
            },
            options?.signal,
          );
          return restore(result);
        } catch (error) {
          if (error instanceof UncachedResponse) return restore(error.response);
          throw error;
        }
      },
      peek<T>(path: string) {
        const value = cache.peek(key(path));
        return value ? (JSON.parse(value.body) as T) : undefined;
      },
      invalidate(prefix = "") {
        cache.invalidate(key(prefix));
      },
    };
  }, [cache, revision]);
  return <Context value={reads}>{children}</Context>;
}

export function useWorkspaceReads() {
  const reads = useContext(Context);
  if (!reads) throw new Error("Workspace reads require a workspace provider.");
  return reads;
}
