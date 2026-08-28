package main

import (
	"fmt"
	"io"
	"strings"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/gosuda/btctxbuilder/client"
	"github.com/gosuda/btctxbuilder/types"
)

type model struct {
	step        int
	net         string
	from        string
	toList      []string
	amountList  []int64
	privateKey  string
	client      *client.Client
	errorMsg    string
	inputBuffer string

	netList      list.Model // step 0
	actionList   list.Model // step 1
	addrTypeList list.Model // step 1-0 (newAddress)
	action       string     // "newAddress" | "sendTransaction"

	// result
	resultAddr    string
	resultPubHex  string
	resultPrivHex string
	banner        string
	bannerKind    string
}

type choiceItem struct{ title, desc string }

func (i choiceItem) Title() string       { return i.title }
func (i choiceItem) Description() string { return i.desc }
func (i choiceItem) FilterValue() string { return i.title }

type simpleDelegate struct{}

func (d simpleDelegate) Height() int                               { return 1 }
func (d simpleDelegate) Spacing() int                              { return 0 }
func (d simpleDelegate) Update(msg tea.Msg, m *list.Model) tea.Cmd { return nil }
func (d simpleDelegate) Render(w io.Writer, m list.Model, idx int, it list.Item) {
	item, ok := it.(choiceItem)
	if !ok {
		return
	}
	prefix := "  "
	if idx == m.Index() {
		prefix = "➤ "
	}
	fmt.Fprintf(w, "%s%s\n", prefix, item.title)
}

type errorMsg string
type resultMsg struct{ txid string }

/* ---------- builders ---------- */

func buildNetList() list.Model {
	items := []list.Item{
		choiceItem{"btc", "Bitcoin mainnet"},
		choiceItem{"btc-testnet3", "Legacy testnet3"},
		choiceItem{"btc-testnet4", "New testnet4"},
		choiceItem{"btc-signet", "Signet"},
	}
	l := list.New(items, simpleDelegate{}, 24, 8)
	l.Title = "Select Network"
	l.SetFilteringEnabled(false)
	l.SetShowHelp(false)
	l.SetShowStatusBar(false)
	l.SetShowPagination(false)
	l.FilterInput.Focus()
	return l
}

func buildActionList() list.Model {
	items := []list.Item{
		choiceItem{"newAddress", "Generate a new address"},
		choiceItem{"sendTransaction", "Build & send a transaction"},
	}
	l := list.New(items, simpleDelegate{}, 24, 8)
	l.Title = "Select Action"
	l.SetFilteringEnabled(false)
	l.SetShowHelp(false)
	l.SetShowStatusBar(false)
	l.SetShowPagination(false)
	return l
}

func buildAddrTypeList() list.Model {
	items := []list.Item{
		choiceItem{string(types.P2PK), "Pay-to-PubKey (not recommended)"},
		choiceItem{string(types.P2PKH), "Pay-to-PubKey-Hash"},
		choiceItem{string(types.P2WPKH), "Bech32 v0 P2WPKH"},
		choiceItem{string(types.P2WPKH_NESTED), "P2SH-P2WPKH (nested segwit)"},
		choiceItem{string(types.P2TR), "Taproot (BIP-340, x-only)"},
	}
	l := list.New(items, simpleDelegate{}, 24, 8)
	l.Title = "Select Address Type"
	l.SetFilteringEnabled(false)
	l.SetShowHelp(false)
	l.SetShowStatusBar(false)
	l.SetShowPagination(false)
	return l
}

/* ---------- initial model ---------- */

func initialModel() model {
	return model{
		step:         0,
		netList:      buildNetList(),
		actionList:   buildActionList(),
		addrTypeList: buildAddrTypeList(),
	}
}

func (m model) Init() tea.Cmd { return nil }

/* ---------- update ---------- */

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch x := msg.(type) {
	case tea.KeyMsg:
		switch x.Type {
		case tea.KeyCtrlC:
			return m, tea.Quit
		}

		switch m.step {
		case 0:
			return m.updateNetworkSelect(x)
		case 1:
			return m.updateActionSelect(x)
		case 10:
			return m.updateAddrTypeSelect(x)
		case 11:
			if s := x.String(); s == "enter" || s == "b" {
				m.step = 1
				return m, nil
			}
			return m, nil
		default:
			return m.updateKeyInput(x)
		}

	case errorMsg:
		m.errorMsg = string(x)
		return m, nil

	case resultMsg:
		m.step = -1
		m.errorMsg = fmt.Sprintf("Transaction successful! txid: %s", x.txid)
		return m, nil
	}

	switch m.step {
	case 0:
		var cmd tea.Cmd
		m.netList, cmd = m.netList.Update(msg)
		return m, cmd
	case 1:
		var cmd tea.Cmd
		m.actionList, cmd = m.actionList.Update(msg)
		return m, cmd
	case 10:
		var cmd tea.Cmd
		m.addrTypeList, cmd = m.addrTypeList.Update(msg)
		return m, cmd
	}
	return m, nil
}

/* ---------- step 0: network select ---------- */

func (m model) updateNetworkSelect(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch k.Type {
	case tea.KeyEnter:
		if it := m.netList.SelectedItem(); it != nil {
			sel := it.(choiceItem).title
			m.netList.FilterInput.Blur()
			return m.setNetwork(sel)
		}
		return m, nil
	default:
		var cmd tea.Cmd
		m.netList, cmd = m.netList.Update(k)
		return m, cmd
	}
}

/* ---------- step 1: action select ---------- */

func (m model) updateActionSelect(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch k.Type {
	case tea.KeyEnter:
		if it := m.actionList.SelectedItem(); it != nil {
			act := it.(choiceItem).title
			return m.setAction(act)
		}
		return m, nil
	default:
		var cmd tea.Cmd
		m.actionList, cmd = m.actionList.Update(k)
		return m, cmd
	}
}

/* ---------- step 10: addr type select (newAddress) ---------- */

func (m model) updateAddrTypeSelect(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch k.Type {
	case tea.KeyEnter:
		if it := m.addrTypeList.SelectedItem(); it != nil {
			typ := it.(choiceItem).title
			return m.generateNewAddress(typ)
		}
		return m, nil
	default:
		var cmd tea.Cmd
		m.addrTypeList, cmd = m.addrTypeList.Update(k)
		return m, cmd
	}
}

/* ---------- step>=2: sendTransaction text input ---------- */

func (m model) updateKeyInput(k tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch k.Type {
	case tea.KeyEnter:
		input := strings.TrimSpace(m.inputBuffer)
		m.inputBuffer = ""
		return m.handleStep(input)
	case tea.KeyBackspace:
		if n := len(m.inputBuffer); n > 0 {
			m.inputBuffer = m.inputBuffer[:n-1]
		}
	default:
		if len(k.Runes) > 0 {
			m.inputBuffer += string(k.Runes)
		}
	}
	return m, nil
}

func (m model) handleStep(input string) (model, tea.Cmd) {
	switch m.step {
	// sendTransaction steps
	case 2:
		return m.setFromAddress(input)
	case 3:
		return m.addRecipient(input)
	case 4:
		m.setPrivateKey(input)
		return m, m.transfer
	}
	return m, nil
}

/* ---------- actions ---------- */

func (m model) setNetwork(input string) (model, tea.Cmd) {
	client, err := client.NewClient(types.Network(input))
	if err != nil {
		return m, returnError(fmt.Sprintf("Failed to create client: %s", err))
	}
	m.net = input
	m.client = client
	m.step = 1
	return m, nil
}

func (m model) setAction(act string) (model, tea.Cmd) {
	m.action = act
	switch act {
	case "newAddress":
		m.step = 10
	case "sendTransaction":
		m.step = 2
	default:
		return m, returnError("Unknown action")
	}
	return m, nil
}

/* ---------- sendTransaction helpers ---------- */

func (m model) setFromAddress(input string) (model, tea.Cmd) {
	if input == "" {
		return m, returnError("From address cannot be empty.")
	}
	m.from = input
	m.step = 3
	return m, nil
}

func (m model) addRecipient(input string) (model, tea.Cmd) {
	if input == "done" {
		if len(m.toList) == 0 {
			return m, returnError("At least one recipient is required.")
		}
		m.step = 4
		return m, nil
	}
	var addr string
	var amt int64
	if _, err := fmt.Sscanf(input, "%s %d", &addr, &amt); err != nil || addr == "" || amt <= 0 {
		return m, returnError("Invalid format. Use: [address] [amount]")
	}
	m.toList = append(m.toList, addr)
	m.amountList = append(m.amountList, amt)
	return m, nil
}

func (m *model) setPrivateKey(input string) { m.privateKey = input }

func returnError(msg string) tea.Cmd { return func() tea.Msg { return errorMsg(msg) } }
