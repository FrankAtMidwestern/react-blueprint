import { levenshteinDistance } from "./LevenshteinDistance";

/**
 * Calculates the similarity score between two strings based on the Levenshtein distance.
 * @param a - The first string.
 * @param b - The second string.
 * @returns A similarity score between 0 and 1.
 */
export function similarityScore(a: string, b: string): number {
    const maxLen: number = Math.max(a.length, b.length);
  
    // Handle division by zero if both strings are empty
    if (maxLen === 0) {
      return 1;
    }
  
    const distance: number = levenshteinDistance(a, b);
    return 1 - distance / maxLen;
  }