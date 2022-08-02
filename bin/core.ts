import chalk from 'chalk';

export const log: (msg: string) => void = msg => {
  console.error(chalk.red('\n' + msg + '\n'));
};

export const fail: (msg: string) => never = msg => {
  log(msg);
  throw new Error('Failed');
};

export type Context = {
  gitRoot: string;
  rootPath: string;
  currPath: string;
  args: string[];
  configName: string;
};
