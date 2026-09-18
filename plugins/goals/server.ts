import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
const scope = z.literal("global");
const fields = z.object({ course: z.string().max(800), priorities: z.string().max(400), constraints: z.string().max(400) });
const document = fields.extend({ scope, revision: z.number().int().nonnegative(), updatedAt: z.number() });
export type GoalDocument = z.infer<typeof document>;
const card = z.object({ id: z.string().min(1).max(100), text: z.string().trim().min(1).max(800), done: z.boolean() });
const board = z.object({ items: z.array(card).max(30).refine(items => new Set(items.map(i => i.id)).size === items.length, 'Duplicate ids'), revision: z.number().int().nonnegative() });
export type GoalBoard = z.infer<typeof board>;
export const rpcContract = defineRpcContract({
  boardRead: { input: z.null(), output: board },
  boardSave: { input: board, output: board },
  read: { input: z.object({ scope }), output: document },
  save: { input: document.omit({ updatedAt: true }), output: document },
});
export default function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [`CREATE TABLE goals (scope TEXT PRIMARY KEY, course TEXT NOT NULL, priorities TEXT NOT NULL, constraints TEXT NOT NULL, revision INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`]);
  const read = (scope: "global"): GoalDocument => (db.prepare('SELECT * FROM goals WHERE scope = ?').get(scope) as GoalDocument | undefined) ?? { scope, course: '', priorities: '', constraints: '', revision: 0, updatedAt: 0 };
  const save = db.transaction((input: Omit<GoalDocument, 'updatedAt'>) => {
    if (read(input.scope).revision !== input.revision) throw new Error('Goals changed in another tab. Copy your draft and load the latest version.');
    const next = { ...input, revision: input.revision + 1, updatedAt: Date.now() };
    db.prepare('INSERT INTO goals VALUES (@scope, @course, @priorities, @constraints, @revision, @updatedAt) ON CONFLICT(scope) DO UPDATE SET course=excluded.course, priorities=excluded.priorities, constraints=excluded.constraints, revision=excluded.revision, updatedAt=excluded.updatedAt').run(next);
    return next;
  });
  db.exec('CREATE TABLE IF NOT EXISTS goal_board (id INTEGER PRIMARY KEY CHECK (id=1), data TEXT NOT NULL)');
  const readBoard = (): GoalBoard => {
    const row = db.prepare('SELECT data FROM goal_board WHERE id=1').get() as { data: string } | undefined;
    if (row) return board.parse(JSON.parse(row.data));
    const old = read('global');
    return { revision: 0, items: ([['course', old.course], ['priorities', old.priorities], ['constraints', old.constraints]] as const).filter(([, text]) => text.trim()).map(([id, text]) => ({ id, text, done: false })) };
  };
  const saveBoard = db.transaction((input: GoalBoard) => {
    if (readBoard().revision !== input.revision) throw new Error('Goals changed in another tab. Refresh the list before saving.');
    const next = { ...input, revision: input.revision + 1 };
    db.prepare('INSERT INTO goal_board VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(next));
    return next;
  });
  const context = () => {
    const current = readBoard();
    const sections = current.items.filter(i => !i.done).map((i, index) => `${index + 1}. ${i.text}`);
    return ['Personal goals, in priority order. Use them to evaluate an answer, idea or plan when the user asks:', ...sections].join('\n\n');
  };
  bb.rpc.register(rpcContract, { boardRead: () => readBoard(), boardSave: input => { const next = saveBoard(input); bb.realtime.publish('changed', {}); return next; }, read: ({ scope }) => read(scope), save: input => { const next = save(input); bb.realtime.publish('changed', { scope: next.scope }); return next; } });
  bb.agents.configure(() => ({ tools: [], skills: [], instructions: "The user keeps personal goals in the Goals sidebar. When the user asks to compare, align or evaluate an answer, idea, decision or plan against their goals, run `bb goals show` for the current list. Explain which goals the proposal supports, relevant tradeoffs and how to improve alignment. These are the user's personal goals, not agent tasks. Do not routinely check or apply them to unrelated requests, start work toward them, or edit/complete them without the user's request. If the list is empty, ask the user for their goals instead of inventing them." }));
  bb.cli.register({ name: 'goals', summary: 'Read personal goals when the user asks for alignment', commands: [{ name: 'show', summary: 'Read the user’s personal goals', usage: 'bb goals show' }], run: async (argv) => argv.length === 0 || (argv.length === 1 && argv[0] === 'show') ? { exitCode: 0, stdout: context() } : { exitCode: 1, stderr: 'Usage: bb goals show' } });
}
