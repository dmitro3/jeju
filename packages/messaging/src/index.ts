/**
 * @jejunetwork/messaging
 * 
 * Decentralized private messaging protocol for Network L2
 * 
 * Features:
 * - End-to-end encryption (X25519 + AES-256-GCM)
 * - Decentralized relay network with economic incentives
 * - On-chain key registry for public keys
 * - IPFS storage for message persistence
 * - x402 micropayments for message delivery
 * 
 * @example
 * ```typescript
 * import { createMessagingClient } from '@jejunetwork/messaging';
 * 
 * const client = createMessagingClient({
 *   rpcUrl: 'http://localhost:9545',
 *   address: '0x...',
 *   relayUrl: 'http://localhost:3200',
 * });
 * 
 * // Initialize with wallet signature
 * const signature = await wallet.signMessage(client.getKeyDerivationMessage());
 * await client.initialize(signature);
 * 
 * // Send encrypted message
 * await client.sendMessage({
 *   to: '0xRecipient...',
 *   content: 'Hello, private world!',
 * });
 * 
 * // Listen for incoming messages
 * client.onMessage((event) => {
 *   if (event.type === 'message:new') {
 *     console.log('New message:', event.data.content);
 *   }
 * });
 * ```
 * 
 * For relay node functionality, import from '@jejunetwork/messaging/node' (Node.js only)
 */

// Re-export SDK (browser-compatible)
export * from './sdk';

// XMTP types (excluding RelayNode which conflicts with SDK)
export type {
  XMTPIdentity,
  XMTPKeyBundle,
  XMTPEnvelope,
  XMTPMessage,
  ContentType,
  XMTPConversation,
  ConversationContext,
  XMTPGroup,
  GroupMemberUpdate,
  ConsentState,
  ConsentEntry,
  XMTPNodeConfig,
  XMTPNodeStats,
  RouteConfig,
  RouteResult,
  SyncState,
  SyncOptions,
} from './xmtp/types';

// XMTP node and router (excluding RelayNode)
export {
  type NodeConnectionState,
  type MessageHandler,
  JejuXMTPNode,
  createXMTPNode,
} from './xmtp/node';

export {
  type RouterStats,
  XMTPMessageRouter,
  createRouter,
} from './xmtp/router';

export {
  type SyncEvent,
  type SyncPeer,
  type SyncServiceConfig,
  XMTPSyncService,
  createSyncService,
} from './xmtp/sync';

// Re-export RelayNode from xmtp as XMTPRelayNode to avoid conflict
export { type RelayNode as XMTPRelayNode } from './xmtp/router';

// MLS (Message Layer Security) for group messaging
// Exclude MessageEvent which conflicts with sdk/types
export {
  MLSMessageSchema,
  type MLSMessage,
  GroupInviteSchema,
  type GroupInvite,
  GroupMetadataSchema,
  type GroupMetadata,
  type MLSClientConfig,
  type MLSClientState,
  type GroupConfig,
  type GroupMember,
  type GroupState,
  type SendOptions,
  type FetchOptions,
  type TextContent,
  type ImageContent,
  type FileContent,
  type ReactionContent,
  type ReplyContent,
  type TransactionContent,
  type AgentActionContent,
  type MessageContent,
  type MLSEvent,
  type MemberEvent,
  type GroupEvent,
  type MLSEventData,
  // Export MessageEvent from MLS as MLSMessageEvent
  type MessageEvent as MLSMessageEvent,
  type MLSClientEvents,
  JejuMLSClient,
  createMLSClient,
  type JejuGroupConfig,
  JejuGroup,
  ContentTypeIds,
  text,
  image,
  file,
  reaction,
  reply,
  transaction,
  agentAction,
  serializeContent,
  deserializeContent,
  getContentTypeId,
  validateImage,
  validateFile,
  validateTransaction,
  getContentPreview,
  isRichContent,
} from './mls';

// TEE-backed key management
export * from './tee';

// Node-only exports (relay server) available via '@jejunetwork/messaging/node'

