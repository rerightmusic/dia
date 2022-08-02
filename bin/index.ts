#!/usr/bin/env ts-node
import y from 'yargs';
import { hideBin } from 'yargs/helpers';
import { cli } from './cli';

const args = hideBin(process.argv);
cli('dia', 'dia.json').parse(y(args).scriptName(''), args);
