package utils

import (
	"slices"
	"sort"
)

func SelectUtxo[T any](items []T, target int, amountFn func(T) int) (selected []T, unselected []T, sufficient bool) {
	if len(items) == 0 {
		return nil, nil, false
	}

	bestIdx, bestAmt := -1, -1
	for i, it := range items {
		amt := amountFn(it)
		if amt > bestAmt {
			bestAmt = amt
			bestIdx = i
		}
	}
	if bestIdx >= 0 && bestAmt >= target {
		sel := []T{items[bestIdx]}
		unsel := make([]T, 0, len(items)-1)
		for i, it := range items {
			if i == bestIdx {
				continue
			}
			unsel = append(unsel, it)
		}
		return sel, unsel, true
	}

	itemsAsc := slices.Clone(items)
	sort.Slice(itemsAsc, func(i, j int) bool {
		return amountFn(itemsAsc[i]) < amountFn(itemsAsc[j])
	})

	n := len(itemsAsc)
	chosen := make([]bool, n)
	largestIdx := n - 1
	first := itemsAsc[largestIdx]
	selected = []T{first}
	chosen[largestIdx] = true
	currentTotal := amountFn(first)

	for i := 0; i < n-1; i++ {
		it := itemsAsc[i]
		amt := amountFn(it)
		if currentTotal+amt > target {
			continue
		}
		selected = append(selected, it)
		chosen[i] = true
		currentTotal += amt
		if currentTotal == target {
			unselected = make([]T, 0, n-len(selected))
			for k := range n {
				if !chosen[k] {
					unselected = append(unselected, itemsAsc[k])
				}
			}
			return selected, unselected, true
		}
	}

	return nil, items, false
}
