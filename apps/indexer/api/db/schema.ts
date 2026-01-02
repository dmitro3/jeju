/**
 * SQLit Schema for Indexer
 *
 * Defines all tables for SQLit database
 * Based on TypeORM entities in src/model/generated/
 */

// Core tables DDL for SQLit
export const SCHEMA_DDL = [
  // Processor status tracking
  `CREATE TABLE IF NOT EXISTS _squid_processor_status (
    id INTEGER PRIMARY KEY,
    height INTEGER NOT NULL,
    timestamp TEXT NOT NULL
  )`,

  // Block table
  `CREATE TABLE IF NOT EXISTS block (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    hash TEXT NOT NULL,
    parent_hash TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    transaction_count INTEGER NOT NULL,
    gas_used TEXT NOT NULL,
    gas_limit TEXT NOT NULL,
    base_fee_per_gas TEXT,
    size INTEGER NOT NULL,
    miner_id TEXT
  )`,

  // Account table
  `CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    balance TEXT NOT NULL DEFAULT '0',
    transaction_count INTEGER NOT NULL DEFAULT 0,
    is_contract INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    first_seen_block INTEGER
  )`,

  // Transaction table (quoted because 'transaction' is a SQLite keyword)
  `CREATE TABLE IF NOT EXISTS "transaction" (
    id TEXT PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    from_id TEXT,
    to_id TEXT,
    block_id TEXT,
    block_number INTEGER NOT NULL,
    transaction_index INTEGER NOT NULL,
    value TEXT NOT NULL,
    gas_price TEXT,
    gas_limit TEXT NOT NULL,
    gas_used TEXT,
    input TEXT,
    nonce INTEGER NOT NULL,
    status TEXT NOT NULL,
    type INTEGER,
    max_fee_per_gas TEXT,
    max_priority_fee_per_gas TEXT,
    contract_address_id TEXT
  )`,

  // Contract table
  `CREATE TABLE IF NOT EXISTS contract (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    creator_id TEXT,
    creation_tx_id TEXT,
    creation_block INTEGER,
    bytecode TEXT,
    contract_type TEXT,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    verified INTEGER NOT NULL DEFAULT 0,
    is_proxy INTEGER NOT NULL DEFAULT 0,
    implementation_address TEXT
  )`,

  // Log table
  `CREATE TABLE IF NOT EXISTS log (
    id TEXT PRIMARY KEY,
    log_index INTEGER NOT NULL,
    transaction_id TEXT,
    block_id TEXT,
    block_number INTEGER NOT NULL,
    address TEXT NOT NULL,
    topic0 TEXT,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,
    data TEXT
  )`,

  // Decoded Event table
  `CREATE TABLE IF NOT EXISTS decoded_event (
    id TEXT PRIMARY KEY,
    log_id TEXT NOT NULL,
    name TEXT NOT NULL,
    signature TEXT NOT NULL,
    contract_type TEXT,
    args TEXT
  )`,

  // Trace table
  `CREATE TABLE IF NOT EXISTS trace (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    block_number INTEGER NOT NULL,
    trace_address TEXT NOT NULL,
    trace_type TEXT NOT NULL,
    from_address TEXT,
    to_address TEXT,
    value TEXT,
    gas TEXT,
    gas_used TEXT,
    input TEXT,
    output TEXT,
    error TEXT,
    revert_reason TEXT
  )`,

  // Token Transfer table
  `CREATE TABLE IF NOT EXISTS token_transfer (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    log_id TEXT,
    block_number INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    token_address TEXT NOT NULL,
    from_id TEXT,
    to_id TEXT,
    value TEXT NOT NULL,
    token_id TEXT,
    token_standard TEXT NOT NULL
  )`,

  // Token Balance table
  `CREATE TABLE IF NOT EXISTS token_balance (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    token_address TEXT NOT NULL,
    balance TEXT NOT NULL,
    token_standard TEXT NOT NULL,
    token_id TEXT,
    last_updated_block INTEGER NOT NULL
  )`,

  // Token table
  `CREATE TABLE IF NOT EXISTS token (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    total_supply TEXT,
    token_standard TEXT NOT NULL,
    holder_count INTEGER NOT NULL DEFAULT 0,
    transfer_count INTEGER NOT NULL DEFAULT 0
  )`,

  // Token Approval Event table
  `CREATE TABLE IF NOT EXISTS token_approval_event (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    block_number INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    token_address TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    spender_id TEXT NOT NULL,
    value TEXT NOT NULL
  )`,

  // NFT Approval Event table
  `CREATE TABLE IF NOT EXISTS nft_approval_event (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    block_number INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    token_address TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    approved_id TEXT,
    operator_id TEXT,
    token_id TEXT,
    approved INTEGER
  )`,

  // Registered Agent table
  `CREATE TABLE IF NOT EXISTS registered_agent (
    id TEXT PRIMARY KEY,
    agent_id INTEGER NOT NULL UNIQUE,
    owner_id TEXT,
    endpoint TEXT,
    metadata_uri TEXT,
    metadata TEXT,
    tags TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    stake_amount TEXT NOT NULL DEFAULT '0',
    reputation_score INTEGER NOT NULL DEFAULT 100,
    total_reports INTEGER NOT NULL DEFAULT 0,
    successful_reports INTEGER NOT NULL DEFAULT 0,
    last_updated_block INTEGER,
    registered_at TEXT,
    is_banned INTEGER NOT NULL DEFAULT 0,
    ban_reason TEXT
  )`,

  // Tag Index table
  `CREATE TABLE IF NOT EXISTS tag_index (
    id TEXT PRIMARY KEY,
    tag TEXT NOT NULL UNIQUE,
    agent_count INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT
  )`,

  // Node Stake table
  `CREATE TABLE IF NOT EXISTS node_stake (
    id TEXT PRIMARY KEY,
    node_address TEXT NOT NULL,
    operator_id TEXT,
    stake_amount TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    joined_at TEXT,
    last_performance_update TEXT,
    uptime_score INTEGER NOT NULL DEFAULT 100,
    response_time_ms INTEGER,
    total_rewards TEXT NOT NULL DEFAULT '0'
  )`,

  // Compute Provider table
  `CREATE TABLE IF NOT EXISTS compute_provider (
    id TEXT PRIMARY KEY,
    provider_address TEXT NOT NULL UNIQUE,
    agent_id INTEGER,
    stake_amount TEXT,
    total_earnings TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    cpu_cores INTEGER,
    memory_gb INTEGER,
    gpu_count INTEGER,
    gpu_model TEXT,
    region TEXT,
    registered_at TEXT
  )`,

  // Storage Provider table
  `CREATE TABLE IF NOT EXISTS storage_provider (
    id TEXT PRIMARY KEY,
    provider_address TEXT NOT NULL UNIQUE,
    agent_id INTEGER,
    stake_amount TEXT,
    total_capacity_gb TEXT,
    used_capacity_gb TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    provider_type TEXT,
    tier TEXT,
    region TEXT,
    registered_at TEXT
  )`,

  // Compute Resource table (required by processor)
  `CREATE TABLE IF NOT EXISTS compute_resource (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    gpu_count INTEGER NOT NULL DEFAULT 0,
    cpu_cores INTEGER NOT NULL DEFAULT 0,
    memory_gb INTEGER NOT NULL DEFAULT 0,
    price_per_hour TEXT NOT NULL DEFAULT '0',
    is_available INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    provider_id TEXT
  )`,

  // Compute Rental table
  `CREATE TABLE IF NOT EXISTS compute_rental (
    id TEXT PRIMARY KEY,
    rental_id TEXT NOT NULL,
    provider_id TEXT,
    renter_id TEXT,
    resource_id TEXT,
    resource_type TEXT,
    cpu_cores INTEGER,
    memory_gb INTEGER,
    gpu_count INTEGER,
    price_per_hour TEXT,
    status TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    total_cost TEXT,
    duration TEXT NOT NULL DEFAULT '0',
    price TEXT NOT NULL DEFAULT '0',
    start_time TEXT,
    end_time TEXT,
    created_at TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL
  )`,

  // Inference Request table (required by processor)
  `CREATE TABLE IF NOT EXISTS inference_request (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    model TEXT NOT NULL,
    max_tokens TEXT NOT NULL DEFAULT '0',
    tokens_used TEXT,
    status TEXT NOT NULL,
    response_hash TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    requester_id TEXT,
    provider_id TEXT
  )`,

  // Compute Ledger Balance table
  `CREATE TABLE IF NOT EXISTS compute_ledger_balance (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    balance TEXT NOT NULL DEFAULT '0',
    locked_amount TEXT NOT NULL DEFAULT '0',
    last_updated TEXT NOT NULL,
    account_id TEXT
  )`,

  // Storage Ledger Balance table (required by processor)
  `CREATE TABLE IF NOT EXISTS storage_ledger_balance (
    id TEXT PRIMARY KEY,
    total_balance TEXT NOT NULL DEFAULT '0',
    available_balance TEXT NOT NULL DEFAULT '0',
    locked_balance TEXT NOT NULL DEFAULT '0',
    pending_refund TEXT NOT NULL DEFAULT '0',
    refund_unlock_time TEXT,
    last_updated TEXT NOT NULL,
    user_id TEXT,
    provider_id TEXT
  )`,

  // Storage Deal table
  `CREATE TABLE IF NOT EXISTS storage_deal (
    id TEXT PRIMARY KEY,
    deal_id TEXT NOT NULL,
    provider_id TEXT,
    client_id TEXT,
    cid TEXT,
    size_bytes TEXT,
    price_per_gb TEXT,
    duration_days INTEGER,
    status TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    total_cost TEXT
  )`,

  // Container Image table
  `CREATE TABLE IF NOT EXISTS container_image (
    id TEXT PRIMARY KEY,
    cid TEXT NOT NULL UNIQUE,
    name TEXT,
    description TEXT,
    owner_id TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    architecture TEXT,
    size_bytes TEXT,
    created_at TEXT,
    pull_count INTEGER NOT NULL DEFAULT 0
  )`,

  // Cross Service Request table
  `CREATE TABLE IF NOT EXISTS cross_service_request (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    requester_id TEXT,
    provider_id TEXT,
    request_type TEXT NOT NULL,
    status TEXT NOT NULL,
    compute_cid TEXT,
    storage_cid TEXT,
    created_at TEXT,
    completed_at TEXT,
    error TEXT
  )`,

  // Oracle Feed table
  `CREATE TABLE IF NOT EXISTS oracle_feed (
    id TEXT PRIMARY KEY,
    feed_id TEXT NOT NULL UNIQUE,
    name TEXT,
    description TEXT,
    category TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    heartbeat_interval INTEGER,
    deviation_threshold TEXT,
    latest_value TEXT,
    latest_timestamp TEXT,
    total_reports INTEGER NOT NULL DEFAULT 0
  )`,

  // Oracle Operator table
  `CREATE TABLE IF NOT EXISTS oracle_operator (
    id TEXT PRIMARY KEY,
    operator_address TEXT NOT NULL UNIQUE,
    name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_jailed INTEGER NOT NULL DEFAULT 0,
    staked_amount TEXT NOT NULL DEFAULT '0',
    total_earnings TEXT NOT NULL DEFAULT '0',
    participation_score INTEGER NOT NULL DEFAULT 100,
    accuracy_score INTEGER NOT NULL DEFAULT 100,
    total_reports INTEGER NOT NULL DEFAULT 0,
    registered_at TEXT
  )`,

  // Oracle Report table
  `CREATE TABLE IF NOT EXISTS oracle_report (
    id TEXT PRIMARY KEY,
    feed_id TEXT,
    operator_id TEXT,
    value TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    transaction_id TEXT,
    is_disputed INTEGER NOT NULL DEFAULT 0
  )`,

  // Oracle Dispute table
  `CREATE TABLE IF NOT EXISTS oracle_dispute (
    id TEXT PRIMARY KEY,
    dispute_id TEXT NOT NULL,
    report_id TEXT,
    disputer_id TEXT,
    status TEXT NOT NULL,
    outcome TEXT,
    created_at TEXT,
    resolved_at TEXT,
    reason TEXT
  )`,

  // Oracle Subscription table
  `CREATE TABLE IF NOT EXISTS oracle_subscription (
    id TEXT PRIMARY KEY,
    subscriber_id TEXT,
    feed_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    expires_at TEXT
  )`,

  // JNS Name table
  `CREATE TABLE IF NOT EXISTS jns_name (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    owner_id TEXT,
    resolver TEXT,
    expires_at TEXT,
    registered_at TEXT,
    registration_block INTEGER
  )`,

  // Marketplace Stats table (aggregated)
  `CREATE TABLE IF NOT EXISTS marketplace_stats (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    total_compute_providers INTEGER NOT NULL DEFAULT 0,
    active_compute_providers INTEGER NOT NULL DEFAULT 0,
    total_storage_providers INTEGER NOT NULL DEFAULT 0,
    active_storage_providers INTEGER NOT NULL DEFAULT 0,
    total_rentals INTEGER NOT NULL DEFAULT 0,
    total_deals INTEGER NOT NULL DEFAULT 0,
    total_agents INTEGER NOT NULL DEFAULT 0
  )`,

  // EIL (Ethereum Interop Layer) tables
  // XLP (Cross-Liquidity Provider) table
  `CREATE TABLE IF NOT EXISTS xlp (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    staked_amount TEXT NOT NULL DEFAULT '0',
    unbonding_amount TEXT NOT NULL DEFAULT '0',
    unbonding_start_time TEXT,
    slashed_amount TEXT NOT NULL DEFAULT '0',
    is_active INTEGER NOT NULL DEFAULT 1,
    registered_at TEXT NOT NULL,
    supported_chains TEXT NOT NULL DEFAULT '[]',
    total_vouchers_issued INTEGER NOT NULL DEFAULT 0,
    total_vouchers_fulfilled INTEGER NOT NULL DEFAULT 0,
    total_vouchers_failed INTEGER NOT NULL DEFAULT 0,
    total_fees_earned TEXT NOT NULL DEFAULT '0',
    average_response_time_ms INTEGER NOT NULL DEFAULT 0,
    reputation INTEGER NOT NULL DEFAULT 0
  )`,

  // XLP Liquidity Deposit table
  `CREATE TABLE IF NOT EXISTS xlp_liquidity_deposit (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    amount TEXT NOT NULL DEFAULT '0',
    eth_amount TEXT NOT NULL DEFAULT '0',
    last_updated TEXT NOT NULL,
    xlp_id TEXT
  )`,

  // XLP Slash Event table
  `CREATE TABLE IF NOT EXISTS xlp_slash_event (
    id TEXT PRIMARY KEY,
    voucher_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    amount TEXT NOT NULL DEFAULT '0',
    victim TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    disputed INTEGER NOT NULL DEFAULT 0,
    tx_hash TEXT NOT NULL,
    xlp_id TEXT
  )`,

  // Cross Chain Voucher Request table
  `CREATE TABLE IF NOT EXISTS cross_chain_voucher_request (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    source_chain INTEGER NOT NULL,
    destination_chain INTEGER NOT NULL,
    source_token TEXT NOT NULL,
    destination_token TEXT NOT NULL,
    amount TEXT NOT NULL DEFAULT '0',
    max_fee TEXT NOT NULL DEFAULT '0',
    current_fee TEXT NOT NULL DEFAULT '0',
    fee_increment TEXT NOT NULL DEFAULT '0',
    recipient TEXT NOT NULL,
    gas_on_destination TEXT NOT NULL DEFAULT '0',
    deadline TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_block TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    expired INTEGER NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    requester_id TEXT,
    voucher_id TEXT
  )`,

  // Cross Chain Voucher table
  `CREATE TABLE IF NOT EXISTS cross_chain_voucher (
    id TEXT PRIMARY KEY,
    voucher_id TEXT NOT NULL UNIQUE,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER NOT NULL,
    source_token TEXT NOT NULL,
    destination_token TEXT NOT NULL,
    amount TEXT NOT NULL DEFAULT '0',
    fee TEXT NOT NULL DEFAULT '0',
    gas_provided TEXT NOT NULL DEFAULT '0',
    issued_at TEXT NOT NULL,
    issued_block TEXT NOT NULL,
    expires_block TEXT NOT NULL,
    status TEXT NOT NULL,
    fulfilled INTEGER NOT NULL DEFAULT 0,
    slashed INTEGER NOT NULL DEFAULT 0,
    source_claim_tx TEXT,
    destination_fulfill_tx TEXT,
    fulfillment_time TEXT,
    request_id TEXT,
    xlp_id TEXT
  )`,

  // EIL Transfer table
  `CREATE TABLE IF NOT EXISTS eil_transfer (
    id TEXT PRIMARY KEY,
    source_chain INTEGER NOT NULL,
    destination_chain INTEGER NOT NULL,
    source_token TEXT NOT NULL,
    destination_token TEXT NOT NULL,
    amount TEXT NOT NULL DEFAULT '0',
    fee TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL,
    initiated_at TEXT NOT NULL,
    completed_at TEXT,
    source_tx_hash TEXT NOT NULL,
    destination_tx_hash TEXT,
    user_id TEXT,
    xlp_id TEXT,
    request_id TEXT,
    voucher_id TEXT
  )`,

  // EIL Stats table
  `CREATE TABLE IF NOT EXISTS eil_stats (
    id TEXT PRIMARY KEY,
    date TEXT,
    total_volume_usd TEXT NOT NULL DEFAULT '0',
    total_transactions TEXT NOT NULL DEFAULT '0',
    total_xl_ps INTEGER NOT NULL DEFAULT 0,
    active_xl_ps INTEGER NOT NULL DEFAULT 0,
    total_staked_eth TEXT NOT NULL DEFAULT '0',
    average_fee_percent INTEGER NOT NULL DEFAULT 0,
    average_time_seconds INTEGER NOT NULL DEFAULT 0,
    success_rate INTEGER NOT NULL DEFAULT 0,
    last24h_volume TEXT NOT NULL DEFAULT '0',
    last24h_transactions TEXT NOT NULL DEFAULT '0'
  )`,

  // Compute Stats table
  `CREATE TABLE IF NOT EXISTS compute_stats (
    id TEXT PRIMARY KEY,
    date TEXT,
    total_providers INTEGER NOT NULL DEFAULT 0,
    active_providers INTEGER NOT NULL DEFAULT 0,
    total_resources INTEGER NOT NULL DEFAULT 0,
    available_resources INTEGER NOT NULL DEFAULT 0,
    total_rentals INTEGER NOT NULL DEFAULT 0,
    active_rentals INTEGER NOT NULL DEFAULT 0,
    completed_rentals INTEGER NOT NULL DEFAULT 0,
    total_inference_requests INTEGER NOT NULL DEFAULT 0,
    total_staked TEXT NOT NULL DEFAULT '0',
    total_earnings TEXT NOT NULL DEFAULT '0',
    last24h_rentals INTEGER NOT NULL DEFAULT 0,
    last24h_inference INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL
  )`,

  // Storage Market Stats table
  `CREATE TABLE IF NOT EXISTS storage_market_stats (
    id TEXT PRIMARY KEY,
    date TEXT,
    total_providers INTEGER NOT NULL DEFAULT 0,
    active_providers INTEGER NOT NULL DEFAULT 0,
    verified_providers INTEGER NOT NULL DEFAULT 0,
    total_capacity_tb TEXT NOT NULL DEFAULT '0',
    used_capacity_tb TEXT NOT NULL DEFAULT '0',
    total_deals INTEGER NOT NULL DEFAULT 0,
    active_deals INTEGER NOT NULL DEFAULT 0,
    completed_deals INTEGER NOT NULL DEFAULT 0,
    total_staked TEXT NOT NULL DEFAULT '0',
    total_earnings TEXT NOT NULL DEFAULT '0',
    avg_price_per_gb_month TEXT NOT NULL DEFAULT '0',
    last24h_deals INTEGER NOT NULL DEFAULT 0,
    last24h_volume TEXT NOT NULL DEFAULT '0',
    last_updated TEXT NOT NULL
  )`,

  // OIF Solver table
  `CREATE TABLE IF NOT EXISTS oif_solver (
    id TEXT PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    name TEXT,
    endpoint TEXT,
    staked_amount TEXT NOT NULL DEFAULT '0',
    unbonding_amount TEXT NOT NULL DEFAULT '0',
    unbonding_start_time TEXT,
    slashed_amount TEXT NOT NULL DEFAULT '0',
    is_active INTEGER NOT NULL DEFAULT 0,
    registered_at TEXT NOT NULL,
    last_active_at TEXT NOT NULL,
    supported_chains TEXT NOT NULL DEFAULT '[]',
    total_fills INTEGER NOT NULL DEFAULT 0,
    successful_fills INTEGER NOT NULL DEFAULT 0,
    failed_fills INTEGER NOT NULL DEFAULT 0,
    success_rate INTEGER NOT NULL DEFAULT 0,
    average_response_ms INTEGER NOT NULL DEFAULT 0,
    average_fill_time_ms INTEGER NOT NULL DEFAULT 0,
    total_volume_usd TEXT NOT NULL DEFAULT '0',
    total_fees_earned TEXT NOT NULL DEFAULT '0',
    reputation INTEGER NOT NULL DEFAULT 50
  )`,

  // OIF Solver Liquidity table
  `CREATE TABLE IF NOT EXISTS oif_solver_liquidity (
    id TEXT PRIMARY KEY,
    solver_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    amount TEXT NOT NULL DEFAULT '0',
    locked_amount TEXT NOT NULL DEFAULT '0',
    last_updated TEXT NOT NULL
  )`,

  // OIF Intent table
  `CREATE TABLE IF NOT EXISTS oif_intent (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL UNIQUE,
    nonce TEXT NOT NULL,
    source_chain_id INTEGER NOT NULL,
    open_deadline TEXT NOT NULL,
    fill_deadline TEXT NOT NULL,
    input_token TEXT NOT NULL,
    input_amount TEXT NOT NULL,
    output_token TEXT NOT NULL,
    output_amount TEXT NOT NULL,
    output_chain_id INTEGER NOT NULL,
    recipient TEXT NOT NULL,
    max_fee TEXT NOT NULL,
    actual_fee TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    claimed_at TEXT,
    filled_at TEXT,
    settled_at TEXT,
    expired_at TEXT,
    input_settler_tx TEXT NOT NULL,
    output_settler_tx TEXT,
    attestation_tx TEXT,
    claim_tx TEXT,
    created_block TEXT NOT NULL,
    filled_block TEXT,
    user_id TEXT,
    solver_id TEXT,
    settlement_id TEXT,
    accepted_quote_id TEXT
  )`,

  // OIF Settlement table
  `CREATE TABLE IF NOT EXISTS oif_settlement (
    id TEXT PRIMARY KEY,
    settlement_id TEXT NOT NULL UNIQUE,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER NOT NULL,
    input_token TEXT NOT NULL,
    output_token TEXT NOT NULL,
    input_amount TEXT NOT NULL,
    output_amount TEXT NOT NULL,
    fee TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attested_at TEXT,
    settled_at TEXT,
    input_settler_tx TEXT NOT NULL,
    output_settler_tx TEXT NOT NULL,
    attestation_tx TEXT,
    claim_tx TEXT,
    intent_id TEXT,
    solver_id TEXT,
    attestation_id TEXT
  )`,

  // OIF Quote table
  `CREATE TABLE IF NOT EXISTS oif_quote (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL UNIQUE,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER NOT NULL,
    source_token TEXT NOT NULL,
    destination_token TEXT NOT NULL,
    input_amount TEXT NOT NULL,
    output_amount TEXT NOT NULL,
    fee TEXT NOT NULL,
    fee_percent INTEGER NOT NULL,
    price_impact INTEGER NOT NULL,
    estimated_fill_time_seconds INTEGER NOT NULL,
    valid_until TEXT NOT NULL,
    solver_reputation INTEGER NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    expired INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    solver_id TEXT
  )`,

  // OIF Route table
  `CREATE TABLE IF NOT EXISTS oif_route (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL UNIQUE,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER NOT NULL,
    input_settler TEXT NOT NULL,
    output_settler TEXT NOT NULL,
    oracle TEXT NOT NULL,
    oracle_address TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    total_volume TEXT NOT NULL DEFAULT '0',
    total_volume_usd TEXT NOT NULL DEFAULT '0',
    total_intents INTEGER NOT NULL DEFAULT 0,
    successful_intents INTEGER NOT NULL DEFAULT 0,
    failed_intents INTEGER NOT NULL DEFAULT 0,
    average_fee_percent INTEGER NOT NULL DEFAULT 0,
    average_fill_time_seconds INTEGER NOT NULL DEFAULT 0,
    success_rate INTEGER NOT NULL DEFAULT 0,
    active_solvers INTEGER NOT NULL DEFAULT 0,
    total_liquidity TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL,
    last_updated TEXT NOT NULL
  )`,

  // OIF Attestation table
  `CREATE TABLE IF NOT EXISTS oif_attestation (
    id TEXT PRIMARY KEY,
    attestation_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    oracle_type TEXT NOT NULL,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER NOT NULL,
    proof TEXT NOT NULL,
    proof_block_number TEXT NOT NULL,
    proof_timestamp TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verified_at TEXT,
    verification_tx TEXT,
    intent_id TEXT,
    settlement_id TEXT
  )`,

  // OIF Slash Event table
  `CREATE TABLE IF NOT EXISTS oif_slash_event (
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    amount TEXT NOT NULL,
    victim TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    disputed INTEGER NOT NULL DEFAULT 0,
    tx_hash TEXT NOT NULL,
    solver_id TEXT
  )`,

  // OIF Stats table
  `CREATE TABLE IF NOT EXISTS oif_stats (
    id TEXT PRIMARY KEY,
    date TEXT,
    total_volume_usd TEXT NOT NULL DEFAULT '0',
    total_intents INTEGER NOT NULL DEFAULT 0,
    successful_intents INTEGER NOT NULL DEFAULT 0,
    failed_intents INTEGER NOT NULL DEFAULT 0,
    total_solvers INTEGER NOT NULL DEFAULT 0,
    active_solvers INTEGER NOT NULL DEFAULT 0,
    total_liquidity_usd TEXT NOT NULL DEFAULT '0',
    average_fee_percent INTEGER NOT NULL DEFAULT 0,
    average_fill_time_seconds INTEGER NOT NULL DEFAULT 0,
    success_rate INTEGER NOT NULL DEFAULT 0,
    last24h_volume TEXT NOT NULL DEFAULT '0',
    last24h_intents INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL
  )`,

  // OIF Chain Stats table
  `CREATE TABLE IF NOT EXISTS oif_chain_stats (
    id TEXT PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    date TEXT,
    total_volume_usd TEXT NOT NULL DEFAULT '0',
    total_intents INTEGER NOT NULL DEFAULT 0,
    successful_intents INTEGER NOT NULL DEFAULT 0,
    failed_intents INTEGER NOT NULL DEFAULT 0,
    total_solvers INTEGER NOT NULL DEFAULT 0,
    active_solvers INTEGER NOT NULL DEFAULT 0,
    total_liquidity_usd TEXT NOT NULL DEFAULT '0',
    average_fee_percent INTEGER NOT NULL DEFAULT 0,
    average_fill_time_seconds INTEGER NOT NULL DEFAULT 0,
    success_rate INTEGER NOT NULL DEFAULT 0,
    last24h_volume TEXT NOT NULL DEFAULT '0',
    last24h_intents INTEGER NOT NULL DEFAULT 0,
    last_updated TEXT NOT NULL
  )`,
]

// Indexes for performance
export const INDEX_DDL = [
  // Block indexes
  'CREATE INDEX IF NOT EXISTS idx_block_number ON block(number)',
  'CREATE INDEX IF NOT EXISTS idx_block_timestamp ON block(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_block_hash ON block(hash)',

  // Transaction indexes
  'CREATE INDEX IF NOT EXISTS idx_transaction_hash ON "transaction"(hash)',
  'CREATE INDEX IF NOT EXISTS idx_transaction_block_number ON "transaction"(block_number)',
  'CREATE INDEX IF NOT EXISTS idx_transaction_from ON "transaction"(from_id)',
  'CREATE INDEX IF NOT EXISTS idx_transaction_to ON "transaction"(to_id)',
  'CREATE INDEX IF NOT EXISTS idx_transaction_block ON "transaction"(block_id)',

  // Account indexes
  'CREATE INDEX IF NOT EXISTS idx_account_address ON account(address)',

  // Contract indexes
  'CREATE INDEX IF NOT EXISTS idx_contract_address ON contract(address)',
  'CREATE INDEX IF NOT EXISTS idx_contract_type ON contract(contract_type)',

  // Log indexes
  'CREATE INDEX IF NOT EXISTS idx_log_transaction ON log(transaction_id)',
  'CREATE INDEX IF NOT EXISTS idx_log_block ON log(block_id)',
  'CREATE INDEX IF NOT EXISTS idx_log_address ON log(address)',
  'CREATE INDEX IF NOT EXISTS idx_log_topic0 ON log(topic0)',

  // Token Transfer indexes
  'CREATE INDEX IF NOT EXISTS idx_token_transfer_block ON token_transfer(block_number)',
  'CREATE INDEX IF NOT EXISTS idx_token_transfer_from ON token_transfer(from_id)',
  'CREATE INDEX IF NOT EXISTS idx_token_transfer_to ON token_transfer(to_id)',
  'CREATE INDEX IF NOT EXISTS idx_token_transfer_token ON token_transfer(token_address)',

  // Token Balance indexes
  'CREATE INDEX IF NOT EXISTS idx_token_balance_account ON token_balance(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_token_balance_token ON token_balance(token_address)',

  // Registered Agent indexes
  'CREATE INDEX IF NOT EXISTS idx_registered_agent_agent_id ON registered_agent(agent_id)',
  'CREATE INDEX IF NOT EXISTS idx_registered_agent_active ON registered_agent(active)',
  'CREATE INDEX IF NOT EXISTS idx_registered_agent_owner ON registered_agent(owner_id)',

  // Node Stake indexes
  'CREATE INDEX IF NOT EXISTS idx_node_stake_address ON node_stake(node_address)',
  'CREATE INDEX IF NOT EXISTS idx_node_stake_active ON node_stake(is_active)',

  // Provider indexes
  'CREATE INDEX IF NOT EXISTS idx_compute_provider_active ON compute_provider(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_storage_provider_active ON storage_provider(is_active)',

  // Oracle indexes
  'CREATE INDEX IF NOT EXISTS idx_oracle_feed_active ON oracle_feed(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_oracle_operator_active ON oracle_operator(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_oracle_report_feed ON oracle_report(feed_id)',
  'CREATE INDEX IF NOT EXISTS idx_oracle_dispute_status ON oracle_dispute(status)',

  // XLP indexes
  'CREATE INDEX IF NOT EXISTS idx_xlp_address ON xlp(address)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_active ON xlp(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_registered_at ON xlp(registered_at)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_reputation ON xlp(reputation)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_liquidity_deposit_xlp ON xlp_liquidity_deposit(xlp_id)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_liquidity_deposit_token ON xlp_liquidity_deposit(token)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_liquidity_deposit_chain ON xlp_liquidity_deposit(chain_id)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_slash_event_xlp ON xlp_slash_event(xlp_id)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_slash_event_voucher ON xlp_slash_event(voucher_id)',
  'CREATE INDEX IF NOT EXISTS idx_xlp_slash_event_timestamp ON xlp_slash_event(timestamp)',

  // Cross Chain Voucher indexes
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_request_request_id ON cross_chain_voucher_request(request_id)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_request_requester ON cross_chain_voucher_request(requester_id)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_request_source_chain ON cross_chain_voucher_request(source_chain)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_request_dest_chain ON cross_chain_voucher_request(destination_chain)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_request_status ON cross_chain_voucher_request(status)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_voucher_id ON cross_chain_voucher(voucher_id)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_request_id ON cross_chain_voucher(request_id)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_xlp ON cross_chain_voucher(xlp_id)',
  'CREATE INDEX IF NOT EXISTS idx_cross_chain_voucher_status ON cross_chain_voucher(status)',

  // EIL Transfer indexes
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_user ON eil_transfer(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_source_chain ON eil_transfer(source_chain)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_dest_chain ON eil_transfer(destination_chain)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_xlp ON eil_transfer(xlp_id)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_request_id ON eil_transfer(request_id)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_voucher_id ON eil_transfer(voucher_id)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_status ON eil_transfer(status)',
  'CREATE INDEX IF NOT EXISTS idx_eil_transfer_initiated_at ON eil_transfer(initiated_at)',

  // EIL Stats indexes
  'CREATE INDEX IF NOT EXISTS idx_eil_stats_date ON eil_stats(date)',

  // Compute Stats indexes
  'CREATE INDEX IF NOT EXISTS idx_compute_stats_date ON compute_stats(date)',

  // Storage Market Stats indexes
  'CREATE INDEX IF NOT EXISTS idx_storage_market_stats_date ON storage_market_stats(date)',

  // Compute Resource indexes
  'CREATE INDEX IF NOT EXISTS idx_compute_resource_provider ON compute_resource(provider_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_resource_resource_id ON compute_resource(resource_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_resource_available ON compute_resource(is_available)',
  'CREATE INDEX IF NOT EXISTS idx_compute_resource_created ON compute_resource(created_at)',

  // Compute Rental indexes
  'CREATE INDEX IF NOT EXISTS idx_compute_rental_rental_id ON compute_rental(rental_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_rental_renter ON compute_rental(renter_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_rental_provider ON compute_rental(provider_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_rental_resource ON compute_rental(resource_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_rental_status ON compute_rental(status)',
  'CREATE INDEX IF NOT EXISTS idx_compute_rental_created ON compute_rental(created_at)',

  // Compute Ledger Balance indexes
  'CREATE INDEX IF NOT EXISTS idx_compute_ledger_balance_account ON compute_ledger_balance(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_compute_ledger_balance_token ON compute_ledger_balance(token)',

  // Storage Ledger Balance indexes
  'CREATE INDEX IF NOT EXISTS idx_storage_ledger_balance_user ON storage_ledger_balance(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_storage_ledger_balance_provider ON storage_ledger_balance(provider_id)',
  'CREATE INDEX IF NOT EXISTS idx_storage_ledger_balance_updated ON storage_ledger_balance(last_updated)',

  // Inference Request indexes
  'CREATE INDEX IF NOT EXISTS idx_inference_request_request_id ON inference_request(request_id)',
  'CREATE INDEX IF NOT EXISTS idx_inference_request_requester ON inference_request(requester_id)',
  'CREATE INDEX IF NOT EXISTS idx_inference_request_provider ON inference_request(provider_id)',
  'CREATE INDEX IF NOT EXISTS idx_inference_request_model ON inference_request(model)',
  'CREATE INDEX IF NOT EXISTS idx_inference_request_status ON inference_request(status)',
  'CREATE INDEX IF NOT EXISTS idx_inference_request_created ON inference_request(created_at)',

  // OIF Solver indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_address ON oif_solver(address)',
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_active ON oif_solver(is_active)',
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_registered ON oif_solver(registered_at)',
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_reputation ON oif_solver(reputation)',

  // OIF Solver Liquidity indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_liquidity_solver ON oif_solver_liquidity(solver_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_liquidity_chain ON oif_solver_liquidity(chain_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_solver_liquidity_token ON oif_solver_liquidity(token)',

  // OIF Intent indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_intent_intent ON oif_intent(intent_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_intent_user ON oif_intent(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_intent_source_chain ON oif_intent(source_chain_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_intent_status ON oif_intent(status)',
  'CREATE INDEX IF NOT EXISTS idx_oif_intent_solver ON oif_intent(solver_id)',

  // OIF Settlement indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_settlement_settlement ON oif_settlement(settlement_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_settlement_intent ON oif_settlement(intent_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_settlement_solver ON oif_settlement(solver_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_settlement_status ON oif_settlement(status)',

  // OIF Quote indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_quote_quote ON oif_quote(quote_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_quote_solver ON oif_quote(solver_id)',

  // OIF Route indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_route_route ON oif_route(route_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_route_source ON oif_route(source_chain_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_route_dest ON oif_route(destination_chain_id)',

  // OIF Attestation indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_attestation_attestation ON oif_attestation(attestation_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_attestation_intent ON oif_attestation(intent_id)',

  // OIF Slash Event indexes
  'CREATE INDEX IF NOT EXISTS idx_oif_slash_event_solver ON oif_slash_event(solver_id)',
  'CREATE INDEX IF NOT EXISTS idx_oif_slash_event_intent ON oif_slash_event(intent_id)',
]

// Table name to snake_case mapping for TypeORM entity compatibility
export const TABLE_NAMES = {
  Block: 'block',
  Transaction: 'transaction',
  Account: 'account',
  Contract: 'contract',
  Log: 'log',
  DecodedEvent: 'decoded_event',
  Trace: 'trace',
  TokenTransfer: 'token_transfer',
  TokenBalance: 'token_balance',
  Token: 'token',
  TokenApprovalEvent: 'token_approval_event',
  NftApprovalEvent: 'nft_approval_event',
  RegisteredAgent: 'registered_agent',
  TagIndex: 'tag_index',
  NodeStake: 'node_stake',
  ComputeProvider: 'compute_provider',
  StorageProvider: 'storage_provider',
  ComputeRental: 'compute_rental',
  StorageDeal: 'storage_deal',
  ContainerImage: 'container_image',
  CrossServiceRequest: 'cross_service_request',
  OracleFeed: 'oracle_feed',
  OracleOperator: 'oracle_operator',
  OracleReport: 'oracle_report',
  OracleDispute: 'oracle_dispute',
  OracleSubscription: 'oracle_subscription',
  JnsName: 'jns_name',
  MarketplaceStats: 'marketplace_stats',
  XLP: 'xlp',
  XLPLiquidityDeposit: 'xlp_liquidity_deposit',
  XLPSlashEvent: 'xlp_slash_event',
  CrossChainVoucherRequest: 'cross_chain_voucher_request',
  CrossChainVoucher: 'cross_chain_voucher',
  EILTransfer: 'eil_transfer',
  EILStats: 'eil_stats',
  ComputeStats: 'compute_stats',
  StorageMarketStats: 'storage_market_stats',
  ComputeResource: 'compute_resource',
  ComputeLedgerBalance: 'compute_ledger_balance',
  StorageLedgerBalance: 'storage_ledger_balance',
  InferenceRequest: 'inference_request',
  OIFSolver: 'oif_solver',
  OIFSolverLiquidity: 'oif_solver_liquidity',
  OIFIntent: 'oif_intent',
  OIFSettlement: 'oif_settlement',
  OIFQuote: 'oif_quote',
  OIFRoute: 'oif_route',
  OIFAttestation: 'oif_attestation',
  OIFSlashEvent: 'oif_slash_event',
  OIFStats: 'oif_stats',
  OIFChainStats: 'oif_chain_stats',
} as const

export type TableName = (typeof TABLE_NAMES)[keyof typeof TABLE_NAMES]
