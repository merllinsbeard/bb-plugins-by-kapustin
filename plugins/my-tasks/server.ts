import { randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { hostContract } from "./background.ts";

const title = z.string().trim().min(1).max(500);
export const sectionIcons = [
  "📁",
  "💼",
  "🏠",
  "💡",
  "🎯",
  "📚",
  "🛠️",
  "🌱",
  "🎨",
  "✈️",
  "💪",
  "🛒",
  "💻",
  "❤️",
  "⭐",
  "🧩",
] as const;
const sectionSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(60),
  icon: z.enum(sectionIcons),
});
export type Section = z.infer<typeof sectionSchema>;
const stepSchema = z.object({
  id: z.string(),
  title,
  done: z.boolean(),
  parentId: z.string().nullable().default(null),
});
const suggestionSchema = z.object({
  id: z.string(),
  title,
  parentId: z.string().nullable().default(null),
});
const jobSchema = z.object({
  id: z.string(),
  mode: z.enum(["expand", "decompose", "help"]),
  stepId: z.string().nullable(),
  targetTitle: z.string(),
  instruction: z.string(),
  status: z.enum(["queued", "running", "done", "error", "cancelled"]),
  answer: z.string(),
  error: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;
const linkSchema = z.object({
  id: z.string(),
  mode: z.string(),
  createdAt: z.string(),
});
const taskSchema = z.object({
  id: z.string(),
  title,
  notes: z.string().max(20000),
  sectionId: z.string().nullable().default(null),
  done: z.boolean(),
  deleted: z.boolean(),
  steps: z.array(stepSchema).max(200),
  suggestions: z.array(suggestionSchema).max(1000),
  threads: z.array(linkSchema),
  jobs: z.array(jobSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;
const modeSchema = z.enum(["expand", "decompose", "help"]);
export type Mode = z.infer<typeof modeSchema>;
export const rpcContract = defineRpcContract({
  list: { input: z.null(), output: z.array(taskSchema) },
  add: {
    input: z.object({ title, sectionId: z.string().nullable().default(null) }),
    output: taskSchema,
  },
  sections: { input: z.null(), output: z.array(sectionSchema) },
  sectionSave: {
    input: z.object({
      id: z.string().optional(),
      name: sectionSchema.shape.name,
      icon: sectionSchema.shape.icon,
    }),
    output: sectionSchema,
  },
  sectionRemove: {
    input: z.object({ id: z.string() }),
    output: z.object({ removed: z.boolean() }),
  },
  patch: {
    input: z.object({
      id: z.string(),
      changes: z
        .object({
          title: title.optional(),
          notes: z.string().max(20000).optional(),
          sectionId: z.string().nullable().optional(),
          done: z.boolean().optional(),
          deleted: z.boolean().optional(),
        })
        .strict(),
    }),
    output: taskSchema,
  },
  stepAdd: { input: z.object({ id: z.string(), title }), output: taskSchema },
  stepToggle: {
    input: z.object({ id: z.string(), stepId: z.string(), done: z.boolean() }),
    output: taskSchema,
  },
  stepRemove: {
    input: z.object({ id: z.string(), stepId: z.string() }),
    output: taskSchema,
  },
  accept: {
    input: z.object({ id: z.string(), ids: z.array(z.string()).max(50) }),
    output: taskSchema,
  },
  dismiss: {
    input: z.object({
      id: z.string(),
      stepId: z.string().nullable().default(null),
    }),
    output: taskSchema,
  },
  assist: {
    input: z.object({
      id: z.string(),
      mode: modeSchema,
      stepId: z.string().nullable().default(null),
      instruction: z.string().max(10000).default(""),
      requestId: z.string().uuid(),
    }),
    output: jobSchema,
  },
  cancel: {
    input: z.object({ id: z.string(), jobId: z.string() }),
    output: taskSchema,
  },
});

export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
    `CREATE TABLE launches (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL)`,
    `CREATE TABLE sections (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL)`,
    `UPDATE tasks SET data=json_remove(data,'$.day')`,
  ]);
  const get = (id: string): Task => {
    const row = db.prepare("SELECT data FROM tasks WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new Error("Task not found");
    return taskSchema.parse(JSON.parse(row.data));
  };
  const list = (): Task[] =>
    (
      db.prepare("SELECT data FROM tasks ORDER BY rowid").all() as {
        data: string;
      }[]
    ).map((r) => taskSchema.parse(JSON.parse(r.data)));
  const save = (task: Task) => {
    task.updatedAt = new Date().toISOString();
    taskSchema.parse(task);
    db.prepare(
      "INSERT INTO tasks(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
    ).run(task.id, JSON.stringify(task));
    bb.realtime.publish("changed", {});
    return task;
  };
  const change = (id: string, fn: (t: Task) => void) => {
    const t = get(id);
    fn(t);
    return save(t);
  };
  const sections = (): Section[] =>
    (
      db
        .prepare("SELECT id,name,icon FROM sections ORDER BY rowid")
        .all() as Section[]
    ).map((s) => sectionSchema.parse(s));
  const validateSection = (id: string | null | undefined) => {
    if (id && !sections().some((s) => s.id === id))
      throw new Error("Section not found");
  };
  const add = (text: string, sectionId: string | null) => {
    validateSection(sectionId);
    return save({
      id: randomUUID(),
      title: title.parse(text),
      sectionId,
      notes: "",
      done: false,
      deleted: false,
      steps: [],
      suggestions: [],
      threads: [],
      jobs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };
  const propose = (id: string, titles: string[]) =>
    change(id, (t) => {
      if (t.deleted) throw new Error("Task is in the trash");
      const parsed = z.array(title).min(1).max(50).parse(titles);
      t.suggestions = t.suggestions
        .filter((s) => s.parentId !== null)
        .concat(
          parsed.map((title) => ({ id: randomUUID(), title, parentId: null })),
        );
    });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const controllers = new Map<string, AbortController>();
  let wake: () => void = () => {};
  // Interrupted jobs are visible failures, never automatically repeated after reload.
  for (const task of list())
    if (task.jobs.some((j) => j.status === "running"))
      change(task.id, (t) => {
        for (const j of t.jobs)
          if (j.status === "running") {
            j.status = "error";
            j.error = "Work was interrupted by a restart. You can run it again.";
          }
      });
  const active = (j: Job) => j.status === "queued" || j.status === "running";
  const cancelJobs = (task: Task, stepIds?: Set<string>) => {
    for (const j of task.jobs)
      if (active(j) && (!stepIds || (j.stepId && stepIds.has(j.stepId)))) {
        j.status = "cancelled";
        j.finishedAt = new Date().toISOString();
        controllers.get(j.id)?.abort();
      }
  };
  bb.background.service("assistant", {
    async start(signal) {
      while (!signal.aborted) {
        const task = list().find(
          (t) => !t.deleted && t.jobs.some((j) => j.status === "queued"),
        );
        const job = task?.jobs.find((j) => j.status === "queued");
        if (!task || !job) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              wake = () => {};
              resolve();
            };
            const timer = setTimeout(done, 1000);
            wake = done;
            signal.addEventListener("abort", done, { once: true });
            if (signal.aborted) done();
          });
          continue;
        }
        const controller = new AbortController();
        controllers.set(job.id, controller);
        change(task.id, (t) => {
          t.jobs.find((j) => j.id === job.id)!.status = "running";
        });
        try {
          const hosts = await bb.sdk.hosts.list();
          const machine =
            hosts.find(
              (h) => h.status === "connected" && h.type === "persistent",
            ) ?? hosts.find((h) => h.status === "connected");
          if (!machine)
            throw new Error("No connected host is available for background work.");
          const target = job.stepId
            ? task.steps.find((s) => s.id === job.stepId)
            : null;
          if (job.stepId && !target) throw new Error("The subtask was deleted.");
          const prompt = `You are a background assistant for a personal checklist. Respond in English. ${job.mode === "decompose" ? "Break the selected task into 3–7 concrete, short steps." : job.mode === "expand" ? "Explore the idea: a concrete outcome, options, and related actions." : "Help with the selected task: produce a useful result (text, a calculation, analysis, or a solution), beyond a plan. If information is missing, ask a specific question in your answer."}
Selected objective: ${job.targetTitle}
${target ? "Work ONLY on this subtask. The parent task is provided as context." : ""}
Parent context: ${task.title}
Notes: ${task.notes}
Steps for the selected objective: ${JSON.stringify(task.steps.filter((s) => s.parentId === job.stepId).map((s) => ({ title: s.title, done: s.done })))}
Previous results for the selected objective: ${JSON.stringify(
            task.jobs
              .filter((j) => j.stepId === job.stepId && j.status === "done")
              .slice(-2)
              .map((j) => j.answer.slice(0, 6000)),
          )}
User instructions: ${job.instruction}
Return JSON: answer — the useful result in Markdown; suggestions — an array of suggested steps. Do not create threads, call bb my-tasks, or modify the checklist. Do not mark work as complete. Breaking down tasks and exploring ideas need no tools. For help, you may research available data; do not make external changes or claim an action is complete when you only described it. Return all results as text without saving files. Describe limitations and missing information in answer.`;
          const result = await host.call(
            "run",
            {
              jobId: job.id,
              prompt,
              mode: job.mode,
              model: "gpt-6-astra",
              effort: "low",
            },
            {
              hostId: machine.id,
              signal: AbortSignal.any([signal, controller.signal]),
              timeoutMs: 620000,
            },
          );
          if (signal.aborted) break;
          change(task.id, (t) => {
            const j = t.jobs.find((j) => j.id === job.id)!;
            if (!active(j) || t.deleted) return;
            if (j.stepId && !t.steps.some((s) => s.id === j.stepId)) {
              j.status = "error";
              j.error = "Subtask deleted";
              return;
            }
            j.status = "done";
            j.answer = result.answer;
            j.finishedAt = new Date().toISOString();
            t.suggestions.push(
              ...result.suggestions.map((title) => ({
                id: randomUUID(),
                title,
                parentId: j.stepId,
              })),
            );
          });
        } catch (error) {
          if (signal.aborted) break;
          change(task.id, (t) => {
            const j = t.jobs.find((j) => j.id === job.id)!;
            if (!active(j)) return;
            j.status = "error";
            j.error = error instanceof Error ? error.message : String(error);
            j.finishedAt = new Date().toISOString();
          });
        } finally {
          controllers.delete(job.id);
        }
      }
    },
  });
  bb.rpc.register(rpcContract, {
    list: () => list(),
    add: ({ title, sectionId }) => add(title, sectionId),
    sections: () => sections(),
    sectionSave: ({ id, name, icon }) => {
      const current = sections();
      if (id && !current.some((s) => s.id === id))
        throw new Error("Section not found");
      if (
        current.some(
          (s) =>
            s.id !== id &&
            s.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new Error("A section with this name already exists");
      if (!id && current.length >= 100)
        throw new Error("You can create up to 100 sections");
      const section = { id: id ?? randomUUID(), name, icon };
      db.prepare(
        "INSERT INTO sections(id,name,icon) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,icon=excluded.icon",
      ).run(section.id, name, icon);
      bb.realtime.publish("changed", {});
      return section;
    },
    sectionRemove: ({ id }) => {
      const removed = db.transaction(() => {
        for (const t of list())
          if (t.sectionId === id)
            change(t.id, (t) => {
              t.sectionId = null;
            });
        return (
          db.prepare("DELETE FROM sections WHERE id=?").run(id).changes > 0
        );
      })();
      bb.realtime.publish("changed", {});
      return { removed };
    },
    patch: ({ id, changes }) =>
      change(id, (t) => {
        validateSection(changes.sectionId);
        if (changes.deleted) cancelJobs(t);
        Object.assign(t, changes);
      }),
    stepAdd: ({ id, title }) =>
      change(id, (t) => {
        t.steps.push({ id: randomUUID(), title, done: false, parentId: null });
      }),
    stepToggle: ({ id, stepId, done }) =>
      change(id, (t) => {
        const s = t.steps.find((s) => s.id === stepId);
        if (!s) throw new Error("Step not found");
        s.done = done;
      }),
    stepRemove: ({ id, stepId }) =>
      change(id, (t) => {
        const removed = new Set([stepId]);
        let count = 0;
        while (count !== removed.size) {
          count = removed.size;
          for (const s of t.steps)
            if (s.parentId && removed.has(s.parentId)) removed.add(s.id);
        }
        cancelJobs(t, removed);
        t.steps = t.steps.filter((s) => !removed.has(s.id));
        t.suggestions = t.suggestions.filter(
          (s) => !s.parentId || !removed.has(s.parentId),
        );
      }),
    accept: ({ id, ids }) =>
      change(id, (t) => {
        const selected = new Set(ids);
        t.steps.push(
          ...t.suggestions
            .filter((s) => selected.has(s.id))
            .map((s) => ({ ...s, done: false })),
        );
        t.suggestions = t.suggestions.filter((s) => !selected.has(s.id));
      }),
    dismiss: ({ id, stepId }) =>
      change(id, (t) => {
        t.suggestions = t.suggestions.filter((s) => s.parentId !== stepId);
      }),
    cancel: ({ id, jobId }) =>
      change(id, (t) => {
        const j = t.jobs.find((j) => j.id === jobId);
        if (j && active(j)) {
          j.status = "cancelled";
          j.finishedAt = new Date().toISOString();
          controllers.get(j.id)?.abort();
        }
      }),
    assist: ({ id, mode, stepId, instruction, requestId }) => {
      const task = get(id);
      if (task.deleted) throw new Error("Restore the task first");
      const target = stepId ? task.steps.find((s) => s.id === stepId) : null;
      if (stepId && !target) throw new Error("Subtask not found");
      const prior = task.jobs.find(
        (j) => j.id === requestId || (j.stepId === stepId && active(j)),
      );
      if (prior) return prior;
      const job: Job = {
        id: requestId,
        mode,
        stepId,
        targetTitle: target?.title ?? task.title,
        instruction,
        status: "queued",
        answer: "",
        error: "",
        createdAt: new Date().toISOString(),
        finishedAt: null,
      };
      change(id, (t) => {
        if (t.jobs.length >= 50)
          t.jobs = t.jobs
            .filter(active)
            .concat(t.jobs.filter((j) => !active(j)).slice(-30));
        t.jobs.push(job);
      });
      wake();
      return job;
    },
  });
  bb.cli.register({
    name: "my-tasks",
    summary: "Apple Style Tasks personal checklist",
    commands: [
      { name: "list", summary: "List tasks", usage: "bb my-tasks list" },
      { name: "get", summary: "Show task details", usage: "bb my-tasks get <id>" },
      {
        name: "add",
        summary: "Add a task for later",
        usage: "bb my-tasks add <title>",
      },
      {
        name: "propose",
        summary: "Suggest steps for the user to choose",
        usage: "bb my-tasks propose <id> <JSON-array-of-strings>",
      },
    ],
    async run(argv) {
      try {
        const [cmd, id, ...rest] = argv;
        let result: unknown;
        if (cmd === "list")
          result = list()
            .filter((t) => !t.deleted)
            .slice(-100)
            .map(({ id, title, sectionId, done }) => ({
              id,
              title,
              sectionId,
              done,
            }));
        else if (cmd === "get" && id) result = get(id);
        else if (cmd === "add" && id)
          result = add([id, ...rest].join(" "), null);
        else if (cmd === "propose" && id)
          result = propose(id, JSON.parse(rest.join(" ")));
        else
          return {
            exitCode: 1,
            stderr:
              "bb my-tasks list | get <id> | add <title> | propose <id> <JSON array>",
          };
        return { exitCode: 0, stdout: JSON.stringify(result) };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
