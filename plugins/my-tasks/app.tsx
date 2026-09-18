import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  useBbNavigate,
  Markdown,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, Task, Mode, Section } from "./server";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import "./style.css";

const labels: Record<Mode, string> = {
  expand: "Развить идею",
  decompose: "Разбить на шаги",
  help: "Помочь выполнить",
};

function Page() {
  const rpc = useRpc<typeof rpcContract>();
  const nav = useBbNavigate();
  const [tasks, setTasks] = useState<Task[] | null>(null),
    [error, setError] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);
  const [deletedId, setDeletedId] = useState<string | null>(null);
  const sequence = useRef(0);
  const report = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    [],
  );
  const refresh = useCallback(() => {
    const seq = ++sequence.current;
    return Promise.all([rpc.call("list"), rpc.call("sections")]).then(
      ([data, groups]) => {
        if (seq === sequence.current) {
          setTasks(data);
          setSections(groups);
        }
      },
      report,
    );
  }, [rpc, report]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime("changed", refresh);
  async function run(action: () => Promise<unknown>) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const task = tasks?.find((t) => t.id === selected);
  const change = (
    id: string,
    changes: Parameters<typeof rpc.call<"patch">>[1]["changes"],
  ) => run(() => rpc.call("patch", { id, changes }));
  const choose = (id: string | null) => {
    setSelected(id);
  };
  const allActive = (tasks ?? []).filter((t) => !t.deleted && !t.done);
  const trash = (tasks ?? []).filter((t) => t.deleted);
  const groups = [
    { id: "none", name: "Без раздела", icon: "📥" },
    ...sections,
  ].map((section) => ({
    ...section,
    items: (tasks ?? []).filter((t) => !t.deleted &&
      (section.id === "none" ? t.sectionId === null : t.sectionId === section.id)),
  }));
  const rows = (items: Task[]) =>
    items.map((t) => (
      <div
        key={t.id}
        className={`mt-row ${selected === t.id ? "mt-selected" : ""}`}
      >
        <Checkbox
          checked={t.done}
          disabled={busy || t.deleted}
          onCheckedChange={(v) => void change(t.id, { done: v === true })}
          aria-label={`${t.done ? "Вернуть в работу" : "Выполнить"}: ${t.title}`}
        />
        <button
          className="mt-row-main"
          onClick={() => choose(selected === t.id ? null : t.id)}
          aria-expanded={selected === t.id}
        >
          <span className={t.done ? "mt-done" : ""}>{t.title}</span>
          {t.jobs.some(
            (j) => j.status === "running" || j.status === "queued",
          ) && (
            <span className="mt-meta" role="status">
              Помощник работает в фоне…
            </span>
          )}
          {t.jobs.at(-1)?.status === "done" && (
            <span className="mt-meta">Есть результат помощника</span>
          )}
          {t.jobs.at(-1)?.status === "error" && (
            <span className="mt-meta">
              Помощник: требуется повторный запуск
            </span>
          )}
          {(t.steps.length > 0 || t.suggestions.length > 0) && (
            <span className="mt-meta">
              {t.steps.length > 0
                ? `${t.steps.filter((s) => s.done).length}/${t.steps.length} шагов`
                : ""}
              {t.suggestions.length > 0 ? " · Есть предложения" : ""}
            </span>
          )}
        </button>
        <button
          className="mt-small mt-muted"
          aria-label={`Открыть детали: ${t.title}`}
          onClick={() => choose(selected === t.id ? null : t.id)}
        >
          <Icon name="ChevronRight" className="size-4" />
        </button>
      </div>
    ));
  return (
    <div className="mt-page">
      <main className="mt-main">
        <header className="mt-header">
          <div>
            <h1>Мои задачи</h1>
            <p className="mt-muted">Осталось задач: {allActive.length}</p>
          </div>
          <Button variant="outline" onClick={() => setManaging(true)}>
            Разделы
          </Button>
        </header>
        {managing && (
          <SectionManager
            sections={sections}
            busy={busy}
            run={run}
            rpc={rpc}
            close={() => setManaging(false)}
          />
        )}
        {error && (
          <p className="mt-error" role="alert">
            {error} <button onClick={() => void refresh()}>Обновить</button>
          </p>
        )}
        {deletedId && (
          <div className="mt-notice">
            Задача в корзине.{" "}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await rpc.call("patch", {
                    id: deletedId,
                    changes: { deleted: false },
                  });
                  setDeletedId(null);
                })
              }
            >
              Отменить
            </button>
          </div>
        )}
        {tasks === null ? (
          <p className="mt-empty">Загружаем задачи…</p>
        ) : (
          <>
            {groups.map((group) => {
              const active = group.items.filter((t) => !t.done);
              const done = group.items.filter((t) => t.done);
              return (
                <section className="mt-list-group" key={group.id} aria-labelledby={`section-${group.id}`}>
                  <h2 className="mt-group-heading" id={`section-${group.id}`}>
                    <span aria-hidden="true">{group.icon}</span>
                    <span className="mt-group-name">{group.name}</span>
                    <span className="mt-group-count">{active.length}</span>
                  </h2>
                  <div className="mt-group-body">
                    {rows(active)}
                    <TaskForm
                      busy={busy}
                      sectionName={group.name}
                      add={(title) => run(() => rpc.call("add", {
                        title,
                        sectionId: group.id === "none" ? null : group.id,
                      }))}
                    />
                    {done.length > 0 && (
                      <details className="mt-completed-group">
                        <summary>Выполнено · {done.length}</summary>
                        {rows(done)}
                      </details>
                    )}
                  </div>
                </section>
              );
            })}
            <details className="mt-trash">
              <summary>🗑️ Корзина · {trash.length}</summary>
              {trash.length ? rows(trash) : <p className="mt-trash-empty">Корзина пуста</p>}
            </details>
          </>
        )}
        <dialog
          ref={dialog}
          className="mt-popup"
          aria-label="Детали задачи"
          onCancel={() => choose(null)}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              const r = e.currentTarget.getBoundingClientRect();
              if (
                e.clientX < r.left ||
                e.clientX > r.right ||
                e.clientY < r.top ||
                e.clientY > r.bottom
              )
                choose(null);
            }
          }}
        >
          {task && (
            <section className="mt-detail" aria-label="Содержимое задачи">
              <div className="mt-detail-heading">
                <h2>Задача</h2>
                <button
                  aria-label="Закрыть детали"
                  onClick={() => choose(null)}
                >
                  <Icon name="X" className="size-4" />
                </button>
              </div>
              {error && (
                <p role="alert" className="mt-error">
                  {error}
                </p>
              )}
              <Editor
                key={task.id}
                task={task}
                busy={busy}
                onSave={(title, notes) => change(task.id, { title, notes })}
              />
              <label className="mt-section-select">
                Раздел{" "}
                <select
                  aria-label="Раздел задачи"
                  disabled={busy}
                  value={task.sectionId ?? ""}
                  onChange={(e) =>
                    void change(task.id, { sectionId: e.target.value || null })
                  }
                >
                  <option value="">📥 Без раздела</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.icon} {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-steps">
                <h3>
                  Шаги{" "}
                  {task.steps.length > 0 && (
                    <span className="mt-muted">
                      {task.steps.filter((s) => s.done).length}/
                      {task.steps.length}
                    </span>
                  )}
                </h3>
                <Steps task={task} busy={busy} run={run} rpc={rpc} />
                <StepForm
                  key={task.id}
                  busy={busy}
                  add={(title) =>
                    run(() => rpc.call("stepAdd", { id: task.id, title }))
                  }
                />
              </div>
              <Help task={task} stepId={null} busy={busy} run={run} rpc={rpc} />
              {task.threads.length > 0 && (
                <details className="mt-conversations">
                  <summary>Ранее созданные разговоры</summary>
                  {task.threads.map((link, i) => (
                    <Button
                      key={link.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => nav.toThread(link.id)}
                    >
                      {labels[link.mode as Mode] ?? "Помощь"} · {i + 1}
                    </Button>
                  ))}
                </details>
              )}
              <div className="mt-detail-footer">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await rpc.call("patch", {
                        id: task.id,
                        changes: { deleted: !task.deleted },
                      });
                      if (!task.deleted) setDeletedId(task.id);
                      choose(null);
                    })
                  }
                >
                  {task.deleted ? "Восстановить" : "В корзину"}
                </Button>
              </div>
            </section>
          )}
        </dialog>
      </main>
    </div>
  );
}
function TaskForm({ busy, sectionName, add }: {
  busy: boolean;
  sectionName: string;
  add: (title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  return (
    <form className="mt-add" onSubmit={(e) => {
      e.preventDefault();
      if (title.trim()) void add(title.trim()).then((ok) => {
        if (ok) setTitle("");
      });
    }}>
      <Icon name="Plus" className="size-5" />
      <Input aria-label={`Новая задача: ${sectionName}`} placeholder="Новая задача"
        value={title} maxLength={500} disabled={busy}
        onChange={(e) => setTitle(e.target.value)} />
      {title.trim() && <Button size="sm" variant="ghost" disabled={busy} type="submit">Добавить</Button>}
    </form>
  );
}

function Editor({
  task,
  busy,
  onSave,
}: {
  task: Task;
  busy: boolean;
  onSave: (title: string, notes: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState(task.title),
    [notes, setNotes] = useState(task.notes);
  const dirty = title !== task.title || notes !== task.notes;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(title, notes);
      }}
    >
      <Input
        className="mt-edit-title"
        aria-label="Название задачи"
        value={title}
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        aria-label="Заметки к задаче"
        placeholder="Контекст, ссылки или пара мыслей…"
        value={notes}
        maxLength={20000}
        onChange={(e) => setNotes(e.target.value)}
      />
      {dirty && (
        <Button size="sm" disabled={busy || !title.trim()} type="submit">
          Сохранить изменения
        </Button>
      )}
    </form>
  );
}
function StepForm({
  busy,
  add,
}: {
  busy: boolean;
  add: (s: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="mt-step-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim())
          void add(text.trim()).then((ok) => {
            if (ok) setText("");
          });
      }}
    >
      <Input
        aria-label="Новый шаг"
        placeholder="+ Добавить небольшой шаг"
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={busy || !text.trim()}
      >
        Добавить шаг
      </Button>
    </form>
  );
}
function Suggestions({
  task,
  busy,
  accept,
  dismiss,
}: {
  task: Task;
  busy: boolean;
  accept: (ids: string[]) => Promise<unknown>;
  dismiss: () => Promise<unknown>;
}) {
  const [ids, setIds] = useState(task.suggestions.map((s) => s.id));
  return (
    <div className="mt-suggestions">
      <h3>Предложенные шаги</h3>
      <p className="mt-muted">Выбери, что добавить в свой план.</p>
      {task.suggestions.map((s) => (
        <label className="mt-step" key={s.id}>
          <Checkbox
            checked={ids.includes(s.id)}
            onCheckedChange={(v) =>
              setIds(v ? [...ids, s.id] : ids.filter((id) => id !== s.id))
            }
          />
          <span>{s.title}</span>
        </label>
      ))}
      <div className="mt-help-buttons">
        <Button
          size="sm"
          disabled={busy || !ids.length}
          onClick={() => void accept(ids)}
        >
          Добавить выбранные ({ids.length})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          Убрать предложения
        </Button>
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "checklist",
    title: "Мои задачи",
    icon: "ListTodo",
    path: "checklist",
    component: Page,
  });
});

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type WorkProps = {
  task: Task;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  rpc: Rpc;
};
function Steps({ task, busy, run, rpc }: WorkProps) {
  const [opened, setOpened] = useState<string | null>(null);
  const render = (parentId: string | null, depth = 0): React.ReactNode =>
    task.steps
      .filter((s) => s.parentId === parentId)
      .map((s) => (
        <div
          className="mt-step-group"
          key={s.id}
          style={{ marginLeft: depth ? 12 : 0 }}
        >
          <div className="mt-step">
            <Checkbox
              checked={s.done}
              disabled={busy}
              aria-label={`Выполнить шаг: ${s.title}`}
              onCheckedChange={(v) =>
                void run(() =>
                  rpc.call("stepToggle", {
                    id: task.id,
                    stepId: s.id,
                    done: v === true,
                  }),
                )
              }
            />
            <span className={s.done ? "mt-done" : ""}>{s.title}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Помощь с подзадачей: ${s.title}`}
              onClick={() => setOpened(opened === s.id ? null : s.id)}
            >
              {task.jobs.some(
                (j) =>
                  j.stepId === s.id &&
                  (j.status === "queued" || j.status === "running"),
              )
                ? "В работе…"
                : "Помощь"}
            </Button>
            <button
              aria-label={`Удалить шаг: ${s.title}`}
              disabled={busy}
              onClick={() =>
                void run(() =>
                  rpc.call("stepRemove", { id: task.id, stepId: s.id }),
                )
              }
            >
              <Icon name="X" className="size-3" />
            </button>
          </div>
          {opened === s.id && (
            <Help task={task} stepId={s.id} busy={busy} run={run} rpc={rpc} />
          )}
          {render(s.id, depth + 1)}
        </div>
      ));
  return <>{render(null)}</>;
}
function Help({
  task,
  stepId,
  busy,
  run,
  rpc,
}: WorkProps & { stepId: string | null }) {
  const [instruction, setInstruction] = useState("");
  const jobs = task.jobs.filter((j) => j.stepId === stepId);
  const pending = jobs.find(
    (j) => j.status === "queued" || j.status === "running",
  );
  const scoped = {
    ...task,
    suggestions: task.suggestions.filter((s) => s.parentId === stepId),
  };
  return (
    <div className="mt-help">
      <h3>{stepId ? "Помощь с этой подзадачей" : "Подключить помощь"}</h3>
      <p className="mt-muted">Astra · low effort · в фоне</p>
      {!task.deleted && (
        <>
          <Input
            aria-label={
              stepId ? "Уточнение для подзадачи" : "Уточнение для помощника"
            }
            placeholder="Что учесть? Необязательно"
            value={instruction}
            maxLength={10000}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div className="mt-help-buttons">
            {(["expand", "decompose", "help"] as Mode[]).map((mode) => (
              <Button
                key={mode}
                variant="outline"
                size="sm"
                disabled={busy || !!pending}
                onClick={() =>
                  void run(() =>
                    rpc.call("assist", {
                      id: task.id,
                      stepId,
                      mode,
                      instruction,
                      requestId: crypto.randomUUID(),
                    }),
                  )
                }
              >
                {labels[mode]}
              </Button>
            ))}
          </div>
        </>
      )}
      {pending && (
        <div className="mt-job-status" role="status">
          <span>
            {labels[pending.mode]}:{" "}
            {pending.status === "queued" ? "в очереди" : "выполняется"}… Можно
            закрыть окно.
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(() =>
                rpc.call("cancel", { id: task.id, jobId: pending.id }),
              )
            }
          >
            Остановить
          </Button>
        </div>
      )}
      {scoped.suggestions.length > 0 && (
        <Suggestions
          key={scoped.suggestions.map((s) => s.id).join(",")}
          task={scoped}
          busy={busy}
          accept={(ids) => run(() => rpc.call("accept", { id: task.id, ids }))}
          dismiss={() =>
            run(() => rpc.call("dismiss", { id: task.id, stepId }))
          }
        />
      )}
      {jobs
        .filter((j) => j.status !== "queued" && j.status !== "running")
        .slice(-5)
        .reverse()
        .map((j, i) => (
          <details className="mt-result" key={j.id} open={i === 0}>
            <summary>
              {labels[j.mode]} ·{" "}
              {j.status === "done"
                ? "Готово"
                : j.status === "error"
                  ? "Не получилось"
                  : "Остановлено"}{" "}
              <span className="mt-muted">
                {new Date(j.createdAt).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </summary>
            {j.error ? (
              <p className="mt-error">{j.error}</p>
            ) : j.answer ? (
              <Markdown content={j.answer} />
            ) : (
              <p className="mt-muted">Можно запустить помощь повторно.</p>
            )}
          </details>
        ))}
    </div>
  );
}

const icons = [
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
function SectionManager({
  sections,
  busy,
  run,
  rpc,
  close,
}: {
  sections: Section[];
  busy: boolean;
  run: WorkProps["run"];
  rpc: Rpc;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [id, setId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<Section["icon"]>("📁");
  const [error, setError] = useState("");
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const reset = () => {
    setId(undefined);
    setName("");
    setIcon("📁");
  };
  return (
    <dialog
      ref={ref}
      className="mt-popup"
      aria-label="Управление разделами"
      onCancel={close}
    >
      <section className="mt-detail">
        <div className="mt-detail-heading">
          <h2>Разделы задач</h2>
          <button aria-label="Закрыть разделы" onClick={close}>
            <Icon name="X" className="size-4" />
          </button>
        </div>
        <p className="mt-muted">
          Создай свои разделы и выбери для каждого иконку.
        </p>
        {sections.map((s) => (
          <div className="mt-section-row" key={s.id}>
            <span aria-hidden="true">{s.icon}</span>
            <span>{s.name}</span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Изменить раздел: ${s.name}`}
              onClick={() => {
                setId(s.id);
                setName(s.name);
                setIcon(s.icon);
              }}
            >
              Изменить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Удалить раздел: ${s.name}`}
              onClick={() =>
                void run(() => rpc.call("sectionRemove", { id: s.id })).then(
                  (ok) => {
                    if (ok && id === s.id) reset();
                  },
                )
              }
            >
              Удалить
            </Button>
          </div>
        ))}
        <p className="mt-muted">
          При удалении раздела задачи переходят в «Без раздела».
        </p>
        <form
          className="mt-section-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            void run(async () => {
              try {
                await rpc.call("sectionSave", {
                  ...(id ? { id } : {}),
                  name,
                  icon,
                });
                reset();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                throw e;
              }
            });
          }}
        >
          <h3>{id ? "Изменить раздел" : "Новый раздел"}</h3>
          <Input
            aria-label="Название раздела"
            value={name}
            maxLength={60}
            placeholder="Например, Работа или Идеи"
            onChange={(e) => setName(e.target.value)}
          />
          <div className="mt-icon-picker" aria-label="Иконка раздела">
            {icons.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Иконка ${value}`}
                aria-pressed={icon === value}
                onClick={() => setIcon(value)}
              >
                {value}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-error">
              {error}
            </p>
          )}
          <div className="mt-help-buttons">
            <Button type="submit" disabled={busy || !name.trim()}>
              {id ? "Сохранить раздел" : "Создать раздел"}
            </Button>
            {id && (
              <Button type="button" variant="ghost" onClick={reset}>
                Отмена
              </Button>
            )}
          </div>
        </form>
      </section>
    </dialog>
  );
}
