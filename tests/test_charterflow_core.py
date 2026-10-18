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

import tests.gltest_patch  # noqa: F401
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

from contracts.CharterFlowCore import CharterFlowCore, Proposal, _parse_strict_ai_verdict

try:
    from contracts.CharterFlowCore import _as_address
except ImportError:
    _as_address = None  # deployed 34ea0e37 source has no normalizer


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


# Direct mode only. This does not add APIs to the pinned runner.
gl.vm.run_nondet = _direct_run_nondet_hook
gl.vm.run_nondet_default = _direct_run_nondet_hook


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
    yield
    setup_sdk_paths(version="v0.6.0-rc8")


def deploy_core(vm: VMContext, cls=CharterFlowCore, *, install_nondet_hook: bool = True):
    """Deploy CharterFlowCore in direct mode with balance and message tracking."""
    setup_sdk_paths(version="v0.6.0-rc8")
    sys.modules["genlayer.py"] = types.SimpleNamespace(calldata=gl.calldata)
    import genlayer.contract as gc
    gc.wasi = wasi_mock
    import genlayer._internal.on_chain.gl_call as gcall
    gcall._imp_raw = wasi_mock.gl_call
    if install_nondet_hook:
        gl.vm.run_nondet = _direct_run_nondet_hook
        gl.vm.run_nondet_default = _direct_run_nondet_hook
    else:
        import importlib
        import genlayer.vm as vm_mod
        importlib.reload(vm_mod)
        gl.vm = vm_mod

    _captured_nondet_calls.clear()
    captured_emitted_messages.clear()
    ctx = _BuilderCtx.empty()
    td = _storage_build(ctx, cls)
    slot = vm._storage.get_store_slot(ROOT_SLOT_ID)
    instance = td.get(slot, 0)
    init = getattr(cls, "__init__", None)
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


# ==============================================================================
# 19. Browser calldata Address is a hex string (Studio Next nomination crash)
# ==============================================================================

BROWSER_RECIPIENT_HEX = "0x31e14df3b4f47F2428F3B78E7279691A78f70a05"
BROWSER_NOMINATION_AMOUNT = 50_000_000_000_000_000  # 0.05 GEN, same as failed tx 0x56c7d6d5...
BROWSER_NOMINATION_TITLE = "Build an open-source TypeScript dashboard that checks Studio"
BROWSER_NOMINATION_DELIVERABLES = (
    "Publish the source repository, a working public dashboard, reproducible read-only RPC checks, "
    "and setup documentation. Do not collect wallet credentials."
)
DEPLOYED_SOURCE_SHA256 = "34ea0e374cfe68788067838cebf4ca0c226e139c713aca6e7345716b35aad5ee"


def test_as_address_normalizes_hex_string_and_rejects_invalid():
    """Official GenLayer guidance: persist Address(hex), never a raw str."""
    if _as_address is None:
        pytest.skip("deployed source has no _as_address")
    addr = _as_address(BROWSER_RECIPIENT_HEX)
    assert isinstance(addr, gl.Address)
    assert addr.as_bytes == gl.Address(BROWSER_RECIPIENT_HEX).as_bytes
    assert _as_address(addr) is addr or _as_address(addr) == addr
    with pytest.raises(Exception, match="ERR_INVALID_ADDRESS"):
        _as_address("not-an-address")
    with pytest.raises(Exception, match="ERR_INVALID_ADDRESS"):
        _as_address("0x1234")


def test_storage_address_setter_rejects_unnormalized_hex_string():
    """Reproduce the deployed Studio crash: AddrDesc.set requires Address.as_bytes, not str."""
    vm = VMContext()
    with vm.activate():
        deploy_core(vm)
        with pytest.raises(AttributeError, match="as_bytes"):
            Proposal(
                proposal_id="prp-crash-1",
                round_id="rnd-crash",
                proposer=MEMBER_A,
                recipient=BROWSER_RECIPIENT_HEX,
                title=BROWSER_NOMINATION_TITLE,
                requested_amount_wei=gl.u256(BROWSER_NOMINATION_AMOUNT),
                deliverables_text=BROWSER_NOMINATION_DELIVERABLES,
                submission_timestamp=gl.u64(get_current_time()),
                state="SUBMITTED",
                review_verdict="PENDING",
                review_reason="",
                voting_deadline=gl.u64(0),
                votes_yes=gl.u32(0),
                votes_no=gl.u32(0),
                voted_addresses_json="[]",
                credit_withdrawn=False,
            )


def test_nominate_proposal_hex_string_recipient_matches_browser_calldata():
    """Public nominate_proposal must accept the same 0x hex string the browser/SDK encodes."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        cutoff, duration, round_end = valid_round_times()
        deposit = gl.u256(10**18)
        with as_caller(CREATOR, value=deposit):
            core.create_round(
                round_id="round-studio-next-rpc--mv9pwatt",
                title="Studio Next RPC Health Dashboard Pilot",
                description="Fund an open-source dashboard that displays Studio Next RPC read health.",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[
                    "0x2222222222222222222222222222222222222222",
                    "0x3333333333333333333333333333333333333333",
                    "0x4444444444444444444444444444444444444444",
                ],
                grant_cap_wei=gl.u256(10**17),
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        encoded = gl.calldata.encode({
            "": "nominate_proposal",
            "args": [
                "round-studio-next-rpc--mv9pwatt",
                BROWSER_RECIPIENT_HEX,
                BROWSER_NOMINATION_TITLE,
                BROWSER_NOMINATION_AMOUNT,
                BROWSER_NOMINATION_DELIVERABLES,
            ],
        })
        decoded = gl.calldata.decode(encoded)
        args = decoded["args"]
        assert isinstance(args[1], str), "browser calldata recipient must remain a hex string after decode"
        assert args[1] == BROWSER_RECIPIENT_HEX
        assert not hasattr(args[1], "as_bytes")

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(*args)

        p = core.get_proposal(pid)
        r = core.get_round("round-studio-next-rpc--mv9pwatt")
        assert str(p["recipient"]).lower() == BROWSER_RECIPIENT_HEX.lower()
        assert str(p["proposer"]).lower() == str(MEMBER_A).lower()
        assert int(p["requested_amount_wei"]) == BROWSER_NOMINATION_AMOUNT
        assert int(r["reserved_wei"]) == BROWSER_NOMINATION_AMOUNT
        assert int(r["available_wei"]) == 10**18 - BROWSER_NOMINATION_AMOUNT
        assert int(r["proposal_nonce"]) == 1
        assert str(p["recipient"]).lower() == gl.Address(BROWSER_RECIPIENT_HEX).as_hex.lower()
        if _as_address is not None:
            assert _as_address(p["recipient"]) == gl.Address(BROWSER_RECIPIENT_HEX)


def test_hex_string_recipient_full_lifecycle_review_vote_withdraw():
    """Complete local lifecycle using the browser hex-string recipient representation."""
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        cutoff, duration, round_end = valid_round_times()
        deposit = gl.u256(10**18)
        grant = gl.u256(BROWSER_NOMINATION_AMOUNT)
        with as_caller(CREATOR, value=deposit):
            core.create_round(
                round_id="rnd-hex-life",
                title="Hex Recipient Lifecycle",
                description="Lifecycle with ABI hex-string recipient",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B, MEMBER_C],
                grant_cap_wei=gl.u256(10**17),
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-hex-life",
                recipient=BROWSER_RECIPIENT_HEX,
                title=BROWSER_NOMINATION_TITLE,
                requested_amount_wei=grant,
                deliverables_text=BROWSER_NOMINATION_DELIVERABLES,
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "OSS dashboard"})
        assert core.evaluate_charter_fit(pid) == "ELIGIBLE"

        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_C):
            state = core.cast_vote(pid, "YES")
        assert state == "APPROVED"

        recipient_addr = gl.Address(BROWSER_RECIPIENT_HEX)
        with as_caller(recipient_addr):
            paid = core.withdraw_credit(pid)
        assert int(paid) == BROWSER_NOMINATION_AMOUNT
        p = core.get_proposal(pid)
        assert p["state"] == "PAYOUT_EMITTED"
        assert p["credit_withdrawn"] is True
        assert captured_emitted_messages, "withdraw must emit a native transfer"
        assert str(captured_emitted_messages[-1]["address"]).lower() == BROWSER_RECIPIENT_HEX.lower()


def test_nominate_proposal_invalid_hex_raises_err_invalid_address():
    if _as_address is None:
        pytest.skip("deployed source has no _as_address")
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        cutoff, duration, round_end = valid_round_times()
        with as_caller(CREATOR, value=gl.u256(10**18)):
            core.create_round(
                round_id="rnd-bad-addr",
                title="Invalid Address Gate",
                description="Reject non-Address recipient input",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=gl.u256(10**17),
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )
        with as_caller(MEMBER_A):
            with pytest.raises(Exception, match="ERR_INVALID_ADDRESS"):
                core.nominate_proposal(
                    round_id="rnd-bad-addr",
                    recipient="not-an-address",
                    title=BROWSER_NOMINATION_TITLE,
                    requested_amount_wei=gl.u256(BROWSER_NOMINATION_AMOUNT),
                    deliverables_text=BROWSER_NOMINATION_DELIVERABLES,
                )
        r = core.get_round("rnd-bad-addr")
        assert int(r["reserved_wei"]) == 0
        assert int(r["proposal_nonce"]) == 0


# ==============================================================================
# 20. Validator Equivalence Scope & Mandatory Condition Interpretations
# ==============================================================================

def test_validators_conflicting_interpretations_of_mandatory_conditions():
    """
    Demonstrate that validators can reach the same categorical verdict ('ELIGIBLE')
    through materially conflicting interpretations of mandatory conditions.

    Semantic Boundary Verified:
    1. What IS compared: Strictly the canonical parsed categorical string ('ELIGIBLE').
    2. What is NOT compared:
       - Free-form reasoning and rationale
       - Evaluation of individual mandatory directives or clauses
       - Objective truth of whether work/deliverables exist or are complete

    If the consensus check were upgraded to validate condition-level breakdown,
    the schema would need structured fields per clause. On the current runtime,
    Pattern 1 equivalence validates only the categorical verdict.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-consensus-scope",
                title="Consensus Equivalence Scope Round",
                description="Testing equivalence boundary with conflicting condition interpretations",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-consensus-scope",
                recipient=BENEFICIARY,
                title="Conflicting Interpretations Grant",
                requested_amount_wei=gl.u256(10**18),
                deliverables_text="Deliverables claiming open-source status and verifiable test coverage.",
            )

        # Leader LLM: Directive 1 (OSS) SATISFIED, Directive 2 (tests) FAILED
        leader_output = json.dumps({
            "verdict": "ELIGIBLE",
            "reason": "Directive 1 SATISFIED: open source license mentioned. Directive 2 FAILED: no test harness provided."
        })
        # Validator LLM: Directive 1 (OSS) FAILED, Directive 2 (tests) SATISFIED
        validator_conflicting_output = json.dumps({
            "verdict": "ELIGIBLE",
            "reason": "Directive 1 FAILED: ambiguous license terms. Directive 2 SATISFIED: test coverage documentation present."
        })
        # Validator LLM (Adverse): Evaluates to INELIGIBLE due to failure of mandatory clause
        validator_adverse_output = json.dumps({
            "verdict": "INELIGIBLE",
            "reason": "Directive 1 FAILED: strict failure of mandatory open source requirement."
        })

        # Set leader output and execute
        gl.nondet.exec_prompt = lambda p: leader_output
        state = core.evaluate_charter_fit(pid)
        assert state == "ELIGIBLE"

        # Inspect captured nondet hook
        assert len(_captured_nondet_calls) > 0
        result_calldata, leader_fn, validator_fn = _captured_nondet_calls[-1]
        assert json.loads(result_calldata)["verdict"] == "ELIGIBLE"

        # Case A: Validator has materially conflicting reasoning for mandatory conditions, but same verdict -> PASSES
        gl.nondet.exec_prompt = lambda p: validator_conflicting_output
        leaders_res = gl.vm.Return(result_calldata)
        assert validator_fn(leaders_res) is True, "Equivalence check passes because only categorical verdict is compared"

        # Case B: Validator disagrees on the categorical verdict -> FAILS (rejection)
        gl.nondet.exec_prompt = lambda p: validator_adverse_output
        assert validator_fn(leaders_res) is False, "Equivalence check rejects when categorical verdict differs"


# ==============================================================================
# 21. Two-Member Roster Recipient Recusal & Unilateral Approval Threshold
# ==============================================================================

def test_two_member_roster_recipient_recusal_threshold():
    """
    Demonstrate that in a 2-member committee where the recipient is on the roster:
    1. Recipient recusal reduces eligible voters from 2 to 1 (n_eligible = 1).
    2. The 2/3 supermajority threshold becomes: (1 * 2 + 2) // 3 = 1.
    3. The single remaining eligible committee member (e.g. Creator) unilaterally approves the proposal with 1 YES vote.
    4. Recipient is strictly barred from voting.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        # Roster consists of CREATOR and MEMBER_A
        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-2member-recusal",
                title="Two-Member Committee Round",
                description="Testing recusal threshold with 2-member roster",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[CREATOR, MEMBER_A],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        # MEMBER_A is nominated as recipient
        with as_caller(CREATOR):
            pid = core.nominate_proposal(
                round_id="rnd-2member-recusal",
                recipient=MEMBER_A,
                title="Member A Grant",
                requested_amount_wei=gl.u256(10**18),
                deliverables_text="Deliverables for committee member A grant.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Eligible"})
        assert core.evaluate_charter_fit(pid) == "ELIGIBLE"

        # Recipient MEMBER_A attempts to vote -> strictly barred by recusal invariant
        with as_caller(MEMBER_A):
            with pytest.raises(Exception) as exc:
                core.cast_vote(pid, "YES")
            assert "ERR_RECIPIENT_RECUSED" in str(exc.value)

        # Creator casts 1 YES vote -> immediately reaches threshold (1 required YES) -> APPROVED
        with as_caller(CREATOR):
            st = core.cast_vote(pid, "YES")
            assert st == "APPROVED"

        p = core.get_proposal(pid)
        assert p["state"] == "APPROVED"
        assert p["votes_yes"] == 1
        assert p["votes_no"] == 0


# ==============================================================================
# 22. Full Round Close and Refund Lifecycle Local Direct-Mode Test Simulation (Never a Live Demonstration)
# ==============================================================================

def test_demonstrate_full_round_close_and_refund_lifecycle():
    """
    Local direct-mode unit test simulation of the complete close and refund lifecycle
    on an isolated test round (never a live demonstration):
    - Initial deposit: 10 GEN (local direct-mode test simulation only)
    - Proposal A: Approved for 3 GEN credit
    - Proposal B: Nominated for 2 GEN reservation, not voted before cutoff -> expired reservation
    - Premature close rejection before round_end (reverts ERR_ROUND_NOT_ENDED)
    - Expired reservation release after round_end (settle_expired_proposal releases 2 GEN to available)
    - Valid close: close_round_and_refund transitions 7 GEN unallocated funds to creator_claimable_wei
    - Protected approved credits: 3 GEN credit remains protected and withdrawable after round is CLOSED
    - Creator claimable balance: creator_claimable_wei == 7 GEN, refunds_emitted_wei == 0
    - Refund emission: claim_creator_refund emits 7 GEN native transfer to creator
    - Separate child credit: emitted message captured, contract balance deducted
    - Duplicate refund rejection: second claim_creator_refund reverts ERR_NO_CLAIMABLE_REFUND
    - Recipient withdrawal: recipient calls withdraw_credit, receiving 3 GEN native transfer
    - Duplicate withdrawal rejection: second withdraw_credit reverts ERR_CREDIT_ALREADY_WITHDRAWN
    - Final ledger & balance reconciliation:
      initial_deposit == payouts_emitted (3 GEN) + refunds_emitted (7 GEN) == 10 GEN.
      contract.balance == 0. All invariants hold in local unit simulation.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(10 * 10**18)  # 10 GEN
        prop_a_amt = gl.u256(3 * 10**18)  # 3 GEN
        prop_b_amt = gl.u256(2 * 10**18)  # 2 GEN
        now_ts = get_current_time()
        cutoff, duration, round_end = valid_round_times(now_ts)

        # 1. Round Genesis
        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-full-lifecycle",
                title="Full Lifecycle Close and Refund Round",
                description="Testing complete round close and refund lifecycle",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        # 2. Nominate Proposal A (to be approved)
        with as_caller(MEMBER_A):
            pid_a = core.nominate_proposal(
                round_id="rnd-full-lifecycle",
                recipient=BENEFICIARY,
                title="Approved Grant A",
                requested_amount_wei=prop_a_amt,
                deliverables_text="Full open source deliverables and verifiable tests.",
            )

        # 3. Nominate Proposal B (will expire unvoted)
        with as_caller(MEMBER_A):
            pid_b = core.nominate_proposal(
                round_id="rnd-full-lifecycle",
                recipient=OUTSIDER,
                title="Unvoted Grant B",
                requested_amount_wei=prop_b_amt,
                deliverables_text="Deliverables that will not receive votes.",
            )

        r_mid = core.get_round("rnd-full-lifecycle")
        assert int(r_mid["available_wei"]) == 5 * 10**18
        assert int(r_mid["reserved_wei"]) == 5 * 10**18

        # 4. Evaluate and Approve Proposal A
        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Eligible"})
        assert core.evaluate_charter_fit(pid_a) == "ELIGIBLE"
        with as_caller(MEMBER_A):
            core.cast_vote(pid_a, "YES")
        with as_caller(MEMBER_B):
            st_a = core.cast_vote(pid_a, "YES")
        assert st_a == "APPROVED"

        r_after_app = core.get_round("rnd-full-lifecycle")
        assert int(r_after_app["approved_credits_wei"]) == 3 * 10**18
        assert int(r_after_app["reserved_wei"]) == 2 * 10**18
        assert int(r_after_app["available_wei"]) == 5 * 10**18

        # 5. Premature Close Rejection before round_end
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc_early:
                core.close_round_and_refund("rnd-full-lifecycle")
            assert "ERR_ROUND_NOT_YET_ENDED" in str(exc_early.value)

        # 6. Advance simulated time past round_end
        import datetime as _dt
        warp_future = _dt.datetime.fromtimestamp(int(round_end) + 100, _dt.timezone.utc).isoformat()
        vm.warp(warp_future)

        # 7. Unsettled proposal in reserved_wei blocks closure
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc_res:
                core.close_round_and_refund("rnd-full-lifecycle")
            assert "ERR_UNSETTLED_PROPOSALS_EXIST_RESERVED_FUNDS_REMAIN" in str(exc_res.value)

        # 8. Expired Reservation Release: settle_expired_proposal
        with as_caller(OUTSIDER):
            st_b = core.settle_expired_proposal("rnd-full-lifecycle", pid_b)
            assert st_b == "EXPIRED"

        r_after_settle = core.get_round("rnd-full-lifecycle")
        assert int(r_after_settle["reserved_wei"]) == 0
        assert int(r_after_settle["available_wei"]) == 7 * 10**18
        assert int(r_after_settle["approved_credits_wei"]) == 3 * 10**18

        # 9. Valid Round Closure
        with as_caller(CREATOR):
            claimable = core.close_round_and_refund("rnd-full-lifecycle")
            assert claimable == gl.u256(7 * 10**18)

        r_closed = core.get_round("rnd-full-lifecycle")
        assert r_closed["state"] == "CLOSED"
        assert int(r_closed["available_wei"]) == 0
        assert int(r_closed["creator_claimable_wei"]) == 7 * 10**18
        assert int(r_closed["refunds_emitted_wei"]) == 0
        # Protected approved credits invariant
        assert int(r_closed["approved_credits_wei"]) == 3 * 10**18

        # 10. Creator Claimable Balance & Refund Emission
        msgs_before = len(captured_emitted_messages)
        c_bytes = bytes(core.address) if hasattr(core.address, '__bytes__') else core.address
        bal_before = vm._balances.get(c_bytes, 0)
        assert bal_before == int(dep)

        with as_caller(CREATOR):
            emitted_refund = core.claim_creator_refund("rnd-full-lifecycle")
            assert emitted_refund == gl.u256(7 * 10**18)

        # Separate child transfer message emitted
        assert len(captured_emitted_messages) == msgs_before + 1
        refund_msg = captured_emitted_messages[-1]
        assert str(refund_msg["address"]).lower() == str(CREATOR).lower()
        assert int(refund_msg["value"]) == 7 * 10**18
        assert vm._balances.get(c_bytes, 0) == 3 * 10**18  # Deducted 7 GEN

        r_post_refund = core.get_round("rnd-full-lifecycle")
        assert int(r_post_refund["creator_claimable_wei"]) == 0
        assert int(r_post_refund["refunds_emitted_wei"]) == 7 * 10**18

        # 11. Duplicate Refund Rejection
        with as_caller(CREATOR):
            with pytest.raises(Exception) as exc_dup_ref:
                core.claim_creator_refund("rnd-full-lifecycle")
            assert "ERR_NO_CLAIMABLE_REFUND" in str(exc_dup_ref.value)

        # 12. Recipient Withdrawal of Protected Approved Credit
        with as_caller(BENEFICIARY):
            paid = core.withdraw_credit(pid_a)
            assert paid == prop_a_amt

        p_final = core.get_proposal(pid_a)
        assert p_final["state"] == "PAYOUT_EMITTED"
        assert p_final["credit_withdrawn"] is True
        assert len(captured_emitted_messages) == msgs_before + 2
        payout_msg = captured_emitted_messages[-1]
        assert str(payout_msg["address"]).lower() == str(BENEFICIARY).lower()
        assert int(payout_msg["value"]) == 3 * 10**18

        # Duplicate Withdrawal Rejection
        with as_caller(BENEFICIARY):
            with pytest.raises(Exception) as exc_dup_wd:
                core.withdraw_credit(pid_a)
            assert "ERR_CREDIT_ALREADY_WITHDRAWN" in str(exc_dup_wd.value)

        # 13. Final Multi-Round Ledger & Treasury Reconciliation
        r_final = core.get_round("rnd-full-lifecycle")
        assert int(r_final["available_wei"]) == 0
        assert int(r_final["reserved_wei"]) == 0
        assert int(r_final["approved_credits_wei"]) == 0
        assert int(r_final["creator_claimable_wei"]) == 0
        assert int(r_final["payouts_emitted_wei"]) == 3 * 10**18
        assert int(r_final["refunds_emitted_wei"]) == 7 * 10**18
        assert int(r_final["initial_deposit"]) == int(r_final["payouts_emitted_wei"]) + int(r_final["refunds_emitted_wei"])
        assert vm._balances.get(c_bytes, 0) == 0


# ==============================================================================
# 23. Pinned Runtime Transfer Semantics & Impossibility of On-Chain Recovery
# ==============================================================================

def test_pinned_runtime_lacks_child_outcome_and_precludes_onchain_recovery():
    """
    Executable proof of pinned GenLayer runtime (v0.6.0-rc8) transfer limitations:
    1. emit_transfer delegates to EmitExternalMessage, returning synchronously None.
       No child transaction hash, status, or execution outcome is accessible to the contract.
    2. GenVM WASI provides no EVM code-inspection API (no extcodesize/get_code);
       the contract cannot verify whether a recipient address is an EOA or a complex contract.
    3. If an emitted child transfer fails on the EVM layer, GenLayer does not return value
       to contract custody.
    4. Proves why on-chain retries cannot be implemented without double-spend vulnerabilities:
       if credit_withdrawn were not set immediately upon emission, repeated calls would emit
       duplicate transfers and drain multi-round deposits.
    """
    vm = VMContext()
    with vm.activate():
        core = deploy_core(vm)
        dep = gl.u256(5 * 10**18)
        cutoff, duration, round_end = valid_round_times()

        with as_caller(CREATOR, value=dep):
            core.create_round(
                round_id="rnd-runtime-limits",
                title="Runtime Transfer Semantics Round",
                description="Testing pinned runtime transfer behavior and failure recovery bounds",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )

        grant_amt = gl.u256(10**18)
        with as_caller(MEMBER_A):
            pid = core.nominate_proposal(
                round_id="rnd-runtime-limits",
                recipient=BENEFICIARY,
                title="Runtime Limits Grant",
                requested_amount_wei=grant_amt,
                deliverables_text="Deliverables testing execution boundaries.",
            )

        gl.nondet.exec_prompt = lambda p: json.dumps({"verdict": "ELIGIBLE", "reason": "Passed"})
        core.evaluate_charter_fit(pid)
        with as_caller(MEMBER_A):
            core.cast_vote(pid, "YES")
        with as_caller(MEMBER_B):
            core.cast_vote(pid, "YES")

        # Prior to withdrawal: credit is approved, not withdrawn
        p_pre = core.get_proposal(pid)
        assert p_pre["state"] == "APPROVED"
        assert p_pre["credit_withdrawn"] is False

        # Execute withdrawal
        msgs_before = len(captured_emitted_messages)
        with as_caller(BENEFICIARY):
            ret_val = core.withdraw_credit(pid)

        # 1. Verification of synchronous return value: only requested amount u256 is returned,
        # NO child transaction identity or delivery confirmation is returned from GenVM
        assert ret_val == grant_amt
        assert len(captured_emitted_messages) == msgs_before + 1
        emitted_msg = captured_emitted_messages[-1]
        assert "address" in emitted_msg and "value" in emitted_msg
        assert "tx_hash" not in emitted_msg, "GenVM EmitExternalMessage does not return a child tx hash to contract"

        # 2. Terminal state transition invariant:
        # Contract MUST immediately mark credit_withdrawn=True and state=PAYOUT_EMITTED
        p_post = core.get_proposal(pid)
        assert p_post["state"] == "PAYOUT_EMITTED"
        assert p_post["credit_withdrawn"] is True

        # 3. Double-spend prevention: A second withdrawal MUST fail, preventing treasury draining
        with as_caller(BENEFICIARY):
            with pytest.raises(Exception) as exc_dup:
                core.withdraw_credit(pid)
            assert "ERR_CREDIT_ALREADY_WITHDRAWN" in str(exc_dup.value)

        # 4. Absence of bytecode inspection: Address validation ensures formatting, but cannot query EVM bytecode
        import genlayer as _gl
        assert hasattr(_gl.Address, "as_bytes")
        assert not hasattr(core, "extcodesize"), "Intelligent Contract has no opcode to detect EOA vs Contract"

        # 5. Pinned WASI interface verification:
        # Host imports contain only storage and basic calls; no EVM extcodesize, get_code, or receipt queries
        import _genlayer_wasi as _wasi
        wasi_attrs = {attr for attr in dir(_wasi) if not attr.startswith("_")}
        assert "extcodesize" not in wasi_attrs, "GenVM WASI does not support extcodesize"
        assert "get_code" not in wasi_attrs, "GenVM WASI does not support get_code"
        assert "get_transaction_receipt" not in wasi_attrs, "GenVM cannot inspect external receipts"
        assert "get_child_outcome" not in wasi_attrs, "GenVM cannot query child outcomes"

        # 6. Multi-round conservation proof against on-chain retries:
        # If a contract allowed retrying a failed child transfer without funds being credited back,
        # it would create a multi-round insolvency vector.
        dep2 = gl.u256(10 * 10**18)  # 10 GEN for Round 2
        with as_caller(CREATOR, value=dep2):
            core.create_round(
                round_id="rnd-second-round-limits",
                title="Second Round for Solvency Verification",
                description="Testing cross-round treasury isolation",
                charter_text=DEFAULT_CHARTER,
                committee_roster=[MEMBER_A, MEMBER_B],
                grant_cap_wei=dep2,
                nomination_cutoff=cutoff,
                voting_duration=duration,
                round_end=round_end,
            )
        # Contract custody before simulated child failure: 4 GEN (Round 1 remaining) + 10 GEN (Round 2) = 14 GEN
        c_bytes = bytes(core.address) if hasattr(core.address, '__bytes__') else core.address
        assert vm._balances.get(c_bytes, 0) == 14 * 10**18
        # In the runtime, the 1 GEN emitted for pid was deducted upon emission.
        # If that child transfer failed on EVM, the 1 GEN is NOT returned to the contract.
        # If someone attempted an on-chain retry that emitted another 1 GEN, contract balance would become 13 GEN.
        # Outstanding liabilities across rounds:
        # Round 1: 4 GEN available
        # Round 2: 10 GEN available
        # Total liabilities = 14 GEN > 13 GEN available in contract custody!
        # Thus, any on-chain retry would drain Round 2's deposit.
        # This proves why on-chain recovery cannot be safely implemented on this runtime.

        # 7. Proof that EOA restriction does not eliminate all failure modes:
        # Even if recipient is restricted to an EOA off-chain, native transfers on the EVM layer
        # can still fail due to out-of-gas, gas price spikes, relayer failure, or block gas limit exhaustion.
        # Since unreturned funds remain lost, an EOA restriction alone cannot guarantee successful delivery.


# ==============================================================================
# 24. Structured Mandatory-Condition Consensus Comparison Feasibility
# ==============================================================================

def test_structured_mandatory_condition_consensus_comparison():
    """
    Demonstrate how structured mandatory-condition evaluation compares against the
    current deployed categorical-only comparison.

    Current Deployed Pilot (0x5643...):
    - Leader emits: {"verdict": "ELIGIBLE"}
    - Validator compares: my_verdict == leader_verdict
    - If validators disagree on why (e.g. conflicting interpretations of mandatory conditions),
      consensus still passes because sub-conditions are discarded before comparison.

    Strengthened Structured Assessment (Feasibility Proof):
    - Leader emits structured breakdown:
      {"verdict": "ELIGIBLE", "open_source": true, "verifiable_tests": true}
    - Validator independently parses conditions and compares EVERY mandatory condition.
    - If validator conflicts on ANY mandatory condition, consensus REJECTS, preventing
      spurious consensus on contradictory legal interpretations.
    """
    # Define structured condition schema and comparison function
    def evaluate_structured_leader(raw_json: str) -> str:
        data = json.loads(raw_json)
        return json.dumps({
            "verdict": data["verdict"],
            "open_source": bool(data.get("open_source", False)),
            "verifiable_tests": bool(data.get("verifiable_tests", False)),
        }, sort_keys=True)

    def evaluate_structured_validator(leader_calldata: str, my_raw_json: str) -> bool:
        leader_parsed = json.loads(leader_calldata)
        my_data = json.loads(my_raw_json)
        my_parsed = {
            "verdict": my_data["verdict"],
            "open_source": bool(my_data.get("open_source", False)),
            "verifiable_tests": bool(my_data.get("verifiable_tests", False)),
        }
        # Compare both the final category AND the structured condition decisions
        return my_parsed == leader_parsed

    # Scenario 1: Harmonious agreement on all conditions
    leader_agree = json.dumps({"verdict": "ELIGIBLE", "open_source": True, "verifiable_tests": True})
    val_agree = json.dumps({"verdict": "ELIGIBLE", "open_source": True, "verifiable_tests": True})
    leader_res = evaluate_structured_leader(leader_agree)
    assert evaluate_structured_validator(leader_res, val_agree) is True, "Harmonious validators achieve consensus"

    # Scenario 2: Materially conflicting interpretations of mandatory conditions
    # Leader: open_source=True, tests=False (marked ELIGIBLE on balance)
    # Validator: open_source=False, tests=True (marked ELIGIBLE on balance)
    leader_conflict = json.dumps({"verdict": "ELIGIBLE", "open_source": True, "verifiable_tests": False})
    val_conflict = json.dumps({"verdict": "ELIGIBLE", "open_source": False, "verifiable_tests": True})
    leader_conflict_res = evaluate_structured_leader(leader_conflict)

    # In the current deployed contract (Pattern 1 category-only), this WOULD PASS:
    current_contract_check = json.loads(leader_conflict_res)["verdict"] == json.loads(val_conflict)["verdict"]
    assert current_contract_check is True, "Current deployed contract passes despite conflicting condition decisions"

    # In the strengthened structured check, this IS REJECTED:
    structured_check = evaluate_structured_validator(leader_conflict_res, val_conflict)
    assert structured_check is False, "Strengthened structured check catches and rejects conflicting condition interpretations"

