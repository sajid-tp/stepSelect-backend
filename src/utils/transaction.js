// src/utils/transaction.js
// One small helper that runs a piece of work inside a MongoDB transaction.
//
//   const result = await runInTransaction(async (session) => {
//     await Model.updateOne(filter, update, { session });   // pass the session to EVERY query
//     return somethingToReturn;
//   });
//
// - All writes made with that session commit together, or none of them stay (rolled back).
// - MongoDB only allows transactions on a replica set (Atlas always is one) or a sharded cluster.
//   A plain local `mongod` is NOT one. In that case this helper does not fail: it calls your
//   function with session = undefined, so the same code still runs, just without the all-or-nothing safety.
//   Your function can check `if (!session)` to do its old manual clean-up.
// - Set DISABLE_DB_TRANSACTIONS=true in .env to force that fallback.
// - The function can run more than once (MongoDB retries a transaction after a temporary conflict),
//   so start it from a clean state and keep outside variables out of it.
// - Do NOT call external services (Razorpay, e-mail, Cloudinary) inside it: they cannot be rolled back.
const mongoose = require('mongoose');

let supportCheck = null; // cached: does this database allow transactions?

const detectSupport = async () => {
  if (String(process.env.DISABLE_DB_TRANSACTIONS).toLowerCase() === 'true') {
    console.log('MongoDB transactions: disabled by DISABLE_DB_TRANSACTIONS');
    return false;
  }

  const db = mongoose.connection?.db;
  if (!db) return null; // not connected yet: decide later, do not cache

  let info;
  try {
    info = await db.admin().command({ hello: 1 });
  } catch {
    try {
      info = await db.admin().command({ isMaster: 1 }); // very old servers
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

// The error MongoDB gives when a standalone server is asked for a transaction
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
        result = undefined; // clean start if MongoDB retries the transaction
        result = await work(session);
      },
      { writeConcern: { w: 'majority' } }
    );
    return result;
  } catch (err) {
    // Our check said "yes" but the server refused: remember that and run without a transaction.
    // (The refusal happens on the very first query, so nothing was written yet.)
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
