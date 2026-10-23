/** Wire model the browser half consumes; mirrors src/host/types.ts. */
import type { GraphCommit } from "./graph";

export interface Commit extends GraphCommit {
  bookmarks: string[];
  tags: string[];
  empty: boolean;
  conflict: boolean;
  divergent: boolean;
  subject: string;
}

export interface ShowData {
  commit: Commit;
  message: string;
  author: { name: string; email: string; timestamp: string };
  files: { status: string; path: string }[];
}

/** The snapshot RPC is used only to learn which change is `@`. */
export interface Snapshot {
  root: string;
  version: string;
  current: Commit | null;
  bookmarks: { name: string; target: string }[];
  tags: { name: string; target: string }[];
}

export interface RpcErrorInfo {
  code: string;
  message?: string;
}

export interface RpcResponse<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string; message?: string };
}

export type Rpc = (method: string, payload: Record<string, unknown>) => Promise<RpcResponse<unknown>>;
