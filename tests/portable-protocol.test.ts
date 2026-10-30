import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { useSocketProtocol } from '../scripts/portable-protocol.mjs';

let db: PGlite;
const frame = (type: string, body = Buffer.alloc(0)) => {
  const header = Buffer.alloc(5);
  header[0] = type.charCodeAt(0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
};
const cstring = (value: string) => Buffer.from(value + '\0');
const parse = (sql: string) =>
  frame('P', Buffer.concat([cstring(''), cstring(sql), Buffer.alloc(2)]));
const bind = () => frame('B', Buffer.alloc(8));
const describe = () => frame('D', Buffer.from('P\0'));
const execute = () => frame('E', Buffer.alloc(5));
async function send(message: Buffer) {
  const chunks: Buffer[] = [];
  await db.execProtocolRawStream(message, {
    onRawData: (data: Uint8Array) => chunks.push(Buffer.from(data)),
  });
  let output = Buffer.concat(chunks);
  const messages: { type: string; body: Buffer }[] = [];
  while (output.length) {
    expect(output.length).toBeGreaterThanOrEqual(5);
    const length = output.readInt32BE(1) + 1;
    expect(output.length).toBeGreaterThanOrEqual(length);
    messages.push({ type: String.fromCharCode(output[0]), body: output.subarray(5, length) });
    output = output.subarray(length);
  }
  return messages;
}
beforeAll(async () => {
  db = useSocketProtocol(await PGlite.create());
  await db.exec(
    'CREATE TABLE protocol_test (id integer PRIMARY KEY); INSERT INTO protocol_test VALUES (1)',
  );
});
afterAll(async () => {
  await db?.close();
});

it.each([
  ['parse error', 'SELECT missing_column FROM protocol_test'],
  ['unique constraint error', 'INSERT INTO protocol_test VALUES (1)'],
])('waits for Sync after an extended %s and preserves rollback', async (_name, sql) => {
  await db.exec('BEGIN; INSERT INTO protocol_test VALUES (2)');
  const beforeSync = [];
  for (const message of [parse(sql), bind(), describe(), execute()])
    beforeSync.push(...(await send(message)));
  expect(beforeSync.filter((m) => m.type === 'E')).toHaveLength(1);
  expect(beforeSync.filter((m) => m.type === 'Z')).toHaveLength(0);
  const sync = await send(frame('S'));
  expect(sync.map((m) => m.type)).toEqual(['Z']);
  expect(sync[0].body.toString()).toBe('E');
  const rollback = await send(frame('Q', cstring('ROLLBACK')));
  expect(rollback.map((m) => m.type)).toEqual(['C', 'Z']);
  expect(rollback.at(-1)!.body.toString()).toBe('I');
  // A following read must receive its own rows, with no pending readiness frame.
  const rows = await db.query('SELECT id FROM protocol_test ORDER BY id');
  expect(rows.rows).toEqual([{ id: 1 }]);
});

it('preserves successful extended results and exactly one ready response', async () => {
  const responses = [];
  for (const message of [
    parse('SELECT id FROM protocol_test'),
    bind(),
    describe(),
    execute(),
    frame('S'),
  ]) {
    responses.push(...(await send(message)));
  }
  expect(responses.map((m) => m.type)).toEqual(['1', '2', 'T', 'D', 'C', 'Z']);
});

it('preserves the ready response after a simple-query error', async () => {
  const responses = await send(frame('Q', cstring('SELECT 1 / 0')));
  expect(responses.map((m) => m.type)).toEqual(['E', 'Z']);
  expect((await db.query('SELECT 42 AS value')).rows).toEqual([{ value: 42 }]);
});

it('handles split and coalesced backend frames without changing error or result bytes', async () => {
  const error = frame('E', Buffer.from('test error\0'));
  const ready = frame('Z', Buffer.from('E'));
  const data = frame('D', Buffer.from('test row'));
  const bytes = Buffer.concat([error, ready, data]);
  const fake = useSocketProtocol({
    async execProtocolRawStream(
      _message: Uint8Array,
      { onRawData }: { onRawData: (data: Uint8Array) => void },
    ) {
      for (let i = 0; i < bytes.length; i += 3) onRawData(bytes.subarray(i, i + 3));
    },
  });
  const received: Buffer[] = [];
  await fake.execProtocolRawStream(execute(), {
    onRawData: (data: Uint8Array) => received.push(Buffer.from(data)),
  });
  expect(Buffer.concat(received)).toEqual(Buffer.concat([error, data]));
});
