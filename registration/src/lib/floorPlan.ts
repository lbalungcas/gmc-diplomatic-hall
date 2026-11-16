/**
 * Booth layout of the hall for the People's Choice ballot. Keep in sync with `grid` in
 * src/data/hallLayout.json on the main site: booth numbers run west to east (left to right),
 * the stage is at the north end, and each island is two rows back to back on a spine wall.
 */
export interface FloorRow {
  row: string;
  color: string;
  booths: number[];
}

export const FLOOR_ISLANDS: { name: string; rows: [FloorRow, FloorRow] }[] = [
  {
    name: 'North island',
    rows: [
      { row: 'A', color: '#DD9366', booths: [1, 2, 3, 4, 5, 6] },
      { row: 'B', color: '#D35BA5', booths: [7, 8, 9, 10, 11, 12] },
    ],
  },
  {
    name: 'South island',
    rows: [
      { row: 'C', color: '#5BA8D0', booths: [13, 14, 15, 16, 17, 18] },
      { row: 'D', color: '#E8B44C', booths: [19, 20, 21, 22, 23, 24] },
    ],
  },
];
