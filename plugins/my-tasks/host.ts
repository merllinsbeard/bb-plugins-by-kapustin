import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { hostContract, outputSchema, resultSchema } from "./background.ts";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    run: async (input, context) => {
      const dir = join(context.experimental_paths.tempDir, input.jobId);
      await mkdir(dir, { recursive: true });
      const schema = join(dir, "schema.json"),
        output = join(dir, "result.json");
      await writeFile(schema, JSON.stringify(outputSchema));
      try {
        await new Promise<void>((resolve, reject) => {
          const args = [
            "exec",
            "--ephemeral",
            "--skip-git-repo-check",
            "--model",
            input.model,
            "-c",
            `model_reasoning_effort="${input.effort}"`,
            "-c",
            'approval_policy="never"',
            "--sandbox",
            "read-only",
            "--output-schema",
            schema,
            "--output-last-message",
            output,
            "--color",
            "never",
            "-C",
            dir,
            "-",
          ];
          const child = spawn("codex", args, {
            stdio: ["pipe", "ignore", "pipe"],
            detached: process.platform !== "win32",
          });
          let stderr = "",
            stopped = false,
            killTimer: ReturnType<typeof setTimeout> | undefined;
          const kill = () => {
            try {
              if (process.platform === "win32") child.kill("SIGTERM");
              else if (child.pid) process.kill(-child.pid, "SIGTERM");
            } catch {}
            killTimer = setTimeout(() => {
              try {
                if (process.platform === "win32") child.kill("SIGKILL");
                else if (child.pid) process.kill(-child.pid, "SIGKILL");
              } catch {}
            }, 1000);
          };
          const abort = () => {
            stopped = true;
            kill();
          };
          const timeout = setTimeout(() => {
            stopped = true;
            kill();
          }, 600000);
          context.signal.addEventListener("abort", abort, { once: true });
          if (context.signal.aborted) abort();
          child.stderr.on("data", (chunk) => {
            stderr = (stderr + chunk.toString()).slice(-6000);
          });
          child.stdin.on("error", () => {});
          child.stdin.end(input.prompt);
          const cleanup = () => {
            clearTimeout(timeout);
            if (killTimer) clearTimeout(killTimer);
            context.signal.removeEventListener("abort", abort);
          };
          child.on("error", (error) => {
            cleanup();
            reject(new Error(`Could not start Codex: ${error.message}`));
          });
          child.on("close", (code) => {
            cleanup();
            if (stopped)
              reject(
                new Error(
                  "Background work was stopped or timed out",
                ),
              );
            else if (code !== 0)
              reject(
                new Error(
                  /auth|unauthorized|login|401/i.test(stderr)
                    ? "Sign in to Codex on the execution host."
                    : `Codex exited with an error (${code}). Check gpt-6-astra availability and your account limits.`,
                ),
              );
            else resolve();
          });
        });
        return resultSchema.parse(JSON.parse(await readFile(output, "utf8")));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
});
