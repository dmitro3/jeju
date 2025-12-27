
package types

//go:generate hsp

// TokenType is deprecated. All token operations are now handled by Ethereum contracts.
// This type is kept for backwards compatibility during migration.
type TokenType int32

const (
	// Ether represents ETH/JEJU tokens handled by smart contracts.
	// This is the only supported token type.
	Ether TokenType = 0
)

// String returns the token name.
func (t TokenType) String() string {
	return "Ether"
}

// FromString returns the token type from string.
// Always returns Ether as it's the only supported type.
func FromString(t string) TokenType {
	return Ether
}

// Listed returns true as Ether is always supported.
func (t *TokenType) Listed() bool {
	return true
}
