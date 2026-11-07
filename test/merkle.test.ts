import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTree, verifyProof } from '../src/merkle.js';

test('every leaf proves into the root, for odd and even sizes', () => {
  for (const size of [1, 2, 3, 5, 8, 13]) {
    const leaves = Array.from({ length: size }, (_, i) => JSON.stringify({ id: i, p: i / 20 }));
    const tree = buildTree(leaves);
    leaves.forEach((leaf, i) =>
      assert.ok(verifyProof(leaf, tree.proofs[i], tree.root), `size ${size} leaf ${i}`),
    );
  }
});

test('tampered leaves and proofs fail', () => {
  const leaves = ['a', 'b', 'c', 'd', 'e'];
  const tree = buildTree(leaves);
  assert.equal(verifyProof('x', tree.proofs[0], tree.root), false);
  assert.equal(verifyProof('a', tree.proofs[1], tree.root), false);
  // A leaf can never pose as an inner node (domain separation).
  assert.notEqual(buildTree(['a']).root, buildTree(['a', 'a']).root);
});
