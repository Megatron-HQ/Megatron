interface ChromiumCommandLine {
  appendSwitch(switchName: string): void
}

export function disableChromiumHttpCache(commandLine: ChromiumCommandLine): void {
  commandLine.appendSwitch('disable-http-cache')
}
