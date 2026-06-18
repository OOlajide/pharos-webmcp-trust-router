# Pharos Receipts

Create an auditable receipt after every WebMCP execution attempt, including blocked attempts.

## Receipt Fields

Receipts must include:

- `origin`: tool origin.
- `toolName`: WebMCP tool name.
- `schemaHash`: SHA-256 hash of canonicalized input schema.
- `inputHash`: SHA-256 hash of canonicalized approved arguments.
- `outputHash`: SHA-256 hash of canonicalized output or blocked error object.
- `riskLevel`: primary risk category.
- `confirmation.status`: `not_required`, `requested`, `approved`, `denied`, or `missing`.
- `timestamp`: ISO-8601 timestamp.
- Optional `pharosTransactionHash` after on-chain anchoring.

Use `assets/receipt-schema.json` as the validation contract.

## Receipt Hash

To anchor or compare a receipt, canonicalize the complete receipt JSON with sorted object keys, excluding `receiptHash` itself, then compute SHA-256. Store the final value as `receiptHash`.

Do not include private keys, session cookies, access tokens, raw payment credentials, or full personal data in receipts. Hash sensitive inputs and include only the minimum human-readable fields needed for auditability.

## Confirmation Status

Use these statuses:

| Status | Meaning |
|--------|---------|
| `not_required` | Policy did not require user confirmation. |
| `requested` | Confirmation was requested but not yet answered. |
| `approved` | User approved the exact action and arguments. |
| `denied` | User declined. |
| `missing` | Confirmation was required but absent. |

Blocked executions should still include the proposed `inputHash` and a hashed blocked output object.

## Optional Pharos Anchoring

Pharos anchoring is optional for WebMCP routing. Do not make the Pharos Skill Engine a dependency for normal discovery, risk classification, or tool execution.

Only anchor after the user explicitly approves an on-chain write. Then follow the Pharos-style pre-checks:

```bash
which cast
cp -n .env.example .env
# edit .env with PRIVATE_KEY for a funded Pharos Atlantic wallet
./assets/pharos-anchor-receipt.sh "$RECEIPT_HASH"
```

The helper loads `.env`, derives the signer, checks chain ID, checks balance, and then sends. If doing the steps manually instead, load `.env` first:

```bash
set -a
source .env
set +a
DEPLOYER=$(cast wallet address --private-key $PRIVATE_KEY)
cast chain-id --rpc-url $RPC
cast balance $DEPLOYER --rpc-url $RPC --ether
```

Use a configured receipt anchor contract if available:

```bash
cast send "$PHAROS_RECEIPT_ANCHOR" \
  "anchorReceipt(bytes32)" "$RECEIPT_HASH" \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

If no anchor contract is configured and the user explicitly approves a zero-value memo transaction, send the receipt hash as calldata to the sender address:

```bash
ANCHOR_TO=${PHAROS_ANCHOR_TO:-$DEPLOYER}
cast send "$ANCHOR_TO" \
  --value 0 \
  --data "$RECEIPT_HASH" \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC
```

The packaged helper performs this no-contract-needed flow:

```bash
cp -n .env.example .env
# edit .env and set PRIVATE_KEY to a funded Pharos Atlantic wallet
./assets/pharos-anchor-receipt.sh "$RECEIPT_HASH"
```

After anchoring, record the transaction hash in `pharosTransactionHash` and update `receiptHash`.

The packaged helper uses:

| Field | Value |
|-------|-------|
| Network | Pharos Atlantic Testnet |
| Chain ID | `688689` |
| RPC variable | `RPC=https://atlantic.dplabs-internal.com` |
| Receipt payload | `bytes32 receiptHash` |
| Transaction type | `cast send $DEPLOYER --value 0 --data $RECEIPT_HASH` |

## Failure Handling

| Failure | Action |
|---------|--------|
| `cast: command not found` | Do not anchor. Return the local receipt and explain Foundry is needed for anchoring. |
| `PRIVATE_KEY` missing | Do not anchor. Ask the user to configure it outside the receipt file. |
| `insufficient funds` | Do not retry blindly. Return local receipt and balance context. |
| Chain ID mismatch | Stop and ask the user to confirm the intended Pharos network. |
| Transaction failed | Keep the local receipt, record anchoring failure separately, and do not change execution status. |
