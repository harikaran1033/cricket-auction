import { useState, useEffect, useRef } from "react";
import { useSocket } from "../../context/SocketContext";
import { useUser } from "../../context/UserContext";

export default function ChatPanel({ roomCode, readOnly = false }) {
  const { socket } = useSocket();
  const { user } = useUser();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    socket.on("chat:message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on("chat:history", (history) => {
      setMessages(history);
    });

    return () => {
      socket.off("chat:message");
      socket.off("chat:history");
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (readOnly || !input.trim() || !socket) return;
    socket.emit("chat:send", {
      roomCode,
      userId: user.userId,
      userName: user.userName,
      teamName: user.teamName,
      message: input.trim(),
    });
    setInput("");
  };

  return (
    <div className="chat-container card" style={{ padding: 0, height: "100%" }}>
      <div className="chat-messages scrollbar-thin">
        {messages.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
            No messages yet. Say hi! 👋
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={msg._id || i} className="chat-msg">
            <div className="msg-user">
              {msg.userName}
              {msg.teamName && (
                <span style={{ color: "var(--text-muted)", marginLeft: 6, fontWeight: 500 }}>
                  [{msg.teamName}]
                </span>
              )}
            </div>
            <div>{msg.message}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="chat-input-row">
        <input
          className="input"
          placeholder={readOnly ? "Spectators can read only" : "Type a message..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          style={{ marginBottom: 0 }}
          disabled={readOnly}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={sendMessage}
          disabled={readOnly}
        >
          {readOnly ? "Read Only" : "Send"}
        </button>
      </div>
    </div>
  );
}
