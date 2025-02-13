export function levenshteinDistance(a: string, b: string): number {
    if (typeof a !== 'string' || typeof b !== 'string') {
      throw new TypeError('Both arguments must be strings.');
    }
  
    a = a.normalize('NFC').toLowerCase();
    b = b.normalize('NFC').toLowerCase();
  
    let m: number = a.length;
    let n: number = b.length;
  
    if (m === 0) {
      return n;
    }
    if (n === 0) {
      return m;
    }
  
    if (m > n) {
      [a, b] = [b, a];
      [m, n] = [n, m];
    }
  
    let prevRow: number[] = Array.from({length: m + 1}, (_, i) => i);
    let currentRow: number[] = new Array<number>(m + 1);
  
    for (let j = 1; j <= n; j++) {
      currentRow[0] = j;
      let prevDiagonal = prevRow[0];
  
      for (let i = 1; i <= m; i++) {
        const temp = currentRow[i];
        const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        currentRow[i] = Math.min(
          currentRow[i - 1] + 1,
          prevRow[i] + 1,
          prevDiagonal + cost,
        );
        prevDiagonal = prevRow[i];
        prevRow[i] = temp !== undefined ? temp : 0;
      }
  
      [prevRow, currentRow] = [currentRow, prevRow];
    }
  
    return prevRow[m];
  }