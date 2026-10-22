import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createRunner, resolveJjPath, type Runner } from "./jj.js";
import { JjError, diff, log, show, snapshot } from "./queries.js";
import { fail, ok, type JjDiffResult, type JjSnapshot, type JjShowResult, type RpcResult } from "./types.js";
import { isSafeChange, isSafePath, isSafeRevset } from "./validate.js";

export interface JjPanelConfig {
  jjPath?: string;
  timeoutMs?: number;
  maxBytes?: number;
  defaultLimit?: number;
}

export interface JjPanelRequest {
  sessionId?: string;
  revset?: string;
  limit?: number;
  change?: string;
  path?: string;
}

interface HostContext {
  get?(key: string): unknown;
}

interface SessionService {
  get?(id: string): { header?: { cwd?: string } } | undefined;
}

/** Typert service exposed to the browser half as namespace `jjPanel`. */
export class JjPanelService extends TypertRemoteService {
  readonly #runner: Runner;
  readonly #limit: number;
  readonly #ctx: HostContext;

  constructor(ctx: unknown, config: JjPanelConfig = {}) {
    super(ctx, "jjPanel");
    this.#ctx = ctx as HostContext;
    this.#runner = createRunner(resolveJjPath(config.jjPath), {
      timeoutMs: config.timeoutMs ?? 8000,
      maxBytes: config.maxBytes ?? 4 * 1024 * 1024
    });
    this.#limit = Math.min(500, Math.max(1, Math.trunc(config.defaultLimit ?? 120)));
  }

  #cwd(sessionId?: string): string | undefined {
    if (sessionId === undefined) return undefined;
    try {
      const sessions = this.#ctx.get?.("sessions") as SessionService | undefined;
      return sessions?.get?.(sessionId)?.header?.cwd;
    } catch {
      return undefined;
    }
  }

  async #run<T>(
    req: JjPanelRequest,
    work: (root: string) => Promise<T>,
    fallback: string[] = [],
    notFoundCode = "jj-error"
  ): Promise<RpcResult<T>> {
    const cwd = this.#cwd(req.sessionId);
    if (cwd === undefined || cwd === "") return fail("cwd-unavailable");
    try {
      const root = (await snapshotRoot(this.#runner, cwd, fallback)).trim();
      return ok(await work(root));
    } catch (error) {
      if (error instanceof JjError) {
        if (error.code === "jj-missing") return fail("jj-missing");
        if (error.code === "truncated") return fail("truncated");
        if (fallback.length === 0) return fail(notFoundCode, error.message);
        return fail("not-a-repo", error.message);
      }
      return fail("jj-error", error instanceof Error ? error.message : String(error));
    }
  }

  @Remote("snapshot")
  async snapshot(req: JjPanelRequest): Promise<RpcResult<JjSnapshot>> {
    const cwd = this.#cwd(req.sessionId);
    if (cwd === undefined || cwd === "") return fail("cwd-unavailable");
    try {
      return ok(await snapshot(this.#runner, cwd));
    } catch (error) {
      if (error instanceof JjError && error.code === "jj-missing") return fail("jj-missing");
      return fail("not-a-repo", error instanceof Error ? error.message : String(error));
    }
  }

  @Remote("log")
  async log(req: JjPanelRequest): Promise<RpcResult<{ commits: ReturnType<typeof Array.prototype.slice> }>> {
    const raw = req.revset ?? "::@";
    const revset = raw.trim() === "" ? "::@" : raw;
    if (!isSafeRevset(revset)) return fail("invalid-revset", revset);
    const limit = Math.min(500, Math.max(1, Math.trunc(req.limit ?? this.#limit)));
    const result = await this.#run(req, (root) => log(this.#runner, root, revset, limit));
    if (!result.ok) return result;
    return ok({ commits: result.value as never });
  }

  @Remote("show")
  async show(req: JjPanelRequest): Promise<RpcResult<JjShowResult>> {
    const change = req.change ?? "";
    if (!isSafeChange(change)) return fail("invalid-change", change);
    return this.#run(req, (root) => show(this.#runner, root, change));
  }

  @Remote("diff")
  async diff(req: JjPanelRequest): Promise<RpcResult<JjDiffResult>> {
    const change = req.change ?? "";
    const path = req.path ?? "";
    if (!isSafeChange(change)) return fail("invalid-change", change);
    if (!isSafePath(path)) return fail("invalid-path", path);
    return this.#run(req, (root) => diff(this.#runner, root, change, path));
  }
}

/** Resolve the repository root for a working directory (helper kept separate for tests). */
export async function snapshotRoot(
  runner: Runner,
  cwd: string,
  _fallback: string[] = []
): Promise<string> {
  const result = await runner.run(["root"], { cwd });
  if (result.code !== 0) {
    throw new JjError(
      result.code === -1 && /ENOENT/iu.test(result.err) ? "jj-missing" : "not-a-repo",
      result.err.trim() || "not a jj repository"
    );
  }
  return result.out.trim();
}
