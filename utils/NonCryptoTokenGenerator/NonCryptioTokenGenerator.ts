import { murmurhash } from './MurmurHash';

/**
 * Generates a non-cryptographic token using the MurmurHash function.
 * This token is useful for identifiers, caching keys, or any scenario
 * where cryptographic security is not needed.
 *
 * @param seed - An optional seed string. If not provided, a default
 *               seed based on the current time and a random value is used.
 * @returns A token string generated from the hash value.
 */
export function nonCryptoTokenGenerator(seed?: string): string {
  if (!seed) {
    seed = `${Date.now()}-${Math.random()}`;
  }
  
  const hashValue = murmurhash(seed);
  
  return hashValue.toString(16);
}
