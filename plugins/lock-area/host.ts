import {experimental_defineHostEntry} from '@get-bb/plugin-sdk';import {hostContract} from './contract.ts';import {initialize} from './initializer.ts';
export default experimental_defineHostEntry({contract:hostContract,handlers:{initialize:(input,ctx)=>initialize(input,ctx.experimental_paths.tempDir,ctx.signal)}});
