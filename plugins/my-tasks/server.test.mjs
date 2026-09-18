import test from "node:test";
import assert from "node:assert/strict";
import {
  createFakePluginHost,
  experimental_scanPublicSdkOnly,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.ts";

const setup = async (
  callHost = async () => ({ answer: "Готово", suggestions: ["Дочерний шаг"] }),
) => {
  const h = createFakePluginHost({
    pluginId: "my-tasks",
    experimental_hostEntry: true,
    experimental_callHostRpc: callHost,
    sdk: {
      hosts: {
        list: async () => [
          { id: "host-1", status: "connected", type: "persistent" },
        ],
      },
    },
  });
  await plugin(h.bb);
  return h;
};
test("concurrent additions, partial updates and reload preserve user data", async () => {
  let { harness } = await setup();
  try {
    const tasks = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        harness.behavior.callRpc("add", {
          title: `Задача ${i}`,
          sectionId: null,
        }),
      ),
    );
    assert.equal((await harness.behavior.callRpc("list", null)).length, 20);
    const id = tasks[0].id;
    await Promise.all([
      harness.behavior.callRpc("patch", {
        id,
        changes: { notes: "Важные мысли" },
      }),
      harness.behavior.callRpc("stepAdd", { id, title: "Первый шаг" }),
    ]);
    await harness.behavior.callRpc("patch", { id, changes: { deleted: true } });
    ({ harness } = await harness.lifecycle.reload(plugin));
    await harness.behavior.callRpc("patch", {
      id,
      changes: { deleted: false },
    });
    const t = (await harness.behavior.callRpc("list", null)).find(
      (t) => t.id === id,
    );
    assert.equal(t.notes, "Важные мысли");
    assert.equal(t.steps.length, 1);
    assert.equal(t.deleted, false);
  } finally {
    await harness.lifecycle.dispose();
  }
});
test("proposals remain separate; selected steps applied once; malformed input rejected", async () => {
  let { harness } = await setup();
  try {
    const t = await harness.behavior.callRpc("add", {
      title: "Сделать дело",
      sectionId: null,
    });
    const result = await harness.behavior.runCli([
      "propose",
      t.id,
      JSON.stringify(["Уточнить цель", "Подготовить черновик"]),
    ]);
    assert.equal(result.exitCode, 0);
    const proposed = JSON.parse(result.stdout);
    assert.equal(proposed.steps.length, 0);
    assert.equal(proposed.done, false);
    const ids = [proposed.suggestions[0].id];
    await harness.behavior.callRpc("accept", { id: t.id, ids });
    const again = await harness.behavior.callRpc("accept", { id: t.id, ids });
    assert.equal(again.steps.length, 1);
    assert.equal(again.suggestions.length, 1);
    await assert.rejects(() =>
      harness.behavior.callRpc("add", { title: " ", sectionId: null }),
    );
    await assert.rejects(() =>
      harness.behavior.callRpc("add", {
        title: "Missing section",
        sectionId: "missing",
      }),
    );
    const invalid = await harness.behavior.runCli(["propose", t.id, "[1]"]);
    assert.equal(invalid.exitCode, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out");
};
const inputFor = (id, stepId = null) => ({
  id,
  stepId,
  mode: "decompose",
  instruction: "",
  requestId: crypto.randomUUID(),
});
test("background job uses Astra low without threads and accepts child suggestions under selected step", async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const { harness } = await setup(async (c) => {
    calls.push(c);
    await gate;
    return { answer: "Результат", suggestions: ["Вложенный шаг"] };
  });
  const t = await harness.behavior.callRpc("add", {
    title: "Родитель",
    sectionId: null,
  });
  const withStep = await harness.behavior.callRpc("stepAdd", {
    id: t.id,
    title: "Только эта подзадача",
  });
  const stepId = withStep.steps[0].id;
  const input = inputFor(t.id, stepId);
  const queued = await harness.behavior.callRpc("assist", input);
  assert.equal(queued.status, "queued");
  assert.equal(calls.length, 0);
  const duplicate = await harness.behavior.callRpc(
    "assist",
    inputFor(t.id, stepId),
  );
  assert.equal(duplicate.id, queued.id);
  const worker = harness.behavior.runService("assistant");
  try {
    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].input.model, "gpt-6-astra");
    assert.equal(calls[0].input.effort, "low");
    assert.match(calls[0].input.prompt, /ТОЛЬКО над этой подзадачей/);
    await harness.behavior.callRpc("patch", {
      id: t.id,
      changes: { notes: "Сохранить параллельное изменение" },
    });
    release();
    await waitFor(
      async () =>
        (await harness.behavior.callRpc("list", null))[0].jobs[0].status ===
        "done",
    );
    let saved = (await harness.behavior.callRpc("list", null))[0];
    assert.equal(saved.notes, "Сохранить параллельное изменение");
    assert.equal(saved.threads.length, 0);
    assert.equal(saved.suggestions[0].parentId, stepId);
    saved = await harness.behavior.callRpc("accept", {
      id: t.id,
      ids: [saved.suggestions[0].id],
    });
    assert.equal(saved.steps[1].parentId, stepId);
    const sibling = await harness.behavior.callRpc("stepAdd", {
      id: t.id,
      title: "Sibling",
    });
    const deleted = await harness.behavior.callRpc("stepRemove", {
      id: t.id,
      stepId,
    });
    assert.deepEqual(
      deleted.steps.map((s) => s.title),
      ["Sibling"],
    );
    assert.equal(saved.done, false);
    assert.equal(harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  } finally {
    release();
    worker.controller.abort();
    await worker.done;
    await harness.lifecycle.dispose();
  }
});
test("cancellation suppresses late results", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { harness } = await setup(async () => {
    await gate;
    return { answer: "Поздно", suggestions: ["Не добавлять"] };
  });
  const task = await harness.behavior.callRpc("add", {
    title: "Задача",
    sectionId: null,
  });
  const j = await harness.behavior.callRpc("assist", inputFor(task.id));
  const worker = harness.behavior.runService("assistant");
  try {
    await waitFor(
      async () =>
        (await harness.behavior.callRpc("list", null))[0].jobs[0].status ===
        "running",
    );
    await harness.behavior.callRpc("cancel", { id: task.id, jobId: j.id });
    release();
    await new Promise((r) => setTimeout(r, 30));
    const t = (await harness.behavior.callRpc("list", null))[0];
    assert.equal(t.jobs[0].status, "cancelled");
    assert.equal(t.suggestions.length, 0);
  } finally {
    release();
    worker.controller.abort();
    await worker.done;
    await harness.lifecycle.dispose();
  }
});
test("failure is shown and queued jobs survive reload", async () => {
  let { harness } = await setup(async () => {
    throw new Error("Offline");
  });
  const task = await harness.behavior.callRpc("add", {
    title: "Задача",
    sectionId: null,
  });
  await harness.behavior.callRpc("assist", inputFor(task.id));
  ({ harness } = await harness.lifecycle.reload(plugin));
  const worker = harness.behavior.runService("assistant");
  try {
    await waitFor(
      async () =>
        (await harness.behavior.callRpc("list", null))[0].jobs[0].status ===
        "error",
    );
    assert.match(
      (await harness.behavior.callRpc("list", null))[0].jobs[0].error,
      /Offline/,
    );
  } finally {
    worker.controller.abort();
    await worker.done;
    await harness.lifecycle.dispose();
  }
});
test("uses public SDK only", async () => {
  const result = await experimental_scanPublicSdkOnly(process.cwd(), {
    allow: [
      /^react(?:-dom)?$/,
      /^@\/components\//,
      /^@radix-ui\/react-/,
      /^@hugeicons\//,
      /^(class-variance-authority|clsx|tailwind-merge)$/,
    ],
  });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});

test("interrupted running job becomes a visible error after reload", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  let { harness } = await setup(async () => {
    calls++;
    await gate;
    return { answer: "late", suggestions: [] };
  });
  const t = await harness.behavior.callRpc("add", {
    title: "Example",
    sectionId: null,
  });
  await harness.behavior.callRpc("assist", inputFor(t.id));
  const worker = harness.behavior.runService("assistant");
  await waitFor(() => calls === 1);
  worker.controller.abort();
  release();
  await worker.done;
  ({ harness } = await harness.lifecycle.reload(plugin));
  try {
    const saved = (await harness.behavior.callRpc("list", null))[0];
    assert.equal(saved.jobs[0].status, "error");
    assert.ok(saved.jobs[0].error);
    assert.equal(calls, 1);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("section CRUD preserves tasks, validates references and persists icons", async () => {
  let { harness } = await setup();
  try {
    const group = await harness.behavior.callRpc("sectionSave", {
      name: "Work",
      icon: "💼",
    });
    const task = await harness.behavior.callRpc("add", {
      title: "Example",
      sectionId: group.id,
    });
    assert.equal(task.sectionId, group.id);
    assert.equal("day" in task, false);
    await harness.behavior.callRpc("sectionSave", {
      id: group.id,
      name: "Projects",
      icon: "💻",
    });
    await assert.rejects(() =>
      harness.behavior.callRpc("patch", {
        id: task.id,
        changes: { sectionId: "missing" },
      }),
    );
    ({ harness } = await harness.lifecycle.reload(plugin));
    assert.deepEqual(await harness.behavior.callRpc("sections", null), [
      { id: group.id, name: "Projects", icon: "💻" },
    ]);
    await harness.behavior.callRpc("sectionRemove", { id: group.id });
    const saved = (await harness.behavior.callRpc("list", null))[0];
    assert.equal(saved.sectionId, null);
    assert.equal(saved.title, "Example");
    assert.equal(saved.deleted, false);
  } finally {
    await harness.lifecycle.dispose();
  }
});
