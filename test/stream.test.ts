import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from '../src/sources/stream.js';

test('protobuf Values from the checkpoint stream become plain JSON', () => {
  const str = (stringValue: string) => ({
    kind: { oneofKind: 'stringValue' as const, stringValue },
  });
  const value = {
    kind: {
      oneofKind: 'structValue' as const,
      structValue: {
        fields: {
          expiry: str('1794023280000'),
          source: { kind: { oneofKind: 'numberValue' as const, numberValue: 0 } },
          tags: {
            kind: {
              oneofKind: 'listValue' as const,
              listValue: {
                values: [{ kind: { oneofKind: 'boolValue' as const, boolValue: true } }],
              },
            },
          },
        },
      },
    },
  };
  assert.deepEqual(plain(value), { expiry: '1794023280000', source: 0, tags: [true] });
  assert.equal(plain(undefined), null);
});
