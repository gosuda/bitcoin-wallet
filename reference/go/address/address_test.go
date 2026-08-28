package address

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"crypto/ecdsa"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"

	"github.com/gosuda/btctxbuilder/types"
	"github.com/stretchr/testify/require"
)

func TestSignVerify_AllAddrTypes(t *testing.T) {
	tests := []struct {
		name     string
		addrType types.AddrType
	}{
		{"P2TR_Schnorr", types.P2TR},
		{"P2PK_ECDSA", types.P2PK},
		{"P2PKH_ECDSA", types.P2PKH},
		{"P2WPKH_ECDSA", types.P2WPKH},
		// {"P2SH_ECDSA", types.P2SH},
		{"P2WPKH_NESTED_ECDSA", types.P2WPKH_NESTED},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			privHex, pubHex, addr, err := GenerateAddress(tc.addrType)
			require.NoError(t, err)
			require.NotEmpty(t, privHex)
			require.NotEmpty(t, pubHex)
			require.NotEmpty(t, addr)

			msg := []byte("hello world")
			digest := sha256.Sum256(msg)

			switch tc.addrType {
			case types.P2TR:
				// Schnorr (BIP-340): priv: 32 bytes, pub: x-only 32 bytes
				privBytes, err := hex.DecodeString(privHex)
				require.NoError(t, err)
				require.Len(t, privBytes, 32)

				pubXOnly, err := hex.DecodeString(pubHex)
				require.NoError(t, err)
				require.Len(t, pubXOnly, 32)

				privKey, pubKey := btcec.PrivKeyFromBytes(privBytes)
				sig, err := schnorr.Sign(privKey, digest[:])
				require.NoError(t, err)
				require.NotNil(t, sig)

				ok := sig.Verify(digest[:], pubKey)
				require.True(t, ok, "schnorr verify should pass")

				// negative test: different message should fail
				otherDigest := sha256.Sum256([]byte("hello worle"))
				require.False(t, sig.Verify(otherDigest[:], pubKey), "schnorr verify should fail for different digest")

				// (optional) round-trip serialize/parse
				sigBytes := sig.Serialize()
				sig2, err := schnorr.ParseSignature(sigBytes)
				require.NoError(t, err)
				require.True(t, sig2.Verify(digest[:], pubKey))

			default:
				// ECDSA: pub is expected to be compressed (33 bytes)
				privBytes, err := hex.DecodeString(privHex)
				require.NoError(t, err)
				require.Len(t, privBytes, 32)

				privKey, pubKey := btcec.PrivKeyFromBytes(privBytes)

				sig, err := privKey.ToECDSA().Sign(rand.Reader, digest[:], nil)
				require.NoError(t, err)
				require.NotNil(t, sig)

				ok := ecdsa.VerifyASN1(pubKey.ToECDSA(), digest[:], sig)
				require.True(t, ok, "ecdsa verify should pass")

				// negative test: tampered digest
				otherDigest := sha256.Sum256([]byte("hello worle"))
				require.False(t, ecdsa.VerifyASN1(pubKey.ToECDSA(), otherDigest[:], sig), "ecdsa verify should fail for different digest")

			}
		})
	}
}
