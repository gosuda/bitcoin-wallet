package types

import "github.com/btcsuite/btcd/txscript"

func ParseScriptType(script []byte) txscript.ScriptClass {
	return txscript.GetScriptClass(script)
}
