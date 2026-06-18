# Pharos WebMCP Trust Router

`pharos-webmcp-trust-router` is a reusable Agent Skill for safe interaction with WebMCP-enabled websites. It helps agents discover WebMCP tools in a visible browser page, fingerprint the tool surface, classify risk, validate inputs, require user confirmation for risky actions, execute through a browser-side bridge, produce auditable receipts, and optionally anchor receipt hashes on Pharos.

The skill is Pharos-aligned but does not require the Pharos Skill Engine for normal WebMCP routing. Optional receipt anchoring uses Pharos command-style `cast send` flows when a user explicitly approves an on-chain write.

## Package

```text
pharos-webmcp-trust-router/
├── SKILL.md
├── README.md
├── .env.example
├── references/
│   ├── webmcp-discovery.md
│   ├── risk-policy.md
│   └── pharos-receipts.md
├── assets/
│   ├── webmcp-trust-router.js
│   ├── pharos-anchor-receipt.sh
│   ├── receipt-schema.json
│   └── risk-policy.json
```

## Install

Install by copying this folder into an agent skill directory:

```bash
git clone <your-repo-url>
cp -R pharos-webmcp-trust-router ~/.codex/skills/
```

Then invoke it from an agent prompt:

```text
Use $pharos-webmcp-trust-router to inspect WebMCP tools on the current browser page, classify risk, validate arguments, execute only approved tools, and produce an auditable receipt.
```

## Agent Usage

An agent should:

- Load `SKILL.md`.
- Use `assets/webmcp-trust-router.js` inside the visible browser page or browser automation context.
- Call `document.modelContext.getTools()` through the bridge.
- Fingerprint tool surfaces and classify risk before proposing arguments.
- Re-discover and compare fingerprints immediately before execution.
- Ask the user before risky actions.
- Execute through `document.modelContext.executeTool()`.
- Validate and store the receipt.

## WebMCP Reference

For browser API background and current Chrome guidance, see [WebMCP | AI on Chrome | Chrome for Developers](https://developer.chrome.com/docs/ai/webmcp).

## Optional Pharos Anchoring

To anchor a receipt hash on Pharos Atlantic:

```bash
cp -n .env.example .env
# edit .env and set PRIVATE_KEY to a funded Pharos wallet
./assets/pharos-anchor-receipt.sh 0xRECEIPT_HASH
```
