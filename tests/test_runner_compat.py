"""Pinned py-genlayer compatibility and leader/validator execution.

The contract Depends header pins py-genlayer 5jycge4q…, whose stdlib is
py-lib-genlayer-std kzr02ndm…. That stdlib has run_nondet and
run_nondet_default. It does not have run_nondet_unsafe.

These tests load that stdlib. They do not assign run_nondet_unsafe.
Direct-mode wasi_mock skips the validator; the evaluate test replaces only
that host so the real gl.vm.run_nondet runs both cloudpickled functions.
This process is CPython plus the pinned SDK. It is not a WASM GenVM executor
and it does not call Studio Next.
"""

import ast
import importlib
import inspect
import io
import json
import sys
import tokenize
from pathlib import Path

import pytest

WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

CONTRACT_PATH = WORKSPACE_ROOT / "contracts" / "CharterFlowCore.py"
SERVED_PATH = WORKSPACE_ROOT / "frontend" / "public" / "CharterFlowCore.py"
PINNED_RUNNER = "5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng"
PINNED_STD = "kzr02ndm9et4qkmbqpq5djjt5sme2yt76n7sz1qbzax0knt6mam0"
STDLIB_NAMES = {"Address", "u256", "u64", "u32"}

import tests.gltest_patch  # noqa: F401
from gltest.direct.sdk_loader import setup_sdk_paths

def _pin_contract_std_before_genlayer_import() -> None:
    """Import genlayer from the contract Depends std, not the cache's latest std."""
    setup_sdk_paths(contract_path=CONTRACT_PATH, version="v0.6.0-rc8")
    pinned = next((path for path in sys.path if PINNED_STD in str(path)), None)
    if pinned is None:
        raise RuntimeError(f"pinned std {PINNED_STD} was not added to sys.path")
    sys.path.insert(0, pinned)
    # Direct-mode wasi is not the GenVM. The pinned std treats a wasi module
    # without FAKE_VM as an in-VM boot and then reads calldata from stdin.
    wasi = sys.modules.get("_genlayer_wasi")
    if wasi is None:
        from gltest.direct import wasi_mock
        sys.modules["_genlayer_wasi"] = wasi_mock
        wasi = wasi_mock
    if not getattr(wasi, "FAKE_VM", False):
        setattr(wasi, "FAKE_VM", True)
    for name in list(sys.modules):
        if name == "genlayer" or name.startswith("genlayer."):
            del sys.modules[name]
    import genlayer as gl

    vm_file = Path(gl.vm.__file__).resolve().as_posix()
    if PINNED_STD not in vm_file:
        raise RuntimeError(f"genlayer.vm loaded from {vm_file}")


_pin_contract_std_before_genlayer_import()

from gltest.direct import wasi_mock
from gltest.direct.vm import VMContext

import tests.test_charterflow_core as direct_tests
from tests.test_charterflow_core import (
    BENEFICIARY,
    CREATOR,
    DEFAULT_CHARTER,
    MEMBER_A,
    MEMBER_B,
    _direct_run_nondet_hook,
    as_caller,
    deploy_core,
    valid_round_times,
)


def _pinned_std_dir() -> Path:
    added = setup_sdk_paths(contract_path=CONTRACT_PATH, version="v0.6.0-rc8")
    candidates = [Path(path) for path in [*added, *sys.path]]
    for path in candidates:
        if PINNED_STD in str(path):
            sys.path.insert(0, str(path))
            return path
    raise AssertionError(
        f"contract Depends did not resolve pinned std {PINNED_STD}"
    )


def _reload_pinned_vm():
    wasi = sys.modules.get("_genlayer_wasi")
    if wasi is None:
        from gltest.direct import wasi_mock
        sys.modules["_genlayer_wasi"] = wasi_mock
        wasi = wasi_mock
    if not getattr(wasi, "FAKE_VM", False):
        setattr(wasi, "FAKE_VM", True)
    std_dir = _pinned_std_dir()
    import genlayer as gl
    import genlayer.vm as vm_mod

    importlib.reload(vm_mod)
    gl.vm = vm_mod
    vm_file = Path(vm_mod.__file__).resolve()
    assert vm_file.is_relative_to(std_dir.resolve())
    assert vm_mod.run_nondet is not _direct_run_nondet_hook
    assert not hasattr(vm_mod, "run_nondet_unsafe")
    return gl, vm_mod


def _attribute_chain(node: ast.AST):
    parts = []
    current = node
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if isinstance(current, ast.Name):
        parts.append(current.id)
        return tuple(reversed(parts))
    return None


def _gl_chains(tree: ast.AST):
    chains = set()

    class Visitor(ast.NodeVisitor):
        def visit_Attribute(self, node: ast.Attribute):
            chain = _attribute_chain(node)
            if chain and chain[0] == "gl":
                chains.add(chain)
            self.generic_visit(node)

    Visitor().visit(tree)
    return chains


def _resolve(root, chain):
    current = root
    walked = []
    for name in chain:
        walked.append(name)
        if not hasattr(current, name):
            raise AssertionError(f"pinned runner has no {'.'.join(walked)}")
        current = getattr(current, name)
    return current


def _code_without_comments(source: str) -> str:
    tokens = []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type == tokenize.COMMENT:
            continue
        tokens.append(token)
    return tokenize.untokenize(tokens)


def _assigned_attribute_names(tree: ast.AST):
    names = set()

    class Visitor(ast.NodeVisitor):
        def visit_Assign(self, node: ast.Assign):
            for target in node.targets:
                chain = _attribute_chain(target)
                if chain:
                    names.add(chain[-1])
            self.generic_visit(node)

        def visit_AnnAssign(self, node: ast.AnnAssign):
            chain = _attribute_chain(node.target)
            if chain:
                names.add(chain[-1])
            self.generic_visit(node)

    Visitor().visit(tree)
    return names


class DualNondetHost:
    """Run the leader and the validator that real run_nondet cloudpickles.

    wasi_mock._handle_run_nondet runs only the leader. This host keeps the
    SDK's ResultCode prefix and rejects any validator result other than True,
    which is the Disagree path that must not commit later storage writes.
    """

    def __init__(self):
        self.leader_runs = 0
        self.validator_runs = 0
        self.agreements = []

    def __call__(self, vm, data):
        import cloudpickle
        from genlayer import calldata
        from genlayer.vm.public_abi import ResultCode

        leader_blob = data.get("data_leader")
        validator_blob = data.get("data_validator")
        if not leader_blob or not validator_blob:
            raise AssertionError("RunNondet payload is missing leader or validator bytes")
        leader_fn = cloudpickle.loads(leader_blob)
        validator_fn = cloudpickle.loads(validator_blob)
        vm._in_nondet = True
        try:
            self.leader_runs += 1
            leader_value = leader_fn(None)
            encoded = bytes([int(ResultCode.RETURN)]) + calldata.encode(leader_value)
            self.validator_runs += 1
            agreed = validator_fn({"leader_result": encoded})
            self.agreements.append(agreed)
            if agreed is not True:
                raise RuntimeError("NONDET_DISAGREE")
            return encoded
        finally:
            vm._in_nondet = False


def test_pinned_runner_exposes_every_production_api_and_not_run_nondet_unsafe():
    contract_bytes = CONTRACT_PATH.read_bytes()
    assert SERVED_PATH.read_bytes() == contract_bytes
    source = contract_bytes.decode("utf-8")
    assert f"py-genlayer:{PINNED_RUNNER}" in source.splitlines()[0]

    code = _code_without_comments(source)
    assert "run_nondet_unsafe" not in code
    assert "run_nondet_default(" not in code

    tree = ast.parse(source)
    gl, vm_mod = _reload_pinned_vm()
    for chain in sorted(_gl_chains(tree)):
        _resolve(gl, chain[1:])

    import genlayer.storage as storage

    for name in ("DynArray", "TreeMap", "allow"):
        assert hasattr(storage, name)
    for name in STDLIB_NAMES:
        assert hasattr(gl, name)
    assert hasattr(gl.contract.Contract, "balance")
    assert hasattr(gl.evm.generate.ContractProxy, "emit_transfer")

    direct_tree = ast.parse((WORKSPACE_ROOT / "tests" / "test_charterflow_core.py").read_text(encoding="utf-8"))
    assert "run_nondet_unsafe" not in _assigned_attribute_names(direct_tree)

    signature = inspect.signature(vm_mod.run_nondet.lazy)
    params = list(signature.parameters.values())
    assert [item.name for item in params[:2]] == ["leader_fn", "validator_fn"]
    assert all(item.kind is inspect.Parameter.POSITIONAL_ONLY for item in params[:2])
    assert "compare_user_errors" not in signature.parameters

    default_signature = inspect.signature(vm_mod.run_nondet_default.lazy)
    assert "compare_user_errors" in default_signature.parameters
    assert "compare_vm_errors" in default_signature.parameters
    default_source = inspect.getsource(vm_mod.run_nondet_default.lazy)
    assert "spawn_sandbox" in default_source
    assert "compare_user_errors" in default_source
    assert "compare_vm_errors" in default_source


def test_pinned_vm_source_defines_run_nondet_and_not_run_nondet_unsafe():
    _gl, vm_mod = _reload_pinned_vm()
    source = Path(vm_mod.__file__).read_text(encoding="utf-8")
    assert "def run_nondet" in source
    assert "def run_nondet_unsafe" not in source
    assert "run_nondet_unsafe" not in vm_mod.__all__


def _scripted_prompt(queue, seen):
    def exec_prompt(prompt, *_args, **_kwargs):
        seen.append(prompt)
        if not queue:
            raise AssertionError("exec_prompt called more times than scripted")
        return queue.pop(0)

    return exec_prompt


def _ledger(core, round_id):
    row = core.get_round(round_id)
    return int(row["reserved_wei"]), int(row["available_wei"])


def test_evaluate_charter_fit_runs_leader_and_validator_on_pinned_run_nondet():
    import genlayer as gl

    _reload_pinned_vm()
    host = DualNondetHost()
    previous_host = wasi_mock._handle_run_nondet
    previous_prompt = gl.nondet.exec_prompt
    wasi_mock._handle_run_nondet = host
    try:
        vm = VMContext()
        with vm.activate():
            vm.warp("2026-10-16T12:00:00")
            core = deploy_core(vm, install_nondet_hook=False)
            assert gl.vm.run_nondet is not _direct_run_nondet_hook
            assert gl.vm.run_nondet.lazy.__module__ == "genlayer.vm"

            deposit = gl.u256(10 * 10**18)
            amount = gl.u256(10**18)
            cutoff, duration, round_end = valid_round_times()
            with as_caller(CREATOR, value=deposit):
                core.create_round(
                    round_id="rnd-nondet",
                    title="Pinned Nondet Round",
                    description="Leader and validator execution",
                    charter_text=DEFAULT_CHARTER,
                    committee_roster=[MEMBER_A, MEMBER_B],
                    grant_cap_wei=deposit,
                    nomination_cutoff=cutoff,
                    voting_duration=duration,
                    round_end=round_end,
                )

            def nominate(title):
                with as_caller(MEMBER_A):
                    return core.nominate_proposal(
                        "rnd-nondet",
                        BENEFICIARY,
                        title,
                        amount,
                        "Open source deliverable with tests and documentation.",
                    )

            def evaluate(proposal_id, outputs):
                seen = []
                queue = list(outputs)
                before_leaders = host.leader_runs
                before_validators = host.validator_runs
                gl.nondet.exec_prompt = _scripted_prompt(queue, seen)
                result = core.evaluate_charter_fit(proposal_id)
                assert host.leader_runs == before_leaders + 1
                assert host.validator_runs == before_validators + 1
                assert len(seen) == 2
                assert seen[0] == seen[1]
                assert queue == []
                return result

            eligible_id = nominate("Eligible open source work")
            reserved, available = _ledger(core, "rnd-nondet")
            assert (reserved, available) == (10**18, 9 * 10**18)
            state = evaluate(
                eligible_id,
                [
                    json.dumps({"verdict": "ELIGIBLE", "reason": "leader text is discarded"}),
                    json.dumps({"verdict": "ELIGIBLE", "reason": "validator text differs and is discarded"}),
                ],
            )
            assert state == "ELIGIBLE"
            proposal = core.get_proposal(eligible_id)
            assert proposal["review_verdict"] == "ELIGIBLE"
            assert proposal["review_reason"] == (
                "VALIDATOR_AGREED_VERDICT_ELIGIBLE; SEMANTIC_RATIONALE_NOT_VERIFIED"
            )
            assert proposal["voting_deadline"] == proposal["submission_timestamp"] + int(duration)
            assert _ledger(core, "rnd-nondet") == (10**18, 9 * 10**18)

            ineligible_id = nominate("Ineligible closed source work")
            assert _ledger(core, "rnd-nondet") == (2 * 10**18, 8 * 10**18)
            state = evaluate(
                ineligible_id,
                [
                    json.dumps({"verdict": "INELIGIBLE", "reason": "no source"}),
                    json.dumps({"verdict": "INELIGIBLE", "reason": "different wording"}),
                ],
            )
            assert state == "INELIGIBLE"
            assert core.get_proposal(ineligible_id)["review_reason"] == (
                "VALIDATOR_AGREED_VERDICT_INELIGIBLE; SEMANTIC_RATIONALE_NOT_VERIFIED"
            )
            assert _ledger(core, "rnd-nondet") == (10**18, 9 * 10**18)

            malformed_id = nominate("Malformed model output work")
            state = evaluate(
                malformed_id,
                [
                    "not json and not a verdict",
                    "still not json",
                ],
            )
            assert state == "NEEDS_CLARITY"
            assert core.get_proposal(malformed_id)["review_verdict"] == "NEEDS_CLARITY"
            assert core.get_proposal(malformed_id)["review_reason"] == (
                "VALIDATOR_AGREED_VERDICT_NEEDS_CLARITY; SEMANTIC_RATIONALE_NOT_VERIFIED"
            )
            assert _ledger(core, "rnd-nondet") == (10**18, 9 * 10**18)

            disagree_id = nominate("Validator disagreement work")
            assert _ledger(core, "rnd-nondet") == (2 * 10**18, 8 * 10**18)
            seen = []
            gl.nondet.exec_prompt = _scripted_prompt(
                [
                    json.dumps({"verdict": "ELIGIBLE", "reason": "leader"}),
                    json.dumps({"verdict": "INELIGIBLE", "reason": "validator"}),
                ],
                seen,
            )
            before_leaders = host.leader_runs
            before_validators = host.validator_runs
            with pytest.raises(RuntimeError, match="NONDET_DISAGREE"):
                core.evaluate_charter_fit(disagree_id)
            assert host.leader_runs == before_leaders + 1
            assert host.validator_runs == before_validators + 1
            assert host.agreements[-1] is False
            assert len(seen) == 2
            disagreed = core.get_proposal(disagree_id)
            assert disagreed["state"] == "SUBMITTED"
            assert disagreed["review_verdict"] == "PENDING"
            assert disagreed["review_reason"] == ""
            assert disagreed["voting_deadline"] == 0
            assert _ledger(core, "rnd-nondet") == (2 * 10**18, 8 * 10**18)
    finally:
        wasi_mock._handle_run_nondet = previous_host
        gl.nondet.exec_prompt = previous_prompt
        direct_tests.gl.vm.run_nondet = _direct_run_nondet_hook
        direct_tests.gl.vm.run_nondet_default = _direct_run_nondet_hook
