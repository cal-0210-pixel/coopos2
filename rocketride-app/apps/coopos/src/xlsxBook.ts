// =============================================================================
// MIT License
// Copyright (c) 2026 Aparavi Software AG
// =============================================================================

/**
 * Turns an .xlsx file into a `Book` with SheetJS, entirely in memory. The
 * screen loads SheetJS lazily (only when a file is opened) and passes it in.
 */

import type * as XLSXType from 'xlsx';
import type { Book, Cell } from './houseData';

export function readWorkbook(XLSX: typeof XLSXType, data: ArrayBuffer, fileName: string): Book {
	const wb = XLSX.read(data, { cellDates: true });
	const cache = new Map<string, Cell[][]>();
	return {
		fileName,
		sheetNames: wb.SheetNames,
		rows: (s) => {
			if (!cache.has(s)) cache.set(s, wb.Sheets[s] ? (XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, raw: true, defval: null }) as Cell[][]) : []);
			return cache.get(s) as Cell[][];
		},
	};
}
