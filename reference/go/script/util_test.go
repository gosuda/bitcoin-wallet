package script

import (
	"testing"

	"github.com/btcsuite/btcd/txscript"
	"github.com/stretchr/testify/require"
)

func TestEncodeInt(t *testing.T) {
	for _, test := range []struct {
		nums []int64
	}{
		{[]int64{0, 1, 2, 3, 4, 5, 6, 7, 8}},
		{[]int64{2<<7 - 1, 2 << 7, 2<<7 + 1}},
		{[]int64{2<<15 - 1, 2 << 15, 2<<15 + 1}},
		{[]int64{2<<23 - 1, 2 << 23, 2<<23 + 1}},
		{[]int64{2<<31 - 1, 2 << 31, 2<<31 + 1}},
	} {
		builder := txscript.NewScriptBuilder()
		for _, num := range test.nums {
			builder.AddInt64(num)
		}
		script, err := builder.Script()
		require.NoError(t, err)

		tokenizer := txscript.MakeScriptTokenizer(0, script)
		idx := 0
		for tokenizer.Next() {
			opcode := tokenizer.Opcode()
			data := tokenizer.Data()
			numRecover, _, err := DecodeInt64(opcode, data)
			require.NoError(t, err)

			require.Equal(t, numRecover, test.nums[idx])
			idx++
		}
	}
}
