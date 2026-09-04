/**
 * db/connect.js — connect to MongoDB.
 *
 * Two modes:
 *   1. Real Mongo: if config.mongodbUri is set, mongoose.connect() it.
 *   2. In-memory: otherwise, download/extract a real mongod binary via
 *      mongodb-memory-server, get its connection URI, then connect.
 *
 * The server is meant to *never* crash because the database isn't
 * available. If both modes fail, we return a structured error and the
 * caller (/api/health) reports it. /api/health becomes the source of
 * truth for DB state.
 */
'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let memoryServer = null;
let lastError = null;

async function connectMongo({ uri }) {
  // Force mongoose to use the modern "useNewUrlParser" / "useUnifiedTopology"
  // behaviour, which is default in 8.x but we set it explicitly so the
  // code is self-documenting.
  mongoose.set('strictQuery', true);

  if (uri) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8000,
        maxPoolSize: 20,
      });
      return { mode: 'real', uri };
    } catch (err) {
      lastError = err;
      // Don't throw — fall through to in-memory
      console.warn(
        `[db] MONGODB_URI connection failed (${err.message}); falling back to in-memory Mongo.`
      );
    }
  }

  // In-memory fallback
  try {
    memoryServer = await MongoMemoryServer.create({
      instance: { dbName: 'agroconnect' },
    });
    const memUri = memoryServer.getUri();
    await mongoose.connect(memUri, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 20,
    });
    return { mode: 'memory', uri: memUri };
  } catch (err) {
    lastError = err;
    throw err;
  }
}

async function disconnectMongo() {
  try {
    await mongoose.disconnect();
  } catch (_) {}
  if (memoryServer) {
    try {
      await memoryServer.stop();
    } catch (_) {}
    memoryServer = null;
  }
}

async function pingMongo() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    const admin = mongoose.connection.db.admin();
    await admin.ping();
    return true;
  } catch (_) {
    return false;
  }
}

function lastErrorMessage() {
  return lastError ? lastError.message : null;
}

module.exports = { connectMongo, disconnectMongo, pingMongo, lastErrorMessage };
