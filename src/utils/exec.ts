import { execFile } from "node:child_process";

export interface RunResult {
    stdout: string;
    stderr: string;
    code: number | null;
    missing: boolean;
    timedOut: boolean;
}

/** Environment for child processes with anything token-like removed. */
export function safeEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i.test(k)) continue;
        env[k] = v;
    }
    return env;
}

export function run(
    cmd: string,
    args: string[],
    opts: { cwd: string; timeoutMs?: number; maxBuffer?: number },
): Promise<RunResult> {
    return new Promise((resolve) => {
        execFile(
            cmd,
            args,
            {
                cwd: opts.cwd,
                env: safeEnv(),
                timeout: opts.timeoutMs ?? 120_000,
                maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
                windowsHide: true,
            },
            (err, stdout, stderr) => {
                if (!err) return resolve({ stdout, stderr, code: 0, missing: false, timedOut: false });
                const e = err as { code?: unknown; killed?: boolean };
                resolve({
                    stdout: stdout ?? "",
                    stderr: stderr ?? "",
                    code: typeof e.code === "number" ? e.code : null,
                    missing: e.code === "ENOENT",
                    timedOut: !!e.killed,
                });
            },
        );
    });
}