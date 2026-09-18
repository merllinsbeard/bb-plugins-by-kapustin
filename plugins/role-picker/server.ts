import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
const role = z.object({ id: z.string(), slug: z.string(), name: z.string(), description: z.string(), instructions: z.string(), color: z.string() });
const rolesOutput = z.object({ roles: z.array(role) });
const metadata = z.object({ roleId: z.string(), roleSlug: z.string(), roleName: z.string(), roleColor: z.string() });
export type Role = z.infer<typeof role>;
export const rpcContract = defineRpcContract({
  roles: { input: z.null(), output: rolesOutput },
  current: { input: z.object({ threadId: z.string().min(1) }), output: z.object({ roleSlug: z.string().nullable() }) },
  prepare: {
    input: z.object({ roleSlug: z.string().min(1).max(100).nullable(), threadId: z.string().min(1).nullable() }).strict(),
    output: z.object({ metadata, context: z.string() }),
  },
});
export default function (bb: BbPluginApi) {
  const list = () => bb.sdk.plugins.callRpc({ pluginId: 'agent-roles', method: 'roles_list', input: null, outputSchema: rolesOutput });
  bb.rpc.register(rpcContract, {
    roles: list,
    current: async ({ threadId }) => {
      const meta = await bb.sdk.threads.getPluginMetadata({ threadId, pluginId: 'agent-roles' });
      if (typeof meta.roleSlug === 'string') return { roleSlug: meta.roleSlug || null };
      const legacy = await bb.sdk.plugins.callRpc({ pluginId: 'agent-roles', method: 'thread_role', input: { threadId }, outputSchema: z.object({ roleSlug: z.string() }).nullable() });
      return { roleSlug: legacy?.roleSlug ?? null };
    },
    prepare: async ({ roleSlug, threadId }) => {
      const selected = roleSlug ? (await list()).roles.find(r => r.slug === roleSlug) : null;
      if (roleSlug && !selected) throw new Error('Роль больше не существует. Выберите другую роль.');
      const meta = { roleId: selected?.id ?? '', roleSlug: selected?.slug ?? '', roleName: selected?.name ?? '', roleColor: selected?.color ?? '' };
      // Agent Roles reads this namespace when constructing the provider session.
      // Empty strings explicitly override legacy role_threads fallback on deselection.
      if (threadId) await bb.sdk.threads.updatePluginMetadata({ threadId, pluginId: 'agent-roles', set: meta });
      return { metadata: meta, context: selected
        ? `The user selected your role for this thread: ${selected.name}. Apply this role starting with this message and subsequent messages until the user changes it. This replaces any previously selected specialist role. Continue in this same thread; do not create or delegate to another thread merely to adopt the role.\n\n${selected.instructions}`
        : 'The user deselected the specialist role for this thread. From this message onward, stop applying the previously selected specialist persona and continue as the general assistant in this same thread.' };
    },
  });
}
