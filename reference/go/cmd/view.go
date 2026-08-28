package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

var (
	accent = lipgloss.Color("#89b4fa")

	titleStyle    = lipgloss.NewStyle().Bold(true)
	labelStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("245")).Bold(true)
	valueStyle    = lipgloss.NewStyle()
	hintStyle     = lipgloss.NewStyle().Faint(true).Italic(true)
	dividerStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("240"))
	itemStyle     = lipgloss.NewStyle()
	selectedStyle = lipgloss.NewStyle().Bold(true).Foreground(accent)
	errorStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("9")).Bold(true)
	inputStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)
	successStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("10")).Bold(true)
)

func (m model) View() string {
	if m.step == -1 {
		return titleStyle.Render("🧪 Bitcoin Transaction Builder") + "\n\n" +
			errorStyle.Render(m.errorMsg)
	}

	header := titleStyle.Render("🧪 Bitcoin Transaction Builder")
	divider := dividerStyle.Render(strings.Repeat("─", 40))

	var content string
	switch m.step {
	case 0:
		content = lipgloss.JoinVertical(lipgloss.Left,
			renderStatus(m),
			"",
			labelStyle.Render("SELECT THE NETWORK"),
			renderNetList(m),
			hintStyle.Render("Use ↑/↓, Enter to select, ctrl+c to quit"),
			divider,
		)
	case 1:
		content = lipgloss.JoinVertical(lipgloss.Left,
			renderStatus(m),
			"",
			labelStyle.Render("SELECT THE ACTION"),
			renderActionList(m),
			hintStyle.Render("Use ↑/↓, Enter to select, ctrl+c to quit"),
			divider,
		)
	case 10:
		content = lipgloss.JoinVertical(lipgloss.Left,
			renderStatus(m),
			"",
			labelStyle.Render("SELECT ADDRESS TYPE (for newAddress)"),
			renderAddrTypeList(m),
			hintStyle.Render("Use ↑/↓, Enter to generate, ctrl+c to quit"),
			divider,
		)
	case 11:
		content = lipgloss.JoinVertical(lipgloss.Left,
			renderStatus(m),
			"",
			renderBanner(m),
			"",
			labelStyle.Render("RESULT (newAddress)"),
			renderResultPanel(m),
			hintStyle.Render("Press Enter to go back, ctrl+c to quit"),
		)
	default:
		content = lipgloss.JoinVertical(lipgloss.Left,
			renderStatus(m), "",
			renderInput(m),
		)
	}

	return header + "\n" + divider + "\n" + content
}

/* ---------- lists ---------- */

func renderNetList(m model) string {
	var b strings.Builder
	idx := m.netList.Index()
	for i, it := range m.netList.Items() {
		name := it.(choiceItem).title
		if i == idx {
			b.WriteString(selectedStyle.Render("➤ · "+name) + "\n")
		} else {
			b.WriteString(itemStyle.Render("  · "+name) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderActionList(m model) string {
	var b strings.Builder
	idx := m.actionList.Index()
	for i, it := range m.actionList.Items() {
		name := it.(choiceItem).title
		if i == idx {
			b.WriteString(selectedStyle.Render("➤ · "+name) + "\n")
		} else {
			b.WriteString(itemStyle.Render("  · "+name) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderAddrTypeList(m model) string {
	var b strings.Builder
	idx := m.addrTypeList.Index()
	for i, it := range m.addrTypeList.Items() {
		name := it.(choiceItem).title
		if i == idx {
			b.WriteString(selectedStyle.Render("➤ · "+name) + "\n")
		} else {
			b.WriteString(itemStyle.Render("  · "+name) + "\n")
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

/* ---------- status & input ---------- */

func renderStatus(m model) string {
	toMap := formatToMap(m.toList, m.amountList)
	act := m.action
	if act == "" {
		act = "(none)"
	}
	return lipgloss.JoinVertical(lipgloss.Left,
		labelStyle.Render("STATUS"),
		fmt.Sprintf("🌐 Network:   %s", valueStyle.Render(m.net)),
		fmt.Sprintf("🧰 Action:    %s", valueStyle.Render(act)),
		fmt.Sprintf("📤 From:      %s", valueStyle.Render(m.from)),
		toMap,
		fmt.Sprintf("🔑 Privatekey: %s", strings.Repeat("X", len(m.privateKey))),
	)
}

func renderInput(m model) string {
	instructions := buildInputInstruction(m.step)
	inputLine := inputStyle.Render(m.inputBuffer + "▌")

	var preview string
	if (m.step == 3 || m.step == 4) && m.inputBuffer != "" {
		preview = fmt.Sprintf("➡️ Preview: %s", m.inputBuffer)
	} else if m.step == 2 && m.inputBuffer != "" {
		preview = fmt.Sprintf("➡️ Preview: %s", m.inputBuffer)
	}

	var errorView string
	if m.errorMsg != "" {
		errorView = errorStyle.Render("⚠️ " + m.errorMsg)
	}

	return lipgloss.JoinVertical(lipgloss.Left,
		instructions,
		"",
		inputLine,
		preview,
		lipgloss.NewStyle().Italic(true).Render("Type input and press Enter ⏎, ctrl+c to quit"),
		"",
		errorView,
	)
}

func formatToMap(addresses []string, amounts []int64) string {
	if len(addresses) == 0 {
		return "📥 To/Amount: (none)"
	}
	var sb strings.Builder
	sb.WriteString("📥 To/Amount:\n   {\n")
	for i := range addresses {
		sb.WriteString(fmt.Sprintf("     %s: %d,\n", addresses[i], amounts[i]))
	}
	return strings.TrimRight(sb.String(), ",\n") + "\n   }"
}

func renderResultPanel(m model) string {
	if m.resultAddr == "" {
		return "(no result)"
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("• Address: %s\n", valueStyle.Render(m.resultAddr)))
	if m.resultPubHex != "" {
		b.WriteString(fmt.Sprintf("• PubKey : %s\n", valueStyle.Render(m.resultPubHex)))
	}
	if m.resultPrivHex != "" {
		b.WriteString(fmt.Sprintf("• PrivKey: %s\n", valueStyle.Render(m.resultPrivHex)))
	}
	return b.String()
}

func renderBanner(m model) string {
	if m.banner == "" {
		return ""
	}
	if m.bannerKind == "success" {
		return successStyle.Render("✅ " + m.banner)
	}
	return errorStyle.Render("⚠️ " + m.banner)
}

/* ---------- step help ---------- */

func buildInputInstruction(step int) string {
	switch step {
	case 0:
		return labelStyle.Render("Select the Network")
	case 1:
		return labelStyle.Render("Select the Action (newAddress | sendTransaction)")
	case 2:
		// sendTransaction: From address
		return labelStyle.Render("Enter the 'From' address:")
	case 3:
		// sendTransaction: To & amount (multi, 'done' to finish)
		return labelStyle.Render("Enter 'To' address and amount:") +
			"\n(e.g., bc1... 10000) — type 'done' when finished"
	case 4:
		// sendTransaction: Private key
		return labelStyle.Render("Enter the Private Key (WIF/hex depending on your client):")
	case 10:
		// newAddress: address type
		return labelStyle.Render("Select Address Type for newAddress")
	default:
		return ""
	}
}
