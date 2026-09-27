const bcrypt = require("bcryptjs");
const {  pool, transaction  } = require("./index");

async function main() {
  const passwordHash = await bcrypt.hash("Password123!", 12);

  await transaction(async (client) => {
    const users = [
      ["rahul@example.com", "Rahul"],
      ["priya@example.com", "Priya"],
      ["amit@example.com", "Amit"],
      ["sneha@example.com", "Sneha"],
      ["vikram@example.com", "Vikram"],
      ["neha@example.com", "Neha"]
    ];

    const ids = {};
    for (const [email, name] of users) {
      const result = await client.query(
        `INSERT INTO users(email, password_hash, name)
         VALUES($1,$2,$3)
         ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name
         RETURNING id, email`,
        [email, passwordHash, name]
      );
      ids[email] = result.rows[0].id;
    }

    async function direct(a, b) {
      const [x, y] = [ids[a], ids[b]].sort();
      const key = `${x}:${y}`;
      const c = await client.query(
        `INSERT INTO conversations(type, direct_key, created_by)
         VALUES('DIRECT',$1,$2)
         ON CONFLICT(direct_key) DO UPDATE SET updated_at=conversations.updated_at
         RETURNING id`,
        [key, x]
      );
      const conversationId = c.rows[0].id;
      await client.query(
        `INSERT INTO conversation_members(conversation_id,user_id,role)
         VALUES($1,$2,'MEMBER'),($1,$3,'MEMBER')
         ON CONFLICT(conversation_id,user_id) DO NOTHING`,
        [conversationId, x, y]
      );
      return conversationId;
    }

    async function group(name, owner, admin, members) {
      const c = await client.query(
        `INSERT INTO conversations(type,name,created_by)
         VALUES('GROUP',$1,$2) RETURNING id`,
        [name, ids[owner]]
      );
      const conversationId = c.rows[0].id;
      await client.query(
        `INSERT INTO conversation_members(conversation_id,user_id,role)
         VALUES($1,$2,'OWNER'),($1,$3,'ADMIN')`,
        [conversationId, ids[owner], ids[admin]]
      );
      for (const email of members) {
        await client.query(
          `INSERT INTO conversation_members(conversation_id,user_id,role)
           VALUES($1,$2,'MEMBER') ON CONFLICT DO NOTHING`,
          [conversationId, ids[email]]
        );
      }
      return conversationId;
    }

    const c1 = await direct("rahul@example.com", "priya@example.com");
    const c2 = await direct("rahul@example.com", "amit@example.com");
    const g1 = await group(
      "Engineering",
      "rahul@example.com",
      "priya@example.com",
      ["amit@example.com", "sneha@example.com"]
    );
    const g2 = await group(
      "Design",
      "vikram@example.com",
      "neha@example.com",
      ["rahul@example.com"]
    );

    const messages = [
      [c1, ids["rahul@example.com"], "Hey Priya!"],
      [c1, ids["priya@example.com"], "Hey Rahul, how are you?"],
      [c1, ids["rahul@example.com"], "Doing great. Working on the chat app."],
      [c2, ids["amit@example.com"], "Are we still meeting today?"],
      [c2, ids["rahul@example.com"], "Yes, at 5 PM."],
      [g1, ids["rahul@example.com"], "Welcome to Engineering!"],
      [g1, ids["priya@example.com"], "Let's ship it."],
      [g2, ids["vikram@example.com"], "Welcome to Design."]
    ];

    for (const [conversationId, senderId, content] of messages) {
      await client.query(
        `INSERT INTO messages(client_message_id,conversation_id,sender_id,content)
         VALUES(gen_random_uuid(),$1,$2,$3)`,
        [conversationId, senderId, content]
      );
    }

    console.log("Seed complete.");
  });

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
