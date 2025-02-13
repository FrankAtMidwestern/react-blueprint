import { similarityScore } from "./SimularityScore";

interface Option {
    label: string;
    value: string;
    labelLower?: string;
    valueLower?: string;
    score?: number;
  }

/**
 * Performs a fuzzy search on a list of options based on the query.
 * @param query - The search query.
 * @param options - The list of options to search.
 * @param threshold - The minimum similarity score required to include an option.
 * @returns A list of options that match the query, sorted by relevance.
 */
export function localFuzzySearch(
    query: string,
    options: Option[],
    threshold = 0.5,
  ): Option[] {
    if (typeof query !== 'string') {
      throw new TypeError('Query must be a string.');
    }
    if (!Array.isArray(options)) {
      throw new TypeError('Options must be an array.');
    }
  
    const lowerQuery: string = query.normalize('NFC').toLowerCase();
  
    return options
      .map(option => {
        // Preprocess and cache lowercased and normalized labels and values
        if (
          typeof option.label !== 'string' ||
          typeof option.value !== 'string'
        ) {
          throw new TypeError('Option label and value must be strings.');
        }
        option.labelLower =
          option.labelLower || option.label.normalize('NFC').toLowerCase();
        option.valueLower =
          option.valueLower || option.value.normalize('NFC').toLowerCase();
  
        // Calculate similarity scores
        const labelScore: number = similarityScore(lowerQuery, option.labelLower);
        const valueScore: number = similarityScore(lowerQuery, option.valueLower);
        // Use the maximum score between label and value
        option.score = Math.max(labelScore, valueScore);
  
        return option;
      })
  
      .filter(option => option.score !== undefined && option.score >= threshold)
      .sort((a, b) => (b.score as number) - (a.score as number));
  }