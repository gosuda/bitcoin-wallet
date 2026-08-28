package script

import (
	"errors"

	"github.com/btcsuite/btcd/txscript"
)

type NodeType string

const (
	Pk           NodeType = "pk"
	Pkh          NodeType = "pkh"
	Older        NodeType = "older"
	After        NodeType = "after"
	Thresh       NodeType = "thresh"
	And          NodeType = "and_b"
	Or           NodeType = "or_b"
	Multi        NodeType = "multi"
	CheckSig     NodeType = "checksig"
	CheckSigHash NodeType = "checksighash"
	Tr           NodeType = "taproot"
	Leaf         NodeType = "leaf"
)

type Node interface {
	Validate() error
	ToScript(*txscript.ScriptBuilder)
}

// PkNode represents a public key argument
type PkNode struct {
	PubKey []byte
}

func (a *PkNode) Validate() error {
	if len(a.PubKey) == 0 {
		return errors.New("public key cannot be empty")
	}
	return nil
}

func (a *PkNode) FromScript(script []byte) error {
	// A pay-to-compressed-pubkey script is of the form:
	//   - OP_DATA_33 <33-byte compressed pubkey> OP_CHECKSIG
	// All compressed secp256k1 public keys must start with 0x02 or 0x03.
	if len(script) == 35 &&
		script[34] == txscript.OP_CHECKSIG &&
		script[0] == txscript.OP_DATA_33 &&
		(script[1] == 0x02 || script[1] == 0x03) {
		a.PubKey = script[1:34]
		return nil
	}

	// A pay-to-uncompressed-pubkey script is of the form:
	//   - OP_DATA_65 <65-byte uncompressed pubkey> OP_CHECKSIG
	// All non-hybrid uncompressed secp256k1 public keys must start with 0x04.
	// Hybrid uncompressed secp256k1 public keys start with 0x06 or 0x07:
	//   - 0x06 => hybrid format for even Y coords
	//   - 0x07 => hybrid format for odd Y coords
	if len(script) == 67 &&
		script[66] == txscript.OP_CHECKSIG &&
		script[0] == txscript.OP_DATA_65 &&
		(script[1] == 0x04 || script[1] == 0x06 || script[1] == 0x07) {
		a.PubKey = script[1:66]
		return nil
	}
	return errors.New("invalid public key script")
}

func (a *PkNode) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddData([]byte(a.PubKey)).AddOp(txscript.OP_CHECKSIG)
}

// PkhNode represents a public key hash argument
type PkhNode struct {
	Hash []byte
}

func (a *PkhNode) Validate() error {
	if len(a.Hash) != 20 {
		return errors.New("public key hash cannot be empty")
	}
	return nil
}

func (a *PkhNode) FromScript(script []byte) error {
	if len(script) == 25 &&
		script[0] == txscript.OP_DUP &&
		script[1] == txscript.OP_HASH160 &&
		script[2] == txscript.OP_DATA_20 &&
		script[23] == txscript.OP_EQUALVERIFY &&
		script[24] == txscript.OP_CHECKSIG {

		a.Hash = script[3:23]
		return nil
	}
	return errors.New("invalid public key hash script")
}

func (a *PkhNode) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddOp(txscript.OP_DUP).
		AddOp(txscript.OP_HASH160).
		AddData(a.Hash).
		AddOp(txscript.OP_EQUALVERIFY).
		AddOp(txscript.OP_CHECKSIG)
}

// AfterNod represents a locktime argument
// if Time is less than 500000000, it is a block height
// otherwise, it is a unix timestamp
type AfterNode struct {
	Time int64
}

func (a *AfterNode) Validate() error {
	if a.Time <= 0 {
		return errors.New("locktime must be positive")
	}
	return nil
}

func (a *AfterNode) FromScript(script []byte) error {
	if len(script) >= 2 &&
		script[len(script)-2] == txscript.OP_CHECKLOCKTIMEVERIFY &&
		script[len(script)-1] == txscript.OP_DROP {

		opcode := script[0]
		data := script[1 : len(script)-2]
		lockTime, _, err := DecodeInt64(opcode, data)
		if err != nil {
			return errors.New("invalid locktime value")
		}
		a.Time = lockTime
		return nil
	}
	return errors.New("invalid after script")
}

func (a *AfterNode) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddInt64(a.Time).
		AddOp(txscript.OP_CHECKLOCKTIMEVERIFY).
		AddOp(txscript.OP_DROP)
}

// OlderNode represents a relative locktime argument
type OlderNode struct {
	Time int64
}

func (a *OlderNode) SetBlock(height int64) error {
	if height <= 0 {
		return errors.New("block count must be positive")
	} else if height >= 0x80000000 {
		return errors.New("block count exceeds maximum for blocks")
	}
	a.Time = height
	return nil
}

func (a *OlderNode) SetTime(seconds int64) error {
	if seconds <= 0 {
		return errors.New("time must be positive")
	}
	timeUnits := seconds / 512
	if seconds%512 != 0 {
		return errors.New("time must be a multiple of 512 seconds")
	}
	a.Time = 0x80000000 | timeUnits
	return nil
}

func (a *OlderNode) Validate() error {
	if a.Time <= 0 {
		return errors.New("relative locktime must be positive")
	}
	return nil
}

func (a *OlderNode) FromScript(script []byte) error {
	if len(script) >= 2 &&
		script[len(script)-2] == txscript.OP_CHECKSEQUENCEVERIFY &&
		script[len(script)-1] == txscript.OP_DROP {

		opcode := script[0]
		data := script[1 : len(script)-2]
		sequence, _, err := DecodeInt64(opcode, data)
		if err != nil {
			return errors.New("invalid sequence value")
		}
		a.Time = sequence
		return nil
	}
	return errors.New("invalid older script")
}

func (a *OlderNode) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddInt64(a.Time).
		AddOp(txscript.OP_CHECKSEQUENCEVERIFY).
		AddOp(txscript.OP_DROP)
}

// MultiNode represents a multisig argument
type MultiNode struct {
	Required int
	Keys     []string
}

func (a *MultiNode) Validate() error {
	if a.Required <= 0 || len(a.Keys) < a.Required {
		return errors.New("invalid multisig parameters")
	}
	return nil
}

// func (a *MultiNode) FromScript(script []byte) error {
// 	if len(script) < 2 || script[len(script)-1] != txscript.OP_CHECKMULTISIG {
// 		return errors.New("invalid multisig script")
// 	}

// 	// Parse required signatures
// 	required, script, err := DecodeInt(script)
// 	if err != nil {
// 		return errors.New("failed to decode required signatures")
// 	}
// 	a.Required = int(required)

// 	// Parse public keys
// 	keys := []string{}
// 	for len(script) > 1 {
// 		keyLen := int(script[0])
// 		if len(script) < 1+keyLen {
// 			return errors.New("invalid key length in multisig script")
// 		}
// 		keys = append(keys, string(script[1:1+keyLen]))
// 		script = script[1+keyLen:]
// 	}

// 	// Parse total keys
// 	totalKeys, _, err := DecodeInt(script)
// 	if err != nil || len(keys) != int(totalKeys) {
// 		return errors.New("total keys mismatch in multisig script")
// 	}
// 	a.Keys = keys

// 	return nil
// }

func (a *MultiNode) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddInt64(int64(a.Required))
	for _, key := range a.Keys {
		builder.AddData([]byte(key))
	}
	builder.AddInt64(int64(len(a.Keys))).AddOp(txscript.OP_CHECKMULTISIG)
}

// ThreshNode represents a threshold condition
type ThreshNode struct {
	Threshold int
	Children  []Node
}

func (a *ThreshNode) Validate() error {
	if a.Threshold <= 0 || len(a.Children) < a.Threshold {
		return errors.New("invalid threshold parameters")
	}
	for _, child := range a.Children {
		if err := child.Validate(); err != nil {
			return err
		}
	}
	return nil
}

// func (a *ThreshNode) FromScript(script []byte) error {
// 	threshold, remaining, err := DecodeInt(script)
// 	if err != nil {
// 		return errors.New("failed to decode threshold")
// 	}
// 	a.Threshold = int(threshold)

// 	children := []Node{}
// 	for len(remaining) > 0 {
// 		child, rest, err := parseChildNode(remaining)
// 		if err != nil {
// 			return err
// 		}
// 		children = append(children, child)
// 		remaining = rest
// 	}
// 	a.Children = children
// 	return nil
// }

func (a *ThreshNode) ToScript(builder *txscript.ScriptBuilder) {
	for _, child := range a.Children {
		child.ToScript(builder)
	}
	builder.AddInt64(int64(a.Threshold))
}

// CompositeNode represents a logical combination ( and, or ) of child nodes
type CompositeNode struct {
	Children []Node
}

func (a *CompositeNode) Validate() error {
	if len(a.Children) < 2 {
		return errors.New("composite nodes require at least two children")
	}
	for _, child := range a.Children {
		if err := child.Validate(); err != nil {
			return err
		}
	}
	return nil
}

// func (a *CompositeNode) FromScript(script []byte) error {
// 	children := []Node{}
// 	for len(script) > 0 {
// 		child, remaining, err := parseChildNode(script)
// 		if err != nil {
// 			return err
// 		}
// 		children = append(children, child)
// 		script = remaining
// 	}
// 	a.Children = children
// 	return nil
// }

func (a *CompositeNode) ToScript(builder *txscript.ScriptBuilder) {
	for _, child := range a.Children {
		child.ToScript(builder)
	}
}

// TrArgs represents a Taproot script
type TrArgs struct {
	InternalKey string
	MerkleRoot  string
}

func (a *TrArgs) Validate() error {
	if a.InternalKey == "" {
		return errors.New("internal key cannot be empty")
	}
	// MerkleRoot can be empty for a single-leaf Taproot
	return nil
}

func (a *TrArgs) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddOp(txscript.OP_1).AddData([]byte(a.InternalKey))
	if a.MerkleRoot != "" {
		builder.AddData([]byte(a.MerkleRoot))
	}
}

// LeafArgs represents a Taproot leaf node
type LeafArgs struct {
	Script  string                        // Script for this leaf node
	Version txscript.TapscriptLeafVersion // Leaf version (default: 0xc0 for Taproot v1)
}

func (a *LeafArgs) Validate() error {
	if a.Script == "" {
		return errors.New("leaf script cannot be empty")
	}
	if a.Version < txscript.BaseLeafVersion {
		return errors.New("invalid leaf version")
	}
	return nil
}

func (a *LeafArgs) FromScript(script []byte) error {
	if len(script) < 1 {
		return errors.New("invalid leaf script")
	}
	a.Version = txscript.TapscriptLeafVersion(script[0])
	a.Script = string(script[1:])
	return nil
}

func (a *LeafArgs) ToScript(builder *txscript.ScriptBuilder) {
	builder.AddOp(byte(a.Version)).AddData([]byte(a.Script))
}
