import { spawnSync, SpawnSyncReturns, StdioOptions } from 'child_process';
import * as fs from 'fs';

export type Options = {
  cwd?: string;
  encoding: BufferEncoding;
  stackTrace: boolean;
  failOn: (code: number) => boolean;
  retry?: (exitCode: number | null, stdout: string, stderr: string) => boolean;
  verbose?: boolean;
  failFast?: boolean;
};

export const defaultOptions: Options = {
  encoding: 'utf8',
  verbose: true,
  failFast: true,
  stackTrace: true,
  failOn: code => code !== 0,
};

export function execPipe(cmd: string): SpawnSyncReturns<string>;
export function execPipe(cmd: string, args: ReadonlyArray<string>): SpawnSyncReturns<string>;
export function execPipe(cmd: string, options: Partial<Options>): SpawnSyncReturns<string>;
export function execPipe(
  cmd: string,
  args: ReadonlyArray<string>,
  options: Partial<Options>
): SpawnSyncReturns<string>;
export function execPipe(
  cmd: string,
  args: ReadonlyArray<string>,
  options: Partial<Options>
): SpawnSyncReturns<string>;
export function execPipe(
  cmd: string,
  args?: ReadonlyArray<string> | Partial<Options>,
  options?: Partial<Options>
): SpawnSyncReturns<string> {
  if (Array.isArray(args)) {
    return exec_({ cmd, stdio: 'pipe', args, options });
  } else {
    return exec_({
      cmd,
      stdio: 'pipe',
      args: [],
      options: args as Partial<Options>,
    });
  }
}

export function exec(cmd: string): number | null;
export function exec(cmd: string, args: ReadonlyArray<string>): number | null;
export function exec(cmd: string, options: Partial<Options>): number | null;
export function exec(
  cmd: string,
  args: ReadonlyArray<string>,
  options: Partial<Options>
): number | null;
export function exec(
  cmd: string,
  args: ReadonlyArray<string>,
  options: Partial<Options>
): number | null;
export function exec(
  cmd: string,
  args?: ReadonlyArray<string> | Partial<Options>,
  options?: Partial<Options>
): number | null {
  if (Array.isArray(args)) {
    return exec_({ cmd, stdio: 'inherit', args, options }).status;
  } else {
    return exec_({
      cmd,
      stdio: 'inherit',
      args: [],
      options: args as Partial<Options>,
    }).status;
  }
}

export const exec_: (o: {
  cmd: string;
  stdio: StdioOptions;
  args?: ReadonlyArray<string>;
  options?: Partial<Options>;
  retries?: number;
}) => SpawnSyncReturns<string> = (o: {
  cmd: string;
  stdio: StdioOptions;
  args?: ReadonlyArray<string>;
  options?: Partial<Options>;
  retries?: number;
}) => {
  const options_ = { ...defaultOptions, ...o.options };
  const args_ = o.args || [];

  let res: SpawnSyncReturns<string>;
  if (o.stdio === 'inherit' && options_.retry) {
    const outFile = (f: string) => `/tmp/${Date.now()}_exec_ts.${f}`;
    const stdoutFile = outFile('stdout');
    fs.appendFileSync(stdoutFile, '');

    const stderrFile = outFile('stderr');
    fs.appendFileSync(stderrFile, '');

    const cmd = `(set -e; ${o.options?.verbose === true ? 'set -x;' : ''}${
      o.cmd
    }) > >(tee ${stdoutFile}) 2> >(tee ${stderrFile} >&2)`;

    res = spawnSync(`${cmd}`, args_, {
      cwd: options_.cwd,
      shell: 'bash',
      stdio: 'inherit',
      encoding: 'utf8',
    });

    res.stdout = fs.readFileSync(stdoutFile, { encoding: 'utf-8' });
    res.stderr = fs.readFileSync(stderrFile, { encoding: 'utf-8' });
    fs.rmSync(stdoutFile);
    fs.rmSync(stderrFile);
  } else {
    const cmd = `set -e; ${o.options?.verbose === true ? 'set -x;' : ''} ${o.cmd}`;
    res = spawnSync(cmd, args_, {
      cwd: options_.cwd,
      shell: 'bash',
      stdio: o.stdio,
      encoding: 'utf8',
    });
  }

  if (res.error || options_.failOn(res.status!)) {
    const maxRetries = 5;
    const retriesLeft = o.retries !== undefined ? o.retries : maxRetries;
    if (retriesLeft > 0 && options_.retry && options_.retry(res.status, res.stdout, res.stderr)) {
      const waitSeconds = 5;
      console.info(`Retrying in ${waitSeconds} seconds, ${retriesLeft} retries left`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitSeconds * 1000);
      return exec_({ ...o, retries: retriesLeft - 1 });
    }

    if (options_.stackTrace) {
      throw Error(
        `${options_.cwd || ''} ${o.cmd}${o.args ? ' ' + o.args.join(' ') : ''}

Failed with:
  ${res.status ? `status=${res.status}` : ''}
  ${o.stdio === 'pipe' ? `stdout=${res.stdout}` : ''}
  ${o.stdio === 'pipe' ? `stderr=${res.stderr}` : ''}
  ${res.error ? `error=${JSON.stringify(res.error, null, 2)}` : ''}`
      );
    } else {
      process.exit(res.status!);
    }
  }

  return res;
};
