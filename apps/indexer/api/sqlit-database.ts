/**
 * SQLit Database adapter for Subsquid processor
 *
 * Implements the Database interface from @subsquid/util-internal-processor-tools
 * to work with processor.run() while storing data in SQLit instead of PostgreSQL
 */

import { getSQLit, type QueryParam, type SQLitClient } from '@jejunetwork/db'

// Interface matching subsquid's FinalTxInfo
interface FinalTxInfo {
  prevHead: HashAndHeight
  nextHead: HashAndHeight
  isOnTop: boolean
}

interface HashAndHeight {
  height: number
  hash: string
}

interface DatabaseState {
  height: number
  hash: string
  top: HashAndHeight[]
}

// Entity class type
type EntityClass<E> = { new (...args: unknown[]): E; name?: string }

// Minimal Store interface for our use case
export interface SQLitStoreInterface {
  save<E>(entity: E | E[]): Promise<void>
  insert<E>(entity: E | E[]): Promise<void>
  upsert<E>(entity: E | E[]): Promise<void>
  remove<E>(entity: E | E[]): Promise<void>
  find<E>(entityClass: EntityClass<E>, options?: FindOptions): Promise<E[]>
  get<E>(entityClass: EntityClass<E>, id: string): Promise<E | undefined>
  count<E>(entityClass: EntityClass<E>, options?: FindOptions): Promise<number>
  flush(): Promise<void>
}

interface FindOptions {
  where?: Record<string, QueryParam>
  order?: Record<string, 'ASC' | 'DESC'>
  take?: number
}

// Status table for tracking processor progress
const STATUS_TABLE = '_squid_processor_status'

/**
 * SQLit Database adapter for Subsquid processor
 */
export class SQLitDatabase {
  private client: SQLitClient
  private databaseId: string
  readonly supportsHotBlocks = false

  constructor(options: { databaseId: string }) {
    this.client = getSQLit()
    this.databaseId = options.databaseId
  }

  /**
   * Connect to SQLit and return current state
   */
  async connect(): Promise<DatabaseState> {
    console.log(
      '[SQLitDatabase] Connecting to SQLit database:',
      this.databaseId,
    )

    // Ensure status table exists
    await this.ensureStatusTable()

    // Get current height
    const state = await this.getState()

    console.log('[SQLitDatabase] Connected, current height:', state.height)

    return state
  }

  /**
   * Process a batch of blocks in a transaction
   */
  async transact(
    info: FinalTxInfo,
    cb: (store: SQLitStoreInterface) => Promise<void>,
  ): Promise<void> {
    const store = new SQLitStore(this.client, this.databaseId)

    try {
      await cb(store)

      // Flush all pending writes
      await store.flush()

      // Update processor status
      await this.updateStatus(info.nextHead.height, info.nextHead.hash)

      console.log(`[SQLitDatabase] Processed to block ${info.nextHead.height}`)
    } catch (error) {
      console.error('[SQLitDatabase] Transaction failed:', error)
      throw error
    }
  }

  /**
   * Ensure status table exists
   */
  private async ensureStatusTable(): Promise<void> {
    try {
      await this.client.exec(
        `
        CREATE TABLE IF NOT EXISTS "${STATUS_TABLE}" (
          id INTEGER PRIMARY KEY,
          height INTEGER NOT NULL,
          hash TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        `,
        [],
        this.databaseId,
      )
    } catch (error) {
      console.warn('[SQLitDatabase] Failed to create status table:', error)
    }
  }

  /**
   * Get current processor state
   */
  private async getState(): Promise<DatabaseState> {
    try {
      const result = await this.client.query<{ height: number; hash: string }>(
        `SELECT height, hash FROM "${STATUS_TABLE}" WHERE id = 1 LIMIT 1`,
        [],
        this.databaseId,
      )

      if (result.rows.length > 0) {
        const { height, hash } = result.rows[0]
        return {
          height,
          hash,
          top: [{ height, hash }],
        }
      }
    } catch {
      // Table might not exist or be empty
    }

    // Return initial state
    return {
      height: -1,
      hash: '',
      top: [],
    }
  }

  /**
   * Update processor status
   */
  private async updateStatus(height: number, hash: string): Promise<void> {
    await this.client.exec(
      `
      INSERT INTO "${STATUS_TABLE}" (id, height, timestamp)
      VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        height = excluded.height,
        timestamp = excluded.timestamp
      `,
      [height, new Date().toISOString()],
      this.databaseId,
    )
  }
}

/**
 * SQLit Store implementation
 */
class SQLitStore implements SQLitStoreInterface {
  private client: SQLitClient
  private databaseId: string
  private pendingWrites: Map<string, Record<string, unknown>[]> = new Map()

  constructor(client: SQLitClient, databaseId: string) {
    this.client = client
    this.databaseId = databaseId
  }

  async save<E>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const entityObj = e as Record<string, unknown>
      const entityCtor = entityObj.constructor as EntityClass<E>
      const tableName = this.getTableName(entityCtor)

      if (!this.pendingWrites.has(tableName)) {
        this.pendingWrites.set(tableName, [])
      }
      const pending = this.pendingWrites.get(tableName)
      if (pending) {
        pending.push(entityObj)
      }
    }
  }

  async insert<E>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async upsert<E>(entity: E | E[]): Promise<void> {
    return this.save(entity)
  }

  async remove<E>(entity: E | E[]): Promise<void> {
    const entities = Array.isArray(entity) ? entity : [entity]
    if (entities.length === 0) return

    for (const e of entities) {
      const entityObj = e as Record<string, unknown>
      const entityCtor = entityObj.constructor as EntityClass<E>
      const tableName = this.getTableName(entityCtor)
      const id = entityObj.id as QueryParam

      await this.client.exec(
        `DELETE FROM "${tableName}" WHERE id = ?`,
        [id],
        this.databaseId,
      )
    }
  }

  async find<E>(
    entityClass: EntityClass<E>,
    options?: FindOptions,
  ): Promise<E[]> {
    const tableName = this.getTableName(entityClass)
    let sql = `SELECT * FROM "${tableName}"`
    const params: QueryParam[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    if (options?.order) {
      const orderClauses: string[] = []
      for (const [key, direction] of Object.entries(options.order)) {
        orderClauses.push(`"${key}" ${direction}`)
      }
      if (orderClauses.length > 0) {
        sql += ` ORDER BY ${orderClauses.join(', ')}`
      }
    }

    if (options?.take) {
      sql += ` LIMIT ${options.take}`
    }

    const result = await this.client.query(sql, params, this.databaseId)
    return result.rows as E[]
  }

  async get<E>(
    entityClass: EntityClass<E>,
    id: string,
  ): Promise<E | undefined> {
    const tableName = this.getTableName(entityClass)
    const result = await this.client.query(
      `SELECT * FROM "${tableName}" WHERE id = ? LIMIT 1`,
      [id],
      this.databaseId,
    )
    return result.rows[0] as E | undefined
  }

  async count<E>(
    entityClass: EntityClass<E>,
    options?: FindOptions,
  ): Promise<number> {
    const tableName = this.getTableName(entityClass)
    let sql = `SELECT COUNT(*) as count FROM "${tableName}"`
    const params: QueryParam[] = []

    if (options?.where) {
      const conditions: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        conditions.push(`"${key}" = ?`)
        params.push(value)
      }
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
    }

    const result = await this.client.query<{ count: number }>(
      sql,
      params,
      this.databaseId,
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  async flush(): Promise<void> {
    for (const [tableName, entities] of this.pendingWrites.entries()) {
      if (entities.length === 0) continue
      await this.batchUpsert(tableName, entities)
    }
    this.pendingWrites.clear()
  }

  private camelToSnake(str: string): string {
    return str.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()
  }

  // Map entity property names to database column names
  // Handles relations (from -> from_id, block -> block_id, etc.)
  private mapPropertyToColumn(
    prop: string,
    tableName: string,
  ): string | null {
    // Relation mappings - convert relation properties to _id columns
    // Note: Some relations don't exist in schema and should be filtered out
    const relationMappings: Record<string, string | null> = {
      from: 'from_id',
      to: 'to_id',
      block: 'block_id',
      miner: 'miner_id',
      account: 'account_id',
      contract: null, // Account.contract relation doesn't exist in schema - filter it out
      creator: 'creator_id',
      transaction: 'transaction_id',
      log: 'log_id',
      token: 'token_address', // Special case for token_transfer
      address: 'address', // Default mapping - will be overridden for non-log tables
      owner: 'owner_id', // For approval events
      approved: 'approved_id', // For NFT approval events
      operator: 'operator_id', // For NFT approval events
      spender: 'spender_id', // For token approval events
    }

    // Check if it's a relation that should map to _id
    // Special handling for address property:
    // - log.address: stored as address column (Account relation)
    // - account.address: stored as address column (direct string property)
    // - contract.address: stored as address column (direct string property)
    // - decoded_event.address: filtered out (relation doesn't exist in schema)
    if (
      prop === 'address' &&
      tableName !== 'log' &&
      tableName !== 'account' &&
      tableName !== 'contract'
    ) {
      return null // Filter out address for decoded_event and other tables
    }

    // Special handling for decoded_event - filter out block, transaction, address, timestamp relations
    if (tableName === 'decoded_event') {
      if (prop === 'block' || prop === 'transaction' || prop === 'address' || prop === 'timestamp') {
        return null // These relations don't exist in decoded_event schema
      }
      // Map eventName -> name and eventSignature -> signature
      if (prop === 'eventName') {
        return 'name'
      }
      if (prop === 'eventSignature') {
        return 'signature'
      }
    }

    // Special handling for token_transfer - filter out properties that don't exist in schema
    if (tableName === 'token_transfer') {
      if (prop === 'block') {
        return null // token_transfer doesn't have block_id, only block_number
      }
      if (prop === 'operator') {
        return null // token_transfer doesn't have operator_id column (only ERC1155 transfers have operator)
      }
      if (prop === 'logIndex') {
        return null // token_transfer doesn't have log_index column (only log_id)
      }
    }

    // Special handling for nft_approval_event - filter out properties that don't exist in schema
    if (tableName === 'nft_approval_event') {
      if (prop === 'block') {
        return null // nft_approval_event doesn't have block_id, only block_number
      }
      if (prop === 'isApprovalForAll') {
        return null // Schema doesn't have this column
      }
      if (prop === 'tokenStandard') {
        return null // Schema doesn't have this column
      }
      if (prop === 'chainId') {
        return null // Schema doesn't have this column
      }
    }

    // Special handling for token_approval_event - filter out properties that don't exist in schema
    if (tableName === 'token_approval_event') {
      if (prop === 'block') {
        return null // token_approval_event doesn't have block_id, only block_number
      }
      if (prop === 'isRevoke') {
        return null // Schema doesn't have this column
      }
      if (prop === 'chainId') {
        return null // Schema doesn't have this column
      }
    }

    // Special handling for _squid_processor_status - only id, height, timestamp columns exist
    if (tableName === '_squid_processor_status') {
      if (prop === 'hash' || prop === 'block' || prop === 'blockHash') {
        return null // These properties don't exist in _squid_processor_status schema
      }
    }
    
    const mapped = relationMappings[prop]
    if (mapped !== undefined) {
      // null means filter it out (relation doesn't exist in schema)
      if (mapped === null) {
        return null
      }
      return mapped
    }

    // Convert camelCase to snake_case
    const snakeCase = this.camelToSnake(prop)

    // Filter out properties that don't exist in schema
    const validColumns: Record<string, string[]> = {
      account: [
        'id',
        'address',
        'balance',
        'transaction_count',
        'is_contract',
        'created_at',
        'first_seen_block',
        // Note: contract relation is not stored as contract_id in schema
      ],
      block: [
        'id',
        'number',
        'hash',
        'parent_hash',
        'timestamp',
        'transaction_count',
        'gas_used',
        'gas_limit',
        'base_fee_per_gas',
        'size',
        'miner_id',
      ],
      transaction: [
        'id',
        'hash',
        'from_id',
        'to_id',
        'block_id',
        'block_number',
        'transaction_index',
        'value',
        'gas_price',
        'gas_limit',
        'gas_used',
        'input',
        'nonce',
        'status',
        'type',
        'max_fee_per_gas',
        'max_priority_fee_per_gas',
        'contract_address_id',
      ],
      contract: [
        'id',
        'address',
        'creator_id',
        'creation_tx_id',
        'creation_block',
        'bytecode',
        'contract_type',
        'name',
        'symbol',
        'decimals',
        'verified',
        'is_proxy',
        'implementation_address',
      ],
      log: [
        'id',
        'log_index',
        'transaction_id',
        'block_id',
        'block_number',
        'address',
        'topic0',
        'topic1',
        'topic2',
        'topic3',
        'data',
      ],
      decoded_event: [
        'id',
        'log_id',
        'name', // Maps from eventName property
        'signature', // Maps from eventSignature property
        'contract_type',
        'args',
        // Note: address, block, transaction, log, timestamp relations are not stored as columns
      ],
      token_transfer: [
        'id',
        'transaction_id',
        'log_id',
        'block_number',
        'timestamp',
        'token_address',
        'from_id',
        'to_id',
        'value',
        'token_id',
        'token_standard',
      ],
      token_balance: [
        'id',
        'account_id',
        'token_address',
        'balance',
        'token_standard',
        'token_id',
        'last_updated_block',
      ],
    }

    const validCols = validColumns[tableName] || []
    if (validCols.includes(snakeCase)) {
      return snakeCase
    }

    // Property doesn't exist in schema, skip it
    return null
  }

  // Extract value from entity property, handling relations and arrays
  private extractValue(
    val: unknown,
    prop: string,
    tableName: string,
  ): QueryParam | null {
    if (val === null || val === undefined) {
      return null
    }

    // Special case: log.address is stored as address string, not relation ID
    if (tableName === 'log' && prop === 'address') {
      // If it's a relation object (Account), extract the address property
      if (
        typeof val === 'object' &&
        'address' in val &&
        typeof (val as { address: unknown }).address === 'string'
      ) {
        return (val as { address: string }).address
      }
      // If it's already a string, use as-is
      if (typeof val === 'string') {
        return val
      }
      // If it's an object with id, try to use id as address (fallback)
      if (
        typeof val === 'object' &&
        'id' in val &&
        typeof (val as { id: unknown }).id === 'string'
      ) {
        return (val as { id: string }).id
      }
      return null
    }

    // Special case: log.block_number - extract number from block relation
    if (tableName === 'log' && prop === 'blockNumber') {
      // This should come from block.number, but if blockNumber is directly set, use it
      if (typeof val === 'number') {
        return val
      }
      return null
    }

    // Special case: token_transfer.token, approval events.token maps to token_address (extract address from Contract)
    if (
      (tableName === 'token_transfer' ||
        tableName === 'nft_approval_event' ||
        tableName === 'token_approval_event') &&
      prop === 'token'
    ) {
      if (
        typeof val === 'object' &&
        'address' in val &&
        typeof (val as { address: unknown }).address === 'string'
      ) {
        return (val as { address: string }).address
      }
      if (typeof val === 'string') {
        return val
      }
      return null
    }

    // Handle relation objects - extract their id
    if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      !(val instanceof Date) &&
      !Buffer.isBuffer(val) &&
      !(val instanceof Uint8Array) &&
      'id' in val &&
      typeof (val as { id: unknown }).id === 'string'
    ) {
      return (val as { id: string }).id
    }

    // Handle arrays (like labels) - convert to JSON
    if (Array.isArray(val)) {
      const stringifyWithBigInt = (obj: unknown): string => {
        return JSON.stringify(obj, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        )
      }
      return stringifyWithBigInt(val)
    }

    // Handle Date
    if (val instanceof Date) {
      return val.toISOString()
    }

    // Handle BigInt
    if (typeof val === 'bigint') {
      return val.toString()
    }

    // Handle boolean
    if (typeof val === 'boolean') {
      return val ? 1 : 0
    }

    // Handle objects (non-relations) - stringify
    if (
      typeof val === 'object' &&
      !Buffer.isBuffer(val) &&
      !(val instanceof Uint8Array)
    ) {
      const stringifyWithBigInt = (obj: unknown): string => {
        return JSON.stringify(obj, (_, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        )
      }
      return stringifyWithBigInt(val)
    }

    // Handle primitives
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      val instanceof Uint8Array
    ) {
      return val
    }

    // Fallback
    return String(val)
  }

  private async batchUpsert(
    tableName: string,
    entities: Record<string, unknown>[],
  ): Promise<void> {
    if (entities.length === 0) return

    // Build column mapping from first entity
    const sample = entities[0]
    const propertyToColumn = new Map<string, string>()
    const columnOrder: string[] = []

    for (const prop of Object.keys(sample)) {
      if (prop === 'constructor' || prop.startsWith('_')) continue

      const dbCol = this.mapPropertyToColumn(prop, tableName)
      if (dbCol) {
        propertyToColumn.set(prop, dbCol)
        if (!columnOrder.includes(dbCol)) {
          columnOrder.push(dbCol)
        }
      }
    }

    // Add required columns that might not have direct property mappings
    if (tableName === 'log' && !columnOrder.includes('block_number')) {
      columnOrder.push('block_number')
    }
    if (tableName === 'token_transfer') {
      if (!columnOrder.includes('block_number')) {
        columnOrder.push('block_number')
      }
      if (!columnOrder.includes('timestamp')) {
        columnOrder.push('timestamp')
      }
    }
    if (tableName === 'nft_approval_event' || tableName === 'token_approval_event') {
      if (!columnOrder.includes('block_number')) {
        columnOrder.push('block_number')
      }
      if (!columnOrder.includes('timestamp')) {
        columnOrder.push('timestamp')
      }
    }
    if (tableName === 'token_balance') {
      // token_standard is required but not in entity - derive from token contract
      if (!columnOrder.includes('token_standard')) {
        columnOrder.push('token_standard')
      }
      // token_address is required - extract from token relation
      if (!columnOrder.includes('token_address')) {
        columnOrder.push('token_address')
      }
      // last_updated_block is required - extract from lastUpdated or block
      if (!columnOrder.includes('last_updated_block')) {
        columnOrder.push('last_updated_block')
      }
    }

    if (columnOrder.length === 0) {
      console.warn(`[SQLitStore] No valid columns found for ${tableName}`)
      return
    }

    const quotedCols = columnOrder.map((c) => `"${c}"`)
    const placeholders = columnOrder.map(() => '?').join(', ')
    const values: QueryParam[] = []
    const valuesClauses: string[] = []

    for (const entity of entities) {
      valuesClauses.push(`(${placeholders})`)
      for (const dbCol of columnOrder) {
        // Find the property that maps to this column
        let prop: string | undefined
        for (const [p, c] of propertyToColumn.entries()) {
          if (c === dbCol) {
            prop = p
            break
          }
        }

        // Special case: log.block_number, token_transfer.block_number, and approval events - extract from block.number
        if (
          (tableName === 'log' ||
            tableName === 'token_transfer' ||
            tableName === 'nft_approval_event' ||
            tableName === 'token_approval_event') &&
          dbCol === 'block_number' &&
          !prop
        ) {
          const block = entity['block']
          if (
            block &&
            typeof block === 'object' &&
            'number' in block &&
            typeof block.number === 'number'
          ) {
            values.push(block.number)
            continue
          }
          // Fallback: try to get from blockNumber property if it exists
          if ('blockNumber' in entity && typeof entity.blockNumber === 'number') {
            values.push(entity.blockNumber)
            continue
          }
          values.push(null)
          continue
        }

        // Special case: token_transfer.timestamp and approval events - extract from block.timestamp or timestamp property
        if (
          (tableName === 'token_transfer' ||
            tableName === 'nft_approval_event' ||
            tableName === 'token_approval_event') &&
          dbCol === 'timestamp' &&
          !prop
        ) {
          // First try direct timestamp property
          if ('timestamp' in entity) {
            const ts = entity.timestamp
            if (ts instanceof Date) {
              values.push(ts.toISOString())
              continue
            }
            if (typeof ts === 'string') {
              values.push(ts)
              continue
            }
          }
          // Fallback: extract from block.timestamp
          const block = entity['block']
          if (
            block &&
            typeof block === 'object' &&
            'timestamp' in block &&
            block.timestamp instanceof Date
          ) {
            values.push(block.timestamp.toISOString())
            continue
          }
          values.push(null)
          continue
        }

        // Special case: token_transfer.value - handle null values (ERC721 NFTs don't have value)
        if (tableName === 'token_transfer' && dbCol === 'value' && prop === 'value') {
          const val = entity[prop]
          if (val === null || val === undefined) {
            // For ERC721 NFTs, value is null - use "0" as default
            values.push('0')
            continue
          }
          // For BigInt values, convert to string
          if (typeof val === 'bigint') {
            values.push(val.toString())
            continue
          }
          // For string values, use as-is
          if (typeof val === 'string') {
            values.push(val)
            continue
          }
          // Fallback: convert to string
          values.push(String(val))
          continue
        }

        // Special case: approval events.token_address - extract from token relation
        if (
          (tableName === 'nft_approval_event' || tableName === 'token_approval_event') &&
          dbCol === 'token_address' &&
          !prop
        ) {
          const token = entity['token']
          if (token && typeof token === 'object' && 'address' in token && typeof token.address === 'string') {
            values.push(token.address)
            continue
          }
          values.push(null)
          continue
        }

        // Special case: token_approval_event.value - handle BigInt conversion
        if (tableName === 'token_approval_event' && dbCol === 'value' && prop === 'value') {
          const val = entity[prop]
          if (val === null || val === undefined) {
            values.push('0')
            continue
          }
          // For BigInt values, convert to string
          if (typeof val === 'bigint') {
            values.push(val.toString())
            continue
          }
          // For string values, use as-is
          if (typeof val === 'string') {
            values.push(val)
            continue
          }
          // Fallback: convert to string
          values.push(String(val))
          continue
        }

        // Special case: approval events.token_address - extract from token relation
        if (
          (tableName === 'nft_approval_event' || tableName === 'token_approval_event') &&
          dbCol === 'token_address' &&
          !prop
        ) {
          const token = entity['token']
          if (token && typeof token === 'object' && 'address' in token && typeof token.address === 'string') {
            values.push(token.address)
            continue
          }
          values.push(null)
          continue
        }

        // Special case: token_approval_event.value - handle BigInt conversion
        if (tableName === 'token_approval_event' && dbCol === 'value' && prop === 'value') {
          const val = entity[prop]
          if (val === null || val === undefined) {
            values.push('0')
            continue
          }
          // For BigInt values, convert to string
          if (typeof val === 'bigint') {
            values.push(val.toString())
            continue
          }
          // For string values, use as-is
          if (typeof val === 'string') {
            values.push(val)
            continue
          }
          // Fallback: convert to string
          values.push(String(val))
          continue
        }

        // Special case: nft_approval_event.approved - convert boolean to integer
        if (tableName === 'nft_approval_event' && dbCol === 'approved' && prop === 'approved') {
          const val = entity[prop]
          if (val === null || val === undefined) {
            values.push(null)
            continue
          }
          // Convert boolean to integer (0 or 1)
          if (typeof val === 'boolean') {
            values.push(val ? 1 : 0)
            continue
          }
          // For number values, use as-is
          if (typeof val === 'number') {
            values.push(val)
            continue
          }
          // Fallback: convert to integer
          values.push(val ? 1 : 0)
          continue
        }

        // Special case: token_balance.token_standard - derive from token contract
        if (tableName === 'token_balance' && dbCol === 'token_standard' && !prop) {
          const token = entity['token']
          if (token && typeof token === 'object') {
            if ('isERC1155' in token && token.isERC1155 === true) {
              values.push('ERC1155')
              continue
            }
            if ('isERC721' in token && token.isERC721 === true) {
              values.push('ERC721')
              continue
            }
            if ('isERC20' in token && token.isERC20 === true) {
              values.push('ERC20')
              continue
            }
          }
          // Default to ERC20 if we can't determine
          values.push('ERC20')
          continue
        }

        // Special case: token_balance.token_address - extract from token relation
        if (tableName === 'token_balance' && dbCol === 'token_address' && !prop) {
          const token = entity['token']
          if (token && typeof token === 'object' && 'address' in token && typeof token.address === 'string') {
            values.push(token.address)
            continue
          }
          values.push(null)
          continue
        }

        // Special case: token_balance.last_updated_block - extract from blockNumber property or block relation
        if (tableName === 'token_balance' && dbCol === 'last_updated_block' && !prop) {
          // Try to get from blockNumber property (set when balance is updated)
          if ('blockNumber' in entity && typeof entity.blockNumber === 'number') {
            values.push(entity.blockNumber)
            continue
          }
          // Try to get from a block relation if it exists
          const block = entity['block']
          if (block && typeof block === 'object' && 'number' in block && typeof block.number === 'number') {
            values.push(block.number)
            continue
          }
          // Fallback to 0 if we can't determine
          values.push(0)
          continue
        }

        if (!prop) {
          values.push(null)
          continue
        }

        const val = entity[prop]
        const extracted = this.extractValue(val, prop, tableName)
        values.push(extracted)
      }
    }

    const updateCols = columnOrder.filter((c) => c !== 'id')
    const updateSet =
      updateCols.length > 0
        ? updateCols.map((c) => `"${c}" = excluded."${c}"`).join(', ')
        : '"id" = excluded."id"' // Fallback if only id column

    const sql = `
      INSERT INTO "${tableName}" (${quotedCols.join(', ')})
      VALUES ${valuesClauses.join(', ')}
      ON CONFLICT (id) DO UPDATE SET ${updateSet}
    `.trim()

    try {
      await this.client.exec(sql, values, this.databaseId)
      console.log(`[SQLitStore] Saved ${entities.length} ${tableName} records`)
    } catch (error) {
      console.error(`[SQLitStore] Failed to save ${tableName}:`, error)
      throw error // Re-throw to see the actual error
    }
  }

  private getTableName<E>(entityClass: EntityClass<E>): string {
    const name = entityClass.name ?? 'unknown'
    return name
      .replace(/([a-z\d])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase()
  }
}
