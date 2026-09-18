import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
export const rpcContract = defineRpcContract({
  archive: { input: z.object({ threadId: z.string().min(1).max(200) }).strict(), output: z.object({ ok: z.literal(true) }) },
});
export default function plugin(bb: BbPluginApi) {
  const archive = async ({ threadId }: { threadId: string }) => {
    await bb.sdk.threads.archive({ threadId });
    return { ok: true as const };
  };
  bb.rpc.register(rpcContract, { archive });
  bb.cli.register({ name: 'fast-archive', summary: 'Archive a thread without deleting it', run: async (args) => {
    if (args.length !== 1 || args[0]!.startsWith('-')) return { stderr: 'Usage: bb fast-archive <thread-id>', exitCode: 1 };
    await archive({ threadId: args[0]! });
    return { stdout: 'Thread archived. Restore it from the archived-thread controls.', exitCode: 0 };
  } });
}
