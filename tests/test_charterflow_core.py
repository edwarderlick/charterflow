import sys
import os
import json
import types
import pytest
from pathlib import Path
from contextlib import contextmanager

# Ensure workspace root is on sys.path
WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from gltest.direct.sdk_loader import setup_sdk_paths
setup_sdk_paths(version="v0.6.0-rc8")

import genlayer as gl
import genlayer.message as gl_msg
from genlayer.storage import DynArray, TreeMap
from genlayer.storage._internal.generate import (
    _BuilderCtx,
    _storage_build,
    ROOT_SLOT_ID,
    ORIGINAL_INIT_ATTR,
)
from gltest.direct.vm import VMContext
from gltest.direct import wasi_mock
sys.modules["_genlayer_wasi"] = wasi_mock

# Connect wasi_mock for direct mode execution
sys.modules["genlayer.py"] = types.SimpleNamespace(calldata=gl.calldata)
import genlayer.contract as gc
gc.wasi = wasi_mock
import genlayer._internal.on_chain.gl_call as gcall
gcall._imp_raw = wasi_mock.gl_call

from contracts.CharterFlowCore import CharterFlowCore, _parse_strict_ai_verdict


# ==============================================================================
# Test Fixtures & Helpers
# ==============================================================================

_captured_nondet_calls = []
captured_emitted_messages = []


def _direct_run_nondet_hook(leader_fn, validator_fn, /, **kwargs):
    """
    Direct-mode execution hook for gl.vm.run_nondet and gl.vm.run_nondet_default.
    Captures leader and validator functions for unit verification.
    NOTE: Mocked direct mode executes in a single-process unit test harness;
    it simulates local equivalence checking and does NOT prove multi-validator consensus.
    """
    result = leader_fn()
    _captured_nondet_calls.append((result, leader_fn, validator_fn))
    return result


gl.vm.run_nondet = _direct_run_nondet_hook
gl.vm.run_nondet_default = _direct_run_nondet_hook
gl.vm.run_nondet_unsafe = _direct_run_nondet_hook


@pytest.fixture(autouse=True)
def restore_sdk_environment():
    """Ensure SDK paths and hooks are restored for every direct test."""
    setup_sdk_paths(version="v0.6.0-rc8")
    sys.modules["genlayer.py"] = types.SimpleNamespace(calldata=gl.calldata)
    import genlayer.contract as gc
    gc.wasi = wasi_mock
    import genlayer._internal.on_chain.gl_call as gcall
    gcall._imp_raw = wasi_mock.gl_call
    gl.vm.run_nondet = _direct_run_nondet_hook
    gl.vm.run_nondet_default = _direct_run_nondet_hook
    gl.vm.run_nondet_unsafe = _direct_run_nondet_hook
    yield
    setup_sdk_paths(version="v0.6.0-rc8")


def deploy_core(vm: VMContext) -> CharterFlowCore:
    """Deploy CharterFlowCore in direct mode with balance and message tracking."""
    setup_sdk_paths(version="v0.6.0-rc8")
    sys.modules["genlayer.py"] = types.SimpleNamespace(calldata=gl.calldata)
    import genlayer.contract as gc
    gc.wasi = wasi_mock
    import genlayer._internal.on_chain.gl_call as gcall
    gcall._imp_raw = wasi_mock.gl_call
    gl.vm.run_nondet = _direct_run_nondet_hook
    gl.vm.run_nondet_default = _direct_run_nondet_hook
    gl.vm.run_nondet_unsafe = _direct_run_nondet_hook

    _captured_nondet_calls.clear()
    captured_emitted_messages.clear()
    ctx = _BuilderCtx.empty()
    td = _storage_build(ctx, CharterFlowCore)
    slot = vm._storage.get_store_slot(ROOT_SLOT_ID)
    instance = td.get(slot, 0)
    init = getattr(CharterFlowCore, "__init__", None)
    if hasattr(init, ORIGINAL_INIT_ATTR):
        init = getattr(init, ORIGINAL_INIT_ATTR)
    if init is not None:
        init(instance)

    contract_bytes = bytes(instance.address) if hasattr(instance.address, '__bytes__') else instance.address
    vm._contract_address = instance.address
    if contract_bytes not in vm._balances:
        vm._balances[contract_bytes] = 0

    def gl_call_hook(v, req):
        if "EmitExternalMessage" in req:
            msg = req["EmitExternalMessage"]
            captured_emitted_messages.append(msg)
            val = int(msg.get("value", 0))
            if val > 0:
                c_bytes = bytes(v._contract_address) if hasattr(v._contract_address, '__bytes__') else v._contract_address
                v._balances[c_bytes] = v._balances.get(c_bytes, 0) - val
            return {"ok": None}
        if "EmitInternalMessage" in req:
            msg = req["EmitInternalMessage"]
            captured_emitted_messages.append(msg)
            val = int(msg.get("value", 0))
            if val > 0:
                c_bytes = bytes(v._contract_address) if hasattr(v._contract_address, '__bytes__') else v._contract_address
                v._balances[c_bytes] = v._balances.get(c_bytes, 0) - val
            return {"ok": None}
        if "GetTimestamp" in req:
            import datetime as _dt
            return int(_dt.datetime.fromisoformat(v._datetime).timestamp())
        return None

    vm._gl_call_hook = gl_call_hook
    return instance


@contextmanager
def as_caller(sender: gl.Address, value: gl.u256 = gl.u256(0)):
    """Set transaction context (sender and value) and credit contract balance if value sent."""
    old_sender = getattr(gl_msg, "sender_address", None)
    old_value = getattr(gl_msg, "value", None)
    gl_msg.sender_address = sender
    gl_msg.value = value
    val_int = int(value)
    credited = False
    vm = None
    c_bytes = None
    if val_int > 0:
        try:
            vm = wasi_mock.get_vm()
            if vm and vm._contract_address:
                c_bytes = bytes(vm._contract_address) if hasattr(vm._contract_address, '__bytes__') else vm._contract_address
                vm._balances[c_bytes] = vm._balances.get(c_bytes, 0) + val_int
                credited = True
        except Exception:
            pass
    try:
        yield
    except Exception:
        if credited and vm and c_bytes:
            vm._balances[c_bytes] -= val_int
        raise
    finally:
        if old_sender is not None:
            gl_msg.sender_address = old_sender
        if old_value is not None:
            gl_msg.value = old_value


def get_current_time() -> int:
    import datetime as _dt
    return int(_dt.datetime.now(_dt.timezone.utc).timestamp())


def valid_round_times(now_ts: int = None):
    """Return valid (nomination_cutoff, voting_duration, round_end) adhering to sequence invariant."""
    if now_ts is None:
        now_ts = get_current_time()
    cutoff = gl.u64(now_ts + 7200)        # now + 2h
    duration = gl.u64(3600)               # 1h voting window
    round_end = gl.u64(now_ts + 200000)   # > cutoff + 86400 + duration
    return cutoff, duration, round_end


# Standard test accounts
CREATOR = gl.Address("0x1111111111111111111111111111111111111111")
MEMBER_A = gl.Address("0x2222222222222222222222222222222222222222")
MEMBER_B = gl.Address("0x3333333333333333333333333333333333333333")
MEMBER_C = gl.Address("0x4444444444444444444444444444444444444444")
OUTSIDER = gl.Address("0x5555555555555555555555555555555555555555")
BENEFICIARY = gl.Address("0x6666666666666666666666666666666666666666")
ZERO_ADDR = gl.Address("0x0000000000000000000000000000000000000000")

DEFAULT_CHARTER = (
    "CharterFlow Directive 1: All proposals must produce open source software. "
    "Directive 2: Work must be verifiable via git repositories and test artifacts. "
    "Directive 3: Lump-sum grant allocation upon governance authorization."
)


# ==============================================================================
# 1. Full Lifecycle Ledger Conservation & emit_transfer Test
# ==============================================================================

def test_ledger_conservation():
    """
    Verify exact ledger conservation invariant across all lifecycle states:
    initial_deposit == available + reserved + approved_credits + creator_claimable + payouts + refunds
    and contract.balance == available + reserved + approved_credits + creator_claimable.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        deposit = gl.u256(5 * 10**18)  # 5 GEN
        grant_amount = gl.u256(2 * 10**18)  # 2 GEN
        cutoff, duration, round_end = valid_round_times()

        # 1. State: ACTIVE (Genesis)
        with as_caller(CREATOR, value=deposit):
            core.create_round(
                round_id="rnd-ledger",
                title="Ledger Conservation Round",
                description="Testing strict ledger conservation invariants",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B, MEMBER_C],
                grant_cap_wei=deposit,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        r = core.get_round("rnd-ledger")
        assert int(r["available_wei"]) == 5 * 10**18
        assert int(r["reserved_wei"]) == 0
        assert int(r["approved_credits_wei"]) == 0
        assert int(r["creator_claimable_wei"]) == 0
        assert int(r["payouts_emitted_wei"]) == 0
        assert int(r["refunds_emitted_wei"]) == 0
        assert int(core.balance) == 5 * 10**18
        assert (
            int(r["available_wei"]) + int(r["reserved_wei"]) + int(r["approved_credits_wei"])
            + int(r["creator_claimable_wei"]) + int(r["payouts_emitted_wei"]) + int(r["refunds_emitted_wei"])
            == int(r["initial_deposit"])
        )

        # 2. State: ACTIVE (Nominated: Available -> Reserved)
        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-ledger",
                recipient=BENEFICIARY,
                title="Deliverable Alpha",
                requested_amount_wei=grant_amount,
                deliverables_text="Open source client implementation with 100% test coverage.",
            )

        r = core.get_round("rnd-ledger")
        assert int(r["available_wei"]) == 3 * 10**18
        assert int(r["reserved_wei"]) == 2 * 10**18
        assert int(core.balance) == 5 * 10**18
        assert (
            int(r["available_wei"]) + int(r["reserved_wei"]) + int(r["approved_credits_wei"])
            + int(r["creator_claimable_wei"]) + int(r["payouts_emitted_wei"]) + int(r["refunds_emitted_wei"])
            == int(r["initial_deposit"])
        )

        # 3. State: ACTIVE (AI Evaluated to ELIGIBLE via evaluate_charter_fit)
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "OSS compliant"})
        v = core.evaluate_charter_fit(pid)
        assert v == "ELIGIBLE"

        r = core.get_round("rnd-ledger")
        assert int(r["available_wei"]) == 3 * 10**18
        assert int(r["reserved_wei"]) == 2 * 10**18
        assert int(core.balance) == 5 * 10**18

        # 4. State: ACTIVE (Ratified: Reserved -> Approved Credits)
        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            st = core.cast_vote(pid, "YES")
            assert st == "APPROVED"

        r = core.get_round("rnd-ledger")
        assert int(r["available_wei"]) == 3 * 10**18
        assert int(r["reserved_wei"]) == 0
        assert int(r["approved_credits_wei"]) == 2 * 10**18
        assert int(r["creator_claimable_wei"]) == 0
        assert int(r["payouts_emitted_wei"]) == 0
        assert int(r["refunds_emitted_wei"]) == 0
        assert int(core.balance) == 5 * 10**18
        assert (
            int(r["available_wei"]) + int(r["reserved_wei"]) + int(r["approved_credits_wei"])
            + int(r["creator_claimable_wei"]) + int(r["payouts_emitted_wei"]) + int(r["refunds_emitted_wei"])
            == int(r["initial_deposit"])
        )

        # 5. State: Recipient Withdraws Approved Credit via emit_transfer
        with as_caller(BENEFICIARY):
            withdrawn = core.withdraw_credit(pid)
            assert withdrawn == grant_amount

        r = core.get_round("rnd-ledger")
        p = core.get_proposal(pid)
        assert p["state"] == "PAYOUT_EMITTED"
        assert p["credit_withdrawn"] is True
        assert int(r["approved_credits_wei"]) == 0
        assert int(r["payouts_emitted_wei"]) == 2 * 10**18
        assert int(core.balance) == 3 * 10**18
        assert (
            int(r["available_wei"]) + int(r["reserved_wei"]) + int(r["approved_credits_wei"])
            + int(r["creator_claimable_wei"]) + int(r["payouts_emitted_wei"]) + int(r["refunds_emitted_wei"])
            == int(r["initial_deposit"])
        )

        # 6. State: Time warp past round end -> Creator closes round
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)

        with as_caller(CREATOR):
            claimable = core.close_round_and_refund("rnd-ledger")
            assert claimable == gl.u256(3 * 10**18)

        r = core.get_round("rnd-ledger")
        assert r["state"] == "CLOSED"
        assert int(r["available_wei"]) == 0
        assert int(r["creator_claimable_wei"]) == 3 * 10**18
        assert int(r["refunds_emitted_wei"]) == 0
        assert int(core.balance) == 3 * 10**18

        # 7. State: Creator Claims Refund via emit_transfer
        with as_caller(CREATOR):
            refunded = core.claim_creator_refund("rnd-ledger")
            assert refunded == gl.u256(3 * 10**18)

        r = core.get_round("rnd-ledger")
        assert r["state"] == "REFUND_EMITTED"
        assert int(r["creator_claimable_wei"]) == 0
        assert int(r["refunds_emitted_wei"]) == 3 * 10**18
        assert int(core.balance) == 0
        assert (
            int(r["available_wei"]) + int(r["reserved_wei"]) + int(r["approved_credits_wei"])
            + int(r["creator_claimable_wei"]) + int(r["payouts_emitted_wei"]) + int(r["refunds_emitted_wei"])
            == int(r["initial_deposit"])
        )
        assert len(captured_emitted_messages) == 2


# ==============================================================================
# 2. Cross-Round Treasury Isolation Test
# ==============================================================================

def test_cross_round_isolation():
    """Verify funds and state in Round A can never be reserved or withdrawn by Round B."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep_a = gl.u256(5 * 10**18)   # 5 GEN
        dep_b = gl.u256(10 * 10**18)  # 10 GEN
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep_a):
            core.create_round(
                round_id="rnd-alpha",
                title="Alpha Treasury Round",
                description="Round Alpha mandate description",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep_a,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(CREATOR, value=dep_b):
            core.create_round(
                round_id="rnd-beta",
                title="Beta Treasury Round",
                description="Round Beta mandate description",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_B, MEMBER_C],
                grant_cap_wei=dep_b,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            core.nominate_proposal(
                round_id="rnd-alpha",
                recipient=BENEFICIARY,
                title="Alpha Proposal",
                requested_amount_wei=gl.u256(4 * 10**18),
                deliverables_text="Full Alpha module deliverable package.",
            )

        ra = core.get_round("rnd-alpha")
        rb = core.get_round("rnd-beta")

        assert int(ra["available_wei"]) == 1 * 10**18
        assert int(ra["reserved_wei"]) == 4 * 10**18
        assert int(rb["available_wei"]) == 10 * 10**18
        assert int(rb["reserved_wei"]) == 0

        # Attempting to nominate > 1 GEN in Round A fails even though Round B has 10 GEN liquid
        with as_caller(MEMBER_A):
            with pytest.raises(Exception) as exc:
                core.nominate_proposal(
                    round_id="rnd-alpha",
                    recipient=BENEFICIARY,
                    title="Overflow Proposal",
                    requested_amount_wei=gl.u256(2 * 10**18),
                    deliverables_text="This cannot borrow from Round B funds.",
                )
            assert "ERR_INSUFFICIENT_AVAILABLE_FUNDS" in str(exc.value)


# ==============================================================================
# 3. Duplicate and Zero Address Validation Test
# ==============================================================================

def test_duplicate_and_zero_addresses():
    """Verify rejection of zero address and duplicate committee members or recipients."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(2 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep):
            with pytest.raises(Exception) as exc:
                core.create_round(
                    round_id="rnd-zero",
                    title="Zero Address Round",
                    description="Valid description for round creation",
                    charter_text=DEFAULT_CHARTER,
                    committee_roster=[MEMBER_A, ZERO_ADDR],
                    grant_cap_wei=dep,
                    nomination_cutoff=cutoff,
                    voting_duration=duration,
                    round_end=round_end,
                )
            assert "ERR_ZERO_ADDRESS_IN_ROSTER" in str(exc.value)

        with as_caller(CREATOR, value=dep):
            with pytest.raises(Exception) as exc:
                core.create_round(
                    round_id="rnd-dup",
                    title="Duplicate Address Round",
                    description="Valid description for round creation",
                    charter_text=DEFAULT_CHARTER,
                    committee_roster=[MEMBER_A, MEMBER_A],
                    grant_cap_wei=dep,
                    nomination_cutoff=cutoff,
                    voting_duration=duration,
                    round_end=round_end,
                )
            assert "ERR_DUPLICATE_ROSTER_ENTRY" in str(exc.value)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-valid",
                title="Valid Round",
                description="Valid description for round creation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            with pytest.raises(Exception) as exc:
                core.nominate_proposal(
                    round_id="rnd-valid",
                    recipient=ZERO_ADDR,
                    title="Zero Recipient",
                    requested_amount_wei=gl.u256(10**18),
                    deliverables_text="Deliverables text with sufficient length.",
                )
            assert "ERR_RECIPIENT_ZERO_ADDRESS" in str(exc.value)


# ==============================================================================
# 4. Recipient Recusal (Anti-Self-Dealing) Test
# ==============================================================================

def test_recipient_recusal():
    """Verify committee member named as recipient is strictly recused from voting."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(3 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-recusal",
                title="Recusal Validation Round",
                description="Valid description for round creation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B, MEMBER_C],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_B):
            pid = core.nominate_proposal(
                round_id="rnd-recusal",
                recipient=MEMBER_A,
                title="Member A Grant",
                requested_amount_wei=gl.u256(10**18),
                deliverables_text="Delivering new core optimization module.",
            )

        # Transition via real evaluate_charter_fit call
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Self-nomination valid format"})
        core.evaluate_charter_fit(pid)

        # Recipient attempts to vote on their own proposal -> MUST REVERT
        with as_caller(MEMBER_A):
            with pytest.raises(Exception) as exc:
                core.cast_vote(pid, "YES")
            assert "ERR_RECIPIENT_RECUSED" in str(exc.value)

        # Non-recipient committee member votes normally
        with as_caller(MEMBER_B):
            st = core.cast_vote(pid, "YES")
            assert st == "VOTING"


# ==============================================================================
# 5. Vote Thresholds & Rational 2/3 Supermajority Math Test
# ==============================================================================

def test_vote_thresholds():
    """Verify exact canonical rational 2/3 supermajority math with and without recusal."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-threshold",
                title="Threshold Round",
                description="Valid description for round creation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B, MEMBER_C],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-threshold",
                recipient=BENEFICIARY,
                title="External Beneficiary Grant",
                requested_amount_wei=gl.u256(10**18),
                deliverables_text="Deliverables text with sufficient length.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Approved"})
        core.evaluate_charter_fit(pid)

        # 1st vote: 1/3
        with as_caller(MEMBER_A):
            st = core.cast_vote(pid, "YES")
            assert st == "VOTING"

        # Duplicate vote by same member -> REVERT
        with as_caller(MEMBER_A):
            with pytest.raises(Exception) as exc:
                core.cast_vote(pid, "YES")
            assert "ERR_ALREADY_VOTED" in str(exc.value)

        # 2nd vote: 2/3 threshold reached -> APPROVED!
        with as_caller(MEMBER_B):
            st = core.cast_vote(pid, "YES")
            assert st == "APPROVED"

        prop = core.get_proposal(pid)
        assert prop["state"] == "APPROVED"
        assert prop["votes_yes"] == 2
        assert prop["votes_no"] == 0


# ==============================================================================
# 6. Timeout Races & Safe Return Transitions
# ==============================================================================

def test_timeout_races_and_review_expiry():
    """Verify late review cleanly transitions to EXPIRED without throwing rollback errors."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-timeout",
                title="Timeout Round",
                description="Valid description for round creation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-timeout",
                recipient=BENEFICIARY,
                title="Timeout Proposal",
                requested_amount_wei=gl.u256(2 * 10**18),
                deliverables_text="Deliverables text with sufficient length.",
            )

        # Warp time past the 86400s review window
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(now_ts + 90000, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)

        verdict = core.evaluate_charter_fit(pid)
        assert verdict == "EXPIRED"

        prop = core.get_proposal(pid)
        assert prop["state"] == "EXPIRED"
        assert prop["review_verdict"] == "EXPIRED"

        r = core.get_round("rnd-timeout")
        assert int(r["reserved_wei"]) == 0
        assert int(r["available_wei"]) == 5 * 10**18


# ==============================================================================
# 7. Bounded Settlement & Round Closure
# ==============================================================================

def test_bounded_settlement_and_closure():
    """Verify permissionless settlement unblocks round closure when proposals expire."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-closure",
                title="Closure Round",
                description="Valid description for round creation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-closure",
                recipient=BENEFICIARY,
                title="Unvoted Proposal",
                requested_amount_wei=gl.u256(2 * 10**18),
                deliverables_text="Deliverables text with sufficient length.",
            )

        # Warp time past round end
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)

        # Creator tries to close round while reserved_wei > 0 -> MUST REVERT
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc:
                core.close_round_and_refund("rnd-closure")
            assert "ERR_UNSETTLED_PROPOSALS_EXIST_RESERVED_FUNDS_REMAIN" in str(exc.value)

        # Anyone can settle the expired proposal
        with as_caller(OUTSIDER):
            st = core.settle_expired_proposal("rnd-closure", pid)
            assert st == "EXPIRED"

        # Now reserved_wei is 0, closure succeeds
        with as_caller(CREATOR):
            refund = core.close_round_and_refund("rnd-closure")
            assert refund == dep

        r = core.get_round("rnd-closure")
        assert r["state"] == "CLOSED"
        assert int(r["available_wei"]) == 0
        assert int(r["creator_claimable_wei"]) == 5 * 10**18
        assert int(r["refunds_emitted_wei"]) == 0


# ==============================================================================
# 8. Closure Preserves Pending-Refund & Approved Credits
# ==============================================================================

def test_approved_credits_do_not_block_closure_or_emit_refund():
    """
    Verify closure alone transitions unallocated funds to creator_claimable_wei,
    leaves refunds_emitted_wei == 0, and keeps approved credits permanent.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        approved_amt = gl.u256(2 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-permanent",
                title="Permanent Credit Round",
                description="Valid description for round creation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-permanent",
                recipient=BENEFICIARY,
                title="Approved Proposal",
                requested_amount_wei=approved_amt,
                deliverables_text="Deliverables text with sufficient length.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pid)

        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")

        r = core.get_round("rnd-permanent")
        assert int(r["approved_credits_wei"]) == 2 * 10**18
        assert int(r["available_wei"]) == 3 * 10**18
        assert int(r["reserved_wei"]) == 0

        # Warp past round end
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)

        # Creator closes round
        with as_caller(CREATOR):
            claimable = core.close_round_and_refund("rnd-permanent")
            assert claimable == gl.u256(3 * 10**18)

        r = core.get_round("rnd-permanent")
        assert r["state"] == "CLOSED"
        assert int(r["available_wei"]) == 0
        assert int(r["creator_claimable_wei"]) == 3 * 10**18
        assert int(r["refunds_emitted_wei"]) == 0
        assert int(r["approved_credits_wei"]) == 2 * 10**18


# ==============================================================================
# 9. Unauthorized Claims Rejection Test
# ==============================================================================

def test_unauthorized_claims():
    """Verify unauthorized callers cannot withdraw approved credits or claim creator refunds."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        grant_amt = gl.u256(2 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-unauth",
                title="Unauthorized Claims Test",
                description="Testing strict caller authorization on claims",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-unauth",
                recipient=BENEFICIARY,
                title="Nominated Package",
                requested_amount_wei=grant_amt,
                deliverables_text="Full package deliverable text with sufficient length.",
            )

        # 1. Recipient attempts withdraw before proposal is approved -> REVERT
        with as_caller(BENEFICIARY):
            with pytest.raises(Exception) as exc:
                core.withdraw_credit(pid)
            assert "ERR_PROPOSAL_NOT_APPROVED" in str(exc.value)

        # Advance proposal to APPROVED
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pid)
        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")

        # 2. Non-recipient (OUTSIDER) attempts withdraw -> REVERT
        with as_caller(OUTSIDER):
            with pytest.raises(Exception) as exc:
                core.withdraw_credit(pid)
            assert "ERR_CALLER_NOT_RECIPIENT" in str(exc.value)

        # 3. Creator attempts to withdraw recipient's credit -> REVERT
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc:
                core.withdraw_credit(pid)
            assert "ERR_CALLER_NOT_RECIPIENT" in str(exc.value)

        # 4. Creator attempts to claim refund before round is closed -> REVERT
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc:
                core.claim_creator_refund("rnd-unauth")
            assert "ERR_ROUND_NOT_CLOSED" in str(exc.value)

        # Close round past round end
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)
        with as_caller(CREATOR):
            core.close_round_and_refund("rnd-unauth")

        # 5. Non-creator (OUTSIDER) attempts to claim creator refund -> REVERT
        with as_caller(OUTSIDER):
            with pytest.raises(Exception) as exc:
                core.claim_creator_refund("rnd-unauth")
            assert "ERR_CALLER_NOT_ROUND_CREATOR" in str(exc.value)

        # 6. Recipient attempts to claim creator refund -> REVERT
        with as_caller(BENEFICIARY):
            with pytest.raises(Exception) as exc:
                core.claim_creator_refund("rnd-unauth")
            assert "ERR_CALLER_NOT_ROUND_CREATOR" in str(exc.value)


# ==============================================================================
# 10. Duplicate Claims Rejection Test (Single-Use Invariant)
# ==============================================================================

def test_duplicate_claims():
    """Verify each withdrawal and creator refund is strictly single-use."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        grant_amt = gl.u256(2 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-dupclaim",
                title="Duplicate Claims Round",
                description="Testing single-use claim semantics",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-dupclaim",
                recipient=BENEFICIARY,
                title="Single Use Grant",
                requested_amount_wei=grant_amt,
                deliverables_text="Full package deliverable text with sufficient length.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pid)
        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")

        # First withdrawal succeeds
        with as_caller(BENEFICIARY):
            core.withdraw_credit(pid)

        # Second withdrawal MUST REVERT (single-use invariant)
        with as_caller(BENEFICIARY):
            with pytest.raises(Exception) as exc:
                core.withdraw_credit(pid)
            assert "ERR_CREDIT_ALREADY_WITHDRAWN" in str(exc.value)

        # Warp past round end and close round
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)
        with as_caller(CREATOR):
            core.close_round_and_refund("rnd-dupclaim")

        # First creator refund succeeds
        with as_caller(CREATOR):
            core.claim_creator_refund("rnd-dupclaim")

        # Second creator refund MUST REVERT (single-use invariant)
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc:
                core.claim_creator_refund("rnd-dupclaim")
            assert "ERR_NO_CLAIMABLE_REFUND" in str(exc.value)


# ==============================================================================
# 11. Exact Amounts and Balance Deduction Test
# ==============================================================================

def test_exact_amounts_and_balance_deduction():
    """Verify emitted messages contain exact amounts and contract balance decrements accurately."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(7 * 10**18)
        grant_amt = gl.u256(3 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-exact",
                title="Exact Amounts Round",
                description="Testing exact wei arithmetic",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-exact",
                recipient=BENEFICIARY,
                title="Exact Proposal",
                requested_amount_wei=grant_amt,
                deliverables_text="Full package deliverable text with sufficient length.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pid)
        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")

        assert int(core.balance) == 7 * 10**18

        # Recipient withdraws exact grant amount
        with as_caller(BENEFICIARY):
            w = core.withdraw_credit(pid)
            assert w == grant_amt

        # Assert contract balance decremented by exactly grant_amt
        assert int(core.balance) == 4 * 10**18
        assert len(captured_emitted_messages) == 1
        msg1 = captured_emitted_messages[0]
        assert str(msg1["address"]).lower() == str(BENEFICIARY).lower()
        assert int(msg1["value"]) == int(grant_amt)

        # Warp past round end and close round
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)
        with as_caller(CREATOR):
            claimable = core.close_round_and_refund("rnd-exact")
            assert claimable == gl.u256(4 * 10**18)

        # Creator claims exact refund
        with as_caller(CREATOR):
            ref = core.claim_creator_refund("rnd-exact")
            assert ref == gl.u256(4 * 10**18)

        # Contract balance is now exactly zero
        assert int(core.balance) == 0
        assert len(captured_emitted_messages) == 2
        msg2 = captured_emitted_messages[1]
        assert str(msg2["address"]).lower() == str(CREATOR).lower()
        assert int(msg2["value"]) == 4 * 10**18


# ==============================================================================
# 12. Cross-Round Obligation Spending Prevention
# ==============================================================================

def test_cross_round_obligation_spending_prevention():
    """Verify one round cannot spend another round's obligations or balances."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep_a = gl.u256(3 * 10**18)
        dep_b = gl.u256(10 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep_a):
            core.create_round(
                round_id="rnd-obs-a",
                title="Round Obs A",
                description="Testing obligation isolation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep_a,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(CREATOR, value=dep_b):
            core.create_round(
                round_id="rnd-obs-b",
                title="Round Obs B",
                description="Testing obligation isolation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep_b,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        assert int(core.balance) == 13 * 10**18

        # Round A approves 2 GEN to Beneficiary
        with as_caller(MEMBER_A):
            pa = core.nominate_proposal(
                "rnd-obs-a", BENEFICIARY, "Alpha Grant", gl.u256(2 * 10**18), "Deliverables text with full specifications."
            )
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pa)
        with as_caller(MEMBER_A):
            core.cast_vote(pa, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pa, "YES")

        # Beneficiary withdraws 2 GEN
        with as_caller(BENEFICIARY):
            core.withdraw_credit(pa)

        ra = core.get_round("rnd-obs-a")
        rb = core.get_round("rnd-obs-b")
        assert int(ra["approved_credits_wei"]) == 0
        assert int(ra["payouts_emitted_wei"]) == 2 * 10**18
        assert int(ra["available_wei"]) == 1 * 10**18

        # Round B remains 100% intact: 10 GEN available, 0 payouts
        assert int(rb["available_wei"]) == 10 * 10**18
        assert int(rb["payouts_emitted_wei"]) == 0
        assert int(core.balance) == 11 * 10**18

        # Close Round A
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)
        with as_caller(CREATOR):
            core.close_round_and_refund("rnd-obs-a")

        # Round A creator claims refund of remaining 1 GEN
        with as_caller(CREATOR):
            core.claim_creator_refund("rnd-obs-a")

        ra_final = core.get_round("rnd-obs-a")
        assert int(ra_final["creator_claimable_wei"]) == 0
        assert int(ra_final["refunds_emitted_wei"]) == 1 * 10**18

        # Round B still has exactly 10 GEN untouched in contract balance
        assert int(core.balance) == 10 * 10**18
        rb_final = core.get_round("rnd-obs-b")
        assert int(rb_final["available_wei"]) == 10 * 10**18


# ==============================================================================
# 13. Claims After Closure Test
# ==============================================================================

def test_claims_after_closure():
    """Verify approved credits remain permanently withdrawable even after round closure."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        grant_amt = gl.u256(2 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-afterclose",
                title="Claims After Closure",
                description="Testing permanence of approved credits after round closure",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-afterclose",
                recipient=BENEFICIARY,
                title="Permanent Proposal",
                requested_amount_wei=grant_amt,
                deliverables_text="Full package deliverable text with sufficient length.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pid)
        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")

        # Warp past round end
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)

        # Creator closes round BEFORE recipient withdraws
        with as_caller(CREATOR):
            claimable = core.close_round_and_refund("rnd-afterclose")
            assert claimable == gl.u256(3 * 10**18)

        r = core.get_round("rnd-afterclose")
        assert r["state"] == "CLOSED"
        assert int(r["approved_credits_wei"]) == 2 * 10**18
        assert int(r["creator_claimable_wei"]) == 3 * 10**18

        # Recipient withdraws approved credit AFTER closure succeeds!
        with as_caller(BENEFICIARY):
            w = core.withdraw_credit(pid)
            assert w == grant_amt

        p = core.get_proposal(pid)
        assert p["state"] == "PAYOUT_EMITTED"
        assert p["credit_withdrawn"] is True

        r_mid = core.get_round("rnd-afterclose")
        assert int(r_mid["approved_credits_wei"]) == 0
        assert int(r_mid["payouts_emitted_wei"]) == 2 * 10**18
        assert int(r_mid["creator_claimable_wei"]) == 3 * 10**18

        # Creator claims refund AFTER recipient withdrawal
        with as_caller(CREATOR):
            ref = core.claim_creator_refund("rnd-afterclose")
            assert ref == gl.u256(3 * 10**18)

        r_final = core.get_round("rnd-afterclose")
        assert r_final["state"] == "REFUND_EMITTED"
        assert int(r_final["creator_claimable_wei"]) == 0
        assert int(r_final["refunds_emitted_wei"]) == 3 * 10**18
        assert int(core.balance) == 0


# ==============================================================================
# 14. AI Review Fail-Closed & Equivalence Agreement Tests
# ==============================================================================

def test_ai_review_fail_closed_and_equivalence():
    """
    Verify strict fail-closed parsing and verdict-only validator agreement.
    NOTE: Mocked direct mode executes in a single-process unit test harness;
    it simulates local equivalence checking and does NOT prove multi-validator consensus.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(10 * 10**18)
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-failclosed",
                title="Fail Closed Round",
                description="Testing fail-closed parser",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        # 1. Compliant output -> ELIGIBLE
        with as_caller(MEMBER_A):
            p1 = core.nominate_proposal(
                "rnd-failclosed", BENEFICIARY, "Proposal Alpha", gl.u256(10**18),
                "Valid open source client deliverables adhering to all directives."
            )
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "All directives met"})
        st1 = core.evaluate_charter_fit(p1)
        assert st1 == "ELIGIBLE"
        assert core.get_proposal(p1)["review_reason"] == (
            "VALIDATOR_AGREED_VERDICT_ELIGIBLE; SEMANTIC_RATIONALE_NOT_VERIFIED"
        )

        # 2. Non-compliant output -> INELIGIBLE (Funds de-reserved)
        with as_caller(MEMBER_A):
            p2 = core.nominate_proposal(
                "rnd-failclosed", BENEFICIARY, "Proposal Beta", gl.u256(10**18),
                "Closed source proprietary binary blobs with zero source disclosure."
            )
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "INELIGIBLE", "reason": "Closed source"})
        st2 = core.evaluate_charter_fit(p2)
        assert st2 == "INELIGIBLE"
        assert core.get_proposal(p2)["state"] == "INELIGIBLE"

        # 3. Malformed JSON output -> Fails closed to NEEDS_CLARITY (No substring guessing!)
        with as_caller(MEMBER_A):
            p3 = core.nominate_proposal(
                "rnd-failclosed", BENEFICIARY, "Proposal Gamma", gl.u256(10**18),
                "Deliverables text with sufficient length for malformed test."
            )
        gl.nondet.exec_prompt = lambda p: "This output says ELIGIBLE in plain text but is not valid JSON!"
        st3 = core.evaluate_charter_fit(p3)
        assert st3 == "NEEDS_CLARITY"
        assert core.get_proposal(p3)["review_reason"] == (
            "VALIDATOR_AGREED_VERDICT_NEEDS_CLARITY; SEMANTIC_RATIONALE_NOT_VERIFIED"
        )

        # 4. Hostile injection attempt (disallowed verdict) -> Fails closed to NEEDS_CLARITY
        with as_caller(MEMBER_A):
            p4 = core.nominate_proposal(
                "rnd-failclosed", BENEFICIARY, "Proposal Delta", gl.u256(10**18),
                "Deliverables text with sufficient length for injection test."
            )
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "PASSED_ADMIN_OVERRIDE", "reason": "Injection"})
        st4 = core.evaluate_charter_fit(p4)
        assert st4 == "NEEDS_CLARITY"

        # 5. Validator agreement check (Simulated equivalence hook):
        assert len(_captured_nondet_calls) > 0
        leader_res, leader_fn, validator_fn = _captured_nondet_calls[0]
        
        # Contradictory free-text rationales still agree because only the verdict is checked.
        # This is acceptable only because the unverified rationale is discarded and never stored.
        gl.nondet.exec_prompt = lambda p: json.dumps({
            "verdict": "ELIGIBLE",
            "reason": "Contradictory rationale: none of the directives were met",
        })
        agreement = validator_fn(gl.vm.Return(leader_res))
        assert agreement is True

        # When validator independently reaches a conflicting verdict:
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "INELIGIBLE", "reason": "Validator disagrees"})
        disagreement = validator_fn(gl.vm.Return(leader_res))
        assert disagreement is False

        # Strict schema failures remain fail-closed; unexpected keys and non-string
        # reasons cannot become trusted stored rationales.
        assert _parse_strict_ai_verdict(
            json.dumps({"verdict": "ELIGIBLE", "reason": "ok", "directive_numbers": [1]})
        ) == ("NEEDS_CLARITY", "INVALID_OUTPUT_KEYS_FAIL_CLOSED")
        assert _parse_strict_ai_verdict(
            json.dumps({"verdict": "ELIGIBLE", "reason": ["not", "a", "string"]})
        ) == ("NEEDS_CLARITY", "MISSING_OR_NON_STRING_REASON")


# ==============================================================================
# 15. Pagination, Offset/Limit Bounds & Batch Capping Tests
# ==============================================================================

def test_pagination_and_bounds():
    """Verify offset/limit pagination, fixed limits (max 50), and batch settlement capping."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(10**18)
        cutoff, duration, round_end = valid_round_times()

        # Create 5 rounds
        with as_caller(CREATOR, value=dep):
            for i in range(5):
                core.create_round(
                    round_id=f"rnd-page-{i}",
                    title=f"Page Round {i}",
                    description="Round description",
                    charter_text=DEFAULT_CHARTER,
                    committee_roster=[MEMBER_A, MEMBER_B],
                    grant_cap_wei=dep,
                    nomination_cutoff=cutoff,
                    voting_duration=duration,
                    round_end=round_end,
                )

        assert core.get_round_ids_count() == 5

        # Page 1: offset=0, limit=2
        p1 = core.get_round_ids(offset=gl.u64(0), limit=gl.u64(2))
        assert len(p1) == 2
        assert p1 == ["rnd-page-0", "rnd-page-1"]

        # Page 2: offset=2, limit=2
        p2 = core.get_round_ids(offset=gl.u64(2), limit=gl.u64(2))
        assert len(p2) == 2
        assert p2 == ["rnd-page-2", "rnd-page-3"]

        # Page 3: offset=4, limit=2 -> 1 remaining item
        p3 = core.get_round_ids(offset=gl.u64(4), limit=gl.u64(2))
        assert len(p3) == 1
        assert p3 == ["rnd-page-4"]

        # Page Overflow: offset=10
        p_over = core.get_round_ids(offset=gl.u64(10), limit=gl.u64(10))
        assert p_over == []

        # Limit bounds validation
        with pytest.raises(Exception) as exc:
            core.get_round_ids(offset=gl.u64(0), limit=gl.u64(0))
        assert "ERR_INVALID_PAGE_LIMIT" in str(exc.value)

        with pytest.raises(Exception) as exc:
            core.get_round_ids(offset=gl.u64(0), limit=gl.u64(51))
        assert "ERR_INVALID_PAGE_LIMIT" in str(exc.value)

        # Batch settlement bounds
        with pytest.raises(Exception) as exc:
            core.settle_expired_proposals_batch("rnd-page-0", [])
        assert "ERR_EMPTY_BATCH" in str(exc.value)

        large_batch = [f"prp-{i}" for i in range(21)]
        with pytest.raises(Exception) as exc:
            core.settle_expired_proposals_batch("rnd-page-0", large_batch)
        assert "ERR_BATCH_SIZE_EXCEEDS_MAXIMUM_20" in str(exc.value)


# ==============================================================================
# 16. Compact Proposals Summary Pagination & Bounded Full Page
# ==============================================================================

def test_compact_proposals_summary_pagination():
    """Verify compact summary bounds (max 50) and full proposal bounds (max 20)."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(10 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-summary",
                title="Summary Round",
                description="Testing bounded summaries",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        # Create 5 proposals with large deliverables text
        large_deliv = "X" * 2000
        with as_caller(MEMBER_A):
            for i in range(5):
                core.nominate_proposal(
                    round_id="rnd-summary",
                    recipient=BENEFICIARY,
                    title=f"Heavy Proposal {i}",
                    requested_amount_wei=gl.u256(10**18),
                    deliverables_text=large_deliv,
                )

        assert core.get_round_proposals_count("rnd-summary") == 5

        # Query compact summary (up to 50 allowed)
        summary = core.get_round_proposals_summary("rnd-summary", offset=gl.u64(0), limit=gl.u64(10))
        assert len(summary) == 5
        for item in summary:
            assert "deliverables_preview" in item
            assert len(item["deliverables_preview"]) <= 120
            assert "deliverables_text" not in item  # Excluded to keep payload compact!

        # Summary limit bound check (> 50 reverts)
        with pytest.raises(Exception) as exc:
            core.get_round_proposals_summary("rnd-summary", offset=gl.u64(0), limit=gl.u64(51))
        assert "ERR_INVALID_PAGE_LIMIT" in str(exc.value)

        # Full proposal limit bound check (> 20 reverts to protect against excessive response)
        with pytest.raises(Exception) as exc:
            core.get_round_proposals("rnd-summary", offset=gl.u64(0), limit=gl.u64(21))
        assert "ERR_INVALID_PAGE_LIMIT" in str(exc.value)

        # Full proposal page up to 20 succeeds
        full_page = core.get_round_proposals("rnd-summary", offset=gl.u64(0), limit=gl.u64(20))
        assert len(full_page) == 5
        assert len(full_page[0]["deliverables_text"]) == 2000


# ==============================================================================
# 17. Deterministic Timestamp Runtime Test
# ==============================================================================

def test_deterministic_timestamp_runtime():
    """Verify gl.vm.get_timestamp() drives the deterministic transaction clock in runtime."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        now_ts = 1700000000  # deterministic fixed base time

        import datetime as _dt
        base_iso = _dt.datetime.fromtimestamp(now_ts, _dt.timezone.utc).isoformat()
        vm.warp(base_iso)

        cutoff, duration, round_end = valid_round_times(now_ts)

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-clock",
                title="Clock Test Round",
                description="Testing deterministic clock runtime",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-clock",
                recipient=BENEFICIARY,
                title="Clock Proposal",
                requested_amount_wei=gl.u256(2 * 10**18),
                deliverables_text="Deliverables text with sufficient length.",
            )

        # Before expiration: proposal cannot be expired
        with as_caller(OUTSIDER):
            st_early = core.settle_expired_proposal("rnd-clock", pid)
            assert st_early == "SUBMITTED"

        # Warp forward past review window (86400s) using deterministic VM clock
        future_iso = _dt.datetime.fromtimestamp(now_ts + 86500, _dt.timezone.utc).isoformat()
        vm.warp(future_iso)

        # Now proposal settles to EXPIRED driven by deterministic transaction timestamp
        with as_caller(OUTSIDER):
            st_expired = core.settle_expired_proposal("rnd-clock", pid)
            assert st_expired == "EXPIRED"

        assert core.get_proposal(pid)["state"] == "EXPIRED"


# ==============================================================================
# 18. Guarded Time Arithmetic (No Underflow on Buffer Subtraction)
# ==============================================================================

def test_guarded_time_arithmetic():
    """Verify round creation cleanly rejects invalid time sequence without numeric underflow."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(10**18)
        now_ts = get_current_time()

        # Case where round_end is smaller than min_buffer (86400 + voting_duration)
        with as_caller(CREATOR, value=dep):
            with pytest.raises(Exception) as exc:
                core.create_round(
                    round_id="rnd-underflow",
                    title="Underflow Test",
                    description="Valid description",
                    charter_text=DEFAULT_CHARTER,
                    committee_roster=[MEMBER_A, MEMBER_B],
                    grant_cap_wei=dep,
                    nomination_cutoff=gl.u64(now_ts + 7200),
                    voting_duration=gl.u64(3600),
                    round_end=gl.u64(100),  # Much smaller than min_buffer!
                )
            assert "ERR_INVALID_TIME_SEQUENCE" in str(exc.value)
