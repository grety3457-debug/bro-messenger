const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

// ========== БАЗА ДАННЫХ ==========
const db = new Database("chat.db", { verbose: console.log });

db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user TEXT NOT NULL,
        to_user TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

console.log("✅ База данных chat.db готова");

// ========== ОНЛАЙН ПОЛЬЗОВАТЕЛИ ==========
const users = new Map();        // socket.id → username
const userSockets = new Map();  // username → socket.id

// ========== ФУНКЦИИ БД ==========
function saveMessage(from, to, text) {
    const stmt = db.prepare(
        "INSERT INTO messages (from_user, to_user, text) VALUES (?, ?, ?)"
    );
    stmt.run(from, to, text);
}

function getChatHistory(user1, user2) {
    const stmt = db.prepare(`
        SELECT from_user as "from", text, 
               strftime('%H:%M', timestamp) as time
        FROM messages 
        WHERE (from_user = ? AND to_user = ?) 
           OR (from_user = ? AND to_user = ?)
        ORDER BY timestamp ASC
    `);
    return stmt.all(user1, user2, user2, user1);
}

// ========== SOCKET ==========
io.on("connection", (socket) => {
    console.log(`Новое подключение: ${socket.id}`);

    socket.on("join", (username) => {
        username = (username || "").trim().slice(0, 30);
        if (!username) return;

        if ([...users.values()].includes(username)) {
            socket.emit("username taken");
            return;
        }

        users.set(socket.id, username);
        userSockets.set(username, socket.id);

        console.log(`✅ ${username} вошёл в чат`);

        io.emit("users list", Array.from(users.values()));
    });

    // Отправка личного сообщения + сохранение в БД
    socket.on("private message", (data) => {
        const sender = users.get(socket.id);
        if (!sender) return;

        const { to, text } = data;
        if (!to || !text?.trim()) return;

        const cleanText = text.trim();

        // Сохраняем в базу
        saveMessage(sender, to, cleanText);

        const messageData = {
            from: sender,
            to: to,
            text: cleanText,
            time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        };

        // Отправляем получателю, если он онлайн
        const targetSocket = userSockets.get(to);
        if (targetSocket) {
            socket.to(targetSocket).emit("private message", messageData);
        }

        // Отправляем отправителю
        socket.emit("private message", messageData);
    });

    // Загрузка истории чата
    socket.on("get chat history", ({ withUser }) => {
        const username = users.get(socket.id);
        if (!username || !withUser) return;

        const history = getChatHistory(username, withUser);
        socket.emit("chat history", { withUser, messages: history });
    });

    socket.on("disconnect", () => {
        const username = users.get(socket.id);
        if (username) {
            console.log(`❌ ${username} вышел`);
            users.delete(socket.id);
            userSockets.delete(username);
            io.emit("users list", Array.from(users.values()));
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
