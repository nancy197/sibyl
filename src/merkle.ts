/**
 * Merkle tree over locked forecasts (sha256). Leaves and inner nodes are domain-separated
 * (0x00 / 0x01 prefixes) and each pair is sorted before hashing, so a proof is just a list of
 * sibling hashes. An odd node at the end of a level is carried up unchanged.
 */
import { createHash } from 'node:crypto';

const sha256 = (...parts: Buffer[]): Buffer =>
  createHash('sha256').update(Buffer.concat(parts)).digest();

export const leafHash = (leaf: string) => sha256(Buffer.from([0]), Buffer.from(leaf, 'utf8'));

function nodeHash(a: Buffer, b: Buffer) {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return sha256(Buffer.from([1]), lo, hi);
}

export type MerkleTree = { root: string; proofs: string[][] };

export function buildTree(leaves: string[]): MerkleTree {
  if (!leaves.length) throw new Error('cannot build a Merkle tree with no leaves');
  let level: Buffer[] = leaves.map(leafHash);
  // members[i] = original leaf indexes under node i of the current level
  let members = leaves.map((_, i) => [i]);
  const proofs: string[][] = leaves.map(() => []);

  while (level.length > 1) {
    const nextLevel: Buffer[] = [];
    const nextMembers: number[][] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        nextLevel.push(level[i]);
        nextMembers.push(members[i]);
        continue;
      }
      for (const leaf of members[i]) proofs[leaf].push(level[i + 1].toString('hex'));
      for (const leaf of members[i + 1]) proofs[leaf].push(level[i].toString('hex'));
      nextLevel.push(nodeHash(level[i], level[i + 1]));
      nextMembers.push([...members[i], ...members[i + 1]]);
    }
    level = nextLevel;
    members = nextMembers;
  }
  return { root: level[0].toString('hex'), proofs };
}

export function verifyProof(leaf: string, proof: string[], root: string): boolean {
  const computed = proof.reduce(
    (node, sibling) => nodeHash(node, Buffer.from(sibling, 'hex')),
    leafHash(leaf),
  );
  return computed.toString('hex') === root;
}
