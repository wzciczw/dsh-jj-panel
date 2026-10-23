import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { createRunner, resolveJjPath, type Runner } from "./jj.js";
import { JjError, diff, log, show, snapshot } from "./queries.js";
import { runOp, type OpParams } from "./ops.js";
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
  action?: string;
  confirm?: boolean;
  params?: OpParams;
}

interface HostContext {
  get?(key: string): unknown;
}

interface SessionService {
  get?(id: string): { header?: { cwd?: string } } | undefined;
}

/**
 * Typert service exposed to the browser half as namespace `jjPanel`.
 *
 * Members are TypeScript-private (plain JS properties/methods), never ECMAScript
 * `#private`: the gateway invokes methods through a Cordis proxy receiver, and a
 * `#private` access from that proxy throws "Receiver must be an instance of class".
 */
export class JjPanelService extends TypertRemoteService {
  private readonly runner: Runner;
  private readonly limit: number;
  private readonly hostCtx: HostContext;

  constructor(ctx: unknown, config: JjPanelConfig = {}) {
    super(ctx, "jjPanel");
    this.hostCtx = ctx as HostContext;
    this.runner = createRunner(resolveJjPath(config.jjPath), {
      timeoutMs: config.timeoutMs ?? 8000,
      maxBytes: config.maxBytes ?? 4 * 1024 * 1024
    });
    this.limit = Math.min(500, Math.max(1, Math.trunc(config.defaultLimit ?? 120)));
  }

  private cwdOf(sessionId?: string): string | undefined {
    if (sessionId === undefined) return undefined;
    try {
      const sessions = this.hostCtx.get?.("sessions") as SessionService | undefined;
      return sessions?.get?.(sessionId)?.header?.cwd;
    } catch {
      return undefined;
    }
  }

  private async withRepo<T>(req: JjPanelRequest, work: (root: string) => Promise<T>): Promise<RpcResult<T>> {
    const cwd = this.cwdOf(req.sessionId);
    if (cwd === undefined || cwd === "") return fail("cwd-unavailable");
    try {
      const rootOut = await this.runner.run(["root"], { cwd });
      if (rootOut.code !== 0) {
        return fail(
          rootOut.code === -1 && /ENOENT/iu.test(rootOut.err) ? "jj-missing" : "not-a-repo",
          rootOut.err.trim()
        );
      }
      return ok(await work(rootOut.out.trim()));
    } catch (error) {
      if (error instanceof JjError) {
        // Preserve actionable codes (confirmation-required, invalid-*, ...);
        // only execution failures carry jj-error.
        return fail(error.code, error.message);
      }
      return fail("jj-error", error instanceof Error ? error.message : String(error));
    }
  }

  @Remote("snapshot")
  async snapshot(req: JjPanelRequest): Promise<RpcResult<JjSnapshot>> {
    const cwd = this.cwdOf(req.sessionId);
    if (cwd === undefined || cwd === "") return fail("cwd-unavailable");
    try {
      return ok(await snapshot(this.runner, cwd));
    } catch (error) {
      if (error instanceof JjError && error.code === "jj-missing") return fail("jj-missing");
      return fail("not-a-repo", error instanceof Error ? error.message : String(error));
    }
  }

  @Remote("log")
  async log(req: JjPanelRequest): Promise<RpcResult<{ commits: unknown }>> {
    const raw = req.revset ?? "::@";
    const revset = raw.trim() === "" ? "::@" : raw;
    if (!isSafeRevset(revset)) return fail("invalid-revset", revset);
    const limit = Math.min(500, Math.max(1, Math.trunc(req.limit ?? this.limit)));
    const result = await this.withRepo(req, (root) => log(this.runner, root, revset, limit));
    if (!result.ok) return result;
    return ok({ commits: result.value });
  }

  @Remote("show")
  async show(req: JjPanelRequest): Promise<RpcResult<JjShowResult>> {
    const change = req.change ?? "";
    if (!isSafeChange(change)) return fail("invalid-change", change);
    return this.withRepo(req, (root) => show(this.runner, root, change));
  }

  @Remote("diff")
  async diff(req: JjPanelRequest): Promise<RpcResult<JjDiffResult>> {
    const change = req.change ?? "";
    const path = req.path ?? "";
    if (!isSafeChange(change)) return fail("invalid-change", change);
    if (!isSafePath(path)) return fail("invalid-path", path);
    return this.withRepo(req, (root) => diff(this.runner, root, change, path));
  }

  @Remote("op")
  async op(req: JjPanelRequest): Promise<RpcResult<{ action: string; stdout: string }>> {
    const action = req.action ?? "";
    if (action === "") return fail("invalid-action");
    const result = await this.withRepo(req, (root) =>
      runOp(this.runner, root, {
        action,
        ...(req.confirm === undefined ? {} : { confirm: req.confirm }),
        ...(req.params === undefined ? {} : { params: req.params })
      })
    );
    if (!result.ok) return result;
    return ok({ action: result.value.action, stdout: result.value.stdout });
  }
}
