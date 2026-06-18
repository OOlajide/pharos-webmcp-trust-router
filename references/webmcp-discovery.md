# WebMCP Discovery and Execution

Read this file before an agent inspects or executes tools on a WebMCP-enabled page.

## Browser Boundary

WebMCP tools live inside a visible browser document. The trusted execution path is:

1. Enter the browser page context.
2. Call `document.modelContext.getTools()` from that page context.
3. Normalize returned tools into stable records.
4. Fingerprint each tool surface.
5. Re-check the fingerprint immediately before execution.
6. Execute through `document.modelContext.executeTool()`.

Do not call `document.modelContext` directly from Node.js. If using Playwright or a browser extension, evaluate the bridge inside the page:

```js
await page.addScriptTag({ path: "/absolute/path/to/assets/webmcp-trust-router.js" });
const tools = await page.evaluate(() => window.WebMCPTrustRouter.discover());
```

If native WebMCP is unavailable, use mock mode for local tests and fallback environments:

```js
const tools = await window.WebMCPTrustRouter.discover({
  mockTools: [
    {
      origin: location.origin,
      name: "get_account_summary",
      description: "Reads account summary information without changing state.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true }
    }
  ]
});
```

## Tool Records

Normalize every discovered tool to:

```json
{
  "origin": "https://example.com",
  "name": "tool_name",
  "title": "Optional display title",
  "description": "Natural language tool description",
  "inputSchema": {},
  "annotations": {
    "readOnlyHint": false,
    "untrustedContentHint": false
  },
  "schemaHash": "0x...",
  "fingerprint": "0x...",
  "riskLevel": "state-change",
  "requiresConfirmation": true
}
```

Treat missing `origin` as the visible page origin. Treat missing `inputSchema` as an empty object schema. Treat missing annotations as untrusted hints, not proof of safety.

## Fingerprinting

Fingerprint the tool surface by canonicalizing and hashing:

- `origin`
- `name`
- `description`
- `inputSchema`
- `annotations`

Use SHA-256 over canonical JSON with sorted object keys. Compute a separate `schemaHash` over only `inputSchema`.

Approved execution must bind to the fingerprint. Re-discover and re-hash immediately before execution. If the current fingerprint differs from the approved fingerprint, block execution and write a blocked receipt.

## Argument Validation

Validate proposed arguments against the current `inputSchema` before execution. If the browser or page has native validation, still validate in the trust router so the agent can block before sending sensitive data to the page.

Use `references/risk-policy.md#argument-validation` for validation behavior.

## Execution

After fingerprint, schema validation, risk classification, and confirmation checks:

```js
const result = await window.WebMCPTrustRouter.executeApprovedTool({
  toolName: "create_support_ticket",
  args: {
    subject: "Account access issue",
    priority: "normal"
  },
  approvedTool,
  confirmation: {
    status: "approved",
    prompt: "Create a support ticket with subject 'Account access issue'?",
    confirmedBy: "user"
  }
});
```

The bridge calls `document.modelContext.executeTool()` from the page context. Because the WebMCP discovery/execution shape is still evolving, the bridge tries common call signatures:

- `executeTool(toolName, args)`
- `executeTool({ name: toolName, arguments: args })`
- `executeTool({ name: toolName, input: args })`

If none works, it blocks and returns a receipt with `executionStatus: "blocked"`.

## Tool-Change Handling

When a page fires `toolchange`, mark the previous discovery snapshot as stale. A user approval attached to an old fingerprint must not authorize the changed tool. Re-run discovery, compare hashes, and ask again only if the changed tool is still safe enough to propose.
