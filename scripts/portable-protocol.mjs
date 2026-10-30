// pglite-socket forwards one frontend message at a time. In PGlite 0.5.10,
// an extended-query error emits ReadyForQuery before the client's Sync, then
// Sync emits it again. pg can mistake the extra response for the next query.
// Keep ErrorResponse and all result frames; only suppress premature readiness.
// https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY
// This adapter is only for the local socket server, never native PostgreSQL.
export function useSocketProtocol(db) {
  const execute = db.execProtocolRawStream.bind(db);
  const extended = new Set([...Buffer.from('PBDECH')]);
  db.execProtocolRawStream = async (message, options) => {
    if (!extended.has(message[0])) return execute(message, options);
    let pending = Buffer.alloc(0);
    await execute(message, {
      ...options,
      onRawData(data) {
        pending = Buffer.concat([pending, data]);
        while (pending.length >= 5) {
          const length = pending.readInt32BE(1) + 1;
          if (length < 5) throw Error('Invalid portable database response frame.');
          if (pending.length < length) break;
          const frame = pending.subarray(0, length);
          pending = pending.subarray(length);
          if (frame[0] !== 90) options.onRawData(frame); // Z = ReadyForQuery
        }
      },
    });
    if (pending.length) throw Error('Incomplete portable database response frame.');
  };
  return db;
}
