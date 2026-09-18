import {defineRpcContract} from '@get-bb/plugin-sdk';import {z} from 'zod';
export const hostContract=defineRpcContract({initialize:{input:z.object({checkout:z.string().min(1),target:z.string().min(1),mode:z.enum(['check','initialize','restore']),backup:z.string().optional()}).strict(),output:z.object({message:z.string(),backup:z.string().nullable()})}});
