package utils

import "lukechampine.com/uint128"

func Uint128FromString(s string) uint128.Uint128 {
	i, _ := uint128.FromString(s)
	return i
}
