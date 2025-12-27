
package interfaces

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestTypes(t *testing.T) {
	Convey("Transaction types should be consistent to convert to/from bytes", t, func() {
		for tt := TransactionType(0); tt < TransactionTypeNumber; tt++ {
			So(tt, ShouldEqual, FromBytes(tt.Bytes()))
		}
	})
	Convey("Transaction types should be hash stable", t, func() {
		var (
			h1, h2 []byte
			err    error
		)
		for tt := TransactionType(0); tt < TransactionTypeNumber; tt++ {
			h1, err = tt.MarshalHash()
			So(err, ShouldBeNil)
			h2, err = tt.MarshalHash()
			So(err, ShouldBeNil)
			So(h1, ShouldResemble, h2)
		}
	})
	Convey("Nonce should be hash stable", t, func() {
		var (
			h1, h2 []byte
			err    error
		)
		for n := AccountNonce(0); n < AccountNonce(10); n++ {
			h1, err = n.MarshalHash()
			So(err, ShouldBeNil)
			h2, err = n.MarshalHash()
			So(err, ShouldBeNil)
			So(h1, ShouldResemble, h2)
		}
	})
	Convey("test string", t, func() {
		for i := TransactionTypeTransfer; i != TransactionTypeNumber+1; i++ {
			So(i.String(), ShouldNotBeEmpty)
		}
	})
}
