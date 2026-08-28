package script

import (
	"errors"

	"github.com/btcsuite/btcd/txscript"
)

// DecodeInt64 decodes a Bitcoin script integer from the provided script.
// It handles OP_0, OP_1NEGATE, OP_1-OP_16, and minimally encoded integers.
func DecodeInt64(opcode byte, script []byte) (int64, []byte, error) {

	// OP_0 (0x00) represents integer 0
	if opcode == txscript.OP_0 {
		return 0, script, nil
	}

	// OP_1NEGATE (0x4f) represents integer -1
	if opcode == txscript.OP_1NEGATE {
		return -1, script, nil
	}

	// OP_1 (0x51) to OP_16 (0x60) represent integers 1 to 16
	if opcode >= txscript.OP_1 && opcode <= txscript.OP_16 {
		return int64(opcode - txscript.OP_1 + 1), script, nil
	}

	if len(script) == 0 {
		return 0, nil, errors.New("empty script")
	}

	// Decode minimally encoded integers (e.g., from AddData)
	if opcode >= txscript.OP_DATA_1 && opcode <= txscript.OP_PUSHDATA4 {
		// Extract the data length
		length := int(opcode - txscript.OP_DATA_1 + 1)
		if len(script) < length {
			return 0, nil, errors.New("script too short for integer data")
		}

		// Extract the integer bytes and decode
		intBytes := script[:length]
		script = script[length:]

		val, err := decodeScriptNum(intBytes)
		if err != nil {
			return 0, nil, err
		}

		return val, script, nil
	}

	return 0, nil, errors.New("invalid opcode for integer")
}

func decodeScriptNum(data []byte) (int64, error) {
	if len(data) > 8 {
		return 0, errors.New("integer too large")
	}

	// Convert little-endian byte slice to int64
	var result int64
	for i := len(data) - 1; i >= 0; i-- {
		result <<= 8
		result |= int64(data[i])
	}

	// If the most significant bit is set, the number is negative
	if len(data) > 0 && data[len(data)-1]&0x80 != 0 {
		negativeMask := int64(1) << (uint(len(data)*8) - 1)
		result -= negativeMask * 2
	}

	return result, nil
}
