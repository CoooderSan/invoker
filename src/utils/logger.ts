import chalk from 'chalk';

let jsonMode = false;

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

export const logger = {
  info(msg: string) {
    if (jsonMode) return;
    console.log(chalk.blue('ℹ'), msg);
  },
  success(msg: string) {
    if (jsonMode) return;
    console.log(chalk.green('✔'), msg);
  },
  warn(msg: string) {
    if (jsonMode) return;
    console.log(chalk.yellow('⚠'), msg);
  },
  error(msg: string) {
    if (jsonMode) return;
    console.error(chalk.red('✖'), msg);
  },
  debug(msg: string) {
    if (jsonMode) return;
    if (process.env.INVOKER_DEBUG) {
      console.log(chalk.gray('🔍'), msg);
    }
  },
  table(rows: Array<Record<string, string>>) {
    if (jsonMode) return;
    console.table(rows);
  },
  blank() {
    if (jsonMode) return;
    console.log();
  },
  heading(msg: string) {
    if (jsonMode) return;
    console.log(chalk.bold.underline(msg));
  },
};
