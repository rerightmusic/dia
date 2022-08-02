import * as path from 'path';
import { CommandAndPath } from './command';
import { CreateProject } from './project';

export const createExportProjects: (t: CreateProject) => CreateProject = tree => {
  //Find all project nodes in exports
  const exportChildren = Object.fromEntries(
    Object.entries(tree.exports).flatMap(([k, v]) => {
      if (typeof v === 'string') {
        const prj = findProject(tree, path.join(tree.path, v));
        return prj ? [[k, [prj]]] : [];
      } else {
        const prjs = v.flatMap(v_ => {
          const prj = findProject(tree, path.join(tree.path, v_));
          return prj ? [prj] : [];
        });

        return prjs.length > 0 ? [[k, prjs]] : [];
      }
    })
  );

  const exportCommands = Object.entries(exportChildren).reduce<{ [cmd: string]: CommandAndPath }>(
    (prev, next) => {
      return { ...prev, ...mergeCommands(next[0], next[1]) };
    },
    {}
  );
  const exportProjects = tree.children.map(c => createExportProjects(c));

  return {
    ...tree,
    children: exportProjects,
    commands: {
      ...tree.commands,
      ...exportCommands,
    },
  };
};

export const mergeCommands = (prefix: string, prjs: CreateProject[]) => {
  let prefix_ = prefix === '.' ? '' : `${prefix}:`;
  return prjs.reduce<{ [cmd: string]: CommandAndPath }>((prev, prj) => {
    const remappedCommands = Object.fromEntries(
      Object.entries(prj.commands || {}).map(([k_, v_]) => {
        return [`${prefix_}${k_}`, { command: v_.command, path: prj.path }];
      })
    );

    return { ...remappedCommands, ...prev };
  }, {});
};

export const findProject: (
  tree: CreateProject,
  absProjectPath: string
) => CreateProject | undefined = (tree, absProjectPath) => {
  if (tree.path === absProjectPath) {
    return tree;
  } else if (absProjectPath.includes(tree.path) && tree.children.length > 0) {
    return tree.children.reduce((prev, next) => {
      if (prev) return prev;
      else return findProject(next, absProjectPath);
    }, undefined as CreateProject | undefined);
  } else {
    return undefined;
  }
};
