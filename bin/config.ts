import Ajv, { JSONSchemaType } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';
import { log } from './core';

const ajv = new Ajv();

export type MonoConfig = {
  projects?: ProjectsConfig;
  exports?: ExportsConfig;
  commands?: CommandsConfig;
};

export type ProjectsConfig = {
  [project: string]: string;
};

export type ExportsConfig = {
  [project: string]: string | string[];
};

export type CommandsConfig = {
  [commandName: string]: Command;
};

export type ParallelCommands = {
  parallel: string[];
  path?: string;
  before?: string;
  after?: string;
  closeOnDone?: boolean;
  sync?: boolean;
  panes?: boolean;
  sequence?: boolean;
};

export type CustomCommand = {
  command: string;
  path?: string;
  args?: {
    name: string;
    required?: boolean;
    type: 'boolean' | 'number' | 'string';
  }[];
  options?: {
    name: string;
    actualName?: string;
    alias?: string;
    required?: boolean;
    type: 'boolean' | 'number' | 'string' | 'array';
  }[];
  vars?: {
    name: string;
    value: string;
  }[];
};

export type ChunkedCommand = {
  chunks: string[];
  noSpaces?: boolean;
};

export type Command = string | string[] | ParallelCommands | ChunkedCommand | CustomCommand;

const projectsSchema: JSONSchemaType<ProjectsConfig> = {
  type: 'object',
  additionalProperties: false,
  required: [],
  patternProperties: {
    '.+': {
      type: 'string',
    },
  },
};

const exportsSchema: JSONSchemaType<ExportsConfig> = {
  type: 'object',
  additionalProperties: false,
  required: [],
  oneOf: [
    {
      patternProperties: {
        '.+': {
          type: 'string',
        },
      },
    },
    {
      patternProperties: {
        '.+': {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  ],
};

const commandsSchema: JSONSchemaType<CommandsConfig> = {
  type: 'object',
  additionalProperties: false,
  required: [],
  oneOf: [
    {
      patternProperties: {
        '.+': {
          type: 'string',
        },
      },
    },
    {
      patternProperties: {
        '.+': {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
    {
      patternProperties: {
        '.+': {
          type: 'object',
          required: ['parallel'],
          additionalProperties: false,
          properties: {
            parallel: {
              type: 'array',
              items: { type: 'string' },
            },
            before: {
              type: 'string',
            },
            after: {
              type: 'string',
            },
            closeOnDone: {
              type: 'boolean',
            },
            sync: {
              type: 'boolean',
            },
            panes: {
              type: 'boolean',
            },
            sequence: {
              type: 'boolean',
            },
          },
        },
      },
    },
    {
      patternProperties: {
        '.+': {
          type: 'object',
          required: ['chunks'],
          additionalProperties: false,
          properties: {
            chunks: {
              type: 'array',
              items: { type: 'string' },
            },
            noSpaces: {
              type: 'boolean',
            },
          },
        },
      },
    },
    {
      patternProperties: {
        '.+': {
          type: 'object',
          additionalProperties: false,
          required: ['command'],
          properties: {
            command: {
              type: 'string',
            },
            args: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type'],
                properties: {
                  name: { type: 'string' },
                  required: { type: 'boolean' },
                  type: { type: 'string' },
                },
              },
            },
            options: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'type'],
                properties: {
                  name: { type: 'string' },
                  required: { type: 'boolean' },
                  alias: { type: 'string' },
                  actualName: { type: 'string' },
                  type: { type: 'string' },
                },
              },
            },
            vars: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'value'],
                properties: {
                  name: { type: 'string' },
                  value: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  ],
};

const schema: JSONSchemaType<MonoConfig> = {
  type: 'object',
  anyOf: [
    {
      required: [],
      properties: {
        projects: projectsSchema,
      },
    },
    {
      required: [],
      properties: {
        projects: exportsSchema,
      },
    },
    {
      required: [],
      properties: {
        commands: commandsSchema,
      },
    },
  ],
};

export const parseMonoConfigDir = (dirPath: string, configName: string) => {
  const jsonFile = path.join(dirPath, configName);
  if (fs.existsSync(jsonFile)) {
    const data = JSON.parse(fs.readFileSync(jsonFile).toString());
    return parseMonoConfig(jsonFile, data);
  }

  const packageFile = path.join(dirPath, 'package.json');
  if (fs.existsSync(packageFile)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(packageFile).toString());
    } catch (e) {
      console.info('Failed to parse:', packageFile, e);
      data = {};
    }
    if (data.scripts) {
      return parseMonoConfig(packageFile, {
        commands: Object.assign({ install: 'npm i' }, data.scripts),
      });
    }
  }
  return {};
};

export const parseMonoConfig = (path: string, data: object) => {
  const validate = ajv.compile(schema);
  if (validate(data)) return data as MonoConfig;
  else
    log(
      `Invalid Mono config at ${path}, ${JSON.stringify(data)}, ${JSON.stringify(validate.errors)}`
    );
  return {};
};
