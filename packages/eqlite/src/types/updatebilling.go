

package types

import (
	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/verifier"
	"eqlite/src/proto"
)

//go:generate hsp

// Range defines a height range (from, to].
type Range struct {
	From, To uint32
}

// MinerIncome defines the income of miner.
type MinerIncome struct {
	Miner  proto.AccountAddress
	Income uint64
}

// UserCost defines the cost of user.
type UserCost struct {
	User   proto.AccountAddress
	Cost   uint64
	Miners []*MinerIncome
}

// UpdateBillingHeader defines the UpdateBilling transaction header.
type UpdateBillingHeader struct {
	Receiver proto.AccountAddress
	Nonce    pi.AccountNonce
	Users    []*UserCost
	Range    Range
	Version  int32 `hsp:"v,version"`
}

// UpdateBilling defines the UpdateBilling transaction.
type UpdateBilling struct {
	UpdateBillingHeader
	pi.TransactionTypeMixin
	verifier.DefaultHashSignVerifierImpl
}

// NewUpdateBilling returns new instance.
func NewUpdateBilling(header *UpdateBillingHeader) *UpdateBilling {
	return &UpdateBilling{
		UpdateBillingHeader:  *header,
		TransactionTypeMixin: *pi.NewTransactionTypeMixin(pi.TransactionTypeUpdateBilling),
	}
}

// GetAccountAddress implements interfaces/Transaction.GetAccountAddress.
func (ub *UpdateBilling) GetAccountAddress() proto.AccountAddress {
	addr, _ := crypto.PubKeyHash(ub.Signee)
	return addr
}

// GetAccountNonce implements interfaces/Transaction.GetAccountNonce.
func (ub *UpdateBilling) GetAccountNonce() pi.AccountNonce {
	return ub.Nonce
}

// Sign implements interfaces/Transaction.Sign.
func (ub *UpdateBilling) Sign(signer *asymmetric.PrivateKey) (err error) {
	return ub.DefaultHashSignVerifierImpl.Sign(&ub.UpdateBillingHeader, signer)
}

// Verify implements interfaces/Transaction.Verify.
func (ub *UpdateBilling) Verify() (err error) {
	return ub.DefaultHashSignVerifierImpl.Verify(&ub.UpdateBillingHeader)
}

func init() {
	pi.RegisterTransaction(pi.TransactionTypeUpdateBilling, (*UpdateBilling)(nil))
}
