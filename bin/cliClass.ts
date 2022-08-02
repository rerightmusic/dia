import y from 'yargs';

export class CLI {
  constructor(
    private _apply: (
      yargs: y.Argv<unknown>,
      args: string[]
    ) => { yargs: y.Argv<unknown>; args: string[] }
  ) {}

  and(cli: CLI) {
    return new CLI((yargs, args) => {
      const res = this._apply(yargs, args);
      const res2 = cli._apply(res.yargs, res.args);
      return res2;
    });
  }

  parse(yargs: y.Argv<unknown>, args: string[]) {
    const res = this._apply(yargs, args);
    return res.yargs.parse(res.args);
  }
}
