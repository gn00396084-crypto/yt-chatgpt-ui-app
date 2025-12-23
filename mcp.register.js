import { registerResources } from "./mcp.resources.js";
import { registerTools } from "./mcp.tools.js";

export function registerAll(mcp, env) {
  registerResources(mcp);
  registerTools(mcp, env);
}
