import fs from 'fs';
import path from 'path';
import y from 'yargs';
import * as C from './cliClass';
import { createProject, runInProject } from './project';

export const cli = (fullCommandName: string, configName: string) =>
  new C.CLI((yargs, args) => {
    const addCwd = (yargs_: y.Argv<unknown>) => {
      return yargs_.option('cwd', {
        type: 'string',
        description: `Current working directory`,
      });
    };

    const initParsedArgs = addCwd(y(args)).help(false).parseSync();

    const currPath = process.env.PWD || path.resolve('.');

    let gitRoot = currPath;
    while (!fs.existsSync(path.join(gitRoot, '.git')) && gitRoot !== '/') {
      gitRoot = path.dirname(gitRoot);
    }
    if (gitRoot === '/') {
      console.info('No git repo found');
      return { yargs, args };
    }

    let rootPath = null;
    const projectPath = initParsedArgs['_'];
    if (initParsedArgs.cwd) {
      rootPath = path.resolve(initParsedArgs.cwd);
      args = args.filter(x => x !== initParsedArgs.cwd && x !== '--cwd');
    } else if (
      projectPath &&
      typeof projectPath[0] === 'string' &&
      (projectPath[0].includes('/') || projectPath[0] === '.') &&
      fs.existsSync(projectPath[0])
    ) {
      rootPath = path.resolve(projectPath[0]);
      args = args.filter(x => x !== projectPath[0]);
    } else {
      rootPath = gitRoot;
      addCwd(yargs);
    }

    // Try catch removes yargs stack trace dump
    try {
      let { project } = createProject({ gitRoot, rootPath, currPath, args, configName }, yargs);
      if (rootPath === gitRoot)
        yargs.command(
          'all <command>',
          'run command in all projects that have it',
          y_ =>
            y_
              .option('panes', {
                alias: 'p',
                type: 'boolean',
                description: 'Run command in all projects with split panes',
              })
              .option('sequence', {
                alias: 's',
                type: 'boolean',
                description: 'Run command in all projects in sequence',
              })
              .positional('command', {
                type: 'string',
                describe: 'Command to run in all projects',
              }),
          args => {
            if (args.command)
              runInProject(
                fullCommandName,
                yargs,
                gitRoot,
                { ...project, commands: undefined },
                args.command,
                args['panes'] === true,
                !!args.sequence
              );
          }
        );
    } catch (err) {
      throw err;
    }

    return { yargs, args };
  });
