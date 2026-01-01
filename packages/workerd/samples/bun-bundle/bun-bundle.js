// Auto-generated Bun compatibility bundle for workerd
// This provides Bun APIs in workerd environments
// IMPORTANT: Implementations must match src/bun/bun.ts exactly

// Internal utilities
const isString = (v) => typeof v === 'string'
const isUint8Array = (v) => v instanceof Uint8Array
const isArrayBuffer = (v) => v instanceof ArrayBuffer

class BunError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'BunError'
    this.code = code
  }
}

class ERR_FS_FILE_NOT_FOUND extends BunError {
  constructor(path) {
    super(`ENOENT: no such file or directory, open '${path}'`, 'ENOENT')
    this.name = 'ERR_FS_FILE_NOT_FOUND'
  }
}

class ERR_WORKERD_UNAVAILABLE extends BunError {
  constructor(feature, reason) {
    const msg = reason
      ? `${feature} is not available in workerd: ${reason}`
      : `${feature} is not available in workerd`
    super(msg, 'ERR_WORKERD_UNAVAILABLE')
    this.name = 'ERR_WORKERD_UNAVAILABLE'
  }
}

// Virtual file system for workerd
const virtualFS = new Map()
const virtualFSMetadata = new Map()

// BunFile implementation - matches bun.ts BunFileImpl
class BunFileImpl {
  #path
  #type
  
  constructor(path, options = {}) {
    this.#path = typeof path === 'string' ? path : path.pathname
    this.#type = options.type ?? 'application/octet-stream'
  }
  
  get size() {
    const data = virtualFS.get(this.#path)
    return data ? data.byteLength : 0
  }
  
  get type() {
    return virtualFSMetadata.get(this.#path)?.type ?? this.#type
  }
  
  get name() { return this.#path }
  
  get lastModified() {
    return virtualFSMetadata.get(this.#path)?.lastModified ?? Date.now()
  }
  
  async text() {
    const data = virtualFS.get(this.#path)
    if (!data) throw new ERR_FS_FILE_NOT_FOUND(this.#path)
    return new TextDecoder().decode(data)
  }
  
  async json() {
    return JSON.parse(await this.text())
  }
  
  async arrayBuffer() {
    const data = virtualFS.get(this.#path)
    if (!data) throw new ERR_FS_FILE_NOT_FOUND(this.#path)
    const ab = data.buffer
    if (ab instanceof ArrayBuffer) {
      return ab.slice(data.byteOffset, data.byteOffset + data.byteLength)
    }
    const copy = new ArrayBuffer(data.byteLength)
    new Uint8Array(copy).set(data)
    return copy
  }
  
  async bytes() {
    const data = virtualFS.get(this.#path)
    if (!data) throw new ERR_FS_FILE_NOT_FOUND(this.#path)
    return new Uint8Array(data)
  }
  
  stream() {
    const data = virtualFS.get(this.#path)
    if (!data) throw new ERR_FS_FILE_NOT_FOUND(this.#path)
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      }
    })
  }
  
  slice(start, end, type) {
    const data = virtualFS.get(this.#path)
    if (!data) return new BunFileImpl(this.#path, { type: type ?? this.#type })
    const sliced = data.slice(start, end)
    const slicePath = `${this.#path}#slice(${start},${end})`
    virtualFS.set(slicePath, sliced)
    return new BunFileImpl(slicePath, { type: type ?? this.#type })
  }
  
  async exists() {
    return virtualFS.has(this.#path)
  }
  
  writer() {
    const path = this.#path
    const chunks = []
    return {
      write(data) {
        const bytes = isString(data)
          ? new TextEncoder().encode(data)
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : data
        chunks.push(bytes)
        return bytes.byteLength
      },
      flush() {
        const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.byteLength
        }
        virtualFS.set(path, result)
        virtualFSMetadata.set(path, { type: 'application/octet-stream', lastModified: Date.now() })
      },
      end() {
        this.flush()
        chunks.length = 0
      }
    }
  }
}

// ArrayBufferSink - matches bun.ts
class ArrayBufferSinkImpl {
  #chunks = []
  
  write(data) {
    const bytes = isString(data)
      ? new TextEncoder().encode(data)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : data
    this.#chunks.push(bytes)
  }
  
  end() {
    const totalLength = this.#chunks.reduce((sum, c) => sum + c.byteLength, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of this.#chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    this.#chunks = []
    return result.buffer
  }
  
  flush() {}
  start() { this.#chunks = [] }
}

// Hashing - matches bun.ts wyhash implementation
function wyhash(data, seed = 0) {
  let h = BigInt(seed)
  for (let i = 0; i < data.length; i++) {
    h = (h ^ BigInt(data[i])) * 0x9e3779b97f4a7c15n
    h = h ^ (h >> 32n)
  }
  return h
}

function crc32(data) {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = crc ^ data[i]
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function hash(data, algorithm) {
  const bytes = isString(data)
    ? new TextEncoder().encode(data)
    : isArrayBuffer(data)
      ? new Uint8Array(data)
      : data
  
  switch (algorithm ?? 'wyhash') {
    case 'wyhash': return wyhash(bytes)
    case 'crc32': return crc32(bytes)
    default: return wyhash(bytes)
  }
}

// Deep equals - matches bun.ts exactly
function deepEquals(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEquals(item, b[index]))
  }
  
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => key in b && deepEquals(a[key], b[key]))
  }
  
  return false
}

// Escape HTML - matches bun.ts (&#039; not &#39;)
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// String width - matches bun.ts (no control char skip)
function stringWidth(str) {
  let width = 0
  for (const char of str) {
    const code = char.codePointAt(0)
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe1f) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    width += isWide ? 2 : 1
  }
  return width
}

// Inspect - matches bun.ts custom implementation
function inspectValue(value, depth, seen) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  
  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value)
  if (type === 'function') return `[Function: ${value.name || 'anonymous'}]`
  if (type === 'symbol') return value.toString()
  
  if (seen.has(value)) return '[Circular]'
  
  if (Array.isArray(value)) {
    if (depth < 0) return '[Array]'
    seen.add(value)
    const items = value.map((item) => inspectValue(item, depth - 1, seen))
    seen.delete(value)
    return `[ ${items.join(', ')} ]`
  }
  
  if (value instanceof Date) return value.toISOString()
  if (value instanceof RegExp) return value.toString()
  if (value instanceof Error) return `${value.name}: ${value.message}`
  
  if (type === 'object') {
    if (depth < 0) return '[Object]'
    seen.add(value)
    const entries = Object.entries(value).map(([k, v]) => `${k}: ${inspectValue(v, depth - 1, seen)}`)
    seen.delete(value)
    return `{ ${entries.join(', ')} }`
  }
  
  return String(value)
}

function inspect(obj, options) {
  const depth = options?.depth ?? 2
  return inspectValue(obj, depth, new Set())
}

// Nanoseconds - matches bun.ts (absolute, not relative)
function nanoseconds() {
  return BigInt(Math.floor(performance.now() * 1_000_000))
}

// Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sleepSync(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {}
}

// Stream utilities - match bun.ts
async function readableStreamToArray(stream) {
  const reader = stream.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

async function readableStreamToText(stream) {
  const chunks = await readableStreamToArray(stream)
  const decoder = new TextDecoder()
  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('')
}

async function readableStreamToArrayBuffer(stream) {
  const chunks = await readableStreamToArray(stream)
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result.buffer
}

async function readableStreamToBlob(stream, type) {
  const buffer = await readableStreamToArrayBuffer(stream)
  return new Blob([buffer], { type })
}

async function readableStreamToJSON(stream) {
  return JSON.parse(await readableStreamToText(stream))
}

// Write utility - matches bun.ts
async function write(dest, data) {
  const destPath = isString(dest) ? dest : dest instanceof URL ? dest.pathname : dest.name
  let bytes
  
  if (isString(data)) {
    bytes = new TextEncoder().encode(data)
  } else if (isArrayBuffer(data)) {
    bytes = new Uint8Array(data)
  } else if (isUint8Array(data)) {
    bytes = data
  } else if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer())
  } else if (data instanceof Response) {
    bytes = new Uint8Array(await data.arrayBuffer())
  } else {
    bytes = await data.bytes()
  }
  
  virtualFS.set(destPath, bytes)
  virtualFSMetadata.set(destPath, { type: 'application/octet-stream', lastModified: Date.now() })
  return bytes.byteLength
}

// Password hashing - REAL implementation using PBKDF2 (matches bun.ts)
const password = {
  async hash(pwd, options) {
    const algorithm = options?.algorithm ?? 'bcrypt'
    const cost = options?.cost ?? 10
    
    const passwordData = new TextEncoder().encode(pwd)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const keyMaterial = await crypto.subtle.importKey('raw', passwordData, 'PBKDF2', false, ['deriveBits'])
    const iterations = 2 ** cost * 100
    
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    )
    
    const toHex = (arr) => Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
    return `$workerd$${algorithm}$${cost}$${toHex(salt)}$${toHex(new Uint8Array(derivedBits))}`
  },
  
  async verify(pwd, hashStr) {
    if (!hashStr.startsWith('$workerd$')) {
      const data = new TextEncoder().encode(pwd)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const computed = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
      return computed === hashStr
    }
    
    const parts = hashStr.split('$')
    if (parts.length !== 6) return false
    
    const [, , , costStr, saltHex, expectedHashHex] = parts
    const cost = parseInt(costStr, 10)
    const passwordData = new TextEncoder().encode(pwd)
    const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) ?? [])
    const keyMaterial = await crypto.subtle.importKey('raw', passwordData, 'PBKDF2', false, ['deriveBits'])
    const iterations = 2 ** cost * 100
    
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      256
    )
    
    const computedHashHex = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, '0')).join('')
    
    // Constant-time comparison
    if (computedHashHex.length !== expectedHashHex.length) return false
    let result = 0
    for (let i = 0; i < computedHashHex.length; i++) {
      result |= computedHashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i)
    }
    return result === 0
  }
}

// Miscellaneous - match bun.ts
function randomUUIDv7() {
  const timestamp = Date.now()
  const timestampHex = timestamp.toString(16).padStart(12, '0')
  const random = crypto.getRandomValues(new Uint8Array(10))
  const randomHex = Array.from(random).map((b) => b.toString(16).padStart(2, '0')).join('')
  
  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    `7${randomHex.slice(0, 3)}`,
    ((parseInt(randomHex.slice(3, 5), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + randomHex.slice(5, 7),
    randomHex.slice(7, 19),
  ].join('-')
}

function fileURLToPath(url) {
  const urlObj = typeof url === 'string' ? new URL(url) : url
  if (urlObj.protocol !== 'file:') throw new Error('URL must use file: protocol')
  return urlObj.pathname
}

function pathToFileURL(path) {
  return new URL(`file://${path.startsWith('/') ? '' : '/'}${path}`)
}

// Main Bun object - matches bun.ts exports
const Bun = {
  version: '1.0.0-workerd',
  revision: 'workerd-compat',  // MUST match bun.ts
  main: false,
  
  // Environment
  env: typeof process !== 'undefined' ? process.env : {},
  
  // File operations
  file: (path, options) => new BunFileImpl(path, options),
  write,
  
  // Hashing - REAL implementation
  hash,
  
  // Utilities
  sleep,
  sleepSync,
  nanoseconds,
  escapeHTML,
  stringWidth,
  deepEquals,
  inspect,
  
  // Password - REAL implementation
  password,
  
  // Stream utilities
  readableStreamToArray,
  readableStreamToText,
  readableStreamToArrayBuffer,
  readableStreamToBlob,
  readableStreamToJSON,
  
  // ArrayBufferSink
  ArrayBufferSink: ArrayBufferSinkImpl,
  
  // Misc
  randomUUIDv7,
  fileURLToPath,
  pathToFileURL,
  
  // No-op functions (documented as expected)
  gc() {},
  shrink() {},
  
  // Unavailable APIs (throw with clear errors)
  serve() { throw new ERR_WORKERD_UNAVAILABLE('Bun.serve', 'Use workerd fetch handler instead') },
  openInEditor() { throw new ERR_WORKERD_UNAVAILABLE('Bun.openInEditor') },
  generateHeapSnapshot() { throw new ERR_WORKERD_UNAVAILABLE('Bun.generateHeapSnapshot') },
  
  // DNS (not available in workerd)
  dns: {
    async lookup(hostname) { throw new ERR_WORKERD_UNAVAILABLE('Bun.dns.lookup', `DNS lookups for '${hostname}' not available`) },
    async reverse(ip) { throw new ERR_WORKERD_UNAVAILABLE('Bun.dns.reverse', `Reverse DNS for '${ip}' not available`) },
    async resolve(hostname) { throw new ERR_WORKERD_UNAVAILABLE('Bun.dns.resolve', `DNS resolution for '${hostname}' not available`) },
  },
}

// Export for ES modules
export default Bun
export { Bun }