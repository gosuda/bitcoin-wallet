package types

import (
	"fmt"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"

	"github.com/gosuda/btctxbuilder/utils"
)

type AddrType string

const (
	P2PK          AddrType = "p2pk"    // non segwit
	P2PKH         AddrType = "p2pkh"   // non segwit
	P2WPKH        AddrType = "p2wpkh"  // native segwit v0
	P2WPKH_NESTED AddrType = "np2wpkh" // nested segwit v0

	P2SH         AddrType = "p2sh"   // non segwit
	P2WSH        AddrType = "p2wsh"  // native segwit v0
	P2WSH_NESTED AddrType = "np2wsh" // nested segwit v0

	P2TR AddrType = "taproot" // segwit v1

	Invalid AddrType = ""
)

func PubKeyToAddr(publicKey []byte, addrType AddrType, params *chaincfg.Params) (address string, err error) {
	switch addrType {
	case P2PK:
		addr, err := btcutil.NewAddressPubKey(publicKey, params)
		if err != nil {
			return "", err
		}
		return utils.HexEncode(addr.ScriptAddress()), nil
	case P2PKH:
		addr, err := btcutil.NewAddressPubKeyHash(btcutil.Hash160(publicKey), params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	case P2WPKH:
		address, err := btcutil.NewAddressWitnessPubKeyHash(btcutil.Hash160(publicKey), params)
		if err != nil {
			return "", err
		}
		return address.EncodeAddress(), nil
	case P2WPKH_NESTED:
		p2wpkh, err := btcutil.NewAddressWitnessPubKeyHash(btcutil.Hash160(publicKey), params)
		if err != nil {
			return "", err
		}
		redeemScript, err := txscript.PayToAddrScript(p2wpkh)
		if err != nil {
			return "", err
		}
		addr, err := btcutil.NewAddressScriptHash(redeemScript, params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	case P2TR:
		addr, err := btcutil.NewAddressTaproot(publicKey, params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	default:
		return "", fmt.Errorf("address type not supported | %s", addrType)
	}
}

func ScriptToAddr(script []byte, addrType AddrType, params *chaincfg.Params) (address string, err error) {
	switch addrType {
	case P2SH:
		// OP_HASH160 <ScriptHash> OP_EQUAL
		if len(script) != 23 || script[0] != txscript.OP_HASH160 {
			return "", fmt.Errorf("invalid P2SH script")
		}
		addr, err := btcutil.NewAddressScriptHashFromHash(script[2:22], params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	case P2WSH:
		// OP_0 <32-byte-ScriptHash>
		if len(script) != 34 || script[0] != txscript.OP_0 {
			return "", fmt.Errorf("invalid native segwit script")
		}
		witnessProgram := script[2:]
		addr, err := btcutil.NewAddressWitnessScriptHash(witnessProgram, params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	case P2WSH_NESTED:
		// OP_0 <32-byte-ScriptHash>
		if len(script) != 34 || script[0] != txscript.OP_0 {
			return "", fmt.Errorf("invalid nested segwit script")
		}
		redeemScript, err := txscript.NewScriptBuilder().
			AddOp(txscript.OP_0).
			AddData(script[2:]).
			Script()
		if err != nil {
			return "", fmt.Errorf("failed to create redeem script: %w", err)
		}
		redeemScriptHash := btcutil.Hash160(redeemScript)
		addr, err := btcutil.NewAddressScriptHashFromHash(redeemScriptHash, params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	case P2TR:
		// OP_1 <32-byte-TweakHash>
		if len(script) != 34 || script[0] != txscript.OP_1 {
			return "", fmt.Errorf("invalid Taproot script")
		}
		taprootKey := script[2:]
		addr, err := btcutil.NewAddressTaproot(taprootKey, params)
		if err != nil {
			return "", err
		}
		return addr.EncodeAddress(), nil
	default:
		return "", fmt.Errorf("address type not supported | %s", addrType)
	}
}

func DecodeAddress(address string, params *chaincfg.Params) (addr btcutil.Address, addrType AddrType, err error) {
	addr, err = btcutil.DecodeAddress(address, params)
	if err != nil {
		return nil, Invalid, err
	}

	return addr, GetAddressType(addr), nil
}

func GetAddressType(addr btcutil.Address) (addrType AddrType) {
	switch addr.(type) {
	case *btcutil.AddressPubKey:
		return P2PK
	case *btcutil.AddressPubKeyHash:
		return P2PKH
	case *btcutil.AddressScriptHash:
		return P2SH
	case *btcutil.AddressWitnessPubKeyHash:
		return P2WPKH
	case *btcutil.AddressWitnessScriptHash:
		return P2WSH
	case *btcutil.AddressTaproot:
		return P2TR
	default:
		return Invalid
	}
}

func AddrP2TRToPubkey(address string, params *chaincfg.Params) ([]byte, error) {
	addr, addrType, err := DecodeAddress(address, params)
	if err != nil {
		return nil, err
	} else if addrType != P2TR {
		return nil, fmt.Errorf("address is not a Taproot address")
	}

	script := addr.(*btcutil.AddressTaproot).ScriptAddress()
	return script, nil
}
