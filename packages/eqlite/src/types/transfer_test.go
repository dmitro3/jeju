
package types

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
)

func TestTxTransfer(t *testing.T) {
	Convey("test transfer", t, func() {
		h, err := hash.NewHashFromStr("000005aa62048f85da4ae9698ed59c14ec0d48a88a07c15a32265634e7e64ade")
		So(err, ShouldBeNil)
		addr := proto.AccountAddress(*h)

		t := NewTransfer(&TransferHeader{
			Sender: addr,
			Nonce:  1,
		})
		So(t.GetAccountAddress(), ShouldEqual, addr)
		So(t.GetAccountNonce(), ShouldEqual, 1)

		priv, _, err := asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		So(t.Sign(priv), ShouldBeNil)
		So(t.Verify(), ShouldBeNil)
	})
}
