/** Track complete reads, not just a read tool call or a fetched URL. */
export class ReadCoverage {
  private notes = new Map<string, { hash: string; total: number; ranges: Array<[number, number]> }>();
  add(id: string, hash: string, start: number, end: number, total: number): boolean {
    if (![start, end, total].every(Number.isInteger) || start < 0 || end < start || end > total) throw new Error("Invalid source page");
    let note = this.notes.get(id);
    if (!note || note.hash !== hash || note.total !== total) {
      note = { hash, total, ranges: [] }; this.notes.set(id, note);
    }
    note.ranges.push([start, end]);
    return this.complete(id);
  }
  complete(id: string, hash?: string): boolean {
    const note = this.notes.get(id);
    if (!note || note.total === 0 || (hash !== undefined && note.hash !== hash)) return false;
    let covered = 0;
    for (const [start, end] of [...note.ranges].sort((a, b) => a[0] - b[0])) {
      if (start > covered) return false;
      covered = Math.max(covered, end);
    }
    return covered >= note.total;
  }
}
