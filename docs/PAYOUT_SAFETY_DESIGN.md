# CharterFlow Native Transfer & Settlement Safety Design

**Document Version:** 1.0.0  
**Target Runtime:** GenLayer Intelligent VM (Consensus v0.6 RC, Chain ID: 61997)  
**Contract:** `CharterFlowCore` (`contracts/CharterFlowCore.py`)  
**Pinned Dependencies:** `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`, `py-lib-genlayer-std:kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0`

---

## 1. Pinned GenLayer Runtime Investigation & Authoritative Findings

### 1.1 `emit_transfer` Mechanism
In the pinned standard library (`genlayer._internal.on_chain.eth`):
```python
evm_contract_interface = contract_generator(
    _generate_view,
    _generate_send,
    lambda p: wasi.get_balance(p.address.as_bytes),
    lambda p, d: gl_call.gl_call_generic(
        {
            'EmitExternalMessage': {
                'address': p.address,
                'calldata': b'',
                'value': d.get('value', 0),
            }
        },
        lambda _x: None,
    ).get(),
)
```
- Calling `_Recipient(address).emit_transfer(value=amount)` dispatches an `EmitExternalMessage` request to the WASI host.
- The handler returns `None` synchronously. **The current `emit_transfer` path provides no child result to this contract**: there is no transaction hash, no execution outcome, and no callback.
- The external transfer (child transaction) is scheduled for asynchronous execution on the EVM/chain layer after the Intelligent Contract parent transaction finalizes.

### 1.2 Child Transaction Identity and Finality
- The child transaction is created by the protocol consensus layer.
- Its identity can only be observed off-chain via the RPC / explorer through the parent receipt's `triggered_transactions` array or the child transaction's `triggered_by` field.
- In GenVM, there is **zero bytecode introspection or transaction receipt querying API**. The contract cannot check `extcodesize`, EVM transaction receipts, or child execution results.

### 1.3 Asynchronous Outcomes & Value Post-Failure
- Official GenLayer value-transfer documentation establishes:
  > *"External transactions are executed asynchronously on the EVM layer. If the transaction fails, the sent amount is not automatically returned to the contract."*
- When `emit_transfer(value=amount)` executes, `amount` is deducted from `self.balance`.
- If the child transaction reverts on the EVM side (e.g. out of gas, unpayable contract recipient, or relayer fault), the funds remain debited from the contract's EVM balance. The protocol provides **no automatic return, no rollback, and no failure notification** to the sending Intelligent Contract. Failed value is not automatically returned to contract custody.

### 1.4 Impossibility of On-Chain Recovery & Round Solvency Breakdown
- Because the Intelligent Contract receives no callback and no return of funds upon child transaction failure, **true on-chain recovery of lost or failed child transfers cannot be implemented on the pinned GenLayer runtime**.
- Attempting to permit an on-chain "retry" by re-emitting funds without returned custody would create a catastrophic solvency violation:
  $$\text{contract.balance} < \sum_{R \in \text{Rounds}} \left( \text{available\_wei}_R + \text{reserved\_wei}_R + \text{approved\_credits\_wei}_R + \text{creator\_claimable\_wei}_R \right)$$
  An unfunded retry deducts unreturned value from the shared contract balance, which steals funds from other rounds' deposits and causes protocol-wide insolvency.
- **Rule of Truthfulness**: Any claim that CharterFlow implements "on-chain recovery" for failed child transfers is false. The system must enforce defensible settlement restrictions and truthfully declare what remains impossible.

### 1.5 Distinction Between Live Evidence, Direct-Mode Mocks, and Feasibility Tests
- **Live On-Chain Evidence**: The successful 0.05 GEN live child transfer (tx [`0x6e012d41c822b321271b194318121a240681d4568087d06a63ffb4e882b6d6f0`](https://explorer-studio-dev.genlayer.com/tx/0x6e012d41c822b321271b194318121a240681d4568087d06a63ffb4e882b6d6f0), triggered by parent withdraw [`0x0f29c0f7523d74aa89d8e93cbb995c19d69191052ea8e1893de3656fec032c6a`](https://explorer-studio-dev.genlayer.com/tx/0x0f29c0f7523d74aa89d8e93cbb995c19d69191052ea8e1893de3656fec032c6a) on chain 61997) is finalized and verified. It must be kept strictly distinguished from local unit simulations.
- **Direct-Mode Mock Arithmetic Examples**: Lifecycle tests (such as the 10 GEN simulated round in `test_direct_mode_mock_round_close_and_refund_lifecycle` and the multi-round conservation proofs in `test_pinned_runtime_lacks_child_outcome_and_precludes_onchain_recovery`) are direct-mode mock arithmetic examples executed inside a local mock harness; they are NOT live chain transactions and do NOT prove live failure recovery or live close/refund.
- **Standalone Feasibility Tests vs. Deployed Consensus**: The structured-condition consensus comparison (`test_standalone_structured_mandatory_condition_consensus_comparison_feasibility`) is strictly a standalone feasibility test. The deployed contract (`0x56438445435F7cbf3e585Ca9227df8fC2dAe25C8`) continues to compare only the categorical verdict string (`"ELIGIBLE"`).
- **Hypothetical EOA Restriction**: CharterFlow does not currently enforce an EOA-only recipient rule in contract code (recipient addresses are unconstrained `Address` types). Even as a hypothetical restriction, restricting recipients to EOAs would still leave chain-layer child transfer failures (EVM gas price surges, relayer timeouts, block gas limit exhaustion) possible and unrecoverable on-chain.

---

## 2. Defensible Settlement Restrictions

Instead of claiming impossible recovery, CharterFlow enforces strict, defensible settlement restrictions:

1. **Checks-Effects-Interactions (CEI)**:
   - For `withdraw_credit`: `credit_withdrawn = True`, `state = "PAYOUT_EMITTED"`, `approved_credits_wei -= amount`, and `payouts_emitted_wei += amount` are committed to storage *before* calling `emit_transfer`.
   - For `claim_creator_refund`: `creator_claimable_wei = 0`, `state = "REFUND_EMITTED"`, and `refunds_emitted_wei += claimable` are committed to storage *before* calling `emit_transfer`.
2. **Strict Caller Authorization**:
   - Only `proposal.recipient` can call `withdraw_credit`.
   - Only `round.creator` can call `claim_creator_refund`.
3. **Single-Use Payout Emission**:
   - Once emitted, neither credit withdrawal nor creator refund can be triggered again. This prevents double-spending, replay attacks, and treasury depletion.
4. **Permanent Custody of Approved Credits**:
   - Round closure (`close_round_and_refund`) only sweeps `available_wei` to `creator_claimable_wei`.
   - `approved_credits_wei` is **never** wiped or returned to the creator. Approved beneficiaries may withdraw their credit before or after round closure.
5. **Contract Balance Solvency Guard**:
   - Both `withdraw_credit` and `claim_creator_refund` verify `self.balance >= amount`.
6. **Recipient Non-Zero & Formatting Normalization**:
   - Recipient addresses are normalized via `_as_address`, rejecting zero-address and malformed address strings.

---

## 3. Six-Way Settlement Status Taxonomy

To eliminate ambiguity between on-chain contract state and chain-layer delivery, the protocol and frontend distinguish six distinct stages:

```
[1. ENTITLED]
     │
     │ Parent transaction broadcast & finalized
     ▼
[2. TRANSFER_EMITTED]  (Contract storage debited; emit_transfer dispatched)
     │
     ├─────────────────────────────────┬───────────────────────────────┐
     │ Child tx pending in mempool     │ Child tx finalized & credited │ Child tx reverted/failed
     ▼                                 ▼                               ▼
[3. CHILD_PENDING]             [4. INDEPENDENTLY_CREDITED]     [5. CHILD_FAILED]
                                   (Delivered / Verified)          (Irreversible Failure)
                                                                       │
                                                                       │ Unconfirmed / RPC timeout
                                                                       ▼
                                                               [6. CHILD_UNCERTAIN]
```

| Status | Contract State | Child Transaction State | UI Description & Action Gate |
| :--- | :--- | :--- | :--- |
| **1. ENTITLED** | Proposal: `APPROVED`<br>Round: `CLOSED` (`claimable > 0`) | Not yet emitted | Actionable: "WITHDRAW CREDIT" or "CLAIM REFUND" enabled for authorized signer. |
| **2. TRANSFER_EMITTED** | Proposal: `PAYOUT_EMITTED`<br>Round: `REFUND_EMITTED` | Emitted by parent; lookup in progress | Informational: "Parent transaction finalized. Resolving child transfer on EVM layer..." Submit disabled. |
| **3. CHILD_PENDING** | `PAYOUT_EMITTED` / `REFUND_EMITTED` | Detected in `triggered_transactions`, status `PENDING` | In-Flight: "Child transfer detected in block execution. Awaiting consensus finalization." |
| **4. INDEPENDENTLY_CREDITED** | `PAYOUT_EMITTED` / `REFUND_EMITTED` | `FINALIZED`, `value_credited: true`, execution `NOT_VOTED` or `FINISHED_WITH_RETURN`, exact address/value match | **DELIVERED**: "Transfer independently credited on chain layer. Child Tx: 0x... Delivery proven." |
| **5. CHILD_FAILED** | `PAYOUT_EMITTED` / `REFUND_EMITTED` | `FINALIZED` with `FINISHED_WITH_ERROR`, reverted, or `value_credited: false` | **DELIVERY FAILED**: "Child transfer failed on chain layer. Contract funds were debited upon emission; runtime does not support automated recovery. Do not re-submit." |
| **6. CHILD_UNCERTAIN** | `PAYOUT_EMITTED` / `REFUND_EMITTED` | Unfound after polling timeout or RPC error | **UNCERTAIN**: "Child transfer unconfirmed after timeout. Read-only reconciliation required. Submit disabled." |

---

## 4. Treasury Invariants & Conservation Equations

### 4.1 Single-Round Balance Conservation
For any round $R$, the initial deposit is strictly conserved across all states:

$$\text{initial\_deposit}_R \equiv \text{available\_wei}_R + \text{reserved\_wei}_R + \text{approved\_credits\_wei}_R + \text{creator\_claimable\_wei}_R + \text{payouts\_emitted\_wei}_R + \text{refunds\_emitted\_wei}_R$$

### 4.2 Multi-Round Contract Solvency Invariant
The contract balance custodied on the chain layer must always equal or exceed the total active un-emitted liabilities of all registered rounds:

$$\text{contract.balance} \ge \sum_{R \in \text{Rounds}} \left( \text{available\_wei}_R + \text{reserved\_wei}_R + \text{approved\_credits\_wei}_R + \text{creator\_claimable\_wei}_R \right)$$

When an external transfer is emitted, the value leaves `contract.balance`:

$$\Delta \text{contract.balance} = - \text{amount}$$
$$\Delta \text{payouts\_emitted\_wei}_R = + \text{amount} \quad (\text{or } \Delta \text{refunds\_emitted\_wei}_R = + \text{claimable})$$

Thus:
$$\text{contract.balance} + \sum_{R} \left( \text{payouts\_emitted\_wei}_R + \text{refunds\_emitted\_wei}_R \right) \equiv \sum_{R} \text{initial\_deposit}_R$$

Zero slippage, zero phantom minting, zero cross-round leakage.
