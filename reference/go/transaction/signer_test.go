package transaction

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gosuda/btctxbuilder/client"
	"github.com/gosuda/btctxbuilder/types"
	"github.com/gosuda/btctxbuilder/utils"
)

func TestSignPsbtTx(t *testing.T) {
	net := types.BTC_Testnet3
	params := types.GetParams(net)

	c, err := client.NewClient(net)
	require.NoError(t, err)
	tx, err := c.GetRawTx("0b2c23f5c2e6326c90cfa1d3925b0d83f4b08035ca6af8fd8f606385dfbc5822")
	require.NoError(t, err)
	msgTx, err := types.DecodeRawTransaction(tx)
	require.NoError(t, err)

	txBuild := NewTxBuilder(params)
	txBuild.Inputs.AddInput(params, msgTx, 1, 0, "mvNnCR7EJS4aUReLEw2sL2ZtTZh8CAP8Gp")
	txBuild.Outputs.AddOutputTransfer(c.GetParams(), "mvNnCR7EJS4aUReLEw2sL2ZtTZh8CAP8Gp", 53000)
	txBuild.Outputs.AddOutputTransfer(c.GetParams(), "mvNnCR7EJS4aUReLEw2sL2ZtTZh8CAP8Gp", 10000)
	build := txBuild.Build()
	require.NoError(t, build.Err())
	packet, err := build.Packet()
	require.NoError(t, err)

	signer, err := types.NewECDSASigner("1790962db820729606cd7b255ace1ac5ebb129ac8e9b2d8534d022194ab25b37")
	require.NoError(t, err)
	signedPacket, err := SignTx(c.GetParams(), packet, signer.Sign, signer.PubKey())
	require.NoError(t, err)
	rawTx, err := types.EncodePsbtToRawTx(signedPacket)
	require.NoError(t, err)
	rawTxString := utils.HexEncode(rawTx)
	assert.Equal(t, "01000000012258bcdf8563608ffdf86aca3580b0f4830d5b92d3a1cf906c32e6c2f5232c0b010000006b483045022068645e39a0d12590c2128af094c244bea6efab786fe13127c4101247c028458f022100d2b4c8317104e9d40d0e5cdef6058a3b6239460aaca30821ba7f4d6beba0d1f40121031053e9ef0295d334b6bb22e20cc717eb1a16a546f692572c8830b4bc14c13676ffffffff0208cf0000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac10270000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac00000000", rawTxString)

	rawTxMake, err := types.DecodeRawTransaction(rawTxString)
	require.NoError(t, err)
	rawTxInput, err := types.DecodeRawTransaction("01000000012258bcdf8563608ffdf86aca3580b0f4830d5b92d3a1cf906c32e6c2f5232c0b010000006a47304402206bdac667fb3d6f1a62e0b0d1123a5caa58d8c0fd95c2a2c8cd091374960a871702204f301e6883866570ce309573e569d6a32a44386af5bf928b5f9e1dcd7e2dd0ed0121022bc0ca1d6aea1c1e523bfcb33f46131bd1a3240aa04f71c34b1a177cfd5ff933ffffffff0208cf0000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac10270000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac00000000")
	require.NoError(t, err)

	for i, v := range rawTxMake.TxIn {
		fmt.Println("vin", i)
		fmt.Println("\t", v.PreviousOutPoint)
		fmt.Println("\t", v.SignatureScript)
		fmt.Println("\t", v.Witness)
		fmt.Println("\t", v.Sequence)
	}

	for i, v := range rawTxInput.TxIn {
		fmt.Println("vin", i)
		fmt.Println("\t", v.PreviousOutPoint)
		fmt.Println("\t", v.SignatureScript)
		fmt.Println("\t", v.Witness)
		fmt.Println("\t", v.Sequence)
	}

	// pub, err := secp256k1.ParsePubKey(utils.MustDecode("022bc0ca1d6aea1c1e523bfcb33f46131bd1a3240aa04f71c34b1a177cfd5ff933"))
	// require.NoError(t, err)
	// valid, err := VerifyTx(c.GetParams(), signedPacket, pub)
	// require.NoError(t, err)
	// fmt.Println(valid)

}

// 01000000012258bcdf8563608ffdf86aca3580b0f4830d5b92d3a1cf906c32e6c2f5232c0b010000006a47304402206bdac667fb3d6f1a62e0b0d1123a5caa58d8c0fd95c2a2c8cd091374960a871702204f301e6883866570ce309573e569d6a32a44386af5bf928b5f9e1dcd7e2dd0ed0121022bc0ca1d6aea1c1e523bfcb33f46131bd1a3240aa04f71c34b1a177cfd5ff933ffffffff0208cf0000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac10270000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac00000000
// 01000000012258bcdf8563608ffdf86aca3580b0f4830d5b92d3a1cf906c32e6c2f5232c0b010000006a47304402206bdac667fb3d6f1a62e0b0d1123a5caa58d8c0fd95c2a2c8cd091374960a871702204f301e6883866570ce309573e569d6a32a44386af5bf928b5f9e1dcd7e2dd0ed0121031053e9ef0295d334b6bb22e20cc717eb1a16a546f692572c8830b4bc14c13676ffffffff0208cf0000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac10270000000000001976a914a2fe215e4789e607401a4bf85358cbbfae13a97e88ac00000000

// vin 0
// 	 0b2c23f5c2e6326c90cfa1d3925b0d83f4b08035ca6af8fd8f606385dfbc5822:1
// 	 [71 48 68 2 32 107 218 198 103 251 61 111 26 98 224 176 209 18 58 92 170 88 216 192 253 149 194 162 200 205 9 19 116 150 10 135 23 2 32 79 48 30 104 131 134 101 112 206 48 149 115 229 105 214 163 42 68 56 106 245 191 146 139 95 158 29 205 126 45 208 237 1 65 4 16 83 233 239 2 149 211 52 182 187 34 226 12 199 23 235 26 22 165 70 246 146 87 44 136 48 180 188 20 193 54 118 94 30 26 75 241 121 55 219 129 223 58 155 133 221 181 96 189 77 12 227 70 92 86 148 113 140 214 241 171 102 242 39]
// 	 []
// 	 4294967295
// vin 0
// 	 0b2c23f5c2e6326c90cfa1d3925b0d83f4b08035ca6af8fd8f606385dfbc5822:1
// 	 [71 48 68 2 32 107 218 198 103 251 61 111 26 98 224 176 209 18 58 92 170 88 216 192 253 149 194 162 200 205 9 19 116 150 10 135 23 2 32 79 48 30 104 131 134 101 112 206 48 149 115 229 105 214 163 42 68 56 106 245 191 146 139 95 158 29 205 126 45 208 237 1 33 2 43 192 202 29 106 234 28 30 82 59 252 179 63 70 19 27 209 163 36 10 160 79 113 195 75 26 23 124 253 95 249 51]
// 	 []
// 	 4294967295
