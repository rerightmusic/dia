import { execPipe } from './exec';
import * as path from 'path';
import y from 'yargs';
import { applyCommands, CommandAndPath, commandArgs, createCommand, runCommand } from './command';
import { parseMonoConfigDir } from './config';
import { Context, log } from './core';
import { createExportProjects } from './project-exports';

export type CreateProject = {
  tag: 'project';
  path: string;
  enabled: boolean;
  name: string;
  commands?: { [commandName: string]: CommandAndPath };
  exports: Record<string, string | string[]>;
  children: CreateProject[];
};

export const createProject = (context: Context, yargs: y.Argv<unknown>) => {
  const gitDirs = 'git ls-tree -d -r --name-only HEAD';
  const diffDirs = `set +e;git diff --name-only --diff-filter=ACMRTUXB HEAD~1 ${context.rootPath} | grep -Ev '.*\\..*';set -e`;
  const uncheckedDirs = `set +e;git status --short HEAD ${context.rootPath} | grep '??' | sed s"/?? //" | grep -Ev '.*\\..*';set -e`;
  const output = execPipe(`${gitDirs};${diffDirs};${uncheckedDirs}`, [], {
    cwd: context.rootPath,
    verbose: false,
  }).stdout;
  const gitFiles = (output ? output.split('\n') : []).filter((f: string) => {
    return (
      f &&
      !ignoreList.find(i => f.includes(i)) &&
      path.join(context.rootPath, f) !== context.rootPath &&
      path.join(context.rootPath, f) !== path.join(context.rootPath, '/') &&
      path.join(context.rootPath, f).includes(context.rootPath)
    );
  });

  const project = createProject_(
    context.currPath,
    path.basename(context.rootPath),
    context.rootPath,
    gitFilesToRecord(gitFiles),
    context.configName
  );

  const newProject = enableTree(project);
  const exported = createExportProjects(newProject);
  applyYargs(context, exported, yargs);
  return { yargs, project: exported };
};

export const createProject_: (
  currentPath: string,
  projectName: string,
  projectPath: string,
  gitFiles: Record<string, string[]>,
  configName: string
) => CreateProject = (currentPath, projectName, projectPath, gitFiles, configName) => {
  const diaConfig = parseMonoConfigDir(projectPath, configName);
  const projects = diaConfig.projects || {};
  const projects_: Record<string, string | string[]> = Object.assign(
    {},
    ...Object.keys(gitFiles)
      .map(f => ({ [f]: path.join(projectPath, f) }))
      .concat(
        Object.keys(projects).map(k => ({
          [k]: path.join(projectPath, projects[k]),
        }))
      )
  );

  const res = Object.entries(projects_).flatMap(prj => {
    if (typeof prj[1] === 'string') {
      return [
        createProject_(
          currentPath,
          prj[0],
          prj[1],
          gitFilesInDir(gitFiles, path.basename(prj[0])),
          configName
        ),
      ];
    } else {
      return prj[1].map(p =>
        createProject_(
          currentPath,
          prj[0],
          p,
          gitFilesInDir(gitFiles, path.basename(prj[0])),
          configName
        )
      );
    }
  });

  return {
    tag: 'project',
    enabled: false,
    path: projectPath,
    name: projectName,
    exports: diaConfig.exports || {},
    commands: Object.fromEntries(
      Object.entries(diaConfig.commands || {}).map(([k, v]) => [
        k,
        { path: projectPath, command: v },
      ])
    ),
    children: res,
  };
};

const ignoreList = ['src'];
export const gitFilesInDir = (gitFiles: Record<string, string[]>, dir: string) => {
  return gitFilesToRecord(gitFiles[dir] || []);
};

export const gitFilesToRecord = (gitFiles: string[]) => {
  return gitFiles.reduce<Record<string, string[]>>((prev, next) => {
    const split = next.split('/');
    const topDirName = split[0];
    const file = split.slice(1).join('/');
    const files = file ? [file] : [];
    if (prev[topDirName]) {
      return {
        ...prev,
        ...{ [topDirName]: prev[topDirName].concat(files) },
      };
    }
    return { ...prev, [topDirName]: files };
  }, {});
};

export const applyYargs = (context: Context, tree: CreateProject, yargs: y.Argv<unknown>) => {
  if (tree.enabled) {
    // Skip root project command
    if (tree.name === path.basename(context.rootPath)) {
      tree.children.forEach(c => {
        applyYargs(context, c, yargs);
      });

      if (tree.commands) applyCommands(context, tree.path, yargs, tree.commands);
    } else {
      applyProject(context, yargs, tree);
    }
  }

  return yargs.demandCommand().strictCommands();
};

const applyProject = (context: Context, yargs: y.Argv<unknown>, prj: CreateProject) => {
  const aliases = [];
  aliases.push(`${prj.name} [project]`);
  if (prj.name.length > 6) {
    aliases.push(getAlias(prj.name));
  }
  if (prj.path === context.currPath) aliases.push('.');

  return yargs.command(aliases, '', yargs_ => {
    prj.children.forEach(c => {
      applyYargs(context, c, yargs_);
    });
    if (prj.commands) {
      applyCommands(context, prj.path, yargs_, prj.commands);
    }
    return yargs_.demandCommand().strictCommands();
  });
};

const getAlias = (str: string) => {
  if (str.includes('-')) {
    return getAlias_(str, '-');
  }

  if (str.includes('_')) {
    return getAlias_(str, '_');
  }

  return str.slice(0, 3);
};

export const getAlias_ = (str: string, sym: string) => {
  const spl = str.split(sym).filter(x => x.length !== 0);
  const rem = 3 - (spl.length - 1);
  return (
    str.slice(0, rem) +
    spl
      .slice(1)
      .map(x => x[0])
      .join('')
  );
};

export const enableTree: (t: CreateProject) => CreateProject = tree => {
  let enabled = !!tree.commands;
  const children = tree.children.map(c => {
    const child = enableTree(c);
    if (child.enabled) {
      enabled = true;
    }
    return child;
  });
  return { ...tree, enabled, children };
};

export const runInProject = (
  fullCommandName: string,
  yargs: y.Argv<unknown>,
  gitRoot: string,
  project: CreateProject,
  command: string,
  panes: boolean,
  sequence: boolean
) => {
  const commands = runInProject_(fullCommandName, yargs, gitRoot, project, command);
  if (commands.size > 0) {
    runCommand(
      gitRoot,
      {
        path: gitRoot,
        command: {
          parallel: [...commands],
          ...(panes
            ? {
                closeOnDone: true,
                sync: false,
                panes,
              }
            : { panes: false }),
          ...(sequence ? { sequence: true } : {}),
        },
      },
      [],
      {} as y.Arguments<unknown>
    );
  } else {
    yargs.showHelp();
    log(`No projects with command ${command} found`);
  }
};

export const runInProject_: (
  fullCommandName: string,
  yargs: y.Argv<unknown>,
  gitRoot: string,
  project: CreateProject,
  command: string
) => Set<string> = (fullCommandName, yargs, gitRoot, project, command) => {
  const args = commandArgs(gitRoot, command, process.argv);
  const commands = new Set<string>();
  if (project.commands && project.commands[command]) {
    const commandCreated = createCommand(
      gitRoot,
      project.path,
      project.commands,
      command,
      args,
      fullCommandName
    );
    commands.add(commandCreated);
  }

  let cmds: string[] = [];
  if (commands.size === 0) {
    cmds = project.children.flatMap(c => [
      ...runInProject_(fullCommandName, yargs, gitRoot, c, command),
    ]);
  }

  return new Set([...commands, ...cmds]);
};
