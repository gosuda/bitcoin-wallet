package script

import "github.com/btcsuite/btcd/txscript"

func OpReturnScript(data []byte) (pkScript []byte, err error) {
	return txscript.NullDataScript(data)
}

func RuneStoneScript(data []byte) (pkScript []byte, err error) {
	return txscript.NewScriptBuilder().
		AddOp(txscript.OP_RETURN). // OP_RETURN
		AddOp(txscript.OP_13).     // Runestone Magic Number
		AddData(data).
		Script()
}
