
package types

import (
	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

//go:generate hsp

// TransferHeader defines the transfer transaction header.
// Deprecated: Token transfers are now handled by the EQLiteRegistry smart contract.
// This type is kept for backwards compatibility.
type TransferHeader struct {
	Sender, Receiver proto.AccountAddress
	Nonce            pi.AccountNonce
	Amount           uint64
}

// Transfer defines the transfer transaction.
// Deprecated: Token transfers are now handled by the EQLiteRegistry smart contract.
type Transfer struct {
	TransferHeader
	pi.TransactionTypeMixin
	verifier.DefaultHashSignVerifierImpl
}

// NewTransfer returns new instance.
// Deprecated: Use EQLiteRegistry contract for token transfers.
func NewTransfer(header *TransferHeader) *Transfer {
	return &Transfer{
		TransferHeader:       *header,
		TransactionTypeMixin: *pi.NewTransactionTypeMixin(pi.TransactionTypeTransfer),
	}
}

// GetAccountAddress implements interfaces/Transaction.GetAccountAddress.
func (t *Transfer) GetAccountAddress() proto.AccountAddress {
	return t.Sender
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (t *Transfer) GetAccountNonce() pi.AccountNonce {
	return t.Nonce
}

// Sign implements interfaces/Transaction.Sign.
func (t *Transfer) Sign(signer *asymmetric.PrivateKey) (err error) {
	return t.DefaultHashSignVerifierImpl.Sign(&t.TransferHeader, signer)
}

// Verify implements interfaces/Transaction.Verify.
func (t *Transfer) Verify() (err error) {
	return t.DefaultHashSignVerifierImpl.Verify(&t.TransferHeader)
}

func init() {
	pi.RegisterTransaction(pi.TransactionTypeTransfer, (*Transfer)(nil))
}
