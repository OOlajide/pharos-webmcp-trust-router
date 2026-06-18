(function installWebMCPTrustRouter(global) {
  "use strict";

  const SKILL_NAME = "pharos-webmcp-trust-router";
  const RECEIPT_VERSION = "1.0.0";
  const RISK_LEVELS = [
    "destructive",
    "payment",
    "identity",
    "cross-origin",
    "unknown",
    "state-change",
    "navigation",
    "form-fill",
    "read-only"
  ];
  const CONFIRMATION_REQUIRED = {
    "read-only": false,
    "form-fill": false,
    "navigation": true,
    "state-change": true,
    "payment": true,
    "identity": true,
    "destructive": true,
    "cross-origin": true,
    "unknown": true
  };

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
  }

  function canonicalize(value) {
    if (value === undefined || typeof value === "function") {
      return null;
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(canonicalize);
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalize(value[key]);
    }
    return output;
  }

  function canonicalJSONString(value) {
    return JSON.stringify(canonicalize(value));
  }

  async function sha256Hex(value) {
    const text = typeof value === "string" ? value : canonicalJSONString(value);
    const bytes = new TextEncoder().encode(text);
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return "0x" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function parseSchema(schema) {
    if (!schema) {
      return { type: "object", properties: {}, additionalProperties: false };
    }
    if (typeof schema === "string") {
      try {
        return JSON.parse(schema);
      } catch (error) {
        return { type: "object", properties: {}, additionalProperties: true, __parseError: String(error.message || error) };
      }
    }
    return schema;
  }

  function normalizeAnnotations(tool) {
    const annotations = isPlainObject(tool.annotations) ? tool.annotations : {};
    return {
      readOnlyHint: Boolean(annotations.readOnlyHint || tool.readOnlyHint),
      untrustedContentHint: Boolean(annotations.untrustedContentHint || tool.untrustedContentHint)
    };
  }

  function flattenToolResponse(value, inheritedOrigin) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap(item => flattenToolResponse(item, inheritedOrigin));
    }
    if (value instanceof Map) {
      return Array.from(value.entries()).map(([name, tool]) => ({ name, ...tool, origin: tool.origin || inheritedOrigin }));
    }
    if (value.tools) {
      return flattenToolResponse(value.tools, value.origin || inheritedOrigin);
    }
    if (value.toolMap) {
      return flattenToolResponse(value.toolMap, value.origin || inheritedOrigin);
    }
    if (isPlainObject(value) && (value.name || value.description || value.inputSchema || value.schema)) {
      return [{ ...value, origin: value.origin || inheritedOrigin }];
    }
    if (isPlainObject(value)) {
      return Object.entries(value).flatMap(([name, tool]) => {
        if (isPlainObject(tool)) {
          return [{ name: tool.name || name, ...tool, origin: tool.origin || inheritedOrigin }];
        }
        return [];
      });
    }
    return [];
  }

  async function normalizeTool(raw, fallbackOrigin) {
    const inputSchema = parseSchema(raw.inputSchema || raw.input_schema || raw.schema);
    const annotations = normalizeAnnotations(raw);
    const normalized = {
      origin: raw.origin || fallbackOrigin,
      name: raw.name,
      title: raw.title || "",
      description: raw.description || "",
      inputSchema,
      annotations
    };
    const schemaHash = await sha256Hex(inputSchema);
    const fingerprint = await sha256Hex({
      origin: normalized.origin,
      name: normalized.name,
      description: normalized.description,
      inputSchema: normalized.inputSchema,
      annotations: normalized.annotations
    });
    const riskLevel = classifyRisk(normalized);
    return {
      ...normalized,
      schemaHash,
      fingerprint,
      riskLevel,
      requiresConfirmation: requiresConfirmation(riskLevel)
    };
  }

  function textForRisk(tool) {
    return canonicalJSONString({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations
    }).toLowerCase();
  }

  function hasAny(text, words) {
    return words.some(word => text.includes(word));
  }

  function classifyRisk(tool, pageOrigin) {
    const visibleOrigin = pageOrigin || (global.location && global.location.origin) || "";
    const text = textForRisk(tool);
    const readOnlySafe = tool.annotations && tool.annotations.readOnlyHint &&
      hasAny(text, ["list", "get", "read", "show", "fetch", "retrieve", "download"]) &&
      !hasAny(text, ["pay", "payment", "checkout", "purchase", "charge", "wallet", "transfer", "submit", "delete", "cancel", "void", "revoke", "password", "kyc"]);

    if (tool.origin && visibleOrigin && tool.origin !== visibleOrigin) {
      return "cross-origin";
    }
    if (readOnlySafe) {
      return "read-only";
    }
    if (hasAny(text, ["delete", "remove", "cancel", "void", "wipe", "erase", "close account", "revoke", "burn", "refund"])) {
      return "destructive";
    }
    if (hasAny(text, ["pay", "payment", "checkout", "purchase", "charge", "wallet", "transfer", "subscribe", "billing"])) {
      return "payment";
    }
    if (hasAny(text, ["identity", "profile", "account", "login", "logout", "password", "email", "phone", "address", "kyc", "session", "permission"])) {
      return "identity";
    }
    if (hasAny(text, ["create", "update", "submit", "send", "post", "reserve", "stage", "prepare", "request", "ticket", "anchor", "on-chain", "cast"])) {
      return "state-change";
    }
    if (hasAny(text, ["navigate", "redirect", "open", "download", "link", "url", "route"])) {
      return tool.annotations && tool.annotations.readOnlyHint ? "read-only" : "navigation";
    }
    if (hasAny(text, ["fill", "draft", "compose", "edit field", "populate", "form"])) {
      return "form-fill";
    }
    if (tool.annotations && tool.annotations.readOnlyHint) {
      return "read-only";
    }
    return "unknown";
  }

  function requiresConfirmation(riskLevel, options) {
    if (options && options.fingerprintChanged) {
      return true;
    }
    return CONFIRMATION_REQUIRED[riskLevel] !== false;
  }

  function normalizeType(type) {
    return Array.isArray(type) ? type : [type];
  }

  function typeMatches(value, type) {
    if (type === "integer") {
      return Number.isInteger(value);
    }
    if (type === "number") {
      return typeof value === "number" && Number.isFinite(value);
    }
    if (type === "array") {
      return Array.isArray(value);
    }
    if (type === "object") {
      return isPlainObject(value);
    }
    if (type === "null") {
      return value === null;
    }
    return typeof value === type;
  }

  function validateSchema(value, schema, path, errors) {
    if (!schema || schema.__parseError) {
      errors.push(`${path}: invalid or unparsable schema`);
      return errors;
    }
    if (schema.const !== undefined && canonicalJSONString(value) !== canonicalJSONString(schema.const)) {
      errors.push(`${path}: must equal const value`);
    }
    if (schema.enum && !schema.enum.some(item => canonicalJSONString(item) === canonicalJSONString(value))) {
      errors.push(`${path}: must be one of the allowed enum values`);
    }
    if (schema.type && !normalizeType(schema.type).some(type => typeMatches(value, type))) {
      errors.push(`${path}: expected type ${normalizeType(schema.type).join(" or ")}`);
      return errors;
    }
    if (schema.type === "object" || schema.properties || schema.required) {
      if (!isPlainObject(value)) {
        errors.push(`${path}: expected object`);
        return errors;
      }
      for (const requiredKey of schema.required || []) {
        if (!(requiredKey in value)) {
          errors.push(`${path}.${requiredKey}: required property missing`);
        }
      }
      const properties = schema.properties || {};
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            errors.push(`${path}.${key}: additional property not allowed`);
          }
        }
      }
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in value) {
          validateSchema(value[key], childSchema, `${path}.${key}`, errors);
        }
      }
    }
    if (schema.type === "array" || schema.items) {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return errors;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: expected at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: expected at most ${schema.maxItems} items`);
      }
      if (schema.items) {
        value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`, errors));
      }
    }
    if (typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path}: must be greater than ${schema.exclusiveMinimum}`);
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${path}: must be less than ${schema.exclusiveMaximum}`);
    }
    if (typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than minLength ${schema.minLength}`);
      if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
      if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path}: does not match pattern`);
    }
    return errors;
  }

  function validateArguments(args, schema) {
    return validateSchema(args || {}, schema || { type: "object" }, "$", []);
  }

  function detectBridgeMode(mockTools) {
    if (mockTools) return "mock";
    if (!global.document || !global.document.modelContext) return "unavailable";
    if (global.document.modelContext.__webmcpPolyfill) return "polyfill";
    return "native-webmcp";
  }

  async function discover(options) {
    const settings = options || {};
    const fallbackOrigin = settings.origin || (global.location && global.location.origin) || "unknown-origin";
    let rawTools = settings.mockTools || [];
    if (!settings.mockTools) {
      const modelContext = global.document && global.document.modelContext;
      if (!modelContext || typeof modelContext.getTools !== "function") {
        return {
          bridgeMode: "unavailable",
          tools: []
        };
      }
      rawTools = await modelContext.getTools();
    }
    const flattened = flattenToolResponse(rawTools, fallbackOrigin).filter(tool => tool && tool.name);
    const tools = [];
    for (const tool of flattened) {
      tools.push(await normalizeTool(tool, fallbackOrigin));
    }
    return {
      bridgeMode: detectBridgeMode(settings.mockTools),
      tools
    };
  }

  async function callExecuteTool(toolName, args) {
    const modelContext = global.document && global.document.modelContext;
    if (!modelContext || typeof modelContext.executeTool !== "function") {
      throw new Error("document.modelContext.executeTool() is unavailable");
    }
    const attempts = [
      () => modelContext.executeTool(toolName, args),
      () => modelContext.executeTool({ name: toolName, arguments: args }),
      () => modelContext.executeTool({ name: toolName, input: args })
    ];
    let lastError;
    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  function actionId(toolName) {
    return `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  async function makeReceipt(details) {
    const outputObject = details.output === undefined ? null : details.output;
    const confirmation = details.confirmation || {};
    const schemaHash = details.schemaHash || await sha256Hex(details.inputSchema || {});
    const receipt = {
      receiptVersion: RECEIPT_VERSION,
      skill: SKILL_NAME,
      actionId: details.actionId || actionId(details.toolName || "tool"),
      timestamp: details.timestamp || new Date().toISOString(),
      origin: details.origin || "unknown-origin",
      pageUrl: global.location ? global.location.href : "",
      toolName: details.toolName || "unknown-tool",
      toolFingerprint: details.toolFingerprint,
      schemaHash,
      inputHash: await sha256Hex(details.input || {}),
      outputHash: await sha256Hex(outputObject),
      riskLevel: details.riskLevel || "unknown",
      confirmation: {
        required: Boolean(details.confirmationRequired),
        status: confirmation.status || (details.confirmationRequired ? "missing" : "not_required"),
        prompt: confirmation.prompt || "",
        confirmedBy: confirmation.confirmedBy || "",
        timestamp: confirmation.timestamp || new Date().toISOString()
      },
      executionStatus: details.executionStatus,
      bridgeMode: details.bridgeMode || detectBridgeMode()
    };
    if (details.blockedReason) receipt.blockedReason = details.blockedReason;
    if (details.validationErrors && details.validationErrors.length) receipt.validationErrors = details.validationErrors;
    if (details.pharosTransactionHash) receipt.pharosTransactionHash = details.pharosTransactionHash;
    receipt.receiptHash = await sha256Hex(receipt);
    return receipt;
  }

  async function blockedResult(tool, args, reason, extra) {
    const details = extra || {};
    const receipt = await makeReceipt({
      origin: tool && tool.origin,
      toolName: tool && tool.name,
      toolFingerprint: tool && tool.fingerprint,
      schemaHash: tool && tool.schemaHash,
      input: args,
      output: { blocked: true, reason },
      riskLevel: (tool && tool.riskLevel) || "unknown",
      confirmationRequired: details.confirmationRequired,
      confirmation: details.confirmation,
      executionStatus: "blocked",
      blockedReason: reason,
      validationErrors: details.validationErrors,
      bridgeMode: details.bridgeMode
    });
    return { ok: false, blocked: true, reason, receipt };
  }

  async function executeApprovedTool(request) {
    const approvedTool = request.approvedTool || {};
    const toolName = request.toolName || approvedTool.name;
    const args = request.args || {};
    const expectedFingerprint = request.expectedFingerprint || approvedTool.fingerprint;
    const snapshot = await discover(request.discoverOptions);
    const currentTool = snapshot.tools.find(tool => tool.name === toolName);
    if (!currentTool) {
      return blockedResult({ name: toolName, riskLevel: "unknown" }, args, "Tool is not available in the current browser document.", {
        bridgeMode: snapshot.bridgeMode,
        confirmation: request.confirmation,
        confirmationRequired: true
      });
    }
    if (expectedFingerprint && currentTool.fingerprint !== expectedFingerprint) {
      return blockedResult(currentTool, args, "Tool fingerprint changed after discovery or approval.", {
        bridgeMode: snapshot.bridgeMode,
        confirmation: request.confirmation,
        confirmationRequired: true
      });
    }
    const validationErrors = validateArguments(args, currentTool.inputSchema);
    if (validationErrors.length) {
      return blockedResult(currentTool, args, "Arguments failed input schema validation.", {
        bridgeMode: snapshot.bridgeMode,
        confirmation: request.confirmation,
        confirmationRequired: true,
        validationErrors
      });
    }
    const riskLevel = classifyRisk(currentTool);
    const confirmationRequired = requiresConfirmation(riskLevel);
    const confirmation = request.confirmation || {};
    if (confirmationRequired && confirmation.status !== "approved") {
      return blockedResult(currentTool, args, "User confirmation is required before execution.", {
        bridgeMode: snapshot.bridgeMode,
        confirmation,
        confirmationRequired
      });
    }
    try {
      const output = await callExecuteTool(toolName, args);
      const receipt = await makeReceipt({
        origin: currentTool.origin,
        toolName,
        toolFingerprint: currentTool.fingerprint,
        schemaHash: currentTool.schemaHash,
        input: args,
        output,
        riskLevel,
        confirmationRequired,
        confirmation: confirmationRequired ? confirmation : { status: "not_required", ...confirmation },
        executionStatus: "completed",
        bridgeMode: snapshot.bridgeMode,
        pharosTransactionHash: request.pharosTransactionHash || (output && output.pharosTransactionHash)
      });
      return { ok: true, output, receipt };
    } catch (error) {
      const output = { error: String(error && error.message ? error.message : error) };
      const receipt = await makeReceipt({
        origin: currentTool.origin,
        toolName,
        toolFingerprint: currentTool.fingerprint,
        schemaHash: currentTool.schemaHash,
        input: args,
        output,
        riskLevel,
        confirmationRequired,
        confirmation,
        executionStatus: "failed",
        bridgeMode: snapshot.bridgeMode
      });
      return { ok: false, error: output.error, receipt };
    }
  }

  global.WebMCPTrustRouter = {
    canonicalize,
    canonicalJSONString,
    sha256Hex,
    discover,
    classifyRisk,
    requiresConfirmation,
    validateArguments,
    executeApprovedTool,
    makeReceipt
  };
})(typeof window !== "undefined" ? window : globalThis);
