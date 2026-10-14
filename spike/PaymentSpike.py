# { "Depends": "py-genlayer:test" }
import genlayer as gl
from genlayer import *

@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass

class PaymentSpike(gl.contract.Contract):
    owner: Address
    authorized_recipient: Address
    entitled_amount: u256
    paid: bool

    def __init__(self, recipient: str):
        self.owner = gl.message.sender_address
        self.authorized_recipient = Address(recipient)
        self.entitled_amount = u256(0)
        self.paid = False

    @gl.public.write.payable
    def deposit(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("Only owner can deposit")
        v = gl.message.value
        if v == u256(0):
            raise gl.vm.UserError("Must send positive value")
        self.entitled_amount = self.entitled_amount + v

    @gl.public.write
    def payout(self) -> None:
        if gl.message.sender_address != self.authorized_recipient:
            raise gl.vm.UserError("Unauthorized recipient")
        if self.paid:
            raise gl.vm.UserError("Already paid")
        amount = self.entitled_amount
        if amount == u256(0):
            raise gl.vm.UserError("Zero entitlement")
        if self.balance < amount:
            raise gl.vm.UserError("Insufficient contract balance")

        # Checks-Effects-Interactions
        self.entitled_amount = u256(0)
        self.paid = True

        _Recipient(self.authorized_recipient).emit_transfer(value=amount)

    @gl.public.view
    def get_state(self) -> dict:
        return {
            "owner": str(self.owner),
            "authorized_recipient": str(self.authorized_recipient),
            "entitled_amount": str(self.entitled_amount),
            "paid": self.paid,
            "balance": str(self.balance),
        }
