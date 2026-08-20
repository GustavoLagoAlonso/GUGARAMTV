// ============================================================
// seed-user.js
// Cria o primeiro usuário (ex.: administrador) em
// server/data/db.json, a partir de ADMIN_EMAIL / ADMIN_PASSWORD
// definidos no .env. Rode com: npm run seed
// ============================================================
"use strict";

require("dotenv").config();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const store = require("../lib/store");

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env antes de rodar o seed.");
    process.exit(1);
  }

  const existing = store.findUserByEmail(email);
  if (existing) {
    console.log("Usuário já existe:", email, "— nada a fazer.");
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = store.createUser({
    id: crypto.randomUUID(),
    email,
    passwordHash,
  });

  console.log("Usuário criado com sucesso:", user.email);
  console.log("Você já pode remover ADMIN_EMAIL/ADMIN_PASSWORD do .env, se preferir.");
}

main().catch((e) => {
  console.error("Falha ao criar usuário:", e);
  process.exit(1);
});
