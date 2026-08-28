package runes

import (
	"errors"
	"fmt"
	"math/big"
	"math/bits"
	"strings"
	"unicode"

	"lukechampine.com/uint128"
)

func NewRune(value uint128.Uint128) Rune {
	return Rune{Value: value}
}

func RuneFromString(s string) (*Rune, error) {
	x := big.NewInt(0)
	tmp := big.NewInt(0)
	for i, c := range s {
		if i > 0 {
			x.Add(x, tmp.SetInt64(1))
		}
		x.Mul(x, tmp.SetInt64(26))
		if x.BitLen() > 128 {
			return nil, errors.New("overflow")
		}
		if c >= 'A' && c <= 'Z' {
			x.Add(x, tmp.SetInt64(int64(c-'A')))
			if x.BitLen() > 128 {
				return nil, errors.New("overflow")
			}
		} else {
			return nil, fmt.Errorf("invalid character `%c`", c)
		}
	}
	u := uint128.FromBig(x)

	return &Rune{Value: u}, nil
}

type Rune struct {
	Value uint128.Uint128
}

func (r Rune) N() uint128.Uint128 {
	return r.Value
}

func (r Rune) String() string {
	n := r.Value
	if n.Cmp(uint128.Max) == 0 {
		return "BCGDENLQRQWDSLRUGSNLBTMFIJAV"
	}

	n = n.Add64(1)
	var symbol strings.Builder
	for n.Cmp(uint128.Zero) > 0 {
		index := n.Sub64(1).Mod64(26)

		symbol.WriteByte("ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index])
		n = n.Sub64(1).Div64(26)
	}

	// Reverse the string
	runes := []rune(symbol.String())
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}

	return string(runes)
}

// MarshalJSON json marshal
func (r Rune) MarshalJSON() ([]byte, error) {
	return []byte(`"` + r.String() + `"`), nil
}

type SpacedRune struct {
	Rune    Rune
	Spacers uint32
}

func NewSpacedRune(r Rune, spacers uint32) *SpacedRune {
	return &SpacedRune{Rune: r, Spacers: spacers}
}

func (sr *SpacedRune) String() string {
	var b strings.Builder
	runeStr := sr.Rune.String()

	for i, c := range runeStr {
		b.WriteRune(c)
		if i < len(runeStr)-1 && sr.Spacers&(1<<i) != 0 {
			b.WriteRune('•')
		}
	}

	return b.String()
}

func SpacedRuneFromString(s string) (*SpacedRune, error) {
	var runeStr string
	var spacers uint32

	for _, c := range s {
		switch {
		case unicode.IsUpper(c):
			runeStr += string(c)
		case c == '.' || c == '•':

			//let flag = 1 << rune.len().checked_sub(1).ok_or(Error::LeadingSpacer)?;
			if len(runeStr) == 0 {
				return nil, ErrLeadingSpacer
			}
			flag := uint32(1) << (len(runeStr) - 1)
			if spacers&flag != 0 {
				return nil, ErrDoubleSpacer
			}
			spacers |= flag
		default:
			return nil, ErrCharacter(c)
		}
	}

	if 32-bits.LeadingZeros32(spacers) >= len(runeStr) {
		return nil, ErrTrailingSpacer
	}

	r, err := RuneFromString(runeStr)
	if err != nil {
		return nil, fmt.Errorf("rune error: %v", err)
	}

	return &SpacedRune{
		Rune:    *r,
		Spacers: spacers,
	}, nil
}

var (
	ErrCharacter = func(c rune) error {
		return fmt.Errorf("invalid character `%c`", c)
	}
	ErrDoubleSpacer   = errors.New("double spacer")
	ErrLeadingSpacer  = errors.New("leading spacer")
	ErrTrailingSpacer = errors.New("trailing spacer")
)
