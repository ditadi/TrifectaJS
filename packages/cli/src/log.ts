import chalk from "chalk";

export enum LogType {
    WARNING = "WARNING",
    ERROR = "ERROR",
    SUCCESS = "SUCCESS",
}
export function cliLog(logType: LogType, logMessage: string) {
    switch (logType) {
        case LogType.WARNING:
            console.warn(chalk.yellow(logMessage));
            return;
        case LogType.ERROR:
            console.error(chalk.red(logMessage));
            return;
        case LogType.SUCCESS:
            console.info(chalk.green(logMessage));
            return;
    }
}

export function warningLog(message: string) {
    console.warn(chalk.yellow(message));
}

export function errorLog(message: string) {
    console.error(chalk.red(message));
}

export function successLog(message: string) {
    console.log(chalk.green(message));
}

export function infoLog(message: string) {
    console.info(chalk.cyan(message))
}
