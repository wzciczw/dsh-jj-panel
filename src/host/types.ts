/** Wire model shared by the host and the browser half. */

export interface JjCommit {
  changeId: string;
  commitId: string;
  parents: string[];
  bookmarks: string[];
  tags: string[];
  empty: boolean;
  conflict: boolean;
  divergent: boolean;
  subject: string;
}

export interface JjFileChange {
  status: string;
  path: string;
}

export interface JjSnapshot {
  root: string;
  version: string;
  current: JjCommit | null;
  bookmarks: { name: string; target: string }[];
  tags: { name: string; target: string }[];
}

export interface JjShowResult {
  commit: JjCommit;
  message: string;
  author: { name: string; email: string; timestamp: string };
  committer: { name: string; email: string; timestamp: string };
  files: JjFileChange[];
}

export interface JjDiffResult {
  patch: string;
  truncated: boolean;
}

export interface RpcOk<T> {
  ok: true;
  value: T;
}

export interface RpcError {
  ok: false;
  error: { code: string; message?: string };
}

export type RpcResult<T> = RpcOk<T> | RpcError;

export function ok<T>(value: T): RpcOk<T> {
  return { ok: true, value };
}

export function fail(code: string, message?: string): RpcError {
  return { ok: false, error: { code, ...(message === undefined ? {} : { message }) } };
}
