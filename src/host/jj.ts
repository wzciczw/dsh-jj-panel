import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface RunResult {
  code: number;
  out: string;
  err: string;
  truncated: boolean;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface Runner {
  run(argv: string[], options?: RunOptions): Promise<RunResult>;
}

/** winget install location seen on this machine; used only when PATH lookup is not enough. */
const WINGET_JJ =
  "C:\\Users\\wzcpu\\AppData\\Local\\Microsoft\\WinGet\\Packages\\jj-vcs.jj_Microsoft.Winget.Source_8wekyb3d8bbwe\\jj.exe";

/**
 * Resolve the jj binary: explicit config, then JJ_BIN, then PATH, then the
 * known winget location. Everything else is left to the caller's error state.
 */
export function resolveJjPath(configured?: string): string {
  if (configured !== undefined && configured !== "" && existsSync(configured)) return configured;
  const fromEnv = process.env.JJ_BIN;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  if (existsSync(WINGET_JJ)) return WINGET_JJ;
  return "jj";
}

/**
 * Spawn jj with an argv array (never a shell string), a deadline and an output
 * cap. `--no-pager --color=never` is prepended so every command is parseable.
 */
export function createRunner(jjPath: string, defaults: { timeoutMs: number; maxBytes: number }): Runner {
  return {
    run(argv, options = {}) {
      const timeoutMs = options.timeoutMs ?? defaults.timeoutMs;
      const maxBytes = options.maxBytes ?? defaults.maxBytes;
      return new Promise<RunResult>((resolve) => {
        const child = spawn(jjPath, ["--no-pager", "--color=never", ...argv], {
          cwd: options.cwd,
          windowsHide: true,
          env: {
            ...process.env,
            // jj never prompts; a stray credential prompt would only burn the deadline.
            GIT_TERMINAL_PROMPT: "0"
          }
        });
        let out = "";
        let err = "";
        let truncated = false;
        let settled = false;
        const finish = (result: RunResult): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          truncated = true;
          child.kill();
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (out.length + chunk.length > maxBytes) {
            truncated = true;
            out += chunk.slice(0, Math.max(0, maxBytes - out.length));
            child.kill();
            return;
          }
          out += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          if (err.length < maxBytes) err += chunk;
        });
        child.on("error", (error) => finish({ code: -1, out, err: String(error), truncated }));
        child.on("close", (code) => finish({ code: code ?? -1, out, err, truncated }));
      });
    }
  };
}
