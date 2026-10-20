/** SHA-256 round constants (FIPS 180-4), shared browser/Node fallback without platform imports. */
const ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
const rotate = (value: number, bits: number): number => value >>> bits | value << 32 - bits;
function messageWords(bytes: Uint8Array, offset: number, words: Uint32Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 64);
  for (let index = 0; index < 16; index++) words[index] = view.getUint32(index * 4);
  for (let index = 16; index < 64; index++) {
    const first = words[index - 15]!, second = words[index - 2]!;
    const sigma0 = rotate(first, 7) ^ rotate(first, 18) ^ first >>> 3;
    const sigma1 = rotate(second, 17) ^ rotate(second, 19) ^ second >>> 10;
    words[index] = words[index - 16]! + sigma0 + words[index - 7]! + sigma1;
  }
}
function compress(state: Uint32Array, words: Uint32Array): void {
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let index = 0; index < 64; index++) {
    const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25), choice = e & f ^ ~e & g;
    const first = h + sigma1 + choice + ROUND[index]! + words[index]! >>> 0;
    const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22), majority = a & b ^ a & c ^ b & c;
    const second = sigma0 + majority >>> 0;
    h = g; g = f; f = e; e = d + first >>> 0; d = c; c = b; b = a; a = first + second >>> 0;
  }
  state[0] = state[0]! + a; state[1] = state[1]! + b; state[2] = state[2]! + c; state[3] = state[3]! + d;
  state[4] = state[4]! + e; state[5] = state[5]! + f; state[6] = state[6]! + g; state[7] = state[7]! + h;
}
function paddedMessage(input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((input.byteLength + 9) / 64) * 64);
  bytes.set(input); bytes[input.byteLength] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(input.byteLength / 0x20000000));
  view.setUint32(bytes.length - 4, input.byteLength * 8 >>> 0);
  return bytes;
}
const initialState = () => new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const hexadecimal = (state: Uint32Array) => Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
export function portableSha256Hex(input: Uint8Array): string {
  const bytes = paddedMessage(input), state = initialState(), words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) { messageWords(bytes, offset, words); compress(state, words); }
  return hexadecimal(state);
}

/** Large retained requests yield between 256KiB slices on runtimes without native WebCrypto. */
export async function portableSha256HexAsync(input: Uint8Array): Promise<string> {
  const bytes = paddedMessage(input), state = initialState(), words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    if (offset > 0 && offset % 262_144 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    messageWords(bytes, offset, words); compress(state, words);
  }
  return hexadecimal(state);
}
