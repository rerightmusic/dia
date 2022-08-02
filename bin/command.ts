import chalk from 'chalk';
import { spawn } from 'child_process';
import { exec } from './exec';
import * as path from 'path';
import y from 'yargs';
import { ChunkedCommand, Command, CustomCommand, ParallelCommands } from './config';
import { Context, fail } from './core';

export type CommandAndPath = {
  path: string;
  command: Command;
};

export type CommandAndPaths = {
  [k: string]: CommandAndPath;
};

export const runCommand = (
  gitRoot: string,
  commandAndPath: CommandAndPath,
  args: string[],
  argv: y.Arguments<unknown>
): any => {
  const command = commandAndPath.command;
  const projectPath = commandAndPath.path;
  printCommand(gitRoot, projectPath, command, args);

  if (typeof command === 'object' && 'chunks' in command) {
    return run(joinChunks(command), args, {
      cwd: projectPath,
    });
  }

  if (typeof command === 'string') {
    return run(command, args, { cwd: projectPath });
  }

  if ('command' in command && !('tag' in command)) {
    let cmd = command.command;

    (command.vars || []).forEach(v => {
      cmd = cmd.split(`$\{${v.name}}`).join(v.value);
    });

    (command.args || []).forEach(a => {
      let replacementArg = '';
      if (argv[a.name]) {
        replacementArg = (argv[a.name] as string | number).toString();
      }
      cmd = cmd.split(`$\{${a.name}}`).join(replacementArg);
    });

    (command.options || []).forEach(o => {
      let replacementOption = '';
      if (argv[o.name]) {
        replacementOption = `${argv[o.name]}`;
      }
      cmd = cmd.split(`$\{${o.name}}`).join(replacementOption);
    });

    printCommand(gitRoot, projectPath, cmd, []);
    return run(cmd, [], {
      cwd: command.path ? command.path : projectPath,
    });
  }

  const commands: ParallelCommands = Array.isArray(command) ? { parallel: command } : command;

  if (Array.isArray(command) || command.panes !== true) {
    return run(`{ ${commands.parallel.join(' & ')} & wait; }`, args, {
      cwd: projectPath,
    });
  } else {
    const p = exec('which tmux && which tmux-xpanes', { verbose: false });
    if (p === 0) {
      const commands: ParallelCommands = Array.isArray(command) ? { parallel: command } : command;
      return run(
        `if [ "$TMUX" ]; then
          xpanes -x ${commands.closeOnDone ? '-s' : ''} ${
          commands.sync ? '' : '-d'
        } -e ${commands.parallel.map(c => `"${c}"`).join(' ')}
          exit;
          exit;
         else
          xpanes ${commands.closeOnDone ? '-s' : ''} ${
          commands.sync ? '' : '-d'
        } -e ${commands.parallel.map(c => `"${c}"`).join(' ')}
         fi`,
        args,
        {
          cwd: projectPath,
        }
      );
    } else {
      return fail('Tmux not installed. Please install to run parallel commands');
    }
  }
};

/**
 * Remove arguments before command from total argumments
 * Resolve relative paths to absolute paths
 */
export const commandArgs = (rootPath: string, name: string, args: string[]) => {
  const idx = args.indexOf(name);
  return args.slice(idx + 1).map(arg => {
    /* Don't resolve arguments if:
     * in double quotes
     * start with -
     * start with /
     */
    if (
      !(arg.startsWith('"') || arg.startsWith("'")) &&
      !arg.startsWith('-') &&
      !arg.startsWith('/') &&
      arg.includes('/')
    ) {
      return path.join(rootPath, arg);
    }
    return arg;
  });
};

const printCommand = (gitRoot: string, projectPath: string, command: Command, args: string[]) => {
  const cmd = showCommand(command);
  console.info(
    chalk.cyan(`${path.relative(gitRoot, projectPath)}:`),
    chalk.green(cmd, args.join(' '))
  );
};

const showCommand: (command: Command) => string = command => {
  if (typeof command === 'string') return command;
  if (typeof command === 'object' && 'chunks' in command) return joinChunks(command);
  if (Array.isArray(command)) return command.join(' | ');
  if ('parallel' in command) {
    return `${command.before ? ' > ' + command.before : ''}${showCommand(command.parallel)}${
      command.after ? ' > ' + command.after : ''
    }`;
  }

  const cmd = showCommand(command.command);
  const args = command.args ? ' ' + command.args.map(a => `<${a.name}:${a.type}>`).join(' ') : '';
  const opts = command.options
    ? ' ' + (command.options || []).map(o => `--${o.name}:${o.type}`).join(' ')
    : '';

  return `${cmd}${args}${opts}`;
};

export const createCommand = (
  gitRoot: string,
  prjPath: string,
  commands: CommandAndPaths,
  command: string,
  args: string[],
  fullCommandName: string
) => {
  const cmd = commands[command].command;

  if (typeof cmd === 'string') {
    const parsed = y(cmd.split(' '))
      .option('cwd', {
        type: 'string',
      })
      .help(false)
      .parseSync();

    if (parsed.cwd) {
      return `${fullCommandName} ${path.join(
        path.relative(gitRoot, prjPath),
        parsed.cwd
      )} ${command} ${args.join(' ')}`;
    }
  }
  return `${fullCommandName} ${path.relative(gitRoot, prjPath)} ${command} ${args.join(' ')}`;
};

export const applyCommands = (
  context: Context,
  projectPath: string,
  yargs: y.Argv<unknown>,
  commands: CommandAndPaths
) => {
  Object.keys(commands)
    .sort()
    .forEach(k => {
      let cmdAndPath = commands[k];
      let key = k;

      if (typeof cmdAndPath.command === 'object' && 'chunks' in cmdAndPath.command) {
        cmdAndPath = {
          ...cmdAndPath,
          command: joinChunks(cmdAndPath.command),
        };
      }

      if (k.split(' ').length > 1 && typeof cmdAndPath.command === 'string') {
        const split = k.split(' ');
        cmdAndPath = {
          ...cmdAndPath,
          command: {
            command: cmdAndPath.command,
            args: split.slice(1).map(a => ({ name: a, type: 'string' })),
          } as CustomCommand,
        };
        key = split[0];
      }

      const cmd = cmdAndPath.command;
      let args = '';
      if (typeof cmd === 'object' && 'command' in cmd) {
        args = (cmd.args || []).map(a => `<${a.name}>`).join(' ');
      }

      yargs.command(
        [`${key}${args ? ` ${args}` : ' [args...]'}`],
        '',
        yargs_ => {
          if (typeof cmd === 'object' && 'command' in cmd) {
            (cmd.args || []).forEach(a => {
              yargs_.positional(a.name, { type: a.type });
              if (a.required === true) yargs_.requiresArg(a.name);
            });
            (cmd.options || []).forEach(o => {
              yargs_.option(o.name, { type: o.type, alias: o.alias });
              if (o.required === true) yargs_.demandOption(o.name);
            });
          } else {
            yargs_.positional('args', { type: 'string' }).array('args').hide('args');
          }
          return yargs_;
        },
        argv => {
          runCommand(
            context.gitRoot,
            cmdAndPath,
            commandArgs(context.rootPath, k, context.args),
            argv
          );
        }
      );
    });

  yargs.command(
    'run [shell...]',
    '',
    yargs_ => yargs_.positional('shell', { type: 'string' }).array('shell').hide('shell'),
    argv => {
      if (argv.shell && argv.shell.length > 0) {
        runCommand(
          context.gitRoot,
          { command: argv.shell[0], path: projectPath },
          commandArgs(context.rootPath, argv.shell[0], context.args),
          argv
        );
      }
    }
  );
};

const run = (command: string, args: string[], o?: { cwd: string }) => {
  const pr = spawn(command, args, {
    cwd: o?.cwd,
    shell: true,
    stdio: 'inherit',
  });

  process.on('exit', () => {
    pr.kill();
  });

  process.on('SIGINT', () => {
    pr.kill();
  });

  process.on('SIGTERM', () => {
    pr.kill();
  });

  pr.on('exit', process.exit);
};

const joinChunks = (cmd: ChunkedCommand) => {
  if (cmd.noSpaces === true) return cmd.chunks.join('');
  return cmd.chunks.join(' ');
};
