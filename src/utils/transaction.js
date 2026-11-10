const mongoose = require('mongoose');

let supportCheck = null;

const detectSupport = async () => {
  if (String(process.env.DISABLE_DB_TRANSACTIONS).toLowerCase() === 'true') {
    console.log('MongoDB transactions: disabled by DISABLE_DB_TRANSACTIONS');
    return false;
  }

  const db = mongoose.connection?.db;
  if (!db) return null;

  let info;
  try {
    info = await db.admin().command({ hello: 1 });
  } catch {
    try {
      info = await db.admin().command({ isMaster: 1 });
    } catch {
      return false;
    }
  }

  const supported = Boolean(info?.setName) || info?.msg === 'isdbgrid';
  console.log(
    supported
      ? 'MongoDB transactions: enabled'
      : 'MongoDB transactions: not available (standalone server), running without them'
  );
  return supported;
};

const transactionsSupported = async () => {
  if (supportCheck === null) {
    const result = await detectSupport();
    if (result === null) return false;
    supportCheck = result;
  }
  return supportCheck;
};

const isNotSupportedError = (err) =>
  /Transaction numbers are only allowed|replica set member or mongos|does not support transactions/i.test(
    String(err?.message || '')
  );

const runInTransaction = async (work) => {
  if (!(await transactionsSupported())) return work(undefined);

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = undefined;
        result = await work(session);
      },
      { writeConcern: { w: 'majority' } }
    );
    return result;
  } catch (err) {
    if (isNotSupportedError(err)) {
      supportCheck = false;
      console.log('MongoDB transactions: not available, running without them');
      return work(undefined);
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

module.exports = { runInTransaction, transactionsSupported };
