package utils

import (
	"encoding/hex"
	"strings"
)

func HexEncode(bytes []byte) string {
	return hex.EncodeToString(bytes)
}

func HexEncodeWith0x(bytes []byte) string {
	return AddHexPrefix(HexEncode(bytes))
}

func HexMustDecode(hexString string) []byte {
	data, err := HexDecode(hexString)
	if err != nil {
		panic(err)
	}
	return data
}

func HexDecode(hexString string) ([]byte, error) {
	hexString = TrimHexPrefix(hexString)

	if len(hexString)%2 != 0 {
		hexString = "0" + hexString
	}

	return hex.DecodeString(hexString)
}

func IsHex(str string) bool {
	str = TrimHexPrefix(str)

	if len(str)%2 != 0 {
		return false
	}

	for i := 0; i < len(str); i++ {
		if !isHexCharacter(str[i]) {
			return false
		}
	}
	return true
}

func HasHexPrefix(str string) bool {
	return strings.HasPrefix(str, "0x") || strings.HasPrefix(str, "0X")
}

func TrimHexPrefix(s string) string {
	if HasHexPrefix(s) {
		return s[2:]
	}
	return s
}

func AddHexPrefix(s string) string {
	if !HasHexPrefix(s) {
		return "0x" + s
	}
	return s
}

func isHexCharacter(c byte) bool {
	return ('0' <= c && c <= '9') || ('a' <= c && c <= 'f') || ('A' <= c && c <= 'F')
}
