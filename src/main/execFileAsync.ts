import { execFile } from 'child_process';
import { promisify } from 'util';

// [LAW:one-source-of-truth] Single declaration shared by all main-process subprocess calls.
export const execFileAsync = promisify(execFile);
