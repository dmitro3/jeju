// Bun Internal Errors for Workerd

export class BunError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'BunError'
    this.code = code
  }
}

export class ERR_FS_FILE_NOT_FOUND extends BunError {
  constructor(path: string) {
    super(`ENOENT: no such file or directory, open '${path}'`, 'ENOENT')
    this.name = 'ERR_FS_FILE_NOT_FOUND'
  }
}

export class ERR_SQLITE_ERROR extends BunError {
  constructor(message: string) {
    super(`SQLite error: ${message}`, 'ERR_SQLITE_ERROR')
    this.name = 'ERR_SQLITE_ERROR'
  }
}

export class ERR_WORKERD_UNAVAILABLE extends BunError {
  constructor(feature: string, reason?: string) {
    const msg = reason
      ? `${feature} is not available in workerd: ${reason}`
      : `${feature} is not available in workerd`
    super(msg, 'ERR_WORKERD_UNAVAILABLE')
    this.name = 'ERR_WORKERD_UNAVAILABLE'
  }
}
