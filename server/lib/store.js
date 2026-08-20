// ============================================================
// store.js
// Persistência simples em arquivo JSON local.
// Guarda usuários (com senha em hash) e favoritos por usuário.
//
// Isso substitui um banco de dados real apenas para manter o
// projeto autocontido e fácil de rodar. Em produção, troque
// este arquivo por uma camada de acesso a um banco (Postgres,
// SQLite, etc.) mantendo a mesma interface pública abaixo.
// ============================================================
"use strict";

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function readDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { users: [] };
  }
}

function writeDb(db) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function findUserByEmail(email) {
  const db = readDb();
  const normalized = String(email || "").trim().toLowerCase();
  return db.users.find((u) => u.email.toLowerCase() === normalized) || null;
}

function findUserById(id) {
  const db = readDb();
  return db.users.find((u) => u.id === id) || null;
}

function createUser({ id, email, passwordHash }) {
  const db = readDb();
  const user = { id, email, passwordHash, favorites: [] };
  db.users.push(user);
  writeDb(db);
  return user;
}

function updateUserPassword(id, passwordHash) {
  const db = readDb();
  const user = db.users.find((u) => u.id === id);
  if (!user) return false;
  user.passwordHash = passwordHash;
  writeDb(db);
  return true;
}

function getFavorites(userId) {
  const user = findUserById(userId);
  return user ? user.favorites || [] : [];
}

function setFavorites(userId, favorites) {
  const db = readDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;
  user.favorites = favorites;
  writeDb(db);
  return true;
}

module.exports = {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserPassword,
  getFavorites,
  setFavorites,
};
