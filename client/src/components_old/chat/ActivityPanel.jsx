import { useState, useEffect, useRef } from "react";
import { useSocket } from "../../context/SocketContext";
import { formatActivity, getActivityClass } from "../../utils";

export default function ActivityPanel({ roomCode }) {
  const { socket } = useSocket();
  const [activities, setActivities] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    socket.on("activity:history", (history) => {
      setActivities(history.reverse());
    });

    socket.on("activity:new", (activity) => {
      setActivities((prev) => [...prev, activity]);
    });

    // Also listen for auction events that map to activities
    const auctionEvents = [
      "auction:playerNominated",
      "auction:bidPlaced",
      "auction:playerSold",
      "auction:playerUnsold",
    ];

    // These are already in the activity log — we just re-fetch
    // Not duplicating here since server-side ActivityLog handles persistence

    return () => {
      socket.off("activity:history");
      socket.off("activity:new");
    };
  }, [socket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities]);

  return (
    <div className="card" style={{ padding: 0, height: "100%", overflow: "hidden" }}>
      <div className="activity-list scrollbar-thin" style={{ height: "100%" }}>
        {activities.length === 0 && (
          <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 20 }}>
            No activity yet
          </p>
        )}
        {activities.map((log, i) => (
          <div key={log._id || i} className={`activity-item ${getActivityClass(log.type)}`}>
            <span>{formatActivity(log)}</span>
            {log.createdAt && (
              <span style={{ float: "right", fontSize: 10, color: "var(--text-muted)" }}>
                {new Date(log.createdAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
