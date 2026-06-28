export { McpManager, toolName, type McpManagerDeps } from "./manager.js";
export { McpClient, type McpCallResult } from "./client.js";
export { StdioTransport, buildChildEnv, type Transport } from "./transport.js";
export type {
  McpServerConfig,
  McpToolDescriptor,
  PreparedMcpTool,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "./types.js";
