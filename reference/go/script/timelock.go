package script

import (
	"errors"

	"github.com/btcsuite/btcd/txscript"
)

func EncodeTimeLockScript(lockTime int64, redeemScript []byte) ([]byte, error) {
	builder := txscript.NewScriptBuilder()
	builder.AddInt64(lockTime)
	builder.AddOp(txscript.OP_CHECKLOCKTIMEVERIFY)
	builder.AddOp(txscript.OP_DROP)
	builder.AddFullData(redeemScript)

	return builder.Script()
}

func DecodeTimelockScript(timelockScript []byte) (int64, []byte, error) {
	tokenizer := txscript.MakeScriptTokenizer(0, timelockScript)

	// Step 1: Parse the locktime
	if !tokenizer.Next() {
		return 0, nil, errors.New("failed to parse locktime")
	}
	lockTimeOpcode := tokenizer.Opcode()
	if lockTimeOpcode < txscript.OP_1 || lockTimeOpcode > txscript.OP_16 {
		return 0, nil, errors.New("invalid locktime opcode")
	}
	lockTime := int64(txscript.AsSmallInt(lockTimeOpcode))

	// Step 2: Check OP_CHECKLOCKTIMEVERIFY
	if !tokenizer.Next() || tokenizer.Opcode() != txscript.OP_CHECKLOCKTIMEVERIFY {
		return 0, nil, errors.New("missing OP_CHECKLOCKTIMEVERIFY")
	}

	// Step 3: Check OP_DROP
	if !tokenizer.Next() || tokenizer.Opcode() != txscript.OP_DROP {
		return 0, nil, errors.New("missing OP_DROP")
	}

	// Step 4: Extract the redeem script
	if !tokenizer.Next() {
		return 0, nil, errors.New("failed to parse redeem script")
	}
	redeemScript := tokenizer.Data()

	// Ensure no extra data
	if tokenizer.Next() {
		return 0, nil, errors.New("unexpected data after redeem script")
	}

	return lockTime, redeemScript, nil
}
